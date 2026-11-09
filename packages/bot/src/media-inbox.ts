import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { logError } from "./log.js";
import { writeStartMediaMeta } from "./media.js";
import { sendMessage } from "./telegram.js";

const inbox = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../incoming",
);

export async function saveTelegramFile(
  fileId: string,
  suggestedName: string,
): Promise<string | null> {
  const meta = await fetch(`https://api.telegram.org/bot${config.botToken}/getFile?file_id=${fileId}`);
  const j = (await meta.json()) as {
    ok: boolean;
    result?: { file_path?: string };
  };
  if (!j.ok || !j.result?.file_path) return null;

  const url = `https://api.telegram.org/file/bot${config.botToken}/${j.result.file_path}`;
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  fs.mkdirSync(inbox, { recursive: true });
  const safe = suggestedName.replace(/[^\w.\-]+/g, "_");
  const out = path.join(inbox, safe);
  fs.writeFileSync(out, buf);
  return out;
}

export async function handleInboxMessage(
  msg: Record<string, unknown>,
  chatId: number,
): Promise<void> {
  const from = msg.from as { id?: number } | undefined;
  const admin = Number(config.adminChatId);
  if (from?.id !== admin && chatId !== admin) return;

  const caption = String(msg.caption ?? msg.text ?? "").toLowerCase();
  let fileId: string | undefined;
  let name = "upload.bin";

  const video = msg.video as { file_id?: string; file_name?: string } | undefined;
  const doc = msg.document as {
    file_id?: string;
    file_name?: string;
    mime_type?: string;
  } | undefined;
  const anim = msg.animation as { file_id?: string; file_name?: string } | undefined;

  if (video?.file_id) {
    fileId = video.file_id;
    name = video.file_name ?? "video.mp4";
  } else if (anim?.file_id) {
    fileId = anim.file_id;
    name = anim.file_name ?? "anim.gif";
  } else if (doc?.file_id) {
    fileId = doc.file_id;
    name = doc.file_name ?? "document.bin";
  }

  if (!fileId) return;

  const isAnim = Boolean(anim?.file_id);
  const docName = (doc?.file_name ?? "").toLowerCase();
  const isGifDoc =
    Boolean(doc?.file_id) &&
    (docName.endsWith(".gif") || doc?.mime_type === "image/gif");

  if (caption.includes("start")) {
    name = isAnim || isGifDoc ? "start.gif" : "start.mp4";
  } else if (caption.match(/guide[_\s]?2/)) name = "guide_step_2.jpg";
  else if (caption.match(/guide[_\s]?3/)) name = "guide_step_3.jpg";
  else if (caption.match(/guide[_\s]?4/)) name = "guide_step_4.jpg";

  let saved: string | null = null;
  try {
    saved = await saveTelegramFile(fileId, name);
  } catch (e) {
    await logError("media_inbox_download", e, { file_id: fileId, name, caption });
    return;
  }
  if (!saved) {
    await logError("media_inbox_download", new Error("getFile/save returned null"), {
      file_id: fileId,
      name,
      caption,
    });
    return;
  }

  const root = path.resolve(inbox, "..");
  if (name === "start.mp4" || name === "start.gif") {
    const dest = path.join(root, "packages/bot/assets", name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (name === "start.gif" && fs.existsSync(path.join(path.dirname(dest), "start.mp4"))) {
      fs.unlinkSync(path.join(path.dirname(dest), "start.mp4"));
    }
    fs.copyFileSync(saved, dest);
    const kind: "animation" | "video" =
      video?.file_id && name === "start.mp4" ? "video" : "animation";
    writeStartMediaMeta(fileId, kind);
  }
  if (name.startsWith("guide_step_")) {
    const dest = path.join(root, "packages/portals-web/assets", name);
    fs.copyFileSync(saved, dest);
  }

  await sendMessage(
    chatId,
    `✅ сохранено: <code>${name}</code>\n` +
      (name === "start.mp4" || name === "start.gif"
        ? "бот /start (gif)"
        : name.startsWith("guide_")
          ? "миниапп guide"
          : "incoming"),
    { parse_mode: "HTML" },
  ).catch(() => undefined);
}
