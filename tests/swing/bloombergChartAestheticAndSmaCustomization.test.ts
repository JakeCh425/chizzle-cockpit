import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  DEFAULT_SMA_SETTINGS,
  loadSmaSettings,
  saveSmaSettings,
  STORAGE_KEY_SMA,
} from "../../client/src/lib/smaSettings";

describe("Bloomberg Terminal Chart Aesthetic & Complete SMA Customization", () => {
  const dashboardPath = path.resolve(__dirname, "../../client/src/pages/WealthEngineDashboard.tsx");
  const dashboardContent = fs.readFileSync(dashboardPath, "utf-8").replace(/\r\n/g, "\n");

  const popoverPath = path.resolve(__dirname, "../../client/src/components/SmaSettingsPopover.tsx");
  const popoverContent = fs.readFileSync(popoverPath, "utf-8").replace(/\r\n/g, "\n");

  describe("1. Y-Axis Overlap & Auto-Fading Labels", () => {
    it("wraps floating price labels in a container with data-testid='chart-floating-price-labels'", () => {
      expect(dashboardContent).toContain('data-testid="chart-overlay-layer chart-floating-price-labels"');
    });

    it("drops label opacity to 15% when mouse hovers right quadrant or labels container directly", () => {
      expect(dashboardContent).toContain("isRightQuadrantHovered || isLabelsHovered ? 0.15 : 1");
      expect(dashboardContent).toContain("transition: \"opacity 300ms ease-in-out\"");
    });

    it("attaches onMouseEnter and onMouseLeave handlers to labels container", () => {
      expect(dashboardContent).toContain("onMouseEnter={() => setIsLabelsHovered(true)}");
      expect(dashboardContent).toContain("onMouseLeave={() => setIsLabelsHovered(false)}");
    });

    it("applies hover fading to target, stop loss, and live price tracking lines", () => {
      expect(dashboardContent).toContain("isRightQuadrantHovered || isLabelsHovered ? 0.15 : 0.35");
      expect(dashboardContent).toContain("data-testid=\"chart-line-entry\"");
      expect(dashboardContent).toContain("data-testid=\"chart-line-stop\"");
      expect(dashboardContent).toContain("data-testid=\"chart-line-t1\"");
    });
  });

  describe("2. Bloomberg Terminal Chart Aesthetic", () => {
    it("applies pure deep black (#000000) canvas background", () => {
      expect(dashboardContent).toContain('style={{ backgroundColor: "#000000" }}');
      expect(dashboardContent).toContain('<rect x="0" y="0" width="800" height="420" fill="#000000" />');
    });

    it("renders thin dotted grid lines with 5% white opacity", () => {
      expect(dashboardContent).toContain('stroke="rgba(255,255,255,0.05)" strokeDasharray="2 4"');
    });

    it("uses borderless terminal neon green (#00FF00) and neon red (#FF0000) candlesticks", () => {
      expect(dashboardContent).toContain('const bodyColor = isUp ? "#00FF00" : "#FF0000";');
      expect(dashboardContent).toContain('stroke={isHollow ? bodyColor : "none"}');
    });

    it("enforces monospace typography on all price scales and labels", () => {
      expect(dashboardContent).toContain('fontFamily="monospace"');
      expect(dashboardContent).toContain('font-mono');
    });
  });

  describe("3. SMA Customization Menu (20, 50, 200)", () => {
    it("renders [ ⚙️ SMA Settings ] button with data-testid='button-sma-settings'", () => {
      expect(popoverContent).toContain('data-testid="button-sma-settings"');
      expect(popoverContent).toContain("[ ⚙️ SMA Settings ]");
    });

    it("provides color pickers for SMA 20, 50, 200, and 10", () => {
      expect(popoverContent).toContain('data-testid="sma-color-20"');
      expect(popoverContent).toContain('data-testid="sma-color-50"');
      expect(popoverContent).toContain('data-testid="sma-color-200"');
      expect(popoverContent).toContain('data-testid="sma-color-10"');
    });

    it("provides thickness sliders (1-4) for SMA lines", () => {
      expect(popoverContent).toContain('data-testid="sma-width-20"');
      expect(popoverContent).toContain('data-testid="sma-width-50"');
      expect(popoverContent).toContain('data-testid="sma-width-200"');
      expect(popoverContent).toContain('min="1"');
      expect(popoverContent).toContain('max="4"');
    });

    it("persists SMA settings to localStorage under 'chizzle-sma-settings'", () => {
      expect(STORAGE_KEY_SMA).toBe("chizzle-sma-settings");
      expect(popoverContent).toContain("saveSmaSettings");
    });

    it("maintains a decoupled buffer of at least 200 bars for continuous SMA calculation", () => {
      expect(dashboardContent).toContain("fullBufferCloses");
      expect(dashboardContent).toContain("rawCloses.length >= 220");
      expect(dashboardContent).toContain("data-testid=\"chart-path-sma200\"");
    });
  });

  describe("4. Visual 'Ready to Trade' Execution Zones", () => {
    it("calculates pullback within 0.5% of SMA 20", () => {
      expect(dashboardContent).toContain("isPullbackTo20Sma");
      expect(dashboardContent).toContain("Math.abs(livePrice - latestSma20) / latestSma20 <= 0.005");
    });

    it("calculates profit-taking sell zone when price crosses targets", () => {
      expect(dashboardContent).toContain("isInSellZone");
      expect(dashboardContent).toContain("(targetVal > 0 && livePrice >= targetVal) || (t2Price > 0 && livePrice >= t2Price)");
    });

    it("renders radial gradient background highlights for buy and sell zones", () => {
      expect(dashboardContent).toContain('id="buyZoneGlow"');
      expect(dashboardContent).toContain('id="sellZoneGlow"');
      expect(dashboardContent).toContain('data-testid="chart-buy-zone-highlight"');
      expect(dashboardContent).toContain('data-testid="chart-sell-zone-highlight"');
    });

    it("displays prominent HUD badges in execution zone container", () => {
      expect(dashboardContent).toContain('data-testid="chart-execution-zone-highlight"');
      expect(dashboardContent).toContain('data-testid="badge-ready-to-buy-zone"');
      expect(dashboardContent).toContain("[ READY TO BUY · 20-SMA ZONE ]");
      expect(dashboardContent).toContain('data-testid="badge-profit-taking-zone"');
      expect(dashboardContent).toContain("[ PROFIT TAKING · TARGET ZONE ]");
    });
  });
});
