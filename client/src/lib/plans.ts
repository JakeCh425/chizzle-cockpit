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
export const focusSymbol = (symbol: string, target: "chart" | "why" = "chart") => goToSymbol(symbol, target);

// ─── Cockpit navigation (one path for every "go to" button) ─────────────────
// Any card / banner / alert action that leads elsewhere first closes the open trading card
// (a modal blocks the page behind it), expands the Unified Swing Engine section if it is
// folded, then focuses the symbol once the workspace is mounted. Nothing is duplicated.
let pendingFocus: { symbol: string; target: "chart" | "why" } | null = null;
/** Read (once) a focus request made before the workspace was mounted. */
export const takePendingFocus = () => { const p = pendingFocus; pendingFocus = null; return p; };
export const closeTradingCard = () => window.dispatchEvent(new CustomEvent("chizzle:close-card"));
const CARD_CLOSE_MS = 220; // let the dialog release focus + pointer lock first
export function goToSymbol(symbol: string, target: "chart" | "why" = "chart") {
  closeTradingCard();
  window.dispatchEvent(new CustomEvent("chizzle:expand-section", { detail: "unified-swing" }));
  pendingFocus = { symbol, target };
  setTimeout(() => window.dispatchEvent(new CustomEvent("chizzle:focus-symbol", { detail: target === "chart" ? symbol : { symbol, target } })), CARD_CLOSE_MS);
}
/** Run an action that opens its own dialog (alert, advanced editor) after the card closes. */
export function afterCardClose(fn: () => void) { closeTradingCard(); setTimeout(fn, CARD_CLOSE_MS); }
