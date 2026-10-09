import { describe, it, expect } from "vitest";
process.env.DATABASE_URL ||= "postgres://x:y@127.0.0.1:1/none";

describe("Part 3 — perf profile + bounded concurrency", async () => {
  const perf = await import("../../server/swing/perf");
  it("mapLimit keeps order and never exceeds the cap", async () => {
    let active = 0, peak = 0;
    const out = await perf.mapLimit([5, 1, 4, 2, 3, 6, 7], 3, async (ms) => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, ms)); active--; return ms * 10; });
    expect(out).toEqual([50, 10, 40, 20, 30, 60, 70]); expect(peak).toBe(3);
  });
  it("timed() records ok and failed spans; summary aggregates per symbol and label", async () => {
    perf._resetPerf();
    await perf.timed("vendor", "bars:1h", "XLV", async () => "ok");
    await perf.timed("vendor", "bars:1h", "XLV", async () => { throw new Error("429 Too Many Requests"); }).catch(() => {});
    perf.recordSpan({ at: new Date().toISOString(), symbol: "XLV", kind: "eval", label: "eval:total", ms: 1200, ok: true });
    perf.recordSpan({ at: new Date().toISOString(), symbol: "XLV", kind: "queue", label: "yahoo:queue-wait", ms: 300, ok: true });
    perf.recordSpan({ at: new Date().toISOString(), symbol: null, kind: "scan", label: "scan:DEFAULT_PLUS_CUSTOM", ms: 4000, ok: true, note: "7 symbols" });
    const s = perf.perfSummary();
    const xlv = s.bySymbol.find((x) => x.symbol === "XLV")!;
    expect(xlv.evals).toBe(1); expect(xlv.lastEvalMs).toBe(1200); expect(xlv.queueMs).toBe(300); expect(xlv.failures).toBe(1);
    expect(s.byLabel.find((l) => l.label === "bars:1h")!.failures).toBe(1);
    expect(s.scans[0].note).toBe("7 symbols");
    expect(perf.recentSpans(2).length).toBe(2);
  });
  it("span buffer is bounded", () => {
    perf._resetPerf();
    for (let i = 0; i < 1000; i++) perf.recordSpan({ at: "x", symbol: null, kind: "rules", label: "rules", ms: 1, ok: true });
    expect(perf.perfSummary().spans).toBeLessThanOrEqual(600);
  });
});

describe("Part 3 — pending snapshots are never 'Ready'", async () => {
  const { actionGroupOf } = await import("../../shared/practicePlan");
  it("READY from a saved snapshot groups as CONFIRMED until the live evaluation lands", () => {
    expect(actionGroupOf({ setupStatus: "READY_TO_TRADE", dataStatus: "LIVE" })).toBe("READY");
    expect(actionGroupOf({ setupStatus: "READY_TO_TRADE", dataStatus: "LIVE", evalPending: { from: "decision-log", analysisAt: null, ageMin: 90 } })).toBe("CONFIRMED");
  });
});

describe("Part 3 — scanNow serves cached rows instantly and lists pending symbols", async () => {
  const svc = await import("../../server/swing/service");
  const { chicagoTs } = await import("../../server/swing/bars");
  it("boot snapshot appears as pending with its age; cached symbol is not pending", async () => {
    const { evalCache } = svc._test as any;
    const s = await svc.loadSettings();
    const items = (s.watchlist ?? []).filter((w: any) => !w.hidden);
    expect(items.length).toBeGreaterThan(1);
    // Pretend one symbol was evaluated this hour (no network): a minimal EvalResult shell.
    const sym0 = items[0].symbol.toUpperCase(), sym1 = items[1].symbol.toUpperCase();
    const dec = (symbol: string, status: string) => ({ symbol, setupStatus: status, dataStatus: "LIVE", setupType: null, planRefresh: { analysisAt: new Date(Date.now() - 2 * 3600_000).toISOString() }, chart: { history: [] } });
    evalCache.set(sym0, { key: `${sym0}|${svc.barKey(Math.floor(Date.now() / 1000))}`, res: { decision: dec(sym0, "SETUP_FORMING"), candidates: [], log: {} }, bars1h: [], daily: [], at: Date.now(), exchange: "", source: "yahoo", reference: null });
    svc._bootSnapshots.set(sym1, dec(sym1, "READY_TO_TRADE") as any);
    // Prevent background vendor calls in the test: mark the other symbols in flight.
    const inflightSyms = items.slice(1).map((w: any) => w.symbol.toUpperCase());
    for (const x of inflightSyms) (svc._test as any).inflight.set(x, new Promise(() => {}));
    const out = await svc.scanNow("DEFAULT_PLUS_CUSTOM");
    const r0 = out.rows.find((r) => r.item.symbol.toUpperCase() === sym0)!, r1 = out.rows.find((r) => r.item.symbol.toUpperCase() === sym1)!;
    expect(r0.pending).toBeFalsy();
    expect(r1.pending).toBe(true); expect(r1.snapshot?.from).toBe("decision-log"); expect(r1.snapshot?.ageMin).toBeGreaterThanOrEqual(119);
    expect(r1.decision.evalPending?.from).toBe("decision-log");
    expect(out.pending).toContain(sym1); expect(out.pending).not.toContain(sym0);
    for (const x of inflightSyms) (svc._test as any).inflight.delete(x);
    evalCache.delete(sym0); svc._bootSnapshots.delete(sym1);
    void chicagoTs;
  });
});
