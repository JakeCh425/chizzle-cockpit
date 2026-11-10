import { useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { globalStore, useMarketDataStore, type SetupAlertState } from "@/lib/useMarketDataStore";
import { tradeSetupStore } from "@/lib/useTradeSetupStore";

export interface ClientNotificationAuditEntry {
  id: string;
  symbol: string;
  alertSent?: boolean;
  lastAlertTimestamp?: number;
  alertType: string;
  setupType: string;
  entryPrice: number;
  stopLoss: number;
  target1: number;
  calculatedShares: number;
  channels: Array<"telegram" | "email" | "sms">;
  status: "SENT" | "STUBBED" | "FAILED";
  firedAt: number;
  isoTimestamp: string;
  formattedTime: string;
  badgeText: string;
  message: string;
}

export interface NotificationAuditLogResponse {
  ok: boolean;
  alerts: ClientNotificationAuditEntry[];
  bySymbol: Record<string, ClientNotificationAuditEntry>;
  setupStates?: Record<string, SetupAlertState>;
}

/**
 * Syncs with the backend 24/7 Notification Engine Audit Log (/api/alerts/audit-log)
 * so Setup Cards can display the `[ 🔔 Alert Sent ]` timestamp badge and Notification Log,
 * and propagates `alertSent: true` into the Global Store (`globalStore.updateSetup`).
 */
export function useNotificationAuditLog(symbol?: string) {
  const queryClient = useQueryClient();
  const setupAlerts = useMarketDataStore((s) => s.setupAlerts);

  const query = useQuery<NotificationAuditLogResponse>({
    queryKey: ["/api/alerts/audit-log"],
    queryFn: async () => {
      const res = await fetch("/api/alerts/audit-log");
      if (!res.ok) {
        return { ok: true, alerts: [], bySymbol: {}, setupStates: {} };
      }
      return res.json();
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const alerts = query.data?.alerts ?? [];
  const bySymbol = query.data?.bySymbol ?? {};
  const backendSetupStates = query.data?.setupStates ?? {};
  const cleanSym = symbol ? symbol.trim().toUpperCase() : "";

  // Synchronize backend alertSent states into the frontend Global Store and Trade Setup Store
  useEffect(() => {
    if (Object.keys(bySymbol).length > 0) {
      tradeSetupStore.syncFromBackendAuditLog(bySymbol);
    }
    for (const [sym, entry] of Object.entries(bySymbol)) {
      if (entry && (entry.status === "SENT" || entry.status === "STUBBED" || entry.alertSent)) {
        const current = globalStore.getSetupAlertState(sym);
        if (!current.alertSent) {
          globalStore.updateSetup(sym, {
            alertSent: true,
            lastAlertTimestamp: entry.lastAlertTimestamp ?? entry.firedAt ?? Date.now(),
          });
        }
      }
    }
    for (const [sym, st] of Object.entries(backendSetupStates)) {
      if (st?.alertSent) {
        const current = globalStore.getSetupAlertState(sym);
        if (!current.alertSent) {
          globalStore.updateSetup(sym, {
            alertSent: true,
            lastAlertTimestamp: st.lastAlertTimestamp ?? Date.now(),
          });
        }
      }
    }
  }, [bySymbol, backendSetupStates]);

  const latestForSymbol = cleanSym ? bySymbol[cleanSym] ?? null : null;
  const storeSetupState = cleanSym ? setupAlerts[cleanSym] ?? null : null;
  const isAlertSent = Boolean(storeSetupState?.alertSent || latestForSymbol);

  const getAlertForSymbol = (sym: string): ClientNotificationAuditEntry | null => {
    if (!sym) return null;
    return bySymbol[sym.trim().toUpperCase()] ?? null;
  };

  const isSymbolAlertSent = (sym: string): boolean => {
    if (!sym) return false;
    const clean = sym.trim().toUpperCase();
    return Boolean(setupAlerts[clean]?.alertSent || bySymbol[clean]);
  };

  const markAlertSent = useCallback(
    (targetSymbol: string, timestamp: number = Date.now()) => {
      const clean = targetSymbol.trim().toUpperCase();
      globalStore.updateSetup(clean, {
        alertSent: true,
        lastAlertTimestamp: timestamp,
      });
      void queryClient.invalidateQueries({ queryKey: ["/api/alerts/audit-log"] });
    },
    [queryClient]
  );

  return {
    alerts,
    bySymbol,
    latestForSymbol,
    isAlertSent,
    alertSent: isAlertSent,
    lastAlertTimestamp:
      storeSetupState?.lastAlertTimestamp ?? latestForSymbol?.lastAlertTimestamp ?? latestForSymbol?.firedAt ?? null,
    badgeText: latestForSymbol?.badgeText ?? "[ 🔔 Alert Sent ]",
    formattedTime: latestForSymbol?.formattedTime ?? null,
    getAlertForSymbol,
    isSymbolAlertSent,
    markAlertSent,
    refetch: query.refetch,
  };
}

