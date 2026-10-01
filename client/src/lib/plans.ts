// Section R — one selected plan version per symbol, shared by the chart, Action Center,
// trade card, scanner and (next PR) alerts. Version 0 = the system plan.
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { swingGet, swingSend } from "@/lib/swing";
import type { PlanVersion } from "@shared/practicePlan";

export interface SelectedResp { selected: Record<string, PlanVersion> }

export function useSelectedPlans(enabled = true) {
  return useQuery<SelectedResp>({
    queryKey: ["/api/swing/plans-selected"],
    queryFn: () => swingGet<SelectedResp>("/api/swing/plans-selected"),
    enabled, staleTime: 60_000,
  });
}

export { activeVersion, staleVersion, effectivePlan, type EffectivePlan } from "@shared/practicePlan";

export function invalidatePlans(symbol?: string) {
  void queryClient.invalidateQueries({ queryKey: ["/api/swing/plans-selected"] });
  void queryClient.invalidateQueries({ queryKey: ["/api/swing/plans", ...(symbol ? [symbol] : [])] });
}
export async function selectPlanVersion(symbol: string, version: number) {
  await swingSend("POST", `/api/swing/plans/${encodeURIComponent(symbol)}/select`, { version });
  invalidatePlans(symbol);
}

export const openPlanEditor = (symbol: string) => window.dispatchEvent(new CustomEvent("chizzle:edit-plan", { detail: symbol }));
export const focusSymbol = (symbol: string, target: "chart" | "why" = "chart") =>
  window.dispatchEvent(new CustomEvent("chizzle:focus-symbol", { detail: target === "chart" ? symbol : { symbol, target } }));
