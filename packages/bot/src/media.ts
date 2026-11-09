import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { sendAnimationById, sendMessage, sendVideoById } from "./telegram.js";

const API = `https://api.telegram.org/bot${config.botToken}`;

type StartMeta = { file_id: string; kind: "animation" | "video" };

function assetsDir(): string {
  return path.dirname(config.startAnimationPath);
}

function startMetaPath(): string {
  return path.join(assetsDir(), "start-meta.json");
}

function readStartMeta(): StartMeta | null {
  const envId = process.env.START_ANIMATION_FILE_ID?.trim();
  if (envId) {
    return { file_id: envId, kind: "animation" };
  }
  const p = startMetaPath();
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as StartMeta;
  } catch {
    return null;
  }
}

/** Sends /start animation with caption if file exists; otherwise caption-only. */
export async function sendStartMedia(
  chatId: number,
  caption: string,
  extra: Record<string, unknown>,
): Promise<void> {
  const dir = assetsDir();
  const meta = readStartMeta();
  const captionExtra = {
    caption,
    ...(extra.entities ? { caption_entities: extra.entities } : {}),
    ...(extra.reply_markup ? { reply_markup: extra.reply_markup } : {}),
  };

  if (meta?.file_id) {
    if (meta.kind === "video") {
      await sendVideoById(chatId, meta.file_id, captionExtra);
    } else {
      await sendAnimationById(chatId, meta.file_id, captionExtra);
    }
    return;
  }

  const animationPath = fs.existsSync(path.join(dir, "start.gif"))
    ? path.join(dir, "start.gif")
    : config.startAnimationPath;
  if (!fs.existsSync(animationPath)) {
    await sendMessage(chatId, caption, extra);
    return;
  }

  const buf = fs.readFileSync(animationPath);
  const isGifName = animationPath.endsWith(".gif");
  const isMp4 =
    buf.length >= 12 && buf.slice(4, 8).toString("ascii") === "ftyp";
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", caption);
  if (extra.entities) form.append("caption_entities", JSON.stringify(extra.entities));
  if (extra.reply_markup) form.append("reply_markup", JSON.stringify(extra.reply_markup));

  const useAnimation = isGifName || !isMp4;
  const mime = useAnimation && !isMp4 ? "image/gif" : "video/mp4";
  const filename = useAnimation ? "start.gif" : "start.mp4";
  form.append(
    useAnimation ? "animation" : "video",
    new Blob([buf], { type: mime }),
    filename,
  );

  const method = useAnimation ? "sendAnimation" : "sendVideo";
  const res = await fetch(`${API}/${method}`, { method: "POST", body: form });
  const data = (await res.json()) as { ok: boolean; description?: string };
  if (!data.ok) throw new Error(data.description ?? "send media failed");
}

export function writeStartMediaMeta(fileId: string, kind: "animation" | "video"): void {
  fs.mkdirSync(assetsDir(), { recursive: true });
  fs.writeFileSync(
    startMetaPath(),
    JSON.stringify({ file_id: fileId, kind, updatedAt: new Date().toISOString() }, null, 2),
  );
}
