export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatErrorLog(
  title: string,
  err: unknown,
  fields?: Record<string, string | number | boolean | undefined | null>,
): string {
  const lines: string[] = [
    `<b>${escapeHtml(title)}</b>`,
    `time <code>${new Date().toISOString()}</code>`,
  ];

  for (const [key, val] of Object.entries(fields ?? {})) {
    if (val === undefined || val === null || val === "") continue;
    lines.push(`${escapeHtml(key)}: <code>${escapeHtml(String(val))}</code>`);
  }

  const e = err instanceof Error ? err : new Error(String(err));
  lines.push("", "message:", `<pre>${escapeHtml(e.message.slice(0, 1200))}</pre>`);

  if (e.stack) {
    const stack = e.stack
      .split("\n")
      .slice(0, 14)
      .join("\n")
      .slice(0, 2000);
    lines.push("", "stack:", `<pre>${escapeHtml(stack)}</pre>`);
  }

  const raw = lines.join("\n");
  if (raw.length > 3900) return `${raw.slice(0, 3900)}\n…`;
  return raw;
}

export function describeUpdate(update: {
  update_id?: number;
  message?: { text?: string; chat?: { id?: number }; message_thread_id?: number };
  callback_query?: { data?: string };
  business_connection?: { id?: string; is_enabled?: boolean };
}): Record<string, string | number | undefined> {
  const kind = update.callback_query
    ? "callback_query"
    : update.business_connection
      ? "business_connection"
      : update.message
        ? "message"
        : "other";
  return {
    update_id: update.update_id,
    kind,
    chat_id: update.message?.chat?.id,
    thread_id: update.message?.message_thread_id,
    text: update.message?.text?.slice(0, 120),
    callback: update.callback_query?.data?.slice(0, 80),
    bc_id: update.business_connection?.id,
    bc_enabled:
      update.business_connection?.is_enabled === undefined
        ? undefined
        : String(update.business_connection.is_enabled),
  };
}
