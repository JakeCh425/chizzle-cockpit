// Chart Ecosystem Part 1 — Shared Market Context: formula parity, day levels, determinism, and the
// NO-CONTRADICTION contract (the same symbol shows the same values in every panel).
import { describe, it, expect } from "vitest";
process.env.DATABASE_URL ||= "postgres://x:y@127.0.0.1:1/none";
import {
  atrOf, bollingerSeries, buildMarketContext, dayLevels, emaSeries, macdSeries, rsiSeries, smaSeries, srLevels, priceVs,
  type CtxBar, type ContextTrade,
} from "@shared/marketContext";
import { sma, ema, atr } from "../../server/swing/candleMath";
import { rsi as clientRsi } from "../../client/src/lib/rsi";
import { evaluate } from "../../server/swing/lifecycle";
import { buildOverlay } from "../../server/swing/markers";
import { dailyRegime } from "../../server/swing/regime";
import { aggregate4H, chicagoTs, dailyClosed, tag1H } from "../../server/swing/bars";
import { flat, type OHLC } from "../fixtures/builders";
import { raw1HFrom4H, raw1H, scale, dailySeries, settings, upTo } from "../fixtures/replay";
import { activeVersion, effectivePlan, setupIdOf, type PlanVersion } from "@shared/practicePlan";
import { buildTradeSummary } from "@shared/tradeSummary";
import { STATUS_LABEL, type SwingDecision } from "@shared/swingDecision";
import { engineNowSays } from "@shared/swingTrades";
import type { SwingBar } from "../../server/swing/candleMath";

const K = 5.7, X = 570;
const below: OHLC[] = Array.from({ length: 6 }, (_, i) => [99.4, 99.6, 99.0, 99.3 - (i % 2) * 0.1] as OHLC);
const base = raw1HFrom4H(scale([...flat(16), ...below, [99.3, 100.7, 99.2, 100.6]], K));
const rbEnd = base[base.length - 1].t + 3600;
const confirm: OHLC[] = [[100.5, 100.65, 100.35, 100.55], [100.55, 100.6, 100.2, 100.3], [100.3, 100.5, 100.25, 100.45], [100.45, 100.6, 100.4, 100.5], [100.5, 101.3, 100.45, 101.25]];
const smh = [...base, ...raw1H(scale(confirm, K), rbEnd)];
const post = smh.filter((b) => b.t >= rbEnd);
const NOW = post[4].t + 3600;
const daily = dailySeries(Array.from({ length: 140 }, (_, i) => X + Math.sin(i / 5) * 6 + i * 0.05));

const norm = (b: SwingBar & { closed?: boolean }): CtxBar => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v ?? 0, closed: b.closed ?? true });
function engine(now = NOW) {
  const res = evaluate({ symbol: "SMH", exchange: "NASDAQ", bars1h: upTo(smh, now), daily, settings: settings(), now, dataSource: "fixture" });
  const decision: SwingDecision = { ...res.decision, chart: buildOverlay(res, { scope: "CURRENT" }) }; // = scanDecisionOf
  const h1 = tag1H(upTo(smh, now), now, true).map(norm);
  const d = daily.map((b) => norm({ ...b, closed: dailyClosed(b, now) }));
  return { res, decision, h1, d, h4: aggregate4H(upTo(smh, now), now).map(norm) };
}

describe("formula parity with the engine and chart", () => {
  const closes = daily.map((b) => b.c);
  it("SMA / EMA / ATR match candleMath; RSI matches client lib/rsi", () => {
    for (const n of [20, 50]) expect(smaSeries(closes, n).at(-1)).toBeCloseTo(sma(closes, n)!, 10);
    expect(emaSeries(closes, 12).at(-1)).toBeCloseTo(ema(closes, 12)!, 10);
    expect(atrOf(daily, 14)).toBeCloseTo(atr(daily, 14)!, 10);
    expect(rsiSeries(closes, 14)).toEqual(clientRsi(closes, 14));
  });
  it("daily ATR and SMA20 equal the engine's dailyRegime values", () => {
    const { d } = engine();
    const reg = dailyRegime(daily, NOW);
    const closed = d.filter((b) => b.closed);
    expect(atrOf(closed, 14)).toBeCloseTo(reg.atr!, 10);
    expect(Math.round(smaSeries(closed.map((b) => b.c), 20).at(-1)! * 100) / 100).toBe(reg.sma20);
  });
  it("Bollinger = SMA20 ± 2 population SD; MACD hist = line − signal", () => {
    const b = bollingerSeries(closes, 20, 2).at(-1)!, w = closes.slice(-20), mu = w.reduce((a, x) => a + x, 0) / 20;
    const sd = Math.sqrt(w.reduce((a, x) => a + (x - mu) ** 2, 0) / 20);
    expect(b.m).toBeCloseTo(mu, 10); expect(b.u).toBeCloseTo(mu + 2 * sd, 10); expect(b.l).toBeCloseTo(mu - 2 * sd, 10);
    const m = macdSeries(closes).at(-1)!; expect(m.hist).toBeCloseTo(m.macd - m.signal, 12);
  });
});

describe("day levels (HOD/LOD, PDH/PDL)", () => {
  const ymd = "2026-08-20", prev = "2026-08-19";
  const h = (min: number, hi: number, lo: number) => ({ t: chicagoTs(ymd, min), h: hi, l: lo });
  const dBar = (d: string, hi: number, lo: number) => ({ t: Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8)) / 1000, h: hi, l: lo });
  const days = [dBar(prev, 105, 98), dBar(ymd, 104, 99)];
  it("LIVE during RTH: 1H bars + quote extend the range; prior day from the daily bar", () => {
    const r = dayLevels([h(510, 101, 99.5), h(570, 102, 100)], days, { price: 102.6, ts: chicagoTs(ymd, 620) }, chicagoTs(ymd, 621));
    expect(r).toMatchObject({ sessionDate: ymd, state: "LIVE", hod: 102.6, lod: 99.5, priorDate: prev, pdh: 105, pdl: 98 });
  });
  it("FIXED after 15:00 CT: the daily bar wins", () => {
    const r = dayLevels([h(510, 101, 99.5)], days, null, chicagoTs(ymd, 905));
    expect(r).toMatchObject({ state: "FIXED", hod: 104, lod: 99 });
  });
  it("pre-market is null unless extended bars are given (RTH remains the default)", () => {
    expect(dayLevels([h(510, 101, 99.5)], days, null, chicagoTs(ymd, 600)).premarket).toBeNull();
    expect(dayLevels([h(510, 101, 99.5)], days, null, chicagoTs(ymd, 600), [h(420, 100.4, 99.8), h(480, 100.9, 100)]).premarket).toEqual({ high: 100.9, low: 99.8 });
  });
  it("priceVs wording", () => { expect(priceVs(99.7, 100)!.text).toBe("0.30% below"); expect(priceVs(100, 100)!.text).toBe("at"); });
});

describe("support / resistance", () => {
  it("top 3 each side, PDH/PDL as candidates, resistance above price and support below", () => {
    const { h4 } = engine();
    const sr = srLevels(h4, 575, [{ price: 590, source: "PDH", label: "Prior-day high" }, { price: 560, source: "PDL", label: "Prior-day low" }]);
    expect(sr.above.length).toBeLessThanOrEqual(3); expect(sr.below.length).toBeLessThanOrEqual(3);
    for (const l of sr.above) expect(l.price).toBeGreaterThan(575);
    for (const l of sr.below) expect(l.price).toBeLessThanOrEqual(575);
    for (const l of [...sr.above, ...sr.below]) { expect(l.strength).toBeGreaterThanOrEqual(0); expect(l.strength).toBeLessThanOrEqual(100); }
  });
});

describe("NO-CONTRADICTION contract — one symbol, same values in every panel", () => {
  const { decision, h1, d } = engine();
  const trade: ContextTrade = { id: 7, status: "ACTIVE", entry: 574.1, stop: 568.2, stopLimit: 567.06, t1: 586, t2: 592, shares: 2 };
  const alerts = [{ active: true, symbol: "SMH", type: "ENTRY_CROSS_UP", level: decision.entryPrice, levelHigh: null }, { active: false, symbol: "SMH", type: "STOP_BREAK", level: 1, levelHigh: null }];
  const mk = (selected?: Record<string, PlanVersion>) => buildMarketContext({ symbol: "SMH", tf: "D", now: NOW, bars: d, bars1h: h1, daily: d, dailyClosedBars: d.filter((b) => b.closed), decision, selected, trades: [trade], alerts, withSeries: true });
  const ctx = mk();

  it("the fixture is a live READY setup (so every panel has levels to compare)", () => {
    expect(decision.setupStatus).toBe("READY_TO_TRADE");
    expect(decision.entryPrice).not.toBeNull();
  });
  it("deterministic: the same inputs build an identical context", () => {
    const a = mk(), b = mk(); expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it("Scanner / Do Today / status pills: same status, label and next action as the scan decision", () => {
    expect(ctx.decision).toBe(decision);
    expect(ctx.panel.status).toBe(decision.setupStatus);
    expect(ctx.panel.statusLabel).toBe(STATUS_LABEL[decision.setupStatus]);
    expect(ctx.panel.nextAction).toBe(decision.nextAction); // doTodayLine(d) === d.nextAction (client + server)
    expect(ctx.panel.price).toBe(decision.currentPrice);
  });
  it("Trade Card / Trade Ticket / Practice Alerts: plan levels = effectivePlan(decision, selected version)", () => {
    const p = effectivePlan(decision, null);
    for (const k of ["entry", "stop", "stopLimit", "t1", "t2", "risk", "rrT1", "rrT2"] as const) expect(ctx.panel[k], k).toBe(p[k]);
    expect(ctx.panel.planSource).toBe("Engine Plan");
  });
  it("a selected My Adjusted Plan wins everywhere (same setup only)", () => {
    const v = { id: 1, symbol: "SMH", version: 3, setupId: setupIdOf(decision), selected: true,
      result: { entry: 575, stop: 569, stopLimit: 567.9, t1: 587, t2: 593, riskPerShare: 6, rrT1: 2, rrT2: 3, shares: 3 } } as unknown as PlanVersion;
    const c = mk({ SMH: v });
    expect(activeVersion(decision, { SMH: v })).toBe(v);
    expect(c.panel).toMatchObject({ entry: 575, stop: 569, t1: 587, t2: 593, planSource: "My Adjusted Plan v3" });
    const stale = mk({ SMH: { ...v, setupId: "OLD|4H|x" } as PlanVersion });
    expect(stale.panel.entry).toBe(decision.entryPrice); // an old-setup version never supplies levels
  });
  it("Trade Summary / AI Coach: prints the context plan levels, never a different T1", () => {
    const s = buildTradeSummary(decision, null, ctx.plan);
    const $ = (n: number | null) => (n == null ? "—" : `$${n.toFixed(2)}`);
    const planSec = s.sections.find((x) => /plan/i.test(x.title))!;
    expect(planSec.lines[0]).toContain(`entry ${$(ctx.panel.entry)}`);
    expect(planSec.lines[0]).toContain(`stop ${$(ctx.panel.stop)}`);
    expect(planSec.lines[1]).toContain(`Target 1 ${$(ctx.panel.t1)}`);
    expect(planSec.lines[1]).toContain(`Target 2 ${$(ctx.panel.t2)}`);
    if (s.brokerStep) expect(s.brokerStep.join(" ")).toContain(`profit target ${$(ctx.panel.t1)} (T1)`);
    // Engine structure targets appear only as a labelled readiness reference, never as "Target 1".
    if (decision.target1 != null && Math.abs(decision.target1 - ctx.panel.t1!) >= 0.005) expect(planSec.lines.join(" ")).toMatch(/Engine structure targets \(used for the readiness check\)/);
  });
  it("Trade Summary without a plan keeps its previous wording (flag-off path unchanged)", () => {
    const a = buildTradeSummary(decision, null), b = buildTradeSummary(decision, null, null);
    expect(a.text).toBe(b.text);
    expect(a.sections.find((x) => /plan/i.test(x.title))!.lines[0]).toMatch(/^Entry /);
  });
  it("Practice Alerts: only active alerts for this symbol, level and zone top (same rule as alertLevelsFor)", () => {
    expect(ctx.alerts).toEqual([{ price: decision.entryPrice, type: "ENTRY_CROSS_UP" }]);
  });
  it("My Trades / Journal: the open trade's locked levels are carried as-is; engine-now-says uses the same engine levels", () => {
    expect(ctx.trade).toEqual(trade);
    const now = engineNowSays(trade, { entry: decision.entryPrice, stop: decision.structuralStop, t1: decision.target1, t2: decision.target2 });
    expect(now.changed.length).toBeGreaterThan(0); // locked levels differ → info chip, never an overwrite
    expect(ctx.levels.filter((l) => l.source === "TRADE").map((l) => l.price)).toEqual([574.1, 568.2, 586]);
  });
  it("Chart: indicator series last values equal the snapshot readout (one computation)", () => {
    const sr = ctx.series!, ind = ctx.indicators;
    expect(sr.sma20.at(-1)).toBe(ind.sma20); expect(sr.sma50.at(-1)).toBe(ind.sma50);
    expect(sr.rsi.at(-1)).toBe(ind.rsi); expect(sr.hist.at(-1)).toBe(ind.macd!.hist);
    expect(sr.t).toEqual(ctx.bars!.map((b) => b.t));
  });
  it("Every level list entry is a finite price with a known source", () => {
    for (const l of ctx.levels) { expect(Number.isFinite(l.price)).toBe(true); expect(["PLAN", "TRADE", "ALERT", "DAY", "SR", "DRAWING"]).toContain(l.source); }
  });
  it("Flex Scanner (known, labelled difference): shows the engine's structure targets for the readiness check", async () => {
    const { alignCard } = await import("../../server/swing/flexAlign");
    const legacy: any = { state: "STANDBY", ticker: "SMH", permission: "LONG_OK", setup: "No trade", readiness_score: 50, distance_to_ready: [], trigger: "", entry_zone: { low: null, high: null, note: "" }, stop: { price: null, reason: "" }, target_1: { price: null, r_multiple: null }, risk_grade: "NO TRADE", fakeout_check: { result: "FAIL", reasons: [] }, action: "STAND DOWN", hard_blocks: [] };
    const c: any = alignCard(legacy, decision);
    expect(c.stop.price).toBe(ctx.decision.structuralStop);
    expect(c.unified.status).toBe(ctx.panel.status);
    expect(c.target_1.price).toBe(decision.target1); // engine structure T1 (may differ from the plan's Fixed-R T1)
  }, 15000);
});
