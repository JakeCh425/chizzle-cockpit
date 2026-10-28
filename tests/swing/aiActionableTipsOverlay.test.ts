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

describe("UI Refactor - Collapsible 'AI Actionable Tips' Overlay & Toggle Logic", () => {
  const swingChartSrc = fs.readFileSync(swingChartPath, "utf-8");
  const dashboardSrc = fs.readFileSync(dashboardPath, "utf-8");

  describe("1. State Management (Visibility Toggle)", () => {
    it("declares boolean isAITipsOpen state initialized to false in SwingChart.tsx", () => {
      expect(swingChartSrc).toContain("const [isAITipsOpen, setIsAITipsOpen] = useState(false);");
      expect(swingChartSrc).toContain("{isAITipsOpen && (");
    });

    it("declares boolean isAITipsOpen state initialized to false in WealthEngineDashboard.tsx", () => {
      expect(dashboardSrc).toContain("const [isAITipsOpen, setIsAITipsOpen] = useState(false);");
      expect(dashboardSrc).toContain("{isAITipsOpen && (");
    });
  });

  describe("2. On-Demand Trigger Button", () => {
    it("renders modern toggle button with sparkle icon and '💡 AI Tips' label on toolbar and FAB in SwingChart.tsx", () => {
      expect(swingChartSrc).toContain('data-testid="button-toggle-ai-tips"');
      expect(swingChartSrc).toContain('data-testid="fab-toggle-ai-tips"');
      expect(swingChartSrc).toContain("✨");
      expect(swingChartSrc).toContain("💡 AI Tips");
      expect(swingChartSrc).toContain("setIsAITipsOpen(true)");
    });

    it("renders modern toggle button with sparkle icon and '💡 AI Tips' label on toolbar and FAB in WealthEngineDashboard.tsx", () => {
      expect(dashboardSrc).toContain('data-testid="button-toggle-ai-tips"');
      expect(dashboardSrc).toContain('data-testid="fab-toggle-ai-tips"');
      expect(dashboardSrc).toContain("✨");
      expect(dashboardSrc).toContain("💡 AI Tips");
      expect(dashboardSrc).toContain("setIsAITipsOpen(true)");
    });
  });

  describe("3. Relocate and Restructure the Tips Box", () => {
    it("anchors the tips box strictly to the far right edge (absolute top-16 right-4 z-50) in SwingChart.tsx", () => {
      expect(swingChartSrc).toContain("absolute top-16 right-4 z-50");
      expect(swingChartSrc).toContain(
        "bg-gray-950/85 backdrop-blur-md border border-cyan-900/50 shadow-2xl rounded-xl"
      );
      expect(swingChartSrc).toContain("w-80");
    });

    it("anchors the tips box strictly to the far right edge (absolute top-16 right-4 z-50) in WealthEngineDashboard.tsx", () => {
      expect(dashboardSrc).toContain("absolute top-16 right-4 z-50");
      expect(dashboardSrc).toContain(
        "bg-gray-950/85 backdrop-blur-md border border-cyan-900/50 shadow-2xl rounded-xl"
      );
      expect(dashboardSrc).toContain("w-80");
    });
  });

  describe("4. Implement the Dismiss/Exit Action", () => {
    it("provides a clean [ X ] button aligned to the far right triggering setIsAITipsOpen(false) in SwingChart.tsx", () => {
      expect(swingChartSrc).toContain('data-testid="button-close-ai-tips"');
      expect(swingChartSrc).toContain("onClick={() => setIsAITipsOpen(false)}");
      expect(swingChartSrc).toContain("[ X ]");
    });

    it("provides a clean [ X ] button aligned to the far right triggering setIsAITipsOpen(false) in WealthEngineDashboard.tsx", () => {
      expect(dashboardSrc).toContain('data-testid="button-close-ai-tips"');
      expect(dashboardSrc).toContain("onClick={() => setIsAITipsOpen(false)}");
      expect(dashboardSrc).toContain("[ X ]");
    });
  });
});

