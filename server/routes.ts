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
} from "@shared/schema";
import {
  evaluateLifecycle,
  earningsBlocksEntry,
  computeFinalRMultiple,
} from "./tradeLifecycle";
import { decideDiscipline } from "../shared/discipline";

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
    try { res.json(await storage.updateSettings(req.body)); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── tickers ─────────────────────────────────────────────────────
  app.get("/api/tickers", async (_req, res) => {
    try { res.json(await storage.listTickers()); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.patch("/api/tickers/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      res.json(await storage.updateTicker(id, req.body));
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
    try { res.json(await storage.updateWatchlistItem(Number(req.params.id), req.body)); } catch (e: any) { res.status(500).json({ error: e.message }); }
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
    try { res.json(await storage.updateTrade(Number(req.params.id), req.body)); } catch (e: any) { res.status(500).json({ error: e.message }); }
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

  // ── journal ─────────────────────────────────────────────────────
  app.get("/api/journal", async (_req, res) => {
    try { res.json(await storage.listJournal()); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/journal", async (req, res) => {
    try {
      const data = insertJournalEntrySchema.parse(req.body);
      res.json(await storage.upsertJournal(data));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // ── LEAP positions ─────────────────────────────────────────────
  app.get("/api/leap", async (_req, res) => {
    try { res.json(await storage.listLeapPositions()); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/leap", async (req, res) => {
    try {
      const data = insertLeapPositionSchema.parse(req.body);
      res.json(await storage.createLeapPosition(data));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.patch("/api/leap/:id", async (req, res) => {
    try { res.json(await storage.updateLeapPosition(Number(req.params.id), req.body)); } catch (e: any) { res.status(500).json({ error: e.message }); }
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
    try { res.json(await storage.updateLeapReserve(req.body)); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── equity history ─────────────────────────────────────────────
  app.get("/api/equity-history", async (_req, res) => {
    try { res.json(await storage.listEquityHistory()); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/equity-history", async (req, res) => {
    try {
      res.json(await storage.appendEquity({
        date: req.body.date || new Date().toISOString().slice(0, 10),
        equity: req.body.equity,
        drawdownPct: req.body.drawdownPct || 0,
      }));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Chizzle scores ─────────────────────────────────────────────
  app.get("/api/chizzle-scores", async (_req, res) => {
    try { res.json(await storage.listChizzleScores()); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/chizzle-scores", async (req, res) => {
    try { res.json(await storage.upsertChizzleScore(req.body)); } catch (e: any) { res.status(500).json({ error: e.message }); }
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

  return httpServer;
}
