import { describe, it, expect, vi } from "vitest";
process.env.DATABASE_URL ||= "postgres://x:y@127.0.0.1:1/none";
import { evaluate, extensionCheck } from "../../server/swing/lifecycle";
import { flat, type OHLC } from "../fixtures/builders";
import { raw1HFrom4H, raw1H, scale, dailySeries, settings, upTo } from "../fixtures/replay";
import { planChangeOf } from "@shared/practicePlan";
import type { SwingSettings } from "@shared/swingDecision";
import type { SwingBar } from "../../server/swing/candleMath";

// Same SMH replay as lifecycle.test.ts (READY at the closed 1H momentum break).
const K = 5.7, X = 570;
const below: OHLC[] = Array.from({ length: 6 }, (_, i) => [99.4, 99.6, 99.0, 99.3 - (i % 2) * 0.1] as OHLC);
const base = raw1HFrom4H(scale([...flat(16), ...below, [99.3, 100.7, 99.2, 100.6]], K));
const rbEnd = base[base.length - 1].t + 3600;
const confirmRows: OHLC[] = [[100.5, 100.65, 100.35, 100.55], [100.55, 100.6, 100.2, 100.3], [100.3, 100.5, 100.25, 100.45], [100.45, 100.6, 100.4, 100.5], [100.5, 101.3, 100.45, 101.25]];
const smh = [...base, ...raw1H(scale(confirmRows, K), rbEnd)];
const post = smh.filter((b) => b.t >= rbEnd);
const readyAt = post[4].t + 3600 + 600; // 10 min after the confirming 1H close (between bar closes)
const daily = dailySeries(Array(140).fill(X));
const runR = (over: Partial<SwingSettings> = {}, quote?: number) => evaluate({ symbol: "SMH", exchange: "NASDAQ", bars1h: upTo(smh, readyAt), daily, settings: settings(over), now: readyAt,
  dataSource: "fixture", quote: quote == null ? null : { price: quote, ts: readyAt - 30 } });
const run = (over: Partial<SwingSettings> = {}, quote?: number) => runR(over, quote).decision;
/** The same setup (type + timestamp) inside a result, even if another setup became the primary card. */
const sameSetup = (r: ReturnType<typeof runR>, ref: { setupType: string | null; setupTimestamp: string | null }) =>
  r.candidates.map((c) => c.decision).find((x) => x.setupType === ref.setupType && x.setupTimestamp === ref.setupTimestamp)!;
const levels = (d: ReturnType<typeof run>) => [d.originalTrigger, d.entryPrice, d.structuralStop, d.target1, d.target2];

describe("extension check — live quote vs ENTRY, % OR ATR", () => {
  it("entry 754.48, quote 762.20, maxExtPct 1.0 → extended (1.02% > 1.0%)", () => {
    const x = extensionCheck(762.20, 754.48, null, 1.0, 1.5);
    expect(x.pct).toBeCloseTo(1.023, 2);
    expect(x.extended).toBe(true);
    expect(x.by).toEqual(["PCT"]);
  });
  it("uses OR: the ATR leg alone marks it extended", () => {
    const x = extensionCheck(760, 754.48, 3, 1.0, 1.5); // 0.73% (under 1%) but $5.52 > 1.5 × $3
    expect(x.pct).toBeLessThan(1.0);
    expect(x.extended).toBe(true);
    expect(x.by).toEqual(["ATR"]);
  });
  it("neither leg → not extended", () => {
    const x = extensionCheck(758, 754.48, 9.6, 1.5, 1.5);
    expect(x.extended).toBe(false); expect(x.by).toEqual([]);
  });

  it("lifecycle: a live quote 1.023% above entry with maxExtPct 1.0 → WATCH_EXTENDED, levels unchanged", () => {
    const ready = run({ maxExtensionPct: 1.0, maxExtensionAtr: 50 });
    expect(ready.setupStatus).toBe("READY_TO_TRADE");
    const entry = ready.entryPrice!;
    const ext = sameSetup(runR({ maxExtensionPct: 1.0, maxExtensionAtr: 50 }, Math.round(entry * (762.20 / 754.48) * 100) / 100), ready);
    expect(ext.setupStatus).toBe("WATCH_EXTENDED");
    expect(levels(ext)).toEqual(levels(ready));         // the quote never moves entry / stop / targets
    expect(ext.extensionCheck!.fromLabel).toBe("entry");
    expect(ext.extensionCheck!.from).toBe(entry);
    expect(ext.extensionCheck!.quoteIsLive).toBe(true);
    expect(ext.extensionCheck!.pct).toBeCloseTo(1.02, 1);
    expect(ext.whyNotReady.join(" ")).toMatch(/above entry .* — over the % limit/);
  });
  it("lifecycle: a quote just above entry stays READY with a visible 'not extended' check", () => {
    const ready = run({ maxExtensionPct: 1.0, maxExtensionAtr: 50 });
    const d = run({ maxExtensionPct: 1.0, maxExtensionAtr: 50 }, Math.round(ready.entryPrice! * 1.004 * 100) / 100);
    expect(d.setupStatus).toBe("READY_TO_TRADE");
    expect(d.extensionCheck!.extended).toBe(false);
    expect(d.passedRules.join(" ")).toMatch(/not extended \([\d.]+% \/ .* ATR above entry\)/);
  });
});

describe("plan change provenance — which close moved the levels", () => {
  const snap = (b1: string, b4: string, entry: number) => ({ symbol: "QQQ", setupType: "HIGHER_LOW_CONSOLIDATION", setupTimeframe: "1H", setupTimestamp: "2026-10-05T17:30:00.000Z",
    setupStatus: "READY_TO_TRADE", entryPrice: entry, structuralStop: 747.46, stopLimit: null, target1: 768.52, target2: 775.54, originalTrigger: 754.1,
    lastCompletedBar1H: b1, lastCompletedBar4H: b4 } as any);
  it("tags a change at a 1H close vs a 4H close, and keeps it while levels are unchanged", () => {
    const a = snap("2026-10-06T14:30:00.000Z", "2026-10-05T20:00:00.000Z", 754.48); a.planRefresh = planChangeOf(null, a, "t0", true, []);
    const b = snap("2026-10-06T15:30:00.000Z", "2026-10-05T20:00:00.000Z", 755.00); b.planRefresh = planChangeOf(a, b, "t1", true, []);
    expect(b.planRefresh.changedOn).toEqual({ tf: "1H", barEnd: "2026-10-06T15:30:00.000Z" });
    const c = snap("2026-10-06T16:30:00.000Z", "2026-10-06T16:30:00.000Z", 756.00); c.planRefresh = planChangeOf(b, c, "t2", true, []);
    expect(c.planRefresh.changedOn).toEqual({ tf: "4H", barEnd: "2026-10-06T16:30:00.000Z" });
    const e = snap("2026-10-06T17:30:00.000Z", "2026-10-06T16:30:00.000Z", 756.00); e.planRefresh = planChangeOf(c, e, "t3", true, []);
    expect(e.planRefresh.kind).toBe("UNCHANGED");
    expect(e.planRefresh.changedOn).toEqual({ tf: "4H", barEnd: "2026-10-06T16:30:00.000Z" });
  });
});

describe("quote-only status refresh between bar closes", async () => {
  const quote = { price: 0, ts: 0 };
  vi.doMock("../../server/swing/feed", async (orig) => ({ ...(await orig<any>()), fetchQuote: async () => ({ ...quote }) }));
  const svc = await import("../../server/swing/service");
  const s = settings({ maxExtensionPct: 1.0, maxExtensionAtr: 50, watchlist: [{ symbol: "SMH", exchange: "NASDAQ" }] } as any);
  const seed = () => {
    const res = evaluate({ symbol: "SMH", exchange: "NASDAQ", bars1h: upTo(smh, readyAt), daily, settings: s, now: readyAt, dataSource: "fixture", quote: null });
    res.decision.planRefresh = { kind: "FIRST", ok: true, analysisAt: "A", attemptAt: "A", failed: [], changes: [], changedAt: null };
    svc._test.evalCache.set("SMH", { key: `SMH|${svc.barKey(readyAt)}`, res, bars1h: upTo(smh, readyAt), daily, at: Date.now(), exchange: "NASDAQ", source: "fixture", reference: null } as any);
    return res.decision;
  };
  it("flips READY → WATCH_EXTENDED on a quote alone, without touching levels or the analysis time", async () => {
    const before = seed(); expect(before.setupStatus).toBe("READY_TO_TRADE");
    quote.price = Math.round(before.entryPrice! * (762.20 / 754.48) * 100) / 100; quote.ts = readyAt + 240;
    const out = await svc.quoteStatusRefresh(s, readyAt + 300);
    expect(out.changed).toEqual(["SMH"]);
    const r = svc._test.evalCache.get("SMH")!.res;
    expect(r.decision.planRefresh!.analysisAt).toBe("A");   // a quote is not an analysis
    const d = sameSetup(r as any, before);
    expect(d.setupStatus).toBe("WATCH_EXTENDED");
    expect(levels(d)).toEqual(levels(before));
    expect(r.decision.planRefresh!.quoteCheckAt).toBeTruthy();
  });
  it("skips once a new 1H bar has closed (the full analysis owns that)", async () => {
    seed();
    const out = await svc.quoteStatusRefresh(s, readyAt + 3600);
    expect(out.skipped).toEqual(["SMH"]);
  });
});
