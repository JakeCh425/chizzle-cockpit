import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Mini-Chart Interactions & Quick-Action Arm Trade", () => {
  const tradingCardPath = path.resolve(__dirname, "../../client/src/components/swing/TradingCard.tsx");
  const tradingCardContent = fs.readFileSync(tradingCardPath, "utf-8").replace(/\r\n/g, "\n");

  describe("Task 1: Fix Stuck Labels & Crosshair on the Mini-Chart", () => {
    it("imports CrosshairMode, IPriceLine, and MouseEventParams from lightweight-charts", () => {
      expect(tradingCardContent).toContain("CrosshairMode");
      expect(tradingCardContent).toContain("IPriceLine");
      expect(tradingCardContent).toContain("MouseEventParams");
    });

    it("configures CrosshairMode.Normal and dashed crosshair lines", () => {
      expect(tradingCardContent).toContain("mode: CrosshairMode.Normal");
      expect(tradingCardContent).toContain("style: LineStyle.Dashed");
    });

    it("resets crosshair and hides tooltip when mouse leaves chart bounds", () => {
      expect(tradingCardContent).toContain("chart.clearCrosshairPosition()");
      expect(tradingCardContent).toContain("setTooltip(null)");
      expect(tradingCardContent).toContain("param.point.x > el.clientWidth");
    });

    it("clears crosshair and tooltip on container mouseleave event", () => {
      expect(tradingCardContent).toContain('el.addEventListener("mouseleave"');
      expect(tradingCardContent).toContain('el.removeEventListener("mouseleave"');
    });

    it("initializes Buy and Stop price lines with axisLabelVisible: false to prevent axis clutter", () => {
      expect(tradingCardContent).toContain('axisLabelVisible: false,\n          title: "Buy"');
      expect(tradingCardContent).toContain('axisLabelVisible: false,\n          title: "Stop"');
    });

    it("dynamically reveals Buy/Stop axis labels on mouseenter and hides on mouseleave", () => {
      expect(tradingCardContent).toContain('buyLine?.applyOptions({ axisLabelVisible: true');
      expect(tradingCardContent).toContain('stopLine?.applyOptions({ axisLabelVisible: true');
      expect(tradingCardContent).toContain('buyLine?.applyOptions({ axisLabelVisible: false');
      expect(tradingCardContent).toContain('stopLine?.applyOptions({ axisLabelVisible: false');
    });
  });

  describe("Task 2: Enable Easy Zooming & Panning", () => {
    it("enables mouseWheel and pinch scaling on the mini-chart", () => {
      expect(tradingCardContent).toContain("handleScale: {");
      expect(tradingCardContent).toContain("mouseWheel: true,");
      expect(tradingCardContent).toContain("pinch: true,");
    });

    it("enables mouseWheel and pressedMouseMove scrolling/panning on the mini-chart", () => {
      expect(tradingCardContent).toContain("handleScroll: {");
      expect(tradingCardContent).toContain("pressedMouseMove: true,");
    });

    it("adds a double-click listener to reset zoom/scale with chart.timeScale().fitContent()", () => {
      expect(tradingCardContent).toContain('el.addEventListener("dblclick", handleDblClick)');
      expect(tradingCardContent).toContain("chart.timeScale().fitContent()");
      expect(tradingCardContent).toContain('el.removeEventListener("dblclick", handleDblClick)');
    });
  });

  describe("Task 3: Add 'Arm Trade' Quick-Action Button", () => {
    it("renders the 'Arm Trade' button in InlineTradingCard footer when group is READY", () => {
      expect(tradingCardContent).toContain('{group === "READY" && (');
      expect(tradingCardContent).toContain('data-testid={`button-arm-trade-${d.symbol}`}');
      expect(tradingCardContent).toContain("Arm Trade");
    });

    it("styles the Arm Trade button with green theme accent, border, and Crosshair icon", () => {
      expect(tradingCardContent).toContain("border-signal-green/50 bg-signal-green/10");
      expect(tradingCardContent).toContain("text-signal-green");
      expect(tradingCardContent).toContain("<Crosshair className=");
    });

    it("invokes openTradeDialog with mode: 'arm' when clicked", () => {
      expect(tradingCardContent).toContain('mode: "arm",');
      expect(tradingCardContent).toContain("openTradeDialog({");
      expect(tradingCardContent).toContain("decision: d,");
      expect(tradingCardContent).toContain("plan: effectivePlan(d, ver),");
    });
  });
});

