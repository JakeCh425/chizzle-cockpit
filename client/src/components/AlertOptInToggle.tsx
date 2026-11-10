import React from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Bell, BellOff } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { WatchlistItem, Ticker } from "@shared/schema";

export interface AlertOptInToggleProps {
  symbol: string;
  className?: string;
  size?: "sm" | "md";
}

/**
 * Institutional-grade Alert Opt-In toggle control.
 * Controls 1H candle confirmed push notifications per ticker for Telegram/Email.
 * - Enabled: text-signal-green with neon glow drop shadow
 * - Disabled: text-slate-gray with muted 50% opacity
 */
export function AlertOptInToggle({ symbol, className = "", size = "sm" }: AlertOptInToggleProps) {
  const sym = (symbol || "").trim().toUpperCase();

  const { data: watchlist } = useQuery<WatchlistItem[]>({
    queryKey: ["/api/watchlist"],
  });
  const { data: tickers } = useQuery<Ticker[]>({
    queryKey: ["/api/tickers"],
  });

  const alertsEnabled = React.useMemo(() => {
    if (!sym) return false;
    const ticker = (tickers || []).find((t) => t.symbol?.toUpperCase() === sym);
    if (!ticker) return false;
    const item = (watchlist || []).find((w) => w.tickerId === ticker.id);
    return Boolean(item?.alertsEnabled);
  }, [watchlist, tickers, sym]);

  const toggleMutation = useMutation({
    mutationFn: async (nextVal: boolean) => {
      const res = await apiRequest("PUT", `/api/watchlist/${sym}/alert-toggle`, {
        enabled: nextVal,
      });
      return res.json();
    },
    onMutate: async (nextVal: boolean) => {
      await queryClient.cancelQueries({ queryKey: ["/api/watchlist"] });
      const previousWatchlist = queryClient.getQueryData<WatchlistItem[]>(["/api/watchlist"]);

      if (previousWatchlist && tickers) {
        const ticker = tickers.find((t) => t.symbol?.toUpperCase() === sym);
        if (ticker) {
          queryClient.setQueryData<WatchlistItem[]>(
            ["/api/watchlist"],
            previousWatchlist.map((item) =>
              item.tickerId === ticker.id ? { ...item, alertsEnabled: nextVal } : item
            )
          );
        }
      }
      return { previousWatchlist };
    },
    onError: (_err, _nextVal, context) => {
      if (context?.previousWatchlist) {
        queryClient.setQueryData(["/api/watchlist"], context.previousWatchlist);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
    },
  });

  const isPending = toggleMutation.isPending;
  const iconSizeClass = size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4";

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        toggleMutation.mutate(!alertsEnabled);
      }}
      disabled={isPending}
      className={`inline-flex items-center justify-center p-1 rounded transition-all duration-150 cursor-pointer focus:outline-none ${
        alertsEnabled
          ? "text-signal-green drop-shadow-[0_0_5px_rgba(52,211,153,0.5)] hover:text-emerald-300"
          : "text-slate-gray opacity-50 hover:opacity-100 hover:text-slate-300"
      } ${className}`}
      title={
        alertsEnabled
          ? `Alerts Armed: 1H Confirmed notifications active for $${sym}`
          : `Alerts Muted: Click to arm 1H Confirmed alerts for $${sym}`
      }
      aria-label={
        alertsEnabled
          ? `Alerts Armed: 1H Confirmed notifications active for ${sym}`
          : `Alerts Muted: Click to arm alerts for ${sym}`
      }
      data-testid={`button-alert-opt-in-${sym}`}
      data-alerts-enabled={alertsEnabled ? "true" : "false"}
    >
      {alertsEnabled ? (
        <Bell className={`${iconSizeClass} fill-signal-green/20 text-signal-green drop-shadow-[0_0_5px_rgba(52,211,153,0.5)]`} />
      ) : (
        <BellOff className={`${iconSizeClass} text-slate-gray`} />
      )}
    </button>
  );
}

export default AlertOptInToggle;
