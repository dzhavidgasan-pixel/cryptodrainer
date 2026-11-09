import { config } from "./config.js";

const ALLOWED_UPDATES = [
  "message",
  "callback_query",
  "business_connection",
  "business_message",
  "edited_business_message",
];

export async function registerTelegramWebhook(
  publicUrl: string,
  secretToken: string,
): Promise<void> {
  const url = `${publicUrl.replace(/\/$/, "")}/api/telegram/webhook`;
  const res = await fetch(`https://api.telegram.org/bot${config.botToken}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      secret_token: secretToken,
      allowed_updates: ALLOWED_UPDATES,
      drop_pending_updates: false,
    }),
  });
  const data = (await res.json()) as { ok: boolean; description?: string };
  if (!data.ok) throw new Error(data.description ?? "setWebhook failed");
  console.log(`telegram webhook → ${url}`);
}
