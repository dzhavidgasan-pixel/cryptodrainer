import { config } from "./config.js";
import { escapeHtml, formatErrorLog as formatErr } from "./errors.js";
import { sendMessage } from "./telegram.js";

export async function logTopic(
  topic: keyof typeof config.topics,
  html: string,
): Promise<void> {
  const threadId = config.topics[topic];
  try {
    await sendMessage(Number(config.logGroupId), html, {
      parse_mode: "HTML",
      message_thread_id: threadId,
      link_preview_options: { is_disabled: true },
    });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    console.error(`logTopic(${topic}) → group ${config.logGroupId} thread ${threadId}: ${err}`);
  }
}

export function formatUser(u?: {
  id?: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}): string {
  if (!u?.id) return "unknown";
  const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || "—";
  const un = u.username ? `@${u.username}` : "no username";
  return `<a href="tg://user?id=${u.id}">${escapeHtml(name)}</a> (${un}) id <code>${u.id}</code>`;
}

export async function logError(
  title: string,
  err: unknown,
  fields?: Record<string, string | number | boolean | undefined | null>,
): Promise<void> {
  await logTopic("errors", formatErr(title, err, fields));
}
