// Part 4 — practice trades client API. PRACTICE ONLY: these calls record a plan and its outcome; none of them
// reaches a broker. One query key family so the card, header and My Trades always read the same rows.
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { swingGet, swingSend, useSwingEnabled } from "@/lib/swing";
import type { ArmTradeInput, PatchTradeInput, SwingTrade, SwingTradeEvent, SwingTradesSummary } from "@shared/swingTrades";
import type { SwingDecision } from "@shared/swingDecision";
import type { EffectivePlan } from "@shared/practicePlan";
import { JOURNAL_KEY } from "@/lib/journal";

export const TRADES_KEY = ["/api/swing/trades"] as const;
export const PRACTICE_TRADES_STORAGE_KEY = "chizzle_practice_trades";

export function loadLocalPracticeTrades(): SwingTrade[] {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(PRACTICE_TRADES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalPracticeTrades(trades: SwingTrade[]): void {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PRACTICE_TRADES_STORAGE_KEY, JSON.stringify(trades));
  } catch {}
}

export async function invalidateTrades() {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: [...TRADES_KEY] }),
    queryClient.invalidateQueries({ queryKey: [...JOURNAL_KEY] }),
    queryClient.invalidateQueries({ queryKey: ["/api/analytics/trades"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/risk/open-positions"] }),
  ]);
}

export function useSwingTrades(enabledOverride?: boolean) {
  const on = useSwingEnabled();
  const localInitial = loadLocalPracticeTrades();
  return useQuery<{ trades: SwingTrade[]; banner: string; note: string }>({
    queryKey: [...TRADES_KEY],
    queryFn: async () => {
      try {
        const res = await swingGet<{ trades: SwingTrade[]; banner: string; note: string }>("/api/swing/trades");
        if (res && Array.isArray(res.trades)) {
          saveLocalPracticeTrades(res.trades);
        }
        return res;
      } catch {
        // Silent graceful fallback to localStorage so UI never blocks on 8000ms timeout
        return {
          trades: loadLocalPracticeTrades(),
          banner: "PRACTICE ONLY — LOCAL-FIRST SYNC",
          note: "Loaded from localStorage cache",
        };
      }
    },
    initialData: {
      trades: localInitial,
      banner: "PRACTICE ONLY — LOCAL-FIRST SYNC",
      note: "Instant localStorage hydration",
    },
    initialDataUpdatedAt: 0,
    enabled: enabledOverride ?? on,
    staleTime: 15_000,
    refetchInterval: 60_000,
    retry: false,
  });
}
export function useTradesSummary() {
  const on = useSwingEnabled();
  return useQuery<SwingTradesSummary>({
    queryKey: [...TRADES_KEY, "summary"],
    queryFn: async () => {
      try {
        return await swingGet<SwingTradesSummary>("/api/swing/trades/summary");
      } catch {
        const local = loadLocalPracticeTrades();
        const armed = local.filter((t) => t.status === "ARMED").length;
        const active = local.filter((t) => t.status === "ACTIVE").length;
        const openRiskDollars = local
          .filter((t) => t.status === "ARMED" || t.status === "ACTIVE")
          .reduce((sum, t) => sum + Number(t.riskDollars || 0), 0);
        return {
          armed,
          active,
          closed: local.filter((t) => t.status === "CLOSED").length,
          openRiskDollars,
          dailyPnl: 0,
          weeklyPnl: 0,
        } as unknown as SwingTradesSummary;
      }
    },
    enabled: on,
    staleTime: 15_000,
    refetchInterval: 60_000,
    retry: false,
  });
}
export function useTradeEvents(id: number | null) {
  return useQuery<{ events: SwingTradeEvent[] }>({ queryKey: [...TRADES_KEY, id, "events"], queryFn: () => swingGet(`/api/swing/trades/${id}/events`), enabled: id != null });
}
/** The open (ARMED/ACTIVE) practice trade for a symbol, if any — the card uses this to lock/label itself. */
export function openTradeFor(trades: SwingTrade[] | undefined, symbol: string): SwingTrade | null {
  return trades?.find((t) => t.symbol === symbol.toUpperCase() && (t.status === "ARMED" || t.status === "ACTIVE")) ?? null;
}

export const tradeApi = {
  arm: async (body: ArmTradeInput) => { const r = await swingSend<{ ok: true; trade: SwingTrade }>("POST", "/api/swing/trades", body); await invalidateTrades(); return r.trade; },
  edit: async (id: number, body: PatchTradeInput) => { const r = await swingSend<{ ok: true; trade: SwingTrade }>("PATCH", `/api/swing/trades/${id}`, body); await invalidateTrades(); return r.trade; },
  fill: async (id: number, body: { fillPrice: number; note?: string }) => { const r = await swingSend<{ ok: true; trade: SwingTrade }>("POST", `/api/swing/trades/${id}/fill`, body); await invalidateTrades(); return r.trade; },
  close: async (id: number, body: { exitPrice: number; exitReason: "STOP" | "T1" | "T2" | "MANUAL"; note?: string }) => { const r = await swingSend<{ ok: true; trade: SwingTrade }>("POST", `/api/swing/trades/${id}/close`, body); await invalidateTrades(); return r.trade; },
  cancel: async (id: number, body: { note?: string } = {}) => { const r = await swingSend<{ ok: true; trade: SwingTrade }>("POST", `/api/swing/trades/${id}/cancel`, body); await invalidateTrades(); return r.trade; },
};

/** What the Arm dialog needs from a card. `plan` = the levels the user sees (engine plan or My Adjusted Plan). */
export interface ArmRequest { mode: "arm"; decision: SwingDecision; plan: EffectivePlan; liveAllowed: boolean | null; overrideRequired: boolean }
export interface EditRequest { mode: "edit"; trade: SwingTrade; decision?: SwingDecision | null }
export type TradeDialogRequest = ArmRequest | EditRequest;
export const openTradeDialog = (r: TradeDialogRequest) => window.dispatchEvent(new CustomEvent("chizzle:trade-dialog", { detail: r }));
export const TRADE_DIALOG_EVENT = "chizzle:trade-dialog";
