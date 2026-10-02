import { describe, it, expect, vi } from "vitest";
import { planTargetsFor, planChangeOf, effectivePlan, targetDefaultError, resolveTargets, activeVersion } from "@shared/practicePlan";
import { T, run } from "../fixtures/smh";
process.env.DATABASE_URL ||= "postgres://x:y@127.0.0.1:1/none";

const base = { symbol: "SMH", setupType: "BREAKOUT_RETEST", setupTimeframe: "4H", setupTimestamp: "2026-10-01T17:30:00Z", setupStatus: "WATCH_RETEST",
  entryPrice: 618.6, structuralStop: 610.63, target1: 620.9, target2: 642.51, riskPerShare: 7.97, rewardRiskT1: 0.29, rewardRiskT2: 3, suggestedShares: 2,
  target1Ref: { price: 620.9 }, target2Ref: null } as any;
const at = (m: number) => new Date(Date.UTC(2026, 9, 2, 16, m)).toISOString();

describe("default R-based targets", () => {
  it("long: T = entry + m×R from the stop LOSS (not the stop limit); 2R/3R by default", () => {
    const t = planTargetsFor(base, undefined)!;
    expect(t.method).toBe("FIXED_R");
    expect(t.t1).toBe(634.54); expect(t.t2).toBe(642.51); // 618.60 + 2×7.97, + 3×7.97
    expect([t.rrT1, t.rrT2]).toEqual([2, 3]);
  });
  it("short: T = entry − m×R", () => {
    const t = planTargetsFor({ ...base, entryPrice: 100, structuralStop: 104 }, { method: "FIXED_R", t1R: 2, t2R: 4 })!;
    expect([t.t1, t.t2]).toEqual([92, 84]);
  });
  it("presets 2/4 and 3/5, custom multiples; T2 must be farther than T1; positive risk only", () => {
    expect(planTargetsFor(base, { method: "FIXED_R", t1R: 3, t2R: 5 })!.t1).toBe(642.51);
    expect(planTargetsFor(base, { method: "FIXED_R", t1R: 2.5, t2R: 4.5 })!.t2).toBe(654.47);
    expect(targetDefaultError({ method: "FIXED_R", t1R: 3, t2R: 3 })).toMatch(/larger/);
    expect(targetDefaultError({ method: "FIXED_R", t1R: -1, t2R: 3 })).toMatch(/positive/);
    expect(planTargetsFor(base, { method: "FIXED_R", t1R: 3, t2R: 2 })).toBeNull();
    expect(planTargetsFor({ ...base, structuralStop: 618.6 }, undefined)).toBeNull();
    expect(resolveTargets({ method: "FIXED_R", t1R: 2, t2R: 2 }, 100, 95, { t1: null, t2: null }).error).toMatch(/larger/);
  });
  it("Engine Original and Structure-Based remain available", () => {
    expect(planTargetsFor(base, { method: "ENGINE", t1R: 2, t2R: 3 })!.t1).toBe(620.9);
    const s = planTargetsFor(base, { method: "STRUCTURE", t1R: 2, t2R: 3 })!;
    expect(s.t1).toBe(620.9); expect(s.t2).toBe(642.51); // no level beyond T1 → 3R fallback
  });
  it("expired / no-trade setups are never recycled into a fresh plan", () => {
    expect(planTargetsFor({ ...base, setupStatus: "SIGNAL_EXPIRED" }, undefined)).toBeNull();
    expect(planTargetsFor({ ...base, entryPrice: null }, undefined)).toBeNull();
  });
  it("engine plan uses the default; a saved user version is never overwritten", () => {
    const d = { ...base, planTargets: planTargetsFor(base, undefined) };
    expect(effectivePlan(d, null).t1).toBe(634.54);
    const v: any = { version: 1, setupId: "SMH:BREAKOUT_RETEST:4H:2026-10-01T17:30:00Z", result: { entry: 619, stop: 611, stopLimit: 610, t1: 630, t2: 640, riskPerShare: 8, rrT1: 1.38, rrT2: 2.63, shares: 2 } };
    expect(activeVersion(d, { SMH: v })).toBe(v);
    expect(effectivePlan(d, v)).toMatchObject({ source: "USER", t1: 630, t2: 640 });
  });
  it("a larger selected R never changes readiness, confirmations or the engine's own R:R", () => {
    const a = run(T.ready, { targetDefault: { method: "ENGINE", t1R: 2, t2R: 3 } } as any).decision;
    const b = run(T.ready, { targetDefault: { method: "FIXED_R", t1R: 3, t2R: 5 } } as any).decision;
    expect(b.setupStatus).toBe(a.setupStatus); expect(b.rewardRiskT1).toBe(a.rewardRiskT1); expect(b.target1).toBe(a.target1);
    expect(b.cardGrade).toBe(a.cardGrade); expect(b.whyNotReady).toEqual(a.whyNotReady);
    if (b.entryPrice != null && b.structuralStop != null) expect(b.planTargets!.rrT1).toBe(3);
  });
});

describe("plan refresh snapshots", () => {
  const snap = (o: any = {}) => { const d = { ...base, ...o }; d.planTargets = planTargetsFor(d, undefined); return d; };
  it("first analysis, then unchanged levels → 'levels unchanged' (prices are not forced to move)", () => {
    const a = snap(); a.planRefresh = planChangeOf(null, a, at(0), true, []);
    expect(a.planRefresh.kind).toBe("FIRST");
    const b = snap(); b.planRefresh = planChangeOf(a, b, at(30), true, []);
    expect(b.planRefresh).toMatchObject({ kind: "UNCHANGED", analysisAt: at(30), changes: [] });
  });
  it("updated levels list every changed value, and stay visible on the next unchanged run", () => {
    const a = snap(); a.planRefresh = planChangeOf(null, a, at(0), true, []);
    const b = snap({ structuralStop: 611.2 }); b.planRefresh = planChangeOf(a, b, at(30), true, []);
    expect(b.planRefresh.kind).toBe("UPDATED");
    expect(b.planRefresh.changes.map((c: any) => c.field)).toEqual(["stop", "stopLimit", "t1", "t2"]); // Fixed-R targets follow the new stop
    const c = snap({ structuralStop: 611.2 }); c.planRefresh = planChangeOf(b, c, at(60), true, []);
    expect(c.planRefresh).toMatchObject({ kind: "UNCHANGED", changedAt: at(30) });
  });
  it("new setup / invalidated / expired follow the engine, never recycle old levels", () => {
    const a = snap(); a.planRefresh = planChangeOf(null, a, at(0), true, []);
    expect(planChangeOf(a, snap({ setupTimestamp: "2026-10-02T15:30:00Z" }), at(30), true, []).kind).toBe("NEW_SETUP");
    expect(planChangeOf(a, snap({ entryPrice: null }), at(30), true, []).kind).toBe("INVALIDATED");
    expect(planChangeOf(a, snap({ setupStatus: "SIGNAL_EXPIRED" }), at(30), true, []).kind).toBe("EXPIRED");
  });
  it("failed / stale analysis keeps the last successful time and is not labelled newly refreshed", () => {
    const a = snap(); a.planRefresh = planChangeOf(null, a, at(0), true, []);
    const b = snap(); b.planRefresh = planChangeOf(a, b, at(30), false, ["1H bars"]);
    expect(b.planRefresh).toMatchObject({ ok: false, analysisAt: at(0), attemptAt: at(30), failed: ["1H bars"] });
  });
});

describe("refresh scheduling and races", async () => {
  const svc = await import("../../server/swing/service");
  const { chicagoTs } = await import("../../server/swing/bars");
  const { rs, nextScheduled, inSession } = svc._test as any;
  const S = (o: any) => ({ autoRefresh1H: false, planAutoRefreshMin: 0, ...o });
  it("Auto Refresh is opt-in: off → no scheduled run", () => { expect(nextScheduled(S({}), chicagoTs("2026-10-02", 600))).toBeNull(); });
  it("interval runs only during regular hours, counted from the last run of any kind", () => {
    rs.lastRunAt = chicagoTs("2026-10-02", 600);
    const n = nextScheduled(S({ planAutoRefreshMin: 30 }), chicagoTs("2026-10-02", 601))!;
    expect(n).toMatchObject({ kind: "INTERVAL", at: chicagoTs("2026-10-02", 630) });
    const late = nextScheduled(S({ planAutoRefreshMin: 30 }), chicagoTs("2026-10-02", 910))!; // Fri after close → Mon open
    expect(late.at).toBe(chicagoTs("2026-10-05", 512));
    expect(inSession(chicagoTs("2026-10-03", 600))).toBe(false); // Saturday
  });
  it("the existing 1H-close recompute is reused as a scheduled run", () => {
    rs.lastRunAt = 0;
    expect(nextScheduled(S({ autoRefresh1H: true }), chicagoTs("2026-10-02", 575))).toMatchObject({ kind: "HOURLY_CLOSE", at: chicagoTs("2026-10-02", 632) });
  });
  it("overlapping refresh requests join one run (no duplicate vendor requests)", async () => {
    let release!: () => void;
    rs.running = new Promise((r) => { release = () => r({ ok: 1 }); });
    const a = svc.runPlanAnalysis("MANUAL"), b = svc.runPlanAnalysis("INTERVAL");
    expect(a).toBe(b); release(); expect(await a).toEqual({ ok: 1 }); rs.running = null;
  });
  it("a manual click right after a run reports that run instead of refetching", async () => {
    rs.lastRunAt = Math.floor(Date.now() / 1000) - 5;
    const spy = vi.spyOn(svc, "scan");
    const st: any = await svc.runPlanAnalysis("MANUAL").catch(() => null);
    expect(spy).not.toHaveBeenCalled(); expect(st?.running ?? false).toBe(false);
  });
});
