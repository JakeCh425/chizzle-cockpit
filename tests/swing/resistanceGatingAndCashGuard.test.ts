import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { calculatePositionSize } from "../../client/src/hooks/usePositionSizer";
import { computeTargetLevels } from "../../client/src/components/swing/TradingCard";
import { obstacleBefore } from "../../shared/practicePlan";

describe("SUBJECT: Priority Board Polish - Resistance Gating, Cash Limit Guards, & Tag Cleanup", () => {
  const tradingCardPath = path.resolve(__dirname, "../../client/src/components/swing/TradingCard.tsx");
  const tradingCardSrc = fs.readFileSync(tradingCardPath, "utf-8").replace(/\r\n/g, "\n");

  const actionCenterPath = path.resolve(__dirname, "../../client/src/components/swing/ActionCenter.tsx");
  const actionCenterSrc = fs.readFileSync(actionCenterPath, "utf-8").replace(/\r\n/g, "\n");

  const sizerPath = path.resolve(__dirname, "../../client/src/hooks/usePositionSizer.ts");
  const sizerSrc = fs.readFileSync(sizerPath, "utf-8").replace(/\r\n/g, "\n");

  describe("1. Structural Resistance Warning on Compact Cards & Target 1 Clamping", () => {
    it("detects overhead structural resistance strictly between entry and target 1", () => {
      const levels = [
        { price: 310.0, kind: "SUPPORT" as const },
        { price: 354.47, kind: "RESISTANCE" as const },
        { price: 380.0, kind: "RESISTANCE" as const },
      ];
      const entry = 330.0;
      const target1 = 371.62;

      const obstacle = obstacleBefore(levels, entry, target1);
      expect(obstacle).toBeDefined();
      expect(obstacle?.price).toBe(354.47);
    });

    it("renders amber pill badge [ ⚠️ RESISTANCE AT $XXX.XX ] in card header when obstacle is present", () => {
      expect(tradingCardSrc).toContain('[ ⚠️ RESISTANCE AT $');
      expect(tradingCardSrc).toContain('badge-header-resistance-');
      expect(tradingCardSrc).toContain('bg-amber-500/15');
      expect(tradingCardSrc).toContain('text-amber-300');
    });

    it("clamps Target 1 to sit just below structural resistance line ($354.47 -> $353.90)", () => {
      const entry = 330.0;
      const stop = 320.0; // risk = $10.00
      const defaultT1 = 371.62; // original target 1 well above resistance
      const defaultT2 = 390.0;

      // With clamping enabled below resistance at 354.47
      const targetsClamped = computeTargetLevels(entry, stop, defaultT1, defaultT2, false, {
        clampToResistance: true,
        resistancePrice: 354.47,
        clampOffset: 0.57, // sits just below resistance at $353.90
      });

      expect(targetsClamped.isClampedToResistance).toBe(true);
      expect(targetsClamped.t1).toBe(353.90);
      expect(targetsClamped.t1R).toBe(2.4); // (353.90 - 330) / 10 = 2.39 -> 2.4R
    });

    it("supports default 50-cent buffer below resistance when offset is omitted", () => {
      const entry = 300.0;
      const stop = 290.0;
      const defaultT1 = 330.0;
      const defaultT2 = 350.0;

      const targetsClamped = computeTargetLevels(entry, stop, defaultT1, defaultT2, false, {
        clampToResistance: true,
        resistancePrice: 320.0,
      });

      expect(targetsClamped.isClampedToResistance).toBe(true);
      expect(targetsClamped.t1).toBe(319.50); // $320.00 - $0.50
    });

    it("renders interactive checkbox toggle for clamping Target 1 in card body", () => {
      expect(tradingCardSrc).toContain('data-testid={`checkbox-clamp-resistance-${d.symbol}`}');
      expect(tradingCardSrc).toContain('Clamp Target 1 below Overhead Resistance');
    });
  });

  describe("2. Available Cash vs. Margin Execution Guard", () => {
    it("enforces maxShares = Math.min(riskShares, cashShares)", () => {
      expect(sizerSrc).toContain("Math.min(riskShares, cashShares)");
      expect(sizerSrc).toContain("Math.floor((availableCash / entry) + 1e-9)");
      expect(sizerSrc).toContain("Math.floor((totalDollarRiskAllowed / dollarRiskPerShare) + 1e-9)");
    });

    it("automatically downsizes shares to fit available cash without requiring margin (XLI scenario)", () => {
      // XLI scenario:
      // Entry: $135.80, Stop: $134.72 -> risk/share = $1.08
      // Account Equity: $25,000, Risk %: 1.0% -> Risk Budget = $250.00
      // Pure risk would allow: floor(250 / 1.08) = 231 shares ($31,370 total capital)
      // BUT available cash is only $2,000.00:
      const result = calculatePositionSize({
        accountEquity: 25000,
        riskPercentage: 1.0,
        availableCash: 2000,
        entryPrice: 135.80,
        stopLossPrice: 134.72,
      });

      // Cash limit: floor(2000 / 135.80) = 14 shares
      expect(result.calculatedShares).toBe(14);
      expect(result.totalCapitalRequired).toBeLessThanOrEqual(2000);
      expect(result.totalCapitalRequired).toBe(14 * 135.80); // $1901.20
      // Margin is NOT required because shares were automatically downsized to cash
      expect(result.isMarginRequired).toBe(false);
      expect(result.isInsufficientCash).toBe(false);
      expect(result.warningMessage).toBeNull();
    });

    it("flags isInsufficientCash and 0 shares when available cash cannot afford even 1 share", () => {
      // Entry $135.80, but available cash is only $50.00
      const result = calculatePositionSize({
        accountEquity: 25000,
        riskPercentage: 1.0,
        availableCash: 50.00,
        entryPrice: 135.80,
        stopLossPrice: 134.72,
      });

      expect(result.calculatedShares).toBe(0);
      expect(result.isInsufficientCash).toBe(true);
      expect(result.warningMessage).toBe("Insufficient Cash Balance");
    });

    it("disables [ ARM TRADE ] button with 'Insufficient Cash Balance' tooltip when cash is insufficient", () => {
      expect(tradingCardSrc).toContain('disabled={isInsufficientCash}');
      expect(tradingCardSrc).toContain('isInsufficientCash ? "Insufficient Cash Balance"');
      expect(tradingCardSrc).toContain('data-testid={`card-insufficient-cash-warning-${d.symbol}`}');
    });
  });

  describe("3. De-Duplicate Redundant 'DELAYED' Badges", () => {
    it("consolidates data feed status into single clean badge in card headers", () => {
      // Header tag renders [ 🟢 LIVE ] or [ 🟡 DELAYED (15m) ]
      expect(tradingCardSrc).toContain('[ 🟢 LIVE ]');
      expect(tradingCardSrc).toContain('[ 🟡 DELAYED (15m) ]');
      expect(actionCenterSrc).toContain('[ 🟡 DELAYED (15m) ]');
    });

    it("removes duplicate sibling spans from header flex row next to price", () => {
      // Confirm that the messy duplicate pattern "[ ⚠️ DELAYED DATA ] [ DELAYED ]" is eradicated from the headers
      expect(tradingCardSrc).not.toContain('"[ ⚠️ DELAYED DATA ] [ DELAYED ]"');
      expect(actionCenterSrc).not.toContain('"[ ⚠️ DELAYED DATA ] [ DELAYED ]"');
    });

    it("preserves test accessibility via aria-label on the consolidated badge", () => {
      expect(tradingCardSrc).toContain('aria-label={isDelayed ? "[ ⚠️ DELAYED DATA ]" : "[ 🟢 LIVE ]"}');
    });
  });
});
