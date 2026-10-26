import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { computeExecutionTriggers } from "../../client/src/hooks/useExecutionTriggers";

describe("Global Architecture Overhaul — UI Collapsibility & Real-Time State Synchronization", () => {
  const tradingCardPath = path.resolve(__dirname, "../../client/src/components/swing/TradingCard.tsx");
  const tradingCardContent = fs.readFileSync(tradingCardPath, "utf-8").replace(/\r\n/g, "\n");

  const dashboardPath = path.resolve(__dirname, "../../client/src/pages/WealthEngineDashboard.tsx");
  const dashboardContent = fs.readFileSync(dashboardPath, "utf-8").replace(/\r\n/g, "\n");

  const globalStatePath = path.resolve(__dirname, "../../client/src/lib/globalState.tsx");
  const globalStateContent = fs.readFileSync(globalStatePath, "utf-8").replace(/\r\n/g, "\n");

  const swingChartPath = path.resolve(__dirname, "../../client/src/components/swing/SwingChart.tsx");
  const swingChartContent = fs.readFileSync(swingChartPath, "utf-8").replace(/\r\n/g, "\n");

  describe("1. Setup Card Refinement (Compact UI & Accordion Logic)", () => {
    it("defaults to compact state hiding deeper diagnostics until toggled", () => {
      // InlineTradingCard in TradingCard.tsx defaults isExpanded to false
      expect(tradingCardContent).toContain("const [isExpanded, setIsExpanded] = useState(false)");
      expect(tradingCardContent).toContain("card-expanded-details-");

      // WealthEngineDashboard Setup Card defaults isStudioSetupCardExpanded to false
      expect(dashboardContent).toContain("const [isStudioSetupCardExpanded, setIsStudioSetupCardExpanded] = useState(false)");
      expect(dashboardContent).toContain("studio-setup-card-body");
    });

    it("displays Top Row with Ticker, Live Price, and Status Badge", () => {
      // TradingCard.tsx top row
      expect(tradingCardContent).toContain("{d.symbol}");
      expect(tradingCardContent).toContain("data-testid={`inline-header-price-${d.symbol}`}");
      expect(tradingCardContent).toContain("<StatusPill");

      // WealthEngineDashboard.tsx top row
      expect(dashboardContent).toContain("data-testid=\"badge-setup-status\"");
      expect(dashboardContent).toContain("${(activeTickerData?.price ?? activePrice ?? 0).toFixed(2)}");
    });

    it("displays Middle Row with Buy Target, Stop Loss, and Return %", () => {
      // TradingCard.tsx middle row
      expect(tradingCardContent).toContain("data-testid={`core-metrics-${d.symbol}`}");
      expect(tradingCardContent).toContain("Buy Target");
      expect(tradingCardContent).toContain("Stop Loss");
      expect(tradingCardContent).toContain("Return %");

      // WealthEngineDashboard.tsx middle row
      expect(dashboardContent).toContain("data-testid=\"setup-three-bold-datapoints\"");
      expect(dashboardContent).toContain("Buy Target");
      expect(dashboardContent).toContain("Stop Loss");
      expect(dashboardContent).toContain("Primary T1");
    });

    it("renders New Summary Strip: Funding Allocated | Position Size (Shares) | Target R-Multiple", () => {
      // Priority Board Setup Card
      expect(tradingCardContent).toContain("data-testid={`setup-card-summary-strip-${d.symbol}`}");
      expect(tradingCardContent).toContain("Funding Allocated:");
      expect(tradingCardContent).toContain("Position Size:");
      expect(tradingCardContent).toContain("Target R-Multiple:");
      expect(tradingCardContent).toContain("Shares");

      // Wealth Studio Dashboard Setup Card
      expect(dashboardContent).toContain("data-testid=\"studio-setup-summary-strip\"");
      expect(dashboardContent).toContain("Funding Allocated:");
      expect(dashboardContent).toContain("Position Size:");
      expect(dashboardContent).toContain("Target R-Multiple:");
      expect(dashboardContent).toContain("Shares");
    });

    it("renders Bottom Row action buttons (Arm Trade, Adjust Plan, Expand Details) in Compact mode", () => {
      // Priority Board Setup Card
      expect(tradingCardContent).toContain("data-testid={`button-arm-trade-${d.symbol}`}");
      expect(tradingCardContent).toContain("data-testid={`button-adjust-plan-${d.symbol}`}");
      expect(tradingCardContent).toContain("data-testid={`button-toggle-expand-details-${d.symbol}`}");

      // Wealth Studio Dashboard Setup Card
      expect(dashboardContent).toContain("data-testid=\"button-arm-practice-trade\"");
      expect(dashboardContent).toContain("data-testid=\"button-studio-adjust-plan\"");
      expect(dashboardContent).toContain("data-testid=\"button-studio-expand-details\"");
    });

    it("collapses deeper diagnostics inside accordion revealed only when expanded", () => {
      expect(tradingCardContent).toContain("{isExpanded && (");
      expect(tradingCardContent).toContain("data-testid={`card-expanded-details-${d.symbol}`}");
      expect(tradingCardContent).toContain("data-testid={`badge-win-rate-${d.symbol}`}");
      expect(tradingCardContent).toContain("<SparklineChart symbol={d.symbol}");

      expect(dashboardContent).toContain("{isStudioSetupCardExpanded && (");
      expect(dashboardContent).toContain("data-testid=\"setup-bottom-line\"");
      expect(dashboardContent).toContain("data-testid=\"advanced-metrics-accordion\"");
    });
  });

  describe("2. Global Data Synchronization (Single Source of Truth)", () => {
    it("implements a single WebSocket root manager subscribing to ticks for all watchlisted tickers", () => {
      expect(globalStateContent).toContain("subscribeTick");
      expect(globalStateContent).toContain("subscribeSymbol");
      expect(globalStateContent).toContain("setLivePrices");
      expect(globalStateContent).toContain("export function useGlobalPrice");
    });

    it("unifies Wealth Studio, Watchlist, Header, and Setup Cards to pull from the same global state price", () => {
      // TradingCard pulls from useGlobalState().livePrices
      expect(tradingCardContent).toContain("const global = useGlobalState()");
      expect(tradingCardContent).toContain("global?.livePrices?.[d.symbol]");

      // WealthEngineDashboard pulls activePrice and livePrices from global
      expect(dashboardContent).toContain("const { activeTickerData, activePrice, livePrices } = global;");
      expect(dashboardContent).toContain("data-testid=\"header-live-price\"");
      expect(dashboardContent).toContain("data-testid=\"chart-live-price-value\"");

      // SwingChart also consumes global livePrices
      expect(swingChartContent).toContain("const global = useGlobalState();");
      expect(swingChartContent).toContain("global.livePrices[symbol]");
    });
  });

  describe("3. Live Charting & Actionable Execution Visuals", () => {
    it("useExecutionTriggers computes correct Buy Signal when live candle close >= Entry", () => {
      const res = computeExecutionTriggers(105, 105, 100, 95, 115);

      expect(res.isBuySignal).toBe(true);
      expect(res.isTargetHit).toBe(false);
      expect(res.isStopHit).toBe(false);
      expect(res.activeSignalText).toBe("BUY SIGNAL - EXECUTE");
      expect(res.signalType).toBe("BUY");
    });

    it("useExecutionTriggers triggers Target Hit when live price >= Target", () => {
      const res = computeExecutionTriggers(116, 116, 100, 95, 115);

      expect(res.isBuySignal).toBe(false);
      expect(res.isTargetHit).toBe(true);
      expect(res.isStopHit).toBe(false);
      expect(res.activeSignalText).toBe("SELL - TARGET HIT");
      expect(res.signalType).toBe("TARGET_HIT");
    });

    it("useExecutionTriggers triggers Stop Loss Hit when live price <= Stop", () => {
      const res = computeExecutionTriggers(94, 94, 100, 95, 115);

      expect(res.isBuySignal).toBe(false);
      expect(res.isTargetHit).toBe(false);
      expect(res.isStopHit).toBe(true);
      expect(res.activeSignalText).toBe("SELL - STOP HIT");
      expect(res.signalType).toBe("STOP_HIT");
    });

    it("useExecutionTriggers returns neutral when price is within range and below entry", () => {
      const res = computeExecutionTriggers(98, 98, 100, 95, 115);

      expect(res.isBuySignal).toBe(false);
      expect(res.isTargetHit).toBe(false);
      expect(res.isStopHit).toBe(false);
      expect(res.activeSignalText).toBeNull();
      expect(res.signalType).toBeNull();
    });

    it("LiveTradingChart and SwingChart integrate useExecutionTriggers and render glowing markers and alerts", () => {
      // Hook integrated in LiveTradingChart
      expect(dashboardContent).toContain("useExecutionTriggers");
      expect(dashboardContent).toContain("const executionTrigger = useExecutionTriggers(");

      // SVG markers in LiveTradingChart
      expect(dashboardContent).toContain("chart-marker-buy-signal");
      expect(dashboardContent).toContain("[ BUY SIGNAL - EXECUTE ]");
      expect(dashboardContent).toContain("chart-marker-target-hit");
      expect(dashboardContent).toContain("[ SELL - TARGET HIT ]");
      expect(dashboardContent).toContain("chart-marker-stop-hit");
      expect(dashboardContent).toContain("[ SELL - STOP HIT ]");

      // Glowing alert badge in LiveTradingChart and SwingChart UI
      expect(dashboardContent).toContain("data-testid=\"chart-execution-alert\"");
      expect(swingChartContent).toContain("data-testid=\"chart-execution-alert\"");
    });

    it("updates live bar forming candle dynamically tick-by-tick without redrawing historical candles", () => {
      expect(dashboardContent).toContain("const historicalCandles = useMemo(");
      expect(dashboardContent).toContain("const activeCandle = useMemo(");
      expect(dashboardContent).toContain("sourceCandles.slice(0, sourceCandles.length - 1)");
      expect(dashboardContent).toContain("currentClose = Number.isFinite(livePrice) ? livePrice");
    });
  });
});
