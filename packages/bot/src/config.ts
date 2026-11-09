import dotenv from "dotenv";
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
};
