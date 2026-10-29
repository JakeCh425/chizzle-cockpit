import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const fundingPanelPath = path.resolve(__dirname, "../../client/src/components/swing/FundingPanel.tsx");
const tradingCardPath = path.resolve(__dirname, "../../client/src/components/swing/TradingCard.tsx");

describe("Fix Event Bubbling on Setup Card Inputs & Refine Funding UI", () => {
  const fundingPanelSrc = fs.readFileSync(fundingPanelPath, "utf-8").replace(/\r\n/g, "\n");
  const tradingCardSrc = fs.readFileSync(tradingCardPath, "utf-8").replace(/\r\n/g, "\n");

  describe("1. Fix Event Bubbling (Input Clicks Toggling the Card)", () => {
    it("stops event propagation on Field component inputs and wrapper container", () => {
      expect(fundingPanelSrc).toContain("function Field({");
      expect(fundingPanelSrc).toContain("onClick={(e) => e.stopPropagation()}");
      expect(fundingPanelSrc).toContain("onMouseDown={(e) => e.stopPropagation()}");
    });

    it("stops event propagation on expanded accordion containers in TradingCard", () => {
      expect(tradingCardSrc).toContain("data-testid={`card-expanded-details-${d.symbol}`}");
      expect(tradingCardSrc).toContain("data-testid={`card-collapsible-body-${d.symbol}`}");
      expect(tradingCardSrc).toContain("data-testid={`card-deep-diagnostics-${d.symbol}`}");
    });

    it("stops event propagation on equity select, checkboxes, and info buttons", () => {
      expect(fundingPanelSrc).toContain("data-testid={`select-equity-mode-${symbol}`}");
      expect(fundingPanelSrc).toContain("data-testid={`check-cash-includes-${symbol}`}");
      expect(fundingPanelSrc).toContain("data-testid={`button-res-from-trades-${symbol}`}");
      expect(fundingPanelSrc).toContain("data-testid={`button-equity-info-${symbol}`}");
    });
  });

  describe("2. Streamline Funding Configuration Panel (FundingPanel.tsx)", () => {
    it("uses a multi-column CSS grid layout (grid grid-cols-2 lg:grid-cols-3 gap-4)", () => {
      expect(fundingPanelSrc).toContain('className="grid grid-cols-2 lg:grid-cols-3 gap-4"');
    });

    it("places an integrated currency symbol inside input with relative container and absolute icon", () => {
      expect(fundingPanelSrc).toContain('absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-mono text-sm pointer-events-none select-none');
      expect(fundingPanelSrc).toContain('prefix ? "pl-7" : "pl-3"');
    });

    it("styles input borders with border-gray-700 and emerald focus ring", () => {
      expect(fundingPanelSrc).toContain("border border-gray-700");
      expect(fundingPanelSrc).toContain("focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500");
    });

    it("hides 3-line warning behind a small [ ℹ️ Info ] tooltip icon", () => {
      expect(fundingPanelSrc).toContain("import { AlertTriangle, Check, Info, RefreshCw, RotateCcw, Save, Wallet } from \"lucide-react\";");
      expect(fundingPanelSrc).toContain("data-testid={`button-equity-info-${symbol}`}");
      expect(fundingPanelSrc).toContain('<Info className="h-3.5 w-3.5" aria-hidden />');
      expect(fundingPanelSrc).toContain("data-testid={`tooltip-equity-info-${symbol}`}");
      expect(fundingPanelSrc).toContain("data-testid={`text-equity-history-gap-${symbol}`}");
    });
  });

  describe("3. Auto-Focus on Edit", () => {
    it("auto-focuses and selects the Cash for this trade input when handleAdjustPlan is triggered", () => {
      expect(tradingCardSrc).toContain('const cashInput = document.querySelector(`[data-testid="input-cash-${d.symbol}"]`) as HTMLInputElement;');
      expect(tradingCardSrc).toContain("cashInput.scrollIntoView({ behavior: \"smooth\", block: \"center\" });");
      expect(tradingCardSrc).toContain("cashInput.focus();");
      expect(tradingCardSrc).toContain("cashInput.select?.();");
    });
  });
});

