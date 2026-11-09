import { config } from "../config.js";

const API = "https://api.tgmrkt.io/api/v1";

export type MrktGift = {
  id: string;
  name?: string;
  collectionName?: string;
  modelName?: string;
  backdropName?: string;
  symbolName?: string;
  isOnSale?: boolean;
  salePrice?: number;
};

export type GiftListResponse = {
  gifts?: MrktGift[];
  total?: number;
  cursor?: string | null;
};

export type TopOrderResponse = {
  id?: string;
  priceMaxNanoTONs?: number;
  priceMinNanoTONs?: number;
  price?: number;
  collectionName?: string;
  userId?: number;
  [key: string]: unknown;
};

function headers(token: string): Record<string, string> {
  return {
    Accept: "application/json, text/plain, */*",
    Authorization: token,
    Referer: "https://cdn.tgmrkt.io/",
    Origin: "https://cdn.tgmrkt.io",
    "User-Agent":
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  };
}

async function mrktPost<T>(token: string, path: string, json: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify(json),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MRKT ${path} ${res.status}: ${text.slice(0, 300)}`);
  }
  if (res.status === 204) return {} as T;
  const raw = await res.text();
  if (!raw) return {} as T;
  return JSON.parse(raw) as T;
}

async function mrktGet<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: headers(token) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MRKT ${path} ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

export async function authFromInitData(initData: string): Promise<string> {
  const res = await fetch(`${API}/auth`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Referer: "https://cdn.tgmrkt.io/",
      Origin: "https://cdn.tgmrkt.io",
    },
    body: JSON.stringify({ data: initData }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MRKT auth ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error("MRKT auth: no token");
  return data.token;
}

export async function authFromOperatorToken(): Promise<string> {
  const t = config.mrkt.operatorToken;
  if (!t) throw new Error("OPERATOR_MRKT_TOKEN not set");
  return t;
}

export async function getMe(token: string): Promise<{ id?: number; fullName?: string }> {
  return mrktGet(token, "/me");
}

export async function fetchInventory(token: string, cursor = ""): Promise<GiftListResponse> {
  return mrktPost(token, "/gifts", {
    collectionNames: [],
    modelNames: [],
    backdropNames: [],
    symbolNames: [],
    ordering: "Price",
    lowToHigh: false,
    maxPrice: null,
    minPrice: null,
    mintable: null,
    number: null,
    count: config.mrkt.inventoryPageSize,
    cursor,
    query: null,
    promotedFirst: false,
    isListed: false,
    removeSelfSales: true,
    isTransferable: true,
  });
}

export async function fetchTopOrder(
  token: string,
  gift: MrktGift,
): Promise<TopOrderResponse | null> {
  const body: Record<string, unknown> = {
    collectionName: gift.collectionName,
  };
  if (gift.modelName) body.modelName = gift.modelName;
  if (gift.backdropName) body.backdropName = gift.backdropName;
  if (gift.symbolName) body.symbolName = gift.symbolName;

  try {
    const top = await mrktPost<TopOrderResponse | null>(token, "/orders/top", body);
    if (!top || !top.id) return null;
    return top;
  } catch {
    return null;
  }
}

export async function fillOrder(
  token: string,
  orderId: string,
  giftIds: string[],
): Promise<void> {
  await mrktPost(token, "/orders/fill", { orderId, giftIds });
}

export async function listForSale(token: string, ids: string[], priceNano: number): Promise<void> {
  await mrktPost(token, "/gifts/sale", { ids, prices: ids.map(() => priceNano) });
}

export async function buyGifts(operatorToken: string, ids: string[]): Promise<void> {
  await mrktPost(operatorToken, "/gifts/buy", { Ids: ids });
}
