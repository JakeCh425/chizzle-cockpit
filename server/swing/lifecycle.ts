// PR 3c — The Swing Decision lifecycle (spec §H). THE single authority for trade state.
// Pure: evaluate(input) → SwingDecision (+ every evaluated candidate and a §N log record).
//
// Order (§H):  1 normalize/validate → 2 weekly/daily regime → 3 closed 4H setups →
//              4 1H confirmation / higher-low / breakout-retest → 5 plan AT SIGNAL TIME →
//              6 CURRENT extension & feasibility → 7 status.
// Analysis and practice plans only. Never places, routes or suggests broker orders.
import {
  FORMING_WARNING, GAP_RISK_WARNING, pickPrimary,
  type CardGrade, type DataStatus, type PriceZone, type SetupStatus, type SetupType, type SwingDecision, type SwingSettings,
} from "@shared/swingDecision";
import { atr, pivotHighs, supportLevels, type SwingBar } from "./candleMath";
import { aggregate4H, aggregateWeekly, chicago, chicagoTs, dailyClosed, inRth, tag1H, type Bar1H, type Bar4H } from "./bars";
import { detectAll, LOOKBACK_4H, type Detection } from "./detectors";
import { buildPlan, stopTooWideAdvice, type Plan } from "./planMath";
import { cardVisible, earlyTriggerAllowed, gradeReady } from "./grading";
import { dailyRegime, weeklyRegime, type DailyState, type WeeklyState } from "./regime";

export const DATA_MISMATCH_PCT = 0.15;
export const QUOTE_FRESH_SEC = 20 * 60;
export const MIN_CLOSED_4H = 8;
export const LOOKBACK_1H = 8;

export interface ReferenceQuote {
  symbol: string;          // e.g. "SMH"
  close: number;           // reference close of a completed bar
  barEnd: number;          // unix sec end of that completed bar (1H or 4H)
  source: string;          // "tradingview" | "twelvedata" | "yahoo"
  session?: "RTH" | "EXTENDED";
}

export interface EvalInput {
  symbol: string;
  exchange: string;
  bars1h: SwingBar[];      // raw 1H bars, chronological (the last may be developing)
  daily: SwingBar[];       // daily bars (vendor-stamped)
  quote?: { price: number; ts: number } | null;
  reference?: ReferenceQuote | null;
  settings: SwingSettings;
  now: number;             // unix seconds — injected, never read from the wall clock here
  dataSource?: string | null;
  reclaimLevel?: number | null;
}

export interface Candidate {
  detection: Detection;
  decision: SwingDecision;
  visible: boolean;
  hiddenWhy: string | null;
  earlyTrigger: boolean;
  /** §Q4 chart events (closed bars only): where confirmation / invalidation / expiry happened. */
  events: CandidateEvents;
}
export interface CandidateEvents {
  confirm1h?: { t: number; end: number; c: number };
  invalidated?: { t: number; end: number; c: number };
  expiredAt?: number;
}

export interface DecisionLogRecord {
  symbol: string; exchange: string; timeframe: string | null; ts: string;
  source: string | null; session: string; timezone: string;
  weeklyRegime: string; weeklyReason: string; dailyRegime: string; dailyReason: string;
  setupsEvaluated: { type: SetupType; stage: string; phase: string | null; trigger: number | null; passed: string[]; failed: string[]; missing: string[]; status: SetupStatus | null; hidden: string | null }[];
  primarySetup: SetupType | null;
  fourHourResult: string; oneHourResult: string;
  originalTrigger: number | null; currentPrice: number | null; distanceFromTriggerPct: number | null;
  stop: number | null; t1: number | null; t2: number | null;
  rrAtSignal: number | null; rrAtCurrent: number | null;
  volume: string; extensionPct: number | null; extensionAtr: number | null;
  mismatch: string | null; finalStatus: SetupStatus; grade: CardGrade; reason: string;
}

export interface EvalResult { decision: SwingDecision; candidates: Candidate[]; detections: Detection[]; log: DecisionLogRecord }

const r2 = (n: number) => Math.round(n * 100) / 100;
const iso = (s: number | null | undefined) => (s == null ? null : new Date(s * 1000).toISOString());
const fx = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(2));

export const SETUP_NAME: Record<SetupType, string> = {
  HAMMER: "Hammer",
  BULLISH_ENGULFING: "Bullish Engulfing",
  STRONG_BULL_BAR: "Strong Bull Bar after cluster of lows",
  AGGRESSIVE_BOUNCE: "Aggressive Bounce",
  BREAKOUT_RETEST: "Breakout-Retest",
  RECLAIM_MOMENTUM_CONTINUATION: "Reclaim + Momentum Continuation",
  FIRST_PULLBACK_AFTER_BREAKOUT: "First Pullback After Breakout",
  HIGHER_LOW_CONSOLIDATION: "Higher-Low Consolidation",
};

const LESSON: Record<SetupType, string> = {
  HAMMER: "A hammer shows sellers pushed price down but buyers closed it near the high. It only matters after a decline into support, and only after the 4H candle has CLOSED.",
  BULLISH_ENGULFING: "A green 4H body that swallows the prior red body shows buyers took control. Location matters: after a decline or at support.",
  STRONG_BULL_BAR: "Several candles holding the same low (a cluster) followed by a wide green close near its high shows demand defending that level.",
  AGGRESSIVE_BOUNCE: "A fast selloff into support followed by a strong green candle is a reflex bounce. It moves quickly and fails quickly — risk stays small.",
  BREAKOUT_RETEST: "After price breaks out, the old ceiling often becomes the new floor. The entry is the bullish reversal on the retest, not the first breakout candle.",
  RECLAIM_MOMENTUM_CONTINUATION: "Price reclaimed the 4H SMA20 on a closed candle, held above it on 1H, made a higher low, then broke its local range. Each step adds evidence.",
  FIRST_PULLBACK_AFTER_BREAKOUT: "The first dip after a breakout into the breakout level or fast EMA is often the lower-risk entry that chasing the breakout candle is not.",
  HIGHER_LOW_CONSOLIDATION: "A higher swing low and a tight pause show sellers are weakening. The trigger is a closed 1H break of the pause high.",
};

/** End of the n-th RTH 4H session (A ends 12:30 CT, B ends 15:00 CT) strictly after fromSec. */
export function sessionEndAfter(fromSec: number, n: number): number {
  let ymd = chicago(fromSec).ymd, found = 0;
  for (let guard = 0; guard < 60; guard++) {
    const [y, m, d] = ymd.split("-").map(Number);
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (wd >= 1 && wd <= 5) {
      for (const min of [750, 900]) {
        const e = chicagoTs(ymd, min);
        if (e > fromSec && ++found === n) return e;
      }
    }
    ymd = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  }
  return fromSec + n * 4 * 3600;
}

export function fmtCT(sec: number | null): string {
  if (sec == null) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(sec * 1000)) + " CT";
}

interface Ctx {
  E: EvalInput; s: SwingSettings; sym: string;
  h1: Bar1H[]; closed1h: Bar1H[]; b4: Bar4H[]; closed4h: Bar4H[];
  daily: SwingBar[]; closedDaily: SwingBar[];
  weekly: WeeklyState; dailyS: DailyState;
  price: number | null; dataStatus: DataStatus; mismatch: string | null;
  session: "RTH" | "EXTENDED";
  support: PriceZone | null; resistance: PriceZone | null;
  supportPx: number | null; resistancePx: number | null;
}

function blank(c: Ctx): SwingDecision {
  const { E, s } = c;
  return {
    symbol: c.sym, exchange: E.exchange, currentPrice: c.price == null ? null : r2(c.price),
    quoteTimestamp: iso(E.quote?.ts ?? c.h1[c.h1.length - 1]?.t ?? null),
    dataStatus: c.dataStatus, session: c.session, timezone: "America/Chicago",
    userMode: s.userMode, signalMode: s.signalMode,
    weeklyRegime: c.weekly.regime, weeklyReclaimForming: c.weekly.reclaimForming, dailyRegime: c.dailyS.regime,
    setupStatus: "NO_TRADE", setupType: null, cardGrade: "NO_TRADE",
    setupTimeframe: null, setupTimestamp: null, originalTrigger: null, currentTrigger: null, entryPrice: null,
    structuralStop: null, stopBuffer: null, target1: null, target2: null, riskPerShare: null,
    rewardRiskT1: null, rewardRiskT2: null, maxDollarRisk: s.maxDollarRisk, suggestedShares: null,
    supportZone: c.support, resistanceZone: c.resistance, reclaimLevel: null, retestLevel: null,
    extensionPercentAboveTrigger: null, extensionAtr: null, isExtended: false, volumeCondition: "NEUTRAL",
    dataMismatchReason: c.mismatch,
    passedRules: [], failedRules: [], missingConditions: [], whyThisPrinted: [], whyNotReady: [], invalidation: [],
    nextAction: "", learningExplanation: "", riskLabel: FORMING_WARNING, expiryTime: null,
    dataSource: E.dataSource ?? null,
    lastCompletedBar1H: iso(c.closed1h[c.closed1h.length - 1]?.end ?? null),
    lastCompletedBar4H: iso(c.closed4h[c.closed4h.length - 1]?.end ?? null),
    referenceClose: E.reference?.close ?? null, referenceSource: E.reference?.source ?? null,
    evaluatedAt: iso(E.now)!,
  };
}

/** Resistance levels known AS OF a time (plan math uses the chart as it was when the setup formed). */
function resistancesAsOf(c: Ctx, asOf: number): number[] {
  const b4 = c.closed4h.filter((b) => b.end <= asOf).slice(-40);
  const b1 = c.closed1h.filter((b) => b.end <= asOf).slice(-40);
  const dd = c.closedDaily.filter((d) => d.t < asOf).slice(-60);
  return [
    ...pivotHighs(b4, 2).map((i) => b4[i].h),
    ...pivotHighs(b1, 2).map((i) => b1[i].h),
    ...pivotHighs(dd, 2).map((i) => dd[i].h),
  ];
}

/** Extension (§H): > max % above trigger OR > max ATR. The ATR leg is measured from the trigger by
 *  default (flexible), or from the daily SMA20 when extensionAtrAnchor = DAILY_SMA20 (spec-strict). */
function extensionOf(c: Ctx, price: number, trigger: number, tfAtr: number | null) {
  const pct = ((price - trigger) / trigger) * 100;
  let atrExt: number | null = null, atrRef = "";
  const dAtr = c.dailyS.atr || null;
  if ((c.s.extensionAtrAnchor ?? "TRIGGER") === "DAILY_SMA20" && c.dailyS.sma20 != null && dAtr) {
    atrExt = (price - c.dailyS.sma20) / dAtr; atrRef = `daily SMA20 ${fx(c.dailyS.sma20)}`;
  } else if (dAtr || tfAtr) { atrExt = (price - trigger) / (dAtr || tfAtr!); atrRef = `trigger (${dAtr ? "daily" : "setup-timeframe"} ATR)`; }
  const ext = pct > c.s.maxExtensionPct || (atrExt != null && atrExt > c.s.maxExtensionAtr);
  return { pct: r2(pct), atr: atrExt == null ? null : r2(atrExt), atrRef, ext };
}

/** Retest zone (§H, widened): from a little below the trigger to the larger of max-ext % or k·ATR above. */
function retestZone(c: Ctx, trigger: number, tfAtr: number | null): PriceZone {
  const a = c.dailyS.atr || tfAtr || 0;
  const up = Math.max(trigger * (c.s.maxExtensionPct / 100), (c.s.retestZoneAtr ?? 0.5) * a);
  return { low: r2(trigger - (c.s.retestBelowAtr ?? 0.25) * a), high: r2(trigger + up) };
}

function applyPlan(d: SwingDecision, p: Plan) {
  if (p.verdict === "INVALID") {
    // Never publish a stop at/above entry — leave levels empty and say why (no silent bad plan).
    d.entryPrice = null; d.structuralStop = null; d.stopBuffer = null; d.target1 = null; d.target2 = null;
    d.riskPerShare = null; d.rewardRiskT1 = null; d.rewardRiskT2 = null; d.suggestedShares = 0;
    d.missingConditions = [...d.missingConditions, `valid structural stop below entry (${p.notes[0] ?? "structure above entry"})`];
    return;
  }
  d.entryPrice = p.entry; d.structuralStop = p.stop; d.stopBuffer = p.stopBuffer;
  d.target1 = p.t1; d.target2 = p.t2; d.riskPerShare = p.riskPerShare;
  d.rewardRiskT1 = p.rrT1; d.rewardRiskT2 = p.rrT2;
  d.suggestedShares = p.verdict === "OK" ? p.shares : 0;
  d.target1Source = p.t1Source; d.target2Source = p.t2Source;
}

function evalDetection(det: Detection, c: Ctx): Candidate {
  const { s, sym } = c;
  const d = blank(c);
  const trigger = det.trigger!, low = det.structureLow!;
  const price = c.price ?? trigger;
  d.setupType = det.type; d.setupTimeframe = det.timeframe;
  d.setupTimestamp = iso(det.barEnd ?? det.barTime);
  d.originalTrigger = trigger; d.currentTrigger = trigger;
  d.passedRules = [...det.passed]; d.failedRules = [...det.failed]; d.missingConditions = [...det.missing];
  d.volumeCondition = det.volume; d.cardGrade = "WATCH";
  d.reclaimLevel = det.levels.reclaim ?? det.levels.breakout ?? null;
  if (det.levels.support != null) d.supportZone = { low: r2(Math.min(det.levels.support, low)), high: r2(det.levels.support) };
  d.learningExplanation = LESSON[det.type];
  d.whyThisPrinted = [`${SETUP_NAME[det.type]} ${det.stage === "FORMING" ? "forming" : "confirmed"} on ${det.timeframe}${det.phase ? ` (${det.phase})` : ""} — bar ${fmtCT(det.barTime)}`, ...det.passed.slice(0, 4)];
  d.invalidation = [`a closed 1H below structure ${fx(low)}`, `no closed 1H above trigger ${fx(trigger)} within ${s.expiryBars4h} closed 4H bar(s)`];

  const tfBars: SwingBar[] = det.timeframe === "4H" ? c.closed4h : c.closed1h;
  const tfAtr = atr(tfBars);
  const planAt = (asOf: number) => buildPlan({
    trigger, structureLow: low, atr: atr(tfBars.filter((b) => (b as Bar1H).end <= asOf)) ?? tfAtr,
    resistances: resistancesAsOf(c, asOf), minRr: s.minRrT1, maxDollarRisk: s.maxDollarRisk,
    entryBufferPct: s.entryBufferPct, stopBufferAtr: s.stopBufferAtr,
  });
  const ev: CandidateEvents = {};
  const out = (status: SetupStatus, extra: Partial<Candidate> = {}): Candidate => {
    d.setupStatus = status;
    if (!d.nextAction) d.nextAction = `Watch ${sym}: ${d.whyNotReady[0] ?? "re-check on the next closed 1H bar"}.`;
    const v = cardVisible({ status, userMode: s.userMode, showFormingCards: s.showFormingCards, showWatchCards: s.showWatchCards,
      showLowQualityForming: s.showLowQualityForming, weekly: c.weekly.regime, daily: c.dailyS.regime, dailyImproving: c.dailyS.improving });
    return { detection: det, decision: d, visible: v.visible, hiddenWhy: v.why, earlyTrigger: false, events: ev, ...extra };
  };

  // ── FORMING: developing, not tradeable ─────────────────────────────────────
  if (det.stage === "FORMING") {
    applyPlan(d, planAt(c.E.now)); d.suggestedShares = null;
    d.riskLabel = FORMING_WARNING;
    d.whyNotReady = [FORMING_WARNING, ...det.missing];
    d.nextAction = det.timeframe === "4H"
      ? `Watch ${sym} for the 4H candle to close, then a closed 1H breakout above ${fx(trigger)}.`
      : `Watch ${sym} for a closed 1H breakout above ${fx(trigger)}.`;
    return out("SETUP_FORMING");
  }

  // ── CONFIRMED: look for the closed 1H confirmation within the expiry window ─
  const start = det.timeframe === "4H" ? det.barEnd! : det.barTime!;
  const deadline = sessionEndAfter(det.barEnd!, s.expiryBars4h);
  d.expiryTime = iso(deadline);
  const after = c.closed1h.filter((b) => b.t >= start);
  const conf = after.find((b) => b.c > trigger && b.end <= deadline) ?? null;
  const inv = after.find((b) => b.c < low) ?? null;
  if (conf) ev.confirm1h = { t: conf.t, end: conf.end, c: conf.c };
  if (inv) {
    ev.invalidated = { t: inv.t, end: inv.end, c: inv.c };
    applyPlan(d, planAt(conf?.end ?? inv.end)); d.suggestedShares = 0; d.cardGrade = "NO_TRADE";
    d.failedRules.push(`invalidated: closed 1H ${fx(inv.c)} below structure ${fx(low)} at ${fmtCT(inv.end)}`);
    d.whyNotReady = [`Setup invalidated — closed 1H ${fx(inv.c)} < structure ${fx(low)} (${fmtCT(inv.end)})`];
    d.nextAction = `${SETUP_NAME[det.type]} on ${sym} is invalidated. Wait for a new base or reclaim.`;
    d.riskLabel = "EXPIRED — NOT TRADEABLE";
    return out("SIGNAL_EXPIRED");
  }
  const dev = c.h1.length && !c.h1[c.h1.length - 1].closed ? c.h1[c.h1.length - 1] : null;
  let early = false;
  if (!conf) {
    if (c.E.now >= deadline) {
      ev.expiredAt = deadline;
      applyPlan(d, planAt(deadline)); d.suggestedShares = 0; d.cardGrade = "NO_TRADE";
      d.failedRules.push(`no closed 1H above trigger ${fx(trigger)} within ${s.expiryBars4h} closed 4H bar(s)`);
      d.whyNotReady = [`Expired ${fmtCT(deadline)}: no closed 1H above trigger ${fx(trigger)} within ${s.expiryBars4h} closed 4H bar(s) of the setup`];
      // Learning aid: show what the wider 3-bar window would have done (the setting itself is unchanged).
      if (s.expiryBars4h < 3) {
        const alt = sessionEndAfter(det.barEnd!, 3);
        const altConf = after.find((b) => b.c > trigger && b.end <= alt);
        d.whyNotReady.push(altConf
          ? `3-bar what-if: with a 3-bar window this would have confirmed — closed 1H ${fx(altConf.c)} above ${fx(trigger)} at ${fmtCT(altConf.end)}.`
          : c.E.now < alt
            ? `3-bar what-if: with a 3-bar window this setup would still be open until ${fmtCT(alt)} (no confirmation yet).`
            : `3-bar what-if: a 3-bar window (until ${fmtCT(alt)}) would also have expired — no closed 1H above ${fx(trigger)}.`);
      }
      d.nextAction = `${SETUP_NAME[det.type]} on ${sym} expired without 1H confirmation. Wait for a new setup.`;
      d.riskLabel = "EXPIRED — NOT TRADEABLE";
      return out("SIGNAL_EXPIRED");
    }
    const earlyOk = dev && dev.c > trigger && earlyTriggerAllowed({ signalMode: s.signalMode, userMode: s.userMode, settings: s });
    if (!earlyOk) {
      applyPlan(d, planAt(c.E.now)); d.suggestedShares = null;
      d.riskLabel = FORMING_WARNING;
      d.missingConditions.push(`closed 1H above trigger ${fx(trigger)} (by ${fmtCT(deadline)})`);
      d.whyNotReady = [`Waiting for a CLOSED 1H above trigger ${fx(trigger)} — expires ${fmtCT(deadline)}`];
      d.nextAction = `Watch ${sym} for a closed 1H breakout above ${fx(trigger)}.`;
      return out("SETUP_CONFIRMED");
    }
    early = true;
  }
  const signalEnd = conf ? conf.end : c.E.now;
  d.passedRules.push(conf ? `closed 1H ${fx(conf.c)} above trigger ${fx(trigger)} at ${fmtCT(conf.end)}` : `EARLY TRIGGER: developing 1H ${fx(dev!.c)} above trigger ${fx(trigger)} (not closed)`);

  // ── Plan at signal time (§H step 5) ────────────────────────────────────────
  const plan = planAt(signalEnd);
  applyPlan(d, plan);
  if (plan.verdict === "INVALID") {
    d.cardGrade = "NO_TRADE"; d.whyNotReady = plan.notes; d.nextAction = `No valid structural stop for ${sym}. Wait for a clearer base.`;
    return out("NO_TRADE", { earlyTrigger: early });
  }
  // A risk-policy WATCH is only live while it can still become a plan: once price has
  // run past T1, or the confirmation window has passed again since the signal, it expires
  // (kept in history) instead of lingering as the "current" card with stale levels.
  if (plan.verdict === "STOP_TOO_WIDE" || plan.verdict === "RR_TOO_LOW") {
    const staleAt = sessionEndAfter(signalEnd, s.expiryBars4h);
    const pastT1 = plan.t1 != null && c.closed1h.some((b) => b.t >= signalEnd && b.c >= plan.t1!); // a later CLOSED 1H beyond T1
    if (!early && (pastT1 || c.E.now >= staleAt)) {
      ev.expiredAt = pastT1 ? c.E.now : staleAt;
      d.suggestedShares = 0; d.cardGrade = "NO_TRADE";
      const why = plan.verdict === "RR_TOO_LOW" ? `R:R to T1 ${fx(plan.rrT1)} < minimum ${s.minRrT1}` : `stop too wide for $${s.maxDollarRisk} risk`;
      d.failedRules.push(`${why} at signal ${fmtCT(signalEnd)}`);
      d.whyNotReady = [pastT1
        ? `Expired: risk never fit (${why}) and price ${fx(price)} has already passed T1 ${fx(plan.t1)}`
        : `Expired ${fmtCT(staleAt)}: risk never fit (${why}) within ${s.expiryBars4h} closed 4H bar(s) of the signal`];
      d.nextAction = `${SETUP_NAME[det.type]} on ${sym} expired without a workable plan. Wait for a new setup.`;
      d.riskLabel = "EXPIRED — NOT TRADEABLE";
      return out("SIGNAL_EXPIRED");
    }
  }
  if (plan.verdict === "STOP_TOO_WIDE") {
    d.riskLabel = "WATCH — STOP TOO WIDE FOR RISK POLICY";
    d.whyNotReady = [`Stop ${fx(plan.stop)} gives risk/share $${fx(plan.riskPerShare)} > max dollar risk $${s.maxDollarRisk} → 0 shares`, stopTooWideAdvice(plan, s.maxDollarRisk)];
    d.nextAction = `Stop too wide on ${sym} for $${s.maxDollarRisk} risk. Wait for a tighter higher low or a smaller-risk retest.`;
    return out("WATCH_STOP_TOO_WIDE", { earlyTrigger: early });
  }
  if (plan.verdict === "RR_TOO_LOW") {
    d.riskLabel = "WATCH — REWARD/RISK TOO LOW";
    d.whyNotReady = [`R:R to T1 ${fx(plan.rrT1)} < minimum ${s.minRrT1} — next resistance ${fx(plan.nextResistance)}`];
    d.nextAction = `R:R too low on ${sym}. Wait for a close above resistance ${fx(plan.nextResistance)} or a lower-risk pullback entry.`;
    return out("WATCH_RR_TOO_LOW", { earlyTrigger: early });
  }

  // ── Current extension & feasibility (§H step 6) ────────────────────────────
  const ex = extensionOf(c, price, trigger, tfAtr);
  d.extensionPercentAboveTrigger = ex.pct; d.extensionAtr = ex.atr; d.isExtended = ex.ext;
  const zone = retestZone(c, trigger, tfAtr);
  d.retestLevel = zone;
  if (ex.ext) {
    d.riskLabel = "WATCH — EXTENDED, DO NOT CHASE";
    d.whyNotReady = [
      `Price ${fx(price)} is ${fx(ex.pct)}% above original trigger ${fx(trigger)} (max ${s.maxExtensionPct}%)`,
      ...(ex.atr != null ? [`${fx(ex.atr)} ATR above ${ex.atrRef} (max ${s.maxExtensionAtr})`] : []),
      `Original signal ${fmtCT(signalEnd)} · R:R at signal ${fx(plan.rrT1)}`,
      "Wait for 1H pullback/retest and closed bullish confirmation.",
    ];
    d.nextAction = `Do not chase ${sym}. Wait for retest zone ${fx(zone.low)}–${fx(zone.high)} and bullish 1H close.`;
    d.suggestedShares = 0;
    return out("WATCH_EXTENDED", { earlyTrigger: early });
  }
  const postSignal = c.closed1h.filter((b) => b.t >= signalEnd);
  const wasExtended = postSignal.some((b) => extensionOf(c, b.c, trigger, tfAtr).ext);
  const lastClose = c.closed1h[c.closed1h.length - 1]?.c ?? price;
  if (wasExtended || (!early && lastClose <= trigger)) {
    d.riskLabel = "WATCH — RETEST, NOT AN ENTRY YET";
    d.whyNotReady = [wasExtended
      ? `Price ran ${">"}${s.maxExtensionPct}% above trigger after the signal and is back near the retest zone ${fx(zone.low)}–${fx(zone.high)}`
      : `Last closed 1H ${fx(lastClose)} is back at/below trigger ${fx(trigger)}`, "Needs a closed bullish 1H reversal from the retest zone."];
    d.nextAction = `Watch ${sym} retest zone ${fx(zone.low)}–${fx(zone.high)} for a closed bullish 1H candle.`;
    d.suggestedShares = 0;
    return out("WATCH_RETEST", { earlyTrigger: early });
  }

  // ── Data agreement (§M) ────────────────────────────────────────────────────
  if (c.mismatch) {
    d.riskLabel = "BLOCKED — DATA MISMATCH";
    d.whyNotReady = [c.mismatch, "Ready is blocked until data sources agree. Refresh the chart and the data feed, or wait for the next closed bar."];
    d.nextAction = `Resolve the ${sym} data mismatch before using this plan: ${c.mismatch}`;
    d.suggestedShares = 0;
    return out("BLOCKED_DATA_MISMATCH", { earlyTrigger: early });
  }

  // ── Mode gate + grade (§D, §J) ─────────────────────────────────────────────
  const g = gradeReady({ signalMode: s.signalMode, userMode: s.userMode, settings: s, weekly: c.weekly.regime,
    daily: c.dailyS.regime, dailyImproving: c.dailyS.improving, setupType: det.type, earlyTrigger: early, volume: det.volume });
  if (!g.ok) {
    d.cardGrade = "NO_TRADE"; d.riskLabel = g.riskLabel; d.suggestedShares = 0;
    d.failedRules.push(...g.reasons);
    d.whyNotReady = [...g.reasons, `The ${SETUP_NAME[det.type]} itself passed — the ${s.signalMode} mode rules block it.`];
    d.nextAction = `${s.signalMode} mode: no practice entry on ${sym}. ${g.reasons[0]}.`;
    return out("NO_TRADE", { earlyTrigger: early });
  }
  d.cardGrade = g.grade; d.riskLabel = g.riskLabel;
  d.passedRules.push(...g.passed, `not extended (${fx(ex.pct)}% / ${fx(ex.atr)} ATR)`, `R:R to T1 ${fx(plan.rrT1)} ≥ ${s.minRrT1}`);
  d.whyNotReady = [];
  d.whyThisPrinted.push(`plan: entry ${fx(plan.entry)} · stop ${fx(plan.stop)} · T1 ${fx(plan.t1)} · T2 ${fx(plan.t2)}`, GAP_RISK_WARNING);
  d.nextAction = "Practice plan is available. Review entry, stop, targets, and risk.";
  return out("READY_TO_TRADE", { earlyTrigger: early });
}

function nearestLevels(c: Ctx) {
  const px = c.price;
  if (px == null) return;
  const sup = supportLevels({ bars4h: c.closed4h, daily: c.closedDaily.length >= 20 ? c.closedDaily : undefined })
    .map((l) => l.price).filter((p) => p < px);
  const b4 = c.closed4h.slice(-40), dd = c.closedDaily.slice(-60);
  const res = [...pivotHighs(b4, 2).map((i) => b4[i].h), ...pivotHighs(dd, 2).map((i) => dd[i].h), ...(b4.length ? [Math.max(...b4.map((b) => b.h))] : [])]
    .filter((p) => p > px);
  c.supportPx = sup.length ? r2(Math.max(...sup)) : (b4.length ? r2(Math.min(...b4.slice(-20).map((b) => b.l))) : null);
  c.resistancePx = res.length ? r2(Math.min(...res)) : null;
  if (c.supportPx != null) c.support = { low: r2(c.supportPx * 0.998), high: r2(c.supportPx * 1.002) };
  if (c.resistancePx != null) c.resistance = { low: r2(c.resistancePx * 0.998), high: r2(c.resistancePx * 1.002) };
}

function checkMismatch(E: EvalInput, sym: string, closed1h: Bar1H[], closed4h: Bar4H[]): { mismatch: string | null; verified: boolean } {
  const ref = E.reference;
  if (!ref) return { mismatch: null, verified: false };
  if (ref.symbol.toUpperCase() !== sym) return { mismatch: `symbol mismatch: engine ${sym} vs ${ref.source} ${ref.symbol}`, verified: false };
  if (ref.session && ref.session !== (E.settings.rthOnly ? "RTH" : "EXTENDED"))
    return { mismatch: `session mismatch: engine ${E.settings.rthOnly ? "RTH" : "EXTENDED"} vs ${ref.source} ${ref.session}`, verified: false };
  const bar = closed1h.find((b) => b.end === ref.barEnd) ?? closed4h.find((b) => b.end === ref.barEnd);
  if (!bar) {
    const last = closed1h[closed1h.length - 1];
    if (last && ref.barEnd > last.end) return { mismatch: `completed-bar mismatch: ${ref.source} has a bar ending ${fmtCT(ref.barEnd)} the engine does not (last ${fmtCT(last.end)})`, verified: false };
    return { mismatch: null, verified: false }; // stale reference → unverified (DELAYED), does not block
  }
  const diff = (Math.abs(bar.c - ref.close) / ref.close) * 100;
  if (diff > DATA_MISMATCH_PCT)
    return { mismatch: `close mismatch ${diff.toFixed(2)}% > ${DATA_MISMATCH_PCT}% on bar ending ${fmtCT(ref.barEnd)}: engine ${fx(bar.c)} vs ${ref.source} ${fx(ref.close)}`, verified: false };
  return { mismatch: null, verified: true };
}

/** Setup history (extension must never erase setup history): run the detectors as of the close of
 *  each of the last LOOKBACK_4H closed 4H bars, keeping every CONFIRMED setup as it was when it
 *  formed, plus the current snapshot (which alone may report FORMING). Deduped by type+bar+phase. */
function detectHistory(c: Ctx, weekly: SwingBar[]): Detection[] {
  const base = { weekly, signalMode: c.s.signalMode, reclaimLevel: c.E.reclaimLevel ?? null, allowFirstPullback: c.s.allowFirstPullback };
  const current = detectAll({ ...base, bars4h: c.b4, bars1h: c.h1, daily: c.closedDaily });
  const seen = new Map<string, Detection>();
  const key = (d: Detection) => `${d.type}|${d.barTime}|${d.phase ?? ""}`;
  for (const d of current) if (d.stage !== "NONE") seen.set(key(d), d);
  // 4H snapshots recover 4H setups; 1H snapshots recover 1H setups (a later reversal bar must not
  // overwrite the earlier one whose trigger the next closed 1H is confirming).
  const snaps = [...new Set([...c.closed4h.slice(-LOOKBACK_4H).map((b) => b.end), ...c.closed1h.slice(-LOOKBACK_1H).map((b) => b.end)])];
  for (const snap of snaps) {
    if (snap >= c.E.now) continue;
    const hist = detectAll({ ...base, bars4h: c.b4.filter((b) => b.end <= snap), bars1h: c.h1.filter((b) => b.end <= snap).map((b) => ({ ...b, closed: true })),
      daily: c.closedDaily.filter((d) => d.t < snap) });
    for (const d of hist) if (d.stage === "CONFIRMED" && !seen.has(key(d))) seen.set(key(d), d);
  }
  const out = [...seen.values()];
  // Keep a NONE row per type absent everywhere so the log still shows every setup evaluated.
  for (const d of current) if (d.stage === "NONE" && !out.some((x) => x.type === d.type)) out.push(d);
  return out;
}

/** A new FORMING/CONFIRMED pattern printed inside an extended run from an active signal is a chase,
 *  not a fresh base: hide it (still logged) so the card stays WATCH_EXTENDED with the original trigger. */
function suppressChase(cands: Candidate[]) {
  const ext = cands.filter((x) => x.decision.setupStatus === "WATCH_EXTENDED" && x.decision.retestLevel);
  if (!ext.length) return;
  const zoneHigh = Math.min(...ext.map((x) => x.decision.retestLevel!.high));
  const anchor = ext.reduce((a, b) => ((a.decision.setupTimestamp ?? "") <= (b.decision.setupTimestamp ?? "") ? a : b));
  for (const x of cands) {
    const st = x.decision.setupStatus;
    if ((st === "SETUP_FORMING" || st === "SETUP_CONFIRMED") && (x.detection.trigger ?? 0) > zoneHigh) {
      x.visible = false;
      x.hiddenWhy = `formed inside the extended run from the ${SETUP_NAME[anchor.detection.type]} signal (trigger ${fx(anchor.decision.originalTrigger)}) — chasing, not a new base`;
    }
  }
}

/** pickPrimary, then among equal status+grade prefer the ORIGINAL (earliest) signal. */
function choosePrimary(vis: Candidate[]): SwingDecision | null {
  const p = pickPrimary(vis.map((x) => x.decision));
  if (!p) return null;
  const peers = vis.map((x) => x.decision).filter((d) => d.setupStatus === p.setupStatus && d.cardGrade === p.cardGrade);
  return peers.reduce((a, b) => ((a.setupTimestamp ?? "") <= (b.setupTimestamp ?? "") ? a : b));
}

export function evaluate(E: EvalInput): EvalResult {
  const s = E.settings, sym = E.symbol.toUpperCase();
  // 1 · Normalize & validate
  const h1 = tag1H(E.bars1h, E.now, s.rthOnly);
  const b4 = aggregate4H(E.bars1h, E.now);
  const closed1h = h1.filter((b) => b.closed), closed4h = b4.filter((b) => b.closed);
  const daily = E.daily.slice().sort((a, z) => a.t - z.t);
  const closedDaily = daily.filter((d) => dailyClosed(d, E.now));
  const price = E.quote?.price ?? h1[h1.length - 1]?.c ?? null;
  const mm = checkMismatch(E, sym, closed1h, closed4h);
  const fresh = E.quote ? E.now - E.quote.ts <= QUOTE_FRESH_SEC : false;
  let dataStatus: DataStatus = mm.mismatch ? "MISMATCH" : mm.verified && fresh ? "LIVE" : "DELAYED";
  if (closed4h.length < MIN_CLOSED_4H || price == null) dataStatus = "ERROR";

  // 2 · Regime
  const weekly = weeklyRegime(daily, E.now);
  const dailyS = dailyRegime(daily, E.now);
  const c: Ctx = { E, s, sym, h1, closed1h, b4, closed4h, daily, closedDaily, weekly, dailyS, price, dataStatus,
    mismatch: mm.mismatch, session: inRth(E.now) ? "RTH" : "EXTENDED", support: null, resistance: null, supportPx: null, resistancePx: null };
  nearestLevels(c);

  if (dataStatus === "ERROR") {
    const d = blank(c);
    d.whyNotReady = [`Insufficient data: ${closed4h.length} closed 4H bars (need ${MIN_CLOSED_4H})${price == null ? ", no current price" : ""}`];
    d.missingConditions = ["valid 1H/4H bar history"];
    d.nextAction = `Data unavailable for ${sym}. Refresh the data feed; no plan until bars load.`;
    d.learningExplanation = "The engine never guesses: without enough closed candles it cannot judge structure.";
    return finish(c, d, [], []);
  }

  // 3–4 · Setups (4H closed + 1H confirmation structures)
  const weeklyBars = aggregateWeekly(daily, E.now);
  const detections = detectHistory(c, weeklyBars.filter((w) => w.closed));

  // 5–7 · Plan, extension, status — per candidate; one primary per symbol
  const candidates = detections.filter((d) => d.stage !== "NONE" && d.trigger != null && d.structureLow != null).map((d) => evalDetection(d, c));
  suppressChase(candidates);
  const visible = candidates.filter((x) => x.visible);
  const primary = choosePrimary(visible);
  if (primary) {
    const others = candidates.filter((x) => x.decision !== primary).map((x) => `${SETUP_NAME[x.detection.type]}: ${x.decision.setupStatus}${x.visible ? "" : ` (hidden — ${x.hiddenWhy})`}`);
    if (others.length) primary.whyThisPrinted.push(`also evaluated: ${others.join("; ")}`);
    return finish(c, primary, candidates, detections);
  }

  // NO_TRADE — never silent: name the missing ingredient, levels and next condition.
  const d = blank(c);
  const hidden = candidates.filter((x) => !x.visible);
  d.cardGrade = "NO_TRADE"; d.riskLabel = "NO TRADE — NOTHING TO PRACTICE";
  d.failedRules = detections.map((x) => `${SETUP_NAME[x.type]}: ${x.failed[0] ?? x.missing[0] ?? "not present"}`);
  d.missingConditions = ["a closed 4H base/reclaim setup (hammer, engulfing, strong bull, bounce, breakout-retest, reclaim, first pullback or higher-low)"];
  d.whyNotReady = [
    `No setup on ${sym} (${detections.length} evaluated).`,
    `Regime: Weekly ${weekly.regime} (${weekly.reason}); Daily ${dailyS.regime} (${dailyS.reason}).`,
    ...(hidden.length ? [`${hidden.length} card(s) hidden by your settings: ${hidden.map((x) => `${SETUP_NAME[x.detection.type]} — ${x.hiddenWhy}`).join("; ")}`] : []),
  ];
  d.nextAction = `No base/reclaim setup. Watch support ${c.supportPx != null ? fx(c.supportPx) : "(none below — at lows)"} and resistance ${c.resistancePx != null ? fx(c.resistancePx) : "(none overhead — at highs)"}.`;
  d.learningExplanation = "No trade is a position. The engine waits for a closed candle pattern at a known level so risk can be defined.";
  d.whyThisPrinted = [`nearest support ${fx(c.supportPx)}`, `nearest resistance ${fx(c.resistancePx)}`];
  return finish(c, d, candidates, detections);
}

function finish(c: Ctx, d: SwingDecision, candidates: Candidate[], detections: Detection[]): EvalResult {
  if (!d.nextAction) d.nextAction = `Re-check ${c.sym} on the next closed 1H bar.`;
  if (c.weekly.reclaimForming && !d.whyThisPrinted.some((x) => x.includes("WEEKLY RECLAIM FORMING")))
    d.whyThisPrinted.push("WEEKLY RECLAIM FORMING — confirms only after the Friday RTH close");
  const det = candidates.find((x) => x.decision === d)?.detection ?? null;
  const price = d.currentPrice;
  const rrCur = d.target1 != null && d.structuralStop != null && price != null && price > d.structuralStop
    ? r2((d.target1 - price) / (price - d.structuralStop)) : null;
  const dist = d.originalTrigger != null && price != null ? r2(((price - d.originalTrigger) / d.originalTrigger) * 100) : null;
  const byType = new Map(candidates.map((x) => [x.detection.type, x]));
  const fourH = det ? (det.timeframe === "4H" ? `${SETUP_NAME[det.type]} ${det.stage.toLowerCase()} at ${fmtCT(det.barEnd)}` : `1H setup (${SETUP_NAME[det.type]})`)
    : "no closed 4H setup";
  const oneH = d.passedRules.find((x) => x.startsWith("closed 1H") || x.startsWith("EARLY")) ?? (d.missingConditions.find((x) => x.includes("1H")) ?? "n/a");
  const reason = [
    `${c.sym}:`,
    det ? `${SETUP_NAME[det.type]} ${det.stage === "FORMING" ? "forming" : "confirmed"} (${det.timeframe}) ${fmtCT(det.barEnd)}.` : "No setup.",
    det ? (det.passed.slice(0, 2).join("; ") + ".") : "",
    d.originalTrigger != null ? `Original trigger: ${fx(d.originalTrigger)}.` : "",
    price != null ? `Current price: ${fx(price)}${dist != null ? `, ${Math.abs(dist).toFixed(1)}% ${dist >= 0 ? "above" : "below"} trigger` : ""}.` : "",
    `Status: ${d.setupStatus}.`,
    d.nextAction,
  ].filter(Boolean).join(" ");
  const log: DecisionLogRecord = {
    symbol: c.sym, exchange: c.E.exchange, timeframe: d.setupTimeframe, ts: d.evaluatedAt,
    source: c.E.dataSource ?? null, session: c.session, timezone: "America/Chicago",
    weeklyRegime: c.weekly.regime, weeklyReason: c.weekly.reason, dailyRegime: c.dailyS.regime, dailyReason: c.dailyS.reason,
    setupsEvaluated: detections.map((x) => ({ type: x.type, stage: x.stage, phase: x.phase, trigger: x.trigger, passed: x.passed, failed: x.failed, missing: x.missing,
      status: byType.get(x.type)?.decision.setupStatus ?? null, hidden: byType.get(x.type)?.hiddenWhy ?? null })),
    primarySetup: d.setupType, fourHourResult: fourH, oneHourResult: oneH,
    originalTrigger: d.originalTrigger, currentPrice: price, distanceFromTriggerPct: dist,
    stop: d.structuralStop, t1: d.target1, t2: d.target2, rrAtSignal: d.rewardRiskT1, rrAtCurrent: rrCur,
    volume: d.volumeCondition, extensionPct: d.extensionPercentAboveTrigger, extensionAtr: d.extensionAtr,
    mismatch: d.dataMismatchReason, finalStatus: d.setupStatus, grade: d.cardGrade, reason,
  };
  return { decision: d, candidates, detections, log };
}

/** Do Today wording (§K) derived only from the decision. */
export function doTodayLine(d: SwingDecision): string {
  return d.nextAction;
}

