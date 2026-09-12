// ─── Plan Check ────────────────────────────────────────────────────────
// Validates Chizzle Wealth Engine v2 plan output against the JSON schema
// AND against the calculation rules (Entry > Stop, T1 > Entry, T1 R ≥ 2,
// share math, dollar risk). Returns structured errors so both the LLM and
// the frontend can react.

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import fs from "node:fs";
import path from "node:path";
import {
  ChizzleWealthEnginePlanCheck,
  PROBABILITY_BOILERPLATE,
  PlanCheckInput,
  PlanCheckResponse,
} from "@shared/planCheckTypes";

// Load schema once at boot.
const schemaPath = path.resolve(process.cwd(), "shared/planCheckSchema.json");
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateFn = ajv.compile(schema);

// ─── Structural validation ─────────────────────────────────────────────
export function validatePlan(plan: unknown): {
  ok: boolean;
  errors: Array<{ path: string; message: string }>;
} {
  const ok = validateFn(plan);
  if (ok) return { ok: true, errors: [] };
  return {
    ok: false,
    errors: (validateFn.errors ?? []).map((e) => ({
      path: e.instancePath || "(root)",
      message: `${e.message ?? "invalid"}${e.params ? ` ${JSON.stringify(e.params)}` : ""}`,
    })),
  };
}

// ─── Rule-layer checks (numeric consistency beyond schema range) ───────
export function ruleCheck(plan: ChizzleWealthEnginePlanCheck): string[] {
  const violations: string[] = [];

  if (plan.decision === "NO TRADE" || plan.decision === "WATCHLIST") return violations;

  const { entry, stop, t1, t2, risk } = plan;
  if (entry.price == null || stop.price == null || t1.price == null) {
    violations.push("Approved plan missing entry/stop/T1 price.");
    return violations;
  }

  const R = entry.price - stop.price;
  if (R <= 0) violations.push("Entry must be greater than Stop.");
  if (t1.price <= entry.price) violations.push("T1 must be greater than Entry.");

  if (R > 0) {
    const t1R = (t1.price - entry.price) / R;
    if (Math.abs(t1R - (t1.r_multiple ?? 0)) > 0.05) {
      violations.push(
        `T1 R multiple mismatch: reported ${t1.r_multiple}, computed ${t1R.toFixed(2)}.`,
      );
    }
    if (t1R < 2.0) violations.push(`T1 R must be >= 2.0 (got ${t1R.toFixed(2)}).`);

    if (t2.price != null && t2.r_multiple != null) {
      const t2R = (t2.price - entry.price) / R;
      if (Math.abs(t2R - t2.r_multiple) > 0.05) {
        violations.push(
          `T2 R multiple mismatch: reported ${t2.r_multiple}, computed ${t2R.toFixed(2)}.`,
        );
      }
    }
  }

  // Share math: dollar_risk = shares * R
  if (risk.shares != null && risk.dollar_risk != null && R > 0) {
    const impliedDollar = risk.shares * R;
    if (Math.abs(impliedDollar - risk.dollar_risk) / risk.dollar_risk > 0.02) {
      violations.push(
        `Shares × R = $${impliedDollar.toFixed(2)} but dollar_risk reported $${risk.dollar_risk.toFixed(2)}.`,
      );
    }
  }

  // Position value = shares * entry
  if (risk.shares != null && risk.position_value != null) {
    const implied = risk.shares * entry.price;
    if (Math.abs(implied - risk.position_value) / risk.position_value > 0.02) {
      violations.push(
        `Shares × Entry = $${implied.toFixed(2)} but position_value reported $${risk.position_value.toFixed(2)}.`,
      );
    }
  }

  // Countertrend hard cap on risk %
  if (plan.type === "Countertrend" && risk.pct != null && risk.pct > 1.0) {
    violations.push(`Countertrend risk capped at 1.0% (got ${risk.pct}%).`);
  }

  return violations;
}

// ─── Convenience: full check pipeline ──────────────────────────────────
export function checkPlan(plan: unknown): PlanCheckResponse {
  const structural = validatePlan(plan);
  if (!structural.ok) {
    return { ok: false, plan: null, errors: structural.errors, rule_violations: [] };
  }
  const typed = plan as ChizzleWealthEnginePlanCheck;
  const violations = ruleCheck(typed);
  return {
    ok: violations.length === 0,
    plan: typed,
    errors: [],
    rule_violations: violations,
  };
}

// ─── Fallback: build a NO-TRADE plan when input is incomplete ──────────
export function noTradePlan(symbol: string, reasons: string[]): ChizzleWealthEnginePlanCheck {
  return {
    symbol: symbol.toUpperCase(),
    decision: "NO TRADE",
    regime: "RED",
    benchmarks: { spy: "RED", qqq: "RED", smh: "N/A" },
    score: 0,
    grade: "NO-TRADE",
    type: "None",
    why: reasons.slice(0, 3),
    entry: { price: null, trigger: "n/a" },
    stop: { price: null, reason: "n/a" },
    t1: { price: null, r_multiple: null, reason: "n/a" },
    t2: { price: null, r_multiple: null, reason: "n/a" },
    risk: { pct: null, dollar_risk: null, shares: null, position_value: null },
    management: { plus_1r: "n/a", at_t1: "n/a", failure: "n/a" },
    invalidate_if: [],
    probability: PROBABILITY_BOILERPLATE,
    meta: {
      generated_at: new Date().toISOString(),
      prompt_version: "v2",
      missing_fields: reasons,
    },
  };
}

// ─── Deterministic plan builder (no LLM needed) ────────────────────────
// Applies the v2 rules to raw INPUT and returns a validated plan.
// This is what the /api/plan-check route runs when the caller passes `input`.
export function buildPlanFromInput(input: PlanCheckInput): ChizzleWealthEnginePlanCheck {
  const missing: string[] = [];
  const required: Array<[string, unknown]> = [
    ["price", input.price],
    ["sma20", input.sma20],
    ["sma50", input.sma50],
    ["sma50_slope", input.sma50_slope],
    ["support", input.support?.price],
    ["resistance_1", input.resistance_1],
    ["volume_ratio", input.volume_ratio],
    ["relative_strength_spy", input.relative_strength_spy],
    ["spy_state", input.spy_state],
    ["qqq_state", input.qqq_state],
    ["account_size", input.account_size],
  ];
  for (const [k, v] of required) if (v == null) missing.push(k);
  if (missing.length) return noTradePlan(input.symbol ?? "?", [`incomplete data: ${missing.join(", ")}`]);

  const {
    symbol, price, sma20, sma50, sma50_slope, support, resistance_1, resistance_2,
    volume_ratio, relative_strength_spy, spy_state, qqq_state, smh_state,
    earnings_date, account_size, open_risk_pct, sector,
  } = input;

  const above50 = price > sma50;
  const rising50 = sma50_slope !== "down";
  const isSemi = sector === "semi";
  const isGrowth = sector === "growth" || sector === "semi";

  // Regime aggregation
  const regimeOf = (s: string): 0 | 1 | 2 => (s === "GREEN" ? 2 : s === "YELLOW" ? 1 : 0);
  const regs: number[] = [regimeOf(spy_state)];
  if (isGrowth) regs.push(regimeOf(qqq_state));
  if (isSemi && smh_state !== "N/A") regs.push(regimeOf(smh_state as string));
  const worst = Math.min(...regs);
  const regime: "GREEN" | "YELLOW" | "RED" = worst === 2 ? "GREEN" : worst === 1 ? "YELLOW" : "RED";

  // Earnings gate
  const earningsSoon = earnings_date !== "none within 10 sessions";

  // Trend setup: above 50 SMA + rising slope + regime not RED
  const trendOK = above50 && rising50 && regime !== "RED" && !earningsSoon;
  // Countertrend: below 50 SMA + regime GREEN/YELLOW + volume confirmation
  const countertrendOK =
    !above50 &&
    regime !== "RED" &&
    volume_ratio >= 1.2 &&
    price >= support.price &&
    !earningsSoon &&
    (!isSemi || (smh_state !== "RED"));

  if (!trendOK && !countertrendOK) {
    const why: string[] = [];
    if (regime === "RED") why.push(`Regime RED (SPY ${spy_state}, QQQ ${qqq_state})`);
    if (earningsSoon) why.push(`Earnings ${earnings_date} inside 10-session window`);
    if (!above50 && volume_ratio < 1.2) why.push(`Below 50 SMA without volume confirmation (${volume_ratio}x)`);
    if (isSemi && smh_state === "RED") why.push("SMH in severe breakdown");
    if (!why.length) why.push("Setup rules not satisfied");
    return noTradePlan(symbol, why);
  }

  const type: "Trend" | "Countertrend" = trendOK ? "Trend" : "Countertrend";

  // Entry / Stop / Targets
  // Trend: buy the pullback — entry at 20D SMA (or current if price is below 20D).
  //        Stop tucks under whichever is lower of the 20D SMA or nearest support.
  // CT:    entry at current close, stop under support low.
  const entry = type === "Trend" ? Math.min(price, sma20) : price;
  const stopBase = type === "Trend" ? Math.min(sma20, support.price) : support.price;
  const stop = stopBase * (type === "Trend" ? 0.985 : 0.99); // 1.5% cushion on trend, 1% on CT
  const R = entry - stop;
  const t1_price = resistance_1;
  const t1_r = (t1_price - entry) / R;
  const t2_price = resistance_2 ?? entry + R * 4;
  const t2_r = (t2_price - entry) / R;

  if (R <= 0 || t1_r < 2.0) {
    return noTradePlan(symbol, [
      `Insufficient R:R (entry ${entry.toFixed(2)}, stop ${stop.toFixed(2)}, T1 ${t1_price.toFixed(2)}, T1R ${t1_r.toFixed(2)})`,
    ]);
  }

  // Risk sizing
  const baseRisk = type === "Countertrend"
    ? 0.75
    : regime === "GREEN" ? 1.75 : 1.25;
  const room = Math.max(0, 6 - (open_risk_pct ?? 0));
  const riskPct = Math.min(baseRisk, room);
  if (riskPct < 0.5) {
    return noTradePlan(symbol, [`Book risk full: open ${open_risk_pct}% leaves <0.5% room`]);
  }
  const dollarRisk = account_size * (riskPct / 100);
  const shares = Math.floor(dollarRisk / R);
  const positionValue = shares * entry;

  if (shares < 1) return noTradePlan(symbol, ["Sub-share position at requested risk"]);

  // Score
  let score = 0;
  score += regime === "GREEN" ? 20 : regime === "YELLOW" ? 12 : 0;
  score += (above50 && rising50) ? 20 : above50 ? 14 : rising50 ? 8 : 4;
  score += relative_strength_spy > 0 ? 15 : relative_strength_spy > -3 ? 8 : 3;
  score += volume_ratio >= 1.5 ? 15 : volume_ratio >= 1.2 ? 10 : 5;
  score += 12; // location/stop clarity (support supplied)
  score += t1_r >= 3 ? 15 : t1_r >= 2.5 ? 12 : 10;

  // Countertrend cap: score can't push past A
  if (type === "Countertrend" && score < 80) {
    return noTradePlan(symbol, [`Countertrend score ${score} below required 80`]);
  }
  const cappedScore = type === "Countertrend" ? Math.min(score, 89) : score;
  const grade: "A+" | "A" | "B" | "C" | "NO-TRADE" =
    cappedScore >= 90 ? "A+" : cappedScore >= 80 ? "A" : cappedScore >= 70 ? "B" : cappedScore >= 60 ? "C" : "NO-TRADE";

  if (grade === "NO-TRADE" || grade === "C") {
    return noTradePlan(symbol, [`Score ${cappedScore} below A/B threshold`]);
  }

  const decision =
    type === "Trend" ? "APPROVED TREND" : "APPROVED COUNTERTREND - REDUCED SIZE";

  const why: string[] = [];
  if (type === "Trend") {
    why.push(rising50 ? "Rising 50D SMA with price above" : "Reclaimed 50D SMA");
    why.push(`Volume ${volume_ratio}x avg, RS vs SPY ${relative_strength_spy > 0 ? "+" : ""}${relative_strength_spy}`);
    why.push(`T1 offers ${t1_r.toFixed(2)}R to ${support.source ? "prior resistance" : "resistance_1"}`);
  } else {
    why.push(`At ${support.source} with volume confirmation ${volume_ratio}x`);
    why.push(`SPY ${spy_state}${isGrowth ? `/QQQ ${qqq_state}` : ""} supportive`);
    why.push(`T1 offers ${t1_r.toFixed(2)}R with reduced ${riskPct}% risk`);
  }

  return {
    symbol: symbol.toUpperCase(),
    decision,
    regime,
    benchmarks: { spy: spy_state, qqq: qqq_state, smh: smh_state ?? "N/A" },
    score: cappedScore,
    grade,
    type,
    why,
    entry: { price: round(entry), trigger: type === "Trend" ? "Pullback hold at 20D or reclaim" : "Reversal close above support" },
    stop:  { price: round(stop), reason: `Below ${type === "Trend" ? "20D + support" : "support low"}` },
    t1:    { price: round(t1_price), r_multiple: round(t1_r, 2), reason: "Prior resistance" },
    t2:    { price: round(t2_price), r_multiple: round(t2_r, 2), reason: resistance_2 ? "Weekly resistance" : "Projected 4R extension" },
    risk:  { pct: riskPct, dollar_risk: round(dollarRisk), shares, position_value: round(positionValue) },
    management: {
      plus_1r: "Move stop to breakeven",
      at_t1:   "Sell 1/2, trail remainder under 10D",
      failure: `Close below ${round(stop)} on daily basis`,
    },
    invalidate_if: [
      type === "Trend" ? "Loss of 20D SMA on volume" : "Close back below support",
      regime === "GREEN" ? "SPY turns YELLOW/RED" : "SPY turns RED",
    ],
    probability: PROBABILITY_BOILERPLATE,
    meta: {
      generated_at: new Date().toISOString(),
      prompt_version: "v2",
      model: "deterministic-builder",
    },
  };
}

function round(n: number, dp = 2): number {
  const m = Math.pow(10, dp);
  return Math.round(n * m) / m;
}
