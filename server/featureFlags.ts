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

/** All flags — snapshot for the /api/feature-flags endpoint. */
export function allFlags(): Record<string, boolean> {
  return {
    ENABLE_MTF_ENGINE_V2: isMtfV2Enabled(),
  };
}
