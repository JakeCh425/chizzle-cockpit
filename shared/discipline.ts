// ─── Shared Discipline Helper ───────────────────────────────────────────────
// Single source of truth for the discipline pipeline thresholds and decisions.
// Mirrors regime_gate_spec.md. Used by BOTH backend (routes / setupService /
// regimeService) and frontend (Watchlist / Cockpit / Trades).
//
// Per spec:
//   GREEN  × A/B/C = visible, full risk (1.0x)
//   YELLOW × A     = visible, half risk (0.5x), DIMMED in UI
//   YELLOW × B/C   = HIDDEN, zero risk (0.0x)
//   RED    × any   = HIDDEN, zero risk (0.0x)
//
// Quality grade is set per the Setup Quality Classification block in the spec.
// Until the classifier is wired (Batch 2), every detected setup is graded "B"
// as a conservative default — so YELLOW dims everything, RED hides everything.

export type RegimeCode = "green" | "yellow" | "red";
export type SetupKind = "trend_pullback" | "breakout";
export type Quality = "A" | "B" | "C";
export type Visibility = "visible" | "dimmed" | "hidden";

export interface DisciplineDecision {
  visibility: Visibility;
  riskMultiplier: number;       // 0.0, 0.5, or 1.0
  blockedReason: string | null;
  dimReason: string | null;
}

/**
 * Decide visibility + risk multiplier for a single setup, given the current
 * effective regime and the setup's quality grade.
 *
 * @param regime  effective regime ("green" | "yellow" | "red")
 * @param quality A / B / C / null. Null = treat as B (default until classifier wired).
 */
export function decideDiscipline(
  regime: RegimeCode,
  quality: Quality | null,
): DisciplineDecision {
  const g = (quality || "B") as Quality;

  // RED: hide everything, no new risk allowed.
  if (regime === "red") {
    return {
      visibility: "hidden",
      riskMultiplier: 0.0,
      blockedReason: "RED regime — capital protection mode, no new entries.",
      dimReason: null,
    };
  }

  // YELLOW: A-grade only at half size; B/C hidden.
  if (regime === "yellow") {
    if (g === "A") {
      return {
        visibility: "dimmed",
        riskMultiplier: 0.5,
        blockedReason: null,
        dimReason: "YELLOW regime — A-grade only at half size.",
      };
    }
    return {
      visibility: "hidden",
      riskMultiplier: 0.0,
      blockedReason: `YELLOW regime — ${g}-grade setups suppressed.`,
      dimReason: null,
    };
  }

  // GREEN: all visible, full size.
  return {
    visibility: "visible",
    riskMultiplier: 1.0,
    blockedReason: null,
    dimReason: null,
  };
}

/**
 * Alert type constants used by Batch 1 Alert Engine.
 * EARNINGS_WINDOW_BYPASS deferred to Batch 2 (needs earnings data feed).
 */
export const ALERT_TYPES = {
  APPROACHING_ZONE: "APPROACHING_ZONE",
  IN_ZONE: "IN_ZONE",
  INVALIDATED: "INVALIDATED",
  REGIME_SHIFT_BYPASS: "REGIME_SHIFT_BYPASS",
  EARNINGS_WINDOW_BYPASS: "EARNINGS_WINDOW_BYPASS",
} as const;

export type AlertType = (typeof ALERT_TYPES)[keyof typeof ALERT_TYPES];

/**
 * Convert internal setup state → alert type.
 * Returns null for states that do not emit an alert (dormant / building / armed / live).
 */
export function alertTypeForSetupState(state: string): AlertType | null {
  const s = state.toLowerCase();
  if (s === "approaching") return ALERT_TYPES.APPROACHING_ZONE;
  if (s === "in_zone") return ALERT_TYPES.IN_ZONE;
  if (s === "invalidated") return ALERT_TYPES.INVALIDATED;
  return null;
}

/**
 * Default quality grade when the classifier hasn't been wired yet.
 * Returns "B" — conservative middle of the road.
 * Batch 2 will replace this with real classification on each setup row.
 */
export function defaultQualityFallback(): Quality {
  return "B";
}
