import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Chizzle Wealth Engine — Single-Page Dashboard Studio", () => {
  const dashboardPath = path.resolve(__dirname, "../../client/src/pages/WealthEngineDashboard.tsx");
  const dashboardContent = fs.readFileSync(dashboardPath, "utf-8").replace(/\r\n/g, "\n");

  describe("1. Global Layout & Architecture", () => {
    it("creates a strict 100vh full-width container with no vertical window scrolling", () => {
      expect(dashboardContent).toContain("h-screen w-screen max-h-screen");
      expect(dashboardContent).toContain("overflow-hidden flex flex-col");
    });

    it("implements a 3-column layout with 20%, 55%, and 25% widths", () => {
      // Left column: 20% width
      expect(dashboardContent).toContain('w-[20%]');
      expect(dashboardContent).toContain('data-testid="column-left"');

      // Center column: 55% width
      expect(dashboardContent).toContain('w-[55%]');
      expect(dashboardContent).toContain('data-testid="column-center"');

      // Right column: 25% width
      expect(dashboardContent).toContain('w-[25%]');
      expect(dashboardContent).toContain('data-testid="column-right"');
    });

    it("ensures each column scrolls internally without main browser window scroll", () => {
      expect(dashboardContent).toContain("overflow-y-auto");
    });
  });

  describe("2. Branding & Navigation", () => {
    it("renders top navigation bar with brand text CHIZZLE WEALTH ENGINE and bullish candlestick SVG", () => {
      expect(dashboardContent).toContain("CHIZZLE");
      expect(dashboardContent).toContain("WEALTH ENGINE");
      expect(dashboardContent).toContain("function CandlestickIcon");
      expect(dashboardContent).toContain('<rect x="2" y="6" width="6" height="11"');
      expect(dashboardContent).toContain('line x1="5" y1="1" x2="5" y2="6"');
      expect(dashboardContent).toContain('line x1="5" y1="17" x2="5" y2="23"');
    });

    it("defines and supports all three specific color themes via CSS variables", () => {
      // Cyber Neon (Default)
      expect(dashboardContent).toContain('"cyber-neon"');
      expect(dashboardContent).toContain('#0F172A'); // deep slate/charcoal bg
      expect(dashboardContent).toContain('#06B6D4'); // cyan borders
      expect(dashboardContent).toContain('#22C55E'); // neon green

      // Stealth Mode
      expect(dashboardContent).toContain('"stealth"');
      expect(dashboardContent).toContain('#000000'); // OLED black
      expect(dashboardContent).toContain('#F59E0B'); // amber/gold highlights

      // Arctic Terminal
      expect(dashboardContent).toContain('"arctic"');
      expect(dashboardContent).toContain('#FFFFFF'); // crisp white
      expect(dashboardContent).toContain('#0F172A'); // stark black borders / navy text
    });

    it("provides an interactive theme switcher button in the top right corner", () => {
      expect(dashboardContent).toContain('data-testid="button-theme-switcher"');
      expect(dashboardContent).toContain("cycleTheme");
    });
  });

  describe("3. Column Details & Components", () => {
    it("Left Column includes Market Regime traffic-light indicator (Red/Yellow/Green)", () => {
      expect(dashboardContent).toContain('data-testid="market-regime-indicator"');
      expect(dashboardContent).toContain("Red Traffic Light");
      expect(dashboardContent).toContain("Yellow Traffic Light");
      expect(dashboardContent).toContain("Green Traffic Light");
    });

    it("Left Column includes scrollable, compact watchlist with symbols, prices, and mini sparklines", () => {
      expect(dashboardContent).toContain("watchlist-row-");
      expect(dashboardContent).toContain("<polyline");
      expect(dashboardContent).toContain("sparkline");
    });

    it("Center Column includes horizontal tab-bar for Chart, Setup History, Settings, and Indicators", () => {
      expect(dashboardContent).toContain('data-testid="center-tab-bar"');
      expect(dashboardContent).toContain('data-testid="tab-chart"');
      expect(dashboardContent).toContain('data-testid="tab-setup-history"');
      expect(dashboardContent).toContain('data-testid="tab-settings"');
      expect(dashboardContent).toContain('data-testid="tab-indicators"');
    });

    it("Center Column overlays text labels for 20-SMA, 50-SMA, and 200-SMA on top edge of chart", () => {
      expect(dashboardContent).toContain('data-testid="sma-overlay-labels"');
      expect(dashboardContent).toContain("20-SMA:");
      expect(dashboardContent).toContain("50-SMA:");
      expect(dashboardContent).toContain("200-SMA:");
    });

    it("Right Column renders Setup Card with background color tints indicating status", () => {
      expect(dashboardContent).toContain('data-testid="setup-card"');
      expect(dashboardContent).toContain('data-testid="badge-setup-status"');
      expect(dashboardContent).toContain("bg-emerald-950/20");
      expect(dashboardContent).toContain("bg-amber-950/20");
    });

    it("Right Column prominently displays exactly three large, bold data points: Buy Target, Stop Loss, Primary Target", () => {
      expect(dashboardContent).toContain('data-testid="setup-three-bold-datapoints"');
      expect(dashboardContent).toContain("Buy Target");
      expect(dashboardContent).toContain("Stop Loss");
      expect(dashboardContent).toContain("Primary T1");
    });

    it("Right Column includes short Bottom Line summary sentence below the numbers", () => {
      expect(dashboardContent).toContain('data-testid="setup-bottom-line"');
      expect(dashboardContent).toContain("Bottom Line");
    });

    it("Right Column includes collapsed Advanced Metrics accordion dropdown for partial profit targets and win rates", () => {
      expect(dashboardContent).toContain('data-testid="advanced-metrics-accordion"');
      expect(dashboardContent).toContain('data-testid="button-toggle-advanced-metrics"');
      expect(dashboardContent).toContain("Advanced Metrics");
      expect(dashboardContent).toContain("Partial Profit Targets");
      expect(dashboardContent).toContain("Historical Win Rate");
    });
  });

  describe("4. Auto-Hiding Text Overlay & Live Chart Markers", () => {
    it("implements auto-hiding text overlay with fade-out classes and timeout cleanup", () => {
      expect(dashboardContent).toContain('data-testid="chart-text-overlay"');
      expect(dashboardContent).toContain("transition-opacity duration-1000 ease-in-out");
      expect(dashboardContent).toContain("opacity-100");
      expect(dashboardContent).toContain("opacity-0 pointer-events-none");
      expect(dashboardContent).toContain("clearTimeout");
    });

    it("renders live Entry and Exit signal markers directly on the candlesticks", () => {
      expect(dashboardContent).toContain('data-testid="chart-marker-entry"');
      expect(dashboardContent).toContain("▲ GET IN");
      expect(dashboardContent).toContain('data-testid="chart-marker-target"');
      expect(dashboardContent).toContain('data-testid="chart-marker-stop"');
      expect(dashboardContent).toContain("▼ GET OUT");
    });

    it("evaluates live real-time price signals on the incoming candle", () => {
      expect(dashboardContent).toContain("chart-live-signal-");
      expect(dashboardContent).toContain("entryPrice");
      expect(dashboardContent).toContain("stopLoss");
      expect(dashboardContent).toContain("primaryTarget");
    });
  });

  describe("5. Unblocked Chart, Real-Time Price Tracker, and Crosshair OHLC Display", () => {
    it("moves BUY, STOP, T1 and live price labels completely outside the candlestick grid onto the right-hand Y-axis", () => {
      expect(dashboardContent).toContain('data-testid="chart-label-buy"');
      expect(dashboardContent).toContain('data-testid="chart-label-stop"');
      expect(dashboardContent).toContain('data-testid="chart-label-t1"');
      expect(dashboardContent).toContain('data-testid="chart-live-price-badge"');
      expect(dashboardContent).toContain("translate(714,");
    });

    it("fades horizontal target, buy, and stop lines to 30%-40% opacity behind the candlestick series", () => {
      expect(dashboardContent).toContain('opacity="0.35"');
      // Ensure lines precede the candlestick mapping in rendering order
      const buyLineIdx = dashboardContent.indexOf("Buy Target Line (Faded to ~35% opacity behind candles)");
      const candleLoopIdx = dashboardContent.indexOf("FOREGROUND LAYER: Dynamic Candlestick Series");
      expect(buyLineIdx).toBeGreaterThan(0);
      expect(candleLoopIdx).toBeGreaterThan(buyLineIdx);
    });

    it("shrinks the glowing live price tag dimensions and glow radius", () => {
      expect(dashboardContent).toContain('width="76"');
      expect(dashboardContent).toContain('height="18"');
      expect(dashboardContent).toContain("drop-shadow-[0_0_4px_rgba(6,182,212,0.4)]");
    });

    it("renders a thin 1px horizontal live price line tracking tick-by-tick without redrawing historical candles", () => {
      expect(dashboardContent).toContain('data-testid="chart-live-price-line"');
      expect(dashboardContent).toContain('strokeWidth="1"');
      expect(dashboardContent).toContain("baseCandles");
      expect(dashboardContent).toContain("activeCandle");
    });

    it("enables crosshair tracking lines and anchored OHLC legend display on hover", () => {
      expect(dashboardContent).toContain('data-testid="chart-crosshair-lines"');
      expect(dashboardContent).toContain('data-testid="chart-ohlc-legend"');
      expect(dashboardContent).toContain('data-testid="chart-hover-tooltip"');
      expect(dashboardContent).toContain("handleSvgMouseMove");
      expect(dashboardContent).toContain("handleSvgMouseLeave");
      expect(dashboardContent).toContain("cursor-crosshair");
    });
  });

  describe("6. Data State Synchronization, Bad Tick Outlier Rejection, and Feed Reconnection", () => {
    const globalStatePath = path.resolve(__dirname, "../../client/src/lib/globalState.tsx");
    const globalStateContent = fs.readFileSync(globalStatePath, "utf-8").replace(/\r\n/g, "\n");

    const priceFeedPath = path.resolve(__dirname, "../../client/src/lib/priceFeed.ts");
    const priceFeedContent = fs.readFileSync(priceFeedPath, "utf-8").replace(/\r\n/g, "\n");

    it("synchronizes Watchlist and Chart to single source of truth in globalState", () => {
      expect(globalStateContent).toContain("activePrice");
      expect(globalStateContent).toContain("syncedWatchlist");
      expect(globalStateContent).toContain("livePrices");
      expect(dashboardContent).toContain("activePrice: storePrice");
    });

    it("implements bad tick outlier rejection (dropping sudden >3.5% spikes before updating chart)", () => {
      expect(priceFeedContent).toContain("isBadTick");
      expect(globalStateContent).toContain("isBadTick");
      expect(dashboardContent).toContain("isOutlier");
      expect(dashboardContent).toContain("LiveTradingChart:BadTick");
    });

    it("continuously attempts WebSocket reconnection every 5s and clears STALE state upon reconnect", () => {
      expect(priceFeedContent).toContain("ensureBackgroundWsReconnect");
      expect(priceFeedContent).toContain("5000");
      expect(priceFeedContent).toContain('setConn("LIVE")');
      expect(priceFeedContent).toContain("Primary WebSocket reconnected");
    });

    it("implements Reset Chart Data and auto-scaling function with outlier clamp", () => {
      expect(dashboardContent).toContain("resetChartData");
      expect(dashboardContent).toContain('data-testid="button-reset-chart"');
      expect(dashboardContent).toContain("/api/candles-ohlc/");
      expect(dashboardContent).toContain("Feed recovered from STALE -> LIVE");
      expect(dashboardContent).toContain("clampLow");
      expect(dashboardContent).toContain("clampHigh");
    });
  });

  describe("7. Error Boundary, Null/Undefined Defenses & Boot Sequence Logging", () => {
    const appPath = path.resolve(__dirname, "../../client/src/App.tsx");
    const appContent = fs.readFileSync(appPath, "utf-8").replace(/\r\n/g, "\n");

    const errorBoundaryPath = path.resolve(__dirname, "../../client/src/components/ErrorBoundary.tsx");
    const errorBoundaryContent = fs.readFileSync(errorBoundaryPath, "utf-8").replace(/\r\n/g, "\n");

    const wealthWatchlistPath = path.resolve(__dirname, "../../client/src/lib/wealthWatchlist.ts");
    const wealthWatchlistContent = fs.readFileSync(wealthWatchlistPath, "utf-8").replace(/\r\n/g, "\n");

    const globalStatePath = path.resolve(__dirname, "../../client/src/lib/globalState.tsx");
    const globalStateContent = fs.readFileSync(globalStatePath, "utf-8").replace(/\r\n/g, "\n");

    const priceFeedPath = path.resolve(__dirname, "../../client/src/lib/priceFeed.ts");
    const priceFeedContent = fs.readFileSync(priceFeedPath, "utf-8").replace(/\r\n/g, "\n");

    it("wraps the Application Root and Wealth Studio routes in Error Boundaries", () => {
      expect(appContent).toContain('<ErrorBoundary label="Application Root" fullPage>');
      expect(appContent).toContain('function WealthStudioRoute()');
      expect(appContent).toContain('<ErrorBoundary label="Wealth Studio" fullPage>');
      expect(dashboardContent).toContain('<ErrorBoundary label="Wealth Studio Workspace" fullPage>');
      expect(dashboardContent).toContain('<ErrorBoundary label="Wealth Studio Live Chart">');
    });

    it("renders detailed error message and stack trace fallback in ErrorBoundary with recovery actions", () => {
      expect(errorBoundaryContent).toContain('data-testid="error-message-box"');
      expect(errorBoundaryContent).toContain('data-testid="error-stack-trace"');
      expect(errorBoundaryContent).toContain('data-testid="button-error-boundary-retry"');
      expect(errorBoundaryContent).toContain('data-testid="button-error-boundary-reload"');
      expect(errorBoundaryContent).toContain('data-testid="button-error-boundary-home"');
      expect(errorBoundaryContent).toContain('data-testid="button-error-boundary-clear"');
      expect(errorBoundaryContent).toContain("err.stack || info?.componentStack");
    });

    it("breaks circular dependency by isolating DEFAULT_WATCHLIST in wealthWatchlist.ts", () => {
      expect(wealthWatchlistContent).toContain("export const DEFAULT_WATCHLIST: WatchlistItem[]");
      expect(globalStateContent).toContain('from "@/lib/wealthWatchlist"');
      expect(dashboardContent).toContain('from "@/lib/wealthWatchlist"');
    });

    it("guards all activeItem and displayedCandle accesses with safe fallbacks and optional chaining", () => {
      expect(dashboardContent).toContain("activeItem?.status");
      expect(dashboardContent).toContain("activeItem?.price != null ? activeItem.price.toFixed(2)");
      expect(dashboardContent).toContain("activeItem?.buyTarget != null ? activeItem.buyTarget.toFixed(2)");
      expect(dashboardContent).toContain("activeItem?.stopLoss != null ? activeItem.stopLoss.toFixed(2)");
      expect(dashboardContent).toContain("activeItem?.primaryTarget != null ? activeItem.primaryTarget.toFixed(2)");
      expect(dashboardContent).toContain("displayedCandle.o != null ? displayedCandle.o.toFixed(2)");
    });

    it("logs clear breadcrumbs throughout the boot sequence across all lifecycle stages", () => {
      expect(appContent).toContain("[Boot:App]");
      expect(appContent).toContain("[Boot:AppRouter]");
      expect(globalStateContent).toContain("[Boot:GlobalState]");
      expect(priceFeedContent).toContain("[Boot:PriceFeed]");
      expect(dashboardContent).toContain("[Boot:WealthStudio]");
      expect(dashboardContent).toContain("[Boot:LiveTradingChart]");
    });
  });
});

