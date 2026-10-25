import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("UI Hierarchy (Prominent Ticker/Live Price) & Fidelity Execution Guide", () => {
  const dashboardPath = path.resolve(__dirname, "../../client/src/pages/WealthEngineDashboard.tsx");
  const dashboardContent = fs.readFileSync(dashboardPath, "utf-8").replace(/\r\n/g, "\n");

  const cheatSheetPath = path.resolve(__dirname, "../../client/src/components/FidelityExecutionCheatSheet.tsx");
  const cheatSheetContent = fs.readFileSync(cheatSheetPath, "utf-8").replace(/\r\n/g, "\n");

  const guidePath = path.resolve(__dirname, "../../client/src/components/FidelityExecutionGuide.tsx");
  const guideContent = fs.readFileSync(guidePath, "utf-8").replace(/\r\n/g, "\n");

  const swingChartPath = path.resolve(__dirname, "../../client/src/components/swing/SwingChart.tsx");
  const swingChartContent = fs.readFileSync(swingChartPath, "utf-8").replace(/\r\n/g, "\n");

  const modalChartPath = path.resolve(__dirname, "../../client/src/components/swing/ModalLargeChart.tsx");
  const modalChartContent = fs.readFileSync(modalChartPath, "utf-8").replace(/\r\n/g, "\n");

  const tradingCardPath = path.resolve(__dirname, "../../client/src/components/swing/TradingCard.tsx");
  const tradingCardContent = fs.readFileSync(tradingCardPath, "utf-8").replace(/\r\n/g, "\n");

  describe("1. Multi-Timeframe Learning Chart Header Replacement", () => {
    it("removes the small right-aligned LiveTickerCornerBadge price pill from the main chart header", () => {
      // LiveTickerCornerBadge must not be inside the header row
      const headerSection = swingChartContent.slice(
        swingChartContent.indexOf('data-testid="swing-chart-header"'),
        swingChartContent.indexOf('data-testid="swing-context-chips"')
      );
      expect(headerSection).not.toContain("<LiveTickerCornerBadge");
    });

    it("injects a massive, bold header at top-left with text-5xl font-extrabold tracking-tight ticker", () => {
      expect(swingChartContent).toContain('className="flex flex-col mb-4"');
      expect(swingChartContent).toContain('data-testid="swing-chart-header"');
      expect(swingChartContent).toContain('text-5xl font-extrabold tracking-tight text-white');
      expect(swingChartContent).toContain('data-testid="swing-chart-ticker"');
    });

    it("dynamically sets the price text color to text-green-500 (up) or text-red-500 (down)", () => {
      expect(swingChartContent).toContain("priceChange >= 0 ? \"text-green-500\" : \"text-red-500\"");
      expect(swingChartContent).toContain('data-testid="swing-chart-price"');
    });

    it("renders the priceChangePercent in text-xl text-gray-400", () => {
      expect(swingChartContent).toContain('text-xl text-gray-400');
      expect(swingChartContent).toContain('data-testid="swing-chart-pct"');
    });

    it("places the dense data source string (RTH src twelvedata...) below the giant price in text-sm text-gray-500", () => {
      expect(swingChartContent).toContain('className="text-sm text-gray-500 flex flex-wrap items-center gap-2 font-mono mt-1"');
      expect(swingChartContent).toContain('data-testid="swing-chart-dense-meta"');
      expect(swingChartContent).toContain("TF_LABEL[tf]");
      expect(swingChartContent).toContain("src {b?.source");
    });

    it("provides prominent button labeled [View Fidelity Ticket] to toggle the cheat sheet", () => {
      expect(swingChartContent).toContain('data-testid="button-view-fidelity-ticket"');
      expect(swingChartContent).toContain("[View Fidelity Ticket]");
      expect(swingChartContent).toContain("setIsFidelityGuideOpen");
    });
  });

  describe("2. FidelityExecutionGuide Component Template & Props Binding", () => {
    it("strictly renders 📋 FIDELITY EXECUTION GUIDE header", () => {
      expect(guideContent).toContain("📋");
      expect(guideContent).toContain("FIDELITY EXECUTION GUIDE");
    });

    it("renders STEP 1: The Entry with BUY, 100% of planned position, LIMIT, ${entryPriceState}, and TIF: Day", () => {
      expect(guideContent).toContain("STEP 1: The Entry");
      expect(guideContent).toContain("(Use a Standard Trade Ticket)");
      expect(guideContent).toContain("Action:");
      expect(guideContent).toContain("BUY");
      expect(guideContent).toContain("100% of planned position");
      expect(guideContent).toContain("Order Type:");
      expect(guideContent).toContain("LIMIT");
      expect(guideContent).toContain("Limit Price:");
      expect(guideContent).toContain("{entryPriceState}");
      expect(guideContent).toContain("TIF:");
      expect(guideContent).toContain("Day");
    });

    it("renders STEP 2: The Protection & Scale-Out with OCO Conditional Ticket instructions", () => {
      expect(guideContent).toContain("STEP 2: The Protection &amp; Scale-Out (Do this immediately after Entry fills)");
      expect(guideContent).toContain("(Use a Conditional Ticket -> OCO / One Cancels the Other)");
    });

    it("renders Order 1 (Lock in 1.5R Profit) with SELL, 50% of shares, LIMIT, and ${target1State}", () => {
      expect(guideContent).toContain("Order 1 (Lock in 1.5R Profit):");
      expect(guideContent).toContain("Action:");
      expect(guideContent).toContain("SELL");
      expect(guideContent).toContain("50% of shares");
      expect(guideContent).toContain("Order Type:");
      expect(guideContent).toContain("LIMIT");
      expect(guideContent).toContain("Limit Price:");
      expect(guideContent).toContain("{target1State}");
    });

    it("renders Order 2 (Initial Stop Loss) with SELL, 100% of shares, STOP, and ${stopLossState}", () => {
      expect(guideContent).toContain("Order 2 (Initial Stop Loss):");
      expect(guideContent).toContain("Action:");
      expect(guideContent).toContain("SELL");
      expect(guideContent).toContain("100% of shares");
      expect(guideContent).toContain("Order Type:");
      expect(guideContent).toContain("STOP");
      expect(guideContent).toContain("Stop Price:");
      expect(guideContent).toContain("{stopLossState}");
    });

    it("renders STEP 3: The Adjustment with Action 1 (Cancel Initial Stop) and Action 2 (Break-Even Stop at ${entryPriceState})", () => {
      expect(guideContent).toContain("STEP 3: The Adjustment (Do this the MOMENT Target 1 fills)");
      expect(guideContent).toContain("(Log into Fidelity to adjust your risk)");
      expect(guideContent).toContain("CANCEL the remaining initial Stop Loss order.");
      expect(guideContent).toContain("Action 2: Create a NEW Standard Trade Ticket.");
      expect(guideContent).toContain("Remaining 50% of shares");
      expect(guideContent).toContain("STOP (Break-Even)");
      expect(guideContent).toContain("(Your original entry price)");
      expect(guideContent).toContain("{entryPriceState}");
    });

    it("renders STEP 4: The Core Target (Target 2) with ${target2State} and trailing stop guidance", () => {
      expect(guideContent).toContain("STEP 4: The Core Target (Target 2)");
      expect(guideContent).toContain("(Set your final limit order)");
      expect(guideContent).toContain("Remaining 50% of shares");
      expect(guideContent).toContain("LIMIT");
      expect(guideContent).toContain("{target2State}");
      expect(guideContent).toContain("(Alternatively, trail your stop loss up beneath the 1H 20-SMA)");
    });

    it("mounts FidelityExecutionGuide in SwingChart passing entryPrice, target1, target2, and stopLoss props", () => {
      expect(swingChartContent).toContain("<FidelityExecutionGuide");
      expect(swingChartContent).toContain("isOpen={isFidelityGuideOpen}");
      expect(swingChartContent).toContain("entryPrice={effectiveEntry}");
      expect(swingChartContent).toContain("target1={effectiveTarget1}");
      expect(swingChartContent).toContain("target2={effectiveTarget2}");
      expect(swingChartContent).toContain("stopLoss={effectiveStop}");
    });
  });

  describe("3. Dual Integration: Dashboard Column 3 Collapsible & Modal Triggers", () => {
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

    it("provides Fidelity Guide button on the main studio chart header to open modal", () => {
      expect(dashboardContent).toContain('data-testid="button-fidelity-guide"');
      expect(dashboardContent).toContain("Fidelity Guide");
    });

    it("provides Fidelity Guide button and modal dialog in ModalLargeChart", () => {
      expect(modalChartContent).toContain('data-testid="button-fidelity-guide-modal"');
      expect(modalChartContent).toContain("<FidelityExecutionCheatSheet");
      expect(modalChartContent).toContain("isOpenModal={isFidelityGuideOpen}");
    });
  });

  describe("4. UI Refinements: Overflow Scrollbar, Mini-Guide, & Collapsible Setup Cards", () => {
    it("enables vertical scrolling with custom-scrollbar, max-h-[80vh], and sticky header on FidelityExecutionGuide", () => {
      expect(guideContent).toContain("max-h-[80vh]");
      expect(guideContent).toContain("overflow-y-auto");
      expect(guideContent).toContain("custom-scrollbar");
      expect(guideContent).toContain("pointer-events-auto");
      expect(guideContent).toContain("sticky top-0 z-50 bg-slate-950 border-b");
    });

    it("ensures the parent container in SwingChart does not apply overflow-hidden to cut off the modal", () => {
      expect(swingChartContent).toContain('data-testid="swing-chart-stage-container"');
      const stageTag = swingChartContent.slice(
        swingChartContent.indexOf('<div className="relative" data-testid="swing-chart-stage-container">'),
        swingChartContent.indexOf('data-testid="swing-chart-stage-container">') + 'data-testid="swing-chart-stage-container">'.length
      );
      expect(stageTag).not.toContain("overflow-hidden");
    });

    it("renders Quick View mini-guide button and inline broker ticket in InlineTradingCard", () => {
      expect(tradingCardContent).toContain('data-testid={`button-mini-guide-${d.symbol}`}');
      expect(tradingCardContent).toContain("[Fidelity Ticket]");
      expect(tradingCardContent).toContain('data-testid={`mini-fidelity-guide-${d.symbol}`}');
      expect(tradingCardContent).toContain("BUY LIMIT:");
      expect(tradingCardContent).toContain("SELL LIMIT (50%):");
      expect(tradingCardContent).toContain("SELL STOP:");
    });

    it("keeps core metrics always visible and wraps card details in collapsible container with accordion toggle", () => {
      expect(tradingCardContent).toContain('data-testid={`core-metrics-${d.symbol}`}');
      expect(tradingCardContent).toContain('data-testid={`button-toggle-card-collapse-${d.symbol}`}');
      expect(tradingCardContent).toContain('data-testid={`card-collapsible-body-${d.symbol}`}');
      expect(tradingCardContent).toContain("const [isBodyExpanded, setIsBodyExpanded] = useState(true);");
    });

    it("implements Quick View Broker Guide and collapsible body on Studio Setup Card in WealthEngineDashboard", () => {
      const refreshedDashboardContent = fs.readFileSync(dashboardPath, "utf-8").replace(/\r\n/g, "\n");
      expect(refreshedDashboardContent).toContain('data-testid="button-studio-mini-guide"');
      expect(refreshedDashboardContent).toContain("[Broker Guide]");
      expect(refreshedDashboardContent).toContain('data-testid="studio-mini-fidelity-guide"');
      expect(refreshedDashboardContent).toContain('data-testid="button-toggle-setup-card-collapse"');
      expect(refreshedDashboardContent).toContain('data-testid="studio-setup-card-body"');
      expect(refreshedDashboardContent).toContain("const [isStudioSetupCardExpanded, setIsStudioSetupCardExpanded] = useState(true);");
    });
  });
});
