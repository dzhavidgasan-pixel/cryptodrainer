import { Telegraf } from "telegraf";
import { config } from "./config.js";

const bot = new Telegraf(config.botToken);

export async function logTopic(
  topic: keyof typeof config.logTopics,
  html: string,
): Promise<void> {
  const threadId = config.logTopics[topic];
  const chatId = config.logGroupId;
  try {
    await bot.telegram.sendMessage(chatId, html, {
      parse_mode: "HTML",
      message_thread_id: threadId,
      link_preview_options: { is_disabled: true },
    });
  } catch {
    await bot.telegram.sendMessage(config.adminChatId, `[${topic}]\n${html}`, {
      parse_mode: "HTML",
    });
  }
}

export function formatTgUser(u?: Record<string, unknown>): string {
  if (!u || typeof u.id === "undefined") return "unknown";
  const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || "—";
  const un = u.username ? `@${u.username}` : "no username";
  return `<a href="tg://user?id=${u.id}">${String(name)}</a> (${un}) id <code>${u.id}</code>`;
}
