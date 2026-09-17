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
  | "No trade";

export type FlexRiskGrade =
  | "STANDARD SMALL"
  | "FLEX HALF SIZE"
  | "NO TRADE";

export type FlexAction =
  | "ENTER ONLY ON TRIGGER"
  | "SET ALERT"
  | "STAND DOWN";

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
  sma20?: number;
  sma50?: number;
  sma200?: number;
  sma200_slope_pct?: number;
  sma50_slope_pct?: number;
  dist_from_sma20_pct?: number;
  dist_from_sma50_pct?: number;
  relative_volume?: number;
  atr14?: number;
  confirmed_higher_low?: boolean;
  reclaim_trigger?: boolean;
  prior_pivot_low?: number | null;
  latest_pivot_low?: number | null;
  prior_swing_high?: number | null;
}

export interface FlexDeskCard {
  state: FlexState;
  ticker: string;
  setup: FlexSetup;
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
  action: FlexAction;
  metrics?: FlexMetrics;
}

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

export interface FlexScanRequest {
  universe?: string[]; // optional override; else uses default ETF list
  include_tech_concentrated?: boolean; // QQQ/SMH/SOXX/SMH-derived
}
