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

  target1Source?: "resistance" | "r-multiple";
  target2Source?: "resistance" | "r-multiple";

  // §Q — additive: chart overlay derived from this decision and its setup history.
  chart?: ChartOverlay;
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
  /** Where the ATR-extension leg is measured from. TRIGGER (default, flexible) or DAILY_SMA20 (spec-strict). */
  extensionAtrAnchor?: "TRIGGER" | "DAILY_SMA20";
  /** Retest zone = [trigger − retestBelowAtr·ATR, trigger + max(maxExtensionPct %, retestZoneAtr·ATR)]. */
  retestZoneAtr?: number;
  retestBelowAtr?: number;
  /** Which setups may earn A2 practice cards: ALL 8 (default) or only the §J list. */
  a2SetupScope?: "ALL" | "SPEC_LIST";
  /** 15m/30m may inform learning only; never override 1H/4H confirmation unless this is on. */
  intradayLearningMode?: boolean;
  maxCustomTickers?: number;
  watchlist?: WatchItem[];
  rthOnly: boolean;
  timezone: string;
  entryBufferPct: number;   // small buffer above trigger
  stopBufferAtr: number;    // volatility buffer below structure
  universe: string[];       // exchange-qualified, e.g. "NASDAQ:SMH"
  autoRefresh1H: boolean;   // recompute on each closed RTH hour (approved 2026-09-24)
}

export const DEFAULT_UNIVERSE = ["NASDAQ:SMH", "NASDAQ:QQQ", "AMEX:SPY"];

// ─── Watchlist (spec §Q1) ───────────────────────────────────────────────────
export type AssetType = "ETF" | "STOCK";
export type WatchCategory = "DEFAULT_LEARNING" | "ETFS" | "SEMICONDUCTOR" | "BROAD_MARKET" | "GROWTH_TECH" | "CUSTOM" | "ARCHIVED";
export const WATCH_CATEGORIES: WatchCategory[] = ["DEFAULT_LEARNING", "ETFS", "SEMICONDUCTOR", "BROAD_MARKET", "GROWTH_TECH", "CUSTOM", "ARCHIVED"];
export interface WatchItem {
  symbol: string;            // "SMH"
  exchange: string;          // "NASDAQ"
  name?: string;
  assetType: AssetType;
  categories: WatchCategory[];
  isDefault: boolean;        // defaults can be hidden, never deleted
  hidden: boolean;
  pinned: boolean;
  order: number;
  notes?: string;
}
export const DEFAULT_WATCHLIST: WatchItem[] = [
  { symbol: "SMH", exchange: "NASDAQ", name: "VanEck Semiconductor ETF", assetType: "ETF", categories: ["DEFAULT_LEARNING", "ETFS", "SEMICONDUCTOR"], isDefault: true, hidden: false, pinned: false, order: 0 },
  { symbol: "QQQ", exchange: "NASDAQ", name: "Invesco QQQ Trust", assetType: "ETF", categories: ["DEFAULT_LEARNING", "ETFS", "GROWTH_TECH"], isDefault: true, hidden: false, pinned: false, order: 1 },
  { symbol: "SPY", exchange: "AMEX", name: "SPDR S&P 500 ETF", assetType: "ETF", categories: ["DEFAULT_LEARNING", "ETFS", "BROAD_MARKET"], isDefault: true, hidden: false, pinned: false, order: 2 },
];
export const DEFAULT_UNIVERSE_LABEL = "DEFAULT LEARNING UNIVERSE";
export const SINGLE_STOCK_RISK = "SINGLE-STOCK EVENT RISK — verify earnings date and news before swing planning.";
export const ETF_RISK = "ETF — diversified but may still have sector or top-holding concentration risk.";
export type ScanSelection = "DEFAULT" | "DEFAULT_PLUS_CUSTOM" | "ETFS" | "STOCKS" | "SEMICONDUCTOR" | "BROAD_MARKET" | "CUSTOM_SELECTION";

// ─── Chart overlay (spec §Q4) — built ONLY from SwingDecision + setup history ──
export type MarkerKind = "FORMING" | "CONFIRMED" | "READY" | "EXTENDED" | "INVALIDATED" | "EXPIRED";
export interface ChartMarker {
  id: string;
  kind: MarkerKind;
  time: number;              // unix sec of the bar the marker belongs to (bar START)
  barEnd: number;            // unix sec the bar closed (markers only from closed bars, except FORMING)
  timeframe: SwingTimeframe;
  price: number;
  label: string;             // "FORMING: Hammer"
  setupType: SetupType;
  status: SetupStatus;
  tooltip: string[];         // plain-English lines
  current: boolean;          // belongs to the primary decision
}
export type LevelKind = "ENTRY" | "STOP" | "T1" | "T2";
export interface ChartLevel {
  id: string; kind: LevelKind; price: number; label: string;
  style: "dashed" | "solid"; tooltip: string[]; setupId: string; current: boolean;
}
export interface ChartZone { id: string; kind: "RETEST" | "SUPPORT" | "RESISTANCE"; low: number; high: number; label: string; tooltip: string[]; current: boolean }
export interface SetupHistoryEntry {
  id: string; setupType: SetupType; status: SetupStatus; timeframe: SwingTimeframe;
  setupTimestamp: string | null; trigger: number | null; stop: number | null; t1: number | null; t2: number | null;
  rrT1: number | null; grade: CardGrade; reason: string; current: boolean;
}
export interface ChartOverlay { markers: ChartMarker[]; levels: ChartLevel[]; zones: ChartZone[]; history: SetupHistoryEntry[] }

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
  maxExtensionPct: 1.5,
  maxExtensionAtr: 1.5,
  extensionAtrAnchor: "TRIGGER",
  retestZoneAtr: 0.5,
  retestBelowAtr: 0.25,
  a2SetupScope: "ALL",
  intradayLearningMode: false,
  maxCustomTickers: 12,
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

// ─── §Q6 "CAN I PRACTICE THIS SETUP?" — pure, shared by server and UI ────────
export type PracticeVerdictCode = "A_READY" | "B_NOT_YET" | "C_WAIT_EXTENDED" | "D_PASS_RISK" | "E_NO_SETUP";
export interface PracticeVerdict {
  code: PracticeVerdictCode; headline: string; lines: string[];
  status: SetupStatus; entry: number | null; stop: number | null; t1: number | null; t2: number | null;
  rrT1: number | null; nextAction: string; riskWarning: string;
}
const $ = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(2)}`);
export function practiceVerdict(d: SwingDecision): PracticeVerdict {
  const base = { status: d.setupStatus, entry: d.entryPrice, stop: d.structuralStop, t1: d.target1, t2: d.target2, rrT1: d.rewardRiskT1, nextAction: d.nextAction, riskWarning: GAP_RISK_WARNING };
  switch (d.setupStatus) {
    case "READY_TO_TRADE":
      return { ...base, code: "A_READY", headline: "YES — a practice plan is available", lines: [...d.passedRules.slice(0, 6), "Review the plan before deciding."] };
    case "SETUP_FORMING": case "SETUP_CONFIRMED":
      return { ...base, code: "B_NOT_YET", headline: `NOT YET — setup is ${d.setupStatus === "SETUP_FORMING" ? "forming" : "confirmed but not triggered"}`,
        lines: [`Wait for a 1H close above ${$(d.originalTrigger)}.`, "Do not enter from an unfinished candle.", ...d.missingConditions.slice(0, 3)] };
    case "BLOCKED_DATA_MISMATCH":
      return { ...base, code: "B_NOT_YET", headline: "NOT YET — data sources disagree", lines: [d.dataMismatchReason ?? "Data mismatch", "Markers stay visible, but READY is blocked until the data agrees."] };
    case "WATCH_EXTENDED": case "WATCH_RETEST":
      return { ...base, code: "C_WAIT_EXTENDED", headline: `WAIT — original setup was valid, but price is ${d.extensionPercentAboveTrigger ?? "—"}% above trigger`,
        lines: ["Do not chase.", d.retestLevel ? `Watch ${$(d.retestLevel.low)}–${$(d.retestLevel.high)} for a bullish 1H retest.` : "Wait for a structured pullback."] };
    case "WATCH_STOP_TOO_WIDE": case "WATCH_RR_TOO_LOW":
      return { ...base, code: "D_PASS_RISK", headline: "PASS — risk does not fit",
        lines: [`A structural stop below ${$(d.structuralStop)} makes risk per share ${$(d.riskPerShare)}, and Target 1 offers only ${d.rewardRiskT1 ?? "—"}R.`, "Wait for a better structure."] };
    default:
      return { ...base, code: "E_NO_SETUP", headline: d.setupStatus === "SIGNAL_EXPIRED" ? "NO SETUP — last signal expired" : "NO SETUP",
        lines: [d.setupStatus === "SIGNAL_EXPIRED" ? "The last setup expired or was invalidated." : "No confirmed reclaim, pullback, or breakout-retest.",
          `Watch support ${$(d.supportZone?.low)} and resistance ${$(d.resistanceZone?.high)}.`] };
  }
}
