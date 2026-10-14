// Chart Ecosystem Parts 2–5 — day levels / pre-market, VWAP + custom params, drawings (validation, geometry,
// context levels), proximity tips (zones, wording contract, rate limit, NO-CONTRADICTION) and card contrast.
import { describe, it, expect } from "vitest";
process.env.DATABASE_URL ||= "postgres://x:y@127.0.0.1:1/none";
import { buildMarketContext, dayLevels, sanitizeParams, vwapSeries, priceVsDay, DEFAULT_INDICATORS, ctParts, type CtxBar, type MarketContext } from "@shared/marketContext";
import { drawingInput, drawingPatch, distToSegment, fibLevels, logicalToTime, timeToLogical, toContextDrawings, visibleOn, type ChartDrawing } from "@shared/chartDrawings";
import { DEFAULT_TIP_CONFIG, newTips, proximityTips, tipTextAllowed, tradingAreas, zoneOf } from "@shared/proximityTips";
import { CARD_BGS, bgContrast, bgFor, cardBgStyle, contrast, DEFAULT_CARD_STYLE } from "@shared/cardStyles";
import { FORBIDDEN_PHRASES, SETUP_STATUSES, type SetupStatus, type SwingDecision } from "@shared/swingDecision";
import { FORBIDDEN_ALERT_WORDS } from "@shared/priceAlerts";
import { evaluate } from "../../server/swing/lifecycle";
import { buildOverlay } from "../../server/swing/markers";
import { aggregate4H, dailyClosed, tag1H } from "../../server/swing/bars";
import { flat, type OHLC } from "../fixtures/builders";
import { raw1HFrom4H, raw1H, scale, dailySeries, settings, upTo } from "../fixtures/replay";
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
function engine() {
  const res = evaluate({ symbol: "SMH", exchange: "NASDAQ", bars1h: upTo(smh, NOW), daily, settings: settings(), now: NOW, dataSource: "fixture" });
  const decision: SwingDecision = { ...res.decision, chart: buildOverlay(res, { scope: "CURRENT" }) };
  const h1 = tag1H(upTo(smh, NOW), NOW, true).map(norm);
  const d = daily.map((b) => norm({ ...b, closed: dailyClosed(b, NOW) }));
  return { decision, h1, d, h4: aggregate4H(upTo(smh, NOW), NOW).map(norm) };
}
const E = engine();
const ctxOf = (over: Partial<Parameters<typeof buildMarketContext>[0]> = {}) => buildMarketContext({ symbol: "SMH", tf: "1H", now: NOW, bars: E.h1, bars1h: E.h1, daily: E.d, dailyClosedBars: E.d.filter((b) => b.closed), decision: E.decision, withSeries: true, ...over });
const withPrice = (c: MarketContext, price: number, lastClose?: number): MarketContext => ({ ...c, quote: { ...c.quote, price }, lastClosed: lastClose != null ? { t: c.lastClosed?.t ?? 0, c: lastClose } : c.lastClosed });
const withStatus = (c: MarketContext, st: SetupStatus): MarketContext => ({ ...c, decision: { ...c.decision, setupStatus: st }, panel: { ...c.panel, status: st } });

// ─── Part 2: day levels ─────────────────────────────────────────────────────
describe("Part 2 — HOD/LOD, PDH/PDL, pre-market", () => {
  const day0 = Date.UTC(2026, 9, 13, 13, 30) / 1000; // 08:30 CT (CDT = UTC-5)
  const rth = Array.from({ length: 7 }, (_, i) => ({ t: day0 + i * 3600, h: 101 + i * 0.2, l: 99.5 - (i === 3 ? 0.4 : 0), c: 100 }));
  const pre = [{ t: day0 - 3 * 3600, h: 103.5, l: 98.7 }, { t: day0 - 2 * 3600, h: 102.9, l: 99.1 }];
  const prev = { t: Date.UTC(2026, 9, 12, 5) / 1000, h: 102.2, l: 98.9 };
  it("RTH bars give HOD/LOD while live; pre-market comes only from extended bars before 08:30 CT", () => {
    const now = day0 + 4 * 3600 + 600;
    const dl = dayLevels(rth.slice(0, 5), [prev], { price: 100.4, ts: now }, now, [...pre, ...rth]);
    expect(dl.state).toBe("LIVE");
    expect(dl.hod).toBeCloseTo(101.8, 6); expect(dl.lod).toBeCloseTo(99.1, 6);
    expect(dl.premarket).toEqual({ high: 103.5, low: 98.7 });
    expect(dl.pdh).toBe(102.2); expect(dl.pdl).toBe(98.9);
    // Without extended bars → no premarket (RTH stays the default).
    expect(dayLevels(rth.slice(0, 5), [prev], null, now).premarket).toBeNull();
  });
  it("live quote extends HOD/LOD; priceVsDay reads the same numbers", () => {
    const now = day0 + 4 * 3600 + 600;
    const dl = dayLevels(rth.slice(0, 5), [prev], { price: 102.5, ts: now }, now);
    expect(dl.hod).toBe(102.5);
    const p = priceVsDay(101.15, { hod: 102.5, lod: 99.1 })!;
    expect(p.text).toMatch(/below HOD · .*above LOD · 60% of today's range/);
    expect(priceVsDay(null, dl)).toBeNull();
  });
  it("PDH/PDL become S/R candidates in the context", () => {
    const c = ctxOf();
    const all = [...c.sr.above, ...c.sr.below].map((l) => l.source);
    if (c.day.pdh != null || c.day.pdl != null) expect(all.some((s) => s === "PDH" || s === "PDL")).toBe(true);
    expect(c.levels.filter((l) => l.source === "DAY").length).toBeGreaterThan(0);
  });
});

// ─── Part 3: indicators ─────────────────────────────────────────────────────
describe("Part 3 — VWAP, params, ATR readout", () => {
  it("session VWAP resets on each Chicago date and equals Σ(tp·v)/Σv", () => {
    const t0 = Date.UTC(2026, 9, 13, 14) / 1000;
    const bars = [{ t: t0, h: 11, l: 9, c: 10, v: 100 }, { t: t0 + 3600, h: 13, l: 11, c: 12, v: 300 }, { t: t0 + 86400, h: 21, l: 19, c: 20, v: 50 }];
    const v = vwapSeries(bars);
    expect(v[0]).toBeCloseTo(10, 10); expect(v[1]).toBeCloseTo((10 * 100 + 12 * 300) / 400, 10); expect(v[2]).toBeCloseTo(20, 10);
    expect(ctParts(bars[2].t).ymd).not.toBe(ctParts(bars[0].t).ymd);
  });
  it("sanitizeParams clamps, keeps fast < slow, and defaults garbage", () => {
    expect(sanitizeParams(undefined)).toEqual(DEFAULT_INDICATORS);
    expect(sanitizeParams({ bb: { n: 5000, k: "x" } }).bb).toEqual({ n: 20, k: 2 });
    expect(sanitizeParams({ macd: { fast: 30, slow: 10, signal: 9 } }).macd).toEqual(DEFAULT_INDICATORS.macd);
    expect(sanitizeParams({ rsi: 7, bb: { n: 10, k: 1.5 } })).toMatchObject({ rsi: 7, bb: { n: 10, k: 1.5 } });
  });
  it("custom params change the indicator numbers but never the engine decision or plan", () => {
    const a = ctxOf(), b = ctxOf({ params: sanitizeParams({ rsi: 7, bb: { n: 10, k: 1.5 }, macd: { fast: 5, slow: 35, signal: 5 } }) });
    expect(b.indicators.rsi).not.toBe(a.indicators.rsi);
    expect(b.params!.rsi).toBe(7);
    expect(b.panel).toEqual(a.panel); expect(b.plan).toEqual(a.plan); expect(b.decision).toEqual(a.decision);
    expect(a.series!.vwap!.length).toBe(a.series!.t.length);
    expect(a.indicators.histPrev).not.toBeUndefined();
    expect(a.lastClosed?.c).toBeGreaterThan(0);
  });
});

// ─── Part 3: drawings ───────────────────────────────────────────────────────
describe("Part 3 — drawings", () => {
  const T = 1_760_000_000;
  it("validates every type (points count, text needs a label, colour format, tf visibility)", () => {
    expect(drawingInput.parse({ symbol: "xle", type: "HLINE", points: [{ price: 63.5, time: T }] })).toMatchObject({ symbol: "XLE", tfVisibility: ["ALL"], locked: false });
    expect(() => drawingInput.parse({ symbol: "XLE", type: "TREND", points: [{ price: 1, time: T }] })).toThrow();
    expect(() => drawingInput.parse({ symbol: "XLE", type: "TEXT", points: [{ price: 1, time: T }], label: "" })).toThrow();
    expect(() => drawingInput.parse({ symbol: "XLE", type: "HLINE", points: [{ price: 1, time: T }], color: "red" })).toThrow();
    expect(() => drawingInput.parse({ symbol: "XLE; DROP", type: "HLINE", points: [{ price: 1, time: T }] })).toThrow();
    for (const type of ["RAY", "RECT", "FIB"]) expect(drawingInput.parse({ symbol: "SPY", type, points: [{ price: 1, time: T }, { price: 2, time: T + 60 }] }).type).toBe(type);
    expect(drawingPatch.parse({ tfVisibility: ["1H", "D"] })).toEqual({ tfVisibility: ["1H", "D"] });
    expect(() => drawingPatch.parse({ tfVisibility: ["2H"] })).toThrow();
  });
  it("visibility per timeframe; fib levels from A → B", () => {
    expect(visibleOn({ tfVisibility: ["ALL"] }, "4H")).toBe(true);
    expect(visibleOn({ tfVisibility: ["1H"] }, "4H")).toBe(false);
    const f = fibLevels({ price: 100, time: T }, { price: 110, time: T + 1 });
    expect(f.find((x) => x.ratio === 0)!.price).toBe(110); expect(f.find((x) => x.ratio === 1)!.price).toBe(100);
    expect(f.find((x) => x.ratio === 0.618)!.price).toBeCloseTo(103.82, 2);
  });
  it("time anchors map across timeframes (interpolate + extrapolate) and round-trip", () => {
    const h1 = Array.from({ length: 10 }, (_, i) => T + i * 3600), d = Array.from({ length: 5 }, (_, i) => T + i * 86400);
    const t = T + 5.5 * 3600;
    expect(timeToLogical(h1, t)).toBeCloseTo(5.5, 6);
    expect(logicalToTime(h1, timeToLogical(h1, t)!)).toBe(t);
    expect(timeToLogical(d, t)).toBeGreaterThan(0); expect(timeToLogical(d, t)).toBeLessThan(1);
    expect(timeToLogical(h1, T + 12 * 3600)).toBeCloseTo(12, 6); // future → extrapolated
    expect(distToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distToSegment({ x: 20, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }, true)).toBe(0); // ray continues
  });
  it("horizontal lines and zones become context levels + S/R candidates; trend lines do not", () => {
    const ds: ChartDrawing[] = [
      { id: 1, symbol: "SMH", type: "HLINE", points: [{ price: 577.25, time: T }], color: "#ffffff", style: { width: 1, dash: "solid" }, label: "My line", tfVisibility: ["ALL"], locked: false },
      { id: 2, symbol: "SMH", type: "RECT", points: [{ price: 560.4, time: T }, { price: 556.1, time: T + 9 }], color: "#ffffff", style: { width: 1, dash: "solid" }, label: "", tfVisibility: ["ALL"], locked: false },
      { id: 3, symbol: "SMH", type: "TREND", points: [{ price: 1, time: T }, { price: 2, time: T + 9 }], color: "#ffffff", style: { width: 1, dash: "solid" }, label: "", tfVisibility: ["ALL"], locked: false },
    ];
    const cd = toContextDrawings(ds);
    expect(cd).toEqual([{ id: 1, type: "HLINE", label: "My line", price: 577.25, priceHigh: null }, { id: 2, type: "RECT", label: "", price: 556.1, priceHigh: 560.4 }]);
    const c = ctxOf({ drawings: cd });
    const dl = c.levels.filter((l) => l.source === "DRAWING").map((l) => l.price).sort();
    expect(dl).toEqual([556.1, 560.4, 577.25]);
    expect([...c.sr.above, ...c.sr.below].filter((l) => l.source === "DRAWING").length).toBeGreaterThan(0);
  });
});

// ─── Part 5: proximity tips ─────────────────────────────────────────────────
describe("Part 5 — proximity tips", () => {
  const c0 = ctxOf();
  it("zones: APPROACHING within the band, AT LEVEL inside the inner band, THROUGH after a cross since the last closed bar", () => {
    expect(zoneOf(99.6, 100, 99.2, 0.5, 0.125)).toBe("APPROACHING");
    expect(zoneOf(99.95, 100, 99.2, 0.5, 0.125)).toBe("AT_LEVEL");
    expect(zoneOf(100.3, 100, 99.2, 0.5, 0.125)).toBe("THROUGH");
    expect(zoneOf(98, 100, 99.2, 0.5, 0.125)).toBeNull();
    expect(zoneOf(100.3, 100, 100.4, 0.5, 0.125)).toBe("APPROACHING"); // same side as last close
  });
  it("close = max(pct %, atrMult × ATR); tips appear near an area and stay quiet far from all of them", () => {
    const areas = tradingAreas(c0);
    expect(areas.length).toBeGreaterThan(3);
    const lvl = areas.find((a) => a.kind === "STOP")!;
    const near = proximityTips(withPrice(c0, lvl.price * 1.002, lvl.price * 1.01), { ...DEFAULT_TIP_CONFIG, maxTips: 10 }, "PRACTICE", 0.01);
    expect(near.some((t) => t.area.kind === "STOP" || t.also.includes("your stop"))).toBe(true);
    const far = proximityTips(withPrice(c0, 10_000, 10_000), DEFAULT_TIP_CONFIG, "PRACTICE", 0.01);
    expect(far).toEqual([]);
  });
  it("each tip has what / watch / risk + mode-specific length (Learn longest, Disciplined shortest)", () => {
    const e = c0.plan.entry!;
    const ps = (m: "LEARN" | "PRACTICE" | "DISCIPLINED") => proximityTips(withPrice(c0, e * 0.997, e * 0.99), DEFAULT_TIP_CONFIG, m, 0.01)[0];
    const L = ps("LEARN"), P = ps("PRACTICE"), D = ps("DISCIPLINED");
    for (const t of [L, P, D]) { expect(t.what).toBeTruthy(); expect(t.watch).toBeTruthy(); expect(t.risk).toMatch(/GAP RISK/); }
    expect(L.text.length).toBeGreaterThan(P.text.length); expect(P.text.length).toBeGreaterThan(D.text.length);
  });
  it("merges a day level sitting on the stop: \"testing today's low … near your stop\"", () => {
    const stop = c0.plan.stop!;
    const c = { ...c0, day: { ...c0.day, lod: stop, hod: stop * 1.05 } };
    const t = proximityTips(withPrice(c, stop * 1.0003, stop * 1.01), DEFAULT_TIP_CONFIG, "PRACTICE", 0.01);
    expect(t[0].zone).toBe("AT_LEVEL");
    expect(t[0].what).toMatch(/your stop|today's low/);
  });
  it("rate limit: one tip per symbol per level per closed bar", () => {
    const e = c0.plan.entry!;
    const tips = proximityTips(withPrice(c0, e * 0.997, e * 0.99), DEFAULT_TIP_CONFIG, "PRACTICE", 0.01);
    const seen = new Set<string>();
    expect(newTips(tips, seen).length).toBe(tips.length);
    expect(newTips(tips, seen)).toEqual([]); // same bar → nothing new
    const next = { ...c0, lastClosedBar: "2099-01-01T00:00:00.000Z" };
    expect(newTips(proximityTips(withPrice(next, e * 0.997, e * 0.99), DEFAULT_TIP_CONFIG, "PRACTICE", 0.01), seen).length).toBeGreaterThan(0);
    expect(tips[0].key).toMatch(/^SMH\|[A-Z0-9]+\|\d+\.\d\d\|/);
  });
  it("NO-CONTRADICTION contract: for every status and every area/zone, tips obey the forbidden-phrase rules and carry the decision's status", () => {
    let n = 0;
    for (const st of SETUP_STATUSES as readonly SetupStatus[]) {
      const c = withStatus(c0, st);
      const areas = tradingAreas(c);
      if (st === "SIGNAL_EXPIRED" || st === "NO_SETUP" || st === "BLOCKED_DATA_MISMATCH") expect(areas.some((a) => a.kind === "ENTRY" || a.kind === "T1")).toBe(false);
      for (const a of areas) for (const [px, ref] of [[a.price * 0.997, a.price * 0.99], [a.price, a.price * 0.99], [a.price * 1.003, a.price * 0.99], [a.price * 0.997, a.price * 1.01]]) {
        for (const mode of ["LEARN", "PRACTICE", "DISCIPLINED"] as const) {
          for (const t of proximityTips(withPrice(c, px, ref), { ...DEFAULT_TIP_CONFIG, maxTips: 5 }, mode, 0.01)) {
            n++;
            expect(t.status).toBe(st);
            const all = [t.headline, t.text, t.what, t.watch, t.risk, t.learn].join(" ");
            for (const p of FORBIDDEN_PHRASES[st] ?? []) expect(all.toLowerCase()).not.toContain(p.toLowerCase());
            for (const r of FORBIDDEN_ALERT_WORDS) expect(r.test(all)).toBe(false);
            expect(all).not.toMatch(/buy now|sell now|place (an )?order|guaranteed/i);
            if (st !== "READY_TO_TRADE") expect(all).not.toMatch(/shares|position size|size up|full size/i);
            expect(tipTextAllowed(st, all)).toBe(true);
          }
        }
      }
    }
    expect(n).toBeGreaterThan(100);
  });
  it("tips are deterministic: same context → identical tips", () => {
    const e = c0.plan.entry!;
    const a = proximityTips(withPrice(c0, e * 0.998, e * 0.99)), b = proximityTips(withPrice(c0, e * 0.998, e * 0.99));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ─── Part 4: card backgrounds ───────────────────────────────────────────────
describe("Part 4 — card backgrounds", () => {
  it("9 options (Default + 8), pure CSS (no external URLs)", () => {
    expect(CARD_BGS.map((b) => b.id)).toEqual(["default", "aurora", "carbon", "glass", "grid", "neon", "steel", "ocean", "ember"]);
    for (const b of CARD_BGS) expect(b.background).not.toMatch(/url\((?!"data:image\/svg\+xml)/);
  });
  it("WCAG AA: text, muted and every status colour ≥ 4.5:1 on every stop of every background", () => {
    for (const b of CARD_BGS.filter((x) => x.id !== "default")) {
      for (const r of bgContrast(b)) expect(r.min, `${b.id} ${r.token}`).toBeGreaterThanOrEqual(4.5);
      expect(bgContrast(b).map((r) => r.token)).toEqual(expect.arrayContaining(["--ac-text", "--ac-muted", "--ac-good", "--ac-warn", "--ac-bad", "--ac-accent"]));
      // Primary button text (on-accent over accent) stays readable too.
      expect(contrast(b.tokens["--ac-on-accent"], b.tokens["--ac-accent"])).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("Default applies no style (existing look unchanged); per-state mapping works", () => {
    expect(cardBgStyle(bgFor(DEFAULT_CARD_STYLE, "READY"))).toEqual({});
    const p = { ...DEFAULT_CARD_STYLE, mode: "state" as const, READY: "aurora" as const, ACTIVE: "neon" as const, WATCH: "ember" as const };
    expect(bgFor(p, "READY").id).toBe("aurora"); expect(bgFor(p, "ACTIVE").id).toBe("neon"); expect(bgFor(p, "WATCH").id).toBe("ember");
    expect(bgFor({ ...p, mode: "all", all: "grid" }, "WATCH").id).toBe("grid");
  });
});
