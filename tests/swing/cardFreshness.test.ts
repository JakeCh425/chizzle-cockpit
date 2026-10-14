// Card freshness (fix/card-freshness) — PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE.
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  computeCardFreshness, defaultCollapsed, replacesEngineStatus, splitOlder, violatesTradeableWording, sessionsBetween,
  NOT_TRADEABLE, FRESH_STATUS, STATE_LABEL, type FreshnessResult, type CollapsePref,
} from "@shared/cardFreshness";
import { FORBIDDEN_PHRASES, SETUP_STATUSES, phraseHit, practiceVerdict, type SwingDecision } from "@shared/swingDecision";
import { scoreBadgeText, scoreLabel, SCORE_BANDS } from "@shared/setupScore";

const SETTINGS = { minRrT1: 2, expiryBars4h: 2 as const };
const ATR = 1.25; // XLE ATR(14) used by the extension check
const TUE_1330 = new Date("2026-10-13T18:30:00Z"); // Tue 1:30 PM CT (CDT)
const WED_1205 = new Date("2026-10-14T17:05:00Z"); // Wed 12:05 PM CT

/** XLE — First Pullback After Breakout · 1H, as on the live card (Oct 14, 2026). */
const xle = (price: number, ageBars: { b1: number; b4: number }, over: Partial<SwingDecision> = {}): SwingDecision => ({
  symbol: "XLE", exchange: "NYSE", currentPrice: price, quoteTimestamp: WED_1205.toISOString(), dataStatus: "LIVE", session: "RTH", timezone: "America/Chicago",
  userMode: "PRACTICE", signalMode: "FLEXIBLE", weeklyRegime: "GREEN", weeklyReclaimForming: false, dailyRegime: "RECLAIMED",
  setupStatus: "READY_TO_TRADE", setupType: "FIRST_PULLBACK_AFTER_BREAKOUT" as any, cardGrade: "A2_PRACTICE", setupTimeframe: "1H", setupTimestamp: TUE_1330.toISOString(),
  originalTrigger: 66.9, currentTrigger: 66.9, entryPrice: 66.94, structuralStop: 65.82, stopBuffer: 0.05, target1: 69.18, target2: 70.3,
  riskPerShare: 1.12, rewardRiskT1: 2, rewardRiskT2: 3, maxDollarRisk: 50, suggestedShares: 44,
  supportZone: null, resistanceZone: null, reclaimLevel: null, retestLevel: { low: 66.94, high: 67.1 },
  extensionPercentAboveTrigger: null, extensionAtr: null, isExtended: false,
  extensionCheck: { quote: price, quoteAt: null, quoteIsLive: true, from: 66.94, fromLabel: "entry", pct: 0, maxPct: 1.5, atrMult: null, atrDollar: ATR, distance: 0, maxAtr: 0.5, atrRef: "ATR(14) daily", extended: false, by: [] },
  signalAge: { confirmedAt: TUE_1330.toISOString(), lastConfirmedAt: TUE_1330.toISOString(), reconfirmed: false, bars1h: ageBars.b1, bars4h: ageBars.b4, limit4h: 4, stale: false, priceVsEntry: price > 66.94 ? "ABOVE" : "AT" },
  volumeCondition: "NEUTRAL", dataMismatchReason: null, passedRules: [], failedRules: [], missingConditions: [], whyThisPrinted: [], whyNotReady: [], invalidation: [],
  nextAction: "Review the plan.", learningExplanation: "", riskLabel: "", expiryTime: null, dataSource: "test", lastCompletedBar1H: null, lastCompletedBar4H: null,
  referenceClose: null, referenceSource: null, evaluatedAt: WED_1205.toISOString(),
  ...over,
} as SwingDecision);

/** Every string a card / board row / banner can render from one freshness result. */
const renderedStrings = (f: FreshnessResult) => [f.displayStatus, f.confirmedAtText, f.resetConditionText, f.reasonSummary, f.sessionTag ?? "", f.aiTip ?? "",
  STATE_LABEL[f.state], ...f.checklist.flatMap((c) => [c.label, c.valueText ?? ""])].join(" \n ");

describe("card freshness — XLE Oct 14 replay", () => {
  it("test_xle_oct14_freshness_replay", () => {
    // Tue 13:30 close at the entry: fresh and tradeable.
    const tue = computeCardFreshness(xle(66.94, { b1: 0, b4: 0 }), 66.94, ATR, SETTINGS, { now: TUE_1330 });
    expect(tue.state).toBe("FRESH");
    expect(tue.isTradeable).toBe(true);
    expect(tue.plannedRr).toBe(2.0);
    expect(tue.liveRr).toBe(2.0);
    expect(tue.shouldCollapse).toBe(false);

    // Wed 12:05 at $67.58: the entry was missed.
    const d = xle(67.58, { b1: 4, b4: 1 });
    const wed = computeCardFreshness(d, 67.58, ATR, SETTINGS, { now: WED_1205 });
    expect(wed.state).toBe("MISSED_ENTRY");
    expect(wed.isTradeable).toBe(false);
    expect(wed.liveRr).toBe(0.91);
    expect(wed.displayStatus).toBe("NOT TRADEABLE YET — ENTRY MISSED, WAIT FOR RETEST");
    expect(wed.plannedRr).toBe(2.0);
    expect(wed.liveRiskPerShare).toBe(1.76);
    expect(wed.plannedRiskPerShare).toBe(1.12);
    expect(wed.extensionPct).toBeCloseTo(0.96, 2);
    expect(wed.retestZone).toEqual({ low: 66.94, high: 67.1 });
    expect(wed.ageBarsUsed).toBe(1); expect(wed.ageBarsTotal).toBe(4);
    expect(wed.confirmedAtText).toBe("Confirmed Tue 1:30 PM CT (1 trading session ago)");
    expect(wed.sessionTag).toBe("Older setup — from Tue");
    expect(wed.resetConditionText).toBe("Pullback to $66.94–$67.10 with a closed 1H reversal");
    expect(wed.aiTip).toBe("🤖 AI Tip: XLE is 1.0% above the $66.94 entry. Taking it here yields ~0.9R. Wait for the $66.94–$67.10 retest.");
    expect(wed.shouldCollapse).toBe(true);
    const byLabel = Object.fromEntries(wed.checklist.map((c) => [c.label, c.passed]));
    expect(byLabel["Live R:R ≥ 2.0R"]).toBe(false);
    expect(byLabel["Price within the entry buffer"]).toBe(false);
    expect(byLabel["Data is live"]).toBe(true);
    // Planned values are never mutated.
    expect(d.entryPrice).toBe(66.94); expect(d.structuralStop).toBe(65.82); expect(d.target1).toBe(69.18); expect(d.setupStatus).toBe("READY_TO_TRADE");
    // The engine said Ready, so the freshness wording replaces the green label.
    expect(replacesEngineStatus(d, wed)).toBe(true);
  });

  it("strict gate: price > entry × 1.002 is never tradeable even when live R:R still meets the minimum", () => {
    const d = xle(67.1, { b1: 1, b4: 0 }, { target1: 75 });
    const f = computeCardFreshness(d, 67.1, ATR, SETTINGS, { now: TUE_1330 });
    expect(f.liveRr!).toBeGreaterThanOrEqual(2);
    expect(f.isTradeable).toBe(false);
    expect(f.displayStatus).toBe(NOT_TRADEABLE.ENTRY_MISSED);
  });

  it("states: INVALIDATED (stop / T1), STALE (age, sessions, feed), EXPIRED, and live-blocked wording", () => {
    expect(computeCardFreshness(xle(65.7, { b1: 2, b4: 1 }), 65.7, ATR, SETTINGS, { now: WED_1205 }).state).toBe("INVALIDATED");
    expect(computeCardFreshness(xle(69.3, { b1: 2, b4: 1 }), 69.3, ATR, SETTINGS, { now: WED_1205 }).state).toBe("INVALIDATED");
    expect(computeCardFreshness(xle(66.94, { b1: 9, b4: 4 }), 66.94, ATR, SETTINGS, { now: WED_1205 }).state).toBe("STALE");
    expect(computeCardFreshness(xle(66.94, { b1: 1, b4: 0 }), 66.94, ATR, SETTINGS, { now: new Date("2026-10-15T15:00:00Z") }).state).toBe("STALE"); // Thu: a full session passed
    const feed = computeCardFreshness(xle(66.94, { b1: 0, b4: 0 }, { dataStatus: "STALE" }), 66.94, ATR, SETTINGS, { now: TUE_1330 });
    expect(feed.state).toBe("STALE"); expect(feed.displayStatus).toBe(NOT_TRADEABLE.STALE_DATA);
    expect(computeCardFreshness(xle(66.94, { b1: 0, b4: 0 }, { setupStatus: "SIGNAL_EXPIRED" }), 66.94, ATR, SETTINGS, { now: TUE_1330 }).state).toBe("EXPIRED");
    const rr = computeCardFreshness(xle(66.94, { b1: 0, b4: 0 }, { target1: 68.5 }), 66.94, ATR, SETTINGS, { now: TUE_1330 });
    expect(rr.isTradeable).toBe(false); expect(rr.displayStatus).toBe(NOT_TRADEABLE.RR_BELOW(2));
    const building = computeCardFreshness(xle(66.94, { b1: 0, b4: 0 }, { setupStatus: "SETUP_FORMING" }), 66.94, ATR, SETTINGS, { now: TUE_1330 });
    expect(building.isTradeable).toBe(false); expect(building.displayStatus).toBe(NOT_TRADEABLE.BUILDING);
    const blocked = computeCardFreshness(xle(66.94, { b1: 0, b4: 0 }), 66.94, ATR, SETTINGS, { now: TUE_1330, liveAllowed: false });
    expect(blocked.isTradeable).toBe(true); expect(blocked.displayStatus).toBe(FRESH_STATUS.PRACTICE);
    expect(blocked.checklist.find((c) => c.label.startsWith("Market regime"))!.passed).toBe(false);
    expect(sessionsBetween(TUE_1330.getTime(), WED_1205.getTime())).toBe(1);
    expect(sessionsBetween(new Date("2026-10-16T18:00:00Z").getTime(), new Date("2026-10-19T15:00:00Z").getTime())).toBe(1); // Fri → Mon
  });
});

describe("vocabulary contract", () => {
  const STATUSES = SETUP_STATUSES as readonly SwingDecision["setupStatus"][];
  const UI = ["client/src/components/swing/TradingCard.tsx", "client/src/components/swing/SetupScore.tsx", "client/src/components/swing/ReadyNow.tsx",
    "client/src/components/swing/ActionCenter.tsx", "client/src/components/swing/TradeTicket.tsx", "client/src/components/DoTodayCard.tsx", "client/src/lib/freshness.ts"];

  it("test_forbidden_pass_contract", () => {
    for (const st of STATUSES) expect(FORBIDDEN_PHRASES[st]).toContain("PASS");
    // Whole-word, case-sensitive: the new wording "Doesn't pass requirements yet" and "passed" stay allowed.
    expect(phraseHit("Score 40 · PASS", "PASS")).toBe(true);
    expect(phraseHit("Score 40 · Doesn't pass requirements yet · CHECKS THAT PASSED", "PASS")).toBe(false);
    expect(phraseHit(NOT_TRADEABLE.REQUIREMENTS, "PASS")).toBe(false); // the approved negated status
    expect(phraseHit("D — PASS (risk)", "PASS")).toBe(true);
    // Evaluation strings: every freshness output across prices, ages and statuses.
    let n = 0;
    for (const st of STATUSES) for (const px of [65.5, 65.9, 66.5, 66.94, 67.0, 67.2, 67.58, 68.5, 69.5]) for (const b of [{ b1: 0, b4: 0 }, { b1: 3, b4: 1 }, { b1: 12, b4: 4 }]) {
      for (const liveAllowed of [true, false, null]) {
        const f = computeCardFreshness(xle(px, b, { setupStatus: st }), px, ATR, SETTINGS, { now: WED_1205, liveAllowed });
        const txt = renderedStrings(f); n++;
        expect(phraseHit(txt, "PASS"), txt).toBe(false);
        // "READY" is never output when isTradeable === false.
        if (!f.isTradeable) expect(violatesTradeableWording(txt, false), `${st}@${px}: ${txt}`).toBe(false);
      }
    }
    expect(n).toBe(891);
    // Score badges (Priority Board & cards).
    for (let s = 0; s <= 100; s++) expect(phraseHit(scoreBadgeText(s), "PASS")).toBe(false);
    expect(scoreBadgeText(40)).toBe("Score 40 · Doesn't pass requirements yet");
    expect(scoreBadgeText(60)).toBe("Score 60 · Close — 1–2 requirements missing");
    expect(scoreBadgeText(74)).toBe("Score 74 · Close — 1–2 requirements missing");
    expect(scoreBadgeText(75)).toBe("Score 75 · Meets requirements");
    expect(SCORE_BANDS.map((b) => b.label).join(" ")).not.toMatch(/\bPASS\b/);
    expect(scoreLabel(59)).toBe("Doesn't pass requirements yet");
    // Practice Verdict D.
    const v = practiceVerdict(xle(66.94, { b1: 0, b4: 0 }, { setupStatus: "WATCH_RR_TOO_LOW" }));
    expect(v.headline).toBe("NOT TRADEABLE YET — Risk doesn't fit");
    for (const st of STATUSES) expect(practiceVerdict(xle(66.94, { b1: 0, b4: 0 }, { setupStatus: st })).headline).not.toMatch(/\bPASS\b/);
    // Rendered card / board / banner source: no "PASS" string literal anywhere in those files.
    for (const f of UI) {
      const src = readFileSync(path.resolve(__dirname, "../..", f), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(/["'`][^"'`\n]*\bPASS\b[^"'`\n]*["'`]/.test(src), f).toBe(false);
    }
    // Python Setup Board labels (same vocabulary).
    // Python Setup Board lives outside this repo; checked when the workspace copy is present.
    const pyPath = path.resolve(__dirname, "../../../chizzle_setup_board/chizzle_setup_board.py");
    if (existsSync(pyPath)) {
      const py = readFileSync(pyPath, "utf8");
      expect(py).toContain(`return "Doesn't pass requirements yet"`);
      expect(/["']PASS["']/.test(py)).toBe(false);
    }
  });
});

describe("auto-collapse contract", () => {
  it("test_auto_collapse_contract", () => {
    const missed = computeCardFreshness(xle(67.58, { b1: 4, b4: 1 }), 67.58, ATR, SETTINGS, { now: WED_1205 });
    const missedFirstBar = computeCardFreshness(xle(67.58, { b1: 0, b4: 0 }), 67.58, ATR, SETTINGS, { now: TUE_1330 });
    const fresh = computeCardFreshness(xle(66.94, { b1: 0, b4: 0 }), 66.94, ATR, SETTINGS, { now: TUE_1330 });
    const stale = computeCardFreshness(xle(66.94, { b1: 9, b4: 4 }), 66.94, ATR, SETTINGS, { now: WED_1205 });
    expect(missed.shouldCollapse).toBe(true);
    expect(missedFirstBar.state).toBe("MISSED_ENTRY");
    expect(missedFirstBar.shouldCollapse).toBe(false); // only after 1 closed bar
    expect(stale.shouldCollapse).toBe(true);
    expect(fresh.shouldCollapse).toBe(false);
    // ARMED / ACTIVE / pinned never auto-collapse.
    expect(defaultCollapsed(missed, {})).toBe(true);
    expect(defaultCollapsed(missed, { tradeStatus: "ARMED" })).toBe(false);
    expect(defaultCollapsed(missed, { tradeStatus: "ACTIVE" })).toBe(false);
    expect(defaultCollapsed(missed, { pinned: true })).toBe(false);

    type Row = { symbol: string; f: FreshnessResult; ts: string | null };
    const rows: Row[] = [{ symbol: "XLE", f: missed, ts: null }, { symbol: "SPY", f: fresh, ts: null }, { symbol: "QQQ", f: stale, ts: "ARMED" },
      { symbol: "SMH", f: missed, ts: "ACTIVE" }, { symbol: "IWM", f: stale, ts: null }, { symbol: "DIA", f: missed, ts: null }];
    const pref: CollapsePref = { section: true, cards: { "DIA#1": false } }; // the user expanded DIA → it stays visible
    const { older, active } = splitOlder(rows, (r) => `${r.symbol}#1`, (r) => r.f, pref, { pinned: new Set(["SMH"]), tradeStatusOf: (r) => r.ts });
    expect(older.map((r) => r.symbol).sort()).toEqual(["IWM", "XLE"]);
    expect(active.map((r) => r.symbol).sort()).toEqual(["DIA", "QQQ", "SMH", "SPY"]);
    // A user can also collapse a fresh card on purpose.
    const p2: CollapsePref = { section: false, cards: { "SPY#1": true } };
    expect(splitOlder(rows, (r) => `${r.symbol}#1`, (r) => r.f, p2, { tradeStatusOf: (r) => r.ts }).older.map((r) => r.symbol)).toContain("SPY");
  });
});

describe("R:R display", () => {
  it("never rounds a below-minimum live R:R up to the minimum", async () => {
    const { rrText } = await import("@shared/cardFreshness");
    expect(rrText(1.97, 2)).toBe("1.97"); expect(rrText(0.91, 2)).toBe("0.9"); expect(rrText(2.04, 2)).toBe("2.0"); expect(rrText(null, 2)).toBe("—");
  });
});
