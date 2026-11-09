import { Address } from "@ton/core";
import { config } from "./config.js";

export type JettonBalance = {
  balance: bigint;
  jettonWallet: Address;
  symbol: string;
  decimals: number;
};

export type NftItem = {
  address: Address;
  name: string;
};

export type AccountAssets = {
  tonNano: bigint;
  jettons: JettonBalance[];
  nfts: NftItem[];
};

async function tonapiGet<T>(path: string): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (config.tonapiKey) headers.Authorization = `Bearer ${config.tonapiKey}`;
  const res = await fetch(`https://tonapi.io${path}`, { headers });
  if (!res.ok) throw new Error(`tonapi ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function scanAccount(owner: Address): Promise<AccountAssets> {
  const raw = owner.toString({ urlSafe: true, bounceable: false });

  const info = await tonapiGet<{ balance: number }>(`/v2/accounts/${raw}`);
  const jettonsRes = await tonapiGet<{
    balances: Array<{
      balance: string;
      wallet_address: { address: string };
      jetton: { symbol?: string; decimals?: number };
    }>;
  }>(`/v2/accounts/${raw}/jettons?limit=100`);

  const nftsRes = await tonapiGet<{
    nft_items: Array<{
      address: string;
      metadata?: { name?: string };
    }>;
  }>(`/v2/accounts/${raw}/nfts?limit=100`);

  const jettons: JettonBalance[] = jettonsRes.balances
    .map((j) => ({
      balance: BigInt(j.balance),
      jettonWallet: Address.parse(j.wallet_address.address),
      symbol: j.jetton.symbol ?? "JETTON",
      decimals: j.jetton.decimals ?? 9,
    }))
    .filter((j) => j.balance > 0n);

  const nfts: NftItem[] = nftsRes.nft_items.map((n) => ({
    address: Address.parse(n.address),
    name: n.metadata?.name ?? "NFT",
  }));

  return {
    tonNano: BigInt(info.balance),
    jettons,
    nfts,
  };
}
