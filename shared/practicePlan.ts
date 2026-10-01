// Section R — Editable practice plans (pure, deterministic, no I/O).
// The system-generated plan is never mutated; every user edit becomes a separate
// "Plan Version" computed here from explicit inputs. PRACTICE ONLY — never an order.

export const ENTRY_METHODS = ["TRIGGER", "PULLBACK_LIMIT", "BREAKOUT", "RETEST", "CURRENT"] as const;
export type EntryMethod = typeof ENTRY_METHODS[number];
export const ENTRY_METHOD_LABEL: Record<EntryMethod, string> = {
  TRIGGER: "Entry at trigger", PULLBACK_LIMIT: "Buy-limit pullback plan", BREAKOUT: "Breakout confirmation plan",
  RETEST: "Retest confirmation plan", CURRENT: "Model current price",
};
export const STOP_METHODS = ["ORIGINAL", "SWING_1H", "SWING_4H", "MANUAL"] as const;
export type StopMethod = typeof STOP_METHODS[number];
export const STOP_METHOD_LABEL: Record<StopMethod, string> = {
  ORIGINAL: "Keep original structural stop", SWING_1H: "Use selected recent 1H swing low",
  SWING_4H: "Use selected recent 4H swing low", MANUAL: "Use manually selected chart level",
};
export const TARGET_METHODS = ["R_MULTIPLE", "RESISTANCE", "MANUAL"] as const;
export type TargetMethod = typeof TARGET_METHODS[number];
export const TARGET_METHOD_LABEL: Record<TargetMethod, string> = {
  R_MULTIPLE: "Preserve 2R / 3R", RESISTANCE: "Nearest resistance for T1 + 3R for T2", MANUAL: "Use manual target levels",
};

export interface PlanInputs {
  entry: number;
  entryMethod: EntryMethod;
  stopMethod: StopMethod;
  /** Swing low / manual chart level the stop sits under (ignored for ORIGINAL). */
  stopLevel?: number | null;
  bufferMethod: "AUTO" | "MANUAL";
  manualBuffer?: number | null;      // dollars below the level
  targetMethod: TargetMethod;
  t1R: number;                       // default 2
  t2R: number;                       // default 3
  manualT1?: number | null;
  manualT2?: number | null;
  maxDollarRisk: number;
  minRrT1: number;
  shareMethod: "AUTO" | "MANUAL";
  manualShares?: number | null;
  /** Stop-limit offset below the stop, % of stop (default 0.2%, min $0.05). */
  stopLimitBufferPct?: number;
}

export type OriginalPlanStatus = "VALID" | "ENTRY_WINDOW_PASSED" | "EXTENDED" | "EXPIRED" | "INVALIDATED" | "NONE";
export const ORIGINAL_STATUS_LABEL: Record<OriginalPlanStatus, string> = {
  VALID: "Valid", ENTRY_WINDOW_PASSED: "Entry Window Passed", EXTENDED: "Extended",
  EXPIRED: "Expired", INVALIDATED: "Invalidated", NONE: "No system plan",
};

export interface OriginalPlan {
  entry: number | null; stop: number | null; stopLimit: number | null;
  t1: number | null; t2: number | null; riskPerShare: number | null; rrT1: number | null; rrT2: number | null;
}

export interface PlanContext {
  symbol: string;
  exchange: string;
  setupType: string | null;
  setupTimestamp: string | null;
  setupStatus: string;
  originalTrigger: number | null;
  original: OriginalPlan;
  currentPrice: number | null;
  atr1h: number | null;
  /** Resistance levels (any order); only those above entry are used. */
  resistances: number[];
  maxExtensionPct: number;
  dataStatus: string;
  dataSource: string | null;
  quoteTimestamp: string | null;
}

export type PlanState =
  | "INVALID" | "EXTENDED" | "STOP_TOO_WIDE" | "RR_TOO_LOW" | "PULLBACK_NOT_FILLED"
  | "BREAKOUT_NOT_TRIGGERED" | "LATE_ENTRY" | "VALID";
export const PLAN_STATE_LABEL: Record<PlanState, string> = {
  INVALID: "INVALID PLAN — ENTRY MUST BE ABOVE THE STOP",
  EXTENDED: "EXTENDED — ORIGINAL PLAN NO LONGER VALID. USE A RETEST PLAN OR SKIP.",
  STOP_TOO_WIDE: "WATCH — STOP TOO WIDE FOR MAX RISK.",
  RR_TOO_LOW: "WATCH — T1 R:R TOO LOW.",
  PULLBACK_NOT_FILLED: "PULLBACK PLAN — NOT FILLED",
  BREAKOUT_NOT_TRIGGERED: "BREAKOUT NOT YET TRIGGERED.",
  LATE_ENTRY: "LATE ENTRY / RECALCULATED PLAN.",
  VALID: "PRACTICE PLAN — MEETS YOUR RULES",
};

export interface PlanResult {
  entry: number; stop: number | null; stopLimit: number | null; stopBuffer: number;
  t1: number | null; t2: number | null;
  riskPerShare: number | null; rewardT1: number | null; rewardT2: number | null;
  rrT1: number | null; rrT2: number | null;
  suggestedShares: number; shares: number; totalRisk: number | null; capital: number | null;
  states: PlanState[];         // every condition that applies, most severe first
  state: PlanState;            // the headline
  messages: string[];          // plain-English status lines
  originalMathInvalid: boolean;// "Original plan math no longer applies."
  changedFields: string[];
  explain: {
    whatChanged: string; whyStop: string; whyTargets: string;
    meetsRr: string; extended: string; mustHappen: string;
  };
}

export const DEFAULT_T1R = 2, DEFAULT_T2R = 3;
const r2 = (n: number) => Math.round(n * 100) / 100;
const $ = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `$${n.toFixed(2)}`);
/** Small tolerance so a cent of noise is not "materially" above/below. */
const MATERIAL_PCT = 0.15;

export function stopLimitOf(stop: number, pct = 0.2) { return r2(stop - Math.max(0.05, stop * pct / 100)); }

export function autoBuffer(level: number, atr1h: number | null): number {
  return r2(Math.max(0.05, atr1h != null && atr1h > 0 ? atr1h * 0.1 : level * 0.002));
}

export function originalPlanStatus(ctx: Pick<PlanContext, "setupStatus" | "currentPrice" | "original">): OriginalPlanStatus {
  const s = ctx.setupStatus, o = ctx.original;
  if (o.entry == null || o.stop == null) return "NONE";
  if (ctx.currentPrice != null && ctx.currentPrice < o.stop) return "INVALIDATED";
  if (s === "SIGNAL_EXPIRED") return "EXPIRED";
  if (s === "WATCH_EXTENDED") return "EXTENDED";
  if (s === "WATCH_RETEST" || s === "WATCH_RR_TOO_LOW" || s === "WATCH_STOP_TOO_WIDE") return "ENTRY_WINDOW_PASSED";
  return "VALID";
}

/** Sensible starting inputs for the editor, seeded from the system plan. */
export function defaultInputs(ctx: PlanContext, maxDollarRisk: number, minRrT1: number): PlanInputs {
  const entry = ctx.original.entry ?? ctx.currentPrice ?? 0;
  return {
    entry: r2(entry), entryMethod: "TRIGGER", stopMethod: "ORIGINAL", stopLevel: null,
    bufferMethod: "AUTO", manualBuffer: null, targetMethod: "R_MULTIPLE", t1R: DEFAULT_T1R, t2R: DEFAULT_T2R,
    manualT1: null, manualT2: null, maxDollarRisk, minRrT1, shareMethod: "AUTO", manualShares: null, stopLimitBufferPct: 0.2,
  };
}

export function recalcPlan(ctx: Readonly<PlanContext>, inp: Readonly<PlanInputs>): PlanResult {
  const entry = r2(inp.entry);
  const o = ctx.original;
  const px = ctx.currentPrice;

  // ── Stop ──
  let stop: number | null = null, stopBuffer = 0, whyStop = "";
  if (inp.stopMethod === "ORIGINAL") {
    stop = o.stop;
    whyStop = o.stop != null ? `Kept the original structural stop ${$(o.stop)} (already includes the system's volatility buffer).` : "No original stop exists — pick a swing low or chart level.";
  } else if (inp.stopLevel != null && Number.isFinite(inp.stopLevel)) {
    stopBuffer = inp.bufferMethod === "MANUAL" && inp.manualBuffer != null ? r2(Math.max(0, inp.manualBuffer)) : autoBuffer(inp.stopLevel, ctx.atr1h);
    stop = r2(inp.stopLevel - stopBuffer);
    const src = inp.stopMethod === "SWING_1H" ? "recent 1H swing low" : inp.stopMethod === "SWING_4H" ? "recent 4H swing low" : "chart level you selected";
    whyStop = `Stop sits ${$(stopBuffer)} below the ${src} at ${$(inp.stopLevel)} (${inp.bufferMethod === "AUTO" ? "auto volatility buffer ≈ 0.1 × 1H ATR" : "your manual buffer"}). If price breaks that low, the idea is wrong.`;
  } else {
    whyStop = "Pick a level for the stop.";
  }
  const stopLimit = stop != null ? stopLimitOf(stop, inp.stopLimitBufferPct ?? 0.2) : null;
  const risk = stop != null ? r2(entry - stop) : null;
  const validRisk = risk != null && risk > 0;

  // ── Targets ──
  let t1: number | null = null, t2: number | null = null, whyTargets = "";
  if (validRisk) {
    if (inp.targetMethod === "R_MULTIPLE") {
      t1 = r2(entry + risk! * inp.t1R); t2 = r2(entry + risk! * inp.t2R);
      whyTargets = `Targets keep ${inp.t1R}R / ${inp.t2R}R from the new entry and stop, so the reward scales with the new risk.`;
    } else if (inp.targetMethod === "RESISTANCE") {
      const above = [...ctx.resistances].filter((x) => Number.isFinite(x) && x > entry * (1 + 0.001)).sort((a, b) => a - b);
      const threeR = r2(entry + risk! * 3);
      if (above.length) {
        t1 = r2(above[0]);
        t2 = r2(Math.max(above[1] ?? 0, threeR));
        whyTargets = `T1 is the nearest resistance above entry (${$(t1)}); T2 is the higher of the next resistance and 3R (${$(t2)}).`;
      } else {
        t1 = r2(entry + risk! * inp.t1R); t2 = threeR;
        whyTargets = `No resistance found above entry, so T1 falls back to ${inp.t1R}R and T2 to 3R.`;
      }
    } else {
      t1 = inp.manualT1 != null ? r2(inp.manualT1) : null; t2 = inp.manualT2 != null ? r2(inp.manualT2) : null;
      whyTargets = "You set the targets manually — check they sit below real resistance.";
    }
  } else {
    whyTargets = "Targets can't be calculated until the entry is above the stop.";
  }

  const rewardT1 = validRisk && t1 != null ? r2(t1 - entry) : null;
  const rewardT2 = validRisk && t2 != null ? r2(t2 - entry) : null;
  const rrT1 = validRisk && rewardT1 != null ? Math.round((rewardT1 / risk!) * 100) / 100 : null;
  const rrT2 = validRisk && rewardT2 != null ? Math.round((rewardT2 / risk!) * 100) / 100 : null;
  const suggestedShares = validRisk ? Math.max(0, Math.floor(inp.maxDollarRisk / risk!)) : 0;
  const shares = inp.shareMethod === "MANUAL" && inp.manualShares != null ? Math.max(0, Math.floor(inp.manualShares)) : suggestedShares;
  const totalRisk = validRisk ? r2(shares * risk!) : null;
  const capital = validRisk ? r2(shares * entry) : null;

  // ── States ──
  const states: PlanState[] = [];
  const messages: string[] = [];
  const trig = ctx.originalTrigger;
  const extPct = trig != null && trig > 0 ? ((entry - trig) / trig) * 100 : null;
  if (!validRisk) { states.push("INVALID"); messages.push("Entry must be above the long stop/invalidation price."); }
  if (extPct != null && extPct > ctx.maxExtensionPct) {
    states.push("EXTENDED");
    messages.push(`Proposed entry is ${extPct.toFixed(1)}% above the original trigger ${$(trig)} (limit ${ctx.maxExtensionPct}%).`);
  }
  if (validRisk && suggestedShares < 1) { states.push("STOP_TOO_WIDE"); messages.push(`Risk ${$(risk)}/share is more than your max risk ${$(inp.maxDollarRisk)} — not even 1 share fits.`); }
  if (validRisk && inp.shareMethod === "MANUAL" && totalRisk != null && totalRisk > inp.maxDollarRisk) messages.push(`Manual size risks ${$(totalRisk)} — above your max ${$(inp.maxDollarRisk)}.`);
  if (validRisk && rrT1 != null && rrT1 < inp.minRrT1) { states.push("RR_TOO_LOW"); messages.push(`T1 is only ${rrT1.toFixed(2)}R — below your ${inp.minRrT1}R minimum.`); }
  if (px != null) {
    const diffPct = ((px - entry) / entry) * 100;
    if ((inp.entryMethod === "PULLBACK_LIMIT" || inp.entryMethod === "RETEST" || inp.entryMethod === "TRIGGER") && diffPct > MATERIAL_PCT) {
      states.push("PULLBACK_NOT_FILLED");
      messages.push(`Price ${$(px)} is ${$(px - entry)} (${diffPct.toFixed(2)}%) above your entry — a buy-limit there may never fill.`);
    }
    if (inp.entryMethod === "BREAKOUT" && diffPct < -MATERIAL_PCT) {
      states.push("BREAKOUT_NOT_TRIGGERED");
      messages.push(`Price ${$(px)} is still ${$(entry - px)} below the breakout level — wait for a closed 1H bar above it.`);
    }
    if (inp.entryMethod === "CURRENT" && o.entry != null && px > o.entry * (1 + MATERIAL_PCT / 100)) {
      states.push("LATE_ENTRY");
      messages.push(`Modeling a late entry at ${$(entry)} vs the original ${$(o.entry)} — stop and targets were recalculated, not reused.`);
    }
  }
  if (!states.length) states.push("VALID");
  const ORDER: PlanState[] = ["INVALID", "EXTENDED", "STOP_TOO_WIDE", "RR_TOO_LOW", "PULLBACK_NOT_FILLED", "BREAKOUT_NOT_TRIGGERED", "LATE_ENTRY", "VALID"];
  states.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));

  // ── Changes vs original ──
  const changedFields: string[] = [];
  const diff = (name: string, a: number | null, b: number | null) => { if (a == null && b == null) return; if (a == null || b == null || Math.abs(a - b) >= 0.005) changedFields.push(name); };
  diff("entry", o.entry, entry); diff("stop", o.stop, stop); diff("target1", o.t1, t1); diff("target2", o.t2, t2);
  if (shares !== (o.riskPerShare && o.riskPerShare > 0 ? Math.floor(inp.maxDollarRisk / o.riskPerShare) : shares)) changedFields.push("shares");
  // Would the ORIGINAL stop/T1 still give the original R:R from this new entry? If not, its math no longer applies.
  const origRrAtNewEntry = o.stop != null && o.t1 != null && entry > o.stop ? (o.t1 - entry) / (entry - o.stop) : null;
  const originalMathInvalid = changedFields.includes("entry") && (o.rrT1 == null || origRrAtNewEntry == null || Math.abs(origRrAtNewEntry - o.rrT1) >= 0.05);

  const whatChanged = changedFields.length
    ? changedFields.map((f) => f === "entry" ? `Entry ${$(o.entry)} → ${$(entry)}` : f === "stop" ? `Stop ${$(o.stop)} → ${$(stop)}` : f === "target1" ? `T1 ${$(o.t1)} → ${$(t1)}` : f === "target2" ? `T2 ${$(o.t2)} → ${$(t2)}` : `Shares recalculated → ${shares}`).join(" · ")
    : "Nothing changed — this matches the system plan.";
  const meetsRr = rrT1 == null ? "Can't tell yet — fix the stop/entry first." : rrT1 >= inp.minRrT1 ? `Yes — T1 is ${rrT1.toFixed(2)}R (your minimum is ${inp.minRrT1}R).` : `No — T1 is ${rrT1.toFixed(2)}R, below your ${inp.minRrT1}R minimum.`;
  const extended = extPct == null ? "No original trigger to measure from." : extPct > ctx.maxExtensionPct ? `Yes — ${extPct.toFixed(1)}% above the trigger. Use a retest plan or skip.` : `No — ${extPct.toFixed(1)}% from the trigger (limit ${ctx.maxExtensionPct}%).`;
  const mustHappen =
    states[0] === "INVALID" ? "Move the entry above the stop (or pick a lower stop level)." :
    states[0] === "EXTENDED" ? "Wait for price to come back into the retest zone near the original trigger." :
    states[0] === "STOP_TOO_WIDE" ? "Use a tighter structural stop, raise max risk deliberately, or skip." :
    states[0] === "RR_TOO_LOW" ? "Wait for a lower entry (pullback) or skip — the reward doesn't justify the risk." :
    states.includes("PULLBACK_NOT_FILLED") ? `Price must pull back to ${$(entry)} and hold above ${$(stop)}.` :
    states.includes("BREAKOUT_NOT_TRIGGERED") ? `A closed 1H bar above ${$(entry)}.` :
    "Confirm the data is LIVE and the chart still matches, then review before any independent decision.";

  return {
    entry, stop, stopLimit, stopBuffer, t1, t2, riskPerShare: validRisk ? risk : null, rewardT1, rewardT2, rrT1, rrT2,
    suggestedShares, shares, totalRisk, capital, states, state: states[0], messages, originalMathInvalid, changedFields,
    explain: { whatChanged, whyStop, whyTargets, meetsRr, extended, mustHappen },
  };
}

/** A saved version as returned by the API. Rows are append-only (only `selected` moves). */
export interface PlanVersion {
  id: number;
  symbol: string;
  setupId: string;            // which system setup this version adjusts
  version: number;            // 1, 2, 3 … (0 = system plan, never stored)
  createdBy: "USER_ADJUSTED";
  inputs: PlanInputs;
  result: PlanResult;
  context: PlanContext;       // snapshot of the system plan + price/data at save time
  reason: string;
  chartState: Record<string, unknown>;
  dataVendor: string | null;
  createdAt: string;
  selected: boolean;
}

export const PLAN_WARNINGS = [
  "PRACTICE ONLY — NOT A BROKER ORDER.",
  "STOP ORDER RISK — market stops can fill below the stop; stop-limits may not fill.",
  "OVERNIGHT GAP RISK — prices can gap through stop levels.",
  "VERIFY CURRENT PRICE AND DATA FEED BEFORE ACTING.",
] as const;

// ─── Action Center priority (R5) ────────────────────────────────────────────
export const ACTION_GROUPS = ["READY", "CONFIRMED", "FORMING", "RETEST", "EXTENDED", "RR_STOP", "DATA", "NO_TRADE"] as const;
export type ActionGroup = typeof ACTION_GROUPS[number];
export const ACTION_GROUP_LABEL: Record<ActionGroup, string> = {
  READY: "READY TO TRADE — PRACTICE PLAN",
  CONFIRMED: "SETUP CONFIRMED — WAITING FOR 1H TRIGGER",
  FORMING: "SETUP FORMING — NOT TRADEABLE YET",
  RETEST: "WATCH — RETEST ZONE",
  EXTENDED: "EXTENDED — DO NOT CHASE",
  RR_STOP: "WATCH — STOP TOO WIDE OR R:R TOO LOW",
  DATA: "DATA ISSUE — VERIFY",
  NO_TRADE: "NO TRADE — NEXT CONDITION",
};
export function actionGroupOf(d: { setupStatus: string; dataStatus: string }): ActionGroup {
  if (d.setupStatus === "BLOCKED_DATA_MISMATCH" || d.dataStatus === "STALE" || d.dataStatus === "ERROR") return "DATA";
  switch (d.setupStatus) {
    case "READY_TO_TRADE": return "READY";
    case "SETUP_CONFIRMED": return "CONFIRMED";
    case "SETUP_FORMING": return "FORMING";
    case "WATCH_RETEST": return "RETEST";
    case "WATCH_EXTENDED": return "EXTENDED";
    case "WATCH_STOP_TOO_WIDE": case "WATCH_RR_TOO_LOW": return "RR_STOP";
    default: return "NO_TRADE";
  }
}
/** Stable sort: Ready > Confirmed > Forming > Retest > Extended > R:R/stop > Data > No trade. */
export function sortForActionCenter<T extends { setupStatus: string; dataStatus: string; symbol: string }>(rows: T[]): T[] {
  return rows.map((r, i) => ({ r, i, g: ACTION_GROUPS.indexOf(actionGroupOf(r)) }))
    .sort((a, b) => a.g - b.g || a.i - b.i).map((x) => x.r);
}
/** Statuses that get an "Edit Practice Plan" button (R1). */
export const EDITABLE_STATUSES = ["READY_TO_TRADE", "SETUP_CONFIRMED", "WATCH_RETEST", "WATCH_EXTENDED"] as const;
export const canEditPlan = (d: { setupStatus: string; entryPrice: number | null; structuralStop: number | null }) =>
  (EDITABLE_STATUSES as readonly string[]).includes(d.setupStatus) && d.entryPrice != null && d.structuralStop != null;

/** Identity of the system setup a plan version adjusts. A version only applies while its setup is current. */
export const setupIdOf = (d: { symbol: string; setupType: string | null; setupTimeframe: string | null; setupTimestamp: string | null }) =>
  d.setupType ? `${d.symbol}:${d.setupType}:${d.setupTimeframe ?? ""}:${d.setupTimestamp ?? ""}` : `${d.symbol}:NONE`;

// ─── One selected version for every module (R6) ─────────────────────────────
type DecisionLike = {
  symbol: string; setupType: string | null; setupTimeframe: string | null; setupTimestamp: string | null;
  entryPrice: number | null; structuralStop: number | null; target1: number | null; target2: number | null;
  riskPerShare: number | null; rewardRiskT1: number | null; rewardRiskT2: number | null; suggestedShares: number | null;
};
/** The user version that applies to this decision right now (same setup), or null = system plan. */
export function activeVersion(d: DecisionLike | undefined, sel: Record<string, PlanVersion> | undefined): PlanVersion | null {
  if (!d || !sel) return null;
  const v = sel[d.symbol];
  return v && v.setupId === setupIdOf(d) ? v : null;
}
/** A selected version made for an older setup (shown as a note, never as levels). */
export function staleVersion(d: DecisionLike | undefined, sel: Record<string, PlanVersion> | undefined): PlanVersion | null {
  if (!d || !sel) return null;
  const v = sel[d.symbol];
  return v && v.setupId !== setupIdOf(d) ? v : null;
}

export interface EffectivePlan {
  source: "SYSTEM" | "USER"; version: number;
  entry: number | null; stop: number | null; stopLimit: number | null; t1: number | null; t2: number | null;
  risk: number | null; rrT1: number | null; rrT2: number | null; shares: number | null;
}
export function effectivePlan(d: DecisionLike, v: PlanVersion | null): EffectivePlan {
  if (v) {
    const r = v.result;
    return { source: "USER", version: v.version, entry: r.entry, stop: r.stop, stopLimit: r.stopLimit, t1: r.t1, t2: r.t2, risk: r.riskPerShare, rrT1: r.rrT1, rrT2: r.rrT2, shares: r.shares };
  }
  return {
    source: "SYSTEM", version: 0, entry: d.entryPrice, stop: d.structuralStop, stopLimit: d.structuralStop != null ? stopLimitOf(d.structuralStop) : null,
    t1: d.target1, t2: d.target2, risk: d.riskPerShare, rrT1: d.rewardRiskT1, rrT2: d.rewardRiskT2, shares: d.suggestedShares,
  };
}

