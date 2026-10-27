import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { rTargets, r2 } from "../../shared/positionSizing";

describe("FundingPanel 1.5R Target Row Addition", () => {
  const fundingPanelPath = path.resolve(__dirname, "../../client/src/components/swing/FundingPanel.tsx");
  const fundingPanelContent = fs.readFileSync(fundingPanelPath, "utf-8").replace(/\r\n/g, "\n");

  const positionSizingPath = path.resolve(__dirname, "../../shared/positionSizing.ts");
  const positionSizingContent = fs.readFileSync(positionSizingPath, "utf-8").replace(/\r\n/g, "\n");

  it("includes 1.5 at the beginning of the sequence in rTargets for both standard and extended sets", () => {
    expect(positionSizingContent).toContain("[1.5, 2, 3, 4, 5, 6]");
    expect(positionSizingContent).toContain("[1.5, 2, 3]");

    const standardTargets = rTargets(100, 95, 100, false);
    expect(standardTargets.map((t) => t.r)).toEqual([1.5, 2, 3]);
    expect(standardTargets[0].r).toBe(1.5);

    const extendedTargets = rTargets(100, 95, 100, true);
    expect(extendedTargets.map((t) => t.r)).toEqual([1.5, 2, 3, 4, 5, 6]);
    expect(extendedTargets[0].r).toBe(1.5);
  });

  it("accurately calculates 1.5R Target Price, Move From Entry (%), and Gross Profit", () => {
    const entry = 100;
    const stop = 96;
    const shares = 50;
    const riskPerShare = entry - stop; // 4.00

    const targets = rTargets(entry, stop, shares, false);
    const row15 = targets[0];

    // Target price: entry + (1.5 * riskPerShare) = 100 + (1.5 * 4) = 106.00
    expect(row15.price).toBe(106.00);

    // Move from entry: ((106 - 100) / 100) * 100 = 6.00%
    expect(row15.pctMove).toBe(6.00);

    // Gross profit: 1.5 * riskPerShare * shares = 1.5 * 4 * 50 = 300.00
    expect(row15.grossProfit).toBe(300.00);
  });

  it("does not break or alter the math for existing 2R through 6R rows", () => {
    const entry = 100;
    const stop = 96;
    const shares = 50;
    const R = entry - stop; // 4.00

    const targets = rTargets(entry, stop, shares, true);

    // Verify 2R
    expect(targets[1].r).toBe(2);
    expect(targets[1].price).toBe(entry + 2 * R); // 108.00
    expect(targets[1].grossProfit).toBe(2 * R * shares); // 400.00

    // Verify 3R
    expect(targets[2].r).toBe(3);
    expect(targets[2].price).toBe(entry + 3 * R); // 112.00
    expect(targets[2].grossProfit).toBe(3 * R * shares); // 600.00

    // Verify 4R
    expect(targets[3].r).toBe(4);
    expect(targets[3].price).toBe(entry + 4 * R); // 116.00
    expect(targets[3].grossProfit).toBe(4 * R * shares); // 800.00

    // Verify 5R
    expect(targets[4].r).toBe(5);
    expect(targets[4].price).toBe(entry + 5 * R); // 120.00
    expect(targets[4].grossProfit).toBe(5 * R * shares); // 1000.00

    // Verify 6R
    expect(targets[5].r).toBe(6);
    expect(targets[5].price).toBe(entry + 6 * R); // 124.00
    expect(targets[5].grossProfit).toBe(6 * R * shares); // 1200.00
  });

  it("renders the table with font-mono tabular-nums and consistent structure in FundingPanel.tsx", () => {
    expect(fundingPanelContent).toContain('data-testid={`table-r-targets-${sym}`}');
    expect(fundingPanelContent).toContain('font-mono tabular-nums');
    expect(fundingPanelContent).toContain('{t.r}R');
    expect(fundingPanelContent).toContain('data-testid={`row-r-target-${sym}-${t.r}`}');
  });
});

