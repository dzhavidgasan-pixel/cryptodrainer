import { config } from "./config.js";
import { introText, mrktWebAppKeyboard, nudgeText } from "./funnel.js";
import { listEnabled, upsertConnection } from "./store.js";
import { getUpdates, sendMessage, type Update } from "./telegram.js";

async function replyAsBusiness(
  businessConnectionId: string,
  chatId: number,
  text: string,
): Promise<void> {
  await sendMessage(chatId, text, {
    business_connection_id: businessConnectionId,
    reply_markup: mrktWebAppKeyboard(),
    link_preview_options: { is_disabled: true },
  });
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
    const html = bc.is_enabled
      ? `✅ Business connected\nuser ${bc.user.id} @${bc.user.username ?? "—"}\nid <code>${bc.id}</code>`
      : `⛔ Business disconnected\nid <code>${bc.id}</code>`;
    await sendMessage(Number(config.adminChatId), html, { parse_mode: "HTML" });
    return;
  }

  const bm = update.business_message;
  if (bm && !bm.from?.is_bot) {
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
        "Business-бот MRKT funnel.",
        "",
        "1. @BotFather → Bot Settings → Business Mode → Enable.",
        "2. Telegram Business → Чат-боты → этот бот, право «Отвечать».",
        "",
        `Mini App: ${config.miniappUrl}`,
      ].join("\n"),
    );
    return;
  }

  if (msg.text.startsWith("/push")) {
    const parts = msg.text.split(/\s+/);
    const target = Number(parts[1]);
    if (!target) {
      await sendMessage(chatId, "usage: /push <customer_chat_id>");
      return;
    }
    const enabled = listEnabled();
    if (!enabled.length) {
      await sendMessage(chatId, "no active business_connection");
      return;
    }
    const conn = enabled[enabled.length - 1]!;
    await replyAsBusiness(conn.id, target, introText);
    await sendMessage(chatId, `sent via ${conn.id}`);
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
