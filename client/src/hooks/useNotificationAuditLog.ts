import { useQuery } from "@tanstack/react-query";

export interface ClientNotificationAuditEntry {
  id: string;
  symbol: string;
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
}

/**
 * Syncs with the backend 24/7 Notification Engine Audit Log (/api/alerts/audit-log)
 * so Setup Cards can display the `[ 🔔 Alert Sent ]` timestamp badge and Notification Log.
 */
export function useNotificationAuditLog(symbol?: string) {
  const query = useQuery<NotificationAuditLogResponse>({
    queryKey: ["/api/alerts/audit-log"],
    queryFn: async () => {
      const res = await fetch("/api/alerts/audit-log");
      if (!res.ok) {
        return { ok: true, alerts: [], bySymbol: {} };
      }
      return res.json();
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const alerts = query.data?.alerts ?? [];
  const bySymbol = query.data?.bySymbol ?? {};
  const cleanSym = symbol ? symbol.trim().toUpperCase() : "";
  const latestForSymbol = cleanSym ? bySymbol[cleanSym] ?? null : null;

  const getAlertForSymbol = (sym: string): ClientNotificationAuditEntry | null => {
    if (!sym) return null;
    return bySymbol[sym.trim().toUpperCase()] ?? null;
  };

  return {
    alerts,
    bySymbol,
    latestForSymbol,
    isAlertSent: Boolean(latestForSymbol),
    badgeText: latestForSymbol?.badgeText ?? "[ 🔔 Alert Sent ]",
    formattedTime: latestForSymbol?.formattedTime ?? null,
    getAlertForSymbol,
    refetch: query.refetch,
  };
}

