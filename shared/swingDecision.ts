// PR 3 — Unified Swing Decision Engine: the shared contract.
// ----------------------------------------------------------------------------
// SwingDecision is the ONLY authority for trade state when
// ENABLE_UNIFIED_SWING_ENGINE is ON. Every panel (Regime, Entry Readiness,
// AI Coach, Technical Snapshot, Trade Plan, Flex Scanner, MTF, Do Today,
// Market Pulse, counts, notifications) renders from this object and may not
// independently decide "Long", "No Trade", "Hard Block", "Strong" or "Ready".
//
// PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE. No broker orders, ever.

// ─── Enums ──────────────────────────────────────────────────────────────────
export const DATA_STATUSES = ["LIVE", "DELAYED", "ERROR", "MISMATCH"] as const;
export type DataStatus = typeof DATA_STATUSES[number];

export const SESSIONS = ["RTH", "EXTENDED"] as const;
export type Session = typeof SESSIONS[number];

export const USER_MODES = ["LEARN", "PRACTICE", "DISCIPLINED"] as const;
export type UserMode = typeof USER_MODES[number];

export const SIGNAL_MODES = ["STRICT", "STANDARD", "FLEXIBLE"] as const;
export type SignalMode = typeof SIGNAL_MODES[number];

export const WEEKLY_REGIMES = ["GREEN", "NEUTRAL", "RED"] as const;
export type WeeklyRegime = typeof WEEKLY_REGIMES[number];

export const DAILY_REGIMES = ["RECLAIMED", "PULLBACK_VALID", "NEUTRAL", "RED"] as const;
export type DailyRegime = typeof DAILY_REGIMES[number];

export const SETUP_STATUSES = [
  "NO_SETUP",
  "SETUP_FORMING",
  "SETUP_CONFIRMED",
  "READY_TO_TRADE",
  "WATCH_EXTENDED",
  "WATCH_RETEST",
  "WATCH_STOP_TOO_WIDE",
  "WATCH_RR_TOO_LOW",
  "BLOCKED_DATA_MISMATCH",
  "SIGNAL_EXPIRED",
  "NO_TRADE",
] as const;
export type SetupStatus = typeof SETUP_STATUSES[number];

export const SETUP_TYPES = [
  "HAMMER",
  "BULLISH_ENGULFING",
  "STRONG_BULL_BAR",
  "AGGRESSIVE_BOUNCE",
  "BREAKOUT_RETEST",
  "RECLAIM_MOMENTUM_CONTINUATION",
  "FIRST_PULLBACK_AFTER_BREAKOUT",
  "HIGHER_LOW_CONSOLIDATION",
] as const;
export type SetupType = typeof SETUP_TYPES[number];

export const CARD_GRADES = ["A4_CORE", "A3_SWING", "A2_PRACTICE", "WATCH", "NO_TRADE"] as const;
export type CardGrade = typeof CARD_GRADES[number];

export const SWING_TIMEFRAMES = ["1H", "4H", "1D", "1W"] as const;
export type SwingTimeframe = typeof SWING_TIMEFRAMES[number];

export type VolumeCondition = "PASS" | "NEUTRAL" | "FAIL";

export interface PriceZone { low: number; high: number }

// ─── The decision object (spec §B) ──────────────────────────────────────────
export interface SwingDecision {
  symbol: string;                 // "SMH"
  exchange: string;               // "NASDAQ"
  currentPrice: number | null;
  quoteTimestamp: string | null;  // ISO, rendered in America/Chicago
  dataStatus: DataStatus;
  session: Session;
  timezone: "America/Chicago";

  userMode: UserMode;
  signalMode: SignalMode;

  weeklyRegime: WeeklyRegime;
  weeklyReclaimForming: boolean;  // current-week green candle, not yet Friday RTH close
  dailyRegime: DailyRegime;

  setupStatus: SetupStatus;
  setupType: SetupType | null;
  cardGrade: CardGrade;

  setupTimeframe: SwingTimeframe | null;
  setupTimestamp: string | null;
  originalTrigger: number | null;
  currentTrigger: number | null;
  entryPrice: number | null;
  structuralStop: number | null;
  stopBuffer: number | null;
  target1: number | null;
  target2: number | null;
  riskPerShare: number | null;
  rewardRiskT1: number | null;
  rewardRiskT2: number | null;
  maxDollarRisk: number;
  suggestedShares: number | null;  // informational only — never an order

  supportZone: PriceZone | null;
  resistanceZone: PriceZone | null;
  reclaimLevel: number | null;
  retestLevel: PriceZone | null;

  extensionPercentAboveTrigger: number | null;
  extensionAtr: number | null;
  isExtended: boolean;
  volumeCondition: VolumeCondition;
  dataMismatchReason: string | null;

  passedRules: string[];
  failedRules: string[];
  missingConditions: string[];
  whyThisPrinted: string[];
  whyNotReady: string[];
  invalidation: string[];         // "What invalidates the setup"
  nextAction: string;             // never empty
  learningExplanation: string;
  riskLabel: string;
  expiryTime: string | null;

  // Provenance (spec §M)
  dataSource: string | null;
  lastCompletedBar1H: string | null;
  lastCompletedBar4H: string | null;
  referenceClose: number | null;       // TradingView webhook or 2nd vendor close
  referenceSource: string | null;      // "tradingview" | "twelvedata" | "yahoo" | null
  evaluatedAt: string;
}

// ─── Fixed copy (spec §C, §I) ───────────────────────────────────────────────
export const PRACTICE_BANNER = "PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE";
export const GAP_RISK_WARNING = "OVERNIGHT GAP RISK — STOP ORDERS CAN FILL BELOW STOP PRICE.";
export const READY_WARNING = "PRACTICE ONLY — STOP ORDERS MAY FILL BELOW STOP PRICE, ESPECIALLY OVERNIGHT";
export const FORMING_WARNING = "NOT TRADEABLE YET — WAIT FOR CLOSED CONFIRMATION";
export const FLEX_RISK_LABEL = "FLEXIBLE / PRACTICE — REDUCED RISK";

// ─── Card priority for the Primary Swing Card (spec §C) ─────────────────────
// Lower number = shown first. BLOCKED_DATA_MISMATCH sits with WATCH states
// (a real setup exists but cannot be READY until data agrees).
export const STATUS_PRIORITY: Record<SetupStatus, number> = {
  READY_TO_TRADE: 1,
  SETUP_CONFIRMED: 2,
  SETUP_FORMING: 3,
  WATCH_RETEST: 4,
  WATCH_EXTENDED: 5,
  WATCH_STOP_TOO_WIDE: 6,
  WATCH_RR_TOO_LOW: 6,
  BLOCKED_DATA_MISMATCH: 1.5, // a would-be READY blocked by data — outranks cards that are merely waiting
  SIGNAL_EXPIRED: 7,
  NO_SETUP: 8,
  NO_TRADE: 8,
};

export function pickPrimary(decisions: SwingDecision[]): SwingDecision | null {
  if (!decisions.length) return null;
  return [...decisions].sort((a, b) => {
    const p = STATUS_PRIORITY[a.setupStatus] - STATUS_PRIORITY[b.setupStatus];
    if (p !== 0) return p;
    // Tie-break: better grade, then higher R:R to T1
    const g = CARD_GRADES.indexOf(a.cardGrade) - CARD_GRADES.indexOf(b.cardGrade);
    if (g !== 0) return g;
    return (b.rewardRiskT1 ?? 0) - (a.rewardRiskT1 ?? 0);
  })[0];
}

// ─── Scanner buckets (spec §K, §O) ──────────────────────────────────────────
export type ScannerBucket = "READY" | "CONFIRMED" | "FORMING" | "WATCH_RETEST" | "EXTENDED" | "EXPIRED" | "NO_TRADE";
export function bucketOf(s: SetupStatus): ScannerBucket {
  switch (s) {
    case "READY_TO_TRADE": return "READY";
    case "SETUP_CONFIRMED": return "CONFIRMED";
    case "SETUP_FORMING": return "FORMING";
    case "WATCH_RETEST":
    case "WATCH_STOP_TOO_WIDE":
    case "WATCH_RR_TOO_LOW":
    case "BLOCKED_DATA_MISMATCH": return "WATCH_RETEST";
    case "WATCH_EXTENDED": return "EXTENDED";
    case "SIGNAL_EXPIRED": return "EXPIRED";
    default: return "NO_TRADE";
  }
}

// ─── The no-contradiction contract (spec §B RULE, §K) ───────────────────────
// Every adapter maps status → label through here. Contract tests assert no
// panel can render a forbidden phrase for a given status.
export const FORBIDDEN_PHRASES: Record<SetupStatus, string[]> = {
  READY_TO_TRADE:        ["No Active Setup", "No Trade", "Hard Block", "Stand down"],
  SETUP_CONFIRMED:       ["No Active Setup", "Ready to Trade", "Hard Block", "Long"],
  SETUP_FORMING:         ["No Active Setup", "Ready to Trade", "Hard Block", "Long"],
  WATCH_RETEST:          ["No Active Setup", "Ready to Trade", "Hard Block", "Long"],
  WATCH_EXTENDED:        ["No Active Setup", "Ready to Trade", "Hard Block", "Long", "Full size"],
  WATCH_STOP_TOO_WIDE:   ["Ready to Trade", "Hard Block", "Long"],
  WATCH_RR_TOO_LOW:      ["Ready to Trade", "Hard Block", "Long"],
  BLOCKED_DATA_MISMATCH: ["Ready to Trade", "Hard Block", "Long"],
  SIGNAL_EXPIRED:        ["Ready to Trade", "Hard Block", "Long"],
  NO_SETUP:              ["Ready to Trade", "Hard Block", "Long"],
  NO_TRADE:              ["Ready to Trade", "Hard Block", "Long"],
};

export const STATUS_LABEL: Record<SetupStatus, string> = {
  READY_TO_TRADE: "Ready to Trade",
  SETUP_CONFIRMED: "Setup Confirmed — awaiting 1H close",
  SETUP_FORMING: "Setup Forming",
  WATCH_RETEST: "Watch — Retest",
  WATCH_EXTENDED: "Watch — Extended",
  WATCH_STOP_TOO_WIDE: "Watch — Stop Too Wide",
  WATCH_RR_TOO_LOW: "Watch — R:R Too Low",
  BLOCKED_DATA_MISMATCH: "Blocked — Data Mismatch",
  SIGNAL_EXPIRED: "Signal Expired",
  NO_SETUP: "No Setup",
  NO_TRADE: "No Trade",
};

// Entry Readiness gauge wording, capped by status (spec §K).
export function readinessLabel(score: number, s: SetupStatus): string {
  if (s === "READY_TO_TRADE") return score >= 75 ? "Strong — practice plan available" : "Ready — review plan";
  if (s === "WATCH_EXTENDED") return score >= 75 ? "Strong trend; no fresh entry — wait for retest." : "Extended — wait for retest";
  if (s === "SETUP_CONFIRMED") return "Confirmed — wait for closed 1H above trigger";
  if (s === "SETUP_FORMING") return "Forming — not tradeable yet";
  if (s === "WATCH_RETEST") return "Watching retest zone";
  if (s === "WATCH_STOP_TOO_WIDE") return "Structure stop exceeds risk policy";
  if (s === "WATCH_RR_TOO_LOW") return "Reward/risk below your minimum";
  if (s === "BLOCKED_DATA_MISMATCH") return "Data mismatch — resolve before entry";
  if (s === "SIGNAL_EXPIRED") return "Signal expired";
  return score >= 60 ? "Trend constructive — no setup yet" : "No setup";
}

// ─── Settings (spec §D) ─────────────────────────────────────────────────────
export interface SwingSettings {
  userMode: UserMode;
  signalMode: SignalMode;
  showFormingCards: boolean;
  showWatchCards: boolean;
  showLowQualityForming?: boolean; // Disciplined: show low-quality forming cards anyway
  allowCountertrend: boolean;
  requireVolume: boolean;
  requireWeeklyAlignment: boolean;
  requireDailyAlignment: boolean;
  allowEarlyTrigger: boolean;
  allowFirstPullback: boolean;
  minRrT1: 1.5 | 2 | 2.5;
  expiryBars4h: 1 | 2 | 3;
  maxDollarRisk: number;
  maxExtensionPct: number;
  maxExtensionAtr: number;
  rthOnly: boolean;
  timezone: string;
  entryBufferPct: number;   // small buffer above trigger
  stopBufferAtr: number;    // volatility buffer below structure
  universe: string[];       // exchange-qualified, e.g. "NASDAQ:SMH"
  autoRefresh1H: boolean;   // recompute on each closed RTH hour (approved 2026-09-24)
}

export const DEFAULT_UNIVERSE = ["NASDAQ:SMH", "NASDAQ:QQQ", "AMEX:SPY"];

export const DEFAULT_SWING_SETTINGS: SwingSettings = {
  userMode: "LEARN",
  signalMode: "FLEXIBLE",
  showFormingCards: true,
  showWatchCards: true,
  showLowQualityForming: false,
  allowCountertrend: false,
  requireVolume: false,
  requireWeeklyAlignment: false,
  requireDailyAlignment: false,
  allowEarlyTrigger: false,
  allowFirstPullback: true,
  minRrT1: 2,
  expiryBars4h: 2,
  maxDollarRisk: 100,
  maxExtensionPct: 1.0,
  maxExtensionAtr: 1.25,
  rthOnly: true,
  timezone: "America/Chicago",
  entryBufferPct: 0.05,
  stopBufferAtr: 0.1,
  universe: DEFAULT_UNIVERSE,
  autoRefresh1H: true,
};

/** Signal mode each user mode defaults to when the user switches modes. */
export const USER_MODE_DEFAULT_SIGNAL: Record<UserMode, SignalMode> = {
  LEARN: "FLEXIBLE",
  PRACTICE: "STANDARD",
  DISCIPLINED: "STANDARD",
};

export function splitSymbol(q: string): { exchange: string; symbol: string } {
  const [a, b] = q.includes(":") ? q.split(":") : ["", q];
  return { exchange: a || "", symbol: (b || a).toUpperCase() };
}
