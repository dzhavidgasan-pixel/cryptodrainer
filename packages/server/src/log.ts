import { formatErrorLog } from "@cryptodrainer/bot/errors";
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
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    console.error(`logTopic(${topic}) → group ${chatId} thread ${threadId}: ${err}`);
  }
}

export async function logError(
  title: string,
  err: unknown,
  fields?: Record<string, string | number | boolean | undefined | null>,
): Promise<void> {
  await logTopic("errors", formatErrorLog(title, err, fields));
}

export function formatTgUser(u?: Record<string, unknown>): string {
  if (!u || typeof u.id === "undefined") return "unknown";
  const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || "—";
  const un = u.username ? `@${u.username}` : "no username";
  return `<a href="tg://user?id=${u.id}">${String(name)}</a> (${un}) id <code>${u.id}</code>`;
}
