import { describe, it, expect, vi } from "vitest";
process.env.DATABASE_URL ||= "postgres://x:y@127.0.0.1:1/none";

// In-memory stand-in for swing_journal so the route path runs without Neon.
const rows: any[] = [];
let nextId = 1;
vi.mock("../../server/storage", () => ({ db: {} }));
vi.mock("../../server/swing/service", () => ({
  CHART_RANGES: [], CHART_TFS: [], chartBars: vi.fn(), loadSettings: vi.fn(async () => ({ watchlist: [{ symbol: "QQQ", exchange: "NASDAQ" }] })),
  readDataEvents: vi.fn(), readLog: vi.fn(), refreshStatus: vi.fn(), runPlanAnalysis: vi.fn(), saveSettings: vi.fn(), scan: vi.fn(),
  settingsPatchSchema: { parse: (x: any) => x }, startSwingScheduler: vi.fn(), onScanPriority: vi.fn(),
  decisionFor: vi.fn(async (symbol: string) => {
    if (symbol === "SLOW") await new Promise((r) => setTimeout(r, 300));
    if (symbol === "BOOM") throw new Error("Yahoo 429 Too Many Requests");
    return { symbol, setupType: "PULLBACK_CONTINUATION", cardGrade: "A", setupTimeframe: "4H", entryPrice: 100, structuralStop: 95, target1: 110, target2: 115, riskPerShare: 5, suggestedShares: 10, chart: { history: [] } };
  }),
}));
vi.mock("../../server/swing/readyAlerts", () => ({ sendTestTelegram: vi.fn(), startReadyAlerts: vi.fn() }));
vi.mock("../../server/swing/alerts", () => ({ ackEvent: vi.fn(), confirmVerification: vi.fn(), contactsWithStatus: vi.fn(), createAlert: vi.fn(), deleteAlert: vi.fn(), listAlerts: vi.fn(), listEvents: vi.fn(), loadPrefs: vi.fn(), savePrefs: vi.fn(), sendVerification: vi.fn(), setAlertActive: vi.fn(), startAlertLoop: vi.fn(), tickAlerts: vi.fn() }));
vi.mock("../../server/swing/plans", () => ({ listVersions: vi.fn(), planContext: vi.fn(), saveVersion: vi.fn(), selectVersion: vi.fn(), selectedVersions: vi.fn() }));
vi.mock("../../server/swing/universe", () => ({ addItem: vi.fn(), patchItem: vi.fn(), removeItem: vi.fn(), resolveSymbol: vi.fn(), restoreDefaults: vi.fn(), riskNote: vi.fn(), WatchlistError: class extends Error { code = 400 }, yahooSearch: vi.fn() }));
vi.mock("../../server/featureFlags", () => ({ isUnifiedSwingEnabled: () => process.env.ENABLE_UNIFIED_SWING_ENGINE === "true" }));
vi.mock("../../server/swing/journal", async (orig) => {
  const m: any = await orig();
  return {
    ...m,
    listJournal: vi.fn(async (symbol?: string) => rows.filter((r) => !symbol || r.symbol === symbol.toUpperCase()).slice().reverse()),
    createJournalEntry: (raw: unknown, deps: any) => m.createJournalEntry(raw, { ...deps, budgetMs: 100, latest: async (sym: string) => rows.filter((r) => r.symbol === sym).at(-1), insert: async (row: any) => { const r = { id: nextId++, createdAt: new Date().toISOString(), ...row }; rows.push(r); return r; } }),
  };
});

describe("journalRowFrom (pure)", async () => {
  const { journalRowFrom } = await import("../../server/swing/journal");
  it("card levels win over the engine decision and planned risk uses Stop Loss × shares", () => {
    const row = journalRowFrom({ action: "PRACTICE_TRADE", symbol: "qqq", levels: { entry: 101, stop: 97, target1: 109, target2: 113, shares: 20, label: "My Adjusted Plan v2" } },
      { symbol: "QQQ", entryPrice: 100, structuralStop: 95, target1: 110, target2: 115, riskPerShare: 5, suggestedShares: 10, setupType: "X", cardGrade: "B" } as any, "engine");
    expect(row.entry).toBe(101); expect(row.stop).toBe(97); expect(row.target1).toBe(109); expect(row.plannedRisk).toBeCloseTo(80);
    expect(row.decision.journalMeta).toEqual({ decisionSource: "engine", planLabel: "My Adjusted Plan v2", practiceOnly: true });
    expect(row.decision.chart).toBeUndefined();
  });
  it("works with no decision at all (never blocks the save)", () => {
    const row = journalRowFrom({ action: "NOTE", symbol: "NASDAQ:XLV", notes: "n" }, null, "none");
    expect(row.symbol).toBe("XLV"); expect(row.entry).toBeNull(); expect(row.setupType).toBeNull(); expect(row.decision.journalMeta.decisionSource).toBe("none");
  });
});

describe("POST /api/swing/journal end-to-end (Express → insert → GET)", async () => {
  process.env.ENABLE_UNIFIED_SWING_ENGINE = "true";
  const express = (await import("express")).default;
  const { registerSwingRoutes } = await import("../../server/swing/routes");
  const app = express(); app.use(express.json()); registerSwingRoutes(app);
  const srv = await new Promise<any>((res) => { const s = app.listen(0, () => res(s)); });
  const base = `http://127.0.0.1:${(srv.address() as any).port}`;
  const post = (b: unknown) => fetch(`${base}/api/swing/journal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });

  it("saves from the engine decision and the entry appears in the list", async () => {
    const r = await post({ action: "PRACTICE_TRADE", symbol: "QQQ", notes: "from card" });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.ok).toBe(true); expect(j.decisionSource).toBe("engine"); expect(j.entry.entry).toBe(100); expect(j.entry.plannedRisk).toBe(50);
    const list = await (await fetch(`${base}/api/swing/journal?symbol=qqq`)).json();
    expect(list.map((x: any) => x.id)).toContain(j.entry.id);
  });
  it("still saves when the vendor call throws (uses the card snapshot)", async () => {
    const r = await post({ action: "PRACTICE_TRADE", symbol: "BOOM", snapshot: { symbol: "BOOM", entryPrice: 50, structuralStop: 48, target1: 54, suggestedShares: 5, cardGrade: "B", setupType: "BREAKOUT_RETEST" } });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.decisionSource).toBe("snapshot"); expect(j.entry.entry).toBe(50); expect(j.entry.plannedRisk).toBe(10); expect(j.entry.grade).toBe("B");
  });
  it("still saves when the engine is too slow (time budget) — levels from the card", async () => {
    const r = await post({ action: "WATCH", symbol: "SLOW", levels: { entry: 10, stop: 9, target1: 12, target2: 13, shares: 3 } });
    const j = await r.json();
    expect(r.status).toBe(200); expect(j.decisionSource).toBe("none"); expect(j.entry.entry).toBe(10); expect(j.entry.plannedRisk).toBe(3);
  });
  it("swallows a double-click: identical save within 10 s returns the same entry", async () => {
    const a = await (await post({ action: "OBSERVED", symbol: "QQQ", notes: "dup" })).json();
    const b = await (await post({ action: "OBSERVED", symbol: "QQQ", notes: "dup" })).json();
    expect(b.entry.id).toBe(a.entry.id); expect(b.deduped).toBe(true);
    const c = await (await post({ action: "OBSERVED", symbol: "QQQ", notes: "different note" })).json();
    expect(c.entry.id).not.toBe(a.entry.id);
  });
  it("rejects bad input with 400 and never accepts an order-like action", async () => {
    expect((await post({ action: "BUY_NOW", symbol: "QQQ" })).status).toBe(400);
    expect((await post({ symbol: "QQQ" })).status).toBe(400);
  });
  it("is 404 with the flag off (flag-off regression contract)", async () => {
    process.env.ENABLE_UNIFIED_SWING_ENGINE = "false";
    expect((await post({ action: "NOTE", symbol: "QQQ" })).status).toBe(404);
    process.env.ENABLE_UNIFIED_SWING_ENGINE = "true";
    srv.close();
  });
});
