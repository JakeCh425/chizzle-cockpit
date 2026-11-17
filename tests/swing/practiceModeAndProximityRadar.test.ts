import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import {
  evaluateMechanicalSMABars,
  getGlobalPracticeMode,
  setGlobalPracticeMode,
  type BarData,
} from "../../server/mechanicalSmaScanner";
import {
  evaluate,
  type EvalInput,
} from "../../server/swing/lifecycle";
import { DEFAULT_SWING_SETTINGS } from "@shared/swingDecision";

describe("Practice Mode Engine & Proximity Radar UI Overhaul", () => {
  const rootDir = process.cwd();
  const acPath = path.resolve(rootDir, "client/src/components/swing/ActionCenter.tsx");
  const acSrc = fs.readFileSync(acPath, "utf-8");
  const pendingRowPath = path.resolve(rootDir, "client/src/components/swing/PendingRow.tsx");
  const pendingRowSrc = fs.existsSync(pendingRowPath) ? fs.readFileSync(pendingRowPath, "utf-8") : "";

  beforeEach(() => {
    setGlobalPracticeMode(false);
  });

  describe("Task 1: Backend Engine — Practice Mode Timeframe Loosening", () => {
    it("exports getGlobalPracticeMode and setGlobalPracticeMode", () => {
      expect(typeof getGlobalPracticeMode).toBe("function");
      expect(typeof setGlobalPracticeMode).toBe("function");
      expect(getGlobalPracticeMode()).toBe(false);
      setGlobalPracticeMode(true);
      expect(getGlobalPracticeMode()).toBe(true);
      setGlobalPracticeMode(false);
    });

    it("bypasses 4H ceiling in mechanical scanner when practiceMode is true", () => {
      // Create bars with 4H 20 SMA < 50 SMA (downtrend / red regime)
      // but current 1H bar closed green above 10 SMA
      const bars1H: BarData[] = [];
      let price = 200;
      for (let i = 0; i < 240; i++) {
        price = price * 0.998;
        bars1H.push({
          t: i * 3600,
          o: price + 1,
          h: price + 2,
          l: price - 2,
          c: price,
        });
      }
      // Add recent bar closing green above 10-SMA
      const lastPrice = bars1H[bars1H.length - 1].c;
      bars1H.push({
        t: 241 * 3600,
        o: lastPrice - 1,
        h: lastPrice + 5,
        l: lastPrice - 1,
        c: lastPrice + 4,
      });

      // In normal mode: hard blocked by 4H Red Regime
      const normalResult = evaluateMechanicalSMABars("SPY", bars1H, false);
      expect(normalResult.status).toBe("STANDBY_DAY (Red Regime)");
      expect(normalResult.actionable).toBe(false);

      // In practice mode: 4H ceiling bypassed, evaluated on 1H momentum and promoted to CONFIRMED BOUNCE
      const practiceResult = evaluateMechanicalSMABars("SPY", bars1H, true);
      expect(practiceResult.actionable).toBe(true);
      expect(practiceResult.status).toBe("CONFIRMED BOUNCE");
      expect(practiceResult.flag).toBe("PRACTICE");
      expect(practiceResult.isPractice).toBe(true);
      expect(practiceResult.practiceMode).toBe(true);
      expect(practiceResult.entryPrice).toBeGreaterThan(0);
      expect(practiceResult.stopLoss).toBeLessThan(practiceResult.entryPrice!);
      expect(practiceResult.takeProfit2R).toBeGreaterThan(practiceResult.entryPrice!);
    });

    it("promotes to READY_TO_TRADE with PRACTICE flag in lifecycle evaluator when practiceMode is active", () => {
      const now = 1700000000;
      const bars1h = Array.from({ length: 60 }, (_, i) => ({
        t: now - (60 - i) * 3600,
        o: 100 + i * 0.2,
        h: 101 + i * 0.2,
        l: 99.5 + i * 0.2,
        c: 100.8 + i * 0.2, // green candle
        v: 1000,
      }));
      const daily = Array.from({ length: 30 }, (_, i) => ({
        t: now - (30 - i) * 86400,
        o: 90 + i * 0.5,
        h: 92 + i * 0.5,
        l: 89 + i * 0.5,
        c: 91 + i * 0.5,
        v: 10000,
      }));

      const input: EvalInput = {
        symbol: "QQQ",
        exchange: "NASDAQ",
        bars1h,
        daily,
        quote: { price: bars1h[bars1h.length - 1].c, ts: now },
        settings: { ...DEFAULT_SWING_SETTINGS, rthOnly: false, practiceMode: true },
        now,
      };

      const result = evaluate(input);
      expect(result.decision.flag).toBe("PRACTICE");
      expect(result.decision.isPractice).toBe(true);
      expect(result.decision.practiceMode).toBe(true);
      expect(result.decision.setupStatus).toBe("READY_TO_TRADE");
    });
  });

  describe("Task 2: Dynamic Live-Math Engine & Editable Capital", () => {
    it("verifies dynamic entry resolution and non-positive entry guard in ActionCenter", () => {
      expect(acSrc).toContain("const entryPrice = setup.projectedEntry || setup.livePrice;");
      expect(acSrc).toContain("if (entryPrice <= 0) return null;");
      expect(acSrc).toContain("if (entryPrice <= 0 || !math) return null;");
    });

    it("verifies editable customCapital input and mathematical formula", () => {
      expect(acSrc).toContain("const [customCapital, setCustomCapital] = useState<number>(setup.allocatedCapital || 1000);");
      expect(acSrc).toContain("const shares = Math.floor(customCapital / entryPrice);");
      expect(acSrc).toContain("const riskPerShare = entryPrice - setup.stopLoss;");
      expect(acSrc).toContain("const totalRisk = shares * riskPerShare;");
      expect(acSrc).toContain("const profit1_5 = totalRisk * 1.5;");
      expect(acSrc).toContain("const profit2_0 = totalRisk * 2.0;");
      expect(acSrc).toContain("const profit3_0 = totalRisk * 3.0;");
    });

    it("verifies math useMemo hook dependencies", () => {
      expect(acSrc).toContain("[customCapital, entryPrice, setup.stopLoss]");
    });
  });

  describe("Task 3: Proximity Radar & Auto-Sorting", () => {
    it("calculates proximity percentage distance to entry", () => {
      expect(acSrc).toContain("Math.abs((effectivePrice - entryPrice) / entryPrice) * 100");
    });

    it("auto-sorts pendingSetups ascending by proximity (0.00% at top)", () => {
      expect(acSrc).toContain("getProximityForSetup(a) - getProximityForSetup(b)");
    });

    it("renders proximity metric and heat bar color classes", () => {
      expect(acSrc).toContain("% TO ENTRY");
      expect(acSrc).toContain("bg-amber-400 shadow-[0_0_8px_#fbbf24]");
      expect(acSrc).toContain("bg-blue-500/50");
      expect(acSrc).toContain("bg-slate-700");
    });

    it("routes setups with proximity > 3.0% into [ 🔭 DEEP STANDBY ] section", () => {
      expect(acSrc).toContain("if (proximity > 3.0) return null;");
      expect(acSrc).toContain("[ 🔭 DEEP STANDBY ]");
      expect(acSrc).toContain('data-testid="section-deep-standby"');
      expect(acSrc).toContain('data-testid="button-toggle-deep-standby"');
      expect(acSrc).toContain('data-testid="deep-standby-rows"');
    });
  });

  describe("Task 4: Institutional Grid & Typography Redesign", () => {
    it("implements CSS grid layout and prominent ticker styling", () => {
      expect(acSrc).toContain("lg:grid-cols-[200px_minmax(250px,1fr)_repeat(3,minmax(120px,1fr))_auto]");
      expect(acSrc).toContain("bg-slate-800 border-l-4 border-amber-500 w-20 flex justify-center py-2 text-lg font-black text-white shrink-0 items-center rounded");
    });

    it("renders primary prices in high-contrast white font-mono tabular-nums", () => {
      expect(acSrc).toContain("text-base font-mono tabular-nums font-bold text-white");
    });

    it("includes Lucide icons for stops, targets, and live prices", () => {
      expect(acSrc).toContain("<Activity className=");
      expect(acSrc).toContain("<Shield className=");
      expect(acSrc).toContain("<Crosshair className=");
    });

    it("formats target profits in emerald-400 with percentage ROI", () => {
      expect(acSrc).toContain('<div className="text-emerald-400 font-mono text-xs">+${math.profit1_5.toFixed(2)} (+{math.roi1_5.toFixed(1)}%)</div>');
      expect(acSrc).toContain('<div className="text-emerald-400 font-mono text-xs">+${math.profit2_0.toFixed(2)} (+{math.roi2_0.toFixed(1)}%)</div>');
      expect(acSrc).toContain('<div className="text-emerald-400 font-mono text-xs">+${math.profit3_0.toFixed(2)} (+{math.roi3_0.toFixed(1)}%)</div>');
    });
  });

  describe("Task 5: The 'Pass & Watch' Action Button", () => {
    it("renders the [ ⨯ Pass & Watch ] action button and triggers onPassSetup", () => {
      expect(acSrc).toContain("[ ⨯ Pass & Watch ]");
      expect(acSrc).toContain('data-testid={`button-pass-setup-${d.symbol}`}');
      expect(acSrc).toContain("onPassSetup?.(setup.ticker || d.symbol);");
    });

    it("renders the [ 👁️ PASSED & WATCHING ] collapsible accordion at bottom", () => {
      expect(acSrc).toContain("[ 👁️ PASSED & WATCHING ]");
      expect(acSrc).toContain('data-testid="section-passed-watchlist"');
      expect(acSrc).toContain('data-testid="button-toggle-passed-watchlist"');
      expect(acSrc).toContain('data-testid="passed-setups-list"');
      expect(acSrc).toContain('data-testid={`passed-row-${s.symbol}`}');
      expect(acSrc).toContain('data-testid={`button-restore-passed-${s.symbol}`}');
      expect(acSrc).toContain("[ ↩ Restore ]");
    });
  });

  describe("PendingRow.tsx Component", () => {
    it("exports standalone PendingRow component", () => {
      expect(pendingRowSrc).toContain("export function PendingRow");
      expect(pendingRowSrc).toContain("export interface PendingRowProps");
      expect(pendingRowSrc).toContain("<Activity className=");
      expect(pendingRowSrc).toContain("<Shield className=");
      expect(pendingRowSrc).toContain("<Crosshair className=");
      expect(pendingRowSrc).toContain("[ ⨯ Pass & Watch ]");
    });
  });
});
