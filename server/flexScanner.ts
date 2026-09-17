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
  isTechConcentrated: boolean;
}

function classifyTicker(bars: DailyBar[], ctx: TickerContext): FlexDeskCard {
  const { ticker, smhContext, smhNote, isTechConcentrated } = ctx;

  // Handle insufficient history up front.
  if (bars.length < 210) {
    return standbyCard(ticker, `Insufficient history (${bars.length} bars, need 210).`, smhContext, smhNote);
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
    return standbyCard(ticker, "SMA(20/50/200) not available.", smhContext, smhNote);
  }

  const distFrom20  = ((price - s20)  / s20)  * 100;
  const distFrom50  = ((price - s50)  / s50)  * 100;
  const distFrom200 = ((price - s200) / s200) * 100;

  // Primary-trend gate: must be above a flat/rising 200-SMA.
  const primaryTrendPass = price > s200 && slope200 >= -0.25;

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

  // Anti-fakeout: chasing gate (>1.25 ATR above last close's reclaim level).
  const chasingBad = atr14 != null && s20 && price > s20 + atr14 * 1.25;

  // "Directly below resistance" — only a hard block if we're being visibly
  // rejected: within 0.75% of the pivot high AND today's bar wicked into it
  // without closing above (i.e. real overhead supply). A ticker approaching
  // resistance with a clean base is a breakout setup, not a stand-down.
  const directlyBelowResistance =
    sr.resistance != null &&
    ((sr.resistance - price) / price) * 100 <= 0.75 &&
    last.high >= sr.resistance * 0.999 &&
    price < sr.resistance;

  // ─── Hard blocks (spec: never long under any of these) ────────────────────
  const hard_blocks: string[] = [];
  if (price < s200 && slope200 < 0) hard_blocks.push(`Below declining 200-SMA (${fmt2(s200)}, slope ${fmtPct(slope200)})`);
  if (sr.support != null && price < sr.support * 0.995) hard_blocks.push(`Below prior confirmed support ${fmt2(sr.support)}`);
  if (wickOnlyBreakout) hard_blocks.push(`Wick-only breakout — no close above ${fmt2(priorSwingHigh!)}`);
  if (chasingBad) hard_blocks.push(`Extended: price ${fmt2(price)} > 1.25 ATR above 20-SMA (${fmt2(s20)})`);
  if (directlyBelowResistance) hard_blocks.push(`Directly below resistance at ${fmt2(sr.resistance!)}`);
  if (isTechConcentrated && smhContext === "RED") hard_blocks.push(`SMH RED invalidates growth-risk exposure`);

  // Semi/tech alignment gate.
  const smhOK = !isTechConcentrated || smhContext !== "RED";

  // ── STANDARD_READY ─────────────────────────────────────────────────────────
  const standardOk =
    primaryTrendPass &&
    price > s50 &&
    slope50 >= -0.10 &&
    confirmedHigherLow &&
    reclaimTrigger &&
    relVol >= 1.0 &&
    rrT1 >= 2.0 &&
    !chasingBad &&
    smhOK &&
    distFrom20 >= 0 && distFrom20 <= 2.5;

  // ── FLEX_READY ─────────────────────────────────────────────────────────────
  const flexReadyOk =
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

  // ── FLEX_WATCH ─────────────────────────────────────────────────────────────
  // Trend intact + potential higher low + near a reclaim level, but trigger not
  // fired yet (or R:R not confirmed). This yields an alert rather than a trade.
  const nearReclaim =
    Math.abs(distFrom20) <= 3 ||
    Math.abs(distFrom50) <= 3 ||
    (priorSwingHigh != null && Math.abs(((price - priorSwingHigh) / priorSwingHigh) * 100) <= 2);
  const flexWatchOk =
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

  if (hard_blocks.length > 0) {
    // Hard-block trumps everything: force STANDBY with the exact list of blocks.
    state = "STANDBY";
    setup = "No trade";
    risk_grade = "NO TRADE";
    action = "STAND DOWN";
  } else if (standardOk) {
    state = "STANDARD_READY";
    setup = "Trend continuation";
    risk_grade = "STANDARD SMALL";
    action = "ENTER ONLY ON TRIGGER";
  } else if (flexReadyOk) {
    state = "FLEX_READY";
    setup = "Higher-low recovery";
    risk_grade = "FLEX HALF SIZE";
    action = "ENTER ONLY ON TRIGGER";
  } else if (flexWatchOk) {
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

  // ─── Readiness score + distance-to-ready ────────────────────────────────────
  // The score aggregates seven weighted gates. Every unmet gate also
  // contributes one DistanceToReadyItem so the desk sees exactly what's
  // missing, its current value, the needed value, and the next action.
  const distance_to_ready: DistanceToReadyItem[] = [];
  let score = 0;

  // 200-SMA trend (25 pts).
  if (price > s200 && slope200 >= 0) score += 25;
  else if (price > s200 && slope200 >= -0.25) score += 15;
  else {
    distance_to_ready.push({
      name: "200-SMA trend",
      current: `Px ${fmt2(price)} vs 200 ${fmt2(s200)}, slope ${fmtPct(slope200)}`,
      needed: "price > 200-SMA AND slope >= 0",
      next_action: price <= s200
        ? `Wait for daily close above 200-SMA (${fmt2(s200)})`
        : `Wait for 200-SMA slope to turn non-negative (currently ${fmtPct(slope200)})`,
    });
  }

  // Higher-low structure (20 pts).
  if (confirmedHigherLow) score += 20;
  else {
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

  // Reclaim trigger (20 pts).
  if (reclaimTrigger) score += 20;
  else {
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

  // R:R at T1 (15 pts, tiered).
  if (rrT1 >= 2.0) score += 15;
  else if (rrT1 >= 1.5) score += 10;
  else {
    distance_to_ready.push({
      name: "R:R to T1",
      current: `${rrT1.toFixed(2)}R`,
      needed: ">= 1.5R (FLEX) or >= 2.0R (STANDARD)",
      next_action: `Need pullback to entry closer to stop ${fmt2(stopPrice)} or higher T1`,
    });
  }

  // Relative volume (10 pts, tiered).
  if (relVol >= 1.0) score += 10;
  else if (relVol >= 0.8) score += 6;
  else {
    distance_to_ready.push({
      name: "Relative volume",
      current: `${relVol.toFixed(2)}x`,
      needed: ">= 0.8x (FLEX) or >= 1.0x (STANDARD)",
      next_action: "Wait for a session with rel-vol at or above the 20-day average",
    });
  }

  // 50-SMA posture (5 pts).
  if (price > s50 && slope50 >= 0) score += 5;
  else if (distFrom50 >= -3) score += 3;
  else {
    distance_to_ready.push({
      name: "50-SMA posture",
      current: `Px ${fmt2(price)} vs 50 ${fmt2(s50)}, slope ${fmtPct(slope50)}`,
      needed: "price within -3% of 50-SMA or above with slope >= 0",
      next_action: `Wait for price to reclaim 50-SMA at ${fmt2(s50)}`,
    });
  }

  // Market confirmation via SMH (5 pts).
  if (smhContext === "GREEN") score += 5;
  else if (smhContext === "YELLOW") score += 3;
  else if (isTechConcentrated) {
    distance_to_ready.push({
      name: "Market confirmation (SMH)",
      current: `SMH RED — ${smhNote}`,
      needed: "SMH GREEN or YELLOW (not RED for tech-concentrated tickers)",
      next_action: "Wait for SMH to reclaim its 50-SMA with non-negative slope",
    });
  }

  // Hard blocks zero the score, and their reasons dominate distance-to-ready.
  if (hard_blocks.length > 0) {
    score = 0;
    for (const b of hard_blocks) {
      distance_to_ready.unshift({
        name: "Hard block",
        current: b,
        needed: "clear the hard block",
        next_action: `Hard-block active — ${b}`,
      });
    }
  }

  const readiness_score = Math.max(0, Math.min(100, Math.round(score)));

  // Market confirmation summary from SMH + broad-trend gate.
  const market_confirmation: FlexDeskCard["market_confirmation"] =
    hard_blocks.length > 0 || smhContext === "RED" && isTechConcentrated
      ? "INVALIDATED"
      : smhContext === "GREEN" && primaryTrendPass
        ? "CONFIRMED"
        : "MIXED";

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
    smh_market_context: isTechConcentrated
      ? `SMH ${smhContext} — ${smhNote}`
      : `Market: ${smhNote}`,
    market_confirmation,
    action,
    hard_blocks,
    metrics: buildMetrics({
      price, prevClose, dayChangePct, s20, s50, s200,
      slope20, slope50, slope200,
      distFrom20, distFrom50, distFrom200,
      relVol, atr14,
      confirmedHigherLow, reclaimTrigger,
      pivots, priorSwingHigh,
      support: sr.support, resistance: sr.resistance,
      distToTriggerPct,
    }),
  };
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
  };
}

function standbyCard(
  ticker: string,
  reason: string,
  smhContext: SmhContextState,
  smhNote: string,
  extras: Partial<FlexDeskCard> = {},
): FlexDeskCard {
  return {
    state: "STANDBY",
    ticker,
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

// ─── Day-type classification ────────────────────────────────────────────────
function classifyDay(
  cards: FlexDeskCard[],
  smhContext: SmhContextState,
): { day_type: FlexDayType; account: FlexScanResult["account_instructions"] } {
  const standard = cards.filter((c) => c.state === "STANDARD_READY").length;
  const flex     = cards.filter((c) => c.state === "FLEX_READY").length;
  const watch    = cards.filter((c) => c.state === "FLEX_WATCH").length;

  if (smhContext === "RED") {
    return {
      day_type: "STANDBY_DAY",
      account: {
        swing: "No swing entries. Capital protection only.",
        etf: "Hold core positions; no additions.",
        single_stock: "Base DCA only into diversified core (VOO/VTI/SCHD).",
      },
    };
  }
  if (standard >= 1) {
    return {
      day_type: "PRACTICE_SWING_DAY",
      account: {
        swing: `${standard} STANDARD_READY setup(s) — small practice size only, defined dollar risk.`,
        etf: "Hold core positions; no additions triggered by swing signals.",
        single_stock: "Base DCA only. Do not convert failed swing into long-term hold.",
      },
    };
  }
  if (flex >= 1) {
    return {
      day_type: "PRACTICE_SWING_DAY",
      account: {
        swing: `${flex} FLEX_READY setup(s) — HALF practice size only, defined dollar risk.`,
        etf: "Hold core positions; no additions.",
        single_stock: "Base DCA only.",
      },
    };
  }
  if (watch >= 1) {
    return {
      day_type: "ETF_EXPOSURE_DAY",
      account: {
        swing: `No triggers. ${watch} FLEX_WATCH — create alerts, no entry.`,
        etf: "Hold; consider scheduled DCA into core ETFs.",
        single_stock: "Base DCA only.",
      },
    };
  }
  return {
    day_type: "STANDBY_DAY",
    account: {
      swing: "No qualifying setup. Stand down.",
      etf: "Hold; no swing-driven additions.",
      single_stock: "Base DCA only into core.",
    },
  };
}

// Given the SMH regime snapshot, translate to GREEN/YELLOW/RED context state
// and a short human-readable note for card copy.
function mapSmhContext(
  smh: Awaited<ReturnType<typeof computeSmhRegime>>,
): { state: SmhContextState; note: string } {
  const { day_class, smh: s } = smh;
  if (day_class === "STANDBY_DAY" || s.structure_messy || !s.trend_intact) {
    return {
      state: "RED",
      note: `SMH ${fmt2(s.last)} vs 50 ${fmt2(s.sma50)}, slope ${fmtPct(s.sma50_slope_10d_pct)}, drawdown ${fmtPct(s.drawdown_from_peak_pct)}`,
    };
  }
  if (day_class === "PRACTICE_SWING_DAY") {
    return {
      state: "YELLOW",
      note: `SMH mixed: ${fmt2(s.last)} above 50 but trend cautious; breadth clean setups`,
    };
  }
  return {
    state: "GREEN",
    note: `SMH ${fmt2(s.last)} above 20/50; slope ${fmtPct(s.sma50_slope_10d_pct)}, breadth intact`,
  };
}

// ─── Public entry point ─────────────────────────────────────────────────────
const TECH_CONCENTRATED = new Set(["QQQ", "SMH", "SOXX", "XLK", "IGV", "SOXL", "SOXS"]);

export async function runFlexScan(req: FlexScanRequest = {}): Promise<FlexScanResult> {
  // Merge pinned tickers into whichever universe the caller passed. SMH/QQQ/SPY
  // are always evaluated even if the caller doesn't ask for them so the desk
  // has continuous eyes on leading-market, tech, and broad-tape posture.
  const requested = (req.universe && req.universe.length > 0 ? req.universe : DEFAULT_UNIVERSE)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const universe = Array.from(new Set([...PINNED_TICKERS, ...requested]));

  const smhSnap = await computeSmhRegime();
  const { state: smhState, note: smhNote } = mapSmhContext(smhSnap);

  const cards: FlexDeskCard[] = [];
  const errors: string[] = [];

  await Promise.all(universe.map(async (ticker) => {
    try {
      const bars = await safeHistory(ticker);
      const isTechConcentrated = TECH_CONCENTRATED.has(ticker);
      const card = classifyTicker(bars, { ticker, smhContext: smhState, smhNote, isTechConcentrated });
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
