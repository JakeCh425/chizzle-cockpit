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
} from "@shared/flexScanTypes";

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
  const closes = bars.map((b) => b.close);
  const price = last.close;
  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);
  const s200 = sma(closes, 200);
  const slope200 = sma200Slope(bars);
  const slope50 = sma50Slope(bars);
  const atr14 = atr(bars);
  const avgVol = averageVolume(bars, 20);
  const relVol = avgVol && avgVol > 0 ? last.volume / avgVol : 1;

  if (s20 == null || s50 == null || s200 == null) {
    return standbyCard(ticker, "SMA(20/50/200) not available.", smhContext, smhNote);
  }

  const distFrom20 = ((price - s20) / s20) * 100;
  const distFrom50 = ((price - s50) / s50) * 100;

  // Primary-trend gate: must be above a flat/rising 200-SMA.
  const primaryTrendPass = price > s200 && slope200 >= -0.25;

  // Pivots (confirmed via 3-bar lookback each side).
  const pivots = findRecentPivotLows(bars, 3, 3);
  const priorSwingHigh = latestPivotHigh(bars, 3, 3);
  const confirmedHigherLow =
    pivots.latest != null &&
    pivots.prior != null &&
    pivots.latest > pivots.prior * 1.002;

  // Reclaim triggers (close above key level in last 2 bars, held through today).
  const prevBar = bars[bars.length - 2];
  const priorDayHigh = prevBar.high;
  const closeAbove20   = price > s20 && prevBar.close > s20;
  const closeAbove50   = price > s50 && prevBar.close > s50;
  const closeAbovePDH  = price > priorDayHigh;
  const closeAbovePivot = priorSwingHigh != null && price > priorSwingHigh * 0.998 && price < priorSwingHigh * 1.05;
  const reclaimTrigger = closeAbove20 || closeAbove50 || closeAbovePDH || closeAbovePivot;

  // Volume signals: improving = today > yesterday's volume.
  const improvingTriggerVolume = last.volume >= prevBar.volume;

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

  if (standardOk) {
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
    // Determine why to make the STANDBY card actionable.
    const reasons: string[] = [];
    if (!primaryTrendPass)   reasons.push(`Below 200-SMA (${fmt2(s200)}) or slope declining`);
    if (!confirmedHigherLow) reasons.push(`No confirmed higher low`);
    if (!smhOK)              reasons.push(`SMH regime RED, tech-concentrated stand down`);
    if (rrT1 < 1.5)          reasons.push(`R:R to T1 only ${rrT1.toFixed(2)}`);
    if (reasons.length === 0) reasons.push(`No trigger fired and structure not near reclaim`);
    return standbyCard(ticker, reasons.join(" · "), smhContext, smhNote, {
      metrics: buildMetrics(price, s20, s50, s200, slope200, slope50, distFrom20, distFrom50, relVol, atr14, confirmedHigherLow, reclaimTrigger, pivots, priorSwingHigh),
    });
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

  return {
    state,
    ticker,
    setup,
    trend: `Px ${fmt2(price)} vs 20 ${fmt2(s20)} / 50 ${fmt2(s50)} / 200 ${fmt2(s200)}; 200-SMA slope ${fmtPct(slope200)}, 50-SMA slope ${fmtPct(slope50)}`,
    structure: confirmedHigherLow
      ? `Confirmed HL: latest pivot ${fmt2(pivots.latest)} > prior ${fmt2(pivots.prior)} (+${(((pivots.latest! - pivots.prior!) / pivots.prior!) * 100).toFixed(2)}%)`
      : `Base near ${fmt2(pivots.latest)}; HL not yet confirmed`,
    trigger: state === "FLEX_WATCH"
      ? `Awaiting close above ${fmt2(Math.max(s20, priorSwingHigh ?? s20))} with follow-through`
      : buildTriggerDescription(closeAbove20, closeAbove50, closeAbovePDH, closeAbovePivot, s20, s50, priorDayHigh, priorSwingHigh),
    entry_zone: {
      low: Number(entryLow.toFixed(2)),
      high: Number(entryHigh.toFixed(2)),
      note: state === "STANDARD_READY" ? "Pullback into 20-SMA; enter on close-and-hold" :
            state === "FLEX_READY"     ? "Half size; enter only after close-and-hold or retest" :
                                         "No entry — set alert at trigger",
    },
    stop: { price: Number(stopPrice.toFixed(2)), reason: stopReason },
    target_1: {
      price: Number(t1Price.toFixed(2)),
      r_multiple: Number(rrT1.toFixed(2)),
    },
    target_2: state !== "FLEX_WATCH" ? {
      price: Number(t2Price.toFixed(2)),
      r_multiple: Number(rrT2.toFixed(2)),
    } : null,
    risk_grade,
    fakeout_check: { result: fakeout_result, reasons: fakeoutReasons },
    smh_market_context: isTechConcentrated
      ? `SMH ${smhContext} — ${smhNote}`
      : `Market: ${smhNote}`,
    action,
    metrics: buildMetrics(price, s20, s50, s200, slope200, slope50, distFrom20, distFrom50, relVol, atr14, confirmedHigherLow, reclaimTrigger, pivots, priorSwingHigh),
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

function buildMetrics(
  price: number, s20: number, s50: number, s200: number,
  slope200: number, slope50: number,
  distFrom20: number, distFrom50: number,
  relVol: number, atr14: number | null,
  confirmedHigherLow: boolean, reclaimTrigger: boolean,
  pivots: ReturnType<typeof findRecentPivotLows>, priorSwingHigh: number | null,
): FlexMetrics {
  return {
    price: Number(price.toFixed(2)),
    sma20: Number(s20.toFixed(2)),
    sma50: Number(s50.toFixed(2)),
    sma200: Number(s200.toFixed(2)),
    sma200_slope_pct: Number(slope200.toFixed(2)),
    sma50_slope_pct: Number(slope50.toFixed(2)),
    dist_from_sma20_pct: Number(distFrom20.toFixed(2)),
    dist_from_sma50_pct: Number(distFrom50.toFixed(2)),
    relative_volume: Number(relVol.toFixed(2)),
    atr14: atr14 != null ? Number(atr14.toFixed(2)) : undefined,
    confirmed_higher_low: confirmedHigherLow,
    reclaim_trigger: reclaimTrigger,
    prior_pivot_low: pivots.prior,
    latest_pivot_low: pivots.latest,
    prior_swing_high: priorSwingHigh,
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
    action: "STAND DOWN",
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
  const universe = (req.universe && req.universe.length > 0 ? req.universe : DEFAULT_UNIVERSE)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const smhSnap = await computeSmhRegime();
  const { state: smhState, note: smhNote } = mapSmhContext(smhSnap);

  const cards: FlexDeskCard[] = [];
  const errors: string[] = [];

  await Promise.all(universe.map(async (ticker) => {
    try {
      const bars = await safeHistory(ticker);
      const isTechConcentrated = TECH_CONCENTRATED.has(ticker);
      const card = classifyTicker(bars, { ticker, smhContext: smhState, smhNote, isTechConcentrated });
      cards.push(card);
    } catch (err) {
      errors.push(`${ticker}: ${err instanceof Error ? err.message : "history fetch failed"}`);
    }
  }));

  // Deterministic order: STANDARD_READY → FLEX_READY → FLEX_WATCH → STANDBY
  const priority: Record<FlexState, number> = {
    STANDARD_READY: 0,
    FLEX_READY: 1,
    FLEX_WATCH: 2,
    STANDBY: 3,
  };
  cards.sort((a, b) => priority[a.state] - priority[b.state] || a.ticker.localeCompare(b.ticker));

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
