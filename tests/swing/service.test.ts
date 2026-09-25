import { describe, it, expect } from "vitest";
process.env.DATABASE_URL ||= "postgres://x:y@127.0.0.1:1/none";
describe("service timing helpers", async () => {
  const { closeBoundaryNear, barKey } = await import("../../server/swing/service");
  const { chicagoTs } = await import("../../server/swing/bars");
  it("scheduler fires 2–7 min after each 1H close incl. the 15:00 half-hour close", () => {
    expect(closeBoundaryNear(572)).toBe(570);
    expect(closeBoundaryNear(577)).toBe(570);
    expect(closeBoundaryNear(578)).toBeNull();
    expect(closeBoundaryNear(571)).toBeNull();
    expect(closeBoundaryNear(873)).toBe(870);
    expect(closeBoundaryNear(903)).toBe(900);
    expect(closeBoundaryNear(933)).toBeNull();
    expect(closeBoundaryNear(512)).toBeNull();
  });
  it("barKey changes across an hour close and every 10 minutes", () => {
    const a = chicagoTs("2026-08-20", 565), b = chicagoTs("2026-08-20", 571);
    expect(barKey(a)).not.toBe(barKey(b));
    expect(barKey(b)).toBe(barKey(b + 60));
  });
});

describe("feed — Twelve Data ET wall-time fix", async () => {
  const { fixTwelveDataTs } = await import("../../server/swing/feed");
  const { chicagoTs } = await import("../../server/swing/bars");
  it("'2026-08-20 10:30' ET parsed as UTC → 09:30 CT", () => {
    expect(fixTwelveDataTs(Date.UTC(2026, 7, 20, 10, 30) / 1000)).toBe(chicagoTs("2026-08-20", 570));
  });
});
