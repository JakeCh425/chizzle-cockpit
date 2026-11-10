import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { evaluate } from "../../server/swing/lifecycle";
import { flat } from "../fixtures/builders";
import { raw1HFrom4H, raw1H, scale, dailySeries, settings, upTo } from "../fixtures/replay";
import { chicago, chicagoTs } from "../../server/swing/bars";

const tradingCardPath = path.resolve(__dirname, "../../client/src/components/swing/TradingCard.tsx");
const lifecyclePath = path.resolve(__dirname, "../../server/swing/lifecycle.ts");

describe("Institutional Trading Card UI & Lifecycle Refactor", () => {
  const tradingCardSrc = fs.readFileSync(tradingCardPath, "utf-8").replace(/\r\n/g, "\n");
  const lifecycleSrc = fs.readFileSync(lifecyclePath, "utf-8").replace(/\r\n/g, "\n");

  describe("Task 1: Institutional Typography & Removing Dead Space (TradingCard.tsx)", () => {
    it("renders prices in text-2xl or text-3xl font-mono tabular-nums font-bold text-soft-white", () => {
      // Inline header live price
      expect(tradingCardSrc).toMatch(/inline-header-price-[\s\S]*?text-2xl font-mono tabular-nums font-bold text-soft-white/);
      // Core metrics prices (Entry, Stop Loss, Target 1)
      expect(tradingCardSrc).toMatch(/core-metrics-[\s\S]*?text-2xl font-mono tabular-nums font-bold text-soft-white/);
    });

    it("uses flex-1 and items-baseline to align large numbers with tiny uppercase labels", () => {
      expect(tradingCardSrc).toContain("items-baseline gap-1.5");
      expect(tradingCardSrc).toContain("LIVE");
      expect(tradingCardSrc).toContain("Buy Target");
      expect(tradingCardSrc).toContain("Stop Loss");
      expect(tradingCardSrc).toContain("Target 1");
    });

    it("applies tight container padding (p-3 / p-4 instead of p-6)", () => {
      // Expanded details uses p-4
      expect(tradingCardSrc).toContain("expanded-details bg-ink-deep/40 border-t border-ink-line/50 p-4");
      // Compact header uses px-3 sm:px-4
      expect(tradingCardSrc).toContain("px-3 sm:px-4 min-h-14 sm:min-h-16");
    });
  });

  describe("Task 2: Whole-Number Cash Allocation Input (TradingCard.tsx)", () => {
    it("enforces integer-only parsing via parseInt and regex stripping of non-digits", () => {
      expect(tradingCardSrc).toContain("setCustomCash(parseInt(e.target.value.replace(/\\D/g, ''), 10) || 0)");
    });

    it("hides browser spinner arrows on number inputs via Tailwind CSS", () => {
      expect(tradingCardSrc).toContain("[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none");
    });

    it("renders massive, prominent Calculated Shares typography (text-xl font-mono text-neon-blue font-bold)", () => {
      expect(tradingCardSrc).toContain("text-xl font-mono text-neon-blue font-bold tabular-nums");
    });
  });

  describe("Task 3: Expiration Rules (Run-Ups & End-of-Day)", () => {
    describe("Frontend Override (TradingCard.tsx)", () => {
      it("defines isExtendedRunUp checking extensionCheck.extended, isExtended, or WATCH_EXTENDED", () => {
        expect(tradingCardSrc).toContain("d.extensionCheck?.extended === true");
        expect(tradingCardSrc).toContain('d.setupStatus === "WATCH_EXTENDED"');
      });

      it("overrides status badge to [ EXPIRED - EXTENDED ] and hides Fidelity ticket when extended", () => {
        expect(tradingCardSrc).toContain("data-testid={`badge-expired-extended-${d.symbol}`}");
        expect(tradingCardSrc).toContain("[ EXPIRED - EXTENDED ]");
        expect(tradingCardSrc).toContain("data-testid={`banner-expired-extended-${d.symbol}`}");
        expect(tradingCardSrc).toContain("!isExtendedRunUp && !isExpiredEndOfDay && isMiniGuideOpen && (");
      });

      it("overrides status badge to [ EXPIRED - EOD ] and hides Fidelity ticket when expired past close", () => {
        expect(tradingCardSrc).toContain("data-testid={`badge-expired-eod-${d.symbol}`}");
        expect(tradingCardSrc).toContain("[ EXPIRED - EOD ]");
        expect(tradingCardSrc).toContain("data-testid={`banner-expired-eod-${d.symbol}`}");
      });
    });

    describe("Backend Enforcement (server/swing/lifecycle.ts)", () => {
      it("downgrades extension check failures from READY_TO_TRADE to WATCH_RETEST", () => {
        expect(lifecycleSrc).toContain('d.nextAction = `Do not chase ${sym}. Wait for retest zone');
        expect(lifecycleSrc).toContain('return out("WATCH_RETEST", { earlyTrigger: early });');
      });

      it("downgrades un-triggered setups evaluated after 4:00 PM ET to SIGNAL_EXPIRED", () => {
        expect(lifecycleSrc).toContain("// ── End-of-Day Expiration Rule (§EOD) ──");
        expect(lifecycleSrc).toContain('d.riskLabel = "EXPIRED — END OF DAY"');
        expect(lifecycleSrc).toContain('return out("SIGNAL_EXPIRED", { earlyTrigger: early });');
      });

      it("preserves precedence so expiredEndOfDay setups remain primary over pending/forming setups", () => {
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

        // During Day -> READY_TO_TRADE
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

        // After Close (15:30 CT = 4:30 PM ET) -> SIGNAL_EXPIRED with expiredEndOfDay
        const signalParts = chicago(readyTs);
        const afterCloseTs = chicagoTs(signalParts.ymd, 15 * 60 + 30);
        const afterClose = evaluate({
          symbol: "SMH",
          exchange: "NASDAQ",
          bars1h: upTo(smh, readyTs),
          daily: dailySeries(Array(140).fill(X)),
          settings: settings({}),
          now: afterCloseTs,
          dataSource: "fixture",
        }).decision;

        expect(afterClose.setupStatus).toBe("SIGNAL_EXPIRED");
        expect(afterClose.riskLabel).toBe("EXPIRED — END OF DAY");
        expect((afterClose as any).expiredEndOfDay).toBe(true);
        expect(afterClose.suggestedShares).toBe(0);
      });
    });
  });
});
