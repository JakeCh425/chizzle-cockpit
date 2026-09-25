// PR 3a — contract tests for the shared SwingDecision object.
// These lock the "no contradiction" rules before any engine logic exists.
import { describe, it, expect } from "vitest";
import {
  SETUP_STATUSES, STATUS_PRIORITY, STATUS_LABEL, FORBIDDEN_PHRASES,
  readinessLabel, bucketOf, pickPrimary, DEFAULT_SWING_SETTINGS,
  DEFAULT_UNIVERSE, USER_MODE_DEFAULT_SIGNAL, splitSymbol,
  type SwingDecision, type SetupStatus,
} from "@shared/swingDecision";

const hasPhrase = (text: string, phrase: string) =>
  new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);

function stub(symbol: string, setupStatus: SetupStatus, extra: Partial<SwingDecision> = {}): SwingDecision {
  return {
    symbol, exchange: "NASDAQ", currentPrice: 100, quoteTimestamp: null, dataStatus: "LIVE",
    session: "RTH", timezone: "America/Chicago", userMode: "LEARN", signalMode: "FLEXIBLE",
    weeklyRegime: "NEUTRAL", weeklyReclaimForming: false, dailyRegime: "NEUTRAL",
    setupStatus, setupType: null, cardGrade: "WATCH", setupTimeframe: null, setupTimestamp: null,
    originalTrigger: null, currentTrigger: null, entryPrice: null, structuralStop: null, stopBuffer: null,
    target1: null, target2: null, riskPerShare: null, rewardRiskT1: null, rewardRiskT2: null,
    maxDollarRisk: 100, suggestedShares: null, supportZone: null, resistanceZone: null,
    reclaimLevel: null, retestLevel: null, extensionPercentAboveTrigger: null, extensionAtr: null,
    isExtended: false, volumeCondition: "NEUTRAL", dataMismatchReason: null,
    passedRules: [], failedRules: [], missingConditions: [], whyThisPrinted: [], whyNotReady: [],
    invalidation: [], nextAction: "x", learningExplanation: "", riskLabel: "", expiryTime: null,
    dataSource: null, lastCompletedBar1H: null, lastCompletedBar4H: null, referenceClose: null,
    referenceSource: null, evaluatedAt: new Date().toISOString(), ...extra,
  };
}

describe("status coverage", () => {
  it("every status has a priority, label, and forbidden-phrase list", () => {
    for (const s of SETUP_STATUSES) {
      expect(STATUS_PRIORITY[s], s).toBeTypeOf("number");
      expect(STATUS_LABEL[s], s).toBeTruthy();
      expect(Array.isArray(FORBIDDEN_PHRASES[s]), s).toBe(true);
    }
  });
});

describe("no-contradiction contract", () => {
  it("status labels never contain a phrase forbidden for that status", () => {
    for (const s of SETUP_STATUSES) {
      for (const p of FORBIDDEN_PHRASES[s]) expect(hasPhrase(STATUS_LABEL[s], p), `${s} label contains "${p}"`).toBe(false);
    }
  });
  it("Entry Readiness wording is capped by status at every score", () => {
    for (const s of SETUP_STATUSES) {
      for (const score of [0, 40, 60, 74, 75, 90, 100]) {
        const label = readinessLabel(score, s);
        for (const p of FORBIDDEN_PHRASES[s]) expect(hasPhrase(label, p), `${s}@${score}: "${label}" has "${p}"`).toBe(false);
      }
    }
  });
  it("high score + WATCH_EXTENDED says wait for retest (spec §K)", () => {
    expect(readinessLabel(82, "WATCH_EXTENDED")).toBe("Strong trend; no fresh entry — wait for retest.");
  });
  it("only READY_TO_TRADE may produce a 'Ready to Trade' label", () => {
    for (const s of SETUP_STATUSES) {
      if (s === "READY_TO_TRADE") continue;
      expect(hasPhrase(STATUS_LABEL[s], "Ready to Trade")).toBe(false);
    }
  });
});

describe("primary card priority (spec §C)", () => {
  it("orders READY > CONFIRMED > FORMING > RETEST > EXTENDED > STOP/RR > NO_TRADE", () => {
    const order: SetupStatus[] = ["READY_TO_TRADE", "SETUP_CONFIRMED", "SETUP_FORMING", "WATCH_RETEST", "WATCH_EXTENDED", "WATCH_STOP_TOO_WIDE", "NO_TRADE"];
    for (let i = 1; i < order.length; i++) expect(STATUS_PRIORITY[order[i - 1]]).toBeLessThan(STATUS_PRIORITY[order[i]]);
  });
  it("picks the highest-priority card across the universe", () => {
    const p = pickPrimary([stub("QQQ", "NO_TRADE"), stub("SMH", "WATCH_EXTENDED"), stub("SPY", "SETUP_FORMING")]);
    expect(p?.symbol).toBe("SPY");
  });
  it("tie-breaks on grade then R:R", () => {
    const p = pickPrimary([
      stub("QQQ", "READY_TO_TRADE", { cardGrade: "A3_SWING", rewardRiskT1: 3 }),
      stub("SMH", "READY_TO_TRADE", { cardGrade: "A4_CORE", rewardRiskT1: 2 }),
    ]);
    expect(p?.symbol).toBe("SMH");
  });
  it("returns null for empty universe", () => expect(pickPrimary([])).toBeNull());
});

describe("scanner buckets", () => {
  it("renames Hard Block outcomes into specific watch buckets", () => {
    expect(bucketOf("WATCH_EXTENDED")).toBe("EXTENDED");
    expect(bucketOf("WATCH_STOP_TOO_WIDE")).toBe("WATCH_RETEST");
    expect(bucketOf("WATCH_RR_TOO_LOW")).toBe("WATCH_RETEST");
    expect(bucketOf("SIGNAL_EXPIRED")).toBe("EXPIRED");
    expect(bucketOf("NO_SETUP")).toBe("NO_TRADE");
  });
});

describe("defaults (spec §A, §D, approved decisions)", () => {
  it("universe is SMH, QQQ, SPY exchange-qualified", () => {
    expect(DEFAULT_UNIVERSE).toEqual(["NASDAQ:SMH", "NASDAQ:QQQ", "AMEX:SPY"]);
    expect(splitSymbol("AMEX:SPY")).toEqual({ exchange: "AMEX", symbol: "SPY" });
  });
  it("Learn mode + Flexible, $100 risk, 1.0% / 1.25 ATR extension, RTH, Chicago, auto 1H refresh", () => {
    const d = DEFAULT_SWING_SETTINGS;
    expect([d.userMode, d.signalMode]).toEqual(["LEARN", "FLEXIBLE"]);
    expect(d.maxDollarRisk).toBe(100);
    expect(d.maxExtensionPct).toBe(1.0);
    expect(d.maxExtensionAtr).toBe(1.25);
    expect(d.rthOnly).toBe(true);
    expect(d.timezone).toBe("America/Chicago");
    expect(d.autoRefresh1H).toBe(true);
  });
  it("user modes map to spec signal-mode defaults", () => {
    expect(USER_MODE_DEFAULT_SIGNAL).toEqual({ LEARN: "FLEXIBLE", PRACTICE: "STANDARD", DISCIPLINED: "STANDARD" });
  });
});
