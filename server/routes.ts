import type { Express } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { storage } from "./storage";
import {
  startPricePoller,
  snapshot as priceSnapshot,
  getQuote,
  feedStatus,
  addSseClient,
  removeSseClient,
  PUBLIC_SYMBOLS,
  fetchFinnhubBars,
  fetchYahooBars,
  fetchTiingoDailyBars,
  fetchYahooQuote,
  fetchNasdaqQuote,
  fetchNasdaqDailyBars,
  fetchTwelveDataBars,
  fetchTwelveDataOHLCBars,
  fetchYahooBarsOHLC,
  fetchTiingoDailyOHLC,
  fetchTwelveDataDailyOHLC,
} from "./priceService";
import {
  startRegimeScheduler,
  computeAndPersist as recomputeRegime,
  getEffectiveRegime,
} from "./regimeService";
import {
  startSetupScheduler,
  runFullScan,
  detectSetups,
} from "./setupService";
import {
  insertTradeSchema,
  insertAlertSchema,
  insertJournalEntrySchema,
  insertLeapPositionSchema,
  insertSettingsSchema,
  insertTickerSchema,
  insertWatchlistSchema,
  insertEquityHistorySchema,
  insertChizzleScoreSchema,
  insertLeapReserveSchema,
  insertTradePlanSchema,
  insertTradeExecutionSchema,
  TRADE_PLAN_STATUSES,
  insertTradeReviewSchema,
  insertTradeTagSchema,
  TAG_CATEGORIES,
} from "@shared/schema";
import { calcExecutionStats, validateExecution } from "@shared/executions";
import { z, type ZodTypeAny } from "zod";
import { fromZodError } from "zod-validation-error";
import {
  evaluateLifecycle,
  earningsBlocksEntry,
  computeFinalRMultiple,
} from "./tradeLifecycle";
import { decideDiscipline } from "../shared/discipline";

/**
 * Validate `req.body` against a zod schema. On failure, send 400 + a readable
 * error and return null. On success, return the parsed (typed) value.
 *
 * Callers should bail early on null:
 *   const data = validateBody(req, res, mySchema); if (!data) return;
 */
function validateBody<S extends ZodTypeAny>(
  req: { body: unknown },
  res: { status: (n: number) => { json: (b: unknown) => void } },
  schema: S
): z.infer<S> | null {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: fromZodError(parsed.error).message, code: "VALIDATION_FAILED" });
    return null;
  }
  return parsed.data;
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // ── health check (for rebuild.sh + uptime monitoring) ───────────
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      mode: "low-credit",
      schedulersDisabled: true,
      uptime: process.uptime(),
      now: new Date().toISOString(),
    });
  });

  // ── spec review (regime_gate_spec.md) ───────────────────────────
  app.get("/api/spec", (_req, res) => {
    const candidates = [
      path.resolve(process.cwd(), "regime_gate_spec.md"),
      path.resolve(process.cwd(), "../regime_gate_spec.md"),
      path.resolve(__dirname, "../regime_gate_spec.md"),
      "/home/user/workspace/regime_gate_spec.md",
    ];
    for (const p of candidates) {
      try {
        const text = fs.readFileSync(p, "utf8");
        return res.type("text/plain").send(text);
      } catch {}
    }
    res.status(404).type("text/plain").send("Spec file not found. Place regime_gate_spec.md at project root.");
  });

  // ── settings ────────────────────────────────────────────────────
  app.get("/api/settings", async (_req, res) => {
    try { res.json(await storage.getSettings()); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.patch("/api/settings", async (req, res) => {
    const data = validateBody(req, res, insertSettingsSchema.partial());
    if (!data) return;
    try { res.json(await storage.updateSettings(data)); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── tickers ─────────────────────────────────────────────────────
  app.get("/api/tickers", async (_req, res) => {
    try { res.json(await storage.listTickers()); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.patch("/api/tickers/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "invalid id" });
    const data = validateBody(req, res, insertTickerSchema.partial());
    if (!data) return;
    try {
      res.json(await storage.updateTicker(id, data));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/tickers/prices", async (req, res) => {
    try {
      await storage.bulkUpdatePrices(req.body || {});
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/tickers", async (req, res) => {
    try {
      const { symbol, price, tier } = req.body;
      if (!symbol || price == null) return res.status(400).json({ error: "symbol & price required" });
      res.json(await storage.createTickerWithWatchlist(String(symbol).toUpperCase(), Number(price), tier || 2));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.delete("/api/tickers/:id", async (req, res) => {
    try {
      await storage.deleteWatchlistAndTicker(Number(req.params.id));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── watchlist ───────────────────────────────────────────────────
  app.get("/api/watchlist", async (_req, res) => {
    try { res.json(await storage.listWatchlist()); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.patch("/api/watchlist/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "invalid id" });
    const data = validateBody(req, res, insertWatchlistSchema.partial());
    if (!data) return;
    try { res.json(await storage.updateWatchlistItem(id, data)); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/watchlist", async (req, res) => {
    try {
      const sym = String(req.body?.symbol || "").toUpperCase().trim();
      if (!/^[A-Z0-9.\-]{1,12}$/.test(sym)) return res.status(400).json({ error: "invalid symbol" });
      const seedPrice = Number(req.body?.price) || 0;
      const result = await storage.addWatchlistBySymbol(sym, seedPrice);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });
  app.delete("/api/watchlist/:id", async (req, res) => {
    // Soft-archive by default. Pass ?purge=1 to hard-delete from archive.
    try {
      const id = Number(req.params.id);
      if (String(req.query.purge || "") === "1") {
        await storage.purgeWatchlistItem(id);
      } else {
        await storage.removeWatchlistItem(id);
      }
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e?.message || String(e) }); }
  });
  app.get("/api/watchlist/archived", async (_req, res) => {
    try { res.json(await storage.listArchivedWatchlist()); }
    catch (e: any) { res.status(500).json({ error: e?.message || String(e) }); }
  });
  app.post("/api/watchlist/:id/restore", async (req, res) => {
    try { await storage.restoreWatchlistItem(Number(req.params.id)); res.json({ ok: true }); }
    catch (e: any) { res.status(500).json({ error: e?.message || String(e) }); }
  });
  app.post("/api/watchlist/reorder", async (req, res) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : null;
      if (!ids) return res.status(400).json({ error: "ids[] required" });
      await storage.reorderWatchlist(ids);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // ── trades ──────────────────────────────────────────────────────
  // Regime gate helper. Server is the source of truth for trade entry gating.
  async function regimeGateConfig() {
    const eff = getEffectiveRegime();
    const code = eff.code; // "green" | "yellow" | "red"
    const settings = await storage.getSettings();
    const riskPct = code === "green"
      ? settings.riskPctGreen / 100
      : code === "yellow"
        ? settings.riskPctYellow / 100
        : settings.riskPctRed / 100;
    const maxPositions = code === "green"
      ? settings.maxPositionsGreen
      : code === "yellow"
        ? settings.maxPositionsYellow
        : settings.maxPositionsRed;
    const allowedSetups = code === "green"
      ? ["trend_pullback", "breakout"]
      : code === "yellow"
        ? ["trend_pullback"]
        : [];
    const blockedSetups = code === "green"
      ? []
      : code === "yellow"
        ? ["breakout"]
        : ["trend_pullback", "breakout"];
    const aggressionBias = code === "green"
      ? "Add on strength"
      : code === "yellow"
        ? "Trim into strength"
        : "Defense";
    const statusLine = code === "green"
      ? "GREEN LIGHT \u2014 ARMED"
      : code === "yellow"
        ? "STANDBY \u2014 SELECTIVE"
        : "STAND DOWN \u2014 CAPITAL PROTECTION";
    const currentOpenPositions = (await storage.listOpenTrades()).length;
    return {
      effectiveRegime: code,
      source: eff.source,
      riskPct,
      maxPositions,
      allowedSetups,
      blockedSetups,
      aggressionBias,
      statusLine,
      currentOpenPositions,
      positionSlotsRemaining: Math.max(0, maxPositions - currentOpenPositions),
    };
  }

  // Helper: apply exit P&L to equity history + LEAP reserve.
  async function applyExitToEquity(trade: any, exitPrice: number) {
    try {
      const pnl = (Number(exitPrice) - Number(trade.entry)) * Number(trade.shares);
      const settings = await storage.getSettings();
      const newEquity = settings.equity + pnl;
      await storage.updateSettings({ equity: newEquity });
      const history = await storage.listEquityHistory();
      const peak = Math.max(...history.map((h: any) => h.equity), newEquity);
      const dd = peak > 0 ? ((newEquity - peak) / peak) * 100 : 0;
      await storage.appendEquity({ date: new Date().toISOString().slice(0, 10), equity: newEquity, drawdownPct: dd });
      if (pnl > 0) {
        const reserve = await storage.getLeapReserve();
        await storage.updateLeapReserve({ balance: reserve.balance + 0.25 * pnl });
      }
    } catch (_e) { /* ignore */ }
  }

  app.get("/api/trades", async (_req, res) => {
    try { res.json(await storage.listTrades()); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.get("/api/trades/archived", async (_req, res) => {
    try { res.json(await storage.listArchivedTrades()); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // Permanently delete a single archived trade.
  app.delete("/api/trades/:id/forever", async (req, res) => {
    try {
      await storage.deleteTradeForever(Number(req.params.id));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // Permanently delete ALL archived trades.
  app.delete("/api/trades/archived", async (_req, res) => {
    try {
      const n = await storage.deleteAllArchivedTrades();
      res.json({ ok: true, deleted: n });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // Manually trigger the 45-day archive prune (for testing / on-demand).
  app.post("/api/trades/archived/prune", async (req, res) => {
    try {
      const days = Number(req.body?.days) || 45;
      const n = await storage.pruneArchivedOlderThan(days);
      res.json({ ok: true, pruned: n, days });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/trades", async (req, res) => {
    try {
      // Server-side regime gate — source of truth. Frontend gates are UX only.
      const gate = await regimeGateConfig();
      const incomingSetup = String(req.body?.setup || "").toUpperCase();
      const testMode = process.env.VITE_TEST_MODE === "true";

      if (!testMode && gate.effectiveRegime === "red") {
        return res.status(400).json({
          error: "RED regime \u2014 no new entries permitted. Override at Settings \u2192 Regime Engine if intentional.",
          code: "REGIME_RED_BLOCKED",
        });
      }
      if (!testMode && gate.effectiveRegime === "yellow" && incomingSetup === "BREAKOUT") {
        return res.status(400).json({
          error: "YELLOW regime \u2014 breakout setups disabled. Trend-Pullback only.",
          code: "REGIME_YELLOW_BREAKOUT_BLOCKED",
        });
      }
      if (!testMode && gate.currentOpenPositions >= gate.maxPositions) {
        return res.status(400).json({
          error: `Max positions for ${gate.effectiveRegime.toUpperCase()} regime (${gate.maxPositions}) already in use.`,
          code: "REGIME_MAX_POSITIONS",
        });
      }

      // Earnings block — independent of regime. Spec: even GREEN+A blocked when earnings within buffer.
      if (!testMode && earningsBlocksEntry(req.body?.earningsDate, 5)) {
        return res.status(400).json({
          error: `Earnings within 5 calendar days — entry blocked. Wait for the print.`,
          code: "EARNINGS_WINDOW_BLOCKED",
        });
      }

      // Discipline gate — risk_multiplier === 0 must reject.
      const quality = (req.body?.qualityAtEntry || null) as any;
      const disc = decideDiscipline(gate.effectiveRegime as any, quality);
      if (disc.riskMultiplier === 0) {
        return res.status(400).json({
          error: disc.blockedReason || "Discipline gate: zero risk multiplier — setup suppressed.",
          code: "DISCIPLINE_ZERO_RISK",
        });
      }

      // ARM → PENDING. Trade only becomes OPEN once user CONFIRMs they actually
      // placed the order in their broker. No ENTRY event logged until confirm.
      const data = insertTradeSchema.parse({
        ...req.body,
        openedAt: req.body.openedAt || new Date().toISOString(),
        status: "PENDING",
        qualityAtEntry: req.body.qualityAtEntry ?? null,
        riskMultiplierAtEntry: req.body.riskMultiplierAtEntry ?? disc.riskMultiplier,
      });
      const created = await storage.createTrade(data);
      try {
        await storage.createTradeEvent({
          tradeId: created.id,
          kind: "ARMED",
          price: created.entry,
          note: `Armed ${created.ticker} @ ${created.entry} (awaiting broker confirmation)`,
          occurredAt: new Date().toISOString(),
        });
      } catch (_e) { /* ignore */ }
      res.json(created);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ── trade events (audit trail) ─────────────────────────────────────────
  app.get("/api/trades/:id/events", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid id" });
      res.json(await storage.listTradeEvents(id));
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // ── trade lifecycle: evaluate live price + apply decision ─────────────
  // POST { livePrice } → { decision, trade }
  app.post("/api/trades/:id/evaluate-lifecycle", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const livePrice = Number(req.body?.livePrice);
      if (!Number.isFinite(livePrice) || livePrice <= 0) {
        return res.status(400).json({ error: "livePrice must be a positive number" });
      }
      const allTrades = await storage.listTrades();
      const trade = allTrades.find(t => t.id === id);
      if (!trade) return res.status(404).json({ error: "trade not found" });
      if (trade.status !== "OPEN") {
        return res.json({ decision: { action: "NONE", note: "Trade not open." }, trade });
      }
      const decision = evaluateLifecycle(trade, livePrice);
      let updated: any = trade;
      const now = new Date().toISOString();
      switch (decision.action) {
        case "T1_FILL": {
          updated = await storage.applyT1Fill(id, livePrice, decision.newTrailingStop ?? trade.entry);
          await storage.createTradeEvent({ tradeId: id, kind: "T1_FILL", price: trade.t1, note: decision.note, occurredAt: now });
          await storage.createAlert({
            ticker: trade.ticker, type: "T1_FILL", severity: "action",
            message: `${trade.ticker} — ${decision.note}`,
            firedAt: now,
          });
          break;
        }
        case "T2_FILL": {
          const rMult = decision.rMultiple ?? 0;
          updated = await storage.applyT2Fill(id, decision.exitPrice ?? trade.t2 ?? livePrice, rMult);
          await storage.createTradeEvent({ tradeId: id, kind: "T2_FILL", price: decision.exitPrice ?? null, note: decision.note, occurredAt: now });
          await storage.createAlert({
            ticker: trade.ticker, type: "T2_FILL", severity: "action",
            message: `${trade.ticker} — ${decision.note}`,
            firedAt: now,
          });
          // Equity + LEAP reserve update on closed trade.
          await applyExitToEquity(trade, decision.exitPrice ?? trade.t2 ?? livePrice);
          break;
        }
        case "TRAIL_UPDATE": {
          updated = await storage.applyTrailUpdate(id, decision.newTrailingStop, decision.newHighWaterMark);
          await storage.createTradeEvent({ tradeId: id, kind: "TRAIL_UPDATE", price: livePrice, note: decision.note, occurredAt: now });
          break;
        }
        case "STOP_HIT": {
          const exitPx = decision.exitPrice ?? trade.stop;
          const rMult = decision.rMultiple ?? computeFinalRMultiple(trade, exitPx);
          updated = await storage.applyStopHit(id, exitPx, decision.exitReason ?? "Stop hit", rMult);
          await storage.createTradeEvent({ tradeId: id, kind: "STOP_HIT", price: exitPx, note: decision.note, occurredAt: now });
          await storage.createAlert({
            ticker: trade.ticker, type: "STOP_HIT", severity: "critical",
            message: `${trade.ticker} — ${decision.note}`,
            firedAt: now,
          });
          await applyExitToEquity(trade, exitPx);
          break;
        }
        case "NONE":
        default:
          break;
      }
      res.json({ decision, trade: updated });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // ── trade journal patch: emotion / confidence / reflection ────────────
  app.patch("/api/trades/:id/journal", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { confidenceRating, emotionTag, reflection } = req.body || {};
      if (confidenceRating != null && (typeof confidenceRating !== "number" || confidenceRating < 1 || confidenceRating > 10)) {
        return res.status(400).json({ error: "confidenceRating must be 1-10" });
      }
      const allowedEmotions = ["calm", "excited", "anxious", "fomo", "doubt"];
      if (emotionTag != null && !allowedEmotions.includes(String(emotionTag))) {
        return res.status(400).json({ error: `emotionTag must be one of ${allowedEmotions.join(", ")}` });
      }
      const updated = await storage.updateTradeJournal(id, { confidenceRating, emotionTag, reflection });
      if (!updated) return res.status(404).json({ error: "trade not found" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // ── manual full recompute (regime + setups) ─────────────────────
  // Low-credit mode: triggered only by user click; no schedulers run this.
  app.post("/api/recompute-all", async (_req, res) => {
    try {
      const regimeResult = await recomputeRegime({ forceRefresh: true });
      const setupResult = await runFullScan({ forceRefresh: true });
      const state = await storage.getRegimeState();
      const latest = await storage.latestRegimeInputs();
      res.json({
        ok: regimeResult.ok && (setupResult as any).ok !== false,
        regime: { ok: regimeResult.ok, error: regimeResult.error, state, latestInputs: latest, effective: getEffectiveRegime() },
        setups: setupResult,
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.patch("/api/trades/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid id" });
      const body = req.body || {};
      // Sanitize incoming patch so common UI footguns (empty strings, null on
      // NOT NULL columns, stringified numbers) don't blow up Postgres.
      const patch: Record<string, unknown> = {};
      const toNumOrNull = (v: any) => {
        if (v === "" || v === null || v === undefined) return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      const toNum = (v: any) => {
        if (v === "" || v === null || v === undefined) return undefined;
        const n = Number(v);
        return Number.isFinite(n) ? n : undefined;
      };
      // Required numeric columns — only update when a valid number is provided.
      if ("entry" in body) { const n = toNum(body.entry); if (n !== undefined) patch.entry = n; }
      if ("stop" in body) { const n = toNum(body.stop); if (n !== undefined) patch.stop = n; }
      if ("t1" in body) { const n = toNum(body.t1); if (n !== undefined) patch.t1 = n; }
      if ("shares" in body) {
        const n = toNum(body.shares);
        if (n !== undefined && n > 0) patch.shares = Math.round(n * 100) / 100;
      }
      // Nullable numeric column.
      if ("t2" in body) patch.t2 = toNumOrNull(body.t2);
      // Required text/integer columns with defaults — coerce blank to default.
      if ("thesis" in body) {
        patch.thesis = typeof body.thesis === "string" ? body.thesis : "";
      }
      if ("emotionalState" in body) {
        const n = toNum(body.emotionalState);
        if (n !== undefined && n >= 1 && n <= 10) patch.emotionalState = Math.round(n);
      }
      // Setup — accept TREND_PULLBACK or BREAKOUT only.
      if ("setup" in body) {
        const s = String(body.setup || "").toUpperCase();
        if (s === "TREND_PULLBACK" || s === "BREAKOUT") patch.setup = s;
      }
      // Pass-through fields we trust the caller for (lifecycle updates).
      for (const k of ["status", "archived", "confirmedAt", "exitReason", "rMultiple",
        "planFollowed", "lessonTag", "closedAt", "t1Filled", "t1FilledAt",
        "t2Filled", "t2FilledAt", "trailingStop", "trailingStopUpdatedAt",
        "highWaterMark", "exit", "rr", "riskDollars"]) {
        if (k in body) patch[k] = body[k];
      }
      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: "No valid fields to update." });
      }
      // Coherence check — entry === stop would cause infinite R math elsewhere.
      const finalEntry = (patch.entry as number | undefined) ?? undefined;
      const finalStop = (patch.stop as number | undefined) ?? undefined;
      if (finalEntry !== undefined && finalStop !== undefined && finalEntry === finalStop) {
        return res.status(400).json({ error: "Entry and stop cannot be equal." });
      }
      const updated = await storage.updateTrade(id, patch as any);
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // ── PENDING → OPEN: user has placed the order in their broker ───────────
  app.post("/api/trades/:id/confirm", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const trade = await storage.getTrade(id);
      if (!trade) return res.status(404).json({ error: "trade not found" });
      if (trade.status !== "PENDING") {
        return res.status(400).json({ error: `Trade is ${trade.status}, only PENDING trades can be confirmed.` });
      }
      const now = new Date().toISOString();
      const updated = await storage.updateTrade(id, { status: "OPEN", confirmedAt: now } as any);
      await storage.createTradeEvent({
        tradeId: id,
        kind: "ENTRY",
        price: trade.entry,
        note: `Confirmed ${trade.ticker} @ ${trade.entry} (${trade.riskMultiplierAtEntry ?? 1}× risk)`,
        occurredAt: now,
      });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // ── PENDING → DISCARDED + archived: user did not actually place the trade ─
  app.post("/api/trades/:id/discard", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const trade = await storage.getTrade(id);
      if (!trade) return res.status(404).json({ error: "trade not found" });
      if (trade.status !== "PENDING") {
        return res.status(400).json({ error: `Trade is ${trade.status}, only PENDING trades can be discarded.` });
      }
      const updated = await storage.updateTrade(id, { status: "DISCARDED", archived: true } as any);
      await storage.createTradeEvent({
        tradeId: id,
        kind: "DISCARDED",
        price: null,
        note: `Discarded ${trade.ticker} — not placed in broker.`,
        occurredAt: new Date().toISOString(),
      });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // ── archive / restore (soft delete) ─────────────────────────────────────
  app.post("/api/trades/:id/archive", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const updated = await storage.setTradeArchived(id, true);
      if (!updated) return res.status(404).json({ error: "trade not found" });
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/trades/:id/restore", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const updated = await storage.setTradeArchived(id, false);
      if (!updated) return res.status(404).json({ error: "trade not found" });
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // close-trade convenience endpoint
  app.post("/api/trades/:id/close", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { exit, exitReason, planFollowed, lessonTag } = req.body;
      const trade = await storage.updateTrade(id, {
        exit, exitReason, planFollowed, lessonTag,
        status: "CLOSED",
        closedAt: new Date().toISOString(),
      });
      if (!trade) return res.status(404).json({ error: "not found" });

      // R multiple
      const r = trade.entry && trade.stop && trade.exit
        ? (trade.exit - trade.entry) / (trade.entry - trade.stop)
        : 0;
      await storage.updateTrade(id, { rMultiple: r });

      // Update equity history + LEAP reserve on a winning swing
      const pnl = (Number(trade.exit) - Number(trade.entry)) * Number(trade.shares);
      const settings = await storage.getSettings();
      const newEquity = settings.equity + pnl;
      await storage.updateSettings({ equity: newEquity });

      // Equity history snapshot
      const history = await storage.listEquityHistory();
      const peak = Math.max(...history.map(h => h.equity), newEquity);
      const dd = peak > 0 ? ((newEquity - peak) / peak) * 100 : 0;
      await storage.appendEquity({ date: new Date().toISOString().slice(0, 10), equity: newEquity, drawdownPct: dd });

      // 25% of every winning swing → LEAP Reserve
      if (pnl > 0) {
        const reserve = await storage.getLeapReserve();
        await storage.updateLeapReserve({ balance: reserve.balance + 0.25 * pnl });
      }

      res.json(await storage.getTrade(id));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── alerts ──────────────────────────────────────────────────────
  app.get("/api/alerts", async (_req, res) => {
    try { res.json(await storage.listAlerts()); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/alerts", async (req, res) => {
    try {
      const data = insertAlertSchema.parse({ ...req.body, firedAt: req.body.firedAt || new Date().toISOString() });
      res.json(await storage.createAlert(data));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.post("/api/alerts/:id/ack", async (req, res) => {
    try {
      await storage.acknowledgeAlert(Number(req.params.id));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.delete("/api/alerts/:id", async (req, res) => {
    try {
      await storage.deleteAlert(Number(req.params.id));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.delete("/api/alerts", async (_req, res) => {
    try {
      const n = await storage.clearAllAlerts();
      res.json({ ok: true, deleted: n });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Manual SMA20 alert scan — useful for testing or on-demand sweeps.
  // Fires alerts honoring the same cooldown windows as the scheduled engine.
  app.post("/api/alerts/scan-sma20", async (_req, res) => {
    try {
      const { triggerScan } = await import("./sma20Alerts");
      // Don't block the response on the scan — it can take many seconds.
      triggerScan().catch(e => console.warn("[scan-sma20] failed:", e?.message || e));
      res.json({ ok: true, started: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // ── Signal history (Hammer / Engulfing confirmation log) ──────────────
  // Logging endpoints — the UI reads from /api/signal-history. The detector
  // engine writes via storage.createSignalHistory directly.
  app.get("/api/signal-history", async (req, res) => {
    try {
      const limit = req.query.limit ? Math.min(Number(req.query.limit) || 500, 2000) : 500;
      const ticker = typeof req.query.ticker === "string" ? req.query.ticker.toUpperCase() : undefined;
      const rows = await storage.listSignalHistory({ limit, ticker });
      res.json(rows);
    } catch (e: any) { res.status(500).json({ error: e?.message || String(e) }); }
  });

  // Manual scan trigger (useful for testing). Fires confirmation detector
  // across the entire watchlist with the same cooldowns as the scheduled run.
  app.post("/api/signal-history/scan", async (_req, res) => {
    try {
      const { triggerConfirmationScan } = await import("./confirmationDetector");
      triggerConfirmationScan().catch(e => console.warn("[scan-confirm] failed:", e?.message || e));
      res.json({ ok: true, started: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // Scan one symbol on demand — used by the UI's "Scan now" button per ticker.
  app.post("/api/signal-history/scan/:symbol", async (req, res) => {
    try {
      const sym = String(req.params.symbol || "").toUpperCase();
      if (!sym) return res.status(400).json({ error: "symbol required" });
      const { scanSymbol } = await import("./confirmationDetector");
      const saved = await scanSymbol(sym);
      res.json({ ok: true, entry: saved });
    } catch (e: any) { res.status(500).json({ error: e?.message || String(e) }); }
  });

  // Optional admin: clear the history. POST guards against accidental GETs.
  app.delete("/api/signal-history", async (_req, res) => {
    try {
      const n = await storage.clearSignalHistory();
      res.json({ ok: true, deleted: n });
    } catch (e: any) { res.status(500).json({ error: e?.message || String(e) }); }
  });

  // ── Live pattern-forming indicator ────────────────────────────
  // Returns the live status of an in-progress candle for one or all symbols.
  // Designed to be polled every 30-60s by the UI badge.
  app.get("/api/pattern-forming/:symbol", async (req, res) => {
    try {
      const { detectPatternForming } = await import("./patternForming");
      const tf = String(req.query.timeframe || "daily").toLowerCase();
      const timeframe: "daily" | "4h" = tf === "4h" ? "4h" : "daily";
      const status = await detectPatternForming(req.params.symbol, { timeframe });
      res.json(status);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  app.get("/api/pattern-forming", async (req, res) => {
    try {
      const { detectPatternForming } = await import("./patternForming");
      const tf = String(req.query.timeframe || "daily").toLowerCase();
      const timeframe: "daily" | "4h" = tf === "4h" ? "4h" : "daily";
      // Use the user's ACTIVE watchlist (archived rows excluded) so this panel
      // stays in sync with watchlist edits. Watchlist references tickers by id.
      let symbols: string[];
      try {
        const [wl, tickerRows] = await Promise.all([
          storage.listWatchlist(),
          storage.listTickers(),
        ]);
        const tickerMap = new Map<number, string>(
          tickerRows.map((t: any) => [t.id, String(t.symbol).toUpperCase()])
        );
        symbols = wl
          .map((w: any) => tickerMap.get(w.tickerId))
          .filter((s): s is string => !!s);
      } catch {
        symbols = [...PUBLIC_SYMBOLS];
      }
      if (symbols.length === 0) symbols = [...PUBLIC_SYMBOLS];
      const results = await Promise.all(
        symbols.map((s) => detectPatternForming(s, { timeframe }).catch(() => null))
      );
      res.json(results.filter((r) => r !== null));
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // ── Candlestick Confirmation Module ──────────────────────────────
  // Implements the verbatim status state machine: No Valid Trigger Yet /
  // Hammer Forming / Engulfing Forming / Confirmed Hammer / Confirmed Bullish
  // Engulfing / Ready to Trade. Gated by SMA20 pullback band.
  //
  // Query params:
  //   ?timeframe=daily|4h         (default daily)
  //   ?mode=conservative|aggressive (default conservative)
  //   ?band=2.0                   (SMA20 band percent, default 2.0)
  const parseConfirmOpts = (req: any) => {
    const tf = String(req.query.timeframe || "daily").toLowerCase();
    const timeframe: "daily" | "4h" = tf === "4h" ? "4h" : "daily";
    const mode = String(req.query.mode || "conservative").toLowerCase();
    const conservative_mode = mode !== "aggressive";
    const bandRaw = Number(req.query.band);
    // Band ceiling raised from 3.0 → 4.0 to match the wider UI slider (Phase 5.1).
    const sma_band_percent = Number.isFinite(bandRaw) && bandRaw > 0 && bandRaw <= 10 ? bandRaw : 2.0;
    const offbandRaw = String(req.query.offband || "").toLowerCase();
    const allow_off_band = offbandRaw === "true" || offbandRaw === "1";
    return { timeframe, conservative_mode, sma_band_percent, allow_off_band };
  };

  app.get("/api/candle-confirmation/:symbol", async (req, res) => {
    try {
      const { evaluateCandleConfirmation } = await import("./candlestickConfirmation");
      const out = await evaluateCandleConfirmation(req.params.symbol, parseConfirmOpts(req));
      res.json(out);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  app.get("/api/candle-confirmation", async (req, res) => {
    try {
      const { evaluateCandleConfirmation } = await import("./candlestickConfirmation");
      const opts = parseConfirmOpts(req);
      // Use the user's ACTIVE watchlist (archived rows excluded) so this panel
      // stays in sync with watchlist edits. Watchlist references tickers by id,
      // so we resolve via the tickers table.
      let symbols: string[];
      try {
        const [wl, tickerRows] = await Promise.all([
          storage.listWatchlist(),
          storage.listTickers(),
        ]);
        const tickerMap = new Map<number, string>(
          tickerRows.map((t: any) => [t.id, String(t.symbol).toUpperCase()])
        );
        symbols = wl
          .map((w: any) => tickerMap.get(w.tickerId))
          .filter((s): s is string => !!s);
      } catch {
        symbols = [...PUBLIC_SYMBOLS];
      }
      if (symbols.length === 0) symbols = [...PUBLIC_SYMBOLS];
      const results = await Promise.all(
        symbols.map((s) => evaluateCandleConfirmation(s, opts).catch(() => null))
      );
      res.json(results.filter(r => r !== null));
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // ── Bull Bar Monitor (1H pattern) ──────────────────────────────
  app.get("/api/bull-bar-monitor", async (req, res) => {
    try {
      const { evaluateBullBarMonitor, maybeEmitBullBarAlert } = await import("./bullBarMonitor");
      const symbol = String(req.query.symbol || "SMH").toUpperCase();
      const modeRaw = String(req.query.mode || "").toLowerCase();
      const rrRaw = Number(req.query.rr);
      const mode: "conservative" | "aggressive" = modeRaw === "aggressive" ? "aggressive" : "conservative";
      const rr = [2, 3, 4, 5].includes(rrRaw) ? rrRaw : 2;
      const state = await evaluateBullBarMonitor({ symbol, mode, rr });
      const emitted = await maybeEmitBullBarAlert(state);
      res.json({ ...state, alert_emitted: emitted });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // ── Continuation Monitor (V-run / follow-through / SMA20 bounce) ─
  app.get("/api/continuation-monitor", async (req, res) => {
    try {
      const { evaluateContinuationMonitor } = await import("./continuationMonitor");
      const tfRaw = String(req.query.timeframe || "4h").toLowerCase();
      const rrRaw = Number(req.query.rr);
      const minRiskRaw = Number(req.query.min_risk_pct);
      const symbolsRaw = String(req.query.symbols || "SMH,QQQ,SPY,AAPL");
      const timeframe: "1h" | "4h" = tfRaw === "1h" ? "1h" : "4h";
      const rr = ([2, 3, 4, 5].includes(rrRaw) ? rrRaw : 2) as 2 | 3 | 4 | 5;
      const minRiskPercent = Number.isFinite(minRiskRaw) && minRiskRaw > 0 ? minRiskRaw : 1.5;
      const symbols = symbolsRaw.split(",").map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 8);
      const state = await evaluateContinuationMonitor({ symbols, timeframe, rr, minRiskPercent });
      res.json(state);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // ── Multi-Pattern Monitor (1H/4H, 4 patterns, watchlist-wide) ─
  app.get("/api/multi-pattern-monitor", async (req, res) => {
    try {
      const { evaluateMultiPattern } = await import("./multiPatternMonitor");
      const tfRaw = String(req.query.timeframe || "1h").toLowerCase();
      const modeRaw = String(req.query.mode || "").toLowerCase();
      const rrRaw = Number(req.query.rr);
      const symbolsRaw = String(req.query.symbols || "SMH,QQQ,SPY,AAPL");
      const timeframe: "1h" | "4h" = tfRaw === "4h" ? "4h" : "1h";
      const mode: "conservative" | "aggressive" = modeRaw === "aggressive" ? "aggressive" : "conservative";
      const rr = ([2, 3, 4, 5].includes(rrRaw) ? rrRaw : 2) as 2 | 3 | 4 | 5;
      const symbols = symbolsRaw.split(",").map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 8);
      const state = await evaluateMultiPattern({ symbols, timeframe, mode, rr });
      res.json(state);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // ── SMH Hammer Monitor ─────────────────────────────────────────
  app.get("/api/smh-hammer-monitor", async (req, res) => {
    try {
      const { evaluateSmhHammerMonitor, maybeEmitHammerAlert } = await import("./smhHammerMonitor");
      const modeRaw = String(req.query.mode || "").toLowerCase();
      const rrRaw = Number(req.query.rr);
      const mode: "conservative" | "aggressive" = modeRaw === "aggressive" ? "aggressive" : "conservative";
      const rr = [2, 3, 4, 5].includes(rrRaw) ? rrRaw : 2;
      const state = await evaluateSmhHammerMonitor({ mode, rr });
      const emitted = await maybeEmitHammerAlert(state);
      res.json({ ...state, alert_emitted: emitted });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // ── journal ─────────────────────────────────────────────────────
  app.get("/api/journal", async (_req, res) => {
    try { res.json(await storage.listJournal()); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/journal", async (req, res) => {
    const data = validateBody(req, res, insertJournalEntrySchema);
    if (!data) return;
    try {
      res.json(await storage.upsertJournal(data));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── LEAP positions ─────────────────────────────────────────────
  app.get("/api/leap", async (_req, res) => {
    try { res.json(await storage.listLeapPositions()); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/leap", async (req, res) => {
    const data = validateBody(req, res, insertLeapPositionSchema);
    if (!data) return;
    try {
      res.json(await storage.createLeapPosition(data));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.patch("/api/leap/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "invalid id" });
    const data = validateBody(req, res, insertLeapPositionSchema.partial());
    if (!data) return;
    try { res.json(await storage.updateLeapPosition(id, data)); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.delete("/api/leap/:id", async (req, res) => {
    try {
      await storage.deleteLeapPosition(Number(req.params.id));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── LEAP reserve ───────────────────────────────────────────────
  app.get("/api/leap-reserve", async (_req, res) => {
    try { res.json(await storage.getLeapReserve()); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.patch("/api/leap-reserve", async (req, res) => {
    const data = validateBody(req, res, insertLeapReserveSchema.partial());
    if (!data) return;
    try { res.json(await storage.updateLeapReserve(data)); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── equity history ─────────────────────────────────────────────
  app.get("/api/equity-history", async (_req, res) => {
    try { res.json(await storage.listEquityHistory()); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // Equity history accepts a richer body with optional date/drawdownPct, so we
  // validate a lighter schema instead of the full insert (date is auto-filled).
  const equityPostSchema = z.object({
    date: z.string().optional(),
    equity: z.number().finite(),
    drawdownPct: z.number().finite().optional(),
  });
  app.post("/api/equity-history", async (req, res) => {
    const data = validateBody(req, res, equityPostSchema);
    if (!data) return;
    try {
      res.json(await storage.appendEquity({
        date: data.date || new Date().toISOString().slice(0, 10),
        equity: data.equity,
        drawdownPct: data.drawdownPct || 0,
      }));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Chizzle scores ─────────────────────────────────────────────
  app.get("/api/chizzle-scores", async (_req, res) => {
    try { res.json(await storage.listChizzleScores()); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/chizzle-scores", async (req, res) => {
    const data = validateBody(req, res, insertChizzleScoreSchema);
    if (!data) return;
    try { res.json(await storage.upsertChizzleScore(data)); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── regime engine ──────────────────────────────────────────────
  app.get("/api/regime", async (_req, res) => {
    try {
      const state = await storage.getRegimeState();
      const latest = await storage.latestRegimeInputs();
      const eff = getEffectiveRegime();
      res.json({
        state,
        latestInputs: latest || null,
        effective: eff,
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.get("/api/regime/history", async (req, res) => {
    try {
      const days = Math.min(90, Math.max(1, Number(req.query.days || 30)));
      res.json(await storage.listRegimeInputs(days));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/regime/recompute", async (_req, res) => {
    try {
      const result = await recomputeRegime({ forceRefresh: true });
      const state = await storage.getRegimeState();
      const latest = await storage.latestRegimeInputs();
      res.json({ ok: result.ok, error: result.error, state, latestInputs: latest, effective: getEffectiveRegime() });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });
  app.get("/api/regime/gates", async (_req, res) => {
    try { res.json(await regimeGateConfig()); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/regime/override", async (req, res) => {
    try {
      const { enabled, regime } = req.body || {};
      // Capture effective regime BEFORE override change — for shift-bypass alert.
      const prevEff = getEffectiveRegime().code;

      const patch: any = { manualOverride: !!enabled };
      if (enabled && regime) {
        const r = String(regime).toLowerCase();
        if (!["green", "yellow", "red"].includes(r)) {
          return res.status(400).json({ error: "regime must be green|yellow|red" });
        }
        patch.manualOverrideRegime = r;
      }
      await storage.updateRegimeState(patch);
      // Mirror to legacy settings.regime so existing UI keeps in sync.
      const state = await storage.getRegimeState();
      const eff = state.manualOverride && state.manualOverrideRegime
        ? state.manualOverrideRegime
        : state.currentRegime;
      await storage.updateSettings({
        regime: (eff || "yellow").toUpperCase(),
        regimeOverride: !!state.manualOverride,
      });

      // REGIME_SHIFT_BYPASS alert on manual-override-induced effective change.
      try {
        const newEff = getEffectiveRegime().code;
        if (newEff !== prevEff) {
          const openTrades = await storage.listOpenTrades();
          if (openTrades.length > 0) {
            const tickerList = openTrades.map(t => t.ticker).join(", ");
            await storage.createAlert({
              ticker: openTrades[0].ticker,
              type: "REGIME_SHIFT_BYPASS",
              severity: "critical",
              message: `Regime override shifted ${prevEff.toUpperCase()} → ${newEff.toUpperCase()} while holding ${openTrades.length} open position(s): ${tickerList}. Review stops and exposure.`,
              firedAt: new Date().toISOString(),
            });
          }
        }
      } catch (e) { /* ignore */ }

      res.json({ state, effective: getEffectiveRegime() });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── pre-market briefing (one-tap aggregator) ───────────────────
  // Combines regime, overnight % moves vs prior close, and any active
  // setups in entry-zone into a single payload — used by the cockpit's
  // "Pre-Market Scan" button. Zero new external calls beyond what the
  // existing candle/regime endpoints already use (Stooq daily + DB setups).
  app.get("/api/premarket-scan", async (_req, res) => {
    try {
      const SCAN_TICKERS = ["SMH", "QQQ", "SPY", "IWM", "AAPL", "META"] as const;

      // Regime state
      const regimeState = await storage.getRegimeState();
      const effective = getEffectiveRegime();

      // Moves snapshot per ticker. Provider chain:
      //   1. Live in-memory quote (most current intraday price + prevClose)
      //   2. Tiingo daily bars (last 2 EOD closes)
      //   3. Yahoo v8 chart (regularMarketPrice + chartPreviousClose)
      //   4. Stooq CSV (datacenter-blocked but try anyway)
      // The previous build only used Stooq, which 429s/bot-challenges from
      // Render's IP — hence the scanner showing stale data on every Scan Now.
      const apikey = process.env.STOOQ_APIKEY || "";
      const qs = apikey ? `&apikey=${apikey}` : "";
      const movers = await Promise.all(SCAN_TICKERS.map(async (sym) => {
        // 1. Live quote already in memory — fastest, no extra HTTP.
        const live = getQuote(sym);
        if (live && live.price > 0 && live.prevClose > 0) {
          return {
            ticker: sym,
            latestDate: new Date(live.ts * 1000).toISOString().slice(0, 10),
            latestClose: live.price,
            priorClose: live.prevClose,
            pct: ((live.price - live.prevClose) / live.prevClose) * 100,
          };
        }

        // 2. Tiingo daily bars.
        try {
          const bars = await fetchTiingoDailyBars(sym);
          if (bars && bars.length >= 2) {
            const latest = bars[bars.length - 1];
            const prior = bars[bars.length - 2];
            const pct = ((latest.close - prior.close) / prior.close) * 100;
            return {
              ticker: sym,
              latestDate: new Date(latest.time * 1000).toISOString().slice(0, 10),
              latestClose: latest.close,
              priorClose: prior.close,
              pct,
            };
          }
        } catch { /* fall through */ }

        // 3. Nasdaq.com /api/quote (zero-quota, works from Render IPs).
        try {
          const nq = await fetchNasdaqQuote(sym);
          if (nq && nq.price > 0 && nq.prevClose > 0) {
            return {
              ticker: sym,
              latestDate: new Date(nq.ts * 1000).toISOString().slice(0, 10),
              latestClose: nq.price,
              priorClose: nq.prevClose,
              pct: ((nq.price - nq.prevClose) / nq.prevClose) * 100,
            };
          }
        } catch { /* fall through */ }

        // 4. Yahoo v8 chart fallback.
        try {
          const yh = await fetchYahooQuote(sym);
          if (yh && yh.price > 0 && yh.prevClose > 0) {
            return {
              ticker: sym,
              latestDate: new Date(yh.ts * 1000).toISOString().slice(0, 10),
              latestClose: yh.price,
              priorClose: yh.prevClose,
              pct: ((yh.price - yh.prevClose) / yh.prevClose) * 100,
            };
          }
        } catch { /* fall through */ }

        // 5. Stooq CSV (last resort — frequently 403/timeout on Render).
        try {
          const url = `https://stooq.com/q/d/l/?s=${sym.toLowerCase()}.us&i=d${qs}`;
          const r = await fetch(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
              "Accept": "text/csv,text/plain,*/*",
              "Accept-Language": "en-US,en;q=0.9",
              "Referer": "https://stooq.com/",
            },
            signal: AbortSignal.timeout(5000),
          });
          if (!r.ok) return { ticker: sym, error: `stooq ${r.status}` };
          const csv = await r.text();
          if (/get_apikey|apikey/i.test(csv) && !/^Date,/m.test(csv)) {
            return { ticker: sym, error: "stooq apikey missing" };
          }
          const lines = csv.trim().split("\n").slice(1);
          const closes: { date: string; close: number }[] = [];
          for (let i = lines.length - 1; i >= 0 && closes.length < 2; i--) {
            const parts = lines[i].split(",");
            const c = parseFloat(parts[4]);
            if (Number.isFinite(c)) closes.push({ date: parts[0], close: c });
          }
          if (closes.length < 2) return { ticker: sym, error: "insufficient bars" };
          const [latest, prior] = closes;
          const pct = ((latest.close - prior.close) / prior.close) * 100;
          return {
            ticker: sym,
            latestDate: latest.date,
            latestClose: latest.close,
            priorClose: prior.close,
            pct,
          };
        } catch (e: any) {
          return { ticker: sym, error: e?.message || String(e) };
        }
      }));

      // Active setups in entry zone (across ALL tickers — surface broadly).
      // Cockpit uses regimeEligible + state to gate; we surface IN_ZONE/LIVE/ARMED
      // plus any with triggerFired=true.
      const setupRows = await storage.listSetupCandidates();
      const activeSetups = (setupRows || [])
        .filter((r: any) => {
          const s = String(r.state || "").toLowerCase();
          const triggered = r.triggerFired === true;
          const eligible = r.regimeEligible !== false;
          return eligible && (triggered || s === "in_zone" || s === "live" || s === "armed");
        })
        .slice(0, 10)
        .map((r: any) => ({
          ticker: r.ticker,
          state: r.state,
          quality: r.quality || null,
          entryZoneLow: r.entryZoneLow ?? null,
          entryZoneHigh: r.entryZoneHigh ?? null,
          triggerFired: !!r.triggerFired,
        }));

      res.json({
        scannedAt: new Date().toISOString(),
        regime: {
          code: effective.code,
          source: effective.source,
          currentRegime: regimeState?.currentRegime,
          manualOverride: !!regimeState?.manualOverride,
        },
        movers,
        activeSetups,
        dashboardUrl: "https://chizzle-cockpit-duyn.onrender.com",
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // ── live prices (Finnhub) ──────────────────────────────────────
  app.get("/api/prices", (_req, res) => {
    // Only expose the public watchlist symbols; VIXY is an internal regime input.
    const snap = priceSnapshot();
    const out: any = {};
    for (const s of PUBLIC_SYMBOLS) if (snap[s]) out[s] = snap[s];
    res.json(out);
  });
  app.get("/api/prices/stream", (req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    (res as any).flushHeaders?.();
    addSseClient(res);
    const hb = setInterval(() => { try { res.write(`: ping\n\n`); } catch (e) {} }, 20000);
    req.on("close", () => { clearInterval(hb); removeSseClient(res); });
  });
  app.get("/api/prices/:symbol", (req, res) => {
    const q = getQuote(String(req.params.symbol).toUpperCase());
    if (!q) return res.status(404).json({ error: "no quote yet" });
    res.json(q);
  });
  app.get("/api/price-feed-status", (_req, res) => res.json(feedStatus()));

  // ── historical candles for mini-chart widgets ────────────────────
  //
  // Strategy by interval:
  //   1D / 1H  → Stooq (free, no key, full history)
  //   30m / 5m → derived from live tick history we already record in
  //              storage.listPriceTicks() (Finnhub-backed). We bucket ticks
  //              into the requested resolution and emit a close per bucket.
  //
  // In-memory cache keyed by `symbol:interval`; TTL scales with resolution so
  // we never refresh more aggressively than the data can change.
  // Per-key cache: latest fresh fetch (`data`/`t`) + last known good (`stale`/`staleT`).
  // If all upstream providers fail, we serve the stale snapshot (SWR — stale-while-revalidate).
  type CandleEntry = {
    t: number;
    data: { time: number; close: number; volume?: number }[];
    stale?: { time: number; close: number; volume?: number }[];
    staleT?: number;
    staleSrc?: string;
  };
  const candleCache = new Map<string, CandleEntry>();
  // TTL = how long a fresh response is reused before we refetch. Bumped to 1h
  // for 1D (daily bars only change at the close) and 5m for 1H to reduce
  // pressure on rate-limited free providers (Stooq/Yahoo) on Render's IP.
  const CANDLE_TTL = { "1D": 60 * 60_000, "4H": 10 * 60_000, "1H": 5 * 60_000, "30M": 20_000, "5M": 10_000 } as const;
  type Interval = keyof typeof CANDLE_TTL;

  // Disk-backed SWR persistence — critical for daily bars on a single-node free
  // tier. Render restarts the container periodically; without persistence, the
  // SWR stale snapshot is lost and an empty-provider window leaves the UI blank.
  // We persist successful 1D/1H fetches and reload on boot so the UI ALWAYS
  // has something to show.
  const CACHE_DIR = process.env.CANDLE_CACHE_DIR || "/tmp/chizzle-candles";
  const ensureCacheDir = () => {
    try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch {}
  };
  const cachePath = (key: string) => path.join(CACHE_DIR, key.replace(/[:/]/g, "_") + ".json");

  const saveCacheToDisk = (key: string, entry: CandleEntry) => {
    // Only persist 1D/4H/1H (intraday tick buckets are regenerated from live ticks).
    if (!key.endsWith(":1D") && !key.endsWith(":4H") && !key.endsWith(":1H")) return;
    // Only persist when we have real data — never overwrite a good snapshot with empty.
    if (!entry.data || entry.data.length === 0) return;
    try {
      ensureCacheDir();
      fs.writeFileSync(cachePath(key), JSON.stringify(entry), "utf8");
    } catch (e) {
      console.warn(`[candle-cache] failed to persist ${key}:`, (e as Error)?.message || e);
    }
  };

  const loadCacheFromDisk = () => {
    try {
      ensureCacheDir();
      const files = fs.readdirSync(CACHE_DIR);
      let loaded = 0;
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        try {
          const raw = fs.readFileSync(path.join(CACHE_DIR, f), "utf8");
          const entry = JSON.parse(raw) as CandleEntry;
          if (!entry?.data || !Array.isArray(entry.data) || entry.data.length === 0) continue;
          // Key from filename (sym_interval.json -> sym:interval)
          const key = f.replace(/\.json$/, "").replace(/_(1D|4H|1H|30M|5M)$/, ":$1");
          // Mark as stale so the next request triggers a revalidation, but the
          // bars are available immediately.
          candleCache.set(key, {
            t: 0, // forces refresh on next request
            data: entry.data,
            stale: entry.data,
            staleT: entry.t || Date.now(),
            staleSrc: entry.staleSrc || "disk",
          });
          loaded++;
        } catch {}
      }
      if (loaded > 0) console.log(`[candle-cache] restored ${loaded} cached series from disk`);
    } catch (e) {
      console.warn(`[candle-cache] load failed:`, (e as Error)?.message || e);
    }
  };
  loadCacheFromDisk();

  // Bucket recorded ticks into fixed time windows. `ts` is unix seconds (the
  // schema column is `price_ticks.ts: integer`, which holds seconds, not ms).
  const bucketTicks = (ticks: Array<{ ts: number; price: number }>, secondsPerBucket: number) => {
    if (!ticks.length) return [] as { time: number; close: number; volume?: number }[];
    const sorted = [...ticks].sort((a, b) => a.ts - b.ts);
    const out: { time: number; close: number; volume?: number }[] = [];
    let bucketStart = -1;
    let lastClose = NaN;
    let tickCount = 0; // proxy volume — intraday tick counts per bucket
    for (const tk of sorted) {
      const ts = tk.ts;
      const b = Math.floor(ts / secondsPerBucket) * secondsPerBucket;
      if (b !== bucketStart) {
        if (bucketStart !== -1) out.push({ time: bucketStart, close: lastClose, volume: tickCount });
        bucketStart = b;
        tickCount = 0;
      }
      lastClose = tk.price;
      tickCount += 1;
    }
    if (bucketStart !== -1 && Number.isFinite(lastClose)) out.push({ time: bucketStart, close: lastClose, volume: tickCount });
    return out;
  };

  app.get("/api/candles/:symbol", async (req, res) => {
    // Honor client aborts — saves work on rapid interval/symbol switching.
    let aborted = false;
    req.on("close", () => { if (!res.writableEnded) aborted = true; });

    try {
      const symbol = String(req.params.symbol || "").toUpperCase().trim();
      if (!/^[A-Z0-9.\-]{1,12}$/.test(symbol)) return res.status(400).json({ error: "invalid symbol" });
      const raw = String(req.query.interval || "1D").toUpperCase();
      const interval: Interval = (raw === "4H" || raw === "1H" || raw === "30M" || raw === "5M") ? raw : "1D";
      const key = `${symbol}:${interval}`;
      const now = Date.now();
      const hit = candleCache.get(key);
      if (hit && hit.data.length > 0 && (now - hit.t) < CANDLE_TTL[interval]) {
        return res.json(hit.data);
      }

      let data: { time: number; close: number; volume?: number }[] = [];
      let dataSource: "stooq" | "ticks" | "finnhub" | "yahoo" | "tiingo" | "nasdaq" | "twelvedata" | "none" = "none";
      let warning: string | undefined;

      // ── 4H ───────────────────────────────────────────────────────────────────
      // True 4H bars are only available from Twelve Data on the free tier.
      // Skip the entire 1D/1H provider chain for this interval.
      if (interval === "4H") {
        const td = await fetchTwelveDataBars(symbol, "4h");
        if (aborted) return;
        if (td && td.length > 0) {
          data = td;
          dataSource = "twelvedata";
        } else {
          warning = "Twelve Data 4H unavailable (missing API key or rate limit)";
        }
      } else if (interval === "1D" || interval === "1H") {
        // 0a. Try Tiingo first for 1D (preferred when quota is available).
        //     Tiingo free is 500/day on EOD endpoint — shared with IEX poller,
        //     so it's often 429'd. Tiingo free does NOT support intraday, so
        //     1H still falls through to Nasdaq/Stooq/Yahoo/Finnhub.
        if (interval === "1D") {
          const tg = await fetchTiingoDailyBars(symbol);
          if (aborted) return;
          if (tg && tg.length > 0) {
            data = tg;
            dataSource = "tiingo";
          }
        }

        // 0b. Nasdaq.com historical — free, no auth, works from Render IPs.
        //     Critical fallback since Tiingo free quota is tight, Stooq is
        //     bot-challenged, and Yahoo is rate-limited from datacenter IPs.
        if (interval === "1D" && data.length === 0) {
          const nd = await fetchNasdaqDailyBars(symbol);
          if (aborted) return;
          if (nd && nd.length > 0) {
            data = nd;
            dataSource = "nasdaq";
          }
        }

        // 1. Try Stooq next (free, full history). Note: Stooq actively
        //    bot-challenges datacenter IPs (Render/AWS/GCP/etc), returning a
        //    200 OK with HTML containing a JS proof-of-work. Detect and skip.
        const stooqI = interval === "1H" ? "h" : "d";
        const apikey = process.env.STOOQ_APIKEY || "";
        const qs = apikey ? `&apikey=${apikey}` : "";
        const url = `https://stooq.com/q/d/l/?s=${symbol.toLowerCase()}.us&i=${stooqI}${qs}`;
        let stooqOk = data.length > 0; // skip Stooq if Tiingo already filled
        let stooqBlocked = false;
        if (!stooqOk) try {
          // Browser UA + Accept headers — Stooq's bot filter blocks empty/curl
          // UAs from datacenter IPs, returning a JS proof-of-work HTML page.
          // A real browser UA passes the filter for the CSV endpoint.
          // 5s timeout — Stooq's TCP connect occasionally hangs ~22s from
          // datacenter IPs, stalling the candle warmer for minutes. Bail fast.
          const r = await fetch(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
              "Accept": "text/csv,text/plain,*/*",
              "Accept-Language": "en-US,en;q=0.9",
              "Referer": "https://stooq.com/",
            },
            signal: AbortSignal.timeout(5000),
          });
          if (aborted) return;
          if (!r.ok) {
            stooqBlocked = true;
            console.warn(`[candles] Stooq HTTP ${r.status} ${r.statusText} for ${symbol} ${interval}`);
          } else if (r.ok) {
            const csv = await r.text();
            if (aborted) return;
            // Bot-challenge HTML page — Stooq has blocked this IP.
            if (csv.trimStart().startsWith("<")) {
              stooqBlocked = true;
              console.warn(`[candles] Stooq bot-challenged for ${symbol} ${interval}, falling back to Finnhub`);
            } else if (/get_apikey|apikey/i.test(csv) && !/^Date,/m.test(csv)) {
              stooqBlocked = true;
              console.warn(`[candles] Stooq apikey rejected for ${symbol} ${interval}: ${csv.slice(0,150).replace(/\n/g, ' | ')}`);
            } else if (!csv.trim() || csv.trim().split("\n").length < 2) {
              stooqBlocked = true;
              console.warn(`[candles] Stooq returned empty/short body for ${symbol} ${interval}: ${csv.slice(0,150).replace(/\n/g, ' | ')}`);
            } else {
              const lines = csv.trim().split("\n").slice(1);
              for (const line of lines) {
                const parts = line.split(",");
                const date = parts[0];
                const close = parts[4];
                const volume = parts[5];
                const ts = Math.floor(new Date(date).getTime() / 1000);
                const c = parseFloat(close);
                const v = parseFloat(volume);
                if (Number.isFinite(c) && Number.isFinite(ts)) {
                  data.push({ time: ts, close: c, volume: Number.isFinite(v) ? v : undefined });
                }
              }
              data = data.slice(-400);
              if (data.length > 0) {
                stooqOk = true;
                dataSource = "stooq";
              }
            }
          }
        } catch (e) {
          console.warn(`[candles] Stooq fetch error for ${symbol} ${interval}:`, e);
        }

        // 2. Stooq failed or returned nothing — try Yahoo Finance (free, no key,
        //    works from datacenter IPs, supports both daily and hourly).
        let yahooTried = false;
        if (!stooqOk) {
          yahooTried = true;
          const yhi = interval === "1H" ? "1h" : "1d";
          const yh = await fetchYahooBars(symbol, yhi);
          if (aborted) return;
          if (yh && yh.length > 0) {
            data = yh;
            dataSource = "yahoo";
          }
        }

        // 3. Yahoo also empty — last resort Finnhub (free tier: daily only).
        if (!stooqOk && data.length === 0) {
          const fnbRes = interval === "1H" ? "60" : "D";
          const fnb = await fetchFinnhubBars(symbol, fnbRes);
          if (aborted) return;
          if (fnb && fnb.length > 0) {
            data = fnb;
            dataSource = "finnhub";
          } else if (interval === "1H") {
            warning = stooqBlocked
              ? "Stooq blocked our IP and Yahoo/Finnhub returned no hourly data."
              : (yahooTried ? "Hourly bars unavailable from all free providers right now." : "Hourly bars unavailable.");
          } else {
            warning = stooqBlocked
              ? "Stooq blocked our IP and Yahoo/Finnhub returned no daily data."
              : (yahooTried ? "No daily data returned by any free provider." : "No daily data returned.");
          }
        }
      }
      // 1H fallback to tick-bucketing when no upstream provider returned data.
      // Free hourly bars are paywalled across Stooq/Finnhub and Yahoo rate-limits
      // datacenter IPs. Synthesizing from live ticks gives at least intraday
      // coverage instead of an empty chart.
      if (interval === "1H" && data.length === 0) {
        const ticks = await storage.listPriceTicks(symbol, 1000);
        if (aborted) return;
        const synth = bucketTicks(ticks as any, 3600).slice(-400);
        if (synth.length > 0) {
          data = synth;
          dataSource = "ticks";
          warning = "Hourly synthesized from live ticks (free hourly bars are paywalled).";
        }
      }
      if (interval === "30M" || interval === "5M") {
        // Intraday: bucket recorded ticks. 1000 ticks is enough for SMA200 on
        // 5m (≈ several sessions) and well over for 30m.
        const ticks = await storage.listPriceTicks(symbol, 1000);
        if (aborted) return;
        const secs = interval === "30M" ? 1800 : 300;
        data = bucketTicks(ticks as any, secs).slice(-400);
        dataSource = data.length > 0 ? "ticks" : "none";
        if (data.length === 0) {
          const lowCredit = process.env.LOW_CREDIT_MODE === "true";
          warning = lowCredit
            ? "Intraday tick stream paused (LOW_CREDIT_MODE)."
            : "Intraday ticks warming up — populates as the market trades.";
        }
      }

      if (aborted) return;
      // Stale-while-revalidate: if all live providers failed, fall back to
      // the last known good snapshot we ever fetched (any age). Daily/hourly
      // bars from yesterday are still vastly more useful than an empty chart.
      let usedStale = false;
      if (data.length === 0 && hit && hit.stale && hit.stale.length > 0) {
        data = hit.stale;
        dataSource = (hit.staleSrc as typeof dataSource) || "stooq";
        usedStale = true;
        const ageMin = hit.staleT ? Math.round((now - hit.staleT) / 60_000) : 0;
        warning = (warning ? warning + " " : "") + `(showing cached bars from ${ageMin}m ago)`;
      }
      if (data.length > 0) {
        // Update fresh cache; also persist as the new "last known good" for SWR.
        const newEntry: CandleEntry = {
          t: usedStale ? (hit?.t ?? 0) : now,
          data,
          stale: usedStale ? hit?.stale : data,
          staleT: usedStale ? hit?.staleT : now,
          staleSrc: usedStale ? hit?.staleSrc : dataSource,
        };
        candleCache.set(key, newEntry);
        // Persist 1D/1H to disk so a restart never produces a blank chart.
        // saveCacheToDisk is a no-op for intervals other than 1D/1H or empty data.
        if (!usedStale) saveCacheToDisk(key, newEntry);
      }
      if (String(req.query.meta || "") === "1") {
        res.json({ bars: data, source: dataSource, warning, interval, symbol });
      } else {
        res.json(data);
      }
    } catch (e: any) {
      if (aborted) return;
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // ── OHLC candles for candlestick chart rendering ────────────────────────
  // Separate endpoint so the close-only /api/candles contract stays unchanged.
  // For 1D: Yahoo OHLC (free, no key, supports OHLC) → Twelve Data OHLC fallback.
  // For 1H/4H: Twelve Data OHLC → Yahoo OHLC fallback.
  // For 30M/5M: synthesize from recorded ticks (1 trade = 1 OHLC point at that price).
  type OHLC = { time: number; open: number; high: number; low: number; close: number; volume: number };
  const ohlcCache = new Map<string, { t: number; data: OHLC[] }>();
  const OHLC_TTL: Record<string, number> = { "1D": 5 * 60_000, "1H": 2 * 60_000, "4H": 5 * 60_000, "30M": 60_000, "5M": 30_000 };

  const bucketTicksOHLC = (ticks: Array<{ ts: number; price: number }>, secondsPerBucket: number): OHLC[] => {
    if (!ticks.length) return [];
    const sorted = [...ticks].sort((a, b) => a.ts - b.ts);
    const buckets = new Map<number, { o: number; h: number; l: number; c: number; v: number }>();
    for (const tk of sorted) {
      const b = Math.floor(tk.ts / secondsPerBucket) * secondsPerBucket;
      const cur = buckets.get(b);
      if (!cur) buckets.set(b, { o: tk.price, h: tk.price, l: tk.price, c: tk.price, v: 1 });
      else {
        if (tk.price > cur.h) cur.h = tk.price;
        if (tk.price < cur.l) cur.l = tk.price;
        cur.c = tk.price;
        cur.v += 1;
      }
    }
    return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([time, v]) => ({
      time, open: v.o, high: v.h, low: v.l, close: v.c, volume: v.v,
    }));
  };

  app.get("/api/candles-ohlc/:symbol", async (req, res) => {
    let aborted = false;
    req.on("close", () => { if (!res.writableEnded) aborted = true; });
    try {
      const symbol = String(req.params.symbol || "").toUpperCase().trim();
      if (!/^[A-Z0-9.\-]{1,12}$/.test(symbol)) return res.status(400).json({ error: "invalid symbol" });
      const raw = String(req.query.interval || "1D").toUpperCase();
      const interval = (raw === "4H" || raw === "1H" || raw === "30M" || raw === "5M") ? raw : "1D";
      const key = `${symbol}:${interval}`;
      const now = Date.now();
      const hit = ohlcCache.get(key);
      if (hit && hit.data.length > 0 && (now - hit.t) < (OHLC_TTL[interval] || 60_000)) {
        return res.json(hit.data);
      }

      let data: OHLC[] = [];
      if (interval === "1D") {
        // Tiingo first (cheapest, supports full OHLC on the daily endpoint).
        const tg = await fetchTiingoDailyOHLC(symbol);
        if (aborted) return;
        if (tg && tg.length > 0) data = tg;
        // Yahoo OHLC next (free, no key).
        if (data.length === 0) {
          const yh = await fetchYahooBarsOHLC(symbol, "1d");
          if (aborted) return;
          if (yh && yh.length > 0) data = yh;
        }
        // Twelve Data 1day as last resort (counts against TD daily quota).
        if (data.length === 0) {
          const td = await fetchTwelveDataDailyOHLC(symbol);
          if (aborted) return;
          if (td && td.length > 0) data = td;
        }
      } else if (interval === "1H" || interval === "4H") {
        const td = await fetchTwelveDataOHLCBars(symbol, interval === "1H" ? "1h" : "4h");
        if (aborted) return;
        if (td && td.length > 0) data = td;
        if (data.length === 0 && interval === "1H") {
          const yh = await fetchYahooBarsOHLC(symbol, "1h");
          if (aborted) return;
          if (yh && yh.length > 0) data = yh;
        }
      } else if (interval === "30M" || interval === "5M") {
        const ticks = await storage.listPriceTicks(symbol, 1000);
        if (aborted) return;
        const secs = interval === "30M" ? 1800 : 300;
        data = bucketTicksOHLC(ticks as any, secs).slice(-400);
      }

      // SWR fallback for OHLC.
      if (data.length === 0 && hit && hit.data.length > 0) {
        return res.json(hit.data);
      }
      if (data.length > 0) {
        ohlcCache.set(key, { t: now, data });
      }
      res.json(data);
    } catch (e: any) {
      if (aborted) return;
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  app.get("/api/price-ticks/:symbol", async (req, res) => {
    try {
      const limit = Math.min(1000, Math.max(1, Number(req.query.limit || 200)));
      const ticks = await storage.listPriceTicks(String(req.params.symbol).toUpperCase(), limit);
      res.json(ticks);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── setup detector ─────────────────────────────────────────────
  app.get("/api/setups", async (_req, res) => {
    try {
      // Read directly from DB (fast). Detector populates this asynchronously.
      const rows = await storage.listSetupCandidates();
      const grouped: Record<string, any[]> = {};
      for (const r of rows) {
        if (!grouped[r.ticker]) grouped[r.ticker] = [];
        grouped[r.ticker].push(r);
      }
      res.json(grouped);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });
  app.get("/api/setups/transitions", async (req, res) => {
    try {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit || 20)));
      res.json(await storage.getRecentSetupTransitions(limit));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.get("/api/setups/:ticker", async (req, res) => {
    try {
      const ticker = String(req.params.ticker).toUpperCase();
      const rows = await storage.getSetupCandidatesForTicker(ticker);
      res.json(rows);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/setups/recompute", async (req, res) => {
    try {
      const ticker = req.body?.ticker ? String(req.body.ticker).toUpperCase() : null;
      if (ticker) {
        const result = await detectSetups(ticker);
        res.json({ ok: true, ticker, result });
      } else {
        const result = await runFullScan({ forceRefresh: true });
        res.json({ ok: true, ...result });
      }
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // ── alert contacts & log ──────────────────────────────────────────
  app.get("/api/alert-contacts", async (_req, res) => {
    try {
      const rows = await storage.listAlertContacts();
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });
  app.post("/api/alert-contacts", async (req, res) => {
    try {
      const body = req.body || {};
      const channel = String(body.channel || "").toLowerCase();
      const destination = String(body.destination || "").trim();
      if (channel !== "email" && channel !== "sms" && channel !== "telegram") return res.status(400).json({ error: "channel must be 'email', 'sms', or 'telegram'" });
      if (!destination) return res.status(400).json({ error: "destination is required" });
      if (channel === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination)) return res.status(400).json({ error: "invalid email" });
      if (channel === "sms" && !/^\+\d{10,15}$/.test(destination)) return res.status(400).json({ error: "phone must be E.164 format, e.g. +14175551234" });
      if (channel === "telegram" && !/^-?\d+$/.test(destination)) return res.status(400).json({ error: "telegram destination must be a numeric chat_id" });
      const created = await storage.createAlertContact({
        channel,
        destination,
        label: String(body.label || ""),
        enabled: body.enabled !== false,
        triggerForming: body.triggerForming !== false,
        triggerConfirmed: body.triggerConfirmed !== false,
      });
      res.json(created);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });
  app.patch("/api/alert-contacts/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "invalid id" });
      const patch: any = {};
      const b = req.body || {};
      if (typeof b.enabled === "boolean") patch.enabled = b.enabled;
      if (typeof b.triggerForming === "boolean") patch.triggerForming = b.triggerForming;
      if (typeof b.triggerConfirmed === "boolean") patch.triggerConfirmed = b.triggerConfirmed;
      if (typeof b.label === "string") patch.label = b.label;
      const updated = await storage.updateAlertContact(id, patch);
      if (!updated) return res.status(404).json({ error: "not found" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });
  app.delete("/api/alert-contacts/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "invalid id" });
      await storage.deleteAlertContact(id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });
  app.get("/api/alert-log", async (req, res) => {
    try {
      const limit = Math.min(500, parseInt(String(req.query.limit || "100"), 10) || 100);
      const rows = await storage.listAlertLog(limit);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });
  app.delete("/api/alert-log", async (_req, res) => {
    try {
      const n = await storage.clearAlertLog();
      res.json({ ok: true, deleted: n });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });
  app.post("/api/alert-contacts/:id/test", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "invalid id" });
      const all = await storage.listAlertContacts();
      const c = all.find((x: any) => x.id === id);
      if (!c) return res.status(404).json({ error: "not found" });
      const { sendTestAlert } = await import("./alert-dispatcher");
      const result = await sendTestAlert(c.channel as "email" | "sms", c.destination);
      res.json({ ok: result.ok, status: result.status, error: result.error || null });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });
  app.get("/api/alert-config", async (_req, res) => {
    res.json({
      resendConfigured: !!process.env.RESEND_API_KEY,
      twilioConfigured: !!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN && !!process.env.TWILIO_FROM_NUMBER,
      telegramConfigured: !!process.env.TELEGRAM_BOT_TOKEN,
      resendFromEmail: process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev",
      twilioFromNumber: process.env.TWILIO_FROM_NUMBER || null,
    });
  });
  app.get("/api/telegram/chats", async (_req, res) => {
    try {
      const { resolveTelegramChatIds } = await import("./alert-dispatcher");
      const chats = await resolveTelegramChatIds();
      res.json(chats);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // ── reset ─────────────────────────────────────────────────────
  app.post("/api/reset", async (_req, res) => {
    try { await storage.resetAll(); res.json({ ok: true }); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Manual price refresh — fetches one tick per symbol on demand.
  app.post("/api/prices/refresh", async (_req, res) => {
    try {
      const { refreshAllSymbolsOnce } = await import("./priceService");
      const n = await refreshAllSymbolsOnce();
      res.json({ ok: true, refreshed: n });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // Live ticker feed: keep the price poller running so the badge goes LIVE
  // and the watchlist updates without manual refresh. Regime/setup schedulers
  // remain manual (recompute via /api/recompute-all).
  startPricePoller();

  // Auto-prune archived trades older than 45 days. Runs once on boot, then
  // every 24 hours. Safe to no-op when nothing matches.
  const ARCHIVE_RETENTION_DAYS = 45;
  const runArchivePrune = async () => {
    try {
      const n = await storage.pruneArchivedOlderThan(ARCHIVE_RETENTION_DAYS);
      if (n > 0) console.log(`[archive-prune] removed ${n} archived trades > ${ARCHIVE_RETENTION_DAYS} days old`);
    } catch (e: any) {
      console.error("[archive-prune] failed:", e?.message || e);
    }
  };
  runArchivePrune();
  setInterval(runArchivePrune, 24 * 60 * 60 * 1000);

  // Candle pre-warmer: on cold start, the very first burst of client requests
  // hits rate-limited free providers (Stooq's bot-challenge, Yahoo 429) and
  // returns empty. Warm the cache sequentially with long gaps so each symbol
  // has at least one stale-while-revalidate snapshot before the UI asks.
  const warmupSymbols = ["SMH", "QQQ", "SPY", "IWM", "AAPL", "META"];
  const warmupIntervals: Interval[] = ["1D", "1H"];
  const warmCandle = async (symbol: string, interval: Interval) => {
    try {
      // Hit our own endpoint so we exercise the full fallback chain and
      // populate `candleCache` exactly the way client requests do.
      const port = process.env.PORT || "5000";
      const r = await fetch(`http://127.0.0.1:${port}/api/candles/${symbol}?interval=${interval}&meta=1`);
      if (!r.ok) return;
      const j = (await r.json()) as { bars?: unknown[]; source?: string };
      const n = Array.isArray(j.bars) ? j.bars.length : 0;
      if (n > 0) console.log(`[candle-warm] ${symbol} ${interval}: ${n} bars (src=${j.source})`);
    } catch (e) {
      console.warn(`[candle-warm] ${symbol} ${interval} failed:`, (e as Error)?.message || e);
    }
  };
  // Stagger: 6 symbols × 2 intervals = 12 fetches × 3s = 36s total warm-up.
  // Starts 5s after boot so the HTTP server is fully ready.
  setTimeout(() => {
    let i = 0;
    const pairs: Array<[string, Interval]> = [];
    for (const s of warmupSymbols) for (const iv of warmupIntervals) pairs.push([s, iv]);
    const tick = () => {
      if (i >= pairs.length) return;
      const [s, iv] = pairs[i++];
      warmCandle(s, iv).finally(() => setTimeout(tick, 5000));
    };
    tick();
  }, 5000);

  // Heartbeat re-warm every 15 minutes. Without this the SWR cache (1h TTL
  // for 1D, 5min for 1H) eventually expires and a quiet site falls back to
  // an empty response when providers throttle. A staggered re-warm keeps the
  // cache populated continuously, even when nobody is loading the page.
  setInterval(() => {
    const pairs: Array<[string, Interval]> = [];
    for (const s of warmupSymbols) for (const iv of warmupIntervals) pairs.push([s, iv]);
    let i = 0;
    const tick = () => {
      if (i >= pairs.length) return;
      const [s, iv] = pairs[i++];
      warmCandle(s, iv).finally(() => setTimeout(tick, 5000));
    };
    tick();
  }, 15 * 60 * 1000);

  // SMH Hammer Monitor background scan every 90s: evaluates state and emits
  // alerts to signal_history on phase transitions (forming → confirmed → breakout).
  const smhScan = async () => {
    try {
      const { evaluateSmhHammerMonitor, maybeEmitHammerAlert } = await import("./smhHammerMonitor");
      // Run both modes back-to-back so alerts fire for either strategy.
      for (const mode of ["conservative", "aggressive"] as const) {
        const state = await evaluateSmhHammerMonitor({ mode, rr: 2 });
        await maybeEmitHammerAlert(state);
      }
    } catch (e: any) {
      console.warn("[smh-hammer-monitor] scan failed:", e?.message || e);
    }
  };
  setTimeout(smhScan, 20000);
  setInterval(smhScan, 90 * 1000);

  // Bull Bar Monitor background scan every 5 minutes. 1H bars only update once
  // per hour and Twelve Data free has rate limits, so 5 min keeps headroom while
  // still catching forming bars in plenty of time.
  const bullBarSymbols = ["SMH", "QQQ", "SPY", "AAPL"];
  const bullBarScan = async () => {
    try {
      const { evaluateBullBarMonitor, maybeEmitBullBarAlert } = await import("./bullBarMonitor");
      for (const symbol of bullBarSymbols) {
        for (const mode of ["conservative", "aggressive"] as const) {
          const state = await evaluateBullBarMonitor({ symbol, mode, rr: 2 });
          await maybeEmitBullBarAlert(state);
        }
      }
    } catch (e: any) {
      console.warn("[bull-bar-monitor] scan failed:", e?.message || e);
    }
  };
  setTimeout(bullBarScan, 30000);
  setInterval(bullBarScan, 5 * 60 * 1000);

  // ─── Trade Plans (Phase 1 Trade Planner) ──────────────────────────────────────
  app.get("/api/trade-plans", async (req, res) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const rows = await storage.listTradePlans(status);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed to list trade plans" });
    }
  });
  app.post("/api/trade-plans", async (req, res) => {
    try {
      const parsed = insertTradePlanSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: fromZodError(parsed.error).toString() });
      }
      // Enforce maxOpenRiskPct: block save if cumulative planned risk would exceed cap.
      const s = await storage.getSettings();
      const cap = Number(s?.maxOpenRiskPct ?? 6);
      const currentOpen = await storage.sumPlannedOpenRisk();
      const projected = currentOpen + Number(parsed.data.riskPercent || 0);
      if (projected > cap + 1e-6) {
        return res.status(409).json({
          error: `Adding this plan would push planned open risk to ${projected.toFixed(2)}%, above your cap of ${cap.toFixed(2)}%. Cancel or execute an existing plan, or raise the cap in Settings.`,
          code: "OPEN_RISK_CAP_EXCEEDED",
          cap,
          currentOpen,
          projected,
        });
      }
      const created = await storage.createTradePlan(parsed.data);
      res.status(201).json(created);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed to create trade plan" });
    }
  });
  app.patch("/api/trade-plans/:id", async (req, res) => {
    try {
      const statusSchema = z.object({ status: z.enum(TRADE_PLAN_STATUSES) });
      const parsed = statusSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: fromZodError(parsed.error).toString() });
      }
      const updated = await storage.updateTradePlanStatus(req.params.id, parsed.data.status);
      if (!updated) return res.status(404).json({ error: "trade plan not found" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed to update trade plan" });
    }
  });

  // ─── Single trade plan (used by Trade Detail page) ───────────────────────
  app.get("/api/trade-plans/:id", async (req, res) => {
    try {
      const plan = await storage.getTradePlan(req.params.id);
      if (!plan) return res.status(404).json({ error: "trade plan not found" });
      res.json(plan);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed to load trade plan" });
    }
  });

  // ─── Trade Executions (Phase 2) ───────────────────────────────────────────
  app.get("/api/trade-plans/:id/executions", async (req, res) => {
    try {
      const plan = await storage.getTradePlan(req.params.id);
      if (!plan) return res.status(404).json({ error: "trade plan not found" });
      const rows = await storage.listExecutions(req.params.id);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed to list executions" });
    }
  });

  app.post("/api/trade-plans/:id/executions", async (req, res) => {
    try {
      const plan = await storage.getTradePlan(req.params.id);
      if (!plan) return res.status(404).json({ error: "trade plan not found" });

      // Inject tradePlanId from URL so the client can't lie about it.
      const body = { ...(req.body ?? {}), tradePlanId: req.params.id };
      const parsed = insertTradeExecutionSchema.safeParse(body);
      if (!parsed.success) {
        return res.status(400).json({ error: fromZodError(parsed.error).toString() });
      }

      // Server-side defense: re-validate against current execution state.
      const existing = await storage.listExecutions(req.params.id);
      const direction = (plan.direction === "short" ? "short" : "long") as "long" | "short";
      const stats = calcExecutionStats(existing, direction);
      const errMsg = validateExecution(
        {
          executionType: parsed.data.executionType,
          shares: parsed.data.shares,
          price: parsed.data.price,
          fees: parsed.data.fees ?? 0,
        },
        stats,
      );
      if (errMsg) {
        return res.status(400).json({ error: errMsg, code: "EXECUTION_VALIDATION" });
      }

      const created = await storage.createExecution(parsed.data);

      // Re-derive plan status after insert and persist if changed.
      // Manual 'cancelled' is preserved — only auto-update when current status is not 'cancelled'.
      const after = calcExecutionStats([...existing, created], direction);
      let updatedPlan = plan;
      if (plan.status !== "cancelled" && plan.status !== after.derivedStatus) {
        const next = await storage.updateTradePlanStatus(req.params.id, after.derivedStatus);
        if (next) updatedPlan = next;
      }
      res.status(201).json({ execution: created, plan: updatedPlan });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed to create execution" });
    }
  });

  app.delete("/api/trade-plans/:id/executions/:executionId", async (req, res) => {
    try {
      const plan = await storage.getTradePlan(req.params.id);
      if (!plan) return res.status(404).json({ error: "trade plan not found" });
      const ok = await storage.deleteExecution(req.params.executionId, req.params.id);
      if (!ok) return res.status(404).json({ error: "execution not found" });

      // Re-derive plan status after deletion.
      const remaining = await storage.listExecutions(req.params.id);
      const direction = (plan.direction === "short" ? "short" : "long") as "long" | "short";
      const after = calcExecutionStats(remaining, direction);
      let updatedPlan = plan;
      if (plan.status !== "cancelled" && plan.status !== after.derivedStatus) {
        const next = await storage.updateTradePlanStatus(req.params.id, after.derivedStatus);
        if (next) updatedPlan = next;
      }
      res.json({ ok: true, plan: updatedPlan });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed to delete execution" });
    }
  });

  // ═════════════ Phase 3: Reviews & Tags ════════════════════════════

  // ─── Review: GET (returns null if none) ────────────────────────────────────
  app.get("/api/trade-plans/:id/review", async (req, res) => {
    try {
      const plan = await storage.getTradePlan(req.params.id);
      if (!plan) return res.status(404).json({ error: "trade plan not found" });
      const review = await storage.getReviewByPlanId(req.params.id);
      res.json(review ?? null);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed to load review" });
    }
  });

  // ─── Review: PUT upsert ────────────────────────────────────────────────────
  app.put("/api/trade-plans/:id/review", async (req, res) => {
    try {
      const plan = await storage.getTradePlan(req.params.id);
      if (!plan) return res.status(404).json({ error: "trade plan not found" });

      // Phase 3 rule: reviews allowed only after executions exist.
      const execs = await storage.listExecutions(req.params.id);
      if (execs.length === 0) {
        return res.status(400).json({
          error: "Log at least one execution before writing a review.",
          code: "NO_EXECUTIONS",
        });
      }

      const body = { ...req.body, tradePlanId: req.params.id };
      const parsed = insertTradeReviewSchema.safeParse(body);
      if (!parsed.success) {
        return res.status(400).json({ error: fromZodError(parsed.error).toString() });
      }
      const review = await storage.upsertReview(parsed.data);
      res.json(review);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed to save review" });
    }
  });

  // ─── Review tags: list ────────────────────────────────────────────────────
  app.get("/api/trade-plans/:id/review/tags", async (req, res) => {
    try {
      const review = await storage.getReviewByPlanId(req.params.id);
      if (!review) return res.json([]);
      const tags = await storage.listReviewTags(review.id);
      res.json(tags);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed to load review tags" });
    }
  });

  // ─── Review tags: attach (idempotent) ────────────────────────────────────
  app.post("/api/trade-plans/:id/review/tags/:tagId", async (req, res) => {
    try {
      const review = await storage.getReviewByPlanId(req.params.id);
      if (!review) {
        return res.status(400).json({
          error: "Save the review before attaching tags.",
          code: "NO_REVIEW",
        });
      }
      await storage.attachTag(review.id, req.params.tagId);
      const tags = await storage.listReviewTags(review.id);
      res.json({ ok: true, tags });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed to attach tag" });
    }
  });

  // ─── Review tags: detach ───────────────────────────────────────────────
  app.delete("/api/trade-plans/:id/review/tags/:tagId", async (req, res) => {
    try {
      const review = await storage.getReviewByPlanId(req.params.id);
      if (!review) return res.status(404).json({ error: "review not found" });
      await storage.detachTag(review.id, req.params.tagId);
      const tags = await storage.listReviewTags(review.id);
      res.json({ ok: true, tags });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed to detach tag" });
    }
  });

  // ─── Tag library: list (optional ?category=) ───────────────────────────
  app.get("/api/tags", async (req, res) => {
    try {
      const cat = typeof req.query.category === "string" ? req.query.category : undefined;
      if (cat && !(TAG_CATEGORIES as readonly string[]).includes(cat)) {
        return res.status(400).json({ error: "invalid category" });
      }
      const tags = await storage.listTags(cat);
      res.json(tags);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed to load tags" });
    }
  });

  // ─── Tag library: create ───────────────────────────────────────────────
  app.post("/api/tags", async (req, res) => {
    try {
      const parsed = insertTradeTagSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: fromZodError(parsed.error).toString() });
      }
      try {
        const tag = await storage.createTag(parsed.data);
        res.status(201).json(tag);
      } catch (e: any) {
        // Postgres unique violation on (category, lower(name)).
        // Drizzle wraps the original pg error; check both top-level and cause.
        const pgCode = e?.code ?? e?.cause?.code;
        const msg = String(e?.message ?? "") + " " + String(e?.cause?.message ?? "");
        if (pgCode === "23505" || msg.includes("uq_trade_tags_category_name") || msg.includes("duplicate key")) {
          return res.status(409).json({ error: "A tag with that name already exists in this category.", code: "DUPLICATE_TAG" });
        }
        throw e;
      }
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed to create tag" });
    }
  });

  // ─── Tag library: delete (cascades to review_tags) ──────────────────────
  app.delete("/api/tags/:id", async (req, res) => {
    try {
      const ok = await storage.deleteTag(req.params.id);
      if (!ok) return res.status(404).json({ error: "tag not found" });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed to delete tag" });
    }
  });

  // ─── Phase 4: unified analytics feed ──────────────────────────────────
  // Returns closed trades from legacy `trades` + Phase 2/3 lifecycle,
  // pre-joined with executions, reviews, and tags. Date range applied
  // server-side; all other filters applied client-side for instant UI.
  app.get("/api/analytics/trades", async (req, res) => {
    try {
      const fromRaw = typeof req.query.from === "string" ? req.query.from.trim() : "";
      const toRaw   = typeof req.query.to   === "string" ? req.query.to.trim()   : "";
      // Validate YYYY-MM-DD if present. Invalid dates are silently ignored
      // (treated as no filter) to keep the endpoint forgiving.
      const dateRe = /^\d{4}-\d{2}-\d{2}$/;
      const from = dateRe.test(fromRaw) ? fromRaw : undefined;
      const to   = dateRe.test(toRaw)   ? toRaw   : undefined;
      const rows = await storage.listUnifiedClosedTrades({ from, to });
      res.json(rows);
    } catch (e: any) {
      console.error("[analytics] listUnifiedClosedTrades failed:", e);
      res.status(500).json({ error: e?.message || "failed to load analytics trades" });
    }
  });

  // ─── Phase 5: risk governor ────────────────────────────────
  // Open-position risk feed. Calc utilities on the client combine this
  // with /api/settings, /api/analytics/trades, and /api/trade-plans to
  // produce the live RiskStatus object. Soft-warning model — no enforcement
  // happens server-side.
  app.get("/api/risk/open-positions", async (_req, res) => {
    try {
      const rows = await storage.listOpenPositionRisks();
      res.json(rows);
    } catch (e: any) {
      console.error("[risk] listOpenPositionRisks failed:", e);
      res.status(500).json({ error: e?.message || "failed to load open positions" });
    }
  });

  return httpServer;
}
