// ============================================================================
// Chizzle Wealth — FLEX Swing Scanner
// ----------------------------------------------------------------------------
// Implements the four-tier state machine (STANDARD_READY / FLEX_READY /
// FLEX_WATCH / STANDBY) exactly as specified in the FLEX prompt:
//
//   - Confirmed higher-low detection (2-4 bar pivot + 0.2% buffer)
//   - Reclaim trigger detection (SMA20/50, pivot high, prior-day high, VWAP-ish)
//   - Anti-fakeout filters (close-not-wick, chase gate, R:R room, volume, market)
//   - Risk math (stop below invalidation, T1 R>=2 / 1.5, T2 R>=2)
//   - SMH-led market context so tech ETFs (QQQ, SMH, SOXX, XLK) get downgraded
//     when SMH is deteriorating
//   - Day type classification and account-scoped instructions
//
// One 1-year daily bar fetch per ticker (via safeHistory), plus one SMH regime
// snapshot. Fully deterministic — no LLM in the loop.
// ============================================================================

import Ajv, { type ErrorObject } from "ajv";
import addFormats from "ajv-formats";
import fs from "node:fs";
import path from "node:path";
import { safeHistory, type DailyBar } from "./marketData";
import { computeSmhRegime } from "./smhRegime";
import { summarizeExtension, mapSetupFamily, type SetupFamily } from "./extensionTier";
import type {
  FlexScanRequest,
  FlexScanResult,
  FlexDeskCard,
  FlexState,
  FlexAction,
  FlexRiskGrade,
  FlexSetup,
  FlexMetrics,
  SmhContextState,
  FlexDayType,
  DistanceToReadyItem,
  VehicleClass,
  VehiclePermission,
} from "@shared/flexScanTypes";
import {
  GROWTH_TECH_TICKERS,
  BROAD_MARKET_TICKERS,
  NON_GROWTH_TICKERS,
} from "@shared/flexScanTypes";

// ─── Pinned tickers ─────────────────────────────────────────────────────────
// SMH / QQQ / SPY are always evaluated and pinned to the top of the deck so
// the desk always sees leading-market context, tech leadership, and broad-tape
// posture regardless of which universe the caller passes in.
const PINNED_TICKERS = ["SMH", "QQQ", "SPY"];

// ─── Universe defaults ───────────────────────────────────────────────────────
// Baseline: broad, sector, and factor ETFs — the practice universe for swings.
// Tech-concentrated group is opt-in via include_tech_concentrated so the user
// can drop them from the scan when SMH is red.
const DEFAULT_UNIVERSE = [
  "SPY", "QQQ", "IWM", "DIA",         // broad
  "XLK", "XLF", "XLE", "XLV", "XLI",  // sector
  "XLY", "XLP", "XLU", "XLB", "XLC",
  "XLRE", "SMH", "SOXX",              // semi
  "GLD", "SLV", "TLT",                // safe / rates
];

// ─── Ajv validator (mirrors flexScanSchema.json for future LLM-fed variants) ─
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const schemaPath = path.resolve(process.cwd(), "shared/flexScanSchema.json");
let validateFlexScan: ((data: unknown) => boolean) & { errors?: ErrorObject[] | null };
try {
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
  validateFlexScan = ajv.compile(schema) as typeof validateFlexScan;
} catch {
  // Non-fatal: schema is a contract for LLM variants; deterministic path
  // returns typed objects that pass by construction.
  validateFlexScan = (() => true) as typeof validateFlexScan;
}

export function validateFlexScanResult(data: unknown) {
  const ok = validateFlexScan(data);
  return {
    ok,
    errors:
      (validateFlexScan.errors ?? []).map((e) => ({
        path: e.instancePath || "/",
        message: e.message ?? "invalid",
      })),
  };
}

// ─── Math helpers ────────────────────────────────────────────────────────────
function sma(values: number[], n: number): number | null {
  if (values.length < n) return null;
  const slice = values.slice(-n);
  return slice.reduce((a, b) => a + b, 0) / n;
}

function sma200Slope(bars: DailyBar[], lookback = 20): number {
  // % change in the 200-SMA over `lookback` bars. Positive = rising.
  if (bars.length < 200 + lookback) return 0;
  const closes = bars.map((b) => b.close);
  const now = sma(closes.slice(0, closes.length), 200);
  const past = sma(closes.slice(0, closes.length - lookback), 200);
  if (now == null || past == null || past === 0) return 0;
  return ((now - past) / past) * 100;
}

function sma50Slope(bars: DailyBar[], lookback = 10): number {
  if (bars.length < 50 + lookback) return 0;
  const closes = bars.map((b) => b.close);
  const now = sma(closes.slice(0, closes.length), 50);
  const past = sma(closes.slice(0, closes.length - lookback), 50);
  if (now == null || past == null || past === 0) return 0;
  return ((now - past) / past) * 100;
}

function sma20Slope(bars: DailyBar[], lookback = 5): number {
  if (bars.length < 20 + lookback) return 0;
  const closes = bars.map((b) => b.close);
  const now = sma(closes.slice(0, closes.length), 20);
  const past = sma(closes.slice(0, closes.length - lookback), 20);
  if (now == null || past == null || past === 0) return 0;
  return ((now - past) / past) * 100;
}

// All confirmed pivot highs/lows within the recent window — used to find the
// nearest support (highest pivot low <= price) and resistance (lowest pivot
// high > price) so the desk card can display them.
function nearestSupportResistance(
  bars: DailyBar[],
  price: number,
  left = 3,
  right = 3,
): { support: number | null; resistance: number | null } {
  const lows: number[] = [];
  const highs: number[] = [];
  for (let i = left; i < bars.length - right; i++) {
    const window = bars.slice(i - left, i + right + 1);
    const lo = bars[i].low;
    const hi = bars[i].high;
    if (window.every((b) => b.low >= lo)) lows.push(lo);
    if (window.every((b) => b.high <= hi)) highs.push(hi);
  }
  // Support = highest confirmed pivot low <= current price.
  const support = lows.filter((v) => v <= price).sort((a, b) => b - a)[0] ?? null;
  // Resistance = lowest confirmed pivot high > current price.
  const resistance = highs.filter((v) => v > price).sort((a, b) => a - b)[0] ?? null;
  return { support, resistance };
}

// True Range → 14-bar ATR (Wilder-ish simple average).
function atr(bars: DailyBar[], n = 14): number | null {
  if (bars.length < n + 1) return null;
  const trs: number[] = [];
  for (let i = bars.length - n; i < bars.length; i++) {
    const cur = bars[i];
    const prev = bars[i - 1];
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close),
    );
    trs.push(tr);
  }
  return trs.reduce((a, b) => a + b, 0) / n;
}

// Confirmed pivot low: bar i is a pivot low if `left` bars before AND `right`
// bars after all have low >= bars[i].low. Return the two most recent pivots.
function findRecentPivotLows(
  bars: DailyBar[],
  left = 3,
  right = 3,
): { latest: number | null; prior: number | null; latestBar: DailyBar | null; priorBar: DailyBar | null } {
  const pivots: DailyBar[] = [];
  for (let i = left; i < bars.length - right; i++) {
    const window = bars.slice(i - left, i + right + 1);
    const low = bars[i].low;
    if (window.every((b) => b.low >= low)) {
      pivots.push(bars[i]);
    }
  }
  // Reverse so latest first.
  pivots.reverse();
  const [latestBar = null, priorBar = null] = pivots;
  return {
    latest: latestBar?.low ?? null,
    prior: priorBar?.low ?? null,
    latestBar,
    priorBar,
  };
}

// Latest confirmed pivot HIGH (used as T1 target).
function latestPivotHigh(bars: DailyBar[], left = 3, right = 3): number | null {
  for (let i = bars.length - right - 1; i >= left; i--) {
    const window = bars.slice(i - left, i + right + 1);
    const high = bars[i].high;
    if (window.every((b) => b.high <= high)) return high;
  }
  return null;
}

function averageVolume(bars: DailyBar[], n = 20): number | null {
  if (bars.length < n) return null;
  return bars.slice(-n).reduce((a, b) => a + b.volume, 0) / n;
}

function fmt2(n: number | null | undefined): string {
  return n == null || !isFinite(n) ? "—" : n.toFixed(2);
}
function fmtPct(n: number | null | undefined): string {
  return n == null || !isFinite(n) ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

// ─── Per-ticker classification ───────────────────────────────────────────────
interface TickerContext {
  ticker: string;
  smhContext: SmhContextState;
  smhNote: string;
  vehicleClass: VehicleClass;
}

// Classify each ticker so SMH RED only vetoes growth/tech, never SPY or
// non-growth ETFs (spec Section: SMH_RED permissions).
function classifyVehicle(ticker: string): VehicleClass {
  const t = ticker.toUpperCase();
  if (GROWTH_TECH_TICKERS.has(t)) return "GROWTH_TECH";
  if (BROAD_MARKET_TICKERS.has(t)) return "BROAD_MARKET";
  if (NON_GROWTH_TICKERS.has(t)) return "NON_GROWTH";
  return "OTHER";
}

// Per-vehicle permission derived from the spec's Vehicle-Specific Permissions.
//   GROWTH/TECH  → driven by SMH regime (GREEN=STANDARD_OR_FLEX, YELLOW=FLEX_ONLY, RED=NO_LONG)
//   BROAD_MARKET → evaluated on its own structure (price>200 flat/rising + HL)
//   NON_GROWTH   → evaluated on its own structure; SMH RED does NOT veto
//   OTHER        → evaluated like non-growth (independent)
function computePermission(
  vehicleClass: VehicleClass,
  smhContext: SmhContextState,
  ownStructurePass: boolean,
): VehiclePermission {
  if (vehicleClass === "GROWTH_TECH") {
    if (smhContext === "GREEN")  return ownStructurePass ? "STANDARD_OR_FLEX" : "NO_LONG";
    if (smhContext === "YELLOW") return ownStructurePass ? "FLEX_ONLY" : "NO_LONG";
    return "NO_LONG"; // SMH_RED
  }
  // BROAD / NON_GROWTH / OTHER: independent of SMH regime.
  return ownStructurePass ? "STANDARD_OR_FLEX" : "NO_LONG";
}

function classifyTicker(bars: DailyBar[], ctx: TickerContext): FlexDeskCard {
  const { ticker, smhContext, smhNote, vehicleClass } = ctx;
  const isGrowthTech = vehicleClass === "GROWTH_TECH";

  // Handle insufficient history up front.
  if (bars.length < 210) {
    return standbyCard(ticker, `Insufficient history (${bars.length} bars, need 210).`, smhContext, smhNote, vehicleClass);
  }

  const last = bars[bars.length - 1];
  const prevBar = bars[bars.length - 2];
  const closes = bars.map((b) => b.close);
  const price = last.close;
  const prevClose = prevBar.close;
  const dayChangePct = ((price - prevClose) / prevClose) * 100;
  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);
  const s200 = sma(closes, 200);
  const slope200 = sma200Slope(bars);
  const slope50 = sma50Slope(bars);
  const slope20 = sma20Slope(bars);
  const atr14 = atr(bars);
  const avgVol = averageVolume(bars, 20);
  const relVol = avgVol && avgVol > 0 ? last.volume / avgVol : 1;

  if (s20 == null || s50 == null || s200 == null) {
    return standbyCard(ticker, "SMA(20/50/200) not available.", smhContext, smhNote, vehicleClass);
  }

  const distFrom20  = ((price - s20)  / s20)  * 100;
  const distFrom50  = ((price - s50)  / s50)  * 100;
  const distFrom200 = ((price - s200) / s200) * 100;

  // Primary-trend gate (spec: "flat/rising 200-SMA").
  // Tightened from -0.25% tolerance to 0% — the spec is explicit.
  const primaryTrendPass = price > s200 && slope200 >= 0;

  // Nearest confirmed pivot support/resistance from the recent 6-bar-window scan.
  const sr = nearestSupportResistance(bars, price, 3, 3);

  // Pivots (confirmed via 3-bar lookback each side).
  const pivots = findRecentPivotLows(bars, 3, 3);
  const priorSwingHigh = latestPivotHigh(bars, 3, 3);
  const confirmedHigherLow =
    pivots.latest != null &&
    pivots.prior != null &&
    pivots.latest > pivots.prior * 1.002;

  // Reclaim triggers (close above key level in last 2 bars, held through today).
  const priorDayHigh = prevBar.high;
  const closeAbove20   = price > s20 && prevBar.close > s20;
  const closeAbove50   = price > s50 && prevBar.close > s50;
  const closeAbovePDH  = price > priorDayHigh;
  const closeAbovePivot = priorSwingHigh != null && price > priorSwingHigh * 0.998 && price < priorSwingHigh * 1.05;
  const reclaimTrigger = closeAbove20 || closeAbove50 || closeAbovePDH || closeAbovePivot;

  // Wick vs body: a breakout must close above the level, not just wick through.
  const wickOnlyBreakout =
    priorSwingHigh != null &&
    last.high > priorSwingHigh &&
    price < priorSwingHigh; // pierced high but didn't close above

  // Volume signals: improving = today > yesterday's volume.
  const improvingTriggerVolume = last.volume >= prevBar.volume;

  // "Bounce reclaim" trigger — user-defined:
  //   ≥3% off the 3-day low AND rel-vol ≥1.2x AND within 2% of 20-SMA.
  // Fires the FLEX_READY promotion below and a BOUNCE_RECLAIM regime alert.
  const threeDayLow = bars.length >= 4
    ? Math.min(...bars.slice(-4, -1).map((b) => b.low))
    : null;
  const offLowPct = threeDayLow != null && threeDayLow > 0
    ? ((price - threeDayLow) / threeDayLow) * 100
    : null;
  const bounceReclaimTrigger =
    offLowPct != null && offLowPct >= 3 &&
    relVol >= 1.2 &&
    Math.abs(distFrom20) <= 2;

  // Distance-to-nearest-valid-trigger: how far price is from the closest
  // reclaim level that would fire a trigger (whichever is nearest above).
  const triggerCandidates = [s20, s50, priorSwingHigh, priorDayHigh]
    .filter((v): v is number => v != null && v > price);
  const nearestTrigger = triggerCandidates.length > 0
    ? triggerCandidates.reduce((a, b) => (a < b ? a : b))
    : null;
  const distToTriggerPct = nearestTrigger != null
    ? ((nearestTrigger - price) / price) * 100
    : reclaimTrigger ? 0 : null;

  // Compute plan geometry.
  // Stop = below the invalidation level: prefer the latest confirmed pivot low,
  // fall back to the reclaimed SMA20 minus a small cushion.
  const stopBase = pivots.latest ?? (s20 * 0.99);
  const stopPrice = Math.min(stopBase * 0.995, s20 * 0.99);
  const stopReason = pivots.latest != null
    ? `Below confirmed higher-low pivot at ${fmt2(pivots.latest)}`
    : `Below reclaimed 20-SMA (${fmt2(s20)})`;

  // Projected entry price for planning:
  //   - If a trigger has already fired, plan from current price.
  //   - If not (watch mode), plan from the nearest reclaim level so R:R math
  //     reflects what the trade would actually look like on the trigger.
  const projectedEntry = reclaimTrigger
    ? price
    : Math.max(s20, priorSwingHigh ?? s20);
  const risk = projectedEntry - stopPrice;
  const t1Price = priorSwingHigh != null && priorSwingHigh > projectedEntry * 1.005
    ? priorSwingHigh
    : projectedEntry + Math.max(risk, 0) * 2;
  const t2Price = t1Price + Math.max(risk, 0); // one extra R above T1
  const rrT1 = risk > 0 ? (t1Price - projectedEntry) / risk : 0;
  const rrT2 = risk > 0 ? (t2Price - projectedEntry) / risk : 0;
  const hasClearResistanceRoom = rrT1 >= 1.5;

  // ─── Extension tier (replaces the old universal 1.25-ATR STAND-DOWN gate) ─
  // Compute the tier from Daily SMA20 + Daily ATR14 (this scanner runs on
  // a daily bar series — no timeframe mixing). setupFamily is filled in
  // once we know which state the ticker lands in, so we compute a
  // "provisional" extension summary here for hard-block detection and
  // recompute the summary later with the resolved setup name for the copy.
  const extensionProvisional = (atr14 != null && s20)
    ? summarizeExtension(price, s20, atr14, "unknown")
    : null;
  const extensionTier = extensionProvisional?.tier ?? null;
  // Legacy alias — kept for the fakeout-reasons list only. The old rule
  // hard-blocked at 1.25 ATR; the new rule reserves hard-block for
  // severely_extended (>= 2.0 ATR) and treats 1.25–2.0 as a soft block.
  const chasingBad = extensionTier === "extended" || extensionTier === "severely_extended";
  const severelyExtended = extensionTier === "severely_extended";

  // "Directly below resistance" — only a hard block if we're being visibly
  // rejected: within 0.75% of the pivot high AND today's bar wicked into it
  // without closing above (i.e. real overhead supply). A ticker approaching
  // resistance with a clean base is a breakout setup, not a stand-down.
  const directlyBelowResistance =
    sr.resistance != null &&
    ((sr.resistance - price) / price) * 100 <= 0.75 &&
    last.high >= sr.resistance * 0.999 &&
    price < sr.resistance;

  // ─── Hard blocks (spec: Non-Negotiable Long Rules) ────────────────────────
  // Per spec, a long is blocked only if one of these is true:
  //   1. Price below declining 200-SMA on primary timeframe
  //   2. Confirmed support shelf or higher-low pivot has broken
  //   3. No exact technical stop/invalidation level
  //   4. Directly below material resistance AND < 1.5R to Target 1
  //   5. Wick-only breakout / no close-and-hold or retest
  //   6. Extended > 1.25 ATR above the valid trigger
  //   7. Relative volume < 0.8x average on the trigger bar AND not improving
  //   8. Tech/semi long while SMH is in structural failure (RED)
  // A falling 50-SMA alone is NOT a hard block — it's a STANDARD→FLEX downgrade.
  const hard_blocks: string[] = [];
  if (price < s200 && slope200 < 0) hard_blocks.push(`Below declining 200-SMA (${fmt2(s200)}, slope ${fmtPct(slope200)})`);
  if (sr.support != null && price < sr.support * 0.995) hard_blocks.push(`Below prior confirmed support ${fmt2(sr.support)}`);
  if (wickOnlyBreakout) hard_blocks.push(`Wick-only breakout — no close above ${fmt2(priorSwingHigh!)}`);
  // Extension: only severely_extended (>= 2.0 ATR above SMA20) hard-blocks
  // a new entry, because at that distance no nearby invalidation gives an
  // acceptable stop. 1.25–2.0 ATR is now a SOFT block handled below via
  // state/action downgrade — the ticker stays visible for monitoring.
  if (severelyExtended && extensionProvisional) {
    hard_blocks.push(`Severely extended: +${extensionProvisional.pct_distance.toFixed(1)}% (${extensionProvisional.atr_distance.toFixed(2)} ATR) above 20-SMA (${fmt2(s20)}) — no acceptable stop`);
  }
  // Resistance block only if the room to T1 is < 1.5R (spec rule #4).
  if (directlyBelowResistance && rrT1 < 1.5) {
    hard_blocks.push(`Directly below resistance ${fmt2(sr.resistance!)} with only ${rrT1.toFixed(2)}R to T1`);
  }
  // Volume floor: below 0.8x AND not improving (spec rule #7).
  if (relVol < 0.8 && !improvingTriggerVolume) {
    hard_blocks.push(`Relative volume ${relVol.toFixed(2)}x < 0.8x floor and not improving`);
  }
  // Growth/tech only: SMH RED is a hard block.
  if (isGrowthTech && smhContext === "RED") {
    hard_blocks.push(`SMH RED — tech/semi long blocked while leadership is in structural failure`);
  }

  // SMH alignment gate: only relevant for growth/tech vehicles.
  const smhOK = !isGrowthTech || smhContext !== "RED";

  // ── Per-vehicle permission (spec: SMH RED does NOT veto SPY or non-growth) ─
  // Own structure = price above flat/rising 200-SMA AND has a confirmed HL.
  const ownStructurePass = primaryTrendPass && confirmedHigherLow;
  const permission = computePermission(vehicleClass, smhContext, ownStructurePass);

  // ── STANDARD_READY ─────────────────────────────────────────────────────────
  // Trend continuation: price above flat/rising 200-SMA, above 50-SMA (flat/rising),
  // confirmed HL, reclaim trigger, relVol >= 1.0, T1 >= 2.0R, per spec.
  const standardOk =
    permission === "STANDARD_OR_FLEX" &&
    primaryTrendPass &&
    price > s50 &&
    slope50 >= 0 &&
    confirmedHigherLow &&
    reclaimTrigger &&
    relVol >= 1.0 &&
    rrT1 >= 2.0 &&
    !chasingBad &&
    smhOK &&
    distFrom20 >= 0 && distFrom20 <= 2.5;

  // ── FLEX_READY ─────────────────────────────────────────────────────────────
  // Recovery swing: 200-SMA flat/rising, confirmed HL above support, reclaim of
  // 20-SMA/VWAP/PDH/pivot, 50-SMA may fall but price no more than 3% below it
  // unless a support base with reclaim is confirmed. Half-size only.
  const flexReadyOk =
    (permission === "STANDARD_OR_FLEX" || permission === "FLEX_ONLY") &&
    primaryTrendPass &&
    confirmedHigherLow &&
    reclaimTrigger &&
    distFrom50 >= -3 &&
    improvingTriggerVolume &&
    relVol >= 0.8 &&
    rrT1 >= 1.5 &&
    rrT2 >= 2.0 &&
    hasClearResistanceRoom &&
    !chasingBad &&
    smhOK;

  // ── FLEX_READY via BOUNCE RECLAIM trigger ─────────────────────────────────
  // User-defined trigger: prints as FLEX_READY (half-size) with a stop below
  // the last confirmed swing low. Only fires on non-blocked vehicles.
  const bounceReclaimReadyOk =
    bounceReclaimTrigger &&
    permission !== "NO_LONG" &&
    smhOK &&
    !chasingBad &&
    pivots.latest != null; // must have a real swing low for the stop

  // ── FLEX_WATCH ─────────────────────────────────────────────────────────────
  // Trend intact + potential higher low + near a reclaim level, but trigger not
  // fired yet (or R:R not confirmed). This yields an alert rather than a trade.
  const nearReclaim =
    Math.abs(distFrom20) <= 3 ||
    Math.abs(distFrom50) <= 3 ||
    (priorSwingHigh != null && Math.abs(((price - priorSwingHigh) / priorSwingHigh) * 100) <= 2);
  const flexWatchOk =
    permission !== "NO_LONG" &&
    primaryTrendPass &&
    (confirmedHigherLow || pivots.latest != null) &&
    nearReclaim &&
    !reclaimTrigger;

  // ── Classification ─────────────────────────────────────────────────────────
  let state: FlexState;
  let setup: FlexSetup;
  let risk_grade: FlexRiskGrade;
  let action: FlexAction;
  const fakeoutReasons: string[] = [];

  if (chasingBad) fakeoutReasons.push(`Chase: price ${fmt2(price)} > 1.25 ATR above 20-SMA (${fmt2(s20)})`);
  if (!smhOK)     fakeoutReasons.push(`SMH regime is RED — tech-concentrated ETFs stand down`);
  if (rrT1 < 1.5) fakeoutReasons.push(`Only ${rrT1.toFixed(2)}R to T1 (${fmt2(t1Price)}); need >= 1.5`);
  if (!confirmedHigherLow) fakeoutReasons.push(`No confirmed higher-low pivot yet`);
  if (relVol < 0.8) fakeoutReasons.push(`Relative volume ${relVol.toFixed(2)}x below 0.8x floor`);

  // Compute a provisional score BEFORE deciding state — the spec makes state
  // partly dependent on score (STANDARD >= 80, FLEX >= 65, WATCH >= 45).
  const provisionalScore = computeReadinessScore({
    price, s200, slope200, confirmedHigherLow, reclaimTrigger,
    rrT1, rrT2, relVol, s50, slope50, distFrom50,
    smhContext, vehicleClass, ownStructurePass,
    nearestTrigger, distToTriggerPct, nearestSupport: sr.support,
  });

  if (hard_blocks.length > 0) {
    // Hard-block trumps everything: force STANDBY with the exact list of blocks.
    state = "STANDBY";
    setup = "No trade";
    risk_grade = "NO TRADE";
    action = "STAND DOWN";
  } else if (standardOk && fakeoutReasons.length === 0 && provisionalScore >= 80) {
    state = "STANDARD_READY";
    setup = "Trend continuation";
    risk_grade = "STANDARD SMALL";
    action = "ENTER — SMALL";
  } else if (flexReadyOk && fakeoutReasons.length === 0 && provisionalScore >= 65) {
    state = "FLEX_READY";
    setup = "Higher-low recovery";
    risk_grade = "FLEX HALF SIZE";
    action = "ENTER — HALF SIZE";
  } else if (bounceReclaimReadyOk) {
    // Independent path: bounce-reclaim doesn't require confirmed HL or the
    // 7-bucket score threshold. It's a discrete, well-defined snapback setup.
    state = "FLEX_READY";
    setup = "Bounce reclaim";
    risk_grade = "FLEX HALF SIZE";
    action = "ENTER — HALF SIZE";
  } else if (flexWatchOk && provisionalScore >= 45) {
    state = "FLEX_WATCH";
    setup = "Developing recovery";
    risk_grade = "NO TRADE";
    action = "SET ALERT";
  } else {
    state = "STANDBY";
    setup = "No trade";
    risk_grade = "NO TRADE";
    action = "STAND DOWN";
  }

  // Extension soft-block: 1.25-2.0 ATR (Extended tier).
  // Not a hard block -- ticker stays visible for monitoring -- but a new
  // entry is discouraged. Downgrade READY states to a setup-aware WATCH.
  const setupFamily: SetupFamily = mapSetupFamily(setup);
  const extension = (atr14 != null && s20)
    ? summarizeExtension(price, s20, atr14, setupFamily)
    : null;
  if (extension && extension.tier === "extended" && hard_blocks.length === 0) {
    state = "FLEX_WATCH";
    risk_grade = "NO TRADE";
    action = mapExtensionAction(setupFamily);
    if (!fakeoutReasons.some(r => r.startsWith("Extended:"))) {
      fakeoutReasons.push(`Extended: +${extension.pct_distance.toFixed(1)}% (${extension.atr_distance.toFixed(2)} ATR) above 20-SMA`);
    }
  }

  // ─── Readiness score + distance-to-ready ────────────────────────────────────
  // Spec 7-bucket 100-point framework (see computeReadinessScore below).
  // Build the human-readable distance-to-ready alongside.
  const distance_to_ready: DistanceToReadyItem[] = [];
  // Extension no longer zeroes the score -- apply tier penalty instead.
  const extensionPenalty = extension?.score_penalty ?? 0;
  const rawScore = hard_blocks.length > 0
    ? 0
    : Math.max(0, provisionalScore - extensionPenalty);

  // Primary trend.
  if (!(price > s200 && slope200 >= 0)) {
    distance_to_ready.push({
      name: "200-SMA trend",
      current: `Px ${fmt2(price)} vs 200 ${fmt2(s200)}, slope ${fmtPct(slope200)}`,
      needed: "price > 200-SMA AND slope >= 0 (flat/rising)",
      next_action: price <= s200
        ? `Wait for daily close above 200-SMA (${fmt2(s200)})`
        : `Wait for 200-SMA slope to flatten to at least 0% (currently ${fmtPct(slope200)})`,
    });
  }

  // Structure (higher-low).
  if (!confirmedHigherLow) {
    distance_to_ready.push({
      name: "Confirmed higher low",
      current: pivots.latest != null && pivots.prior != null
        ? `Latest pivot ${fmt2(pivots.latest)} vs prior ${fmt2(pivots.prior)} (needs +0.2%)`
        : `No two confirmed pivot lows yet`,
      needed: "latest pivot low > prior pivot low + 0.2%",
      next_action: pivots.latest == null
        ? "Wait for a confirmed pivot low (3 bars each side)"
        : `Need latest pivot >= ${fmt2((pivots.prior ?? pivots.latest) * 1.002)}`,
    });
  }

  // Trigger.
  if (!reclaimTrigger) {
    distance_to_ready.push({
      name: "Reclaim trigger",
      current: nearestTrigger != null
        ? `Px ${fmt2(price)}, nearest trigger ${fmt2(nearestTrigger)} (${(distToTriggerPct ?? 0).toFixed(2)}% away)`
        : `No trigger level within reach`,
      needed: "close AND hold above 20-SMA / 50-SMA / pivot high / prior-day high",
      next_action: nearestTrigger != null
        ? `Wait for close-and-hold above ${fmt2(nearestTrigger)}`
        : "Wait for base to build closer to a reclaim level",
    });
  }

  // Location (entry vs 50-SMA base).
  if (distFrom50 < -3) {
    distance_to_ready.push({
      name: "Entry location vs 50-SMA",
      current: `Px ${fmt2(price)} is ${distFrom50.toFixed(2)}% below 50-SMA ${fmt2(s50)}`,
      needed: "price within -3% of 50-SMA or clear reclaim base + close-and-hold",
      next_action: `Wait for price to lift toward ${fmt2(s50 * 0.97)}, or confirm a reclaim base — not a hard block on its own`,
    });
  }

  // R:R tiers.
  if (rrT1 < 1.5) {
    distance_to_ready.push({
      name: "R:R to T1",
      current: `${rrT1.toFixed(2)}R (T1 ${fmt2(t1Price)}, stop ${fmt2(stopPrice)})`,
      needed: ">= 1.5R (FLEX) or >= 2.0R (STANDARD)",
      next_action: `Wait for pullback closer to stop ${fmt2(stopPrice)}, or a higher T1 level`,
    });
  } else if (rrT1 < 2.0) {
    distance_to_ready.push({
      name: "R:R to T1 (STANDARD gap)",
      current: `${rrT1.toFixed(2)}R (FLEX-eligible)`,
      needed: ">= 2.0R for STANDARD",
      next_action: "Take FLEX half-size, or wait for setup with >= 2.0R for STANDARD",
    });
  }

  // Volume.
  if (relVol < 0.8) {
    distance_to_ready.push({
      name: "Relative volume",
      current: `${relVol.toFixed(2)}x (${improvingTriggerVolume ? "improving" : "not improving"})`,
      needed: ">= 0.8x (FLEX) or >= 1.0x (STANDARD)",
      next_action: "Wait for a session with rel-vol at or above the 20-day average",
    });
  } else if (relVol < 1.0) {
    distance_to_ready.push({
      name: "Relative volume (STANDARD gap)",
      current: `${relVol.toFixed(2)}x (FLEX-eligible)`,
      needed: ">= 1.0x for STANDARD",
      next_action: "Take FLEX half-size, or wait for volume for STANDARD",
    });
  }

  // Market alignment via SMH (growth/tech only).
  if (isGrowthTech && smhContext !== "GREEN") {
    distance_to_ready.push({
      name: "Market confirmation (SMH)",
      current: `SMH ${smhContext} — ${smhNote}`,
      needed: smhContext === "RED"
        ? "SMH GREEN or YELLOW to consider tech/semi longs"
        : "SMH GREEN for STANDARD (YELLOW is FLEX-only)",
      next_action: smhContext === "RED"
        ? "Stand down on tech/semi until SMH reclaims 200-SMA with non-negative slope"
        : "Take FLEX half-size only until SMH regime turns GREEN",
    });
  }

  // Hard blocks dominate distance-to-ready.
  if (hard_blocks.length > 0) {
    for (const b of hard_blocks) {
      distance_to_ready.unshift({
        name: "Hard block",
        current: b,
        needed: "clear the hard block",
        next_action: `Hard-block active — ${b}`,
      });
    }
  }

  const readiness_score = Math.max(0, Math.min(100, Math.round(rawScore)));

  // Market confirmation summary. Growth/tech is gated by SMH regime;
  // broad/non-growth is judged on its own structure (SMH doesn't apply).
  let market_confirmation: FlexDeskCard["market_confirmation"];
  if (hard_blocks.length > 0) {
    market_confirmation = "INVALIDATED";
  } else if (isGrowthTech) {
    market_confirmation =
      smhContext === "RED" ? "INVALIDATED" :
      smhContext === "GREEN" && primaryTrendPass ? "CONFIRMED" :
      "MIXED";
  } else {
    market_confirmation =
      primaryTrendPass && confirmedHigherLow ? "CONFIRMED" :
      primaryTrendPass ? "MIXED" :
      "INVALIDATED";
  }

  // Fakeout final verdict.
  const fakeout_result: "PASS" | "FAIL" = fakeoutReasons.length === 0 ? "PASS" : "FAIL";

  // Setup timeframes and entry zones vary slightly by state.
  const entryLow  = state === "FLEX_WATCH" ? projectedEntry
                  : state === "STANDARD_READY" ? Math.max(price, s20)
                  : price;
  const entryHigh = state === "FLEX_WATCH" ? projectedEntry * 1.01
                  : state === "STANDARD_READY" ? s20 * 1.015
                  : price * 1.01;

  const isStandby = state === "STANDBY";

  return {
    state,
    ticker,
    setup,
    readiness_score,
    distance_to_ready,
    trend: `Px ${fmt2(price)} vs 20 ${fmt2(s20)} / 50 ${fmt2(s50)} / 200 ${fmt2(s200)}; 200-SMA slope ${fmtPct(slope200)}, 50-SMA slope ${fmtPct(slope50)}`,
    structure: confirmedHigherLow
      ? `Confirmed HL: latest pivot ${fmt2(pivots.latest)} > prior ${fmt2(pivots.prior)} (+${(((pivots.latest! - pivots.prior!) / pivots.prior!) * 100).toFixed(2)}%)`
      : `Base near ${fmt2(pivots.latest)}; HL not yet confirmed`,
    trigger: isStandby
      ? (hard_blocks.length > 0 ? `Blocked: ${hard_blocks[0]}` : "None active.")
      : state === "FLEX_WATCH"
        ? `Awaiting close above ${fmt2(Math.max(s20, priorSwingHigh ?? s20))} with follow-through`
        : buildTriggerDescription(closeAbove20, closeAbove50, closeAbovePDH, closeAbovePivot, s20, s50, priorDayHigh, priorSwingHigh),
    entry_zone: isStandby
      ? { low: null, high: null, note: "No entry — capital protection." }
      : {
          low: Number(entryLow.toFixed(2)),
          high: Number(entryHigh.toFixed(2)),
          note: state === "STANDARD_READY" ? "Pullback into 20-SMA; enter on close-and-hold" :
                state === "FLEX_READY"     ? "Half size; enter only after close-and-hold or retest" :
                                             "No entry — set alert at trigger",
        },
    stop: isStandby
      ? { price: null, reason: "N/A while blocked" }
      : { price: Number(stopPrice.toFixed(2)), reason: stopReason },
    target_1: isStandby
      ? { price: null, r_multiple: null }
      : { price: Number(t1Price.toFixed(2)), r_multiple: Number(rrT1.toFixed(2)) },
    target_2: (isStandby || state === "FLEX_WATCH")
      ? null
      : { price: Number(t2Price.toFixed(2)), r_multiple: Number(rrT2.toFixed(2)) },
    risk_grade,
    fakeout_check: {
      result: fakeout_result,
      reasons: fakeoutReasons,
    },
    smh_market_context: isGrowthTech
      ? `SMH ${smhContext} — ${smhNote}`
      : `Independent vehicle (${vehicleClass.replace("_", " ").toLowerCase()}) — SMH ${smhContext} does not gate this ticker.`,
    market_confirmation,
    action,
    hard_blocks,
    vehicle_class: vehicleClass,
    permission,
    // Additive: extension tier + score sub-facets (all optional in the type).
    extension,
    entry_quality: computeEntryQuality(extension, rrT1),
    risk_permission: computeRiskPermission(hard_blocks, extension),
    metrics: buildMetrics({
      price, prevClose, dayChangePct, s20, s50, s200,
      slope20, slope50, slope200,
      distFrom20, distFrom50, distFrom200,
      relVol, atr14,
      confirmedHigherLow, reclaimTrigger,
      pivots, priorSwingHigh,
      support: sr.support, resistance: sr.resistance,
      distToTriggerPct,
      threeDayLow,
      bounceReclaimTrigger,
    }),
  };
}

function mapExtensionAction(fam: SetupFamily): FlexAction {
  // FlexAction is a narrow union; we can only pick values it already permits.
  // "SET ALERT" is the closest existing verb for a soft-blocked new entry
  // that stays on the desk for monitoring. UI copy uses extension.headline
  // and extension.next_action for the fuller "WAIT FOR PULLBACK / DO NOT
  // CHASE" language so we do not have to widen the FlexAction union.
  return "SET ALERT" as FlexAction;
}

function computeEntryQuality(
  extension: { tier: string; score_penalty: number } | null | undefined,
  rrT1: number,
): number {
  // 0-100 heuristic: perfect R:R with no extension penalty => 100.
  const rrScore = Math.max(0, Math.min(60, (rrT1 / 3) * 60)); // 0..60 for R:R 0..3
  const extScore = extension
    ? Math.max(0, 40 - extension.score_penalty * 0.4) // caution=-4, ext=-10, sev=-40
    : 40;
  return Math.round(rrScore + extScore);
}

function computeRiskPermission(
  hard_blocks: string[],
  extension: { tier: string } | null | undefined,
): "ALLOWED" | "REDUCED" | "WATCH" | "BLOCKED" {
  if (hard_blocks.length > 0) return "BLOCKED";
  if (extension?.tier === "extended") return "WATCH";
  if (extension?.tier === "caution") return "REDUCED";
  return "ALLOWED";
}

function buildTriggerDescription(
  a20: boolean, a50: boolean, aPDH: boolean, aPivot: boolean,
  s20: number, s50: number, priorDayHigh: number, pivotHigh: number | null,
): string {
  const parts: string[] = [];
  if (a20)   parts.push(`Reclaimed 20-SMA at ${fmt2(s20)}`);
  if (a50)   parts.push(`Reclaimed 50-SMA at ${fmt2(s50)}`);
  if (aPDH)  parts.push(`Closed above prior-day high ${fmt2(priorDayHigh)}`);
  if (aPivot && pivotHigh != null) parts.push(`Broke pivot high ${fmt2(pivotHigh)}`);
  return parts.length ? parts.join("; ") : "No qualifying trigger this bar";
}

function buildMetrics(a: {
  price: number; prevClose: number; dayChangePct: number;
  s20: number; s50: number; s200: number;
  slope20: number; slope50: number; slope200: number;
  distFrom20: number; distFrom50: number; distFrom200: number;
  relVol: number; atr14: number | null;
  confirmedHigherLow: boolean; reclaimTrigger: boolean;
  pivots: ReturnType<typeof findRecentPivotLows>; priorSwingHigh: number | null;
  support: number | null; resistance: number | null;
  distToTriggerPct: number | null;
  threeDayLow: number | null;
  bounceReclaimTrigger: boolean;
}): FlexMetrics {
  return {
    price: Number(a.price.toFixed(2)),
    prev_close: Number(a.prevClose.toFixed(2)),
    day_change_pct: Number(a.dayChangePct.toFixed(2)),
    sma20: Number(a.s20.toFixed(2)),
    sma50: Number(a.s50.toFixed(2)),
    sma200: Number(a.s200.toFixed(2)),
    sma20_slope_pct: Number(a.slope20.toFixed(2)),
    sma50_slope_pct: Number(a.slope50.toFixed(2)),
    sma200_slope_pct: Number(a.slope200.toFixed(2)),
    dist_from_sma20_pct: Number(a.distFrom20.toFixed(2)),
    dist_from_sma50_pct: Number(a.distFrom50.toFixed(2)),
    dist_from_sma200_pct: Number(a.distFrom200.toFixed(2)),
    relative_volume: Number(a.relVol.toFixed(2)),
    atr14: a.atr14 != null ? Number(a.atr14.toFixed(2)) : undefined,
    confirmed_higher_low: a.confirmedHigherLow,
    reclaim_trigger: a.reclaimTrigger,
    prior_pivot_low: a.pivots.prior,
    latest_pivot_low: a.pivots.latest,
    prior_swing_high: a.priorSwingHigh,
    nearest_support: a.support,
    nearest_resistance: a.resistance,
    dist_to_trigger_pct: a.distToTriggerPct != null ? Number(a.distToTriggerPct.toFixed(2)) : null,
    three_day_low: a.threeDayLow != null ? Number(a.threeDayLow.toFixed(2)) : null,
    off_low_pct: a.threeDayLow != null && a.threeDayLow > 0
      ? Number((((a.price - a.threeDayLow) / a.threeDayLow) * 100).toFixed(2))
      : null,
    bounce_reclaim_trigger: a.bounceReclaimTrigger,
  };
}

function standbyCard(
  ticker: string,
  reason: string,
  smhContext: SmhContextState,
  smhNote: string,
  vehicleClass: VehicleClass,
  extras: Partial<FlexDeskCard> = {},
): FlexDeskCard {
  return {
    state: "STANDBY",
    ticker,
    vehicle_class: vehicleClass,
    permission: "NO_LONG",
    setup: "No trade",
    readiness_score: 0,
    distance_to_ready: [{
      name: "Setup viability",
      current: reason,
      needed: "a valid setup with full history and SMAs",
      next_action: `Resolve: ${reason}`,
    }],
    trend: reason,
    structure: "Not qualified.",
    trigger: "None active.",
    entry_zone: { low: null, high: null, note: "No entry — capital protection." },
    stop: { price: null, reason: "N/A" },
    target_1: { price: null, r_multiple: null },
    target_2: null,
    risk_grade: "NO TRADE",
    fakeout_check: { result: "FAIL", reasons: [reason] },
    smh_market_context: `Market: ${smhNote} (SMH ${smhContext})`,
    market_confirmation: "MIXED",
    action: "STAND DOWN",
    hard_blocks: [reason],
    ...extras,
  };
}

// ─── Readiness score ────────────────────────────────────────────────────────
// Spec 7-bucket 100-point framework. Called before the state decision so
// state gates (>=80/65/45) can consume the result.
interface ScoreInputs {
  price: number; s200: number; slope200: number;
  confirmedHigherLow: boolean; reclaimTrigger: boolean;
  rrT1: number; rrT2: number;
  relVol: number;
  s50: number; slope50: number; distFrom50: number;
  smhContext: SmhContextState;
  vehicleClass: VehicleClass;
  ownStructurePass: boolean;
  nearestTrigger: number | null;
  distToTriggerPct: number | null;
  nearestSupport: number | null;
}

function computeReadinessScore(x: ScoreInputs): number {
  // primaryTrendScore (0-20).
  let primary = 0;
  if (x.price > x.s200 && x.slope200 >= 0) primary = 20;
  else if (x.price > x.s200 && x.slope200 >= -0.5) primary = 12;
  else if (x.price > x.s200) primary = 6;

  // structureScore (0-20).
  let structure = 0;
  if (x.confirmedHigherLow) structure += 15;
  if (x.nearestSupport != null && x.price >= x.nearestSupport) structure += 5;

  // triggerScore (0-15).
  const trigger =
    x.reclaimTrigger                                                     ? 15 :
    (x.distToTriggerPct != null && x.distToTriggerPct <= 1.0)            ? 10 :
    (x.distToTriggerPct != null && x.distToTriggerPct <= 2.5)            ?  6 : 0;

  // locationScore (0-10) — entry vs 50-SMA base.
  let location = 0;
  if (x.distFrom50 >= -3 && x.distFrom50 <= 5) location = 10;
  else if (x.distFrom50 >= -6) location = 5;

  // rrScore (0-15).
  const rr =
    x.rrT1 >= 2.0 && x.rrT2 >= 2.0 ? 15 :
    x.rrT1 >= 1.5                  ? 10 :
    x.rrT1 >= 1.0                  ?  5 : 0;

  // volumeScore (0-10).
  const vol =
    x.relVol >= 1.0 ? 10 :
    x.relVol >= 0.8 ?  7 :
    x.relVol >= 0.6 ?  3 : 0;

  // marketAlignmentScore (0-10).
  let market = 0;
  if (x.vehicleClass === "GROWTH_TECH") {
    market = x.smhContext === "GREEN" ? 10 : x.smhContext === "YELLOW" ? 6 : 0;
  } else {
    market = x.ownStructurePass ? 10 : x.price > x.s200 ? 5 : 0;
  }

  return primary + structure + trigger + location + rr + vol + market;
}

// ─── Day-type classification ────────────────────────────────────────────────
function classifyDay(
  cards: FlexDeskCard[],
  smhContext: SmhContextState,
): { day_type: FlexDayType; account: FlexScanResult["account_instructions"] } {
  // Only count vehicles the desk actually intends to trade this session:
  // broad-market + non-growth ETFs are evaluated independently of SMH.
  const readyCards  = cards.filter((c) => c.state === "STANDARD_READY" || c.state === "FLEX_READY");
  const watchCards  = cards.filter((c) => c.state === "FLEX_WATCH");
  const readyNonGrowth = readyCards.filter((c) => c.vehicle_class !== "GROWTH_TECH").length;
  const readyGrowth    = readyCards.filter((c) => c.vehicle_class === "GROWTH_TECH").length;
  const standard = cards.filter((c) => c.state === "STANDARD_READY").length;
  const flex     = cards.filter((c) => c.state === "FLEX_READY").length;
  const watch    = watchCards.length;

  // Spec: SMH RED alone must NOT force STANDBY_DAY — broad/non-growth still evaluated.
  // Only mark STANDBY_DAY when there are zero ready + zero watch across all vehicles.
  if (standard + flex + watch === 0) {
    return {
      day_type: "STANDBY_DAY",
      account: {
        swing: smhContext === "RED"
          ? "SMH RED and no qualifying broad/non-growth setup. Capital protection only."
          : "No qualifying setup. Stand down.",
        etf: "Hold core positions; no additions.",
        single_stock: "Base DCA only into core (VOO/VTI/SCHD).",
      },
    };
  }

  if (standard >= 1) {
    return {
      day_type: "PRACTICE_SWING_DAY",
      account: {
        swing: `${standard} STANDARD_READY (${readyGrowth} growth/tech, ${readyNonGrowth} broad/non-growth) — small practice size only, defined dollar risk.`,
        etf: "Hold core positions; no additions triggered by swing signals.",
        single_stock: "Base DCA only. Do not convert failed swing into long-term hold.",
      },
    };
  }
  if (flex >= 1) {
    return {
      day_type: "PRACTICE_SWING_DAY",
      account: {
        swing: `${flex} FLEX_READY (${readyGrowth} growth/tech, ${readyNonGrowth} broad/non-growth) — HALF practice size only, defined dollar risk.`,
        etf: "Hold core positions; no additions.",
        single_stock: "Base DCA only.",
      },
    };
  }
  // Only watch cards — no trigger, but broad/non-growth may still be scheduled DCA candidates.
  return {
    day_type: "ETF_EXPOSURE_DAY",
    account: {
      swing: `No triggers. ${watch} FLEX_WATCH — create alerts, no entry.`,
      etf: smhContext === "RED"
        ? "Hold; consider scheduled DCA into non-growth core (SCHD/VOO) only."
        : "Hold; consider scheduled DCA into core ETFs.",
      single_stock: "Base DCA only.",
    },
  };
}

// Given the SMH regime snapshot, translate to GREEN/YELLOW/RED context state
// and a short human-readable note for card copy.
function mapSmhContext(
  smh: Awaited<ReturnType<typeof computeSmhRegime>>,
  smhBars: DailyBar[] | null,
): { state: SmhContextState; note: string } {
  const { smh: s } = smh;

  // Fallback: no SMH bars — degrade gracefully via structure_messy/trend_intact.
  if (!smhBars || smhBars.length < 210) {
    if (s.structure_messy || !s.trend_intact) {
      return { state: "RED", note: `SMH ${fmt2(s.last)} — trend/structure impaired (insufficient bars for full 200-SMA gate).` };
    }
    return { state: "YELLOW", note: `SMH ${fmt2(s.last)} — insufficient bars for full 200-SMA gate.` };
  }

  const closes = smhBars.map((b) => b.close);
  const price = closes[closes.length - 1];
  const s50 = sma(closes, 50);
  const s200v = sma(closes, 200);
  const slope50 = sma50Slope(smhBars, 10);
  const slope200 = sma200Slope(smhBars, 20);

  if (s50 == null || s200v == null) {
    return { state: "RED", note: `SMH: SMAs unavailable.` };
  }

  const pivots = findRecentPivotLows(smhBars, 3, 3);
  const confirmedHL =
    pivots.latest != null && pivots.prior != null &&
    pivots.latest > pivots.prior * 1.002;

  const above200 = price > s200v;
  const above50  = price > s50;
  const s200FlatOrRising = slope200 >= 0;
  const s50FlatOrRising  = slope50  >= 0;

  // RED: below declining 200-SMA OR structural failure.
  if ((!above200 && slope200 < 0) || s.structure_messy) {
    return {
      state: "RED",
      note: `SMH ${fmt2(price)} vs 200 ${fmt2(s200v)} slope ${fmtPct(slope200)}, drawdown ${fmtPct(s.drawdown_from_peak_pct)} — structural failure.`,
    };
  }

  // GREEN: price > 50 AND > 200; both slopes flat/rising; HL confirmed.
  if (above200 && above50 && s200FlatOrRising && s50FlatOrRising && confirmedHL) {
    return {
      state: "GREEN",
      note: `SMH ${fmt2(price)} above 20/50/200; slopes 50 ${fmtPct(slope50)} / 200 ${fmtPct(slope200)}; HL confirmed.`,
    };
  }

  // YELLOW: above flat/rising 200-SMA, may be under falling 50-SMA, HL forming.
  if (above200 && s200FlatOrRising) {
    return {
      state: "YELLOW",
      note: `SMH ${fmt2(price)} above 200 (slope ${fmtPct(slope200)}); ${above50 ? "holding 50" : "below 50 (slope " + fmtPct(slope50) + ")"}; ${confirmedHL ? "HL confirmed" : "HL forming"} — flex-only.`,
    };
  }

  // Otherwise RED.
  return {
    state: "RED",
    note: `SMH ${fmt2(price)} — below flat/rising 200-SMA or no confirmed HL.`,
  };
}

// ─── Public entry point ─────────────────────────────────────────────────────

export async function runFlexScan(req: FlexScanRequest = {}): Promise<FlexScanResult> {
  // Merge pinned tickers into whichever universe the caller passed. SMH/QQQ/SPY
  // are always evaluated even if the caller doesn't ask for them so the desk
  // has continuous eyes on leading-market, tech, and broad-tape posture.
  const requested = (req.universe && req.universe.length > 0 ? req.universe : DEFAULT_UNIVERSE)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const universe = Array.from(new Set([...PINNED_TICKERS, ...requested]));

  // Fetch SMH bars once so we can derive the spec's three-state regime with
  // SMH's own 200-SMA and slope (smhRegime.ts only tracks 20/50).
  let smhBarsForRegime: DailyBar[] | null = null;
  try { smhBarsForRegime = await safeHistory("SMH"); } catch { smhBarsForRegime = null; }
  const smhSnap = await computeSmhRegime();
  const { state: smhState, note: smhNote } = mapSmhContext(smhSnap, smhBarsForRegime);

  const cards: FlexDeskCard[] = [];
  const errors: string[] = [];

  await Promise.all(universe.map(async (ticker) => {
    try {
      const bars = await safeHistory(ticker);
      const vehicleClass = classifyVehicle(ticker);
      const card = classifyTicker(bars, { ticker, smhContext: smhState, smhNote, vehicleClass });
      if (PINNED_TICKERS.includes(ticker)) card.pinned = true;
      cards.push(card);
    } catch (err) {
      errors.push(`${ticker}: ${err instanceof Error ? err.message : "history fetch failed"}`);
    }
  }));

  // Deterministic order: pinned tickers first (SMH → QQQ → SPY),
  // then remaining cards by STANDARD_READY → FLEX_READY → FLEX_WATCH → STANDBY,
  // then by readiness score descending, then by ticker.
  const priority: Record<FlexState, number> = {
    STANDARD_READY: 0,
    FLEX_READY: 1,
    FLEX_WATCH: 2,
    STANDBY: 3,
  };
  const pinnedRank = (t: string) => {
    const i = PINNED_TICKERS.indexOf(t);
    return i === -1 ? 999 : i;
  };
  cards.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (b.pinned && !a.pinned) return 1;
    if (a.pinned && b.pinned) return pinnedRank(a.ticker) - pinnedRank(b.ticker);
    return (
      priority[a.state] - priority[b.state] ||
      (b.readiness_score ?? 0) - (a.readiness_score ?? 0) ||
      a.ticker.localeCompare(b.ticker)
    );
  });

  const { day_type, account } = classifyDay(cards, smhState);

  const readyCount = cards.filter((c) => c.state === "STANDARD_READY" || c.state === "FLEX_READY").length;
  const watchCount = cards.filter((c) => c.state === "FLEX_WATCH").length;
  const one_sentence_summary = `SMH ${smhState} · ${readyCount} ready, ${watchCount} watch — ${
    day_type === "PRACTICE_SWING_DAY" ? "practice-size swings live" :
    day_type === "ETF_EXPOSURE_DAY"   ? "no triggers, alerts only" :
                                        "stand down for capital protection"
  }.`;

  return {
    computed_at: new Date().toISOString(),
    day_type,
    smh_context: { state: smhState, note: smhNote },
    cards,
    account_instructions: account,
    one_sentence_summary,
  };
}
