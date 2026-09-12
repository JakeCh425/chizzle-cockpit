// Auto-mirrored from shared/planCheckSchema.json.
// Hand-authored (json-schema-to-typescript loses precision on if/then and oneOf).
// If you edit the schema, keep these types in sync.

export type Decision =
  | "APPROVED TREND"
  | "APPROVED COUNTERTREND - REDUCED SIZE"
  | "WATCHLIST"
  | "NO TRADE";

export type Regime = "GREEN" | "YELLOW" | "RED";
export type RegimeOrNA = Regime | "N/A";
export type Grade = "A+" | "A" | "B" | "C" | "NO-TRADE";
export type SetupType = "Trend" | "Countertrend" | "None";

export interface Benchmarks {
  spy: Regime;
  qqq: Regime;
  smh: RegimeOrNA;
}

export interface PricePoint {
  price: number | null;
  trigger?: string;
  reason?: string;
}

export interface TargetPoint {
  price: number | null;
  r_multiple: number | null;
  reason: string;
}

export interface EntryPoint {
  price: number | null;
  trigger: string;
}

export interface StopPoint {
  price: number | null;
  reason: string;
}

export interface Risk {
  pct: number | null;
  dollar_risk: number | null;
  shares: number | null;
  position_value: number | null;
}

export interface Management {
  plus_1r: string;
  at_t1: string;
  failure: string;
}

export interface PlanCheckMeta {
  generated_at?: string;
  prompt_version?: string;
  model?: string;
  input_hash?: string;
  missing_fields?: string[];
  rule_violations?: string[];
}

export const PROBABILITY_BOILERPLATE =
  "Probability unavailable - Setup Quality is a current-conditions score, not a forecast." as const;

export interface ChizzleWealthEnginePlanCheck {
  symbol: string;
  decision: Decision;
  regime: Regime;
  benchmarks: Benchmarks;
  score: number;
  grade: Grade;
  type: SetupType;
  why: string[];
  entry: EntryPoint;
  stop: StopPoint;
  t1: TargetPoint;
  t2: TargetPoint;
  risk: Risk;
  management: Management;
  invalidate_if: string[];
  probability: typeof PROBABILITY_BOILERPLATE;
  meta?: PlanCheckMeta;
}

// Input contract mirrors the "INPUT DATA" section of the v2 prompt.
// The route accepts either raw INPUT (to call the model) OR a pre-built plan
// object (to validate a plan produced elsewhere).
export interface PlanCheckInput {
  symbol: string;
  sector?: "semi" | "growth" | "other";
  price: number;
  sma20: number;
  sma50: number;
  sma50_slope: "up" | "flat" | "down";
  support: { price: number; source: string };
  resistance_1: number;
  resistance_2?: number;
  volume_ratio: number;
  relative_strength_spy: number;
  relative_strength_qqq?: number;
  relative_strength_smh?: number;
  spy_state: Regime;
  qqq_state: Regime;
  smh_state: RegimeOrNA;
  earnings_date: string | "none within 10 sessions";
  account_size: number;
  open_risk_pct: number;
  fractional_shares: boolean;
}

export interface PlanCheckRequest {
  // Provide EITHER `input` (to have the server invoke the model) OR `plan`
  // (to validate an externally-produced plan JSON).
  input?: PlanCheckInput;
  plan?: ChizzleWealthEnginePlanCheck;
}

export interface PlanCheckResponse {
  ok: boolean;
  plan: ChizzleWealthEnginePlanCheck | null;
  errors: Array<{ path: string; message: string }>;
  rule_violations: string[];
}
