// ─── useShares — shares-to-buy context shared by trade-card surfaces ────────
// Pulls account equity, current regime, and the user's risk-% map from the
// same endpoints Cockpit.tsx already uses, so the Bull Bar Monitor, SMH Hammer
// Monitor, and FullChartModal alert banner can all compute position size
// without duplicating wiring.
//
// Formula (per user spec):
//   shares = (account equity × dynamic risk %) / risk_per_share
// where the dynamic risk % maps to the day-color regime (GREEN/YELLOW/RED)
// and is overridable in Settings.

import { useQuery } from "@tanstack/react-query";
import { Regime, RISK_PCT, positionSize, riskDollars, riskPctFromSettings } from "./engine";

interface SettingsLike {
  equity?: number | null;
  riskPctGreen?: number | null;
  riskPctYellow?: number | null;
  riskPctRed?: number | null;
}

interface RegimePayloadLike {
  effective?: { code?: "green" | "yellow" | "red" } | null;
}

export interface SharesContext {
  equity: number;
  regime: Regime;
  riskMap: Record<Regime, number>;
  riskPct: number; // fraction (e.g. 0.05)
  riskDollarsValue: number; // equity × riskPct
}

export function useSharesContext(): SharesContext {
  const { data: settings } = useQuery<SettingsLike>({ queryKey: ["/api/settings"] });
  const { data: regimePayload } = useQuery<RegimePayloadLike>({ queryKey: ["/api/regime"] });

  const code = (regimePayload?.effective?.code ?? "yellow").toUpperCase() as Regime;
  const regime: Regime = code === "GREEN" || code === "RED" ? code : "YELLOW";
  const equity = Number.isFinite(settings?.equity as number) ? (settings!.equity as number) : 0;
  const riskMap = riskPctFromSettings(settings ?? null);
  const riskPct = riskMap[regime] ?? RISK_PCT[regime];
  const riskDollarsValue = riskDollars(equity, regime, riskMap);

  return { equity, regime, riskMap, riskPct, riskDollarsValue };
}

// Convenience: compute share count for a given per-share risk under the
// current shares context. Returns 0 when inputs are missing/invalid.
export function sharesForPlan(ctx: SharesContext, riskPerShare: number | null | undefined): number {
  if (!riskPerShare || !Number.isFinite(riskPerShare) || riskPerShare <= 0) return 0;
  if (!ctx.equity || ctx.equity <= 0) return 0;
  return positionSize(ctx.riskDollarsValue, riskPerShare);
}
