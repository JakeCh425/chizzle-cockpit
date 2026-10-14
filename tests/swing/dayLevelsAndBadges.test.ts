// Day levels declutter + live ticker corner badges (display only). PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE.
import { describe, expect, it } from "vitest";
import { BRACKET_BARS, dayChipText, dayRaySpan, GUTTER_MIN_GAP, layoutGutter, srBandAlpha, touchesAny } from "../../shared/chartFocus";
import { badgeModel, badgeTooltip, marketSession } from "../../shared/liveBadge";
import { ctParts, dayLevels } from "../../shared/marketContext";

// Wed Oct 14 2026, CT (CDT = UTC-5)
const ct = (h: number, m = 0) => Date.UTC(2026, 9, 14, h + 5, m);
const ymd = (t: number) => ctParts(t).ymd;

describe("dayLevelsAndBadges", () => {
  it("test_day_levels_embedded_button_text", () => {
    const day = { hod: 572.1, lod: 564.3, pdh: 569.8, pdl: 560.15, premarket: null };
    expect(dayChipText("hodlod", false, day, false)).toBe("-- HOD/LOD");
    expect(dayChipText("pdhpdl", false, day, false)).toBe("-- PDH/PDL");
    expect(dayChipText("hodlod", true, day, false)).toBe("HOD $572.10 · LOD $564.30");
    expect(dayChipText("pdhpdl", true, day, false)).toBe("PDH $569.80 · PDL $560.15");
    expect(dayChipText("hodlod", true, null, true)).toBe("HOD/LOD loading…");
    expect(dayChipText("pdhpdl", true, { ...day, pdh: null }, false)).toBe("PDH/PDL —");
    expect(dayChipText("pre", true, day, false)).toBe("no pre-market bars");
  });

  it("test_gutter_label_decollision", () => {
    const atr = 13.45;
    // HOD $568.40 sits within 0.25 ATR (3.36) of Near res $568.00 → both labels, ≥18 px apart, HOD above.
    expect(touchesAny(568.4, [568.0], atr)).toBe(true);
    expect(touchesAny(580, [568.0], atr)).toBe(false);
    const items = [
      { price: 568.0, y: 200, kind: "sr" as const },
      { price: 568.4, y: 199.5, kind: "day" as const, dayHigh: true },
      { price: 567.8, y: 200.4, kind: "day" as const, dayHigh: false }, // LOD-style → below
      { price: 590, y: 120, kind: "plan" as const },
    ];
    const pos = layoutGutter(items, { H: 400, atr });
    expect(pos[1]).toBeLessThan(pos[0]);          // day high above the S/R label
    expect(pos[2]).toBeGreaterThan(pos[0]);       // day low below it
    const sorted = [...pos].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(GUTTER_MIN_GAP);
    // Far-away label keeps its own spot.
    expect(pos[3]).toBe(120);
    // S/R dimming: non-touching bands drop to 20 % while a day range is active, restore otherwise.
    expect(srBandAlpha(0.2, { dayFocus: true, touching: false })).toBeCloseTo(0.04);
    expect(srBandAlpha(0.2, { dayFocus: true, touching: true })).toBe(0.2);
    expect(srBandAlpha(0.2, { dayFocus: false, touching: false })).toBe(0.2);
  });

  it("test_timeframe_clean_rays", () => {
    // 250 daily bars (≈ 1 year) → bracket over the last BRACKET_BARS candles only.
    const daily = Array.from({ length: 250 }, (_, i) => Math.floor(ct(8, 30) / 1000) - (249 - i) * 86400);
    for (const tf of ["D", "W"]) {
      const r = dayRaySpan(tf, daily, ymd(daily[249]), ymd)!;
      expect(r.bounded).toBe("BRACKET");
      expect(r.toIdx - r.fromIdx + 1).toBe(BRACKET_BARS);
      expect(BRACKET_BARS).toBeGreaterThanOrEqual(3);
      expect(BRACKET_BARS).toBeLessThanOrEqual(5);
    }
    // 1H bars across 3 sessions → ray starts at today's first RTH bar, never in prior days.
    const h1: number[] = [];
    for (const d of [12, 13, 14]) for (let h = 8; h <= 14; h++) h1.push(Math.floor(Date.UTC(2026, 9, d, h + 5, 30) / 1000));
    for (const tf of ["15m", "30m", "1H", "4H"]) {
      const r = dayRaySpan(tf, h1, "2026-10-14", ymd)!;
      expect(r.bounded).toBe("SESSION");
      expect(ymd(h1[r.fromIdx])).toBe("2026-10-14");
      expect(ymd(h1[r.fromIdx - 1])).toBe("2026-10-13");
      expect(r.toIdx).toBe(h1.length - 1);
    }
    // Session not on screen → a stub at the last bar, not a historical line.
    expect(dayRaySpan("1H", h1, "2026-10-15", ymd)).toEqual({ fromIdx: h1.length - 1, toIdx: h1.length - 1, bounded: "SESSION" });
    expect(dayRaySpan("D", [], null, ymd)).toBeNull();
  });

  it("test_live_ticker_badge_sync", () => {
    const now = ct(10, 15); // RTH
    const up = badgeModel({ symbol: "smh", price: 572.1, priorClose: 565.0, now });
    expect(up).toMatchObject({ symbol: "SMH", tone: "up", session: "LIVE", priceText: "$572.10", chgText: "+$7.10 (+1.26%)" });
    // Symbol change (watchlist click) → the same badge recomputes for the new symbol.
    const down = badgeModel({ symbol: "XLE", price: 66.1, priorClose: 67.0, now });
    expect(down).toMatchObject({ symbol: "XLE", tone: "down", chgText: "−$0.90 (−1.34%)" });
    expect(badgeModel({ symbol: "SPY", price: 600, priorClose: 600, now }).tone).toBe("flat");
    expect(badgeModel({ symbol: "SPY", price: 600, priorClose: null, now })).toMatchObject({ tone: "flat", chgText: "—" });
    // Session dot states.
    expect(marketSession(ct(7))).toBe("PRE");
    expect(marketSession(ct(16))).toBe("POST");
    expect(marketSession(ct(21))).toBe("CLOSED");
    expect(marketSession(Date.UTC(2026, 9, 17, 15))).toBe("CLOSED"); // Saturday
    expect(badgeModel({ symbol: "SPY", price: 1, priorClose: 1, now, dayState: "FIXED" }).session).toBe("CLOSED"); // holiday
    expect(badgeTooltip({ lod: 564.3, hod: 572.1, volume: 12_340_000, lastBar: "Oct 14, 9:30 AM CT", source: "yahoo" }))
      .toBe("Day Range: $564.30 – $572.10 · Vol: 12.3M · Last Bar: Oct 14, 9:30 AM CT · Source: yahoo");
    // priorClose flows from the prior daily bar.
    const t = (d: number) => Math.floor(Date.UTC(2026, 9, d, 5) / 1000);
    const dl = dayLevels([], [{ t: t(13), h: 570, l: 560, c: 565.0 }, { t: t(14), h: 573, l: 563, c: 572 }], null, ct(16));
    expect(dl.priorClose).toBe(565);
  });
});
