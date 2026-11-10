import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { isSignalPastEndOfDay } from "../../client/src/components/swing/TradingCard";
import { evaluate } from "../../server/swing/lifecycle";
import { flat } from "../fixtures/builders";
import { raw1HFrom4H, raw1H, scale, dailySeries, settings, upTo } from "../fixtures/replay";
import { chicago, chicagoTs } from "../../server/swing/bars";
import type { SwingDecision } from "@shared/swingDecision";

const tradingCardPath = path.resolve(__dirname, "../../client/src/components/swing/TradingCard.tsx");
const lifecyclePath = path.resolve(__dirname, "../../server/swing/lifecycle.ts");
const heroCardPath = path.resolve(__dirname, "../../client/src/components/swing/ActiveExecutionHeroCard.tsx");

describe("Task 1: Editable Cash Input & Dynamic Sizing (TradingCard.tsx)", () => {
  const tradingCardSrc = fs.readFileSync(tradingCardPath, "utf-8").replace(/\r\n/g, "\n");
  const heroCardSrc = fs.readFileSync(heroCardPath, "utf-8").replace(/\r\n/g, "\n");

  it("declares customCash local state with default p.capital || 1000", () => {
    expect(tradingCardSrc).toContain("const [customCash, setCustomCash] = useState<number>(p.capital ||");
  });

  it("renders editable input with futuristic dark-mode styling and numeric change handler", () => {
    expect(tradingCardSrc).toContain('type="number"');
    expect(tradingCardSrc).toContain("value={customCash}");
    expect(tradingCardSrc).toContain("onChange={(e) => setCustomCash(Number(e.target.value))}");
    expect(tradingCardSrc).toContain("bg-ink-black border border-ink-line rounded px-2 py-1 text-neon-blue font-mono");
  });

  it("dynamically calculates shares using entry price: Math.floor(customCash / p.entry)", () => {
    expect(tradingCardSrc).toContain("Math.floor(customCash / p.entry)");
    expect(tradingCardSrc).toContain("const customShares =");
  });

  it("renders 'Custom Allocation' control bar just above the Fidelity Ticket", () => {
    expect(tradingCardSrc).toContain("Custom Allocation:");
    expect(tradingCardSrc).toContain('data-testid={`custom-allocation-bar-${d.symbol}`}');
    expect(tradingCardSrc).toContain("Calculated Shares:");

    const allocBarIdx = tradingCardSrc.indexOf('data-testid={`custom-allocation-bar-${d.symbol}`}');
    const fidelityGuideIdx = tradingCardSrc.indexOf("<FidelityExecutionGuide");
    expect(allocBarIdx).toBeGreaterThan(0);
    expect(fidelityGuideIdx).toBeGreaterThan(allocBarIdx);
  });

  it("passes customShares into Fidelity ticket UI, ScaleOutRLadder, and Risk calculations", () => {
    expect(tradingCardSrc).toContain("calculatedShares={customShares}");
    expect(tradingCardSrc).toContain("Broker Ticket ({customShares} Shares)");
    expect(tradingCardSrc).toContain("BUY LIMIT: <strong className=\"text-white\">${activeEntry != null ? activeEntry.toFixed(2) : \"—\"}</strong> ({customShares} sh)");
    expect(tradingCardSrc).toContain("totalShares={customShares}");
    expect(tradingCardSrc).toContain("const totalRisk = customShares * activeRiskPerShare;");
  });

  it("also supports Custom Allocation control bar in ActiveExecutionHeroCard above Fidelity order ticket", () => {
    expect(heroCardSrc).toContain('data-testid={`hero-custom-allocation-bar-${trade.symbol}`}');
    expect(heroCardSrc).toContain("Custom Allocation:");
    expect(heroCardSrc).toContain("bg-ink-black border border-ink-line rounded px-2 py-1 text-neon-blue font-mono");
  });
});

describe("Task 2: End-of-Day Auto-Expiration (Frontend & Backend Engine)", () => {
  const tradingCardSrc = fs.readFileSync(tradingCardPath, "utf-8").replace(/\r\n/g, "\n");
  const lifecycleSrc = fs.readFileSync(lifecyclePath, "utf-8").replace(/\r\n/g, "\n");

  describe("Frontend (TradingCard.tsx) Time Utility & Auto-Collapse", () => {
    it("exports isSignalPastEndOfDay utility function", () => {
      expect(typeof isSignalPastEndOfDay).toBe("function");
    });

    it("returns false for READY_TO_TRADE setup during regular market hours (e.g., 2:00 PM ET / 14:00)", () => {
      // Signal generated on 2026-11-10 at 10:00 AM ET (15:00 UTC)
      const mockDecision: SwingDecision = {
        symbol: "NVDA",
        setupStatus: "READY_TO_TRADE",
        setupTimestamp: "2026-11-10T15:00:00.000Z",
      } as any;

      // Current time is same day at 2:00 PM ET (19:00 UTC)
      const duringMarket = new Date("2026-11-10T19:00:00.000Z");
      expect(isSignalPastEndOfDay(mockDecision, duringMarket)).toBe(false);
    });

    it("returns true for READY_TO_TRADE setup past market close on the same day (e.g., 4:15 PM ET / 16:15)", () => {
      const mockDecision: SwingDecision = {
        symbol: "NVDA",
        setupStatus: "READY_TO_TRADE",
        setupTimestamp: "2026-11-10T15:00:00.000Z",
      } as any;

      // Current time is same day at 4:15 PM ET (21:15 UTC)
      const afterClose = new Date("2026-11-10T21:15:00.000Z");
      expect(isSignalPastEndOfDay(mockDecision, afterClose)).toBe(true);
    });

    it("returns true for READY_TO_TRADE setup on next morning before open (overnight gap protection)", () => {
      const mockDecision: SwingDecision = {
        symbol: "NVDA",
        setupStatus: "READY_TO_TRADE",
        setupTimestamp: "2026-11-10T15:00:00.000Z",
      } as any;

      // Current time is next morning at 8:00 AM ET (13:00 UTC)
      const nextMorning = new Date("2026-11-11T13:00:00.000Z");
      expect(isSignalPastEndOfDay(mockDecision, nextMorning)).toBe(true);
    });

    it("visually overrides the UI status to [ EXPIRED - END OF DAY ] when expired", () => {
      expect(tradingCardSrc).toContain("data-testid={`badge-expired-eod-${d.symbol}`}");
      expect(tradingCardSrc).toContain("[ EXPIRED - END OF DAY ]");
      expect(tradingCardSrc).toContain('text={isExpiredEndOfDay ? "EXPIRED - END OF DAY" : statusText(d, group, live, f)}');
    });

    it("auto-collapses the card when isExpiredEndOfDay is true", () => {
      expect(tradingCardSrc).toContain("const isExpiredEndOfDay = isSignalPastEndOfDay(d);");
      expect(tradingCardSrc).toContain("if (isExpiredEndOfDay) {");
      expect(tradingCardSrc).toContain("setIsExpanded(false);");
    });
  });

  describe("Backend Lifecycle (server/swing/lifecycle.ts) Precedence Engine", () => {
    it("contains End-of-Day Expiration rule before READY_TO_TRADE return", () => {
      expect(lifecycleSrc).toContain("// ── End-of-Day Expiration Rule (§EOD) ──");
      expect(lifecycleSrc).toContain("isPastMarketClose");
      expect(lifecycleSrc).toContain("wasTriggerHitInRth");
      expect(lifecycleSrc).toContain('d.riskLabel = "EXPIRED — END OF DAY"');
      expect(lifecycleSrc).toContain('return out("SETUP_CONFIRMED", { earlyTrigger: early });');
    });

    it("downgrades un-triggered setups evaluated after 4:00 PM ET back to SETUP_CONFIRMED (Pending)", () => {
      const K = 5.7;
      const X = 570;
      const below = Array.from({ length: 6 }, (_, i) => [99.4, 99.6, 99.0, 99.3 - (i % 2) * 0.1]);
      const base = raw1HFrom4H(scale([...flat(16), ...below, [99.3, 100.7, 99.2, 100.6]], K));
      const rbEnd = base[base.length - 1].t + 3600;
      const confirmRows = [
        [100.5, 100.65, 100.35, 100.55],
        [100.55, 100.6, 100.2, 100.3],
        [100.3, 100.5, 100.25, 100.45],
        [100.45, 100.6, 100.4, 100.5],
        [100.5, 101.3, 100.45, 101.25],
      ];
      const smh = [...base, ...raw1H(scale(confirmRows, K), rbEnd)];
      const readyTs = smh[smh.length - 1].t + 3600; // 10:30 AM CT / 11:30 AM ET

      // 1. Evaluate during trading hours (RTH) -> READY_TO_TRADE
      const duringDay = evaluate({
        symbol: "SMH",
        exchange: "NASDAQ",
        bars1h: upTo(smh, readyTs),
        daily: dailySeries(Array(140).fill(X)),
        settings: settings({}),
        now: readyTs,
        dataSource: "fixture",
      }).decision;

      expect(duringDay.setupStatus).toBe("READY_TO_TRADE");

      // 2. Evaluate after market close on the same day (15:30 CT = 16:30 ET / 4:30 PM ET)
      const signalParts = chicago(readyTs);
      const afterCloseTs = chicagoTs(signalParts.ymd, 15 * 60 + 30); // 15:30 CT (4:30 PM ET)

      const afterClose = evaluate({
        symbol: "SMH",
        exchange: "NASDAQ",
        bars1h: upTo(smh, readyTs),
        daily: dailySeries(Array(140).fill(X)),
        settings: settings({}),
        now: afterCloseTs,
        dataSource: "fixture",
      }).decision;

      // Downgraded to SETUP_CONFIRMED (Pending) with EXPIRED — END OF DAY riskLabel
      expect(afterClose.setupStatus).toBe("SETUP_CONFIRMED");
      expect(afterClose.riskLabel).toBe("EXPIRED — END OF DAY");
      expect((afterClose as any).expiredEndOfDay).toBe(true);
      expect(afterClose.suggestedShares).toBe(0);
    });
  });
});
