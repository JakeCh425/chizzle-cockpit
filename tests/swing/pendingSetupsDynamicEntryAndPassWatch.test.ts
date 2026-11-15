import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("ActionCenter: Pending Setups Dynamic Entry, Editable Capital, ROI Targets, & Pass/Watch List", () => {
  const rootDir = process.cwd();
  const acPath = path.resolve(rootDir, "client/src/components/swing/ActionCenter.tsx");
  const acSrc = fs.readFileSync(acPath, "utf-8");

  describe("Task 1: Fix the Fatal Math Bug (Dynamic Entry)", () => {
    it("dynamically resolves entryPrice using projectedEntry or livePrice", () => {
      expect(acSrc).toContain("const entryPrice = setup.projectedEntry || setup.livePrice;");
    });

    it("includes fail-safe guard preventing calculation with zero or negative entry prices", () => {
      expect(acSrc).toContain("if (entryPrice <= 0) return null;");
      expect(acSrc).toContain("if (entryPrice <= 0 || !math) return null;");
    });

    it("recalculates risk dynamically based on entryPrice and stopLoss", () => {
      expect(acSrc).toContain("const riskPerShare = entryPrice - setup.stopLoss;");
      expect(acSrc).toContain("const totalRisk = shares * riskPerShare;");
    });

    it("wraps dynamic math in useMemo dependent on customCapital, entryPrice, and setup.stopLoss", () => {
      expect(acSrc).toContain("[customCapital, entryPrice, setup.stopLoss]");
    });
  });

  describe("Task 2: Fully Editable Capital Input", () => {
    it("initializes customCapital state with setup.allocatedCapital or 1000 fallback", () => {
      expect(acSrc).toContain("const [customCapital, setCustomCapital] = useState<number>(setup.allocatedCapital || 1000);");
    });

    it("wires editable number input to update customCapital state instantly", () => {
      expect(acSrc).toContain('type="number"');
      expect(acSrc).toContain("value={customCapital}");
      expect(acSrc).toContain("setCustomCapital(Number(e.target.value));");
    });

    it("calculates shares based on customCapital divided by entryPrice", () => {
      expect(acSrc).toContain("const shares = Math.floor(customCapital / entryPrice);");
    });
  });

  describe("Task 3: Add Percentages & Dollar Wins", () => {
    it("calculates dollar profit and ROI percentages for 1.5R, 2.0R, and 3.0R targets", () => {
      expect(acSrc).toContain("const profit1_5 = totalRisk * 1.5;");
      expect(acSrc).toContain("const roi1_5 = (shares * entryPrice > 0) ? (profit1_5 / (shares * entryPrice)) * 100 : 0;");
      expect(acSrc).toContain("const profit2_0 = totalRisk * 2.0;");
      expect(acSrc).toContain("const roi2_0 = (shares * entryPrice > 0) ? (profit2_0 / (shares * entryPrice)) * 100 : 0;");
      expect(acSrc).toContain("const profit3_0 = totalRisk * 3.0;");
      expect(acSrc).toContain("const roi3_0 = (shares * entryPrice > 0) ? (profit3_0 / (shares * entryPrice)) * 100 : 0;");
    });

    it("renders profit amounts and ROI percentages formatted to fixed decimals in emerald-400", () => {
      expect(acSrc).toContain('<div className="text-emerald-400 font-mono text-xs">+${math.profit1_5.toFixed(2)} (+{math.roi1_5.toFixed(1)}%)</div>');
      expect(acSrc).toContain('<div className="text-emerald-400 font-mono text-xs">+${math.profit2_0.toFixed(2)} (+{math.roi2_0.toFixed(1)}%)</div>');
      expect(acSrc).toContain('<div className="text-emerald-400 font-mono text-xs">+${math.profit3_0.toFixed(2)} (+{math.roi3_0.toFixed(1)}%)</div>');
    });
  });

  describe("Task 4: The 'Pass / Move to Watchlist' Action", () => {
    it("renders the [ ⨯ Pass & Watch ] action button in each pending row", () => {
      expect(acSrc).toContain("[ ⨯ Pass & Watch ]");
      expect(acSrc).toContain('data-testid={`button-pass-setup-${d.symbol}`}');
      expect(acSrc).toContain("onPassSetup?.(setup.ticker || d.symbol);");
    });

    it("explicitly excludes IGNORED tickers from pendingSetups filter", () => {
      expect(acSrc).toContain("&& setup.status !== 'IGNORED'");
    });

    it("renders the bottom collapsible section [ 👁️ DEFAULT WATCHLIST & PASSED ]", () => {
      expect(acSrc).toContain("[ 👁️ DEFAULT WATCHLIST & PASSED ]");
      expect(acSrc).toContain('data-testid="section-passed-watchlist"');
      expect(acSrc).toContain('data-testid="button-toggle-passed-watchlist"');
      expect(acSrc).toContain('data-testid="passed-setups-list"');
      expect(acSrc).toContain('data-testid={`passed-row-${s.symbol}`}');
      expect(acSrc).toContain('data-testid={`button-restore-passed-${s.symbol}`}');
      expect(acSrc).toContain("[ ↩ Restore ]");
    });
  });
});
