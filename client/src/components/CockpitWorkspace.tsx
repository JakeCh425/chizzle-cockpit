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
import MultiTimeframeContext from "@/components/MultiTimeframeContext";
import { useEffect, useMemo, useState } from "react";
import { TIMEFRAMES, readSavedTimeframe, writeSavedTimeframe, maybeAggregate, type Timeframe } from "@/lib/timeframes";
import TradePlanWorkspace from "@/components/TradePlanWorkspace";
import MTFSignalsPanel from "@/components/MTFSignalsPanel";

interface OHLCBar { date: string; open: number; high: number; low: number; close: number; volume: number }

export default function CockpitWorkspace() {
  const { active } = useCockpitTicker();
  const ticker = active || "SPY";

  // Chart timeframe is Cockpit-level state so the chart, technical
  // snapshot, strength gauge, and AI coach all recalc from the same
  // series when it changes. Sticky per ticker via localStorage — no
  // schema change. Defaults to 1D on first load / new ticker.
  const [timeframe, setTimeframeState] = useState<Timeframe>(() => readSavedTimeframe(ticker, "1D"));
  // Re-read when ticker changes (each ticker keeps its own last TF).
  useEffect(() => { setTimeframeState(readSavedTimeframe(ticker, "1D")); }, [ticker]);
  const setTimeframe = (tf: Timeframe) => {
    setTimeframeState(tf);
    writeSavedTimeframe(ticker, tf);
  };

  // For 1W/1M we fetch the 1D endpoint and aggregate on the client. The
  // queryKey uses apiValue so the 1D cache is shared between all consumers.
  const tfApi = TIMEFRAMES[timeframe].apiValue;

  // Race protection is handled by TanStack Query: the ticker+timeframe
  // pair is part of the queryKey, so a stale response for the previous
  // combo can't overwrite the current one.
  // Fetch with ?meta=1 so we can surface source/warning banners in the chart.
  // The endpoint still returns bars in both shapes (array or {bars, warning}).
  const { data: barsResp, isLoading } = useQuery<{ bars: OHLCBar[]; warning?: string; source?: string }>({
    queryKey: ["/api/candles-ohlc", ticker, tfApi],
    queryFn: async ({ signal }) => {
      const res = await apiRequest("GET", `/api/candles-ohlc/${ticker}?interval=${tfApi}&meta=1`, undefined, signal);
      const json = await res.json();
      if (Array.isArray(json)) return { bars: json };
      return { bars: json?.bars || [], warning: json?.warning, source: json?.source };
    },
    staleTime: 60_000,
    // Keep previous bars visible while a new TF loads — no full-panel blank.
    placeholderData: (prev) => prev,
  });
  const rawBars = barsResp?.bars;
  const barsWarning = barsResp?.warning;

  // Client-side aggregation for 1W / 1M (no-op for other timeframes).
  // Memoised so aggregation only runs when the underlying series or TF flips.
  const bars = useMemo(() => maybeAggregate(rawBars, timeframe), [rawBars, timeframe]);

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
          barsWarning={barsWarning}
          regime={regime?.day_class}
          height={420}
          timeframe={timeframe}
          onTimeframeChange={setTimeframe}
          mtfStrip={<MultiTimeframeContext ticker={ticker} activeTf={timeframe} />}
        />
        <TradePlanWorkspace />
        <MTFSignalsPanel />
      </div>

      {/* RIGHT COLUMN */}
      <div className="space-y-3 min-w-0" data-testid="workspace-right">
        <TickerStrengthGauge ticker={ticker} bars={bars} timeframe={timeframe} />
        <TechnicalSnapshot ticker={ticker} bars={bars} timeframe={timeframe} />
        <AITradeCoach ticker={ticker} bars={bars} timeframe={timeframe} />
      </div>
    </div>
  );
}
