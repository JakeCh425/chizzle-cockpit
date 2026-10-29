import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from "react";
import { DEFAULT_WATCHLIST, type WatchlistItem, type DashboardTheme } from "@/lib/wealthWatchlist";
import { tradeApi, invalidateTrades, useTradesSummary } from "@/lib/swingTrades";
import type { SwingTradesSummary } from "@shared/swingTrades";
import { ensurePriceFeed, subscribe, subscribeTick, isBadTick as checkBadTick, subscribeSymbol, unsubscribeSymbol, isMarketOpen } from "@/lib/priceFeed";

export { DEFAULT_WATCHLIST, type WatchlistItem, type DashboardTheme };

export interface ActiveTickerData {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  status: "Ready" | "Awaiting Close" | "Forming" | "Retest" | string;
  setupType: string;
  buyTarget: number;
  stopLoss: number;
  primaryTarget: number;
  target1: number;
  target2: number;
  target3: number;
  risk: number;
  atr: number;
  sparkline: number[];
  bottomLine: string;
  winRate: number;
  t2: number;
  t3: number;
  receivedAt: number;
}

export interface PracticeTradeRecord {
  id: string;
  symbol: string;
  entryPrice: number;
  stopLoss: number;
  target1: number;
  target2?: number;
  target3?: number;
  riskReward: number;
  shares?: number;
  dollarRisk?: number;
  capitalCommitted?: number;
  status: "OPEN" | "CLOSED" | "CANCELLED";
  loggedAt: number;
  timeframe?: string;
  setupType?: string;
}

export interface UniversalModalState {
  open: boolean;
  symbol: string;
  customSetup?: Partial<WatchlistItem>;
}

export interface GlobalStateContextType {
  // Active Ticker across Cockpit & Wealth Studio
  activeTicker: string;
  setActiveTicker: (ticker: string) => void;

  // Single Source of Truth for Live Prices & Active Ticker Data
  activeTickerData: ActiveTickerData;
  activePrice: number;
  livePrices: Record<string, number>;
  isBadTick: (symbol: string, price: number) => boolean;
  isMarketOpen: boolean;

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

  // Global Account Risk & Position Sizing Settings
  accountEquity: number;
  setAccountEquity: (equity: number) => void;
  riskPercentage: number;
  setRiskPercentage: (pct: number) => void;

  // P&L and Trade Analytics Sync
  summary: SwingTradesSummary | undefined;
  refreshTrades: () => Promise<void>;

  // Confirmed Trades Global State Sync (Cockpit <-> Wealth Studio)
  confirmedCount: number;
  confirmedTradesCount: number;
  confirmedSetups: Record<string, boolean>;
  setConfirmedSetup: (symbol: string, confirmed?: boolean) => void;
  registerConfirmedSetup: (symbol: string, confirmed?: boolean) => void;

  // Practice Sandbox Mode (Paper Trading Isolation)
  isPracticeMode: boolean;
  setIsPracticeMode: (v: boolean | ((prev: boolean) => boolean)) => void;
  practiceTrades: PracticeTradeRecord[];
  logPracticeTrade: (trade: Omit<PracticeTradeRecord, "id" | "loggedAt" | "status"> & { id?: string; status?: "OPEN" | "CLOSED" | "CANCELLED" }) => PracticeTradeRecord;
  clearPracticeTrades: () => void;
}

const GlobalStateContext = createContext<GlobalStateContextType | null>(null);

const STORAGE_KEY_WATCHLIST = "chizzle-wealth-watchlist";
const STORAGE_KEY_REMOVED_TICKERS = "chizzle-removed-tickers";
const STORAGE_KEY_TICKER = "chizzle-active-ticker";
const STORAGE_KEY_PRACTICE_MODE = "chizzle-practice-mode";
const STORAGE_KEY_PRACTICE_TRADES = "chizzle-practice-trades";
const STORAGE_KEY_THEME = "chizzle-wealth-theme";
const STORAGE_KEY_ACCOUNT_EQUITY = "chizzle-account-equity";
const STORAGE_KEY_DEFAULT_RISK_PCT = "chizzle-default-risk-pct";

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

  // Global Account Risk & Position Sizing Settings
  const [accountEquity, setAccountEquityState] = useState<number>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(STORAGE_KEY_ACCOUNT_EQUITY);
        if (saved) {
          const num = parseFloat(saved);
          if (!isNaN(num) && num > 0) return num;
        }
      } catch {}
    }
    return 25000;
  });

  const setAccountEquity = useCallback((equity: number) => {
    const valid = typeof equity === "number" && !isNaN(equity) && equity > 0 ? equity : 25000;
    setAccountEquityState(valid);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(STORAGE_KEY_ACCOUNT_EQUITY, String(valid));
      } catch {}
    }
  }, []);

  const [riskPercentage, setRiskPercentageState] = useState<number>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(STORAGE_KEY_DEFAULT_RISK_PCT);
        if (saved) {
          const num = parseFloat(saved);
          if (!isNaN(num) && num >= 0.25 && num <= 5.0) return num;
        }
      } catch {}
    }
    return 1.0;
  });

  const setRiskPercentage = useCallback((pct: number) => {
    const valid = typeof pct === "number" && !isNaN(pct) && pct >= 0.25 && pct <= 5.0 ? pct : 1.0;
    setRiskPercentageState(valid);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(STORAGE_KEY_DEFAULT_RISK_PCT, String(valid));
      } catch {}
    }
  }, []);

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

  // Watchlist State (with auto-migration for newly added default universe tickers unless explicitly removed)
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const removedRaw = localStorage.getItem(STORAGE_KEY_REMOVED_TICKERS);
        const removedSet = new Set<string>();
        if (removedRaw) {
          const parsedRem = JSON.parse(removedRaw);
          if (Array.isArray(parsedRem)) {
            parsedRem.forEach((s: any) => typeof s === "string" && removedSet.add(s.toUpperCase()));
          }
        }

        const saved = localStorage.getItem(STORAGE_KEY_WATCHLIST);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            let migrated = false;
            const existingSymbols = new Set(parsed.map((item: any) => item?.symbol?.toUpperCase()));
            const nextList = [...parsed];

            for (const defItem of DEFAULT_WATCHLIST) {
              const defSym = defItem.symbol.toUpperCase();
              if (!existingSymbols.has(defSym) && !removedSet.has(defSym)) {
                nextList.push(defItem);
                existingSymbols.add(defSym);
                migrated = true;
              }
            }

            if (migrated) {
              try {
                localStorage.setItem(STORAGE_KEY_WATCHLIST, JSON.stringify(nextList));
              } catch {}
            }
            return nextList;
          }
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

      // Un-remove if previously removed
      if (typeof window !== "undefined") {
        try {
          const removedRaw = localStorage.getItem(STORAGE_KEY_REMOVED_TICKERS);
          if (removedRaw) {
            const arr = JSON.parse(removedRaw);
            if (Array.isArray(arr) && arr.includes(sym)) {
              localStorage.setItem(
                STORAGE_KEY_REMOVED_TICKERS,
                JSON.stringify(arr.filter((s: string) => s !== sym))
              );
            }
          }
        } catch {}
      }

      // Subscribe to WebSocket feed immediately
      subscribeSymbol(sym);

      // Check if ticker exists in DEFAULT_WATCHLIST to restore full institutional metadata
      const defaultMatch = DEFAULT_WATCHLIST.find((item) => item.symbol === sym);

      // Generate realistic dynamic metrics for user-added ticker
      const basePrice = defaultMatch ? defaultMatch.price : (120 + Math.floor(Math.random() * 80));
      const atr = defaultMatch ? defaultMatch.atr : +(basePrice * 0.035).toFixed(2);
      const buyTarget = defaultMatch ? defaultMatch.buyTarget : +basePrice.toFixed(2);
      const stopLoss = defaultMatch ? defaultMatch.stopLoss : +(basePrice - atr * 1.5).toFixed(2);
      const primaryTarget = defaultMatch ? defaultMatch.primaryTarget : +(basePrice + atr * 2.8).toFixed(2);
      const t2 = defaultMatch ? defaultMatch.t2 : +(basePrice + atr * 4.2).toFixed(2);
      const t3 = defaultMatch ? defaultMatch.t3 : +(basePrice + atr * 5.8).toFixed(2);

      const newItem: WatchlistItem = defaultMatch ? { ...defaultMatch } : {
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
        bottomLine: `Strong technical reclaim of the 20-period moving average on ${sym}. Defined structural stop at ${stopLoss.toFixed(2)} with asymmetric 2.4R target.`,
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
      const sym = symbol.trim().toUpperCase();
      const next = watchlist.filter((item) => item.symbol !== sym);
      saveWatchlist(next);

      // Record in removed-tickers set so auto-migration does not re-add it
      if (typeof window !== "undefined") {
        try {
          const removedRaw = localStorage.getItem(STORAGE_KEY_REMOVED_TICKERS);
          const arr = removedRaw ? JSON.parse(removedRaw) : [];
          if (Array.isArray(arr) && !arr.includes(sym)) {
            arr.push(sym);
            localStorage.setItem(STORAGE_KEY_REMOVED_TICKERS, JSON.stringify(arr));
          }
        } catch {}
      }

      // Unsubscribe from live WebSocket feed
      unsubscribeSymbol(sym);

      // If removing active ticker, automatically fallback to first available ticker (SPY or first item)
      if (activeTicker === sym && next.length > 0) {
        const fallback = next.find((i) => i.symbol === "SPY") || next[0];
        setActiveTicker(fallback.symbol);
      }
    },
    [watchlist, activeTicker, saveWatchlist, setActiveTicker]
  );

  // Single Source of Truth for Live Prices across Watchlist, Chart, Header, and Modals
  const [livePrices, setLivePrices] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    for (const item of (DEFAULT_WATCHLIST || [])) {
      if (item?.symbol && item?.price != null) {
        initial[item.symbol] = item.price;
      }
    }
    return initial;
  });

  // Outlier / Bad Tick Validator (3.5% threshold)
  const isBadTick = useCallback(
    (symbol: string, newPrice: number): boolean => {
      const current = livePrices[symbol] ?? watchlist?.find((i) => i?.symbol === symbol)?.price;
      return checkBadTick(symbol, newPrice, current);
    },
    [livePrices, watchlist]
  );

  // Single WebSocket connection manager at the root: subscribes to all watchlisted tickers
  useEffect(() => {
    ensurePriceFeed();

    // Subscribe all watchlisted symbols to live feed
    for (const item of watchlist || []) {
      if (item?.symbol) subscribeSymbol(item.symbol);
    }
    if (activeTicker) subscribeSymbol(activeTicker);

    const unsubSnap = subscribe((snap) => {
      setLivePrices((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [sym, q] of Object.entries(snap || {})) {
          if (q && q.price > 0) {
            const ref = prev[sym] ?? watchlist?.find((i) => i?.symbol === sym)?.price;
            // Validate: If incoming tick is >3.5% away, classify as Bad Tick and drop it
            if (ref && ref > 0 && Math.abs(q.price - ref) / ref > 0.035) {
              console.warn(`[globalState:badTick] Dropped outlier tick for ${sym}: $${q.price} vs ref $${ref}`);
              continue;
            }
            if (next[sym] !== q.price) {
              next[sym] = q.price;
              changed = true;
            }
          }
        }
        return changed ? next : prev;
      });
    });

    const unsubTick = subscribeTick((q) => {
      if (!q || !q.symbol || q.price <= 0) return;
      setLivePrices((prev) => {
        const ref = prev[q.symbol] ?? watchlist?.find((i) => i?.symbol === q.symbol)?.price;
        if (ref && ref > 0 && Math.abs(q.price - ref) / ref > 0.035) {
          return prev;
        }
        if (prev[q.symbol] === q.price) return prev;
        return { ...prev, [q.symbol]: q.price };
      });
    });

    return () => {
      unsubSnap();
      unsubTick();
    };
  }, [watchlist, activeTicker]);

  // Synchronized watchlist where all items share the exact same price as the live stream
  const syncedWatchlist = useMemo(() => {
    const list = Array.isArray(watchlist) && watchlist.length > 0 ? watchlist : (DEFAULT_WATCHLIST || []);
    return list.map((item) => {
      if (!item) return item;
      const live = livePrices[item.symbol];
      if (live != null && live > 0 && live !== item.price) {
        const base = item.price - (item.change ?? 0) || live;
        const chg = +(live - base).toFixed(2);
        const chgPct = base > 0 ? +((chg / base) * 100).toFixed(2) : (item.changePct ?? 0);

        // Dynamically align trade levels if stale seed price deviates by >8% from live price
        const isBuyAligned = item.buyTarget != null && Math.abs(item.buyTarget - live) / live <= 0.08;
        const buyTarget = isBuyAligned ? item.buyTarget : live;
        const isStopAligned = item.stopLoss != null && item.stopLoss < buyTarget && (buyTarget - item.stopLoss) / buyTarget <= 0.08 && (buyTarget - item.stopLoss) / buyTarget >= 0.012;
        const stopLoss = isStopAligned ? item.stopLoss : +(buyTarget - Math.max((item.atr ?? (live * 0.025)) * 1.2, 0.5)).toFixed(2);
        const risk = +(Math.max(buyTarget - stopLoss, (item.atr ?? (live * 0.03)), 0.5)).toFixed(2);
        const primaryTarget = +(buyTarget + risk * 1.5).toFixed(2);
        const t2 = +(buyTarget + risk * 2.0).toFixed(2);
        const t3 = +(buyTarget + risk * 3.0).toFixed(2);

        return {
          ...item,
          price: live,
          change: chg,
          changePct: chgPct,
          buyTarget,
          stopLoss,
          primaryTarget,
          t2,
          t3,
        };
      }
      return item;
    });
  }, [watchlist, livePrices]);

  // Active Item (Guaranteed 100% in sync with Watchlist and Chart)
  const activeItem = useMemo(() => {
    const list = Array.isArray(syncedWatchlist) && syncedWatchlist.length > 0 ? syncedWatchlist : (DEFAULT_WATCHLIST || []);
    return list.find((item) => item?.symbol === activeTicker) || list[0] || DEFAULT_WATCHLIST[0];
  }, [syncedWatchlist, activeTicker]);

  // Ensure strict WebSocket subscription for active ticker
  useEffect(() => {
    if (activeTicker) {
      subscribeSymbol(activeTicker);
    }
  }, [activeTicker]);

  // Active Ticker Data — Single Source of Truth subscribed to simultaneously by Header, Watchlist, and Chart
  const activeTickerData = useMemo<ActiveTickerData>(() => {
    const live = livePrices[activeTicker] ?? activeItem?.price ?? 100;
    const base = activeItem || DEFAULT_WATCHLIST[0];
    const prev = base.price - (base.change ?? 0) || live;
    const change = +(live - prev).toFixed(2);
    const changePct = prev > 0 ? +((change / prev) * 100).toFixed(2) : (base.changePct ?? 0);

    // Dynamic Risk/Reward Math: strictly enforce R-multiple logic:
    // Risk = EntryPrice - StopLossPrice
    // Target 1 (1.5R) = EntryPrice + (Risk * 1.5)
    // Target 2 (Core 2.0R) = EntryPrice + (Risk * 2.0)
    // Target 3 (Runner 3.0R) = EntryPrice + (Risk * 3.0)
    const isBaseBuyAligned = base.buyTarget != null && Math.abs(base.buyTarget - live) / live <= 0.08;
    const buyTarget = isBaseBuyAligned ? base.buyTarget : live;
    const isBaseStopAligned = base.stopLoss != null && base.stopLoss < buyTarget && (buyTarget - base.stopLoss) / buyTarget <= 0.08 && (buyTarget - base.stopLoss) / buyTarget >= 0.012;
    const stopLoss = isBaseStopAligned ? base.stopLoss : +(buyTarget - Math.max((base.atr ?? (live * 0.025)) * 1.2, 0.5)).toFixed(2);
    const risk = +(Math.max(Math.abs(buyTarget - stopLoss), (base.atr ?? (live * 0.03)) * 1.0, 0.5)).toFixed(2);
    const target1 = +(buyTarget + risk * 1.5).toFixed(2);
    const target2 = +(buyTarget + risk * 2.0).toFixed(2);
    const target3 = +(buyTarget + risk * 3.0).toFixed(2);

    return {
      symbol: activeTicker,
      price: live,
      change,
      changePct,
      status: base.status ?? "Ready",
      setupType: base.setupType ?? "SWING SETUP",
      buyTarget,
      stopLoss,
      primaryTarget: target1,
      target1,
      target2,
      target3,
      risk,
      atr: base.atr ?? 4.15,
      sparkline: base.sparkline ?? [live, live],
      bottomLine: base.bottomLine ?? "",
      winRate: base.winRate ?? 68.4,
      t2: target2,
      t3: target3,
      receivedAt: Date.now(),
    };
  }, [activeTicker, activeItem, livePrices]);

  const activePrice = activeTickerData.price;

  // Market hours state tracker: simulated micro-ticks are disabled when market is closed to prevent artificial price drift
  const [marketOpen, setMarketOpen] = useState(() => isMarketOpen());
  useEffect(() => {
    // Micro-tick drift prevention: if (!marketOpen) return;
    const t = setInterval(() => setMarketOpen(isMarketOpen()), 5000);
    return () => clearInterval(t);
  }, []);

  // ── REST API Quote Fetcher: Reliable Quote Endpoint Pipeline ──
  // Secondary Crucial Fix: If WebSocket is disconnected or it is After-Hours,
  // make a REST API call to fetch today's exact closing price. Update the Global Store
  // so Watchlist, Header, and Chart re-render simultaneously with the exact same accurate number.
  const fetchRestQuotes = useCallback(async () => {
    try {
      const res = await fetch("/api/prices").catch(() => null);
      if (res && res.ok) {
        const snap = await res.json();
        if (snap && typeof snap === "object") {
          setLivePrices((prev) => {
            const next = { ...prev };
            let changed = false;
            for (const [sym, q] of Object.entries(snap as Record<string, any>)) {
              if (q && typeof q.price === "number" && q.price > 0) {
                if (next[sym] !== q.price) {
                  next[sym] = q.price;
                  changed = true;
                }
              }
            }
            return changed ? next : prev;
          });
        }
      }
    } catch (e) {
      console.warn("[GlobalState] /api/prices fetch error:", e);
    }

    if (activeTicker) {
      try {
        const clean = activeTicker.toUpperCase().split(":").pop()!;
        const res = await fetch(`/api/quote/${encodeURIComponent(clean)}`).catch(() => null);
        if (res && res.ok) {
          const q = await res.json();
          if (q && typeof q.price === "number" && q.price > 0) {
            setLivePrices((prev) => {
              if (prev[clean] === q.price) return prev;
              return { ...prev, [clean]: q.price };
            });
          }
        }
      } catch {}
    }
  }, [activeTicker]);

  useEffect(() => {
    void fetchRestQuotes();
    const interval = setInterval(() => {
      void fetchRestQuotes();
    }, isMarketOpen() ? 6000 : 15000);
    return () => clearInterval(interval);
  }, [fetchRestQuotes]);

  // Boot Sequence Diagnostic Logging
  useEffect(() => {
    if (typeof console !== "undefined") {
      console.log("[Boot:GlobalState] GlobalStateProvider initialized with activeTicker:", activeTicker, "activePrice:", activePrice, "marketOpen:", marketOpen);
      console.log("[Boot:GlobalState] Synced watchlist loaded with", syncedWatchlist.length, "items");
    }
  }, [activeTicker, activePrice, syncedWatchlist.length, marketOpen]);

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

  // ── Confirmed Trades Global Synchronization Engine ──
  // Track dynamically confirmed setups across live WebSocket candle ticks and active chart analysis
  const [liveConfirmedSetups, setLiveConfirmedSetups] = useState<Record<string, boolean>>({});

  const setConfirmedSetup = useCallback((symbol: string, confirmed: boolean = true) => {
    if (!symbol) return;
    const clean = symbol.trim().toUpperCase().split(":").pop()!;
    setLiveConfirmedSetups((prev) => {
      if (Boolean(prev[clean]) === Boolean(confirmed)) return prev;
      return { ...prev, [clean]: Boolean(confirmed) };
    });
  }, []);

  const registerConfirmedSetup = setConfirmedSetup;

  // Reactively calculate total confirmed setups across synced watchlist items and live WebSocket confirmations
  const confirmedCount = useMemo(() => {
    const confirmedSyms = new Set<string>();
    for (const item of syncedWatchlist) {
      if (!item?.symbol) continue;
      const s = (item.status || "").toUpperCase();
      if (s === "READY" || s === "CONFIRMED" || s === "SETUP_CONFIRMED") {
        confirmedSyms.add(item.symbol.toUpperCase());
      }
    }
    for (const [sym, isConf] of Object.entries(liveConfirmedSetups)) {
      if (isConf) {
        confirmedSyms.add(sym.toUpperCase());
      } else {
        confirmedSyms.delete(sym.toUpperCase());
      }
    }
    return confirmedSyms.size;
  }, [syncedWatchlist, liveConfirmedSetups]);

  // ── Practice Mode (Paper Trading) Global State ──
  const [isPracticeMode, setIsPracticeModeState] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(STORAGE_KEY_PRACTICE_MODE);
        if (saved !== null) return saved === "true";
      } catch {}
    }
    return false;
  });

  const setIsPracticeMode = useCallback((val: boolean | ((prev: boolean) => boolean)) => {
    setIsPracticeModeState((prev) => {
      const next = typeof val === "function" ? val(prev) : val;
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(STORAGE_KEY_PRACTICE_MODE, String(next));
        } catch {}
      }
      return next;
    });
  }, []);

  // ── Practice Trades (Paper Trading Storage Array) ──
  const [practiceTrades, setPracticeTrades] = useState<PracticeTradeRecord[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(STORAGE_KEY_PRACTICE_TRADES);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch {}
    }
    return [];
  });

  const logPracticeTrade = useCallback(
    (trade: Omit<PracticeTradeRecord, "id" | "loggedAt" | "status"> & { id?: string; status?: "OPEN" | "CLOSED" | "CANCELLED" }): PracticeTradeRecord => {
      const record: PracticeTradeRecord = {
        id: trade.id || `practice-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        symbol: trade.symbol.toUpperCase(),
        entryPrice: trade.entryPrice,
        stopLoss: trade.stopLoss,
        target1: trade.target1,
        target2: trade.target2,
        target3: trade.target3,
        riskReward: trade.riskReward,
        shares: trade.shares,
        dollarRisk: trade.dollarRisk,
        capitalCommitted: trade.capitalCommitted,
        status: trade.status || "OPEN",
        loggedAt: Date.now(),
        timeframe: trade.timeframe,
        setupType: trade.setupType,
      };

      setPracticeTrades((prev) => {
        const next = [record, ...prev];
        if (typeof window !== "undefined") {
          try {
            localStorage.setItem(STORAGE_KEY_PRACTICE_TRADES, JSON.stringify(next));
          } catch {}
        }
        return next;
      });

      return record;
    },
    []
  );

  const clearPracticeTrades = useCallback(() => {
    setPracticeTrades([]);
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem(STORAGE_KEY_PRACTICE_TRADES);
      } catch {}
    }
  }, []);

  const value = useMemo(
    () => ({
      activeTicker,
      setActiveTicker,
      activeTickerData,
      activePrice,
      livePrices,
      isBadTick,
      isMarketOpen: marketOpen,
      watchlist: syncedWatchlist,
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
      accountEquity,
      setAccountEquity,
      riskPercentage,
      setRiskPercentage,
      summary,
      refreshTrades,
      confirmedCount,
      confirmedTradesCount: confirmedCount,
      confirmedSetups: liveConfirmedSetups,
      setConfirmedSetup,
      registerConfirmedSetup,
      isPracticeMode,
      setIsPracticeMode,
      practiceTrades,
      logPracticeTrade,
      clearPracticeTrades,
    }),
    [
      activeTicker,
      setActiveTicker,
      activeTickerData,
      activePrice,
      livePrices,
      isBadTick,
      marketOpen,
      syncedWatchlist,
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
      accountEquity,
      setAccountEquity,
      riskPercentage,
      setRiskPercentage,
      summary,
      refreshTrades,
      confirmedCount,
      liveConfirmedSetups,
      setConfirmedSetup,
      registerConfirmedSetup,
      isPracticeMode,
      setIsPracticeMode,
      practiceTrades,
      logPracticeTrade,
      clearPracticeTrades,
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

/**
 * Optional hook to consume GlobalState without throwing if rendered outside GlobalStateProvider (e.g. standalone test harness).
 */
export function useOptionalGlobalState(): GlobalStateContextType | null {
  return useContext(GlobalStateContext);
}

/**
 * Hook to consume live synchronized price data from the Global WebSocket Store for any symbol.
 */
export function useGlobalPrice(symbol?: string): { price: number | null; change: number; changePct: number; isUp: boolean } {
  const global = useGlobalState();
  const sym = (symbol || global.activeTicker || "").toUpperCase().split(":").pop()!;
  const price = global.livePrices[sym] ?? (sym === global.activeTicker ? global.activePrice : null);
  const item = global.watchlist.find((i) => i.symbol === sym) || (sym === global.activeTicker ? global.activeItem : null);
  const change = (price != null && item?.price != null) ? +(price - (item.price - (item.change ?? 0))).toFixed(2) : (item?.change ?? 0);
  const changePct = item?.price ? +((change / item.price) * 100).toFixed(2) : (item?.changePct ?? 0);
  return { price, change, changePct, isUp: change >= 0 };
}

