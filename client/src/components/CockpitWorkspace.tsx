// CockpitWorkspace — 3-column layout wrapping the TradingView chart.
//
// LEFT   23–25% : Regime v2 (compact) + Market Pulse (compact)
// CENTER 50–54% : TradingViewChart (the star)
// RIGHT  23–25% : Ticker Strength gauge + Technical Snapshot + AI Trade Coach
//
// On <lg screens, everything stacks. The user's persisted collapse pref for
// Active Setups stays in ActiveSetupsPanel (unchanged) — the workspace only
// hosts the three visual columns.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useCockpitTicker } from "@/components/CockpitTickerContext";
import RegimeV2Panel from "@/components/RegimeV2Panel";
import MarketPulsePanel from "@/components/MarketPulsePanel";
import TickerStrengthGauge from "@/components/TickerStrengthGauge";
import { TechnicalSnapshot } from "@/components/TickerChartPanel";
import AITradeCoach from "@/components/AITradeCoach";
import TradingViewChart from "@/components/TradingViewChart";
import TradePlanWorkspace from "@/components/TradePlanWorkspace";

interface OHLCBar { date: string; open: number; high: number; low: number; close: number; volume: number }

export default function CockpitWorkspace() {
  const { active } = useCockpitTicker();
  const ticker = active || "SPY";

  const { data: bars, isLoading } = useQuery<OHLCBar[]>({
    queryKey: ["/api/candles-ohlc", ticker, "1D"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/candles-ohlc/${ticker}?interval=1D`);
      const json = await res.json();
      return Array.isArray(json) ? json : json?.bars || [];
    },
    staleTime: 60_000,
  });

  const { data: regime } = useQuery<any>({
    queryKey: ["/api/regime-v2"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/regime-v2");
      return await res.json();
    },
    staleTime: 60_000,
  });

  return (
    <div
      className="grid grid-cols-1 lg:grid-cols-[minmax(0,23%)_minmax(0,1fr)_minmax(0,23%)] gap-3 xl:gap-4 items-start"
      data-testid="cockpit-workspace"
    >
      {/* LEFT COLUMN — Regime + full Market Pulse (fills column height) */}
      <div className="space-y-3 min-w-0" data-testid="workspace-left">
        <RegimeV2Panel compact />
        <MarketPulsePanel />
      </div>

      {/* CENTER COLUMN — chart + Trade Plan Workspace stacked so the
           middle column matches the right column's height with real content
           instead of dead black space. */}
      <div className="min-w-0 space-y-3 xl:space-y-4" data-testid="workspace-center">
        <TradingViewChart
          ticker={ticker}
          bars={bars}
          isLoading={isLoading}
          regime={regime?.day_class}
          height={420}
        />
        <TradePlanWorkspace />
      </div>

      {/* RIGHT COLUMN */}
      <div className="space-y-3 min-w-0" data-testid="workspace-right">
        <TickerStrengthGauge ticker={ticker} bars={bars} />
        <TechnicalSnapshot ticker={ticker} bars={bars} />
        <AITradeCoach ticker={ticker} bars={bars} />
      </div>
    </div>
  );
}
