import { describe, it, expect } from "vitest";
import { aggregate4H, tag1H, chicagoTs, chicago, aggregateWeekly, dailyClosed, filterRth, inRth } from "../../server/swing/bars";
import type { SwingBar } from "../../server/swing/candleMath";

const day = "2026-09-24"; // Thursday, CDT
const hourly = (ymd: string, startMin: number, endMin: number): SwingBar[] => {
  const out: SwingBar[] = [];
  for (let m = startMin, i = 0; m < endMin; m += 60, i++) out.push({ t: chicagoTs(ymd, m), o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i, v: 10 });
  return out;
};

describe("Chicago time", () => {
  it("round-trips wall clock in CDT and CST", () => {
    expect(chicago(chicagoTs("2026-09-24", 510))).toMatchObject({ ymd: "2026-09-24", minutes: 510, weekday: 4 });
    expect(chicago(chicagoTs("2026-11-09", 510))).toMatchObject({ ymd: "2026-11-09", minutes: 510, weekday: 1 });
    // 08:30 CDT = 13:30 UTC; 08:30 CST = 14:30 UTC
    expect(new Date(chicagoTs("2026-09-24", 510) * 1000).toISOString()).toBe("2026-09-24T13:30:00.000Z");
    expect(new Date(chicagoTs("2026-11-09", 510) * 1000).toISOString()).toBe("2026-11-09T14:30:00.000Z");
  });
});

describe("RTH 4H session bars (TradingView split)", () => {
  const bars = hourly(day, 450, 1020); // 07:30 … 16:30 incl. extended hours
  it("drops extended-hours bars", () => {
    expect(filterRth(bars).map((b) => chicago(b.t).minutes)).toEqual([510, 570, 630, 690, 750, 810, 870]);
  });
  it("builds 08:30–12:30 and 12:30–15:00 bars with correct OHLCV", () => {
    const four = aggregate4H(bars, chicagoTs(day, 960));
    expect(four).toHaveLength(2);
    const [a, b] = four;
    expect([chicago(a.t).minutes, chicago(a.end).minutes, a.parts]).toEqual([510, 750, 4]);
    expect([chicago(b.t).minutes, chicago(b.end).minutes, b.parts]).toEqual([750, 900, 3]);
    // RTH bars are index 1..7 of `bars` (07:30 dropped): o=101, h max, l min, c last
    expect([a.o, a.h, a.l, a.c, a.v]).toEqual([101, 105, 99 + 1, 104.5, 40]);
    expect([b.o, b.h, b.l, b.c, b.v]).toEqual([105, 108, 104, 107.5, 30]);
    expect(a.closed && b.closed).toBe(true);
  });
  it("marks the afternoon bar developing until 15:00 CT", () => {
    const four = aggregate4H(bars, chicagoTs(day, 899));
    expect(four.map((b) => b.closed)).toEqual([true, false]);
  });
  it("closes the last 1H bar (14:30) at 15:00, not 15:30", () => {
    const h = tag1H(bars, chicagoTs(day, 900));
    const last = h[h.length - 1];
    expect(chicago(last.end).minutes).toBe(900);
    expect(last.closed).toBe(true);
  });
  it("RTH window", () => {
    expect(inRth(chicagoTs(day, 509))).toBe(false);
    expect(inRth(chicagoTs(day, 510))).toBe(true);
    expect(inRth(chicagoTs(day, 900))).toBe(false);
  });
});

describe("weekly bars (spec §E: weekly confirms only after Friday RTH close)", () => {
  const utcMidnight = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return Date.UTC(y, m - 1, d) / 1000; };
  const week = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"].map((d, i) => ({ t: utcMidnight(d), o: 100 + i, h: 102 + i, l: 99 + i, c: 101 + i, v: 5 }));
  it("groups 00:00-UTC stamped daily bars into one Mon–Fri week", () => {
    const w = aggregateWeekly(week, chicagoTs("2026-09-25", 899));
    expect(w).toHaveLength(1);
    expect([w[0].o, w[0].h, w[0].l, w[0].c, w[0].v]).toEqual([100, 106, 99, 105, 25]);
  });
  it("is FORMING before Friday 15:00 CT and closed after", () => {
    expect(aggregateWeekly(week, chicagoTs("2026-09-25", 899))[0].closed).toBe(false);
    expect(aggregateWeekly(week, chicagoTs("2026-09-25", 900))[0].closed).toBe(true);
  });
  it("daily bar closes at 15:00 CT", () => {
    expect(dailyClosed(week[3], chicagoTs("2026-09-24", 899))).toBe(false);
    expect(dailyClosed(week[3], chicagoTs("2026-09-24", 900))).toBe(true);
  });
});
