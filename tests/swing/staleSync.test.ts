import { describe, it, expect } from "vitest";
process.env.DATABASE_URL ||= "postgres://x:y@127.0.0.1:1/none";

describe("Part 2 — timeframe-aware freshness without a live quote", async () => {
  const { closedBarFreshness, dataHealthOf, STALE_AFTER_SEC } = await import("../../server/swing/lifecycle");
  const { chicagoTs } = await import("../../server/swing/bars");
  const D = "2026-10-08"; // Thursday
  it("55 min into the next 1H bar, the feed holding the last closed bar is current (0 missed)", () => {
    expect(closedBarFreshness(chicagoTs(D, 625), chicagoTs(D, 570))).toEqual({ missed: 0, expectedEnd: chicagoTs(D, 570) });
  });
  it("one missing closed bar → 1 missed (DELAYED); two → STALE", () => {
    expect(closedBarFreshness(chicagoTs(D, 640), chicagoTs(D, 570)).missed).toBe(1);
    expect(closedBarFreshness(chicagoTs(D, 700), chicagoTs(D, 570)).missed).toBe(2);
  });
  it("grace: 3 minutes after the close the bar is not yet expected", () => {
    expect(closedBarFreshness(chicagoTs(D, 633), chicagoTs(D, 570)).missed).toBe(0);
    expect(closedBarFreshness(chicagoTs(D, 638), chicagoTs(D, 570)).missed).toBe(1);
  });
  it("overnight / pre-market / weekend: last 3:00 PM close is current", () => {
    expect(closedBarFreshness(chicagoTs(D, 1300), chicagoTs(D, 900)).missed).toBe(0);          // 9:40 PM
    expect(closedBarFreshness(chicagoTs("2026-10-09", 480), chicagoTs(D, 900)).missed).toBe(0); // next day 8:00 AM
    expect(closedBarFreshness(chicagoTs("2026-10-10", 720), chicagoTs("2026-10-09", 900)).missed).toBe(0); // Saturday
    expect(closedBarFreshness(chicagoTs("2026-10-12", 480), chicagoTs("2026-10-09", 900)).missed).toBe(0); // Monday pre-market
    expect(closedBarFreshness(chicagoTs("2026-10-12", 480), chicagoTs("2026-10-09", 870)).missed).toBe(1); // missing Friday's last bar
  });
  it("dataHealthOf: no quote + current closed bars → LIVE (was STALE after 40 min)", () => {
    const now = chicagoTs(D, 625); // 10:25 AM CT, last closed 1H ended 9:30
    const bar = (end: number) => ({ t: end - 3600, end, o: 1, h: 1, l: 1, c: 1, v: 1, closed: true } as any);
    const E: any = { now, quote: null, exchange: "", dataSource: "twelvedata", reference: null, settings: {} };
    const daily = [{ t: chicagoTs("2026-10-07", 510), o: 1, h: 1, l: 1, c: 1, v: 1 }] as any;
    const h = dataHealthOf(E, "XLV", [bar(chicagoTs(D, 570))], [], daily, { mismatch: null, verified: false });
    expect(h.status).toBe("LIVE"); expect(h.reason).toMatch(/closed-bar data/i);
    // Old behaviour check: a quote-less feed that is 2 bars behind is STALE.
    const stale = dataHealthOf({ ...E, now: chicagoTs(D, 700) }, "XLV", [bar(chicagoTs(D, 570))], [], daily, { mismatch: null, verified: false });
    expect(stale.status).toBe("STALE");
    // A live quote still uses the quote-age rule unchanged.
    const q = dataHealthOf({ ...E, quote: { price: 1, ts: now - STALE_AFTER_SEC - 60 } }, "XLV", [bar(chicagoTs(D, 570))], [], daily, { mismatch: null, verified: false });
    expect(q.status).toBe("STALE");
  });
});

describe("Part 2 — levels INVALID when the quote moves past the stop or T1", async () => {
  const { levelsInvalidOf } = await import("../../shared/swingDecision");
  const L = { entry: 170.47, stop: 165.1, t1: 176 };
  it("below stop → BELOW_STOP; past T1 → PAST_T1; in between → null", () => {
    expect(levelsInvalidOf({ setupStatus: "SETUP_CONFIRMED", currentPrice: 164.9 } as any, L)?.kind).toBe("BELOW_STOP");
    expect(levelsInvalidOf({ setupStatus: "READY_TO_TRADE", currentPrice: 176.2 } as any, L)?.kind).toBe("PAST_T1");
    expect(levelsInvalidOf({ setupStatus: "READY_TO_TRADE", currentPrice: 165.69 } as any, L)).toBeNull();
  });
  it("never for expired / no-trade cards, never without a price or entry, never says buy/sell", () => {
    expect(levelsInvalidOf({ setupStatus: "SIGNAL_EXPIRED", currentPrice: 100 } as any, L)).toBeNull();
    expect(levelsInvalidOf({ setupStatus: "NO_TRADE", currentPrice: 100 } as any, L)).toBeNull();
    expect(levelsInvalidOf({ setupStatus: "READY_TO_TRADE", currentPrice: null } as any, L)).toBeNull();
    expect(levelsInvalidOf({ setupStatus: "READY_TO_TRADE", currentPrice: 100 } as any, { ...L, entry: null })).toBeNull();
    const t = levelsInvalidOf({ setupStatus: "READY_TO_TRADE", currentPrice: 100 } as any, L)!.text;
    expect(t).not.toMatch(/buy now|sell now/i);
  });
});

describe("Part 2 — quote polling covers universe + custom symbols", async () => {
  const { addPollSymbols, WATCHED_SYMBOLS } = await import("../../server/priceService");
  it("adds XLE/XLV once; idempotent; strips exchange prefixes", () => {
    const before = WATCHED_SYMBOLS.length;
    expect(addPollSymbols(["XLE", "NYSEARCA:XLV", "SPY"])).toEqual(["XLE", "XLV"]);
    expect(addPollSymbols(["xle", "XLV"])).toEqual([]);
    expect(WATCHED_SYMBOLS.length).toBe(before + 2);
  });
});
