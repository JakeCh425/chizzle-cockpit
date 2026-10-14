// Central feature flag helpers. Additive — new flags default OFF so existing
// behavior stays the same until the env var is set.
//
// Usage:
//   import { isMtfV2Enabled } from "./featureFlags";
//   if (isMtfV2Enabled()) { ... }
//
// Values are read fresh on every call so Render env changes take effect on
// the next request without a rebuild.

function envFlag(name: string): boolean {
  const v = (process.env[name] || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** MTF Signal Engine v2 — Wealth Engine spec (setups, modes, toggles). */
export function isMtfV2Enabled(): boolean {
  return envFlag("ENABLE_MTF_ENGINE_V2");
}

/** PR 3 — Unified Swing Decision Engine. One SwingDecision per symbol is the
 *  only authority for trade state when ON. OFF = exact PR1/PR2 behavior. */
export function isUnifiedSwingEnabled(): boolean {
  return envFlag("ENABLE_UNIFIED_SWING_ENGINE");
}

/** Setup Score — the Swing Setup Board's 0–100 score on cockpit cards + Priority Board. Information only;
 *  never changes Ready or levels. Requires the unified engine. */
export function isSetupScoreEnabled(): boolean {
  return envFlag("ENABLE_SETUP_SCORE") && isUnifiedSwingEnabled();
}

/** Chart Ecosystem Part 1 — Shared Market Context endpoint (/api/swing/context). Default ON; set
 *  ENABLE_MARKET_CONTEXT=false to turn it off (panels then fall back to their existing sources). */
export function isMarketContextEnabled(): boolean {
  const v = (process.env.ENABLE_MARKET_CONTEXT || "").trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "no" || v === "off");
}

/** Chart Ecosystem Part 3 — user chart drawings (chart_drawings table). Default ON; ENABLE_CHART_DRAWINGS=false
 *  turns the endpoints off (the chart then hides its drawing toolbar). Not listed in allFlags (regression endpoint). */
export function isChartDrawingsEnabled(): boolean {
  const v = (process.env.ENABLE_CHART_DRAWINGS || "").trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "no" || v === "off");
}

/** All flags — snapshot for the /api/feature-flags endpoint. */
export function allFlags(): Record<string, boolean> {
  return {
    ENABLE_MTF_ENGINE_V2: isMtfV2Enabled(),
    ENABLE_UNIFIED_SWING_ENGINE: isUnifiedSwingEnabled(),
  };
}
