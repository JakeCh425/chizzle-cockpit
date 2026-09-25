import { describe, it, expect } from "vitest";
process.env.DATABASE_URL ||= "postgres://x:y@127.0.0.1:1/none";
describe("flex ↔ unified alignment (PR 3f)", async () => {
  const { alignCard } = await import("../../server/swing/flexAlign");
  const { SETUP_STATUSES, FORBIDDEN_PHRASES } = await import("../../shared/swingDecision");
  const legacy: any = { state: "STANDBY", ticker: "SMH", pinned: true, vehicle_class: "GROWTH_TECH", permission: "NO_LONG", setup: "No trade",
    readiness_score: 55, distance_to_ready: [], trend: "t", structure: "s", trigger: "Blocked: Severely extended", entry_zone: { low: null, high: null, note: "" },
    stop: { price: null, reason: "" }, target_1: { price: null, r_multiple: null }, risk_grade: "NO TRADE",
    fakeout_check: { result: "FAIL", reasons: ["Chase"] }, smh_market_context: "ctx", market_confirmation: "MIXED", action: "STAND DOWN",
    hard_blocks: ["Severely extended: +5.9% (2.07 ATR) above 20-SMA — no acceptable stop"] };
  const dec = (st: string): any => ({ setupStatus: st, setupType: "HIGHER_LOW_CONSOLIDATION", cardGrade: st === "READY_TO_TRADE" ? "A3_SWING" : "WATCH",
    entryPrice: 764.53, originalTrigger: 764.53, structuralStop: 760.46, target1: 766.38, target2: 770, rewardRiskT1: 1.6, rewardRiskT2: 2.5,
    missingConditions: ["1H close above trigger"], whyNotReady: ["Waiting for a closed 1H candle"], nextAction: "Watch for a closed 1H breakout above 764.53.",
    passedRules: ["Daily regime ok"], weeklyRegime: "RED", dailyRegime: "PULLBACK_VALID", dataStatus: "OK", lastCompletedBar1H: null });

  for (const st of SETUP_STATUSES) {
    it(`${st}: no hard block, legacy kept, no forbidden phrase in status fields`, () => {
      const c: any = alignCard(legacy, dec(st));
      expect(c.hard_blocks).toEqual([]);
      expect(c.legacy.hard_blocks.length).toBe(1);
      expect(c.unified.status).toBe(st);
      const text = [c.action, c.trigger, c.unified.label, c.risk_grade].join(" | ");
      for (const f of FORBIDDEN_PHRASES[st as keyof typeof FORBIDDEN_PHRASES]) expect(text).not.toContain(f);
    });
  }
  it("READY maps to a ready state with unified levels; forming maps to watch, not stand down", () => {
    const r: any = alignCard(legacy, dec("READY_TO_TRADE"));
    expect(r.state).toBe("STANDARD_READY"); expect(r.stop.price).toBe(760.46); expect(r.target_1.price).toBe(766.38);
    const f: any = alignCard(legacy, dec("SETUP_FORMING"));
    expect(f.state).toBe("FLEX_WATCH"); expect(f.action).toBe("SET ALERT"); expect(f.permission).toBe("FLEX_ONLY");
    const e: any = alignCard(legacy, dec("SIGNAL_EXPIRED"));
    expect(e.state).toBe("STANDBY");
  });
});
