import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const swingChartPath = path.resolve(
  __dirname,
  "../../client/src/components/swing/SwingChart.tsx"
);
const dashboardPath = path.resolve(
  __dirname,
  "../../client/src/pages/WealthEngineDashboard.tsx"
);

describe("Wealth Studio Layout Optimization - Native Y-Axis Binding, Sidebar Collapsibility, and UI De-cluttering", () => {
  const swingChartSrc = fs.readFileSync(swingChartPath, "utf-8");
  const dashboardSrc = fs.readFileSync(dashboardPath, "utf-8");

  describe("1. Fix Right-Side Overlap (Native Price Lines & Margin)", () => {
    it("uses native createPriceLine() API for ENTRY, STOP, HOD, and LOD in SwingChart.tsx", () => {
      expect(swingChartSrc).toContain("main.createPriceLine(");
      expect(swingChartSrc).toContain("axisLabelVisible: true");
      expect(swingChartSrc).toContain("title: l.key");
      expect(swingChartSrc).toContain("title: l.kind");
      expect(swingChartSrc).toContain('l.kind === "ENTRY"');
    });

    it("configures timeScale rightOffset: 12 in SwingChart.tsx so the live candle never touches the right Y-axis labels", () => {
      expect(swingChartSrc).toContain("rightOffset: 12");
      expect(swingChartSrc).toContain("chart.timeScale().applyOptions({ rightOffset: 12 })");
    });

    it("configures timeScale rightOffset: 12 (~15% margin) and native createPriceLine() Y-axis annotations in WealthEngineDashboard.tsx", () => {
      expect(dashboardSrc).toContain("rightOffset: 12");
      expect(dashboardSrc).toContain("rightMarginRatio: 0.15");
      expect(dashboardSrc).toContain("createPriceLine(");
      expect(dashboardSrc).toContain('data-testid="chart-label-buy"');
      expect(dashboardSrc).toContain('data-testid="chart-label-stop"');
      expect(dashboardSrc).toContain('data-testid="chart-label-hod"');
      expect(dashboardSrc).toContain('data-testid="chart-label-lod"');
    });

    it("leaves empty whitespace between the right-most live candle (x <= 530) and the right Y-axis scale (x = 710) in WealthEngineDashboard.tsx", () => {
      expect(dashboardSrc).toContain("spacing = 24;");
      expect(dashboardSrc).toContain("spacing = 29;");
      expect(dashboardSrc).toContain("translate(714,");
    });
  });

  describe("2. Streamline the Left-Hand Cockpit (Collapsible / Mini-Mode)", () => {
    it("implements a resizable drag-handle between the left sidebar and the main chart container", () => {
      expect(dashboardSrc).toContain('data-testid="sidebar-resizer-left"');
      expect(dashboardSrc).toContain("onMouseDown={startResizingLeft}");
      expect(dashboardSrc).toContain("onDoubleClick={toggleLeftSidebarCollapse}");
    });

    it("adds a [ < Collapse ] toggle button at the top of the left sidebar", () => {
      expect(dashboardSrc).toContain('data-testid="button-collapse-left-sidebar"');
      expect(dashboardSrc).toContain("onClick={toggleLeftSidebarCollapse}");
      expect(dashboardSrc).toContain('"[ < Collapse ]"');
    });

    it("transitions the left sidebar to a narrow 60px (w-[60px]) Mini-Mode showing only Ticker Symbol and colored status dot (Green for Ready, Yellow for Forming)", () => {
      expect(dashboardSrc).toContain("w-[60px]");
      expect(dashboardSrc).toContain('data-testid="left-sidebar-mini-mode"');
      expect(dashboardSrc).toContain("watchlist-mini-row-");
      expect(dashboardSrc).toContain("watchlist-status-dot-");
      expect(dashboardSrc).toContain('const isReadyStatus = item.status === "Ready"');
      expect(dashboardSrc).toContain(
        'const isFormingStatus = item.status === "Forming" || item.status === "Awaiting Close"'
      );
      expect(dashboardSrc).toContain("bg-emerald-400");
      expect(dashboardSrc).toContain("bg-amber-400");
    });
  });

  describe("3. Organize Chart Overlays (Actionable Tips & Consolidated Bottom Guides)", () => {
    it("pins the AI Actionable Tips box cleanly to the bottom-left corner with semi-transparent glassmorphic background (bg-gray-900/80 backdrop-blur)", () => {
      expect(swingChartSrc).toContain('data-testid="chart-ai-actionable-tips"');
      expect(swingChartSrc).toContain("bg-gray-900/80 backdrop-blur");
      expect(dashboardSrc).toContain('data-testid="chart-ai-actionable-tips"');
      expect(dashboardSrc).toContain("bottom-3 left-3");
      expect(dashboardSrc).toContain("bg-gray-900/80 backdrop-blur");
    });

    it("consolidates the 4H Guide and Signal Expired text strips into a single compact status bar footer below the chart", () => {
      expect(swingChartSrc).toContain('data-testid="chart-consolidated-status-footer"');
      expect(swingChartSrc).toContain('data-testid="text-tf-guide"');
      expect(swingChartSrc).toContain("<ExpiredExplainer d={d} />");
      expect(dashboardSrc).toContain('data-testid="chart-consolidated-status-footer"');
      expect(dashboardSrc).toContain('data-testid="text-tf-guide"');
      expect(dashboardSrc).toContain('data-testid="status-bar-signal-state"');
    });
  });

  describe("4. Code Cleanup & State Sync (Wipe & Redraw Price Lines on Timeframe Switch)", () => {
    it("wipes and redraws ENTRY and STOP price lines when switching timeframes (e.g., 1H to 4H) in SwingChart.tsx", () => {
      expect(swingChartSrc).toContain("wipeActivePriceLines");
      expect(swingChartSrc).toContain("series.removePriceLine(pl)");
      expect(swingChartSrc).toContain("wipeActivePriceLines(main)");
      expect(swingChartSrc).toContain("[symbol, tf, data,");
    });

    it("wipes and redraws ENTRY and STOP price lines when switching timeframes in WealthEngineDashboard.tsx", () => {
      expect(dashboardSrc).toContain("activePriceLinesRef.current = []");
      expect(dashboardSrc).toContain("title: `ENTRY $${buyPrice.toFixed(2)}`");
      expect(dashboardSrc).toContain("title: `STOP $${stopVal.toFixed(2)}`");
      expect(dashboardSrc).toContain("}, [symbol, timeframe]);");
    });
  });
});

