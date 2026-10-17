// CockpitWorkspace — 3-column layout wrapping the TradingView chart.
//
// LEFT   23–25% : Regime v2 (compact) + Market Pulse (compact)
// CENTER 50–54% : TradingViewChart (the star)
// RIGHT  23–25% : Ticker Strength gauge + Technical Snapshot + AI Trade Coach
//
// On <lg screens, everything stacks. The user's persisted collapse pref for
// Active Setups stays in ActiveSetupsPanel (unchanged) — the workspace only
// hosts the three visual columns.

import { useEffect, useMemo, useState } from "react";
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
import ErrorBoundary from "@/components/ErrorBoundary";
import { TIMEFRAMES, readSavedTimeframe, writeSavedTimeframe, maybeAggregate, type Timeframe } from "@/lib/timeframes";
import TradePlanWorkspace from "@/components/TradePlanWorkspace";
import { SwingStatusStrip } from "@/components/swing/SwingConsistency";
import MTFSignalsPanel from "@/components/MTFSignalsPanel";
import MTFSettingsPanel from "@/components/MTFSettingsPanel";
import CollapsibleSection from "@/components/CollapsibleSection";

interface OHLCBar { date: string; open: number; high: number; low: number; close: number; volume: number }

export default function CockpitWorkspace() {
  const { active } = useCockpitTicker();
  const ticker = active || "SPY";

  const [timeframe, setTimeframeState] = useState<Timeframe>(() => readSavedTimeframe(ticker, "1D"));
  
  useEffect(() => { 
    setTimeframeState(readSavedTimeframe(ticker, "1D")); 
  }, [ticker]);
  
  const setTimeframe = (tf: Timeframe) => {
    setTimeframeState(tf);
    writeSavedTimeframe(ticker, tf);
  };

  const tfApi = TIMEFRAMES[timeframe].apiValue;

  const { data: barsResp, isLoading } = useQuery<{ bars: OHLCBar[]; warning?: string; source?: string }>({
    queryKey: ["/api/candles-ohlc", ticker, tfApi, "withMeta"],
    queryFn: async ({ signal }) => {
      const res = await apiRequest("GET", `/api/candles-ohlc/${ticker}?interval=${tfApi}&meta=1`, undefined, signal);
      const json = await res.json();
      if (Array.isArray(json)) return { bars: json };
      return { bars: json?.bars || [], warning: json?.warning, source: json?.source };
    },
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
  
  const rawBars = barsResp?.bars;
  const barsWarning = barsResp?.warning;
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
      className="grid grid-cols-1 lg:grid-cols-[minmax(0,23%)_minmax(0,1fr)_minmax(0,23%)] gap-4 xl:gap-6 items-start"
      data-testid="cockpit-workspace"
    >
      {/* LEFT COLUMN */}
      <div className="space-y-4 min-w-0" data-testid="workspace-left">
        <CollapsibleSection
          id="regime"
          title="Regime Engine"
          containerClassName=""
        >
          <ErrorBoundary label="regime">
            <RegimeV2Panel compact />
          </ErrorBoundary>
        </CollapsibleSection>
        <CollapsibleSection
          id="market-pulse"
          title="Market Pulse"
          defaultCollapsed
        >
          <ErrorBoundary label="market-pulse">
            <MarketPulsePanel />
          </ErrorBoundary>
        </CollapsibleSection>
      </div>

      {/* CENTER COLUMN */}
      <div className="min-w-0 space-y-4 xl:space-y-6" data-testid="workspace-center">
        <ErrorBoundary label="chart">
          <TradingViewChart
            ticker={ticker}
            bars={bars}
            isLoading={isLoading}
            barsWarning={barsWarning}
            regime={regime?.day_class}
            height={420}
            timeframe={timeframe}
            onTimeframeChange={setTimeframe}
            mtfStrip={
              <ErrorBoundary label="mtf">
                <MultiTimeframeContext ticker={ticker} activeTf={timeframe} />
              </ErrorBoundary>
            }
          />
        </ErrorBoundary>

        {timeframe !== "1D" && (
          <div
            className="flex items-center rounded-md border border-signal-amber/40 bg-signal-amber/5 p-4 text-xs font-medium text-signal-amber font-sans leading-relaxed"
            data-testid="strategy-tf-reminder"
            role="note"
          >
            <span>
              Displayed chart is <strong className="font-bold text-signal-amber/90">{timeframe}</strong>. Scanner, setup grades, and extension checks continue to use the <strong className="font-bold text-signal-amber/90">Daily</strong> strategy timeframe.
            </span>
          </div>
        )}

        <CollapsibleSection
          id="trade-plan"
          title="Trade Plan Workspace"
          defaultCollapsed
        >
          <ErrorBoundary label="trade-plan">
            <SwingStatusStrip symbol={ticker} context="trade-plan" />
            <TradePlanWorkspace />
          </ErrorBoundary>
        </CollapsibleSection>
        
        <CollapsibleSection
          id="mtf-signals"
          title="MTF Swing Engine"
          containerClassName=""
        >
          <ErrorBoundary label="mtf-signals">
            <MTFSignalsPanel />
          </ErrorBoundary>
        </CollapsibleSection>
        
        <CollapsibleSection
          id="mtf-settings"
          title="Signal Sensitivity"
          defaultCollapsed
        >
          <ErrorBoundary label="mtf-settings">
            <MTFSettingsPanel />
          </ErrorBoundary>
        </CollapsibleSection>
      </div>

      {/* RIGHT COLUMN */}
      <div className="space-y-4 min-w-0" data-testid="workspace-right">
        <CollapsibleSection
          id="ticker-strength"
          title="Ticker Strength"
          hint={ticker}
          defaultCollapsed
        >
          <ErrorBoundary label="ticker-strength">
            <TickerStrengthGauge ticker={ticker} bars={bars} timeframe={timeframe} />
          </ErrorBoundary>
        </CollapsibleSection>
        
        <CollapsibleSection
          id="technical-snapshot"
          title="Technical Snapshot"
          hint={ticker}
          defaultCollapsed
        >
          <ErrorBoundary label="technical-snapshot">
            <TechnicalSnapshot ticker={ticker} bars={bars} timeframe={timeframe} />
          </ErrorBoundary>
        </CollapsibleSection>
        
        <CollapsibleSection
          id="ai-coach"
          title="AI Trade Coach"
          hint={ticker}
          defaultCollapsed
        >
          <ErrorBoundary label="ai-coach">
            <SwingStatusStrip symbol={ticker} context="ai-coach" />
            <AITradeCoach ticker={ticker} bars={bars} timeframe={timeframe} />
          </ErrorBoundary>
        </CollapsibleSection>
      </div>
    </div>
  );
}
