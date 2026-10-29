import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { debounce } from "../../client/src/lib/debounce";

const fundingPanelPath = path.resolve(__dirname, "../../client/src/components/swing/FundingPanel.tsx");
const tradingCardPath = path.resolve(__dirname, "../../client/src/components/swing/TradingCard.tsx");
const dashboardPath = path.resolve(__dirname, "../../client/src/pages/WealthEngineDashboard.tsx");
const activeSetupsPath = path.resolve(__dirname, "../../client/src/components/ActiveSetupsPanel.tsx");
const queryClientPath = path.resolve(__dirname, "../../client/src/lib/queryClient.ts");

describe("Fix Infinite Loading State on Trade Setup Save Buttons & Make Setup Card Clickable", () => {
  const fundingPanelSrc = fs.readFileSync(fundingPanelPath, "utf-8").replace(/\r\n/g, "\n");
  const tradingCardSrc = fs.readFileSync(tradingCardPath, "utf-8").replace(/\r\n/g, "\n");
  const dashboardSrc = fs.readFileSync(dashboardPath, "utf-8").replace(/\r\n/g, "\n");
  const activeSetupsSrc = fs.readFileSync(activeSetupsPath, "utf-8").replace(/\r\n/g, "\n");
  const queryClientSrc = fs.readFileSync(queryClientPath, "utf-8").replace(/\r\n/g, "\n");

  describe("1. Async State Management & The 'finally' Block", () => {
    it("wraps handleSave in FundingPanel.tsx in a strict try/catch/finally resetting setIsSaving(false)", () => {
      expect(fundingPanelSrc).toContain("const [isSaving, setIsSaving] = useState(false);");
      expect(fundingPanelSrc).toContain("setIsSaving(true);");
      expect(fundingPanelSrc).toContain("try {");
      expect(fundingPanelSrc).toContain("await saveTradeConfig({ funding: next }, 5000);");
      expect(fundingPanelSrc).toContain("} catch (error: any) {");
      expect(fundingPanelSrc).toContain("} finally {");
      expect(fundingPanelSrc).toContain("setIsSaving(false); // MUST execute regardless of success or failure");
    });

    it("ensures ActiveSetupsPanel save handler wraps mutateAsync in try/catch/finally resetting isSaving", () => {
      expect(activeSetupsSrc).toContain("const [isSaving, setIsSaving] = useState(false);");
      expect(activeSetupsSrc).toContain("setIsSaving(true);");
      expect(activeSetupsSrc).toContain("await createMut.mutateAsync(draft);");
      expect(activeSetupsSrc).toContain("} finally {");
      expect(activeSetupsSrc).toContain("setIsSaving(false); // MUST execute regardless of success or failure");
    });
  });

  describe("2. Implement API Timeout Limits", () => {
    it("exports saveTradeConfig with 5000ms AbortController timeout limit", () => {
      expect(fundingPanelSrc).toContain("export async function saveTradeConfig(");
      expect(fundingPanelSrc).toContain("timeoutMs = 5000");
      expect(fundingPanelSrc).toContain("const controller = new AbortController();");
      expect(fundingPanelSrc).toContain("setTimeout(() => {");
      expect(fundingPanelSrc).toContain("controller.abort(");
      expect(fundingPanelSrc).toContain("clearTimeout(timeoutId);");
    });

    it("enforces timeout logic on apiRequest in queryClient.ts", () => {
      expect(queryClientSrc).toContain("const controller = new AbortController();");
      expect(queryClientSrc).toContain("const timeoutId = setTimeout(() => {");
      expect(queryClientSrc).toContain("controller.abort(");
      expect(queryClientSrc).toContain("clearTimeout(timeoutId);");
    });
  });

  describe("3. Debounce Auto-Saves (500ms delay)", () => {
    it("provides a debounce utility with cancellation", () => {
      vi.useFakeTimers();
      const fn = vi.fn();
      const debounced = debounce(fn, 500);

      debounced("call 1");
      debounced("call 2");
      debounced("call 3");

      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(499);
      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith("call 3");

      vi.useRealTimers();
    });

    it("integrates debouncedAutoSave with 500ms delay in FundingPanel.tsx", () => {
      expect(fundingPanelSrc).toContain("const debouncedAutoSave = useMemo(");
      expect(fundingPanelSrc).toContain("debounce((profile: FundingProfile) => {");
      expect(fundingPanelSrc).toContain("500),");
      expect(fundingPanelSrc).toContain("debouncedAutoSave.cancel();");
    });
  });

  describe("4. Make Entire Setup Card Clickable & A11y", () => {
    it("makes InlineTradingCard wrapper clickable with cursor-pointer, hover styling, and a11y attributes", () => {
      expect(tradingCardSrc).toContain("cursor-pointer hover:bg-gray-800/50 hover:border-cyan-700 transition-all");
      expect(tradingCardSrc).toContain('role="button"');
      expect(tradingCardSrc).toContain("tabIndex={0}");
      expect(tradingCardSrc).toContain("onKeyDown={(e) => {");
      expect(tradingCardSrc).toContain('if (e.key === "Enter" || e.key === " ")');
      expect(tradingCardSrc).toContain("props.onOpen?.();");
    });

    it("makes Wealth Studio Setup Card wrapper clickable with cursor-pointer, hover styling, and a11y attributes", () => {
      expect(dashboardSrc).toContain('data-testid="setup-card"');
      expect(dashboardSrc).toContain("cursor-pointer hover:bg-gray-800/50 hover:border-cyan-700 transition-all");
      expect(dashboardSrc).toContain('role="button"');
      expect(dashboardSrc).toContain("tabIndex={0}");
      expect(dashboardSrc).toContain("onClick={() => setIsStudioSetupCardExpanded((prev) => !prev)}");
      expect(dashboardSrc).toContain("onKeyDown={(e) => {");
    });
  });

  describe("5. Prevent Event Bubbling on Child Buttons (e.stopPropagation())", () => {
    it("stops propagation on Arm Trade button in InlineTradingCard", () => {
      expect(tradingCardSrc).toContain("data-testid={`button-arm-trade-${d.symbol}`}");
      expect(tradingCardSrc).toContain("e.stopPropagation();\n                  onSeen();\n                  openTradeDialog(");
    });

    it("stops propagation on Adjust Plan button in InlineTradingCard", () => {
      expect(tradingCardSrc).toContain("data-testid={`button-adjust-plan-${d.symbol}`}");
      expect(tradingCardSrc).toContain("e.stopPropagation();\n              handleAdjustPlan();");
    });

    it("stops propagation on Reset and Chart buttons in InlineTradingCard", () => {
      expect(tradingCardSrc).toContain("data-testid={`button-levels-reset-${d.symbol}`}");
      expect(tradingCardSrc).toContain("e.stopPropagation();\n                sz.reset();");
      expect(tradingCardSrc).toContain("e.stopPropagation();\n              focusSymbol(d.symbol);");
    });

    it("stops propagation on Mini-Guide and Collapse buttons in InlineTradingCard", () => {
      expect(tradingCardSrc).toContain("data-testid={`button-mini-guide-${d.symbol}`}");
      expect(tradingCardSrc).toContain("e.stopPropagation();\n              setIsMiniGuideOpen((prev) => !prev);");
      expect(tradingCardSrc).toContain("data-testid={`button-toggle-card-collapse-${d.symbol}`}");
      expect(tradingCardSrc).toContain("e.stopPropagation();\n              setIsExpanded((prev) => !prev);");
    });

    it("ensures expand chevron buttons have relative z-20 pointer-events-auto preventing overlay blockages", () => {
      expect(tradingCardSrc).toContain("data-testid={`button-expand-card-${d.symbol}`}");
      expect(tradingCardSrc).toContain("relative z-20 pointer-events-auto");
      expect(tradingCardSrc).toContain("data-testid={`button-toggle-expand-details-${d.symbol}`}");
      expect(tradingCardSrc).toContain("relative z-20 pointer-events-auto");
      expect(dashboardSrc).toContain("data-testid=\"button-studio-expand-details\"");
      expect(dashboardSrc).toContain("relative z-20 pointer-events-auto");
    });

    it("resets cashAmount state on tradeId or ticker change preventing stale input numbers", () => {
      expect(fundingPanelSrc).toContain("const [cashAmount, setCashAmount] = useState<string>(");
      expect(fundingPanelSrc).toContain("useEffect(() => {");
      expect(fundingPanelSrc).toContain("setCashAmount(s2(f.cash));");
      expect(fundingPanelSrc).toContain("setDraft(null);");
      expect(fundingPanelSrc).toContain("[activeTicker, tradeId, f.cash]");
    });

    it("stops propagation on child action buttons in Wealth Studio Setup Card", () => {
      expect(dashboardSrc).toContain("data-testid=\"button-set-pullback-limit\"");
      expect(dashboardSrc).toContain("e.stopPropagation();\n                          handleStagePullbackLimit();");

      expect(dashboardSrc).toContain("data-testid=\"button-arm-practice-trade\"");
      expect(dashboardSrc).toContain("e.stopPropagation();\n                          if (isTradeReady) {");

      expect(dashboardSrc).toContain("data-testid=\"button-execute-fidelity-ticket\"");
      expect(dashboardSrc).toContain("e.stopPropagation();\n                          if (isTradeReady) {");

      expect(dashboardSrc).toContain("data-testid=\"button-studio-adjust-plan\"");
      expect(dashboardSrc).toContain("e.stopPropagation();\n                          setIsStudioSetupCardExpanded(true);");

      expect(dashboardSrc).toContain("data-testid=\"button-studio-expand-details\"");
      expect(dashboardSrc).toContain("e.stopPropagation();\n                          setIsStudioSetupCardExpanded((prev) => !prev);");
    });
  });
});

