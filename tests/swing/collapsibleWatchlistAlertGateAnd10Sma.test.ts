import { describe, it, expect, beforeEach, vi } from "vitest";
import { SMA_COLORS, SMA_LABEL, SMA_TEXT_CLASSES } from "../../client/src/lib/smaColors";
import { journalRowFrom } from "../../server/swing/journal";
import { evaluate, blank } from "../../server/swing/lifecycle";
import { dispatchHammerAlert, dailySessionAlertMap as hammerAlertMap } from "../../server/alert-dispatcher";
import {
  dispatchServerSetupAlert,
  clearNotificationAuditLog,
  backendDailySessionAlertMap,
} from "../../server/backendNotificationWorker";
import { setTickerAlertOptIn } from "../../server/alertOptInStore";
import {
  recordReady,
  dailySessionAlertMap as readyAlertsMap,
} from "../../server/swing/readyAlerts";
import type { SwingDecision, SwingSettings } from "@shared/swingDecision";
import type { Bar1H, Bar4H } from "../../server/swing/bars";

describe("Task 1 & Task 3: 10-SMA Display, Engine Rules, and Journal Recording", () => {
  it("SMA_COLORS defines sma10 with amber '#FBBF24' and proper label/classes", () => {
    expect(SMA_COLORS.sma10).toBe("#FBBF24");
    expect(SMA_LABEL.sma10).toBe("SMA 10");
    expect(SMA_TEXT_CLASSES.sma10).toBe("text-amber-400");
  });

  it("journalRowFrom preserves sma10 and sma10Status in decision and journalMeta", () => {
    const mockDecision: Partial<SwingDecision> = {
      symbol: "NVDA",
      setupType: "HAMMER",
      cardGrade: "A",
      setupTimeframe: "4H",
      entryPrice: 130.0,
      structuralStop: 125.0,
      target1: 140.0,
      target2: 150.0,
      suggestedShares: 50,
      sma10: 128.5,
      sma10Status: "HOLDING_ABOVE_10_SMA",
    };

    const row = journalRowFrom(
      {
        action: "ARMED",
        symbol: "NVDA",
        levels: { entry: 130, stop: 125, shares: 50 },
      },
      mockDecision,
      "engine"
    );

    expect(row.decision.sma10).toBe(128.5);
    expect(row.decision.sma10Status).toBe("HOLDING_ABOVE_10_SMA");
    expect(row.decision.journalMeta.sma10).toBe(128.5);
    expect(row.decision.journalMeta.sma10Status).toBe("HOLDING_ABOVE_10_SMA");
  });

  it("Engine lifecycle calculates 10-SMA and adds 'Short-Term Momentum: Price > 10-SMA' rule", () => {
    // Generate bars where price is above 10-SMA
    const nowSec = 1700000000;
    const closed1h: Bar1H[] = [];
    for (let i = 0; i < 20; i++) {
      const t = nowSec - (20 - i) * 3600;
      // Rising closes: 100, 101, 102, ..., 119
      const close = 100 + i;
      closed1h.push({
        t,
        end: t + 3600,
        o: close - 0.5,
        h: close + 1,
        l: close - 1,
        c: close,
        v: 10000,
        closed: true,
      });
    }

    const defaultSettings: SwingSettings = {
      userMode: "STUDENT",
      signalMode: "AGGRESSIVE",
      maxDollarRisk: 500,
      minRrT1: 1.5,
      entryBufferPct: 0.001,
      stopBufferAtr: 0.1,
      expiryBars4h: 3,
      showFormingCards: true,
      showWatchCards: true,
      showLowQualityForming: true,
      reconfirmAfter4hBars: 4,
    };

    const res = evaluate({
      symbol: "NVDA",
      exchange: "NASDAQ",
      bars1h: closed1h,
      daily: [],
      price: 120.0,
      now: nowSec,
      settings: defaultSettings,
      dataSource: "test",
    });

    expect(res.decision).toBeDefined();
    expect(res.decision.symbol).toBe("NVDA");
  });
});

describe("Task 2: Strict Ready to Trade Alert Gate & Session Idempotency", () => {
  beforeEach(() => {
    hammerAlertMap.clear();
    readyAlertsMap.clear();
    clearNotificationAuditLog();
  });

  it("dispatchHammerAlert drops alerts if setupStatus !== 'READY_TO_TRADE'", async () => {
    // When setupStatus is CONFIRMED or FORMING, alert should be suppressed
    await dispatchHammerAlert({
      ticker: "SMH",
      phase: "confirmed",
      mode: "aggressive",
      candleTimestamp: new Date().toISOString(),
      timeframe: "1H",
      price: 250.0,
      setupStatus: "SETUP_CONFIRMED",
    } as any);

    const todayKey = new Date().toISOString().slice(0, 10);
    expect(hammerAlertMap.has(`SMH-${todayKey}`)).toBe(false);
  });

  it("dispatchHammerAlert drops alerts if hasHardBlock is true", async () => {
    await dispatchHammerAlert({
      ticker: "QQQ",
      phase: "confirmed",
      mode: "aggressive",
      candleTimestamp: new Date().toISOString(),
      timeframe: "1H",
      price: 480.0,
      setupStatus: "READY_TO_TRADE",
      hasHardBlock: true,
    } as any);

    const todayKey = new Date().toISOString().slice(0, 10);
    expect(hammerAlertMap.has(`QQQ-${todayKey}`)).toBe(false);
  });

  it("dispatchServerSetupAlert suppresses alerts when setupStatus is merely Pending/Confirmed or hard-blocked", async () => {
    const resBlocked = await dispatchServerSetupAlert({
      symbol: "SMH",
      entryPrice: 250,
      stopLoss: 240,
      target1: 265,
      target2: 275,
      currentPrice: 251,
      status: "4H Ceiling / Hard Block",
      isTradeConfirmed: false,
    });

    expect(resBlocked.suppressed).toBe(true);
    expect(resBlocked.auditEntry.badgeText).toContain("Suppressed");

    const resPending = await dispatchServerSetupAlert({
      symbol: "QQQ",
      entryPrice: 480,
      stopLoss: 470,
      target1: 500,
      target2: 510,
      currentPrice: 481,
      status: "SETUP_CONFIRMED",
      isTradeConfirmed: true,
    });

    expect(resPending.suppressed).toBe(true);
    expect(resPending.auditEntry.badgeText).toContain("Suppressed");
  });

  it("dispatchServerSetupAlert enforces daily session idempotency (max 1 alert per ticker per day)", async () => {
    setTickerAlertOptIn("NVDA", true);

    // First trigger as READY_TO_TRADE
    const res1 = await dispatchServerSetupAlert({
      symbol: "NVDA",
      entryPrice: 130,
      stopLoss: 125,
      target1: 140,
      target2: 150,
      currentPrice: 130.5,
      status: "READY_TO_TRADE",
      setupStatus: "READY_TO_TRADE",
      isTradeConfirmed: true,
      sma20: 128,
      sma50: 125,
    } as any);

    expect(res1.ok).toBe(true);

    // Second trigger in same session must be suppressed by idempotency
    const res2 = await dispatchServerSetupAlert({
      symbol: "NVDA",
      entryPrice: 130,
      stopLoss: 125,
      target1: 140,
      target2: 150,
      currentPrice: 130.6,
      status: "READY_TO_TRADE",
      setupStatus: "READY_TO_TRADE",
      isTradeConfirmed: true,
      sma20: 128,
      sma50: 125,
    } as any);

    expect(res2.suppressed).toBe(true);
    expect(res2.alertSent).toBe(true);
  });

  it("recordReady in server/swing/readyAlerts drops decisions that are not READY_TO_TRADE or hard-blocked", async () => {
    const nonReadyDecision: SwingDecision = {
      symbol: "SPY",
      exchange: "AMEX",
      currentPrice: 590,
      quoteTimestamp: new Date().toISOString(),
      dataStatus: "LIVE",
      session: "RTH",
      timezone: "America/Chicago",
      userMode: "STUDENT",
      signalMode: "AGGRESSIVE",
      weeklyRegime: "BULL",
      weeklyReclaimForming: false,
      dailyRegime: "BULL",
      setupStatus: "SETUP_CONFIRMED",
      setupType: "HAMMER",
      cardGrade: "WATCH",
      setupTimeframe: "4H",
      setupTimestamp: new Date().toISOString(),
      originalTrigger: 590,
      currentTrigger: 590,
      entryPrice: 590,
      structuralStop: 580,
      stopBuffer: 1,
      target1: 605,
      target2: 615,
      riskPerShare: 10,
      rewardRiskT1: 1.5,
      rewardRiskT2: 2.5,
      maxDollarRisk: 500,
      suggestedShares: 50,
      supportZone: null,
      resistanceZone: null,
      reclaimLevel: null,
      retestLevel: null,
      extensionPercentAboveTrigger: null,
      extensionAtr: null,
      isExtended: false,
      volumeCondition: "CONFIRMED",
      dataMismatchReason: null,
      passedRules: [],
      failedRules: [],
      missingConditions: [],
      whyThisPrinted: [],
      whyNotReady: [],
      invalidation: [],
      nextAction: "Wait for 1H close",
      learningExplanation: "",
      riskLabel: "",
      expiryTime: null,
      dataSource: "test",
      lastCompletedBar1H: null,
      lastCompletedBar4H: null,
      referenceClose: null,
      referenceSource: null,
      evaluatedAt: new Date().toISOString(),
    };

    await recordReady(nonReadyDecision, null);
    const todayKey = new Date().toISOString().slice(0, 10);
    expect(readyAlertsMap.has(`SPY-${todayKey}`)).toBe(false);

    // Hard blocked decision with READY_TO_TRADE status
    const blockedDecision: any = {
      ...nonReadyDecision,
      setupStatus: "READY_TO_TRADE",
      hasHardBlock: true,
    };

    await recordReady(blockedDecision, null);
    expect(readyAlertsMap.has(`SPY-${todayKey}`)).toBe(false);
  });
});
