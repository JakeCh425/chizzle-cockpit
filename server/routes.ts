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
  fetchFinnhubHourlyBars,
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
} from "@shared/schema";
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

      // Overnight moves: latest daily close vs prior daily close, from Stooq.
      const apikey = process.env.STOOQ_APIKEY || "";
      const qs = apikey ? `&apikey=${apikey}` : "";
      const movers = await Promise.all(SCAN_TICKERS.map(async (sym) => {
        try {
          const url = `https://stooq.com/q/d/l/?s=${sym.toLowerCase()}.us&i=d${qs}`;
          const r = await fetch(url);
          if (!r.ok) return { ticker: sym, error: `stooq ${r.status}` };
          const csv = await r.text();
          if (/get_apikey|apikey/i.test(csv) && !/^Date,/m.test(csv)) {
            return { ticker: sym, error: "stooq apikey missing" };
          }
          const lines = csv.trim().split("\n").slice(1);
          // last two valid Close values
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
  const candleCache = new Map<string, { t: number; data: { time: number; close: number; volume?: number }[] }>();
  const CANDLE_TTL = { "1D": 60_000, "1H": 60_000, "30M": 20_000, "5M": 10_000 } as const;
  type Interval = keyof typeof CANDLE_TTL;

  const bucketTicks = (ticks: Array<{ at: string | Date; price: number }>, secondsPerBucket: number) => {
    if (!ticks.length) return [] as { time: number; close: number; volume?: number }[];
    const sorted = [...ticks].sort((a, b) =>
      new Date(a.at as any).getTime() - new Date(b.at as any).getTime()
    );
    const out: { time: number; close: number; volume?: number }[] = [];
    let bucketStart = -1;
    let lastClose = NaN;
    let tickCount = 0; // proxy volume — intraday tick counts per bucket
    for (const tk of sorted) {
      const ts = Math.floor(new Date(tk.at as any).getTime() / 1000);
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
      const interval: Interval = (raw === "1H" || raw === "30M" || raw === "5M") ? raw : "1D";
      const key = `${symbol}:${interval}`;
      const now = Date.now();
      const hit = candleCache.get(key);
      if (hit && (now - hit.t) < CANDLE_TTL[interval]) {
        // Intraday data has its own 60s cap (see CANDLE_TTL definition).
        return res.json(hit.data);
      }

      let data: { time: number; close: number; volume?: number }[] = [];
      let dataSource: "stooq" | "ticks" | "finnhub" | "none" = "none";
      let warning: string | undefined;

      if (interval === "1D" || interval === "1H") {
        const stooqI = interval === "1H" ? "h" : "d";
        const apikey = process.env.STOOQ_APIKEY || "";
        const qs = apikey ? `&apikey=${apikey}` : "";
        const url = `https://stooq.com/q/d/l/?s=${symbol.toLowerCase()}.us&i=${stooqI}${qs}`;
        const r = await fetch(url);
        if (aborted) return;
        if (!r.ok) return res.status(502).json({ error: `stooq ${r.status}` });
        const csv = await r.text();
        if (aborted) return;
        // Stooq returns 200 OK with an error-text body when the apikey is
        // missing or the symbol is unknown. Detect and surface clearly.
        if (/get_apikey|apikey/i.test(csv) && !/^Date,/m.test(csv)) {
          return res.status(502).json({ error: "stooq apikey missing or invalid" });
        }
        const lines = csv.trim().split("\n").slice(1);
        for (const line of lines) {
          // Stooq daily/hourly CSV: Date,Open,High,Low,Close,Volume
          const parts = line.split(",");
          const date = parts[0];
          const close = parts[4];
          const volume = parts[5];
          const ts = Math.floor(new Date(date).getTime() / 1000);
          const c = parseFloat(close);
          const v = parseFloat(volume);
          if (Number.isFinite(c) && Number.isFinite(ts)) {
            data.push({
              time: ts,
              close: c,
              volume: Number.isFinite(v) ? v : undefined,
            });
          }
        }
        // Keep last ~400 bars — plenty for SMA200, small payload.
        data = data.slice(-400);
        dataSource = data.length > 0 ? "stooq" : "none";
        if (interval === "1H" && data.length === 0) {
          // Stooq free tier returns "No data" for US hourly. Try Finnhub as a
          // fallback (resolution=60) before giving up.
          const fnb = await fetchFinnhubHourlyBars(symbol);
          if (aborted) return;
          if (fnb && fnb.length > 0) {
            data = fnb;
            dataSource = "finnhub";
          } else {
            warning = "Hourly bars unavailable on free data tier.";
          }
        }
      } else {
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
      // Backwards compat: existing clients expect a bare array. New clients
      // can opt-in to the rich envelope via ?meta=1.
      candleCache.set(key, { t: now, data });
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

  // ── reset ──────────────────────────────────────────────────────
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

  return httpServer;
}
