// Live card freshness — PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE.
// Pure + deterministic. Compares the ORIGINAL planned levels (never mutated) with the live quote so a card can
// never read "Ready" once price has run past the entry and the live reward/risk no longer meets the minimum.
// Additive: it never changes the engine's setupStatus, detectors, candle math, regime classification or levels.
import { phraseHit, type SwingDecision, type SwingSettings } from "./swingDecision";

export type FreshnessState =
  | "FRESH"         // signal recent, price <= entry + 0.1 ATR buffer, live R:R >= minR
  | "AGING"         // > 1 closed bar OR slightly extended, but live R:R >= minR
  | "MISSED_ENTRY"  // price extended above entry AND live R:R < minR (wait for a retest)
  | "STALE"         // age >= expiry bars, >= 1 full trading session, or the feed is stale
  | "INVALIDATED"   // price touched the stop, crossed T1, or the structure broke
  | "EXPIRED";      // confirmation window passed without a valid trigger

export interface FreshnessCheck { label: string; passed: boolean; valueText?: string }
export interface FreshnessResult {
  state: FreshnessState;
  displayStatus: string;
  liveRr: number | null;
  plannedRr: number;
  liveRiskPerShare: number;
  plannedRiskPerShare: number;
  extensionPct: number;
  extensionAtr: number;
  ageBarsUsed: number;
  ageBarsTotal: number;
  confirmedAtText: string;
  isTradeable: boolean;
  shouldCollapse: boolean;
  checklist: FreshnessCheck[];
  resetConditionText: string;
  retestZone: { low: number; high: number };
  /** Additive display helpers (same evaluation, no new rules). */
  sessionsAgo: number;
  sessionTag: string | null;      // "Older setup — from Tue" when confirmed in a previous session
  aiTip: string | null;           // "🤖 AI Tip: XLE is 1.0% above the $66.94 entry. …"
  reasonSummary: string;          // one-line reason for the "Older / not tradeable" row
  minRr: number;
  hasLevels: boolean;
}

export interface FreshnessOptions {
  /** Market-regime live permission (null = unknown). Never changes isTradeable; it only adds a checklist row
   *  and picks the "live entry not permitted" wording for a fresh practice setup. */
  liveAllowed?: boolean | null;
  now?: Date | number;
}

// ─── Vocabulary (Part 2) ─────────────────────────────────────────────────────
export const NOT_TRADEABLE = {
  ENTRY_MISSED: "NOT TRADEABLE YET — ENTRY MISSED, WAIT FOR RETEST",
  REQUIREMENTS: "NOT TRADEABLE YET — DOESN'T PASS REQUIREMENTS YET",
  RR_BELOW: (minRr: number) => `NOT TRADEABLE YET — RISK / REWARD BELOW ${minRr.toFixed(1)}R`,
  BUILDING: "NOT TRADEABLE YET — SETUP STILL BUILDING",
  LIVE_BLOCKED: "NOT TRADEABLE YET — LIVE ENTRY NOT PERMITTED (CAPITAL PROTECTION)",
  STALE_SIGNAL: "NOT TRADEABLE YET — SIGNAL IS STALE, WAIT FOR RE-CONFIRMATION",
  STALE_DATA: "NOT TRADEABLE YET — DATA IS STALE, VERIFY THE FEED",
  INVALIDATED: "NOT TRADEABLE — LEVELS INVALID, WAIT FOR A NEW SETUP",
  EXPIRED: "NOT TRADEABLE — SETUP EXPIRED, WAIT FOR A NEW SETUP",
} as const;
export const FRESH_STATUS = {
  LIVE_OK: "READY TO TRADE — FRESH ENTRY (PRACTICE PLAN)",
  PRACTICE: "PRACTICE READY — LIVE ENTRY NOT PERMITTED (CAPITAL PROTECTION)",
} as const;
/** Words that may never appear when isTradeable === false (all-caps entries match case-sensitively, whole word). */
export const FORBIDDEN_WHEN_NOT_TRADEABLE = ["READY", "Practice Ready", "Ready to Trade", "Ready now"];
export const STATE_LABEL: Record<FreshnessState, string> = {
  FRESH: "FRESH", AGING: "AGING", MISSED_ENTRY: "MISSED ENTRY", STALE: "STALE", INVALIDATED: "INVALIDATED", EXPIRED: "EXPIRED",
};
/** Amber for missed/aging/stale; red for invalidated/expired; never green unless tradeable. */
export const STATE_TONE: Record<FreshnessState, "good" | "warn" | "bad" | "muted"> = {
  FRESH: "good", AGING: "warn", MISSED_ENTRY: "warn", STALE: "warn", INVALIDATED: "bad", EXPIRED: "muted",
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const floor2 = (n: number) => Math.floor(n * 100 + 1e-6) / 100;
const $ = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ok = (n: number | null | undefined): n is number => n != null && Number.isFinite(n);

// ─── Trading sessions (America/Chicago weekdays) ─────────────────────────────
const ctParts = (t: number) => {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "numeric", minute: "2-digit", hour12: true })
    .formatToParts(new Date(t));
  const g = (k: string) => p.find((x) => x.type === k)?.value ?? "";
  return { y: +g("year"), m: +g("month"), d: +g("day"), wd: g("weekday"), time: `${g("hour")}:${g("minute")} ${g("dayPeriod")}` };
};
/** Number of trading sessions (Mon–Fri, CT) after the confirmation day up to and including today. */
export function sessionsBetween(fromMs: number, toMs: number): number {
  const a = ctParts(fromMs), b = ctParts(toMs);
  let day = Date.UTC(a.y, a.m - 1, a.d), end = Date.UTC(b.y, b.m - 1, b.d), n = 0;
  if (end <= day) return 0;
  for (day += 86400000; day <= end; day += 86400000) { const w = new Date(day).getUTCDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}

/** Pure evaluator. `quote` = live price, `atr` = ATR($) used by the extension check. Planned values are never mutated. */
/** R:R display: one decimal, but never show a below-minimum value rounded up to the minimum (1.98R, not "2.0R"). */
export function rrText(v: number | null | undefined, minRr?: number): string {
  if (v == null || !isFinite(v)) return "—";
  const one = v.toFixed(1);
  return minRr != null && v < minRr && Number(one) >= minRr ? v.toFixed(2) : one;
}

export function computeCardFreshness(decision: SwingDecision, quote: number, atr: number, settings: Pick<SwingSettings, "minRrT1" | "expiryBars4h"> & { minRr?: number }, opts: FreshnessOptions = {}): FreshnessResult {
  const d = decision;
  const minRr = settings.minRr ?? settings.minRrT1 ?? 2;
  const nowMs = opts.now == null ? Date.now() : typeof opts.now === "number" ? opts.now : opts.now.getTime();
  const price = ok(quote) ? quote : ok(d.currentPrice) ? d.currentPrice : NaN;
  const entry = d.entryPrice, stop = d.structuralStop, t1 = d.target1;
  const hasLevels = ok(entry) && ok(stop) && ok(t1) && entry > stop && ok(price);
  const a = ok(atr) && atr > 0 ? atr : null;

  const plannedRisk = hasLevels ? r2(entry - stop) : 0;
  const plannedRr = hasLevels && plannedRisk > 0 ? r2((t1 - entry) / (entry - stop)) : 0;
  const liveRisk = hasLevels ? r2(price - stop) : 0;
  const liveRr = hasLevels && price - stop > 0 ? r2((t1 - price) / (price - stop)) : null;
  const extensionPct = hasLevels ? r2(((price - entry) / entry) * 100) : 0;
  const extensionAtr = hasLevels && a ? r2((price - entry) / a) : 0;
  const zoneHigh = hasLevels ? floor2(Math.min(a ? entry + 0.25 * a : Infinity, entry * 1.0025)) : 0;
  const retestZone = { low: hasLevels ? r2(entry) : 0, high: zoneHigh };

  const sa = d.signalAge ?? null;
  const ageBarsUsed = sa?.bars4h ?? 0;
  const ageBarsTotal = sa?.limit4h || settings.expiryBars4h || 2;
  const confIso = sa?.lastConfirmedAt ?? d.setupTimestamp ?? null;
  const confMs = confIso ? new Date(confIso).getTime() : NaN;
  const sessionsAgo = Number.isFinite(confMs) ? sessionsBetween(confMs, nowMs) : 0;
  const cp = Number.isFinite(confMs) ? ctParts(confMs) : null;
  const confirmedAtText = cp
    ? `${sa?.reconfirmed ? "Re-confirmed" : "Confirmed"} ${cp.wd} ${cp.time} CT (${sessionsAgo === 0 ? "this session" : `${sessionsAgo} trading session${sessionsAgo === 1 ? "" : "s"} ago`})`
    : "Confirmation time unknown";
  const sessionTag = cp && sessionsAgo >= 1 ? `Older setup — from ${cp.wd}` : null;

  const buffer = hasLevels ? entry + 0.1 * (a ?? 0) : 0;
  const strictCap = hasLevels ? entry * 1.002 : 0;
  const extended = hasLevels && (price > strictCap || price > buffer);
  const rrOk = liveRr != null && liveRr >= minRr;
  const badData = d.dataStatus === "STALE" || d.dataStatus === "ERROR";
  const bars1h = sa?.bars1h ?? 0;

  // State (first match wins).
  let state: FreshnessState;
  if (d.setupStatus === "SIGNAL_EXPIRED") state = "EXPIRED";
  else if (d.setupStatus === "NO_TRADE" && hasLevels) state = "INVALIDATED";
  else if (hasLevels && (price <= stop || price >= t1 || d.levelsInvalid)) state = "INVALIDATED";
  else if (badData || sa?.stale || (sa && ageBarsTotal > 0 && ageBarsUsed >= ageBarsTotal) || sessionsAgo >= 2) state = "STALE";
  else if (hasLevels && extended && !rrOk) state = "MISSED_ENTRY";
  else if (bars1h > 1 || (hasLevels && price > entry)) state = "AGING";
  else state = "FRESH";

  const engineReady = d.setupStatus === "READY_TO_TRADE" && !d.evalPending;
  const strictFail = !rrOk || (hasLevels && price > strictCap);
  const isTradeable = hasLevels && engineReady && (state === "FRESH" || state === "AGING") && rrOk && !strictFail && !badData;

  let displayStatus: string;
  if (isTradeable) displayStatus = opts.liveAllowed === false ? FRESH_STATUS.PRACTICE : FRESH_STATUS.LIVE_OK;
  else if (state === "EXPIRED") displayStatus = NOT_TRADEABLE.EXPIRED;
  else if (state === "INVALIDATED") displayStatus = NOT_TRADEABLE.INVALIDATED;
  else if (state === "STALE") displayStatus = badData ? NOT_TRADEABLE.STALE_DATA : NOT_TRADEABLE.STALE_SIGNAL;
  else if (state === "MISSED_ENTRY" || (hasLevels && price > strictCap) || d.setupStatus === "WATCH_EXTENDED" || d.setupStatus === "WATCH_RETEST") displayStatus = NOT_TRADEABLE.ENTRY_MISSED;
  else if (!hasLevels || d.setupStatus === "SETUP_FORMING" || d.setupStatus === "SETUP_CONFIRMED" || d.setupStatus === "NO_SETUP" || d.evalPending) displayStatus = NOT_TRADEABLE.BUILDING;
  else if (d.setupStatus === "WATCH_RR_TOO_LOW" || !rrOk) displayStatus = NOT_TRADEABLE.RR_BELOW(minRr);
  else displayStatus = NOT_TRADEABLE.REQUIREMENTS;

  const shouldCollapse = (state === "MISSED_ENTRY" && bars1h >= 1) || state === "STALE" || state === "INVALIDATED" || state === "EXPIRED";

  const checklist: FreshnessCheck[] = hasLevels ? [
    { label: `Live R:R ≥ ${minRr.toFixed(1)}R`, passed: rrOk, valueText: liveRr == null ? "price at/below stop" : `${liveRr.toFixed(2)}R now (planned ${plannedRr.toFixed(1)}R)` },
    { label: "Price within the entry buffer", passed: !extended, valueText: `${$(price)} is ${Math.abs(extensionPct).toFixed(1)}% ${price >= entry ? "above" : "below"} the ${$(entry)} entry (max ${$(Math.min(strictCap, buffer))})` },
    { label: "Data is live", passed: !badData && d.dataStatus === "LIVE", valueText: `Data ${d.dataStatus}` },
    { label: "Market regime allows live risk", passed: opts.liveAllowed !== false, valueText: opts.liveAllowed === false ? "Capital Protection — practice only" : opts.liveAllowed == null ? "Regime unknown" : "Live risk allowed by regime" },
    { label: "Signal within its confirmation window", passed: state !== "STALE" && state !== "EXPIRED", valueText: `${ageBarsUsed}/${ageBarsTotal} 4H bars · ${sessionsAgo === 0 ? "this session" : `${sessionsAgo} session${sessionsAgo === 1 ? "" : "s"} ago`}` },
  ] : [];

  const zoneTxt = hasLevels ? `${$(retestZone.low)}–${$(retestZone.high)}` : "";
  const tfTxt = d.setupTimeframe === "4H" ? "4H" : "1H";
  const resetConditionText = !hasLevels ? "The setup finishes building on a closed bar."
    : state === "INVALIDATED" || state === "EXPIRED" ? "A new setup confirms on a closed 1H bar (these levels are history only)."
    : state === "STALE" ? (badData ? "The data feed is live again, then the plan re-checks on the next closed 1H bar." : `A fresh re-confirmation: pullback to ${zoneTxt} and a closed ${tfTxt} back above ${$(entry)}.`)
    : extended || !rrOk ? `Pullback to ${zoneTxt} with a closed ${tfTxt} reversal`
    : "";

  const aiTip = hasLevels && extended && liveRr != null
    ? `🤖 AI Tip: ${d.symbol} is ${extensionPct.toFixed(1)}% above the ${$(entry)} entry. Taking it here yields ~${rrText(liveRr, minRr)}R. Wait for the ${zoneTxt} retest.`
    : null;

  const reasonSummary = !hasLevels ? "No complete plan yet"
    : state === "MISSED_ENTRY" ? `${extensionPct.toFixed(1)}% above entry · live ${rrText(liveRr, minRr)}R < ${minRr.toFixed(1)}R min`
    : state === "STALE" ? (badData ? `Data ${d.dataStatus}` : `Signal is ${sessionsAgo >= 2 ? `${sessionsAgo} sessions` : `${ageBarsUsed}/${ageBarsTotal} 4H bars`} old`)
    : state === "INVALIDATED" ? (price <= stop ? `Price ${$(price)} at/below stop ${$(stop)}` : price >= t1 ? `Price ${$(price)} already past T1 ${$(t1)}` : "Structure broke")
    : state === "EXPIRED" ? "Confirmation window passed"
    : !rrOk ? `Live ${rrText(liveRr, minRr)}R < ${minRr.toFixed(1)}R min` : displayStatus.replace(/^NOT TRADEABLE( YET)? — /, "");

  return {
    state, displayStatus, liveRr, plannedRr, liveRiskPerShare: liveRisk, plannedRiskPerShare: plannedRisk, extensionPct, extensionAtr,
    ageBarsUsed, ageBarsTotal, confirmedAtText, isTradeable, shouldCollapse, checklist, resetConditionText, retestZone,
    sessionsAgo, sessionTag, aiTip, reasonSummary, minRr, hasLevels,
  };
}

/** Convenience: freshness from a decision alone (quote = currentPrice, ATR from the extension check). */
export function freshnessOf(d: SwingDecision, settings: Pick<SwingSettings, "minRrT1" | "expiryBars4h">, opts: FreshnessOptions = {}): FreshnessResult {
  return computeCardFreshness(d, d.currentPrice ?? NaN, d.extensionCheck?.atrDollar ?? NaN, settings, opts);
}

/** Part 4: default-collapsed unless pinned / ARMED / ACTIVE (those never auto-collapse). */
export function defaultCollapsed(f: FreshnessResult, guard: { pinned?: boolean; tradeStatus?: string | null }): boolean {
  if (guard.pinned) return false;
  if (guard.tradeStatus === "ARMED" || guard.tradeStatus === "ACTIVE") return false;
  return f.shouldCollapse;
}

/** Freshness wording replaces the engine label when the engine says Ready but the live plan is not tradeable,
 *  or when the setup has gone stale / missed / invalid. Never upgrades a status. */
export function replacesEngineStatus(d: Pick<SwingDecision, "setupStatus">, f: FreshnessResult): boolean {
  return !f.isTradeable && (d.setupStatus === "READY_TO_TRADE" || (f.hasLevels && (f.state === "MISSED_ENTRY" || f.state === "STALE" || f.state === "INVALIDATED")));
}

/** Part 4 persisted shape: localStorage["chizzle/v2/card-collapsed"] = { section, cards: { [setupId]: collapsed } }. */
export type CollapsePref = { section: boolean; cards: Record<string, boolean> };
export const COLLAPSE_STORAGE_KEY = "card-collapsed";
/** Split cards into active vs "Older / not tradeable". A user override wins; locked (ARMED/ACTIVE) and pinned
 *  symbols are never collapsed. */
export function splitOlder<T extends { symbol: string }>(items: T[], keyOf: (d: T) => string, fOf: (d: T) => FreshnessResult, pref: CollapsePref,
  guard: { locked?: Set<string>; pinned?: Set<string>; tradeStatusOf?: (d: T) => string | null } = {}) {
  const older: T[] = [], active: T[] = [];
  for (const d of items) {
    const ts = guard.tradeStatusOf?.(d) ?? null;
    const neverCollapse = !!guard.locked?.has(d.symbol) || !!guard.pinned?.has(d.symbol) || ts === "ARMED" || ts === "ACTIVE";
    const o = pref.cards?.[keyOf(d)];
    const c = neverCollapse ? false : o != null ? o : defaultCollapsed(fOf(d), { tradeStatus: ts });
    (c ? older : active).push(d);
  }
  return { older, active };
}

/** True when `text` contains a phrase that may not show for this tradeability. */
export function violatesTradeableWording(text: string, isTradeable: boolean): boolean {
  if (phraseHit(text, "PASS")) return true;
  if (isTradeable) return false;
  return FORBIDDEN_WHEN_NOT_TRADEABLE.some((p) => (p === p.toUpperCase() ? new RegExp(`\\b${p}\\b`).test(text) : text.toLowerCase().includes(p.toLowerCase())));
}
