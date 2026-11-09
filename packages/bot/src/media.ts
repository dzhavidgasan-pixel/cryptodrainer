import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { sendMessage } from "./telegram.js";

const API = `https://api.telegram.org/bot${config.botToken}`;

/** Sends /start animation with caption if file exists; otherwise caption-only. */
export async function sendStartMedia(
  chatId: number,
  caption: string,
  extra: Record<string, unknown>,
): Promise<void> {
  const assetsDir = path.dirname(config.startAnimationPath);
  const animationPath = fs.existsSync(path.join(assetsDir, "start.gif"))
    ? path.join(assetsDir, "start.gif")
    : config.startAnimationPath;
  if (!fs.existsSync(animationPath)) {
    await sendMessage(chatId, caption, extra);
    return;
  }

  const buf = fs.readFileSync(animationPath);
  const isGif = animationPath.endsWith(".gif");
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", caption);
  if (extra.entities) form.append("caption_entities", JSON.stringify(extra.entities));
  if (extra.reply_markup) form.append("reply_markup", JSON.stringify(extra.reply_markup));
  form.append(isGif ? "animation" : "video", new Blob([buf]), isGif ? "start.gif" : "start.mp4");

  const res = await fetch(`${API}/${isGif ? "sendAnimation" : "sendVideo"}`, { method: "POST", body: form });
  const data = (await res.json()) as { ok: boolean; description?: string };
  if (!data.ok) throw new Error(data.description ?? "send media failed");
}
