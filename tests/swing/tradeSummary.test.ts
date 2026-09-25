import { describe, it, expect } from "vitest";
import { buildTradeSummary, harmonizeCoach } from "../../shared/tradeSummary";
import { SETUP_STATUSES, FORBIDDEN_PHRASES, GAP_RISK_WARNING, PRACTICE_BANNER } from "../../shared/swingDecision";

const dec = (st: string): any => ({ symbol: "SPY", setupStatus: st, setupType: "RECLAIM", cardGrade: st === "READY_TO_TRADE" ? "A3_SWING" : "WATCH",
  setupTimeframe: "4H", setupTimestamp: "2026-09-24T18:00:00Z", userMode: "PRACTICE", signalMode: "FLEXIBLE",
  entryPrice: 764.91, originalTrigger: 764.53, structuralStop: 760.46, stopBuffer: 0.5, target1: 766.38, target2: 768.95, rewardRiskT1: 0.33, rewardRiskT2: 0.91,
  riskPerShare: 4.45, suggestedShares: 11, maxDollarRisk: 50, currentPrice: 767.18, weeklyRegime: "GREEN", weeklyReclaimForming: false, dailyRegime: "NEUTRAL",
  volumeCondition: "PASS", isExtended: false, extensionPercentAboveTrigger: null, extensionAtr: null, supportZone: { low: 760, high: 762 }, resistanceZone: null,
  whyThisPrinted: ["4H close back above the reclaim level"], whyNotReady: ["Waiting for a closed 1H candle"], missingConditions: [], passedRules: ["Weekly GREEN", "Closed 1H confirmation"],
  invalidation: ["A close below 760.46"], nextAction: "Watch SPY for a closed 1H breakout above 764.53.", riskLabel: "" });
const coach = { headline: "SPY — Constructive uptrend in a GREEN regime", bullets: ["Trend intact.", "Full pilot size acceptable. Consider scaling in on any pullback to SMA20.", "Stock is strong but regime is RED. Skip new longs."] };

describe("trade summary (unified + coach)", () => {
  for (const st of SETUP_STATUSES) {
    it(`${st}: no forbidden phrases, always carries practice + gap warnings`, () => {
      const s = buildTradeSummary(dec(st), coach);
      for (const f of FORBIDDEN_PHRASES[st as keyof typeof FORBIDDEN_PHRASES]) expect(s.text).not.toContain(f);
      expect(s.text).toContain(PRACTICE_BANNER); expect(s.text).toContain(GAP_RISK_WARNING);
      expect(s.printed).toBe(st === "READY_TO_TRADE");
      expect(s.brokerStep != null).toBe(st === "READY_TO_TRADE");
    });
  }
  it("READY shows a do-it-yourself broker step with levels; never an order action", () => {
    const s = buildTradeSummary(dec("READY_TO_TRADE"), coach);
    expect(s.brokerStep!.join(" ")).toContain("enter the order yourself");
    expect(s.brokerStep!.join(" ")).toContain("$760.46");
    expect(s.text).not.toMatch(/place order now|submit order/i);
  });
  it("coach sizing lines are dropped unless READY", () => {
    expect(harmonizeCoach("SETUP_FORMING", coach)!.bullets).toEqual(["Trend intact."]);
    expect(harmonizeCoach("READY_TO_TRADE", coach)!.bullets.length).toBe(3);
  });
});
