// ─── CockpitTickerContext ──────────────────────────────────────────────────
// Additive-only shared state for "what ticker is the Cockpit currently
// focused on?" It lets components across the Cockpit (Market Pulse, scanner
// cards, comparison charts, watchlist chips) push a ticker into the main
// TickerChartPanel without a full-page re-architecture. Components that
// don't use it are unaffected.
//
// The active ticker is persisted via usePersistentState so a page refresh
// keeps the user's focus. The list of "known" chips also lives here so
// external callers can offer a ticker to the chart panel even if it isn't
// currently a chip (the chart panel will pick it up on read).
//
// This is intentionally tiny: one context, one hook, no side effects.

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { usePersistentState } from "@/hooks/use-persistent-state";

export const DEFAULT_CHIPS = ["SMH", "SPY", "QQQ"];

export interface CockpitTickerCtx {
  chips: string[];
  active: string;
  select: (ticker: string) => void;
  add: (ticker: string) => void;
  remove: (ticker: string) => void;
  isDefault: (ticker: string) => boolean;
}

const Ctx = createContext<CockpitTickerCtx | null>(null);

export function CockpitTickerProvider({ children }: { children: ReactNode }) {
  const [chips, setChips] = usePersistentState<string[]>(
    "cockpit.tickerChart.chips",
    DEFAULT_CHIPS,
  );
  const [active, setActive] = usePersistentState<string>(
    "cockpit.tickerChart.active",
    "SMH",
  );

  const add = useCallback((t: string) => {
    const norm = t.trim().toUpperCase();
    if (!norm) return;
    setChips((prev) => (prev.includes(norm) ? prev : [...prev, norm]));
    setActive(norm);
  }, [setChips, setActive]);

  const select = useCallback((t: string) => {
    const norm = t.trim().toUpperCase();
    if (!norm) return;
    // If the caller pushes a ticker we don't yet have as a chip, add it.
    setChips((prev) => (prev.includes(norm) ? prev : [...prev, norm]));
    setActive(norm);
  }, [setChips, setActive]);

  const remove = useCallback((t: string) => {
    if (DEFAULT_CHIPS.includes(t)) return;
    setChips((prev) => prev.filter((c) => c !== t));
    setActive((cur) => {
      if (cur !== t) return cur;
      // Fall back to the first remaining chip (or SMH if we somehow emptied).
      // Read chips again via the callback so we don't race with setChips.
      return DEFAULT_CHIPS[0];
    });
  }, [setChips, setActive]);

  const isDefault = useCallback((t: string) => DEFAULT_CHIPS.includes(t), []);

  const value = useMemo<CockpitTickerCtx>(() => {
    // Guarantee active is one of the chips (defensive against stale storage).
    const safeActive = chips.includes(active) ? active : chips[0] || "SMH";
    return { chips, active: safeActive, select, add, remove, isDefault };
  }, [chips, active, select, add, remove, isDefault]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Use inside CockpitTickerProvider. Falls back to a read-only default
 * outside the provider so components that render in isolation don't crash.
 */
export function useCockpitTicker(): CockpitTickerCtx {
  const ctx = useContext(Ctx);
  if (ctx) return ctx;
  // Standalone fallback — components used outside the Cockpit still work.
  return {
    chips: DEFAULT_CHIPS,
    active: "SMH",
    select: () => {},
    add: () => {},
    remove: () => {},
    isDefault: (t) => DEFAULT_CHIPS.includes(t),
  };
}
