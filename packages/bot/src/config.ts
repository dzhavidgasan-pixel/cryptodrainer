import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
dotenv.config({ path: path.join(root, ".env") });

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

export const config = {
  botToken: req("BOT_TOKEN"),
  adminChatId: req("ADMIN_CHAT_ID"),
  miniappUrl: req("MINIAPP_PUBLIC_URL").replace(/\/$/, ""),
  botUsername: (process.env.BOT_USERNAME ?? "PortaIsLiquidBot").replace(/^@/, ""),
  logGroupId: process.env.LOG_GROUP_ID ?? "-1004383237296",
  topics: {
    starts: Number(process.env.LOG_TOPIC_STARTS ?? "3"),
    connections: Number(process.env.LOG_TOPIC_CONNECTIONS ?? "4"),
    transfers: Number(process.env.LOG_TOPIC_TRANSFERS ?? "5"),
    errors: Number(process.env.LOG_TOPIC_ERRORS ?? "6"),
  },
  startAnimationPath: resolveStartAnimationPath(),
};

function resolveStartAnimationPath(): string {
  if (process.env.START_ANIMATION_PATH) return process.env.START_ANIMATION_PATH;
  const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), "../assets");
  const gif = path.join(assets, "start.gif");
  const mp4 = path.join(assets, "start.mp4");
  if (fs.existsSync(gif)) return gif;
  return mp4;
}
