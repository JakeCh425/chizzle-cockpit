import { useEffect, useRef, useSyncExternalStore } from "react";
import { queryClient } from "@/lib/queryClient";
import { reconnectPriceFeed, forceRefreshPrice } from "@/lib/priceFeed";
import { toast } from "@/hooks/use-toast";
import { RefreshCw } from "lucide-react";

// Module singleton for wake syncing indicator state
let isWakeSyncing = false;
const wakeSyncListeners = new Set<(s: boolean) => void>();

function setWakeSyncing(val: boolean) {
  isWakeSyncing = val;
  wakeSyncListeners.forEach((l) => l(isWakeSyncing));
}

export function subscribeWakeSync(listener: (s: boolean) => void) {
  wakeSyncListeners.add(listener);
  return () => {
    wakeSyncListeners.delete(listener);
  };
}

export function getWakeSyncState() {
  return isWakeSyncing;
}

/**
 * Global 'Hard Refresh' function triggered on wake-from-sleep or inactive tab resume:
 *
 * 1. Closes any dead WebSocket connections and instantly reconnects them.
 * 2. Re-fetches the latest candlestick data via REST API for active charts to fill missing time gaps.
 * 3. Re-fetches current market price quote to update top ticker and setup cards.
 * 4. Briefly shows a 'Syncing Data...' or 'Reconnecting...' toast and glowing UI loader.
 */
export async function triggerGlobalHardRefresh(options?: { silent?: boolean }): Promise<void> {
  setWakeSyncing(true);

  if (!options?.silent) {
    toast({
      title: "Syncing Data...",
      description: "Reconnecting live stream and refreshing market data.",
      duration: 3000,
    });
  }

  try {
    // 1. Close dead WebSocket connections & instantly reconnect
    reconnectPriceFeed();

    // 2. Re-fetch current market price quote via REST API
    void forceRefreshPrice().catch(() => {});

    // 3. Re-fetch latest candlestick data via REST API for active charts to fill time gaps
    await Promise.allSettled([
      queryClient.invalidateQueries({
        predicate: (q) => {
          const key = String(q.queryKey[0] || "");
          return (
            key.startsWith("/api/swing/bars") ||
            key.startsWith("/api/candles") ||
            key.startsWith("/api/prices") ||
            key.startsWith("/api/tickers") ||
            key.startsWith("/api/swing/decisions") ||
            key.startsWith("/api/regime")
          );
        },
      }),
      queryClient.refetchQueries({
        predicate: (q) => {
          const key = String(q.queryKey[0] || "");
          return (
            key.startsWith("/api/swing/bars") ||
            key.startsWith("/api/candles") ||
            key.startsWith("/api/prices") ||
            key.startsWith("/api/tickers")
          );
        },
      }),
    ]);
  } catch (err) {
    console.warn("[wakeRefresh] Error during hard refresh:", err);
  } finally {
    // Hold indicator for a brief moment (1200ms) so the user perceives the sync catching up
    setTimeout(() => {
      setWakeSyncing(false);
    }, 1200);
  }
}

/**
 * Root-level hook implementing the browser's Page Visibility API:
 * document.addEventListener('visibilitychange', ...)
 *
 * On Wake Logic: When document.visibilityState === 'visible' (user woke up laptop
 * or switched back to the tab), triggers the global 'Hard Refresh' function.
 */
export function useWakeRefresh() {
  const lastWakeRef = useRef<number>(Date.now());

  useEffect(() => {
    if (typeof document === "undefined") return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        const now = Date.now();
        // Cooldown: prevent multiple rapid calls if user tabs back and forth in <2s
        if (now - lastWakeRef.current < 2000) return;
        lastWakeRef.current = now;
        void triggerGlobalHardRefresh();
      }
    };

    const handleOnline = () => {
      const now = Date.now();
      if (now - lastWakeRef.current < 2000) return;
      lastWakeRef.current = now;
      void triggerGlobalHardRefresh();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
    };
  }, []);
}

/**
 * Visual glowing UI loader shown briefly while the app is catching up.
 */
export function WakeSyncLoader() {
  const isSyncing = useSyncExternalStore(subscribeWakeSync, getWakeSyncState);

  if (!isSyncing) return null;

  return (
    <div
      data-testid="wake-sync-loader"
      className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-cyan-400/40 bg-[#070d18]/95 px-3 py-1 font-mono text-xs text-cyan-300 shadow-2xl backdrop-blur-md animate-pulse pointer-events-none select-none"
    >
      <RefreshCw className="h-3 w-3 animate-spin text-cyan-400" />
      <span className="font-semibold tracking-wider uppercase text-[10px]">Syncing Data…</span>
    </div>
  );
}
