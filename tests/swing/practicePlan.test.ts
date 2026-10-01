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

// ─── Trading card: direct level editing ──────────────────────────────────────
import { validateCardLevels, inputsFromCardLevels, engineChangedSince, enginePlanSig, recalcPlan as rp, activeVersion as av } from "@shared/practicePlan";
describe("trading card levels", () => {
  const ctx: any = {
    symbol: "SMH", exchange: "NASDAQ", setupType: "BREAKOUT_RETEST", setupTimestamp: "T", setupStatus: "WATCH_RETEST", originalTrigger: 618.6,
    original: { entry: 618.6, stop: 610.63, stopLimit: 609.41, t1: 634.54, t2: 642.51, riskPerShare: 7.97, rrT1: 2, rrT2: 3 },
    currentPrice: 618.2, atr1h: 3, resistances: [], maxExtensionPct: 1.5, dataStatus: "LIVE", dataSource: "yahoo", quoteTimestamp: null,
  };
  const L = { entry: 612, stop: 606.5, stopLimit: 605.2, t1: 623, t2: 628.5 };
  it("validates positive, cents, direction and stop-limit semantics", () => {
    expect(validateCardLevels(L)).toEqual({});
    expect(validateCardLevels({ ...L, entry: -1 }).entry).toMatch(/positive/);
    expect(validateCardLevels({ ...L, t1: 623.123 }).t1).toMatch(/2 decimals/);
    expect(validateCardLevels({ ...L, stop: 613 }).stop).toMatch(/above the long stop/);
    expect(validateCardLevels({ ...L, stopLimit: 606.5 }).stopLimit).toMatch(/below the stop trigger/);
    expect(validateCardLevels({ ...L, stopLimit: 606.47 }).stopLimit).toMatch(/at least \$0\.05/);
    expect(validateCardLevels({ ...L, t1: 611 }).t1).toMatch(/above the entry/);
    expect(validateCardLevels({ ...L, t2: 620 }).t2).toMatch(/at or above Target 1/);
    expect(validateCardLevels({ ...L, stop: null }).stop).toMatch(/needs a price/);
  });
  it("maps the five prices onto existing inputs and recalcPlan reproduces them exactly", () => {
    const inp = inputsFromCardLevels(ctx, L, 100, 2);
    expect(inp.stopMethod).toBe("MANUAL"); expect(inp.targetMethod).toBe("MANUAL"); expect(inp.entryMethod).toBe("PULLBACK_LIMIT");
    const r = rp(ctx, inp);
    expect([r.entry, r.stop, r.stopLimit, r.t1, r.t2]).toEqual([612, 606.5, 605.2, 623, 628.5]);
    expect(r.riskPerShare).toBe(5.5);
    expect(r.shares).toBe(18);                 // floor(100 / 5.5) — existing auto sizing
    expect(r.totalRisk).toBe(99);              // 18 × 5.5
    expect(r.capital).toBe(11016);             // 18 × 612
    expect(r.rrT1).toBe(2);                    // (623 − 612) / 5.5
    expect(r.rrT2).toBe(3);                    // (628.5 − 612) / 5.5
    expect(r.changedFields).toEqual(expect.arrayContaining(["entry", "stop", "target1", "target2"]));
  });
  it("unchanged engine prices keep the ORIGINAL stop and reproduce the engine plan", () => {
    const inp = inputsFromCardLevels(ctx, { entry: 618.6, stop: 610.63, stopLimit: 609.41, t1: 634.54, t2: 642.51 }, 100, 2);
    expect(inp.stopMethod).toBe("ORIGINAL"); expect(inp.entryMethod).toBe("TRIGGER");
    const r = rp(ctx, inp);
    expect([r.entry, r.stop, r.stopLimit, r.t1, r.t2]).toEqual([618.6, 610.63, 609.41, 634.54, 642.51]);
  });
  it("flags an engine plan that moved since a version was saved (same setup), never silently", () => {
    const v: any = { id: 7, version: 1, setupId: "SMH:BREAKOUT_RETEST:4H:T", context: ctx, result: {} };
    const same = { entryPrice: 618.6, structuralStop: 610.63, target1: 634.54, target2: 642.51 };
    expect(engineChangedSince(v, same)).toEqual([]);
    expect(engineChangedSince(v, { ...same, target1: 620.9 })).toEqual(["Target 1 $634.54 → $620.90"]);
    expect(enginePlanSig(same)).not.toBe(enginePlanSig({ ...same, target1: 620.9 }));
  });
  it("setup isolation: a version never applies to a new setup instance", () => {
    const v: any = { id: 7, version: 1, setupId: "SMH:BREAKOUT_RETEST:4H:T1", result: {} };
    const d: any = { symbol: "SMH", setupType: "BREAKOUT_RETEST", setupTimeframe: "4H", setupTimestamp: "T2" };
    expect(av(d, { SMH: v })).toBeNull();
    expect(av({ ...d, setupTimestamp: "T1" }, { SMH: v })).toBe(v);
  });
});

// ─── Target methods ──────────────────────────────────────────────────────────
import { plannedR, targetAtR, rMultipleOf, resolveTargets, obstacleBefore, inputsFromCardChoice } from "@shared/practicePlan";
describe("target methods", () => {
  const E = 618.6, S = 610.63; // the pictured SMH plan: R = 7.97
  it("screenshot example: 2R 634.54 · 3R 642.51 · 4R 650.48 · 5R 658.45", () => {
    expect(plannedR(E, S)).toBe(7.97);
    expect([2, 3, 4, 5].map((m) => targetAtR(E, S, m))).toEqual([634.54, 642.51, 650.48, 658.45]);
    expect(rMultipleOf(E, S, 620.9)).toBe(0.29);   // engine T1 = nearest resistance
    expect(rMultipleOf(E, S, 642.51)).toBe(3);     // engine T2 = 3R fallback
  });
  it("long and short directions", () => {
    expect(targetAtR(100, 95, 2)).toBe(110);
    expect(targetAtR(100, 105, 2)).toBe(90);         // short: entry − m × R
    expect(rMultipleOf(100, 105, 90)).toBe(2);
    expect(targetAtR(100, 95, 1.5)).toBe(107.5);
  });
  it("rejects zero-risk and invalid inputs", () => {
    expect(plannedR(100, 100)).toBeNull(); expect(targetAtR(100, 100, 2)).toBeNull();
    expect(targetAtR(100, 95, 0)).toBeNull(); expect(targetAtR(100, 95, -1)).toBeNull();
    expect(plannedR(-1, 95)).toBeNull();
    expect(resolveTargets({ method: "FIXED_R", t1R: 2, t2R: 3 }, 100, 100, { t1: null, t2: null }).error).toMatch(/zero or invalid/);
    expect(resolveTargets({ method: "FIXED_R", t1R: 3, t2R: 2 }, 100, 95, { t1: null, t2: null }).error).toMatch(/at or above/);
  });
  it("entry/stop edits: Fixed R moves prices, Manual keeps prices and re-reads R, Engine keeps engine prices", () => {
    const eng = { t1: 620.9, t2: 642.51 };
    const fx = resolveTargets({ method: "FIXED_R", t1R: 2, t2R: 3 }, 612, 606.5, eng);
    expect([fx.t1, fx.t2]).toEqual([623, 628.5]);
    const man = resolveTargets({ method: "MANUAL", manualT1: 630, manualT2: 640 }, 612, 606.5, eng);
    expect([man.t1, man.t2]).toEqual([630, 640]); expect(rMultipleOf(612, 606.5, 630)).toBe(3.27);
    const en = resolveTargets({ method: "ENGINE" }, 612, 606.5, eng);
    expect([en.t1, en.t2]).toEqual([620.9, 642.51]);
  });
  it("structure: uses chosen levels, falls back to an explicit fixed R for T2, flags obstacles", () => {
    const levels = [{ price: 620.9 }, { price: 625 }];
    const st = resolveTargets({ method: "STRUCTURE", t1Ref: 625, t2Ref: null, t2R: 3 }, E, S, { t1: null, t2: null });
    expect([st.t1, st.t2]).toEqual([625, 642.51]); expect(st.why).toMatch(/fixed 3R/);
    expect(resolveTargets({ method: "STRUCTURE", t1Ref: null }, E, S, { t1: null, t2: null }).error).toMatch(/structure level/);
    expect(obstacleBefore(levels, E, 642.51)?.price).toBe(620.9);
    expect(obstacleBefore(levels, E, 620.9)).toBeNull();
    expect(obstacleBefore(undefined, E, 650)).toBeNull();
  });
  it("Fixed R maps to the existing R_MULTIPLE inputs and recalcPlan reproduces the prices (risk from STOP LOSS, not stop-limit)", () => {
    const ctx: any = { original: { entry: E, stop: S, stopLimit: 609.41, t1: 620.9, t2: 642.51 }, currentPrice: 619, atr1h: 3, resistances: [], maxExtensionPct: 1.5, originalTrigger: 618.29, dataStatus: "LIVE" };
    const { inputs } = inputsFromCardChoice(ctx, { entry: E, stop: S, stopLimit: 609.41 }, { method: "FIXED_R", t1R: 4, t2R: 5 }, { t1: 620.9, t2: 642.51 }, 16.25, 2);
    expect(inputs!.targetMethod).toBe("R_MULTIPLE");
    const r = rp(ctx, inputs!);
    expect([r.riskPerShare, r.t1, r.t2, r.rrT1, r.rrT2, r.shares]).toEqual([7.97, 650.48, 658.45, 4, 5, 2]);
  });
});
