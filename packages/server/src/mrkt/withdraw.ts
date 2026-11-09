import { claimPendingDeposits, getWithdrawableHardNano, withdrawTons } from "./client.js";
import { config } from "../config.js";

export type WithdrawResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  wallet: string;
  balanceHardNano?: number;
  withdrawnNano?: number;
};

export async function withdrawAllMrktBalance(token: string): Promise<WithdrawResult> {
  const wallet = config.mrkt.withdrawWallet;

  await claimPendingDeposits(token);

  // Credits from fills can land on balance a moment later.
  for (const ms of [0, 1500, 3000]) {
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
    const hard = await getWithdrawableHardNano(token);
    const amount = hard - config.mrkt.withdrawReserveNano;
    if (amount < config.mrkt.minWithdrawNano) {
      if (ms === 3000) {
        return {
          ok: true,
          skipped: true,
          reason: "balance below minimum",
          wallet,
          balanceHardNano: hard,
          withdrawnNano: 0,
        };
      }
      continue;
    }

    await withdrawTons(token, amount, wallet);
    return {
      ok: true,
      skipped: false,
      wallet,
      balanceHardNano: hard,
      withdrawnNano: amount,
    };
  }

  return { ok: false, skipped: true, reason: "withdraw retry exhausted", wallet };
}
