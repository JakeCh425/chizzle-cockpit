// Parity: the cockpit's Setup Score must match the Swing Setup Board (chizzle_setup_board.py) exactly.
// Fixture = 48 cases (12 live Yahoo QQQ/SMH/XLV/XLE/SPY/NVDA Daily + 4H, 36 synthetic hammer/engulfing series),
// each scored by the Python board in partial and strict mode.
import { describe, it, expect } from "vitest";
import fx from "./fixtures/setupScoreParity.json";
import { scoreSetup, isHammer, isBullishEngulfing, scoreTrend, scoreVolume, scoreRr, rankScores, gradeOf, type ScoreBar } from "@shared/setupScore";

const bars = (rows: number[][] | null): ScoreBar[] => (rows ?? []).map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }));
const close = (a: number | null, b: number | null) => (a == null || b == null ? expect(a).toBe(b) : expect(a).toBeCloseTo(b, 4));

describe("Setup Score — parity with the Python Setup Board", () => {
  for (const cs of fx as any[]) for (const mode of ["partial", "strict"] as const) {
    it(`${cs.name} (${mode})`, () => {
      const e = cs.expect[mode];
      const s = scoreSetup(bars(cs.daily), cs.tf === "Daily" ? bars(cs.daily) : bars(cs.bars), cs.tf, mode === "strict");
      expect(s.score).toBe(e.score);
      expect(s.trigger).toBe(e.trigger);
      expect(s.status).toBe(e.status);
      close(s.trendPts, e.trend); close(s.volumePts, e.volume); close(s.rrPts, e.rr_pts);
      close(s.entry, e.entry); close(s.stop, e.stop); close(s.patternLow, e.pattern_low); close(s.resistance, e.resistance);
      close(s.rr, e.rr == null ? null : Math.round(e.rr * 100) / 100); close(s.volRatio, e.vol_ratio == null ? null : Math.round(e.vol_ratio * 100) / 100);
    });
  }
});

describe("Setup Score — rules", () => {
  it("patterns", () => {
    expect(isHammer(99.6, 100, 97, 99.9)).toBe(true);
    expect(isHammer(97.2, 100, 97, 99.9)).toBe(false);
    expect(isBullishEngulfing(101, 100, 99.8, 101.5)).toBe(true);
    expect(isBullishEngulfing(100, 101, 99.8, 101.5)).toBe(false);
  });
  it("blocks: trend 40, volume 30 at 1.5×, R:R 30 at 2.5:1, strict is all-or-nothing", () => {
    expect(scoreTrend(105, 103, 101, true)[0]).toBe(40);
    expect(scoreTrend(102, 103, 101, false)[0]).toBe(20);
    expect(scoreVolume(1.5, true)).toBe(30); expect(scoreVolume(1.49, true)).toBe(0); expect(scoreVolume(1.25, false)).toBeCloseTo(15);
    expect(scoreRr(2.5, true)).toBe(30); expect(scoreRr(1.75, false)).toBeCloseTo(15);
    expect([gradeOf(80), gradeOf(60), gradeOf(59)]).toEqual(["PRIORITY", "WATCH", "PASS"]);
  });
  it("stop = pattern low − 0.5 × ATR(14)", () => {
    const c = (fx as any[]).find((x) => x.expect.partial.trigger)!;
    const s = scoreSetup(bars(c.daily), bars(c.daily), "Daily", false);
    expect(s.stop).toBeCloseTo(Math.round((s.patternLow! - 0.5 * s.atr!) * 100) / 100, 1);
  });
  it("ranking: score, then R:R, then volume; data errors last", () => {
    const mk = (k: string, score: number, rr: number | null, err: string | null = null) => ({ k, setupScore: { score, rr, volRatio: 1, error: err } as any });
    expect(rankScores([mk("a", 40, 1), mk("b", 70, 1), mk("c", 70, 2), mk("d", 99, 3, "x")]).map((x) => x.k)).toEqual(["c", "b", "a", "d"]);
  });
  it("too little data is a DATA ERROR, never a score", () => {
    expect(scoreSetup([], [], "Daily").status).toBe("DATA ERROR");
  });
});
