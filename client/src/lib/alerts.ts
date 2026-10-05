// Section R4 — practice price alerts (client). Informational only; never a broker order.
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { swingGet, swingSend } from "@/lib/swing";
import type { AlertPrefs, AlertType, Channel, PriceAlert } from "@shared/priceAlerts";
import type { SwingDecision } from "@shared/swingDecision";
import { effectivePlan, type EffectivePlan } from "@shared/practicePlan";
import type { ActionGroup } from "@shared/practicePlan";

export interface AlertEvent {
  id: number; alertId: number | null; symbol: string; type: AlertType | "READY_NOW"; firedAt: string; price: number | null; level: number | null;
  dataSource: string | null; dataStatus: string | null; condition: string; planVersion: number; message: string;
  delivery: Record<string, DeliveryState | string>; acknowledged: boolean; acknowledgedAt: string | null;
}
/** Per-channel delivery record (Ready events add attempts / kind / label / nextAt for Telegram). */
export interface DeliveryState { status: string; error?: string; label?: string; kind?: string; attempts?: number; attemptedAt?: string | null; nextAt?: string | null; httpStatus?: number | null }
export const deliveryEntries = (e: AlertEvent) => Object.entries(e.delivery ?? {}).filter((x): x is [string, DeliveryState] => !!x[1] && typeof x[1] === "object");
/** Open the EXISTING Action Center trading card for a symbol (no duplicate plan). */
export const openTradingCard = (symbol: string) => window.dispatchEvent(new CustomEvent("chizzle:open-card", { detail: { symbol } }));
export interface ContactStatus { id: number; channel: "email" | "telegram"; label: string; destination: string; verifiedAt: string | null }

export function useAlerts(enabled = true) {
  return useQuery<{ alerts: PriceAlert[] }>({ queryKey: ["/api/swing/alerts"], queryFn: () => swingGet("/api/swing/alerts"), enabled, refetchInterval: 60_000 });
}
export function useAlertEvents(enabled = true) {
  return useQuery<{ events: AlertEvent[] }>({ queryKey: ["/api/swing/alert-events"], queryFn: () => swingGet("/api/swing/alert-events?limit=40"), enabled, refetchInterval: 30_000 });
}
export function useAlertPrefs(enabled = true) {
  return useQuery<{ prefs: AlertPrefs; contacts: ContactStatus[] }>({ queryKey: ["/api/swing/alert-prefs"], queryFn: () => swingGet("/api/swing/alert-prefs"), enabled, staleTime: 30_000 });
}
export function invalidateAlerts() {
  for (const k of ["/api/swing/alerts", "/api/swing/alert-events", "/api/swing/alert-prefs"]) void queryClient.invalidateQueries({ queryKey: [k] });
}
export const alertApi = {
  create: (b: Record<string, unknown>) => swingSend<{ ok: true; alert: PriceAlert }>("POST", "/api/swing/alerts", b),
  setActive: (id: number, active: boolean) => swingSend("POST", `/api/swing/alerts/${id}/active`, { active }),
  remove: (id: number) => swingSend("DELETE", `/api/swing/alerts/${id}`),
  ack: (id: number) => swingSend("POST", `/api/swing/alert-events/${id}/ack`),
  savePrefs: (b: Partial<AlertPrefs>) => swingSend("PUT", "/api/swing/alert-prefs", b),
  sendCode: (id: number) => swingSend("POST", `/api/swing/alert-verify/${id}/send`),
  testTelegram: () => swingSend<{ ok: boolean; kind: string; label: string; httpStatus: number | null; error: string | null; chat: string | null }>("POST", "/api/swing/alerts/test-telegram"),
  confirmCode: (id: number, code: string) => swingSend("POST", `/api/swing/alert-verify/${id}/confirm`, { code }),
};

export interface AlertDraft { symbol: string; type: AlertType; level: number | null; levelHigh: number | null; context: string }
export const openAlertDialog = (d: AlertDraft) => window.dispatchEvent(new CustomEvent("chizzle:set-alert", { detail: d }));

/** Sensible first alert for each Action Center card type (user can change everything). */
export function defaultAlertFor(d: SwingDecision, group: ActionGroup, plan: EffectivePlan = effectivePlan(d, null)): AlertDraft {
  const trig = d.currentTrigger ?? d.originalTrigger;
  const base = { symbol: d.symbol, levelHigh: null as number | null, context: group };
  switch (group) {
    case "READY": return { ...base, type: plan.source === "USER" && plan.entry != null && d.currentPrice != null && plan.entry < d.currentPrice ? "PULLBACK_DOWN" : "ENTRY_CROSS_UP", level: plan.entry ?? trig };
    case "CONFIRMED": return { ...base, type: "CLOSE_1H_ABOVE", level: trig };
    case "FORMING": return { ...base, type: "SETUP_CONFIRMED_4H", level: null };
    case "RETEST": case "EXTENDED": return d.retestLevel ? { ...base, type: "RETEST_ZONE", level: d.retestLevel.low, levelHigh: d.retestLevel.high } : { ...base, type: "PULLBACK_DOWN", level: trig };
    case "RR_STOP": return { ...base, type: "PULLBACK_DOWN", level: plan.entry ?? trig };
    case "DATA": return { ...base, type: "DATA_RECOVERED", level: null };
    default: return { ...base, type: "ENTRY_CROSS_UP", level: trig };
  }
}

/** Active price-level alerts for a symbol → for chart bell markers. */
export function alertLevelsFor(alerts: PriceAlert[] | undefined, symbol: string): { price: number; type: AlertType }[] {
  const out: { price: number; type: AlertType }[] = [];
  for (const a of alerts ?? []) {
    if (!a.active || a.symbol !== symbol) continue;
    if (a.level != null) out.push({ price: a.level, type: a.type });
    if (a.levelHigh != null) out.push({ price: a.levelHigh, type: a.type });
  }
  return out;
}
export type { Channel };
