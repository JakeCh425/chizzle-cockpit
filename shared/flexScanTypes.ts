// ─── Chizzle Wealth FLEX Swing Scanner — TypeScript contract ─────────
// Mirrors shared/flexScanSchema.json. Hand-authored so the enum unions stay
// tight (json-schema-to-typescript widens them under oneOf/if-then).

export type FlexState =
  | "STANDARD_READY"
  | "FLEX_READY"
  | "FLEX_WATCH"
  | "STANDBY";

export type FlexSetup =
  | "Trend continuation"
  | "Higher-low recovery"
  | "Developing recovery"
  | "Bounce reclaim"
  | "No trade";

export type FlexRiskGrade =
  | "STANDARD SMALL"
  | "FLEX HALF SIZE"
  | "NO TRADE";

export type FlexAction =
  | "ENTER ONLY ON TRIGGER"
  | "ENTER — SMALL"
  | "ENTER — HALF SIZE"
  | "SET ALERT"
  | "STAND DOWN";

export type VehicleClass = "GROWTH_TECH" | "BROAD_MARKET" | "NON_GROWTH" | "OTHER";

export type VehiclePermission = "STANDARD_OR_FLEX" | "FLEX_ONLY" | "NO_LONG";

export type FlexDayType =
  | "PRACTICE_SWING_DAY"
  | "ETF_EXPOSURE_DAY"
  | "SINGLE_STOCK_INVESTING_DAY"
  | "STANDBY_DAY";

export type SmhContextState = "GREEN" | "YELLOW" | "RED";

export interface FlexEntryZone {
  low: number | null;
  high: number | null;
  note: string;
}

export interface FlexStop {
  price: number | null;
  reason: string;
}

export interface FlexTarget {
  price: number | null;
  r_multiple: number | null;
}

export interface FlexFakeoutCheck {
  result: "PASS" | "FAIL";
  reasons: string[];
}

export interface FlexMetrics {
  price?: number;
  prev_close?: number;
  day_change_pct?: number;
  sma20?: number;
  sma50?: number;
  sma200?: number;
  sma20_slope_pct?: number;
  sma50_slope_pct?: number;
  sma200_slope_pct?: number;
  dist_from_sma20_pct?: number;
  dist_from_sma50_pct?: number;
  dist_from_sma200_pct?: number;
  relative_volume?: number;
  atr14?: number;
  confirmed_higher_low?: boolean;
  reclaim_trigger?: boolean;
  prior_pivot_low?: number | null;
  latest_pivot_low?: number | null;
  prior_swing_high?: number | null;
  nearest_support?: number | null;
  nearest_resistance?: number | null;
  dist_to_trigger_pct?: number | null;
  // Lowest low across the last 3 daily bars (excluding the current bar).
  // Used to compute a "bounce off 3-day low" momentum badge and to feed the
  // regime-alerts engine's move-based trigger.
  three_day_low?: number | null;
  // Percent move of the current bar's close above `three_day_low`.
  // Positive when price is currently above the 3-day low.
  off_low_pct?: number | null;
  // True when the "Bounce reclaim" trigger is armed on the current bar:
  //   off_low_pct >= 3 AND relative_volume >= 1.2 AND |dist_from_sma20_pct| <= 2.
  // Used by the FLEX scanner to promote the card to FLEX_READY with a
  // prior-swing-low-based stop, and by the regime alert engine to fire a
  // BOUNCE_RECLAIM alert on the same condition.
  bounce_reclaim_trigger?: boolean;
}

// Precise, actionable gap between the ticker's current state and READY.
// Each item is one required condition, currently unmet, expressed as
// {name, current_value, needed}, plus a concise "do X" next step.
export interface DistanceToReadyItem {
  name: string;         // e.g. "200-SMA slope"
  current: string;      // e.g. "-1.9%"
  needed: string;       // e.g. ">= 0"
  next_action: string;  // e.g. "Wait for 200-SMA to flatten to at least 0.0%"
}

export interface FlexDeskCard {
  state: FlexState;
  ticker: string;
  pinned?: boolean;              // always true for SMH / QQQ / SPY
  vehicle_class: VehicleClass;
  permission: VehiclePermission;
  setup: FlexSetup;
  readiness_score: number;       // 0-100
  distance_to_ready: DistanceToReadyItem[]; // [] means READY
  trend: string;
  structure: string;
  trigger: string;
  entry_zone: FlexEntryZone;
  stop: FlexStop;
  target_1: FlexTarget;
  target_2?: FlexTarget | null;
  risk_grade: FlexRiskGrade;
  fakeout_check: FlexFakeoutCheck;
  smh_market_context: string;
  market_confirmation: "CONFIRMED" | "MIXED" | "INVALIDATED";
  action: FlexAction;
  hard_blocks: string[];         // e.g. ["Below declining 200-SMA", "No defined invalidation"]
  metrics?: FlexMetrics;
  // ─── Extension tier (optional, additive) ────────────────────────────────
  // Present when SMA20 + ATR14 are available. Lets the UI render a
  // Normal / Caution / Extended / Severely Extended pill and a
  // setup-aware next-action instead of the old universal STAND DOWN.
  extension?: ExtensionSummary | null;
  // ─── Score sub-facets (optional, additive) ──────────────────────────────
  // readiness_score stays as the primary 0-100 number; these break it apart
  // so the UI can show "strong trend, poor entry" without dropping the
  // ticker off the card.
  trend_strength?: number;       // 0-100 — pure trend structure quality
  setup_quality?: number;        // 0-100 — pattern / trigger validity
  entry_quality?: number;        // 0-100 — how good this instant's price is as an entry
  risk_permission?: RiskPermission; // ALLOWED | REDUCED | WATCH | BLOCKED
}

export type RiskPermission = "ALLOWED" | "REDUCED" | "WATCH" | "BLOCKED";

export type ExtensionTier = "normal" | "caution" | "extended" | "severely_extended";

export interface ExtensionSummary {
  tier: ExtensionTier;
  atr_distance: number;           // (price − SMA20) / ATR14 — can be negative below SMA
  pct_distance: number;           // ((price − SMA20) / SMA20) * 100
  dollar_distance: number;        // price − SMA20
  sma20: number;
  atr14: number;
  price: number;
  score_penalty: number;          // subtracted from readiness_score
  headline: string;               // one-line UI headline
  detail: string;                 // longer explanation
  next_action: string;            // what would improve the entry
}

// Configurable tiers. Keep in ONE place so backtesting / adjustment is
// centralized. All boundaries are (price − SMA20) / ATR14.
export const EXTENSION_TIERS: Record<ExtensionTier, { min: number; max: number; penalty: number }> = {
  normal:            { min: -Infinity, max: 0.75,  penalty: 0 },
  caution:           { min: 0.75,      max: 1.25,  penalty: 10 },
  extended:          { min: 1.25,      max: 2.0,   penalty: 25 },
  severely_extended: { min: 2.0,       max: Infinity, penalty: 100 },
};

export interface FlexScanResult {
  computed_at: string;
  day_type: FlexDayType;
  smh_context: { state: SmhContextState; note: string };
  cards: FlexDeskCard[];
  account_instructions: {
    swing: string;
    etf: string;
    single_stock: string;
  };
  one_sentence_summary: string;
}

export const GROWTH_TECH_TICKERS = new Set([
  "QQQ", "SMH", "SOXX", "XLK", "IGV", "SOXL", "SOXS", "QQQJ",
]);

export const BROAD_MARKET_TICKERS = new Set([
  "SPY", "VOO", "VTI", "DIA", "IWM", "VXUS",
]);

// Non-growth: value / dividend / income / defensive / cyclical sectors.
// These are evaluated on their own price structure; SMH RED does not veto.
export const NON_GROWTH_TICKERS = new Set([
  "XLF", "XLE", "XLV", "XLI", "XLY", "XLP", "XLU", "XLB", "XLC", "XLRE",
  "VDE", "VTV", "VYM", "SCHD", "GLD", "SLV", "TLT",
]);

export interface FlexScanRequest {
  universe?: string[]; // optional override; else uses default ETF list
  include_tech_concentrated?: boolean; // QQQ/SMH/SOXX/SMH-derived
}
