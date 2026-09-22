// ============================================================================
// Extension Tier Classifier
// ----------------------------------------------------------------------------
// Replaces the old universal "price > SMA20 + 1.25*ATR14 → STAND DOWN" hard
// block with a tiered, setup-aware classifier.
//
// Being above the 20-SMA is trend evidence, not a rejection reason. The
// concern is *how far* above and whether the corresponding stop distance
// creates unacceptable risk for a *new* entry of a *given setup type*.
//
// This module is intentionally pure so it can be unit-tested without a DB,
// a market-data provider, or the rest of the scanner state machine.
// ============================================================================

import {
  EXTENSION_TIERS,
  type ExtensionSummary,
  type ExtensionTier,
} from "@shared/flexScanTypes";

// Setup families we know about. The scanner uses more granular strings
// ("Reclaim base", "Developing recovery", etc.); mapSetupFamily below
// collapses those onto one of these families so the classifier can pick
// the right next-action language.
export type SetupFamily =
  | "pullback"      // waiting for pullback into SMA20 / prior support
  | "breakout"      // clearing a base / pivot high
  | "reclaim"       // reclaiming a lost SMA or level
  | "continuation"  // trend continuation, price extending
  | "bounce"        // bouncing off a specific level
  | "unknown";

export function mapSetupFamily(setup: string | undefined | null): SetupFamily {
  const s = (setup || "").toLowerCase();
  if (!s) return "unknown";
  if (s.includes("pullback")) return "pullback";
  if (s.includes("breakout") || s.includes("base")) return "breakout";
  if (s.includes("reclaim") || s.includes("recovery")) return "reclaim";
  if (s.includes("bounce")) return "bounce";
  if (s.includes("continuation") || s.includes("trend")) return "continuation";
  return "unknown";
}

// Classify (price, SMA20, ATR14) into one of the four tiers. Returns null
// only when the required data isn't available — callers must not fabricate.
export function classifyExtensionTier(
  price: number,
  sma20: number,
  atr14: number
): ExtensionTier | null {
  if (!Number.isFinite(price) || !Number.isFinite(sma20) || !Number.isFinite(atr14) || atr14 <= 0 || sma20 <= 0) {
    return null;
  }
  const atrDist = (price - sma20) / atr14;
  const tiers: ExtensionTier[] = ["normal", "caution", "extended", "severely_extended"];
  for (const tier of tiers) {
    const bounds = EXTENSION_TIERS[tier];
    // Half-open interval [min, max) so a value exactly at 1.25 lands in
    // "extended" and a value exactly at 2.0 lands in "severely_extended".
    if (atrDist >= bounds.min && atrDist < bounds.max) return tier;
  }
  // Anything above the last bound (Infinity) lands here — defensive default.
  return "severely_extended";
}

// Build the full ExtensionSummary the scanner attaches to the card and the
// UI renders in the hover / detail panel. Returns null when data insufficient.
export function summarizeExtension(
  price: number,
  sma20: number,
  atr14: number,
  setupFamily: SetupFamily
): ExtensionSummary | null {
  const tier = classifyExtensionTier(price, sma20, atr14);
  if (tier == null) return null;

  const atr_distance = (price - sma20) / atr14;
  const pct_distance = ((price - sma20) / sma20) * 100;
  const dollar_distance = price - sma20;
  const score_penalty = EXTENSION_TIERS[tier].penalty;

  const { headline, detail, next_action } = tierCopy(tier, setupFamily, {
    atr_distance,
    pct_distance,
    dollar_distance,
    sma20,
    price,
  });

  return {
    tier,
    atr_distance: round2(atr_distance),
    pct_distance: round2(pct_distance),
    dollar_distance: round2(dollar_distance),
    sma20: round2(sma20),
    atr14: round2(atr14),
    price: round2(price),
    score_penalty,
    headline,
    detail,
    next_action,
  };
}

// Copy tables keyed by (tier, setupFamily). Kept close to the classifier
// so wording changes stay one edit away.
function tierCopy(
  tier: ExtensionTier,
  fam: SetupFamily,
  m: { atr_distance: number; pct_distance: number; dollar_distance: number; sma20: number; price: number }
): { headline: string; detail: string; next_action: string } {
  const pct = m.pct_distance.toFixed(1);
  const atr = m.atr_distance.toFixed(2);

  if (tier === "normal") {
    return {
      headline: "Normal",
      detail: `Price is at or reasonably near the 20-SMA (+${pct}%, ${atr} ATR). No extension penalty.`,
      next_action: "Continue evaluating the setup on its own merits.",
    };
  }

  if (tier === "caution") {
    return {
      headline: "Caution — trend intact, entry risk rising",
      detail: `Price is moderately extended above the 20-SMA (+${pct}%, ${atr} ATR). Constructive trend, but entry risk is increasing.`,
      next_action: fam === "breakout"
        ? "Check pivot distance and volume; prefer entries close to the trigger."
        : fam === "pullback"
        ? "A shallow pullback toward the 20-SMA would tighten the stop."
        : "Tighten the entry to the closest technical level for a better stop.",
    };
  }

  if (tier === "extended") {
    if (fam === "pullback") {
      return {
        headline: "Extended — WAIT FOR PULLBACK",
        detail: `Price is meaningfully extended above the 20-SMA (+${pct}%, ${atr} ATR). A pullback setup requires a pullback that has not occurred.`,
        next_action: "Wait for consolidation, a pullback to the 20-SMA, or a new base.",
      };
    }
    if (fam === "breakout") {
      return {
        headline: "Extended — DO NOT CHASE",
        detail: `Price is +${pct}% (${atr} ATR) above the 20-SMA. Breakout may still be valid, but chasing here creates a poor stop location.`,
        next_action: "Only enter if the trigger is still close and R:R clears the existing minimum. Otherwise wait for a re-test of the breakout level.",
      };
    }
    if (fam === "bounce") {
      return {
        headline: "Extended — bounce already played",
        detail: `Price is far above the 20-SMA (+${pct}%, ${atr} ATR). A 20-SMA bounce requires interaction with the level, which has not occurred.`,
        next_action: "Wait for a pullback that actually tests the moving average or a nearby support.",
      };
    }
    // reclaim / continuation / unknown
    return {
      headline: "Extended — WATCH FOR CONSOLIDATION",
      detail: `Price is +${pct}% (${atr} ATR) above the 20-SMA. Trend remains bullish, but this is a poor location for a new entry.`,
      next_action: "Wait for consolidation or a pullback that creates a closer invalidation level.",
    };
  }

  // severely_extended
  return {
    headline: "SEVERELY EXTENDED — NEW ENTRY BLOCKED",
    detail: `Price is +${pct}% (${atr} ATR) above the 20-SMA. No nearby technical invalidation level offers acceptable risk for a new entry.`,
    next_action: "Ticker stays visible for monitoring. Wait for a controlled pullback, consolidation, or a new base before evaluating a new entry.",
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
