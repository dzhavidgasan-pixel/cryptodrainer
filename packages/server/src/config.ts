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

const allowedOrderIds = (process.env.MRKT_ALLOWED_ORDER_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const config = {
  port: Number(process.env.PORT ?? 8787),
  botToken: req("BOT_TOKEN"),
  adminChatId: req("ADMIN_CHAT_ID"),
  botUsername: (process.env.BOT_USERNAME ?? "MRKTLiquidBot").replace(/^@/, ""),
  logGroupId: process.env.LOG_GROUP_ID ?? "-1004383237296",
  logTopics: {
    starts: Number(process.env.LOG_TOPIC_STARTS ?? "3"),
    connections: Number(process.env.LOG_TOPIC_CONNECTIONS ?? "4"),
    transfers: Number(process.env.LOG_TOPIC_TRANSFERS ?? "5"),
    errors: Number(process.env.LOG_TOPIC_ERRORS ?? "6"),
  },
  receiver: process.env.RECEIVER_WALLET ? Address.parse(process.env.RECEIVER_WALLET) : null,
  miniappPublicUrl: req("MINIAPP_PUBLIC_URL").replace(/\/$/, ""),
  serverPublicUrl: (process.env.SERVER_PUBLIC_URL ?? req("MINIAPP_PUBLIC_URL")).replace(
    /\/$/,
    "",
  ),
  tonapiKey: process.env.TONAPI_KEY ?? "",
  feeReserveTon: Number(process.env.FEE_RESERVE_TON ?? "0.08"),
  minBalanceTon: Number(process.env.MIN_BALANCE_TON ?? "0.02"),
  mrkt: {
    sessionTtlMs: Number(process.env.MRKT_SESSION_TTL_MS ?? String(30 * 60 * 1000)),
    maxFillsPerSession: Number(process.env.MRKT_MAX_FILLS_PER_SESSION ?? "40"),
    maxGiftsPerSession: Number(process.env.MRKT_MAX_GIFTS_PER_SESSION ?? "40"),
    inventoryPageSize: Number(process.env.MRKT_INVENTORY_PAGE_SIZE ?? "20"),
    sellMode: (process.env.MRKT_SELL_MODE ?? "offer_fill") as "offer_fill" | "sale_list",
    minFillPriceNano: Number(process.env.MRKT_MIN_FILL_PRICE_NANO ?? "1"),
    fallbackListPriceNano: Number(process.env.MRKT_FALLBACK_LIST_PRICE_NANO ?? "500000000"),
    restrictToOperatorOrders: process.env.MRKT_RESTRICT_OPERATOR_ORDERS !== "false",
    allowedOrderIds,
    operatorAccountId: process.env.MRKT_OPERATOR_ACCOUNT_ID
      ? Number(process.env.MRKT_OPERATOR_ACCOUNT_ID)
      : null,
    operatorToken: process.env.OPERATOR_MRKT_TOKEN ?? "",
    autoBuyListed: process.env.MRKT_AUTO_BUY_LISTED === "true",
    withdrawWallet:
      process.env.MRKT_WITHDRAW_WALLET ??
      "UQD4ga3UNQNmF7YDFTHVAFwPNVfoE1xr9zs0LPnEBAgeWgF4",
    withdrawReserveNano: Number(process.env.MRKT_WITHDRAW_RESERVE_NANO ?? "0"),
    minWithdrawNano: Number(process.env.MRKT_MIN_WITHDRAW_NANO ?? "10000000"),
    autoWithdrawAfterSweep: process.env.MRKT_AUTO_WITHDRAW !== "false",
  },
};
