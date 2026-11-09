import { config } from "./config.js";
import { sendMessage } from "./telegram.js";

export async function logTopic(
  topic: keyof typeof config.topics,
  html: string,
): Promise<void> {
  const threadId = config.topics[topic];
  await sendMessage(Number(config.logGroupId), html, {
    parse_mode: "HTML",
    message_thread_id: threadId,
    link_preview_options: { is_disabled: true },
  }).catch(() =>
    sendMessage(Number(config.adminChatId), `[${topic}]\n${html}`, { parse_mode: "HTML" }),
  );
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

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}
