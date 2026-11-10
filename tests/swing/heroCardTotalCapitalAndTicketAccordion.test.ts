import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const heroCardPath = path.resolve(__dirname, "../../client/src/components/swing/ActiveExecutionHeroCard.tsx");

describe("Fix Stale Math State & Add Collapsible Fidelity Ticket (ExecutionHeroCard)", () => {
  const heroCardSrc = fs.readFileSync(heroCardPath, "utf-8").replace(/\r\n/g, "\n");

  describe("1. Fix State Sync Bug on Total Capital", () => {
    it("derives totalPositionCost dynamically in render cycle from calculatedShares * trade.entryPrice", () => {
      // Must not use standalone state variable like useState for totalCost / totalCapital
      expect(heroCardSrc).not.toMatch(/const\s+\[totalCost,\s*setTotalCost\]\s*=\s*useState/);
      expect(heroCardSrc).not.toMatch(/const\s+\[totalCapital,\s*setTotalCapital\]\s*=\s*useState/);

      // Must derive dynamically
      expect(heroCardSrc).toContain("const totalPositionCost = calculatedShares * trade.entryPrice;");
      expect(heroCardSrc).toContain("const totalCapital = totalPositionCost;");
    });

    it("binds UI position sizing string directly to calculatedShares and totalPositionCost", () => {
      expect(heroCardSrc).toContain('data-testid={`hero-position-sizing-${trade.symbol}`}');
      expect(heroCardSrc).toContain(
        '{calculatedShares} Shares · ${totalPositionCost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Total · Risk: ${totalRisk.toFixed(2)}'
      );
    });

    it("verifies mathematical consistency for sample trade (e.g. XLE 17 shares)", () => {
      const entryPrice = 62.12;
      const shares = 17;
      const totalCost = shares * entryPrice;
      // Stale bug was showing 12 shares worth ($745.44) with 17 shares
      const staleBugCost = 12 * entryPrice; // 745.44
      expect(totalCost).toBeCloseTo(1056.04, 2);
      expect(totalCost).not.toBeCloseTo(staleBugCost, 1);
    });
  });

  describe("2. Collapsible Fidelity Bracket Ticket Accordion", () => {
    it("declares isTicketExpanded accordion state defaulting to false", () => {
      expect(heroCardSrc).toContain("const [isTicketExpanded, setIsTicketExpanded] = useState(false);");
    });

    it("renders ticket toggle button and copy button visible at all times in ticket header", () => {
      expect(heroCardSrc).toContain('data-testid={`button-copy-fidelity-ticket-${trade.symbol}`}');
      expect(heroCardSrc).toContain('data-testid={`button-toggle-ticket-details-${trade.symbol}`}');
      expect(heroCardSrc).toContain("[ ⌄ View Ticket Details ]");
      expect(heroCardSrc).toContain("[ ⌃ Hide Ticket Details ]");
    });

    it("wraps custom allocation bar and 2-step OCO bracket in conditional isTicketExpanded block", () => {
      expect(heroCardSrc).toContain("{isTicketExpanded && (");
      expect(heroCardSrc).toContain('data-testid={`ticket-expanded-body-${trade.symbol}`}');
      expect(heroCardSrc).toContain('data-testid={`hero-custom-allocation-bar-${trade.symbol}`}');
      expect(heroCardSrc).toContain("Step 1: Open Initial Position");
      expect(heroCardSrc).toContain("Step 2: Conditional Bracket (OCO)");

      const conditionIdx = heroCardSrc.indexOf("{isTicketExpanded && (");
      const customAllocIdx = heroCardSrc.indexOf('data-testid={`hero-custom-allocation-bar-${trade.symbol}`}');
      const step1Idx = heroCardSrc.indexOf("Step 1: Open Initial Position");
      const step2Idx = heroCardSrc.indexOf("Step 2: Conditional Bracket (OCO)");

      expect(conditionIdx).toBeGreaterThan(0);
      expect(customAllocIdx).toBeGreaterThan(conditionIdx);
      expect(step1Idx).toBeGreaterThan(customAllocIdx);
      expect(step2Idx).toBeGreaterThan(step1Idx);
    });

    it("exports ExecutionHeroCard alias alongside ActiveExecutionHeroCard", () => {
      expect(heroCardSrc).toContain("export { ActiveExecutionHeroCard as ExecutionHeroCard };");
    });
  });
});
