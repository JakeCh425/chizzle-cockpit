import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  recalcPlan, defaultInputs, originalPlanStatus, actionGroupOf, sortForActionCenter, canEditPlan, stopLimitOf,
  type PlanContext, type PlanInputs,
} from "@shared/practicePlan";

const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({
  symbol: "SMH", exchange: "NASDAQ", setupType: "BREAKOUT_RETEST", setupTimestamp: "2026-09-29T20:00:00.000Z",
  setupStatus: "READY_TO_TRADE", originalTrigger: 600,
  original: { entry: 600.6, stop: 594.6, stopLimit: stopLimitOf(594.6), t1: 612.6, t2: 618.6, riskPerShare: 6, rrT1: 2, rrT2: 3 },
  currentPrice: 601, atr1h: 2, resistances: [605, 611, 640], maxExtensionPct: 1.5,
  dataStatus: "LIVE", dataSource: "twelvedata", quoteTimestamp: "2026-10-01T19:00:00.000Z", ...over,
});
const inp = (c: PlanContext, over: Partial<PlanInputs> = {}): PlanInputs => ({ ...defaultInputs(c, 60, 2), ...over });

describe("Section R — practice plan recalculation", () => {
  it("never mutates the original system plan", () => {
    const c = ctx(); const before = JSON.stringify(c);
    recalcPlan(c, inp(c, { entry: 603, stopMethod: "SWING_1H", stopLevel: 598, targetMethod: "RESISTANCE" }));
    expect(JSON.stringify(c)).toBe(before);
    expect(Object.isFrozen(c.original) || c.original.entry === 600.6).toBe(true);
  });

  it("alternate entry recalculates risk, targets, R:R and size (keep structural stop)", () => {
    const c = ctx({ currentPrice: 598 });
    const r = recalcPlan(c, inp(c, { entry: 598, entryMethod: "PULLBACK_LIMIT" }));
    expect(r.stop).toBe(594.6);
    expect(r.riskPerShare).toBe(3.4);
    expect(r.t1).toBe(604.8); expect(r.t2).toBe(608.2);
    expect(r.rrT1).toBe(2); expect(r.rrT2).toBe(3);
    expect(r.suggestedShares).toBe(17); // floor(60 / 3.4)
    expect(r.totalRisk).toBe(57.8);
    expect(r.capital).toBe(10166);
    expect(r.changedFields).toContain("entry");
    expect(r.originalMathInvalid).toBe(true);
    expect(r.state).toBe("VALID");
  });

  it("new retest stop uses the selected swing low minus a volatility buffer", () => {
    const c = ctx();
    const r = recalcPlan(c, inp(c, { entry: 601, stopMethod: "SWING_1H", stopLevel: 598 }));
    expect(r.stopBuffer).toBe(0.2); // 0.1 × ATR 2
    expect(r.stop).toBe(597.8);
    expect(r.stopLimit).toBe(stopLimitOf(597.8));
    expect(r.riskPerShare).toBe(3.2);
    expect(r.explain.whyStop).toMatch(/1H swing low/);
  });

  it("manual buffer is honored", () => {
    const c = ctx();
    const r = recalcPlan(c, inp(c, { entry: 601, stopMethod: "MANUAL", stopLevel: 598, bufferMethod: "MANUAL", manualBuffer: 0.5 }));
    expect(r.stop).toBe(597.5);
  });

  it("entry at or below the stop is an invalid plan", () => {
    const c = ctx();
    const r = recalcPlan(c, inp(c, { entry: 594 }));
    expect(r.state).toBe("INVALID");
    expect(r.messages[0]).toBe("Entry must be above the long stop/invalidation price.");
    expect(r.t1).toBeNull(); expect(r.suggestedShares).toBe(0);
  });

  it("entry far above the original trigger is EXTENDED", () => {
    const c = ctx({ currentPrice: 612 });
    const r = recalcPlan(c, inp(c, { entry: 612, entryMethod: "CURRENT" }));
    expect(r.states).toContain("EXTENDED");
    expect(r.state).toBe("EXTENDED");
  });

  it("buy-limit pullback below current price is NOT FILLED", () => {
    const c = ctx({ currentPrice: 604 });
    const r = recalcPlan(c, inp(c, { entry: 600.6, entryMethod: "PULLBACK_LIMIT" }));
    expect(r.states).toContain("PULLBACK_NOT_FILLED");
    expect(r.messages.join(" ")).toMatch(/may never fill/);
  });

  it("breakout plan above current price is NOT YET TRIGGERED", () => {
    const c = ctx({ currentPrice: 598 });
    const r = recalcPlan(c, inp(c, { entry: 600.6, entryMethod: "BREAKOUT" }));
    expect(r.states).toContain("BREAKOUT_NOT_TRIGGERED");
  });

  it("model-current-price above original entry is a LATE ENTRY", () => {
    const c = ctx({ currentPrice: 603 });
    const r = recalcPlan(c, inp(c, { entry: 603, entryMethod: "CURRENT" }));
    expect(r.states).toContain("LATE_ENTRY");
  });

  it("T1 R:R below the user minimum is WATCH — R:R TOO LOW", () => {
    const c = ctx();
    const r = recalcPlan(c, inp(c, { entry: 601, targetMethod: "RESISTANCE" }));
    expect(r.t1).toBe(605); // nearest resistance
    expect(r.rrT1!).toBeLessThan(2);
    expect(r.state).toBe("RR_TOO_LOW");
    expect(r.t2).toBe(Math.max(611, Math.round((601 + 6.4 * 3) * 100) / 100));
  });

  it("stop too wide for max risk → WATCH — STOP TOO WIDE", () => {
    const c = ctx();
    const r = recalcPlan(c, inp(c, { entry: 601, maxDollarRisk: 5 }));
    expect(r.suggestedShares).toBe(0);
    expect(r.state).toBe("STOP_TOO_WIDE");
  });

  it("manual shares above max risk warn", () => {
    const c = ctx();
    const r = recalcPlan(c, inp(c, { entry: 601, shareMethod: "MANUAL", manualShares: 50 }));
    expect(r.shares).toBe(50);
    expect(r.messages.join(" ")).toMatch(/above your max/);
  });

  it("unchanged inputs reproduce the system plan without flags", () => {
    const c = ctx();
    const r = recalcPlan(c, inp(c));
    expect(r.entry).toBe(600.6); expect(r.stop).toBe(594.6); expect(r.t1).toBe(612.6); expect(r.t2).toBe(618.6);
    expect(r.changedFields).toEqual([]);
    expect(r.originalMathInvalid).toBe(false);
  });

  it("original plan status reflects the system card", () => {
    expect(originalPlanStatus(ctx())).toBe("VALID");
    expect(originalPlanStatus(ctx({ setupStatus: "WATCH_EXTENDED" }))).toBe("EXTENDED");
    expect(originalPlanStatus(ctx({ setupStatus: "WATCH_RETEST" }))).toBe("ENTRY_WINDOW_PASSED");
    expect(originalPlanStatus(ctx({ setupStatus: "SIGNAL_EXPIRED" }))).toBe("EXPIRED");
    expect(originalPlanStatus(ctx({ currentPrice: 590 }))).toBe("INVALIDATED");
  });
});

describe("Section R — Action Center priority", () => {
  const row = (symbol: string, setupStatus: string, dataStatus = "LIVE") => ({ symbol, setupStatus, dataStatus });
  it("orders Ready > Confirmed > Forming > Retest > Extended > R:R/stop > Data > No trade", () => {
    const rows = [row("A", "NO_SETUP"), row("B", "WATCH_EXTENDED"), row("C", "SETUP_FORMING"), row("D", "BLOCKED_DATA_MISMATCH", "DELAYED"),
      row("E", "READY_TO_TRADE"), row("F", "WATCH_RR_TOO_LOW"), row("G", "SETUP_CONFIRMED"), row("H", "WATCH_RETEST")];
    expect(sortForActionCenter(rows).map((r) => r.symbol).join("")).toBe("EGCHBFDA");
  });
  it("stale data is a data issue regardless of status", () => {
    expect(actionGroupOf(row("X", "SETUP_FORMING", "STALE"))).toBe("DATA");
  });
  it("edit button only on Ready / Confirmed / Retest / Extended with a plan", () => {
    expect(canEditPlan({ setupStatus: "READY_TO_TRADE", entryPrice: 1, structuralStop: 0.5 })).toBe(true);
    expect(canEditPlan({ setupStatus: "SETUP_FORMING", entryPrice: 1, structuralStop: 0.5 })).toBe(false);
    expect(canEditPlan({ setupStatus: "WATCH_RETEST", entryPrice: null, structuralStop: 0.5 })).toBe(false);
  });
});

describe("Section R — no broker execution exists", () => {
  it("no server route or client call places, modifies or cancels broker orders", () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(f)) files.push(p); } };
    walk(path.resolve(__dirname, "../../server")); walk(path.resolve(__dirname, "../../client/src"));
    const routeRe = /app\.(post|put|patch|delete)\(\s*["'`]([^"'`]+)/g;
    const bad: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(routeRe)) if (/broker|place-?order|submit-?order|execute|\/orders?\b/i.test(m[2])) bad.push(`${f}: ${m[2]}`);
      if (/alpaca|ibkr|interactivebrokers|tdameritrade|schwab\.com\/trader|tradier|robinhood/i.test(src)) bad.push(`${f}: broker SDK/host reference`);
    }
    expect(bad).toEqual([]);
  });
});

describe("Section R — every module reads the same selected version", () => {
  it("a selected version applies only to its own setup; effectivePlan switches every level", async () => {
    const { activeVersion, staleVersion, effectivePlan, setupIdOf } = await import("@shared/practicePlan");
    const d = { symbol: "SMH", setupType: "BREAKOUT_RETEST", setupTimeframe: "4H", setupTimestamp: "2026-09-29T20:00:00.000Z",
      entryPrice: 600.6, structuralStop: 594.6, target1: 612.6, target2: 618.6, riskPerShare: 6, rewardRiskT1: 2, rewardRiskT2: 3, suggestedShares: 10 };
    const c = ctx();
    const result = recalcPlan(c, inp(c, { entry: 598, entryMethod: "PULLBACK_LIMIT" }));
    const v: any = { id: 1, symbol: "SMH", setupId: setupIdOf(d), version: 2, result, selected: true };
    expect(activeVersion(d, { SMH: v })?.version).toBe(2);
    const p = effectivePlan(d, activeVersion(d, { SMH: v }));
    expect([p.source, p.entry, p.stop, p.t1, p.t2, p.shares]).toEqual(["USER", 598, 594.6, 604.8, 608.2, 17]);
    expect(effectivePlan(d, null).entry).toBe(600.6); // system plan untouched
    const newer = { ...d, setupTimestamp: "2026-10-01T20:00:00.000Z" };
    expect(activeVersion(newer, { SMH: v })).toBeNull();
    expect(staleVersion(newer, { SMH: v })?.version).toBe(2);
  });
});
