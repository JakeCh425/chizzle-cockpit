import { describe, it, expect, vi } from "vitest";
process.env.DATABASE_URL ||= "postgres://x:y@127.0.0.1:1/none";
import { evaluate, signalAgeOf } from "../../server/swing/lifecycle";
import { flat, type OHLC } from "../fixtures/builders";
import { raw1HFrom4H, raw1H, scale, dailySeries, settings, upTo } from "../fixtures/replay";
import { earlyKey, earlyMessage, classifyEmail } from "@shared/readyAlerts";

// Same SMH replay as extension.test.ts: READY at the closed 1H momentum break.
const K = 5.7, X = 570;
const below: OHLC[] = Array.from({ length: 6 }, (_, i) => [99.4, 99.6, 99.0, 99.3 - (i % 2) * 0.1] as OHLC);
const base = raw1HFrom4H(scale([...flat(16), ...below, [99.3, 100.7, 99.2, 100.6]], K));
const rbEnd = base[base.length - 1].t + 3600;
const confirmRows: OHLC[] = [[100.5, 100.65, 100.35, 100.55], [100.55, 100.6, 100.2, 100.3], [100.3, 100.5, 100.25, 100.45], [100.45, 100.6, 100.4, 100.5], [100.5, 101.3, 100.45, 101.25]];
const smh = [...base, ...raw1H(scale(confirmRows, K), rbEnd)];
const daily = dailySeries(Array(140).fill(X));
const lastT = smh[smh.length - 1].t;
const run = (bars: typeof smh, now: number, over: any = {}) => evaluate({ symbol: "SMH", exchange: "NASDAQ", bars1h: upTo(bars, now), daily, settings: settings(over), now, dataSource: "fixture", quote: null }).decision;
const readyAt = lastT + 3600 + 600;
const trig = run(smh, readyAt).originalTrigger! / K;          // trigger in unscaled units

// Drift sideways ABOVE the trigger (never retests it) for ~2.5 trading days.
const hold: OHLC[] = Array.from({ length: 18 }, () => [101.05, 101.2, 100.95, 101.1] as OHLC);
const after = [...smh, ...raw1H(scale(hold, K), lastT + 3600)];
const endT = after[after.length - 1].t + 3600 + 600;

describe("signal age — Ready must re-confirm after 4 closed 4H bars", () => {
  it("fresh signal stays Ready and reports its age + price vs entry", () => {
    const d = run(smh, readyAt);
    expect(d.setupStatus).toBe("READY_TO_TRADE");
    expect(d.signalAge).toMatchObject({ reconfirmed: false, bars4h: 0, limit4h: 4, stale: false });
    expect(["ABOVE", "AT", "BELOW"]).toContain(d.signalAge!.priceVsEntry);
  });
  it("after 4 closed 4H bars with no retest → WATCH — RE-CONFIRM, levels unchanged", () => {
    const fresh = run(smh, readyAt);
    const r = evaluate({ symbol: "SMH", exchange: "NASDAQ", bars1h: upTo(after, endT), daily, settings: settings({}), now: endT, dataSource: "fixture", quote: null });
    const d = r.candidates.map((c) => c.decision).find((x) => x.setupTimestamp === fresh.setupTimestamp)!;   // same setup instance
    expect(d.signalAge!.bars4h).toBeGreaterThanOrEqual(4);
    expect(d.setupStatus).toBe("WATCH_RETEST");
    expect(d.riskLabel).toContain("RE-CONFIRM");
    expect(d.suggestedShares).toBe(0);
    expect([d.originalTrigger, d.entryPrice, d.structuralStop, d.target1]).toEqual([fresh.originalTrigger, fresh.entryPrice, fresh.structuralStop, fresh.target1]);
  });
  it("a retest that closes back above the trigger re-confirms (Ready again, new qualifying bar)", () => {
    const retest: OHLC[] = [[101.0, 101.05, trig - 0.05, trig + 0.25]];
    const bars = [...after, ...raw1H(scale(retest, K), after[after.length - 1].t + 3600)];
    const now = bars[bars.length - 1].t + 3600 + 300;
    const r = evaluate({ symbol: "SMH", exchange: "NASDAQ", bars1h: upTo(bars, now), daily, settings: settings({}), now, dataSource: "fixture", quote: null });
    // The retest either re-confirms the same setup or the engine re-detects a fresh setup at the retest;
    // either way the cockpit is Ready again with a NEW qualifying bar and a fresh (non-stale) age.
    expect(r.decision.setupStatus).toBe("READY_TO_TRADE");
    expect(r.decision.signalAge).toMatchObject({ stale: false, bars4h: 0 });
    const c = r.candidates.find((x) => x.decision.setupStatus === "READY_TO_TRADE")!;
    expect(c.events.reconfirm1h?.end ?? c.events.confirm1h?.end).toBeGreaterThan(bars[bars.length - 1].t);   // the retest bar itself
  });
  it("limit 0 switches the rule off", () => {
    const fresh = run(smh, readyAt);
    const r = evaluate({ symbol: "SMH", exchange: "NASDAQ", bars1h: upTo(after, endT), daily, settings: settings({ reconfirmAfter4hBars: 0 } as any), now: endT, dataSource: "fixture", quote: null });
    const d = r.candidates.map((c) => c.decision).find((x) => x.setupTimestamp === fresh.setupTimestamp)!;
    expect(d.setupStatus).toBe("READY_TO_TRADE");
    expect(d.signalAge!.stale).toBe(false);
  });
  it("signalAgeOf: retest-and-hold resets the clock; staying above does not", () => {
    const c1 = [{ t: 0, end: 10, l: 99, c: 101 }, { t: 10, end: 20, l: 100.5, c: 101 }, { t: 20, end: 30, l: 99.9, c: 100.3 }];
    const h4 = [{ end: 15 }, { end: 25 }, { end: 35 }];
    const a = signalAgeOf(c1, h4, 10, 100, 4);
    expect(a.reconfirm?.end).toBe(30);
    expect(a.bars4h).toBe(1);
    expect(signalAgeOf(c1.slice(0, 2), h4, 10, 100, 2)).toMatchObject({ reconfirm: null, bars4h: 3, stale: true });
  });
});

describe("30-minute heads-up (never Ready)", async () => {
  const svc = await import("../../server/swing/service");
  it("only runs 2–7 minutes after a mid-hour :00 CT boundary (9:00 … 2:00)", () => {
    expect(svc.midHourNear(542)).toBe(540);   // 9:02
    expect(svc.midHourNear(547)).toBe(540);
    expect(svc.midHourNear(548)).toBeNull();
    expect(svc.midHourNear(572)).toBeNull();  // 9:32 = 1H close, not mid-hour
    expect(svc.midHourNear(842)).toBe(840);   // 2:02 PM
    expect(svc.midHourNear(902)).toBeNull();  // after the close
  });
  it("flags a CONFIRMED setup whose 30m closes above trigger; attaches until the 1H closes; status untouched", async () => {
    const s = settings({ watchlist: [{ symbol: "QQQ", exchange: "NASDAQ" }] } as any);
    const day = "2026-10-07", t = (m: number) => Math.floor(Date.parse(`${day}T00:00:00-05:00`) / 1000) + m * 60;
    const d: any = { symbol: "QQQ", setupStatus: "SETUP_CONFIRMED", originalTrigger: 754.1, setupType: "HIGHER_LOW_CONSOLIDATION", setupTimeframe: "1H", setupTimestamp: "X", lastCompletedBar1H: new Date(t(570) * 1000).toISOString(), dataStatus: "LIVE" };
    svc._test.evalCache.set("QQQ", { res: { decision: d } } as any);
    const hits: any[] = []; svc.onEarlyLook((_d, e) => hits.push(e));
    const out = await svc.earlyLook30m(s, t(603), async () => ({ bars: [{ t: t(570), o: 754, h: 755.6, l: 753.9, c: 755.2, v: 1 }], source: "yahoo" } as any));
    expect(out).toEqual(["QQQ"]);
    expect(hits[0]).toMatchObject({ tf: "30m", close: 755.2, trigger: 754.1 });
    expect(svc.withEarly(d).earlyLook?.close).toBe(755.2);
    expect(svc.withEarly(d).setupStatus).toBe("SETUP_CONFIRMED");
    expect(svc.withEarly({ ...d, lastCompletedBar1H: new Date(t(630) * 1000).toISOString() }).earlyLook).toBeUndefined();
    expect(await svc.earlyLook30m(s, t(603), async () => ({ bars: [{ t: t(570), o: 754, h: 754.5, l: 753, c: 754.0, v: 1 }], source: "yahoo" } as any))).toEqual([]);
  });
  it("message says heads-up, not Ready, and carries the alert safety line", () => {
    const m = earlyMessage({ symbol: "QQQ", close: 755.2, trigger: 754.1, barEnd: "2026-10-07T15:00:00.000Z", oneHourCloseAt: "2026-10-07T15:30:00.000Z" });
    expect(m).toContain("HEADS-UP"); expect(m).toContain("Not a Ready signal"); expect(m).toContain("10:30 AM");
    expect(m).toContain("PRICE ALERT ONLY — VERIFY DATA AND REVIEW THE PLAN BEFORE ACTING.");
    expect(m.toLowerCase()).not.toMatch(/buy now|sell now/);
    expect(earlyKey("QQQ", "A", "B", "C")).toBe("EARLY|QQQ|A:B|C");
  });
  it("email errors map to the retry vocabulary", () => {
    expect(classifyEmail(undefined)).toBe("SENT");
    expect(classifyEmail("RESEND_API_KEY not set")).toBe("CONFIG_MISSING");
    expect(classifyEmail("Resend 429: slow down")).toBe("RATE_LIMITED");
    expect(classifyEmail("Resend 503: x")).toBe("NETWORK");
  });
});
