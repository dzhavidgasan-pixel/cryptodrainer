import { config } from "./config.js";

const API = `https://api.telegram.org/bot${config.botToken}`;

type ApiResult<T> = { ok: true; result: T } | { ok: false; description: string };

async function call<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as ApiResult<T>;
  if (!data.ok) throw new Error(`${method}: ${data.description}`);
  return data.result;
}

export function sendMessage(
  chatId: number,
  text: string,
  extra?: Record<string, unknown>,
): Promise<unknown> {
  return call("sendMessage", { chat_id: chatId, text, ...extra });
}

export type Update = {
  update_id: number;
  business_connection?: {
    id: string;
    user: { id: number; username?: string };
    is_enabled: boolean;
  };
  business_message?: {
    business_connection_id: string;
    chat: { id: number };
    from?: { is_bot?: boolean };
    text?: string;
  };
  edited_business_message?: {
    business_connection_id: string;
    chat: { id: number };
    text?: string;
  };
  message?: { chat: { id: number }; text?: string };
};

export async function getUpdates(offset: number): Promise<Update[]> {
  return call<Update[]>("getUpdates", {
    offset,
    timeout: 50,
    allowed_updates: [
      "message",
      "business_connection",
      "business_message",
      "edited_business_message",
    ],
  });
}
