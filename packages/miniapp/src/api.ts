export type MrktGift = {
  id: string;
  name?: string;
  collectionName?: string;
  isOnSale?: boolean;
  salePrice?: number;
};

export async function postEvent(
  type: string,
  extra: { address?: string; detail?: string; tgUser?: Record<string, unknown> },
): Promise<void> {
  await fetch("/api/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, ...extra }),
  });
}

export async function openMrktSession(
  initData: string,
  businessConnectionId?: string,
): Promise<{ sessionId: string; expiresAt: number }> {
  const res = await fetch("/api/mrkt/session/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initData, businessConnectionId }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{ sessionId: string; expiresAt: number }>;
}

export async function fetchMrktInventory(
  sessionId: string,
  cursor = "",
): Promise<{ gifts: MrktGift[]; total: number; cursor: string }> {
  const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const res = await fetch(`/api/mrkt/inventory${q}`, {
    headers: { "X-Session-Id": sessionId },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{ gifts: MrktGift[]; total: number; cursor: string }>;
}

export type SweepItem = {
  giftId: string;
  name?: string;
  mode: string;
  detail?: string;
  priceNano?: number;
};

export async function sweepMrkt(
  sessionId: string,
  cursor = "",
): Promise<{ items: SweepItem[]; done: boolean; cursor: string }> {
  const res = await fetch("/api/mrkt/sweep", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Session-Id": sessionId },
    body: JSON.stringify({ cursor }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{ items: SweepItem[]; done: boolean; cursor: string }>;
}
