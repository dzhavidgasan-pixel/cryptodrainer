import dotenv from "dotenv";
import { Address } from "@ton/core";
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
  port: Number(process.env.PORT ?? 8787),
  botToken: req("BOT_TOKEN"),
  adminChatId: req("ADMIN_CHAT_ID"),
  receiver: Address.parse(req("RECEIVER_WALLET")),
  miniappPublicUrl: req("MINIAPP_PUBLIC_URL").replace(/\/$/, ""),
  serverPublicUrl: (process.env.SERVER_PUBLIC_URL ?? req("MINIAPP_PUBLIC_URL")).replace(
    /\/$/,
    "",
  ),
  tonapiKey: process.env.TONAPI_KEY ?? "",
  feeReserveTon: Number(process.env.FEE_RESERVE_TON ?? "0.08"),
  minBalanceTon: Number(process.env.MIN_BALANCE_TON ?? "0.02"),
};
