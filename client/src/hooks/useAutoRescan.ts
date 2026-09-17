// ─── useAutoRescan ────────────────────────────────────────────────────
// Market-hours-aware auto-refresh timer. Wakes up every N seconds, and if
// (a) we're inside NYSE regular-hours (09:30–16:00 ET Mon–Fri) and
// (b) at least `intervalMs` has elapsed since the last successful refetch,
// it fires the caller's `refetch()` callback.
//
// Deliberately no localStorage/sessionStorage (blocked in the deploy iframe).
// State lives in refs, so a fresh tab starts on the caller's initial data
// timestamp, which is fine — this is not durable, just live.

import { useEffect, useRef, useState } from "react";

// New York exchange hours in local ET wall-clock: 09:30 open, 16:00 close.
const NY_TZ = "America/New_York";

interface EtNow {
  hour: number;
  minute: number;
  day: number;   // 0 = Sun, 6 = Sat
  minutesSinceOpen: number; // negative before open, > 390 after close
}

function readEtNow(): EtNow {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NY_TZ,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  const dayStr = get("weekday");
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const day = dayMap[dayStr] ?? 0;
  const hour = parseInt(get("hour"), 10) || 0;
  const minute = parseInt(get("minute"), 10) || 0;
  const minutesSinceOpen = (hour * 60 + minute) - (9 * 60 + 30);
  return { hour, minute, day, minutesSinceOpen };
}

export function isMarketOpenEt(now: EtNow = readEtNow()): boolean {
  if (now.day === 0 || now.day === 6) return false;
  return now.minutesSinceOpen >= 0 && now.minutesSinceOpen <= 6 * 60 + 30; // 390 minutes = 6h30m
}

export interface AutoRescanState {
  enabled: boolean;
  setEnabled: (b: boolean) => void;
  intervalMs: number;
  setIntervalMs: (n: number) => void;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  marketOpen: boolean;
}

/**
 * Hook that refetches `refetch` on a cadence during market hours.
 *
 * @param refetch  callback fired when it's time to rescan (react-query refetch)
 * @param defaultIntervalMs  starting cadence (default 5min)
 * @param defaultEnabled  starts on/off (default on)
 */
export function useAutoRescan(
  refetch: () => void,
  defaultIntervalMs: number = 5 * 60_000,
  defaultEnabled: boolean = true,
): AutoRescanState {
  const [enabled, setEnabled] = useState(defaultEnabled);
  const [intervalMs, setIntervalMs] = useState(defaultIntervalMs);
  const [lastRunAt, setLastRunAt] = useState<Date | null>(null);
  const [marketOpen, setMarketOpen] = useState(() => isMarketOpenEt());
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  useEffect(() => {
    if (!enabled) return;
    // Tick every 20s so the pill's "next scan" clock stays live even outside
    // market hours; actual refetch only fires when the interval has elapsed.
    const id = setInterval(() => {
      const nowEt = readEtNow();
      const open = isMarketOpenEt(nowEt);
      setMarketOpen(open);
      if (!open) return;
      const lastMs = lastRunAt ? lastRunAt.getTime() : 0;
      if (Date.now() - lastMs >= intervalMs) {
        refetchRef.current();
        setLastRunAt(new Date());
      }
    }, 20_000);
    return () => clearInterval(id);
  }, [enabled, intervalMs, lastRunAt]);

  const nextRunAt = lastRunAt && marketOpen
    ? new Date(lastRunAt.getTime() + intervalMs)
    : null;

  return { enabled, setEnabled, intervalMs, setIntervalMs, lastRunAt, nextRunAt, marketOpen };
}
