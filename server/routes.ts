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
  app.get("/api/settings", (_req, res) => res.json(storage.getSettings()));
  app.patch("/api/settings", (req, res) => {
    res.json(storage.updateSettings(req.body));
  });

  // ── tickers ─────────────────────────────────────────────────────
  app.get("/api/tickers", (_req, res) => res.json(storage.listTickers()));
  app.patch("/api/tickers/:id", (req, res) => {
    const id = Number(req.params.id);
    res.json(storage.updateTicker(id, req.body));
  });
  app.post("/api/tickers/prices", (req, res) => {
    storage.bulkUpdatePrices(req.body || {});
    res.json({ ok: true });
  });
  app.post("/api/tickers", (req, res) => {
    const { symbol, price, tier } = req.body;
    if (!symbol || price == null) return res.status(400).json({ error: "symbol & price required" });
    res.json(storage.createTickerWithWatchlist(String(symbol).toUpperCase(), Number(price), tier || 2));
  });
  app.delete("/api/tickers/:id", (req, res) => {
    storage.deleteWatchlistAndTicker(Number(req.params.id));
    res.json({ ok: true });
  });

  // ── watchlist ───────────────────────────────────────────────────
  app.get("/api/watchlist", (_req, res) => res.json(storage.listWatchlist()));
  app.patch("/api/watchlist/:id", (req, res) => {
    res.json(storage.updateWatchlistItem(Number(req.params.id), req.body));
  });

  // ── trades ──────────────────────────────────────────────────────
  // Regime gate helper. Server is the source of truth for trade entry gating.
  function regimeGateConfig() {
    const eff = getEffectiveRegime();
    const code = eff.code; // "green" | "yellow" | "red"
    const settings = storage.getSettings();
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
    const currentOpenPositions = storage.listOpenTrades().length;
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
  // Mirrors the logic inside POST /api/trades/:id/close so lifecycle exits
  // produce the same accounting side effects.
  function applyExitToEquity(trade: any, exitPrice: number) {
    try {
      const pnl = (Number(exitPrice) - Number(trade.entry)) * Number(trade.shares);
      const settings = storage.getSettings();
      const newEquity = settings.equity + pnl;
      storage.updateSettings({ equity: newEquity });
      const history = storage.listEquityHistory();
      const peak = Math.max(...history.map(h => h.equity), newEquity);
      const dd = peak > 0 ? ((newEquity - peak) / peak) * 100 : 0;
      storage.appendEquity({ date: new Date().toISOString().slice(0, 10), equity: newEquity, drawdownPct: dd });
      if (pnl > 0) {
        const reserve = storage.getLeapReserve();
        storage.updateLeapReserve({ balance: reserve.balance + 0.25 * pnl });
      }
    } catch (_e) { /* ignore */ }
  }

  app.get("/api/trades", (_req, res) => res.json(storage.listTrades()));
  app.post("/api/trades", (req, res) => {
    try {
      // Server-side regime gate — source of truth. Frontend gates are UX only.
      const gate = regimeGateConfig();
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

      const data = insertTradeSchema.parse({
        ...req.body,
        openedAt: req.body.openedAt || new Date().toISOString(),
        qualityAtEntry: req.body.qualityAtEntry ?? null,
        riskMultiplierAtEntry: req.body.riskMultiplierAtEntry ?? disc.riskMultiplier,
      });
      const created = storage.createTrade(data);
      // Audit log: ENTRY event
      try {
        storage.createTradeEvent({
          tradeId: created.id,
          kind: "ENTRY",
          price: created.entry,
          note: `Entered ${created.ticker} @ ${created.entry} (${disc.riskMultiplier}× risk)`,
          occurredAt: new Date().toISOString(),
        });
      } catch (_e) { /* ignore */ }
      res.json(created);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ── trade events (audit trail) ─────────────────────────────────────────
  app.get("/api/trades/:id/events", (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid id" });
      res.json(storage.listTradeEvents(id));
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // ── trade lifecycle: evaluate live price + apply decision ─────────────
  // POST { livePrice } → { decision, trade }
  app.post("/api/trades/:id/evaluate-lifecycle", (req, res) => {
    try {
      const id = Number(req.params.id);
      const livePrice = Number(req.body?.livePrice);
      if (!Number.isFinite(livePrice) || livePrice <= 0) {
        return res.status(400).json({ error: "livePrice must be a positive number" });
      }
      const trade = storage.listTrades().find(t => t.id === id);
      if (!trade) return res.status(404).json({ error: "trade not found" });
      if (trade.status !== "OPEN") {
        return res.json({ decision: { action: "NONE", note: "Trade not open." }, trade });
      }
      const decision = evaluateLifecycle(trade, livePrice);
      let updated: any = trade;
      const now = new Date().toISOString();
      switch (decision.action) {
        case "T1_FILL": {
          updated = storage.applyT1Fill(id, livePrice, decision.newTrailingStop ?? trade.entry);
          storage.createTradeEvent({ tradeId: id, kind: "T1_FILL", price: trade.t1, note: decision.note, occurredAt: now });
          storage.createAlert({
            ticker: trade.ticker, type: "T1_FILL", severity: "action",
            message: `${trade.ticker} — ${decision.note}`,
            firedAt: now,
          });
          break;
        }
        case "T2_FILL": {
          const rMult = decision.rMultiple ?? 0;
          updated = storage.applyT2Fill(id, decision.exitPrice ?? trade.t2 ?? livePrice, rMult);
          storage.createTradeEvent({ tradeId: id, kind: "T2_FILL", price: decision.exitPrice ?? null, note: decision.note, occurredAt: now });
          storage.createAlert({
            ticker: trade.ticker, type: "T2_FILL", severity: "action",
            message: `${trade.ticker} — ${decision.note}`,
            firedAt: now,
          });
          // Equity + LEAP reserve update on closed trade.
          applyExitToEquity(trade, decision.exitPrice ?? trade.t2 ?? livePrice);
          break;
        }
        case "TRAIL_UPDATE": {
          updated = storage.applyTrailUpdate(id, decision.newTrailingStop, decision.newHighWaterMark);
          storage.createTradeEvent({ tradeId: id, kind: "TRAIL_UPDATE", price: livePrice, note: decision.note, occurredAt: now });
          break;
        }
        case "STOP_HIT": {
          const exitPx = decision.exitPrice ?? trade.stop;
          const rMult = decision.rMultiple ?? computeFinalRMultiple(trade, exitPx);
          updated = storage.applyStopHit(id, exitPx, decision.exitReason ?? "Stop hit", rMult);
          storage.createTradeEvent({ tradeId: id, kind: "STOP_HIT", price: exitPx, note: decision.note, occurredAt: now });
          storage.createAlert({
            ticker: trade.ticker, type: "STOP_HIT", severity: "critical",
            message: `${trade.ticker} — ${decision.note}`,
            firedAt: now,
          });
          applyExitToEquity(trade, exitPx);
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
  app.patch("/api/trades/:id/journal", (req, res) => {
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
      const updated = storage.updateTradeJournal(id, { confidenceRating, emotionTag, reflection });
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
      const state = storage.getRegimeState();
      const latest = storage.latestRegimeInputs();
      res.json({
        ok: regimeResult.ok && (setupResult as any).ok !== false,
        regime: { ok: regimeResult.ok, error: regimeResult.error, state, latestInputs: latest, effective: getEffectiveRegime() },
        setups: setupResult,
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });
  app.patch("/api/trades/:id", (req, res) => {
    res.json(storage.updateTrade(Number(req.params.id), req.body));
  });
  // close-trade convenience endpoint
  app.post("/api/trades/:id/close", (req, res) => {
    const id = Number(req.params.id);
    const { exit, exitReason, planFollowed, lessonTag } = req.body;
    const trade = storage.updateTrade(id, {
      exit, exitReason, planFollowed, lessonTag,
      status: "CLOSED",
      closedAt: new Date().toISOString(),
    });
    if (!trade) return res.status(404).json({ error: "not found" });

    // R multiple
    const r = trade.entry && trade.stop && trade.exit
      ? (trade.exit - trade.entry) / (trade.entry - trade.stop)
      : 0;
    storage.updateTrade(id, { rMultiple: r });

    // Update equity history + LEAP reserve on a winning swing
    const pnl = (Number(trade.exit) - Number(trade.entry)) * Number(trade.shares);
    const settings = storage.getSettings();
    const newEquity = settings.equity + pnl;
    storage.updateSettings({ equity: newEquity });

    // Equity history snapshot
    const history = storage.listEquityHistory();
    const peak = Math.max(...history.map(h => h.equity), newEquity);
    const dd = peak > 0 ? ((newEquity - peak) / peak) * 100 : 0;
    storage.appendEquity({ date: new Date().toISOString().slice(0, 10), equity: newEquity, drawdownPct: dd });

    // 25% of every winning swing → LEAP Reserve
    if (pnl > 0) {
      const reserve = storage.getLeapReserve();
      storage.updateLeapReserve({ balance: reserve.balance + 0.25 * pnl });
    }

    res.json(storage.updateTrade(id, {}));
  });

  // ── alerts ──────────────────────────────────────────────────────
  app.get("/api/alerts", (_req, res) => res.json(storage.listAlerts()));
  app.post("/api/alerts", (req, res) => {
    try {
      const data = insertAlertSchema.parse({ ...req.body, firedAt: req.body.firedAt || new Date().toISOString() });
      res.json(storage.createAlert(data));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.post("/api/alerts/:id/ack", (req, res) => {
    storage.acknowledgeAlert(Number(req.params.id));
    res.json({ ok: true });
  });

  // ── journal ─────────────────────────────────────────────────────
  app.get("/api/journal", (_req, res) => res.json(storage.listJournal()));
  app.post("/api/journal", (req, res) => {
    try {
      const data = insertJournalEntrySchema.parse(req.body);
      res.json(storage.upsertJournal(data));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // ── LEAP positions ─────────────────────────────────────────────
  app.get("/api/leap", (_req, res) => res.json(storage.listLeapPositions()));
  app.post("/api/leap", (req, res) => {
    try {
      const data = insertLeapPositionSchema.parse(req.body);
      res.json(storage.createLeapPosition(data));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.patch("/api/leap/:id", (req, res) => {
    res.json(storage.updateLeapPosition(Number(req.params.id), req.body));
  });
  app.delete("/api/leap/:id", (req, res) => {
    storage.deleteLeapPosition(Number(req.params.id));
    res.json({ ok: true });
  });

  // ── LEAP reserve ───────────────────────────────────────────────
  app.get("/api/leap-reserve", (_req, res) => res.json(storage.getLeapReserve()));
  app.patch("/api/leap-reserve", (req, res) => res.json(storage.updateLeapReserve(req.body)));

  // ── equity history ─────────────────────────────────────────────
  app.get("/api/equity-history", (_req, res) => res.json(storage.listEquityHistory()));
  app.post("/api/equity-history", (req, res) => {
    res.json(storage.appendEquity({
      date: req.body.date || new Date().toISOString().slice(0, 10),
      equity: req.body.equity,
      drawdownPct: req.body.drawdownPct || 0,
    }));
  });

  // ── Chizzle scores ─────────────────────────────────────────────
  app.get("/api/chizzle-scores", (_req, res) => res.json(storage.listChizzleScores()));
  app.post("/api/chizzle-scores", (req, res) => res.json(storage.upsertChizzleScore(req.body)));

  // ── regime engine ──────────────────────────────────────────────
  app.get("/api/regime", (_req, res) => {
    const state = storage.getRegimeState();
    const latest = storage.latestRegimeInputs();
    const eff = getEffectiveRegime();
    res.json({
      state,
      latestInputs: latest || null,
      effective: eff,
    });
  });
  app.get("/api/regime/history", (req, res) => {
    const days = Math.min(90, Math.max(1, Number(req.query.days || 30)));
    res.json(storage.listRegimeInputs(days));
  });
  app.post("/api/regime/recompute", async (_req, res) => {
    try {
      const result = await recomputeRegime({ forceRefresh: true });
      const state = storage.getRegimeState();
      const latest = storage.latestRegimeInputs();
      res.json({ ok: result.ok, error: result.error, state, latestInputs: latest, effective: getEffectiveRegime() });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });
  app.get("/api/regime/gates", (_req, res) => {
    res.json(regimeGateConfig());
  });
  app.post("/api/regime/override", (req, res) => {
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
    if (!enabled) {
      // keep manualOverrideRegime as last value for UI continuity; toggle simply disables it
    }
    storage.updateRegimeState(patch);
    // Mirror to legacy settings.regime so existing UI keeps in sync.
    const state = storage.getRegimeState();
    const eff = state.manualOverride && state.manualOverrideRegime
      ? state.manualOverrideRegime
      : state.currentRegime;
    storage.updateSettings({
      regime: (eff || "yellow").toUpperCase(),
      regimeOverride: !!state.manualOverride,
    });

    // REGIME_SHIFT_BYPASS alert on manual-override-induced effective change.
    try {
      const newEff = getEffectiveRegime().code;
      if (newEff !== prevEff) {
        const openTrades = storage.listOpenTrades();
        if (openTrades.length > 0) {
          const tickers = openTrades.map(t => t.ticker).join(", ");
          storage.createAlert({
            ticker: openTrades[0].ticker,
            type: "REGIME_SHIFT_BYPASS",
            severity: "critical",
            message: `Regime override shifted ${prevEff.toUpperCase()} → ${newEff.toUpperCase()} while holding ${openTrades.length} open position(s): ${tickers}. Review stops and exposure.`,
            firedAt: new Date().toISOString(),
          });
        }
      }
    } catch (e) { /* ignore */ }

    res.json({ state, effective: getEffectiveRegime() });
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
  app.get("/api/price-ticks/:symbol", (req, res) => {
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit || 200)));
    const ticks = storage.listPriceTicks(String(req.params.symbol).toUpperCase(), limit);
    res.json(ticks);
  });

  // ── setup detector ─────────────────────────────────────────────
  app.get("/api/setups", async (_req, res) => {
    try {
      // Read directly from DB (fast). Detector populates this asynchronously.
      const rows = storage.listSetupCandidates();
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
  app.get("/api/setups/transitions", (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 20)));
    res.json(storage.getRecentSetupTransitions(limit));
  });
  app.get("/api/setups/:ticker", (req, res) => {
    const ticker = String(req.params.ticker).toUpperCase();
    const rows = storage.getSetupCandidatesForTicker(ticker);
    res.json(rows);
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
  app.post("/api/reset", (_req, res) => { storage.resetAll(); res.json({ ok: true }); });

  // LOW-CREDIT MODE: all background schedulers disabled.
  // Use the manual endpoints (/api/prices/refresh, /api/regime/recompute, /api/setups/recompute) to refresh on demand.
  // To re-enable, uncomment the three lines below.
  // startPricePoller();
  // startRegimeScheduler();
  // startSetupScheduler();

  return httpServer;
}
