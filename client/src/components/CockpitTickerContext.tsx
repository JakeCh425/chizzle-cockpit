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

// Seed defaults. These are the *initial* Core Three the user can edit;
// they are NOT hard-coded pins anymore. Kept exported because a few
// places still ask “was this a factory default?” for cosmetic reasons.
export const DEFAULT_CHIPS = ["SMH", "SPY", "QQQ"];
export const CORE_MAX = 3;

export interface CockpitTickerCtx {
  chips: string[];
  /** User-editable Core set (initial value = DEFAULT_CHIPS, capped at CORE_MAX). */
  coreChips: string[];
  active: string;
  select: (ticker: string) => void;
  add: (ticker: string) => void;
  remove: (ticker: string) => void;
  isDefault: (ticker: string) => boolean;
  isCore: (ticker: string) => boolean;
  /** Promote a watch ticker into Core. If Core is full, `bumpTicker` is
   *  demoted to Watch (still in the chips list) to keep the cap at 3. */
  promoteToCore: (ticker: string, bumpTicker?: string) => void;
  /** Demote a Core ticker to Watch (stays in chips, just no longer pinned). */
  demoteFromCore: (ticker: string) => void;
}

const Ctx = createContext<CockpitTickerCtx | null>(null);

export function CockpitTickerProvider({ children }: { children: ReactNode }) {
  const [chips, setChips] = usePersistentState<string[]>(
    "cockpit.tickerChart.chips",
    DEFAULT_CHIPS,
  );
  // Editable Core set. Persisted separately so removing SMH from Core
  // doesn't lose the fact that the user's chips list is otherwise custom.
  const [coreChips, setCoreChips] = usePersistentState<string[]>(
    "cockpit.tickerChart.coreChips",
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

  // remove() now nukes a ticker entirely (from both chips and, defensively,
  // Core). Watch rows expose this as the ×. Core rows use demoteFromCore
  // instead so nothing gets lost.
  const remove = useCallback((t: string) => {
    const norm = t.trim().toUpperCase();
    setChips((prev) => prev.filter((c) => c !== norm));
    setCoreChips((prev) => prev.filter((c) => c !== norm));
    setActive((cur) => (cur === norm ? (coreChips[0] || chips[0] || DEFAULT_CHIPS[0]) : cur));
  }, [setChips, setCoreChips, setActive, coreChips, chips]);

  const isDefault = useCallback((t: string) => DEFAULT_CHIPS.includes(t), []);
  const isCore = useCallback((t: string) => coreChips.includes(t), [coreChips]);

  const promoteToCore = useCallback((t: string, bumpTicker?: string) => {
    const norm = t.trim().toUpperCase();
    if (!norm) return;
    // Make sure it's in the overall chips list (it usually already is).
    setChips((prev) => (prev.includes(norm) ? prev : [...prev, norm]));
    setCoreChips((prev) => {
      if (prev.includes(norm)) return prev;
      // If Core is at cap, drop the bump target (caller's choice) or the
      // last one added. Demoted ticker stays in chips — just no longer Core.
      let next = prev.slice();
      if (next.length >= CORE_MAX) {
        const bump = bumpTicker && next.includes(bumpTicker) ? bumpTicker : next[next.length - 1];
        next = next.filter((c) => c !== bump);
      }
      next.push(norm);
      return next;
    });
  }, [setChips, setCoreChips]);

  const demoteFromCore = useCallback((t: string) => {
    const norm = t.trim().toUpperCase();
    // Ticker itself stays in the chips list — just not pinned as Core.
    setCoreChips((prev) => prev.filter((c) => c !== norm));
  }, [setCoreChips]);

  const value = useMemo<CockpitTickerCtx>(() => {
    // Guarantee active is one of the chips (defensive against stale storage).
    const safeActive = chips.includes(active) ? active : chips[0] || "SMH";
    return { chips, coreChips, active: safeActive, select, add, remove, isDefault, isCore, promoteToCore, demoteFromCore };
  }, [chips, coreChips, active, select, add, remove, isDefault, isCore, promoteToCore, demoteFromCore]);

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
    coreChips: DEFAULT_CHIPS,
    active: "SMH",
    select: () => {},
    add: () => {},
    remove: () => {},
    isDefault: (t) => DEFAULT_CHIPS.includes(t),
    isCore: (t) => DEFAULT_CHIPS.includes(t),
    promoteToCore: () => {},
    demoteFromCore: () => {},
  };
}
