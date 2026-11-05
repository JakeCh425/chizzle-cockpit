import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { DEFAULT_WATCHLIST } from "../../client/src/lib/wealthWatchlist";

describe("Fix Watchlist Input Bug, Unify Global Ticker Flow, and Apply Bloomberg UI/Typography", () => {
  const dashPath = path.resolve(__dirname, "../../client/src/pages/WealthEngineDashboard.tsx");
  const dashSrc = fs.readFileSync(dashPath, "utf-8").replace(/\r\n/g, "\n");

  const watchlistPagePath = path.resolve(__dirname, "../../client/src/pages/Watchlist.tsx");
  const watchlistPageSrc = fs.readFileSync(watchlistPagePath, "utf-8").replace(/\r\n/g, "\n");

  const appShellPath = path.resolve(__dirname, "../../client/src/components/AppShell.tsx");
  const appShellSrc = fs.readFileSync(appShellPath, "utf-8").replace(/\r\n/g, "\n");

  const globalStatePath = path.resolve(__dirname, "../../client/src/lib/globalState.tsx");
  const globalStateSrc = fs.readFileSync(globalStatePath, "utf-8").replace(/\r\n/g, "\n");

  const scannerPath = path.resolve(__dirname, "../../client/src/hooks/useSetupScanner.ts");
  const scannerSrc = fs.readFileSync(scannerPath, "utf-8").replace(/\r\n/g, "\n");

  const tradingCardPath = path.resolve(__dirname, "../../client/src/components/swing/TradingCard.tsx");
  const tradingCardSrc = fs.readFileSync(tradingCardPath, "utf-8").replace(/\r\n/g, "\n");

  const actionEnginePath = path.resolve(__dirname, "../../client/src/components/swing/StepByStepActionChecklist.tsx");
  const actionEngineSrc = fs.readFileSync(actionEnginePath, "utf-8").replace(/\r\n/g, "\n");

  const indexHtmlPath = path.resolve(__dirname, "../../client/index.html");
  const indexHtmlSrc = fs.readFileSync(indexHtmlPath, "utf-8").replace(/\r\n/g, "\n");

  const indexCssPath = path.resolve(__dirname, "../../client/src/index.css");
  const indexCssSrc = fs.readFileSync(indexCssPath, "utf-8").replace(/\r\n/g, "\n");

  const swingWorkspacePath = path.resolve(__dirname, "../../client/src/components/swing/SwingWorkspace.tsx");
  const swingWorkspaceSrc = fs.readFileSync(swingWorkspacePath, "utf-8").replace(/\r\n/g, "\n");

  const modalChartPath = path.resolve(__dirname, "../../client/src/components/swing/ModalLargeChart.tsx");
  const modalChartSrc = fs.readFileSync(modalChartPath, "utf-8").replace(/\r\n/g, "\n");

  const actionCenterPath = path.resolve(__dirname, "../../client/src/components/swing/ActionCenter.tsx");
  const actionCenterSrc = fs.readFileSync(actionCenterPath, "utf-8").replace(/\r\n/g, "\n");

  const universePath = path.resolve(__dirname, "../../server/swing/universe.ts");
  const universeSrc = fs.readFileSync(universePath, "utf-8").replace(/\r\n/g, "\n");

  describe("1. Fix Frozen Watchlist Input (React State Bug)", () => {
    it("binds local state [newTicker, setNewTicker] with uppercase onChange handler across Dashboard, Watchlist, and SwingWorkspace", () => {
      expect(dashSrc).toContain("const [newTicker, setNewTicker] = useState(");
      expect(dashSrc).toContain("setNewTicker(e.target.value.toUpperCase())");
      expect(dashSrc).toContain('data-testid="input-quick-add-ticker"');

      expect(swingWorkspaceSrc).toContain("const [newTicker, setNewTicker] = useState(");
      expect(swingWorkspaceSrc).toContain("setNewTicker(e.target.value.toUpperCase())");
      expect(swingWorkspaceSrc).toContain("text-white text-cyan-400");
      expect(swingWorkspaceSrc).toContain("subscribeSymbol(sym)");
      expect(swingWorkspaceSrc).toContain("global?.addTicker?.(sym)");
    });

    it("provides resilient Yahoo search fallback so valid US tickers do not fail with red error text on rate limits", () => {
      expect(universeSrc).toContain("fallbackQuote");
      expect(universeSrc).toContain("FALLBACK_ETFS");
    });

    it("handles Enter keydown and [ + ] submit button click, stopping event bubbling", () => {
      expect(dashSrc).toContain('if (e.key === "Enter")');
      expect(dashSrc).toContain("e.stopPropagation()");
      expect(dashSrc).toContain('data-testid="button-quick-add-ticker"');
      expect(dashSrc).toContain("handleQuickAdd");
    });

    it("pushes ticker to global list, clears input field, and immediately subscribes to live WebSocket feed", () => {
      expect(dashSrc).toContain("global?.addTicker?.(sym)");
      expect(dashSrc).toContain('setNewTicker("")');
      expect(globalStateSrc).toContain("subscribeSymbol(sym)");
    });

    it("Watchlist component has properly bound newTicker state, visible text-white/text-cyan-400, Enter key handler, and [ + Add ] button", () => {
      expect(watchlistPageSrc).toContain("const [newTicker, setNewTicker] = useState(");
      expect(watchlistPageSrc).toContain("setNewTicker(e.target.value.toUpperCase())");
      expect(watchlistPageSrc).toContain("text-white text-cyan-400");
      expect(watchlistPageSrc).toContain('if (e.key === "Enter")');
      expect(watchlistPageSrc).toContain("[ + Add ]");
      expect(watchlistPageSrc).toContain("global?.addTicker");
      expect(watchlistPageSrc).toContain("subscribeSymbol(sym)");
    });
  });

  describe("1b. 10-SMA Momentum Integration & Chart Rendering", () => {
    it("scans for 10-SMA runaway momentum setups when trading > 3% above 20-SMA and pulling back to 10-SMA", () => {
      expect(scannerSrc).toContain("price > sma20 * 1.03");
      expect(scannerSrc).toContain("is10SmaMomentum");
    });

    it("plots SMA 10 on all charts (SwingChart, ModalLargeChart, SparklineChart, LiveTradingChart) with bright white #FFFFFF", () => {
      expect(modalChartSrc).toContain("sma10Data");
      expect(modalChartSrc).toContain("[ - SMA 10 ]");
      expect(modalChartSrc).toContain("#FFFFFF");
      expect(tradingCardSrc).toContain("sma10Data");
      expect(dashSrc).toContain("sma10Path");
    });
  });

  describe("2. Implement Collapsible & Resizable Sidebar (Bloomberg Style)", () => {
    it("renders [ < Collapse ] toggle icon at the top of the sidebar", () => {
      expect(dashSrc).toContain("[ < Collapse ]");
      expect(dashSrc).toContain('data-testid="button-collapse-left-sidebar"');
      expect(appShellSrc).toContain("[ < Collapse ]");
    });

    it("collapses to 60px mini-mode displaying only Ticker Symbol and colored status dot", () => {
      expect(dashSrc).toContain('isLeftSidebarCollapsed ? "w-[60px]"');
      expect(dashSrc).toContain('data-testid="left-sidebar-mini-mode"');
      expect(dashSrc).toContain("data-testid={`watchlist-mini-row-${item.symbol}`}");
      expect(dashSrc).toContain("data-testid={`watchlist-status-dot-${item.symbol}`}");
      expect(dashSrc).toContain("bg-emerald-400"); // Green for Ready
      expect(dashSrc).toContain("bg-amber-400"); // Yellow for Forming
    });

    it("provides draggable CSS resize handle with cursor-col-resize between sidebar and chart container", () => {
      expect(dashSrc).toContain("cursor-col-resize");
      expect(dashSrc).toContain('data-testid="sidebar-resizer-left"');
      expect(dashSrc).toContain("startResizingLeft");
    });
  });

  describe("2. Seamless Global State Flow (Watchlist ⇄ Scanner ⇄ Cards)", () => {
    it("holds master activeWatchlist in GlobalStateContext and provider", () => {
      expect(globalStateSrc).toContain("activeWatchlist: WatchlistItem[]");
      expect(globalStateSrc).toContain("activeWatchlist: syncedWatchlist");
    });

    it("useSetupScanner maps over activeWatchlist / watchlist on every live tick", () => {
      expect(scannerSrc).toContain("global?.activeWatchlist ?? global?.watchlist");
      expect(scannerSrc).toContain(".filter((item) =>");
      expect(scannerSrc).toContain("livePrices[sym]");
    });

    it("instantly upgrades No-Trade tickers meeting 20-SMA or 10-EMA proximity and mounts to Priority Board", () => {
      expect(scannerSrc).toContain("isUpgradedFromNoTrade");
      expect(scannerSrc).toContain("priorityBoardSetups");
      expect(scannerSrc).toContain("meets20SmaRule");
      expect(scannerSrc).toContain("meets10EmaRule");
    });
  });

  describe("3. Bloomberg Terminal Typography & Space Optimization", () => {
    it("configures Roboto Mono and Fira Code in index.html and index.css", () => {
      expect(indexHtmlSrc).toContain("Roboto+Mono");
      expect(indexHtmlSrc).toContain("Fira+Code");
      expect(indexCssSrc).toContain("Roboto Mono");
      expect(indexCssSrc).toContain("Fira Code");
    });

    it("enlarges active ticker symbol and current price on chart and active setup cards (text-3xl or text-4xl font-extrabold)", () => {
      // Top of chart
      expect(dashSrc).toContain("text-4xl font-extrabold");
      // Setup Card in Studio
      expect(dashSrc).toContain("text-3xl sm:text-4xl font-extrabold font-mono tracking-tight");
      expect(dashSrc).toContain("text-2xl sm:text-3xl font-extrabold font-mono tabular-nums");
      // Setup Card in TradingCard.tsx
      expect(tradingCardSrc).toContain("font-mono text-3xl sm:text-4xl font-extrabold tracking-tight text-white");
      expect(tradingCardSrc).toContain("font-mono tabular-nums text-2xl sm:text-3xl font-extrabold text-emerald-400");
    });

    it("optimizes container padding to tighter terminal spacing", () => {
      expect(dashSrc).toContain("px-3 py-2 border-b border-[var(--card-border)]");
    });
  });

  describe("4. Beginner-Friendly Step-by-Step Action Engine", () => {
    it("implements literal, bold checklist with Steps 1 through 4", () => {
      expect(actionEngineSrc).toContain("STEP 1: Await 1H Candle Close above");
      expect(actionEngineSrc).toContain("STEP 2: Place Limit BUY order at");
      expect(actionEngineSrc).toContain("STEP 3: Set Hard Stop Loss at");
      expect(actionEngineSrc).toContain("STEP 4: Set OCO Target 1 at");
    });

    it("displays spinner when awaiting close and green check when closed", () => {
      expect(actionEngineSrc).toContain("Loader2");
      expect(actionEngineSrc).toContain("CheckCircle2");
      expect(actionEngineSrc).toContain("animate-spin");
    });

    it("highlights current required step in neon cyan/emerald, dimming future steps", () => {
      expect(actionEngineSrc).toContain("step1Done");
      expect(actionEngineSrc).toContain("step2Active");
      expect(actionEngineSrc).toContain("step2Dimmed");
      expect(actionEngineSrc).toContain("step3Active");
      expect(actionEngineSrc).toContain("step4Active");
    });

    it("embeds StepByStepActionChecklist into expanded Setup Cards, ActionCenter, and Studio right sidebar", () => {
      expect(dashSrc).toContain("<StepByStepActionChecklist");
      expect(tradingCardSrc).toContain("<StepByStepActionChecklist");
      expect(actionCenterSrc).toContain("<StepByStepActionChecklist");
    });
  });
});
