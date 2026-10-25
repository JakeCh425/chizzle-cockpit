import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from "react";
import { DEFAULT_WATCHLIST, type WatchlistItem, type DashboardTheme } from "@/pages/WealthEngineDashboard";
import { tradeApi, invalidateTrades, useTradesSummary } from "@/lib/swingTrades";
import type { SwingTradesSummary } from "@shared/swingTrades";

export interface UniversalModalState {
  open: boolean;
  symbol: string;
  customSetup?: Partial<WatchlistItem>;
}

export interface GlobalStateContextType {
  // Active Ticker across Cockpit & Wealth Studio
  activeTicker: string;
  setActiveTicker: (ticker: string) => void;

  // Watchlist
  watchlist: WatchlistItem[];
  addTicker: (symbol: string) => { ok: boolean; message?: string };
  removeTicker: (symbol: string) => void;
  activeItem: WatchlistItem;

  // Working Timeframe
  timeframe: "1H" | "4H" | "1D" | "1W";
  setTimeframe: (tf: "1H" | "4H" | "1D" | "1W") => void;

  // Universal Arm Trade Modal
  universalModal: UniversalModalState;
  openArmTrade: (symbol?: string, customSetup?: Partial<WatchlistItem>) => void;
  closeArmTrade: () => void;

  // Advanced Theming
  theme: DashboardTheme;
  setTheme: (t: DashboardTheme) => void;
  cycleTheme: () => void;

  // P&L and Trade Analytics Sync
  summary: SwingTradesSummary | undefined;
  refreshTrades: () => Promise<void>;
}

const GlobalStateContext = createContext<GlobalStateContextType | null>(null);

const STORAGE_KEY_WATCHLIST = "chizzle-wealth-watchlist";
const STORAGE_KEY_TICKER = "chizzle-active-ticker";
const STORAGE_KEY_THEME = "chizzle-wealth-theme";

const THEME_ORDER: DashboardTheme[] = ["cyber-neon", "stealth", "arctic", "sunset-orange", "neon-grape", "mint-matrix"];

export function GlobalStateProvider({ children }: { children: React.ReactNode }) {
  // Theme State
  const [theme, setThemeState] = useState<DashboardTheme>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(STORAGE_KEY_THEME) as DashboardTheme;
      if (saved && THEME_ORDER.includes(saved)) return saved;
      const attr = document.documentElement.getAttribute("data-theme") as DashboardTheme;
      if (attr && THEME_ORDER.includes(attr)) return attr;
    }
    return "cyber-neon";
  });

  const setTheme = useCallback((t: DashboardTheme) => {
    setThemeState(t);
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", t);
      if (t === "arctic") {
        document.documentElement.classList.remove("dark");
      } else {
        document.documentElement.classList.add("dark");
      }
      try {
        localStorage.setItem(STORAGE_KEY_THEME, t);
        localStorage.setItem("chizzle-theme", t);
      } catch {}
    }
  }, []);

  const cycleTheme = useCallback(() => {
    const idx = THEME_ORDER.indexOf(theme);
    const next = THEME_ORDER[(idx + 1) % THEME_ORDER.length];
    setTheme(next);
  }, [theme, setTheme]);

  useEffect(() => {
    setTheme(theme);
  }, [theme, setTheme]);

  // Active Ticker
  const [activeTicker, setActiveTickerState] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(STORAGE_KEY_TICKER);
      if (saved) return saved.toUpperCase();
    }
    return "NVDA";
  });

  const setActiveTicker = useCallback((ticker: string) => {
    const sym = ticker.trim().toUpperCase();
    setActiveTickerState(sym);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(STORAGE_KEY_TICKER, sym);
      } catch {}
    }
  }, []);

  // Watchlist State
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(STORAGE_KEY_WATCHLIST);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch {}
    }
    return DEFAULT_WATCHLIST;
  });

  const saveWatchlist = useCallback((items: WatchlistItem[]) => {
    setWatchlist(items);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(STORAGE_KEY_WATCHLIST, JSON.stringify(items));
      } catch {}
    }
  }, []);

  // Quick-Add Ticker
  const addTicker = useCallback(
    (symbol: string): { ok: boolean; message?: string } => {
      const sym = symbol.trim().toUpperCase();
      if (!sym) return { ok: false, message: "Ticker symbol cannot be empty" };
      if (!/^[A-Z0-9.\-]{1,6}$/.test(sym)) {
        return { ok: false, message: "Invalid ticker format" };
      }

      const existing = watchlist.find((item) => item.symbol === sym);
      if (existing) {
        setActiveTicker(sym);
        return { ok: true, message: `${sym} is already on watchlist` };
      }

      // Generate realistic dynamic metrics for user-added ticker
      const basePrice = 120 + Math.floor(Math.random() * 80);
      const atr = +(basePrice * 0.035).toFixed(2);
      const buyTarget = +basePrice.toFixed(2);
      const stopLoss = +(basePrice - atr * 1.5).toFixed(2);
      const primaryTarget = +(basePrice + atr * 2.8).toFixed(2);
      const t2 = +(basePrice + atr * 4.2).toFixed(2);
      const t3 = +(basePrice + atr * 5.8).toFixed(2);

      const newItem: WatchlistItem = {
        symbol: sym,
        name: `${sym} Custom Asset`,
        price: basePrice,
        change: +(Math.random() * 4 - 1.5).toFixed(2),
        changePct: +(Math.random() * 3 - 0.8).toFixed(2),
        sparkline: [
          basePrice - atr * 1.2,
          basePrice - atr * 0.8,
          basePrice - atr * 1.0,
          basePrice - atr * 0.4,
          basePrice - atr * 0.2,
          basePrice - atr * 0.5,
          basePrice - atr * 0.1,
          basePrice,
        ].map((v) => +v.toFixed(2)),
        status: "Ready",
        setupType: "20-SMA RECLAIM · 1H",
        buyTarget,
        stopLoss,
        primaryTarget,
        bottomLine: `Strong technical reclaim of the 20-period moving average on ${sym}. Defined structural stop at $${stopLoss.toFixed(2)} with asymmetric 2.4R target.`,
        winRate: 67.5,
        atr,
        t2,
        t3,
      };

      const next = [newItem, ...watchlist];
      saveWatchlist(next);
      setActiveTicker(sym);
      return { ok: true, message: `Added ${sym} to Watchlist` };
    },
    [watchlist, saveWatchlist, setActiveTicker]
  );

  const removeTicker = useCallback(
    (symbol: string) => {
      const next = watchlist.filter((item) => item.symbol !== symbol.toUpperCase());
      saveWatchlist(next);
      if (activeTicker === symbol.toUpperCase() && next.length > 0) {
        setActiveTicker(next[0].symbol);
      }
    },
    [watchlist, activeTicker, saveWatchlist, setActiveTicker]
  );

  // Active Item
  const activeItem = useMemo(() => {
    return watchlist.find((item) => item.symbol === activeTicker) || watchlist[0] || DEFAULT_WATCHLIST[0];
  }, [watchlist, activeTicker]);

  // Timeframe
  const [timeframe, setTimeframe] = useState<"1H" | "4H" | "1D" | "1W">("1H");

  // Universal Modal
  const [universalModal, setUniversalModal] = useState<UniversalModalState>({
    open: false,
    symbol: "NVDA",
  });

  const openArmTrade = useCallback(
    (symbol?: string, customSetup?: Partial<WatchlistItem>) => {
      const sym = symbol ? symbol.toUpperCase() : activeTicker;
      setUniversalModal({
        open: true,
        symbol: sym,
        customSetup,
      });
    },
    [activeTicker]
  );

  const closeArmTrade = useCallback(() => {
    setUniversalModal((prev) => ({ ...prev, open: false }));
  }, []);

  // Trades Summary from practice engine
  const tradesSummaryQ = useTradesSummary();
  const summary = tradesSummaryQ.data;

  const refreshTrades = useCallback(async () => {
    await invalidateTrades();
  }, []);

  const value = useMemo(
    () => ({
      activeTicker,
      setActiveTicker,
      watchlist,
      addTicker,
      removeTicker,
      activeItem,
      timeframe,
      setTimeframe,
      universalModal,
      openArmTrade,
      closeArmTrade,
      theme,
      setTheme,
      cycleTheme,
      summary,
      refreshTrades,
    }),
    [
      activeTicker,
      setActiveTicker,
      watchlist,
      addTicker,
      removeTicker,
      activeItem,
      timeframe,
      setTimeframe,
      universalModal,
      openArmTrade,
      closeArmTrade,
      theme,
      setTheme,
      cycleTheme,
      summary,
      refreshTrades,
    ]
  );

  return <GlobalStateContext.Provider value={value}>{children}</GlobalStateContext.Provider>;
}

export function useGlobalState(): GlobalStateContextType {
  const ctx = useContext(GlobalStateContext);
  if (!ctx) {
    throw new Error("useGlobalState must be used within a GlobalStateProvider");
  }
  return ctx;
}

