import { describe, it, expect, vi } from "vitest";
process.env.DATABASE_URL ||= "postgres://x:y@127.0.0.1:1/none";
import { tradeMath, softWarnings, closeMath, unrealizedR, sharesForRisk, canTransition, editedFields, armTradeSchema } from "../../shared/swingTrades";

// ─── pure math ───────────────────────────────────────────────────────────────
describe("tradeMath — planned R uses Stop Loss, never Stop Limit", () => {
  it("computes risk, R:R and dollars from entry/stop/shares", () => {
    const m = tradeMath({ entry: 100, stop: 95, stopLimit: 94.5, t1: 110, t2: 115, shares: 10 });
    expect(m.problems).toEqual([]);
    expect(m.riskPerShare).toBe(5); expect(m.riskDollars).toBe(50); expect(m.rrT1).toBe(2); expect(m.rrT2).toBe(3);
    expect(m.rewardT1Dollars).toBe(100); expect(m.positionDollars).toBe(1000);
    // Changing the stop limit must not change R.
    expect(tradeMath({ entry: 100, stop: 95, stopLimit: 90, t1: 110, shares: 10 }).riskPerShare).toBe(5);
  });
  it("flags impossible levels as hard problems", () => {
    const m = tradeMath({ entry: 100, stop: 101, t1: 99, t2: 98, stopLimit: 102, shares: -1 });
    expect(m.problems.join(" ")).toMatch(/Stop loss must be below/); expect(m.problems.join(" ")).toMatch(/Target 1 must be above/);
    expect(m.problems.join(" ")).toMatch(/Target 2 must be above/); expect(m.problems.join(" ")).toMatch(/Stop limit must be below/); expect(m.problems.join(" ")).toMatch(/Shares/);
    expect(m.rrT1).toBeNull();
  });
  it("sharesForRisk floors and handles a too-wide stop", () => {
    expect(sharesForRisk(100, 95, 65)).toBe(13); expect(sharesForRisk(100, 30, 65)).toBe(0); expect(sharesForRisk(100, 100, 65)).toBe(0);
  });
});

describe("softWarnings — soft, never blocking", () => {
  const base = { equity: 10_000, maxDailyLossAmount: 65, maxWeeklyLossAmount: 150, maxDrawdownPercent: 15, maxOpenRiskPercent: 6, openRiskDollars: 0, dailyPnl: 0, weeklyPnl: 0, drawdownPercent: 0 };
  const m = tradeMath({ entry: 100, stop: 95, t1: 110, shares: 10 }); // $50 risk
  it("is quiet for a normal plan", () => { expect(softWarnings(m, base)).toEqual([]); });
  it("warns when a stop-out would cross the daily / weekly limits", () => {
    const ids = softWarnings(m, { ...base, dailyPnl: -20, weeklyPnl: -110 }).map((w) => w.id);
    expect(ids).toContain("DAILY"); expect(ids).toContain("WEEKLY");
  });
  it("warns about open-risk cap and drawdown heads-up (>12%) vs max (15%)", () => {
    expect(softWarnings(m, { ...base, openRiskDollars: 580 }).map((w) => w.id)).toContain("OPEN_RISK"); // (580+50)/10000 = 6.3%
    expect(softWarnings(m, { ...base, drawdownPercent: -12.5 }).find((w) => w.id === "DRAWDOWN_HEADS_UP")?.severity).toBe("warn");
    expect(softWarnings(m, { ...base, drawdownPercent: -15 }).find((w) => w.id === "DRAWDOWN")?.severity).toBe("high");
    expect(softWarnings(m, { ...base, drawdownPercent: -11 }).map((w) => w.id)).not.toContain("DRAWDOWN_HEADS_UP");
  });
  it("flags low R:R", () => { expect(softWarnings(tradeMath({ entry: 100, stop: 95, t1: 106, shares: 1 }), base).map((w) => w.id)).toContain("LOW_RR"); });
});

describe("closeMath / unrealizedR / transitions", () => {
  it("P&L and R use the fill price against the planned stop", () => {
    expect(closeMath({ entry: 100, stop: 95, shares: 10, fillPrice: 101 }, 111)).toEqual({ pnl: 100, rMultiple: 1.67 });
    expect(closeMath({ entry: 100, stop: 95, shares: 10, fillPrice: null }, 95)).toEqual({ pnl: -50, rMultiple: -1 });
    expect(unrealizedR({ entry: 100, stop: 95, fillPrice: 100 }, 105)).toBe(1); expect(unrealizedR({ entry: 100, stop: 95, fillPrice: 100 }, null)).toBeNull();
  });
  it("only ARMED→ACTIVE|CANCELLED and ACTIVE→CLOSED are legal", () => {
    expect(canTransition("ARMED", "ACTIVE")).toBe(true); expect(canTransition("ARMED", "CANCELLED")).toBe(true); expect(canTransition("ARMED", "CLOSED")).toBe(false);
    expect(canTransition("ACTIVE", "CLOSED")).toBe(true); expect(canTransition("ACTIVE", "CANCELLED")).toBe(false); expect(canTransition("CLOSED", "ACTIVE")).toBe(false);
  });
  it("editedFields compares against the engine's original levels", () => {
    expect(editedFields({ entry: 100, stop: 96, stopLimit: null, t1: 110, t2: null, shares: 10, originalLevels: { entry: 100, stop: 95, t1: 110, shares: 10 } })).toEqual(["stop"]);
  });
  it("armTradeSchema rejects non-positive prices", () => { expect(() => armTradeSchema.parse({ symbol: "QQQ", entry: 0, stop: 1, t1: 2, shares: 1 })).toThrow(); });
});

// ─── Express end-to-end with an in-memory store (no Neon) ────────────────────
const journalRows: any[] = []; let nextJ = 1;
vi.mock("../../server/storage", () => ({ db: {}, pool: {} }));
vi.mock("../../server/swing/service", () => ({
  CHART_RANGES: [], CHART_TFS: [], chartBars: vi.fn(), loadSettings: vi.fn(async () => ({ watchlist: [{ symbol: "QQQ", exchange: "NASDAQ" }] })),
  readDataEvents: vi.fn(), readLog: vi.fn(), refreshStatus: vi.fn(), runPlanAnalysis: vi.fn(), saveSettings: vi.fn(), scan: vi.fn(),
  settingsPatchSchema: { parse: (x: any) => x }, startSwingScheduler: vi.fn(), onScanPriority: vi.fn(),
  decisionFor: vi.fn(async (symbol: string) => ({ symbol, setupType: "PULLBACK_CONTINUATION", cardGrade: "A", setupTimeframe: "4H", entryPrice: 100, structuralStop: 95, target1: 110, target2: 115, riskPerShare: 5, suggestedShares: 10, chart: { history: [] } })),
}));
vi.mock("../../server/swing/readyAlerts", () => ({ sendTestTelegram: vi.fn(), startReadyAlerts: vi.fn() }));
vi.mock("../../server/swing/alerts", () => ({ ackEvent: vi.fn(), confirmVerification: vi.fn(), contactsWithStatus: vi.fn(), createAlert: vi.fn(), deleteAlert: vi.fn(), listAlerts: vi.fn(), listEvents: vi.fn(), loadPrefs: vi.fn(), savePrefs: vi.fn(), sendVerification: vi.fn(), setAlertActive: vi.fn(), startAlertLoop: vi.fn(), tickAlerts: vi.fn() }));
vi.mock("../../server/swing/plans", () => ({ listVersions: vi.fn(), planContext: vi.fn(), saveVersion: vi.fn(), selectVersion: vi.fn(), selectedVersions: vi.fn() }));
vi.mock("../../server/swing/universe", () => ({ addItem: vi.fn(), patchItem: vi.fn(), removeItem: vi.fn(), resolveSymbol: vi.fn(), restoreDefaults: vi.fn(), riskNote: vi.fn(), WatchlistError: class extends Error { code = 400 }, yahooSearch: vi.fn() }));
vi.mock("../../server/swing/perf", () => ({ perfSummary: vi.fn(), recentSpans: vi.fn() }));
vi.mock("../../server/featureFlags", () => ({ isUnifiedSwingEnabled: () => process.env.ENABLE_UNIFIED_SWING_ENGINE === "true" }));
vi.mock("../../server/swing/journal", async (orig) => {
  const m: any = await orig();
  return { ...m, listJournal: vi.fn(async () => journalRows.slice().reverse()),
    createJournalEntry: (raw: unknown, deps: any) => m.createJournalEntry(raw, { ...deps, budgetMs: 100, latest: async () => undefined, insert: async (row: any) => { const r = { id: nextJ++, createdAt: new Date().toISOString(), ...row }; journalRows.push(r); return r; } }) };
});

function memoryStore() {
  const trades: any[] = [], events: any[] = []; let id = 1, eid = 1;
  return {
    trades, events,
    ensure: async () => {},
    insert: async (v: any) => { const r = { id: id++, exchange: "", status: "ARMED", setupKey: null, setupType: null, timeframe: null, stopLimit: null, t2: null, shares: 0, riskDollars: 0, rrT1: null, notes: "", originalLevels: {}, decisionSnapshot: {}, overrideReason: null, fillPrice: null, filledAt: null, exitPrice: null, exitReason: null, closedAt: null, pnl: null, rMultiple: null, cancelledAt: null, armedAt: new Date(), updatedAt: new Date(), ...v }; trades.push(r); return r; },
    update: async (tid: number, v: any) => { const r = trades.find((t) => t.id === tid); if (r) Object.assign(r, v); return r; },
    get: async (tid: number) => trades.find((t) => t.id === tid),
    list: async (o: any) => trades.filter((t) => (!o.status?.length || o.status.includes(t.status)) && (!o.symbol || t.symbol === o.symbol.toUpperCase())).slice(0, o.limit ?? 500),
    insertEvent: async (v: any) => { events.push({ id: eid++, before: null, after: null, note: "", at: new Date(), ...v }); },
    listEvents: async (tid: number) => events.filter((e) => e.tradeId === tid).slice().reverse(),
  };
}

describe("practice trades — Express lifecycle ARMED → ACTIVE → CLOSED (+ journal auto-entries)", async () => {
  process.env.ENABLE_UNIFIED_SWING_ENGINE = "true";
  const express = (await import("express")).default;
  const { registerSwingRoutes } = await import("../../server/swing/routes");
  const trades = await import("../../server/swing/trades");
  const store = memoryStore();
  const app = express(); app.use(express.json()); registerSwingRoutes(app);
  trades.configureTrades({ store, now: () => new Date("2026-10-09T15:00:00Z") });
  const srv = await new Promise<any>((res) => { const s = app.listen(0, () => res(s)); });
  const base = `http://127.0.0.1:${(srv.address() as any).port}`;
  const send = (method: string, path: string, body?: unknown) => fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const armBody = { symbol: "qqq", exchange: "NASDAQ", setupType: "PULLBACK_CONTINUATION", timeframe: "4H", entry: 100, stop: 95, stopLimit: 94.9, t1: 110, t2: 115, shares: 10, notes: "first practice plan", originalLevels: { entry: 100, stop: 94, t1: 110, t2: 115, shares: 12 }, decisionSnapshot: { setupStatus: "READY_TO_TRADE" } };

  it("has no broker/order endpoints", () => {
    const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "../../server/swing/routes.ts"), "utf8");
    const paths = [...src.matchAll(/app\.(?:get|post|patch|put|delete)\("([^"]+)"/g)].map((m) => m[1]);
    expect(paths.some((p) => /order|broker|execute/i.test(p))).toBe(false);
    expect(paths).toContain("/api/swing/trades");
  });
  it("arms: computes risk/R:R from stop (not stop limit), stores originals, writes ARMED event + journal entry", async () => {
    const r = await send("POST", "/api/swing/trades", armBody); expect(r.status).toBe(200);
    const { trade } = await r.json();
    expect(trade.symbol).toBe("QQQ"); expect(trade.status).toBe("ARMED"); expect(trade.riskDollars).toBe(50); expect(trade.rrT1).toBe(2);
    expect(trade.originalLevels).toEqual(armBody.originalLevels); expect(trade.decisionSnapshot.setupStatus).toBe("READY_TO_TRADE");
    const ev = await (await send("GET", `/api/swing/trades/${trade.id}/events`)).json();
    expect(ev.events.map((e: any) => e.kind)).toEqual(["ARMED"]);
    expect(journalRows.at(-1)).toMatchObject({ action: "ARMED", symbol: "QQQ", tradeId: trade.id, entry: 100, stop: 95, plannedRisk: 50 });
  });
  it("refuses a second open trade for the same symbol (409) and bad levels (400)", async () => {
    expect((await send("POST", "/api/swing/trades", armBody)).status).toBe(409);
    expect((await send("POST", "/api/swing/trades", { ...armBody, symbol: "SPY", stop: 101 })).status).toBe(400);
  });
  it("edit from card or My Trades: same row, EDITED event with before/after, journal untouched", async () => {
    const before = journalRows.length;
    const r = await send("PATCH", "/api/swing/trades/1", { stop: 96, reason: "raised under swing low" }); expect(r.status).toBe(200);
    const { trade } = await r.json(); expect(trade.stop).toBe(96); expect(trade.riskDollars).toBe(40); expect(trade.rrT1).toBe(2.5);
    const ev = (await (await send("GET", "/api/swing/trades/1/events")).json()).events;
    expect(ev[0].kind).toBe("EDITED"); expect(ev[0].before.stop).toBe(95); expect(ev[0].after.stop).toBe(96); expect(ev[0].note).toMatch(/raised under swing low/);
    expect(journalRows.length).toBe(before);
  });
  it("summary + open-positions feed: ARMED counts as planned open risk, not yet an open position", async () => {
    const s = await (await send("GET", "/api/swing/trades/summary")).json();
    expect(s).toMatchObject({ armed: 1, active: 0, openRiskDollars: 40, dailyPnl: 0 });
    expect(await trades.openPositionRisks()).toEqual([]);
  });
  it("fill → ACTIVE (journal FILLED), appears in open-positions with fill-based risk; close is refused while ARMED", async () => {
    expect((await send("POST", "/api/swing/trades/1/close", { exitPrice: 105, exitReason: "MANUAL" })).status).toBe(409);
    const r = await send("POST", "/api/swing/trades/1/fill", { fillPrice: 100.5 }); expect(r.status).toBe(200);
    const { trade } = await r.json(); expect(trade.status).toBe("ACTIVE"); expect(trade.fillPrice).toBe(100.5);
    expect(journalRows.at(-1)).toMatchObject({ action: "FILLED", tradeId: 1 });
    const op = await trades.openPositionRisks();
    expect(op).toEqual([{ id: "swing:1", ticker: "QQQ", direction: "long", avgFillPrice: 100.5, stopPrice: 96, openShares: 10, riskDollars: 45, source: "swing" }]);
    expect((await send("PATCH", "/api/swing/trades/1", { entry: 99 })).status).toBe(400); // entry locked once filled
  });
  it("close → CLOSED with P&L and R (fill vs stop), journal CLOSED, analytics row, summary P&L", async () => {
    const r = await send("POST", "/api/swing/trades/1/close", { exitPrice: 109.5, exitReason: "T1", note: "took T1" }); expect(r.status).toBe(200);
    const { trade } = await r.json();
    expect(trade.status).toBe("CLOSED"); expect(trade.pnl).toBe(90); expect(trade.rMultiple).toBe(2); // (109.5-100.5)/(100.5-96)
    expect(journalRows.at(-1)).toMatchObject({ action: "CLOSED", tradeId: 1 });
    const rows = await trades.closedUnifiedRows();
    expect(rows[0]).toMatchObject({ id: "swing:1", source: "swing", ticker: "QQQ", netPnl: 90, rMultiple: 2, plannedRiskDollars: 40, status: "closed" });
    const s = await (await send("GET", "/api/swing/trades/summary")).json();
    expect(s).toMatchObject({ armed: 0, active: 0, openRiskDollars: 0, dailyPnl: 90, weeklyPnl: 90, closedToday: 1 });
    expect((await send("PATCH", "/api/swing/trades/1", { stop: 97 })).status).toBe(409); // closed trades keep their record
  });
  it("cancel path: ARMED → CANCELLED with journal entry; cannot cancel twice", async () => {
    const { trade } = await (await send("POST", "/api/swing/trades", { ...armBody, symbol: "SPY" })).json();
    const r = await send("POST", `/api/swing/trades/${trade.id}/cancel`, { note: "setup failed" }); expect(r.status).toBe(200);
    expect((await r.json()).trade.status).toBe("CANCELLED");
    expect(journalRows.at(-1)).toMatchObject({ action: "CANCELLED", symbol: "SPY", tradeId: trade.id });
    expect((await send("POST", `/api/swing/trades/${trade.id}/cancel`, {})).status).toBe(409);
    const list = await (await send("GET", "/api/swing/trades?status=CLOSED,CANCELLED")).json();
    expect(list.trades.map((t: any) => t.status).sort()).toEqual(["CANCELLED", "CLOSED"]); expect(list.note).toMatch(/PRACTICE ONLY/);
  });
  it("override reason is stored and journaled when arming a non-READY setup", async () => {
    const { trade } = await (await send("POST", "/api/swing/trades", { ...armBody, symbol: "XLE", overrideReason: "learning exercise", decisionSnapshot: { setupStatus: "CONFIRMED" } })).json();
    expect(trade.overrideReason).toBe("learning exercise"); expect(journalRows.at(-1).notes).toMatch(/override: learning exercise/);
  });
  it("is 404 when the flag is off (no new surface in flag-off mode)", async () => {
    process.env.ENABLE_UNIFIED_SWING_ENGINE = "false";
    expect((await send("GET", "/api/swing/trades")).status).toBe(404);
    process.env.ENABLE_UNIFIED_SWING_ENGINE = "true";
  });
  it("404 on unknown id, 400 on bad id", async () => {
    expect((await send("GET", "/api/swing/trades/999")).status).toBe(404); expect((await send("GET", "/api/swing/trades/abc")).status).toBe(400);
    srv.close();
  });
});
