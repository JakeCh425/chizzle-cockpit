import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("UI Hierarchy (Prominent Ticker/Live Price) & Fidelity Execution Cheat Sheet", () => {
  const dashboardPath = path.resolve(__dirname, "../../client/src/pages/WealthEngineDashboard.tsx");
  const dashboardContent = fs.readFileSync(dashboardPath, "utf-8").replace(/\r\n/g, "\n");

  const cheatSheetPath = path.resolve(__dirname, "../../client/src/components/FidelityExecutionCheatSheet.tsx");
  const cheatSheetContent = fs.readFileSync(cheatSheetPath, "utf-8").replace(/\r\n/g, "\n");

  const modalChartPath = path.resolve(__dirname, "../../client/src/components/swing/ModalLargeChart.tsx");
  const modalChartContent = fs.readFileSync(modalChartPath, "utf-8").replace(/\r\n/g, "\n");

  describe("1. Prominent Ticker & Live Price Header", () => {
    it("decouples ticker and live price into a massive top-left header with text-4xl/text-5xl font-black tracking-tight", () => {
      // Main studio chart header
      expect(dashboardContent).toContain('data-testid="chart-live-price-header"');
      expect(dashboardContent).toContain('data-testid="chart-live-price-value"');
      expect(dashboardContent).toContain("text-4xl md:text-5xl");
      expect(dashboardContent).toContain("font-black");
      expect(dashboardContent).toContain("tracking-tight");

      // Modal large chart header
      expect(modalChartContent).toContain('data-testid="modal-chart-live-price"');
      expect(modalChartContent).toContain("text-3xl md:text-5xl font-black");
    });

    it("dynamically changes price color between emerald (up) and rose (down)", () => {
      // LiveTradingChart in WealthEngineDashboard
      expect(dashboardContent).toContain("text-emerald-400 drop-shadow-[0_0_14px_rgba(52,211,153,0.5)]");
      expect(dashboardContent).toContain("text-rose-400 drop-shadow-[0_0_14px_rgba(244,63,94,0.5)]");

      // ModalLargeChart
      expect(modalChartContent).toContain("text-emerald-400 drop-shadow-[0_0_15px_rgba(52,211,153,0.5)]");
      expect(modalChartContent).toContain("text-rose-400 drop-shadow-[0_0_15px_rgba(244,63,94,0.5)]");
    });

    it("pulses slightly with scale-105 brightness-125 when a new live WebSocket tick arrives", () => {
      // LiveTradingChart tick pulse state & effect
      expect(dashboardContent).toContain("isTickPulsing");
      expect(dashboardContent).toContain("isTickPulsing ? \"scale-105 brightness-125\" : \"scale-100\"");

      // ModalLargeChart tick pulse state & effect
      expect(modalChartContent).toContain("isTickPulsing");
      expect(modalChartContent).toContain("scale-105 brightness-125");
    });
  });

  describe("2. Fidelity Trade Ticket Cheat Sheet Template & Steps", () => {
    it("renders the exact Fidelity Execution Guide title and header", () => {
      expect(cheatSheetContent).toContain("📋 Fidelity Execution Guide");
      expect(cheatSheetContent).toContain("Exact trade ticket & conditional bracket inputs");
    });

    it("renders STEP 1: The Entry Order with BUY action, full quantity, LIMIT order type, and Day TIF", () => {
      expect(cheatSheetContent).toContain('data-testid="fidelity-step-1"');
      expect(cheatSheetContent).toContain("The Entry Order");
      expect(cheatSheetContent).toContain("Action:");
      expect(cheatSheetContent).toContain("BUY");
      expect(cheatSheetContent).toContain("Quantity:");
      expect(cheatSheetContent).toContain("Order Type:");
      expect(cheatSheetContent).toContain("LIMIT");
      expect(cheatSheetContent).toContain("Limit Price:");
      expect(cheatSheetContent).toContain("TIF:");
      expect(cheatSheetContent).toContain("Day");
    });

    it("renders STEP 2: The Scale-Out with OCO Conditional Ticket instructions", () => {
      expect(cheatSheetContent).toContain('data-testid="fidelity-step-2"');
      expect(cheatSheetContent).toContain("The Scale-Out (Once Entry Fills)");
      expect(cheatSheetContent).toContain("Open a Conditional Ticket");
      expect(cheatSheetContent).toContain("Select 'OCO' (One Cancels the Other)");
    });

    it("renders Order 1 (Take 1.5R Profit) with SELL action, 50% shares, LIMIT type, and Target 1 price", () => {
      expect(cheatSheetContent).toContain("Order 1 (Take 1.5R Profit)");
      expect(cheatSheetContent).toContain("SELL");
      expect(cheatSheetContent).toContain("50%");
      expect(cheatSheetContent).toContain("LIMIT");
      expect(cheatSheetContent).toContain("${target1.toFixed(2)}");
    });

    it("renders Order 2 (Protect with Stop Loss) with SELL action, 100% shares, STOP type, and Stop Loss price", () => {
      expect(cheatSheetContent).toContain("Order 2 (Protect with Stop Loss)");
      expect(cheatSheetContent).toContain("SELL");
      expect(cheatSheetContent).toContain("100%");
      expect(cheatSheetContent).toContain("STOP");
      expect(cheatSheetContent).toContain("${stop.toFixed(2)}");
    });

    it("renders the critical trade management reminder banner for manual stop adjustment to break-even", () => {
      expect(cheatSheetContent).toContain('data-testid="fidelity-reminder-banner"');
      expect(cheatSheetContent).toContain("⚠️ REMINDER: Active Stop Management Required");
      expect(cheatSheetContent).toContain(
        "The moment Order 1 (Target) fills, you must manually go into Fidelity and cancel the remaining Stop order, then create a new Stop order at"
      );
      expect(cheatSheetContent).toContain("Break-Even");
    });

    it("provides one-click copy buttons for entry quantity, entry price, target 1 quantity & price, and stop quantity & price", () => {
      expect(cheatSheetContent).toContain('data-testid="copy-entry-qty"');
      expect(cheatSheetContent).toContain('data-testid="copy-entry-price"');
      expect(cheatSheetContent).toContain('data-testid="copy-target1-qty"');
      expect(cheatSheetContent).toContain('data-testid="copy-target1-price"');
      expect(cheatSheetContent).toContain('data-testid="copy-stop-qty"');
      expect(cheatSheetContent).toContain('data-testid="copy-stop-price"');
      expect(cheatSheetContent).toContain("navigator.clipboard?.writeText");
    });
  });

  describe("3. Dual Integration: Dashboard Column 3 Collapsible & Modal Trigger", () => {
    it("integrates FidelityExecutionCheatSheet as an inline collapsible card in Dashboard Column 3", () => {
      expect(cheatSheetContent).toContain('data-testid="fidelity-execution-cheat-sheet"');
      expect(dashboardContent).toContain("<FidelityExecutionCheatSheet");
      expect(dashboardContent).toContain("isCollapsible");
      expect(dashboardContent).toContain("defaultCollapsed={false}");
    });

    it("provides quick action trigger button 'Fidelity Ticket Cheat Sheet' inside Setup Card", () => {
      expect(dashboardContent).toContain('data-testid="button-fidelity-ticket-card"');
      expect(dashboardContent).toContain("setIsFidelityGuideOpen(true)");
    });

    it("provides Fidelity Guide button on the main chart header to open full-screen modal", () => {
      expect(dashboardContent).toContain('data-testid="button-fidelity-guide"');
      expect(dashboardContent).toContain("Fidelity Guide");
    });

    it("provides Fidelity Guide button and modal dialog in ModalLargeChart", () => {
      expect(modalChartContent).toContain('data-testid="button-fidelity-guide-modal"');
      expect(modalChartContent).toContain("<FidelityExecutionCheatSheet");
      expect(modalChartContent).toContain("isOpenModal={isFidelityGuideOpen}");
    });
  });
});

