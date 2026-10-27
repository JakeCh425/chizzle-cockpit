import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  evaluateCandleSetupConfirmation,
  type CandleData,
} from "../../client/src/hooks/useCandleSetupConfirmation";

describe("Wealth Studio Resizable Sidebars, 1H Candle Bounce Confirmation Engine, & Conditional Level Visibility", () => {
  const dashboardPath = path.resolve(__dirname, "../../client/src/pages/WealthEngineDashboard.tsx");
  const dashboardContent = fs.readFileSync(dashboardPath, "utf-8").replace(/\r\n/g, "\n");

  describe("1. Resizable & Draggable Splitter Handle & 40px Collapsed Rail", () => {
    it("renders draggable splitter divider between main chart canvas and right execution sidebar", () => {
      expect(dashboardContent).toContain('data-testid="sidebar-resizer-right"');
      expect(dashboardContent).toContain("onMouseDown={startResizingRight}");
      expect(dashboardContent).toContain("cursor-col-resize");
    });

    it("includes chevron collapse toggle button on resizer handle and support for double-click collapse", () => {
      expect(dashboardContent).toContain('data-testid="button-resizer-collapse-toggle"');
      expect(dashboardContent).toContain("toggleRightSidebarCollapse");
      expect(dashboardContent).toContain("onDoubleClick={toggleRightSidebarCollapse}");
    });

    it("clamps right sidebar width between 260px (min) and 500px (max) with 320px default (w-80)", () => {
      expect(dashboardContent).toContain("Math.max(260, Math.min(500, newWidth))");
      expect(dashboardContent).toContain("const [rightSidebarWidth, setRightSidebarWidth] = useState<number>(320)");
      expect(dashboardContent).toContain("minWidth: isRightSidebarCollapsed ? 40 : 260");
      expect(dashboardContent).toContain("maxWidth: isRightSidebarCollapsed ? 40 : 500");
    });

    it("switches to compact 40px icon rail (w-[40px]) when collapsed with expand toggle", () => {
      expect(dashboardContent).toContain('data-testid="collapsed-sidebar-icon-rail"');
      expect(dashboardContent).toContain('w-[40px]');
      expect(dashboardContent).toContain('data-testid="button-toggle-right-sidebar"');
    });

    it("locks center chart canvas to flex-1 min-w-0 overflow-hidden so resizing is fluid without clipping", () => {
      expect(dashboardContent).toContain('flex-1 min-w-0 h-full flex flex-col border-r overflow-hidden');
      expect(dashboardContent).toContain('data-testid="column-center"');
    });
  });

  describe("2. Strict 1-Hour Candle Close Bounce Engine (Never Blindly Buying Forming Bar)", () => {
    // Candle fixtures for testing
    const baseCandles: CandleData[] = [
      { t: 1000, o: 100, h: 102, l: 99, c: 101 },
      { t: 1001, o: 101, h: 103, l: 100, c: 102 },
      { t: 1002, o: 102, h: 104, l: 101, c: 103 },
      { t: 1003, o: 103, h: 105, l: 102, c: 104 },
    ];

    it("strictly evaluates completed closed bar (candles.length - 2) and NEVER the forming live bar (candles.length - 1)", () => {
      // Forming live bar touches 20-SMA at 98.5, but last completed closed bar did not pull back to SMA
      const formingTouchCandles: CandleData[] = [
        ...baseCandles,
        { t: 1004, o: 104, h: 105, l: 103, c: 104 }, // closed bar (index 4) - extended above SMA (98.5)
        { t: 1005, o: 104, h: 104, l: 98.4, c: 98.8 }, // forming bar (index 5) - touching SMA live, unclosed
      ];

      const result = evaluateCandleSetupConfirmation({
        candles: formingTouchCandles,
        sma20: 98.5,
        livePrice: 98.8,
        setupStatus: "Forming",
      });

      // Forming bar touching SMA must NOT trigger confirmed buy
      expect(result.isBuyConfirmed).toBe(false);
      expect(result.isSetupReady).toBe(false);
      expect(result.statusText).toBe("[ PULLBACK FORMING - AWAITING 1H CLOSE ]");
      expect(result.countdownText).toContain("until close");
    });

    it("validates 3 strict rules on closed candle: support zone hold, hammer/rejection, and green close above SMA", () => {
      const confirmedCandles: CandleData[] = [
        ...baseCandles,
        // Closed bar (index 4): pulls into SMA (98.50), hammer lower wick rejection (l: 98.40, o: 99.20 -> wick: 0.80), closes green (c: 99.80 > o: 99.20) above SMA
        { t: 1004, o: 99.20, h: 100.10, l: 98.40, c: 99.80 },
        // Forming bar (index 5)
        { t: 1005, o: 99.80, h: 100.50, l: 99.70, c: 100.20 },
      ];

      const result = evaluateCandleSetupConfirmation({
        candles: confirmedCandles,
        sma20: 98.50,
        entryPrice: 99.80,
        livePrice: 100.20,
      });

      expect(result.supportZoneInteraction).toBe(true);
      expect(result.rejectionOrStructuralHold).toBe(true);
      expect(result.greenConfirmation).toBe(true);
      expect(result.isBuyConfirmed).toBe(true);
      expect(result.isSetupReady).toBe(true);
      expect(result.confirmedCandleIndex).toBe(4); // index of closed bar
      expect(result.statusText).toContain("[ BUY CONFIRMED - ENTER AT $99.80 ]");
    });

    it("invalidates setup if closed bar finishes red and breaches lower support", () => {
      const breachedCandles: CandleData[] = [
        ...baseCandles,
        // Closed bar: finishes red and falls below support (98.50) to 96.20
        { t: 1004, o: 98.50, h: 98.60, l: 96.00, c: 96.20 },
        // Forming bar
        { t: 1005, o: 96.20, h: 96.40, l: 95.80, c: 96.00 },
      ];

      const result = evaluateCandleSetupConfirmation({
        candles: breachedCandles,
        sma20: 98.50,
        livePrice: 96.00,
        supportZoneInteraction: false,
        rejectionOrStructuralHold: false,
        greenConfirmation: false,
      });

      expect(result.isBuyConfirmed).toBe(false);
      expect(result.isInvalidated).toBe(true);
      expect(result.statusText).toBe("[ SETUP INVALIDATED / WAITING ]");
    });

    it("renders dynamic 1H candle bounce status pill and buy confirmed marker on chart", () => {
      expect(dashboardContent).toContain('data-testid="badge-candle-bounce-status"');
      expect(dashboardContent).toContain('candleConfirmation.statusText');
      expect(dashboardContent).toContain('candleConfirmation.countdownText');
      expect(dashboardContent).toContain('data-testid="chart-marker-buy-confirmed"');
      expect(dashboardContent).toContain("BUY CONFIRMED:");
    });
  });

  describe("3. Conditional Level Visibility & Right-Sidebar Scanning Status Card", () => {
    it("conditionally wraps horizontal price lines so they are only mounted when setup is confirmed ready", () => {
      expect(dashboardContent).toContain("{isConfirmedSetup && (");
      expect(dashboardContent).toContain('data-testid="chart-line-entry"');
      expect(dashboardContent).toContain('data-testid="chart-line-stop"');
      expect(dashboardContent).toContain('data-testid="chart-line-t1"');
      expect(dashboardContent).toContain('data-testid="chart-line-t2"');
      expect(dashboardContent).toContain('data-testid="chart-line-t3"');
    });

    it("conditionally wraps right-hand Y-axis trade level pills while keeping live price badge always visible", () => {
      expect(dashboardContent).toContain('data-testid="chart-live-price-badge"');
      expect(dashboardContent).toContain('data-testid="chart-label-buy"');
      expect(dashboardContent).toContain('data-testid="chart-label-stop"');
      expect(dashboardContent).toContain('data-testid="chart-label-t1"');
      expect(dashboardContent).toContain('data-testid="chart-label-t2"');
      expect(dashboardContent).toContain('data-testid="chart-label-t3"');
    });

    it("renders scanning-status-card in right sidebar with dynamic proximity percentage when !isSetupReady", () => {
      expect(dashboardContent).toContain('data-testid="scanning-status-card"');
      expect(dashboardContent).toContain("Scanning for 20-SMA Pullback Setup...");
      expect(dashboardContent).toContain("Price currently extended +");
      expect(dashboardContent).toContain("% from support.");
      expect(dashboardContent).toContain("candleConfirmation.countdownText");
    });

    it("passes isSetupReady state cleanly from dashboard to LiveTradingChart", () => {
      expect(dashboardContent).toContain("isSetupReady={isSetupReady}");
      expect(dashboardContent).toContain("isSetupReady?: boolean");
      expect(dashboardContent).toContain("isSetupReady: isSetupReadyProp");
    });
  });
});
