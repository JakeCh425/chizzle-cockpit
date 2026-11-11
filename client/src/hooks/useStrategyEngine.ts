import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useMarketDataStore } from "@/lib/useMarketDataStore";
import { useOptionalGlobalState } from "@/lib/globalState";
import { tradeSetupStore } from "@/lib/useTradeSetupStore";
import { evaluateExecutionGating } from "@/lib/executionGating";

export interface MechanicalScanItem {
  ticker: string;
  status: string;
  actionable: boolean;
  price: number;
  regime4H: "Bullish" | "Bearish";
  is4hBullish: boolean;
  testedLine: "10_SMA" | "20_SMA" | "50_SMA" | null;
  testedPrice: number | null;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit2R: number | null;
  riskPerShare: number | null;
  sma10_1h: number;
  sma20_1h: number;
  sma50_1h: number;
  atr14_1h: number;
  subtext: string;
  updatedAt: string;
}

export interface ConfirmedHeroTrade {
  symbol: string;
  ticker: string;
  currentPrice: number;
  entryPrice: number;
  stopLoss: number;
  riskPerShare: number;
  target1: number; // 1.5R - 50% scale
  target2: number; // 2.0R core
  testedLine: string | null;
  status: string;
  isTradeConfirmed: boolean;
  shares: number;
  t1Shares: number;
  t2Shares: number;
  timestamp: number;
}

export function useStrategyEngine() {
  const marketStore = useMarketDataStore();
  const global = useOptionalGlobalState();
  const [dismissedSymbols, setDismissedSymbols] = useState<Set<string>>(new Set());

  const { data, isLoading, refetch } = useQuery<{
    ok: boolean;
    results: MechanicalScanItem[];
  }>({
    queryKey: ["/api/swing/mechanical-scan"],
    queryFn: async () => {
      const res = await fetch("/api/swing/mechanical-scan");
      if (!res.ok) throw new Error("Failed to fetch mechanical SMA scan");
      return res.json();
    },
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const results = data?.results ?? [];

  // Monitor when any ticker transitions to isTradeConfirmed === true
  const confirmedHeroTrades = useMemo(() => {
    const list: ConfirmedHeroTrade[] = [];

    for (const item of results) {
      const sym = item.ticker.toUpperCase();
      if (dismissedSymbols.has(sym)) continue;

      // Centralized 3-Rule Execution Gating:
      // 1. NO hard regime blocks (Regime is not RED, not STANDBY DAY)
      // 2. Price is actively bouncing off SMA 10, SMA 20, or SMA 50
      // 3. 1H confirmation candle has closed green
      const gating = evaluateExecutionGating({
        symbol: sym,
        regimeCode: (global as any)?.regimeCode ?? "yellow",
        isStandbyDay: item.status.includes("STANDBY_DAY"),
        mechanicalStatus: item.status,
        regime4H: item.regime4H,
        is4hBullish: item.is4hBullish,
        testedLine: item.testedLine,
        testedPrice: item.testedPrice,
        candleConfirmedGreen: item.status === "CONFIRMED BOUNCE" || item.status === "CONFIRMED_BOUNCE",
        setupStatus: item.status,
      });

      if (!gating.isReady) continue;

      const isBounceConfirmed =
        item.status === "CONFIRMED BOUNCE" ||
        item.status === "CONFIRMED_BOUNCE" ||
        Boolean(global?.confirmedSetups?.[sym]);

      const isTradeConfirmed = Boolean(
        isBounceConfirmed ||
        (item.is4hBullish && item.actionable && item.testedPrice != null)
      );

      if (!isTradeConfirmed) continue;

      const livePrice =
        marketStore.prices[sym] ??
        global?.livePrices?.[sym] ??
        (sym === marketStore.activeTicker && marketStore.currentPrice != null ? marketStore.currentPrice : null) ??
        item.price;

      const entryPrice = item.entryPrice && item.entryPrice > 0 ? item.entryPrice : livePrice;
      const rawRisk = item.riskPerShare && item.riskPerShare > 0
        ? item.riskPerShare
        : item.atr14_1h && item.atr14_1h > 0
        ? item.atr14_1h
        : Math.max(0.5, entryPrice * 0.015);

      const stopLoss = item.stopLoss && item.stopLoss > 0
        ? item.stopLoss
        : +(entryPrice - rawRisk).toFixed(2);

      const riskPerShare = Math.max(0.01, +(entryPrice - stopLoss).toFixed(2));
      const target1 = +(entryPrice + 1.5 * riskPerShare).toFixed(2);
      const target2 = item.takeProfit2R && item.takeProfit2R > 0
        ? item.takeProfit2R
        : +(entryPrice + 2.0 * riskPerShare).toFixed(2);

      const standardRiskBudget = 250;
      const shares = Math.max(1, Math.floor(standardRiskBudget / riskPerShare));
      const t1Shares = Math.max(1, Math.floor(shares * 0.5));
      const t2Shares = Math.max(1, shares - t1Shares);

      list.push({
        symbol: sym,
        ticker: sym,
        currentPrice: livePrice,
        entryPrice,
        stopLoss,
        riskPerShare,
        target1,
        target2,
        testedLine: item.testedLine,
        status: "CONFIRMED BOUNCE",
        isTradeConfirmed: true,
        shares,
        t1Shares,
        t2Shares,
        timestamp: Date.now(),
      });
    }

    return list;
  }, [results, marketStore.prices, marketStore.currentPrice, marketStore.activeTicker, global?.livePrices, global?.confirmedSetups, dismissedSymbols]);

  // Synchronize confirmed trades into centralized tradeSetupStore
  useEffect(() => {
    for (const trade of confirmedHeroTrades) {
      tradeSetupStore.addActiveExecutionSetup(trade);
    }
  }, [confirmedHeroTrades]);

  const dismissHeroTrade = useCallback((symbol: string) => {
    const sym = symbol.toUpperCase();
    tradeSetupStore.dismissHeroTrade(sym);
    setDismissedSymbols((prev) => {
      const next = new Set(prev);
      next.add(sym);
      return next;
    });
  }, []);

  const resetDismissed = useCallback(() => {
    setDismissedSymbols(new Set());
  }, []);

  return {
    results,
    confirmedHeroTrades,
    isLoading,
    refetch,
    dismissHeroTrade,
    resetDismissed,
  };
}
