import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { tradeSetupStore, safeTrim } from "@/lib/useTradeSetupStore";

const rootDir = path.resolve(__dirname, "../..");

describe("Action Center evaluateSetupStage Crash Resilience & Safe Trim", () => {
  describe("1. safeTrim and Safe String Normalization", () => {
    it("safely trims strings and returns empty string for undefined, null, or non-string", () => {
      expect(safeTrim("  AAPL  ")).toBe("AAPL");
      expect(safeTrim(undefined)).toBe("");
      expect(safeTrim(null)).toBe("");
      expect(safeTrim(12345 as any)).toBe("");
      expect(safeTrim({} as any)).toBe("");
    });
  });

  describe("2. evaluateSetupStage Robust Fallback & Error Handling", () => {
    it("does not throw when called with undefined, null, or empty object", () => {
      expect(() => {
        tradeSetupStore.evaluateSetupStage(undefined as any);
      }).not.toThrow();

      expect(() => {
        tradeSetupStore.evaluateSetupStage(null as any);
      }).not.toThrow();

      expect(() => {
        tradeSetupStore.evaluateSetupStage({} as any);
      }).not.toThrow();
    });

    it("returns safe fallback state (STAGE_UNKNOWN or PENDING) when symbol is undefined or empty", () => {
      const res1 = tradeSetupStore.evaluateSetupStage({
        symbol: undefined as any,
        currentPrice: 100,
      });

      expect(res1).toBeDefined();
      expect(res1.stage).toBe(1);
      expect(res1.stageBadge).toContain("PENDING");
      expect(res1.statusText).toContain("PENDING");

      const res2 = tradeSetupStore.evaluateSetupStage({
        ticker: undefined as any,
        currentPrice: 100,
      } as any);

      expect(res2).toBeDefined();
      expect(res2.stage).toBe(1);
    });

    it("handles tickers with spaces and status fields gracefully", () => {
      const res = tradeSetupStore.evaluateSetupStage({
        symbol: "  msft  ",
        currentPrice: 200,
        status: "  READY_TO_TRADE  ",
      });

      expect(res).toBeDefined();
      expect(res.stage).toBeGreaterThanOrEqual(1);
    });
  });

  describe("3. ActionCenter and TradingCard Source Verification", () => {
    it("verifies ActionCenter implements rawSetups and validSetups filtering in useMemo", () => {
      const actionCenterSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/components/swing/ActionCenter.tsx"),
        "utf-8"
      );

      expect(actionCenterSrc).toContain("rawSetups");
      expect(actionCenterSrc).toContain("validSetups");
      expect(actionCenterSrc).toContain("setup.ticker || setup.symbol");
    });

    it("verifies TradingCard wraps evaluateSetupStage in a try...catch block", () => {
      const tradingCardSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/components/swing/TradingCard.tsx"),
        "utf-8"
      );

      expect(tradingCardSrc).toContain("try {");
      expect(tradingCardSrc).toContain("tradeSetupStore.evaluateSetupStage(");
      expect(tradingCardSrc).toContain("catch (err) {");
      expect(tradingCardSrc).toContain("STAGE_UNKNOWN");
    });

    it("verifies useTradeSetupStore wraps evaluateSetupStage in a try...catch block and returns fallback", () => {
      const storeSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/lib/useTradeSetupStore.ts"),
        "utf-8"
      );

      expect(storeSrc).toContain("evaluateSetupStage");
      expect(storeSrc).toContain("try {");
      expect(storeSrc).toContain("catch (err) {");
      expect(storeSrc).toContain("STAGE_UNKNOWN");
    });
  });
});
