import { describe, it, expect } from "vitest";
import { evaluate, sessionEndAfter, type EvalInput } from "../../server/swing/lifecycle";
import { gradeReady, cardVisible } from "../../server/swing/grading";
import { weeklyRegime } from "../../server/swing/regime";
import { chicagoTs } from "../../server/swing/bars";
import { flat, type OHLC } from "../fixtures/builders";
import { raw1HFrom4H, raw1H, scale, dailySeries, settings, upTo } from "../fixtures/replay";
import { GAP_RISK_WARNING, FORBIDDEN_PHRASES, type SwingSettings } from "@shared/swingDecision";
import type { SwingBar } from "../../server/swing/candleMath";

const K = 5.7; // SMH ≈ 570
const X = 570;
const below: OHLC[] = Array.from({ length: 6 }, (_, i) => [99.4, 99.6, 99.0, 99.3 - (i % 2) * 0.1] as OHLC);
const base = raw1HFrom4H(scale([...flat(16), ...below, [99.3, 100.7, 99.2, 100.6]], K));
const rbEnd = base[base.length - 1].t + 3600;
const confirmRows: OHLC[] = [
  [100.5, 100.65, 100.35, 100.55], [100.55, 100.6, 100.2, 100.3], [100.3, 100.5, 100.25, 100.45],
  [100.45, 100.6, 100.4, 100.5], [100.5, 101.3, 100.45, 101.25],
];
const runRows: OHLC[] = [[101.25, 102.2, 101.2, 102.1], [102.1, 103.1, 102.0, 103.0], [103.0, 104.0, 102.9, 103.9], [103.9, 104.8, 103.8, 104.7], [104.7, 105.4, 104.6, 105.26]];
const smh = [...base, ...raw1H(scale([...confirmRows, ...runRows], K), rbEnd)];
const post = smh.filter((b) => b.t >= rbEnd);
const endOf = (b: SwingBar) => b.t + 3600;
const dailyFlat = dailySeries(Array(140).fill(X));
const dailyNeutralImproving = dailySeries([...Array(126).fill(X * 1.0015), ...Array(12).fill(X), X * 1.001, X * 1.002]);

const T = {
  forming: base[base.length - 2].t + 3600, // reclaim 4H bar still developing
  confirmed: rbEnd,                       // 4H closed, no 1H yet
  ready: endOf(post[4]),                  // closed 1H momentum break
  extended: endOf(post[9]),               // ran to ≈600
};

const run = (now: number, over: Partial<SwingSettings> = {}, extra: Partial<EvalInput> = {}, bars = smh, daily = dailyFlat) =>
  evaluate({ symbol: "SMH", exchange: "NASDAQ", bars1h: upTo(bars, now), daily, settings: settings(over), now, dataSource: "fixture", ...extra });

describe("fixture 1 — SMH 560→600 replay (§H)", () => {
  it("FORMING → CONFIRMED → READY → WATCH_EXTENDED with the original trigger and R:R preserved", () => {
    const f = run(T.forming).decision, c = run(T.confirmed).decision, r = run(T.ready).decision, e = run(T.extended);
    expect(f.setupStatus).toBe("SETUP_FORMING");
    expect(c.setupStatus).toBe("SETUP_CONFIRMED");
    expect(r.setupStatus).toBe("READY_TO_TRADE");
    expect(e.decision.setupStatus).toBe("WATCH_EXTENDED");
    expect(r.cardGrade).toBe("A2_PRACTICE"); // flat regime + Flexible default
    expect(r.suggestedShares).toBeGreaterThan(0);
    expect(e.decision.originalTrigger).toBe(r.originalTrigger);
    expect(e.decision.rewardRiskT1).toBe(r.rewardRiskT1);
    expect(e.decision.setupTimestamp).toBe(r.setupTimestamp);
    expect(e.decision.currentPrice!).toBeGreaterThan(599);
    expect(e.decision.extensionPercentAboveTrigger!).toBeGreaterThan(4);
    expect(e.decision.suggestedShares).toBe(0);
    expect(e.decision.retestLevel!.low).toBe(r.originalTrigger);
    expect(e.decision.nextAction).toMatch(/^Do not chase SMH\. Wait for retest zone [\d.]+–[\d.]+ and bullish 1H close\.$/);
    expect(e.decision.whyNotReady.join(" ")).toContain("Wait for 1H pullback/retest and closed bullish confirmation.");
    expect(e.log.reason).toMatch(/^SMH: .* Original trigger: [\d.]+\. Current price: [\d.]+, [\d.]+% above trigger\. Status: WATCH_EXTENDED\./);
  });

  it("a new pattern printed inside the extended run is hidden as a chase, but still logged", () => {
    const e = run(T.extended);
    const chase = e.candidates.filter((x) => x.hiddenWhy?.includes("chasing"));
    expect(chase.length).toBeGreaterThan(0);
    expect(e.log.setupsEvaluated.some((x) => x.hidden?.includes("chasing"))).toBe(true);
  });

  it("READY shows the §K line, the gap warning, and never a no-setup phrase", () => {
    const r = run(T.ready).decision;
    expect(r.nextAction).toBe("Practice plan is available. Review entry, stop, targets, and risk.");
    expect(r.whyThisPrinted).toContain(GAP_RISK_WARNING);
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/No Active Setup/i);
  });

  it("CONFIRMED and FORMING say what remains; never 'Ready to Trade'", () => {
    for (const now of [T.forming, T.confirmed]) {
      const d = run(now).decision;
      expect(d.nextAction).toMatch(/^Watch SMH for (a closed 1H breakout above|the 4H candle to close)/);
      expect(JSON.stringify(d)).not.toMatch(/Ready to Trade/i);
      expect(d.suggestedShares).toBeNull();
    }
  });
});

describe("fixture 2 — first pullback after breakout FORMING → READY", () => {
  const bo: OHLC = [100.4, 101.6, 100.3, 101.5];
  const b = raw1HFrom4H(scale([...flat(22), bo], K));
  const boEnd = b[b.length - 1].t + 3600;
  const bars = [...b, ...raw1H(scale([[101.5, 101.9, 101.3, 101.8], [101.8, 101.85, 101.1, 101.2], [101.2, 101.25, 100.7, 100.8], [100.8, 101.7, 100.72, 101.65], [101.65, 102.0, 101.6, 101.95]], K), boEnd)];
  const p = bars.filter((x) => x.t >= boEnd);
  const daily578 = dailySeries(Array(140).fill(578)); // keeps the ATR-vs-daily-SMA20 leg quiet
  const fp = (now: number, over: Partial<SwingSettings> = {}) => run(now, over, {}, bars, daily578).candidates
    .filter((x) => x.detection.type === "FIRST_PULLBACK_AFTER_BREAKOUT").sort((a, z) => a.detection.barTime! - z.detection.barTime!)[0]; // the original pullback
  it("pullback FORMING → reversal CONFIRMED → next closed 1H above the reversal high → READY (or a named WATCH)", () => {
    const f = fp(endOf(p[2]));
    expect(f?.decision.setupStatus).toBe("SETUP_FORMING");
    expect(fp(endOf(p[3]))?.decision.setupStatus).toBe("SETUP_CONFIRMED");
    const r = fp(endOf(p[4]), { minRrT1: 1.5 });
    expect(r).toBeDefined();
    expect(["READY_TO_TRADE", "WATCH_RR_TOO_LOW"]).toContain(r!.decision.setupStatus);
    if (r!.decision.setupStatus === "READY_TO_TRADE") expect(r!.decision.cardGrade).not.toBe("A4_CORE");
  });
  it("allowFirstPullback=false removes the candidate", () => {
    expect(fp(endOf(p[3]), { allowFirstPullback: false })).toBeUndefined();
  });
});

describe("fixture 9 — mode matrix: Weekly NEUTRAL, Daily NEUTRAL-improving, volume NEUTRAL", () => {
  const at = (over: Partial<SwingSettings>) => run(T.ready, { userMode: "PRACTICE", ...over }, {}, smh, dailyNeutralImproving).decision;
  it("Strict blocks, Standard → A3, Flexible → A2", () => {
    const strict = at({ signalMode: "STRICT" });
    expect(strict.setupStatus).not.toBe("READY_TO_TRADE");
    const std = at({ signalMode: "STANDARD" });
    expect(std.setupStatus).toBe("READY_TO_TRADE");
    expect(std.cardGrade).toBe("A3_SWING");
    const flex = at({ signalMode: "FLEXIBLE" });
    expect(flex.setupStatus).toBe("READY_TO_TRADE");
    expect(flex.cardGrade).toBe("A2_PRACTICE");
    expect(flex.riskLabel).toContain("FLEXIBLE / PRACTICE — REDUCED RISK");
  });
  it("a mode-blocked READY keeps the setup and says which rule blocked it", () => {
    const e = run(T.ready, { userMode: "PRACTICE", signalMode: "STRICT" }, {}, smh, dailyNeutralImproving);
    const blocked = e.candidates.find((x) => x.decision.failedRules.some((r) => r.includes("Strict")));
    expect(blocked).toBeDefined();
    expect(blocked!.decision.setupStatus).toBe("NO_TRADE");
    expect(blocked!.decision.originalTrigger).not.toBeNull();
    expect(blocked!.decision.whyNotReady.join(" ")).toMatch(/STRICT mode rules block it/);
  });
  it("require-volume toggle blocks A3 in Standard", () => {
    expect(at({ signalMode: "STANDARD", requireVolume: true }).setupStatus).not.toBe("READY_TO_TRADE");
  });
});

describe("grading (§J, §D, §E)", () => {
  const s = { allowCountertrend: false, requireVolume: false, requireWeeklyAlignment: false, requireDailyAlignment: false, allowEarlyTrigger: true };
  const g = (o: Partial<Parameters<typeof gradeReady>[0]>) => gradeReady({ signalMode: "STANDARD", userMode: "PRACTICE", settings: s, weekly: "GREEN", daily: "PULLBACK_VALID", dailyImproving: false, setupType: "RECLAIM_MOMENTUM_CONTINUATION", earlyTrigger: false, volume: "PASS", ...o });
  it("A4 when fully aligned", () => expect(g({}).grade).toBe("A4_CORE"));
  it("Early Trigger is never A4 and never allowed in Practice/Disciplined", () => {
    expect(g({ earlyTrigger: true }).ok).toBe(false);
    expect(g({ earlyTrigger: true, userMode: "DISCIPLINED" }).ok).toBe(false);
    const flex = g({ earlyTrigger: true, userMode: "LEARN", signalMode: "FLEXIBLE" });
    expect(flex.ok).toBe(true);
    expect(flex.grade).toBe("A2_PRACTICE");
    expect(flex.riskLabel).toContain("EARLY TRIGGER");
    expect(g({ earlyTrigger: true, userMode: "LEARN", signalMode: "FLEXIBLE", settings: { ...s, allowEarlyTrigger: false } }).ok).toBe(false);
  });
  it("Weekly RED: countertrend only when enabled, never in Strict", () => {
    expect(g({ weekly: "RED", signalMode: "FLEXIBLE" }).ok).toBe(false);
    expect(g({ weekly: "RED", signalMode: "FLEXIBLE", settings: { ...s, allowCountertrend: true } }).grade).toBe("A2_PRACTICE");
    expect(g({ weekly: "RED", signalMode: "STRICT", settings: { ...s, allowCountertrend: true } }).ok).toBe(false);
  });
  it("Flexible never grants A4 unless the A4 rules pass", () => {
    expect(g({ signalMode: "FLEXIBLE", daily: "NEUTRAL" }).grade).toBe("A2_PRACTICE");
    expect(g({ signalMode: "FLEXIBLE" }).grade).toBe("A4_CORE");
  });
  it("Disciplined hides low-quality forming cards unless enabled", () => {
    const base = { status: "SETUP_FORMING" as const, userMode: "DISCIPLINED" as const, showFormingCards: true, showWatchCards: true, weekly: "NEUTRAL" as const, daily: "NEUTRAL" as const, dailyImproving: false };
    expect(cardVisible(base).visible).toBe(false);
    expect(cardVisible({ ...base, showLowQualityForming: true }).visible).toBe(true);
    expect(cardVisible({ ...base, daily: "RECLAIMED" }).visible).toBe(true);
  });
  it("Disciplined + low-quality regime: forming card hidden, NO_TRADE card explains it (never silent)", () => {
    const d = run(T.forming, { userMode: "DISCIPLINED", signalMode: "STANDARD" }).decision;
    expect(d.setupStatus).toBe("NO_TRADE");
    expect(d.whyNotReady.join(" ")).toMatch(/hidden by your settings/);
    expect(d.nextAction).toMatch(/^No base\/reclaim setup\. Watch support/);
  });
});

describe("fixture 10/11 inside the lifecycle", () => {
  // A daily swing high just above entry caps T1 (T1 = nearest resistance).
  const bump = [...Array(120).fill(X), X * 0.995, X * 1.012, X * 0.995, ...Array(17).fill(X)];
  const dailyCap = dailySeries(bump);
  it("resistance below the min R:R → WATCH_RR_TOO_LOW naming the next resistance; lower min → READY", () => {
    const r = run(T.ready, { minRrT1: 2.5 }, {}, smh, dailyCap);
    expect(r.decision.setupStatus).not.toBe("READY_TO_TRADE");
    const low = r.candidates.find((x) => x.decision.setupStatus === "WATCH_RR_TOO_LOW");
    expect(low).toBeDefined();
    expect(low!.decision.whyNotReady[0]).toMatch(/R:R to T1 [\d.]+ < minimum 2.5 — next resistance [\d.]+/);
    expect(low!.decision.target1).toBeCloseTo(X * 1.012 * 1.0075, 0);
  });
  it("tiny max dollar risk → WATCH_STOP_TOO_WIDE, 0 shares, advice", () => {
    const r = run(T.ready, { maxDollarRisk: 1 });
    const w = r.candidates.find((x) => x.decision.setupStatus === "WATCH_STOP_TOO_WIDE");
    expect(w).toBeDefined();
    expect(w!.decision.suggestedShares).toBe(0);
    expect(w!.decision.whyNotReady.length).toBeGreaterThanOrEqual(2);
    expect(r.decision.setupStatus).not.toBe("READY_TO_TRADE");
  });
});

describe("fixture 12 — data mismatch (§M)", () => {
  const refFor = (now: number, pct: number) => {
    const last = upTo(smh, now).filter((b) => b.t + 3600 <= now).pop()!;
    return { symbol: "SMH", close: last.c * (1 + pct / 100), barEnd: last.t + 3600, source: "tradingview" };
  };
  it("0.2% close mismatch blocks READY and shows both values", () => {
    const d = run(T.ready, {}, { reference: refFor(T.ready, 0.2) }).decision;
    expect(d.setupStatus).toBe("BLOCKED_DATA_MISMATCH");
    expect(d.dataStatus).toBe("MISMATCH");
    expect(d.dataMismatchReason).toMatch(/close mismatch 0\.2\d% > 0\.15%.*engine [\d.]+ vs tradingview [\d.]+/);
  });
  it("forming cards stay visible during a mismatch", () => {
    const d = run(T.forming, {}, { reference: refFor(T.forming, 0.2) }).decision;
    expect(d.setupStatus).toBe("SETUP_FORMING");
    expect(d.dataStatus).toBe("MISMATCH");
  });
  it("0.1% agrees; fresh quote + verified reference → LIVE", () => {
    const d = run(T.ready, {}, { reference: refFor(T.ready, 0.1), quote: { price: 577.2, ts: T.ready - 60 } }).decision;
    expect(d.setupStatus).toBe("READY_TO_TRADE");
    expect(d.dataStatus).toBe("LIVE");
  });
  it("no reference → DELAYED (unverified), not blocking", () => {
    const d = run(T.ready).decision;
    expect(d.dataStatus).toBe("DELAYED");
    expect(d.setupStatus).toBe("READY_TO_TRADE");
  });
  it("symbol mismatch blocks", () => {
    const d = run(T.ready, {}, { reference: { ...refFor(T.ready, 0), symbol: "SOXX" } }).decision;
    expect(d.setupStatus).toBe("BLOCKED_DATA_MISMATCH");
  });
});

describe("fixture 13 — expiry and invalidation", () => {
  const stall = [...base, ...raw1H(scale(Array.from({ length: 14 }, () => [100.4, 100.6, 100.3, 100.45] as OHLC), K), rbEnd)];
  it("no closed 1H above trigger within expiryBars4h → SIGNAL_EXPIRED with why", () => {
    const now = sessionEndAfter(rbEnd, 2) + 3600;
    const r = run(now, {}, {}, stall);
    const exp = r.candidates.filter((x) => x.decision.setupStatus === "SIGNAL_EXPIRED");
    expect(exp.length).toBeGreaterThan(0);
    expect(exp[0].decision.whyNotReady[0]).toMatch(/^Expired .*no closed 1H above trigger/);
    expect(r.decision.setupStatus).not.toBe("READY_TO_TRADE");
  });
  it("a closed 1H below structure invalidates", () => {
    const dump = [...base, ...raw1H(scale([[100.5, 100.6, 98.5, 98.6], [98.6, 98.8, 98.3, 98.4]], K), rbEnd)];
    const r = run(rbEnd + 2 * 3600, {}, {}, dump);
    const inv = r.candidates.find((x) => x.decision.failedRules.some((f) => f.startsWith("invalidated")));
    expect(inv?.decision.setupStatus).toBe("SIGNAL_EXPIRED");
  });
  it("sessionEndAfter skips weekends", () => {
    const fri = chicagoTs("2026-08-21", 900); // Friday close
    expect(sessionEndAfter(fri, 1)).toBe(chicagoTs("2026-08-24", 750));
  });
});

describe("fixture 14 — no setup → NO_TRADE with levels, never silent", () => {
  it("names support/resistance and the missing ingredient", () => {
    const bleed: OHLC[] = Array.from({ length: 30 }, (_, i) => [130 - i * 0.5, 130.1 - i * 0.5, 129.4 - i * 0.5, 129.6 - i * 0.5]);
    const bars = raw1HFrom4H(bleed);
    const now = bars[bars.length - 1].t + 3600;
    const r = evaluate({ symbol: "QQQ", exchange: "NASDAQ", bars1h: bars, daily: [], settings: settings(), now });
    expect(r.decision.setupStatus).toBe("NO_TRADE");
    expect(r.decision.nextAction).toMatch(/^No base\/reclaim setup\. Watch support .* and resistance .*\.$/);
    expect(r.decision.missingConditions[0]).toMatch(/closed 4H base\/reclaim setup/);
    expect(r.log.setupsEvaluated.length).toBe(8);
  });
  it("insufficient bars → ERROR, NO_TRADE, explicit reason", () => {
    const r = evaluate({ symbol: "SPY", exchange: "NYSEARCA", bars1h: raw1HFrom4H(flat(3)), daily: [], settings: settings(), now: chicagoTs("2026-08-05", 900) });
    expect(r.decision.dataStatus).toBe("ERROR");
    expect(r.decision.whyNotReady[0]).toMatch(/Insufficient data/);
    expect(r.decision.nextAction.length).toBeGreaterThan(0);
  });
});

describe("fixture 15 — mid-week green week → WEEKLY RECLAIM FORMING", () => {
  it("current week above SMA20 but not closed → reclaimForming, regime unchanged", () => {
    const closes = [...Array(123).fill(X * 1.02), ...Array(12).fill(X * 0.97), X * 1.03, X * 1.035, X * 1.04];
    // 138 weekdays from Mon 2026-01-05 end on a Wednesday
    const d = dailySeries(closes);
    const lastDay = new Date(d[d.length - 1].t * 1000).toISOString().slice(0, 10);
    const wed = chicagoTs(lastDay, 960);
    const w = weeklyRegime(d, wed);
    expect(w.reclaimForming).toBe(true);
    expect(w.regime).not.toBe("GREEN");
    expect(w.reason).toContain("WEEKLY RECLAIM FORMING");
  });
});

describe("contract across every replay step", () => {
  it("every decision has a nextAction, the practice-only posture and no forbidden phrases", () => {
    for (const now of Object.values(T)) for (const mode of ["LEARN", "PRACTICE", "DISCIPLINED"] as const) {
      const d = run(now, { userMode: mode }).decision;
      expect(d.nextAction.length).toBeGreaterThan(0);
      const text = JSON.stringify(d);
      for (const p of FORBIDDEN_PHRASES[d.setupStatus] ?? []) expect(text, `${d.setupStatus}: ${p}`).not.toMatch(new RegExp(`\\b${p}\\b`, "i"));
    }
  });
});
