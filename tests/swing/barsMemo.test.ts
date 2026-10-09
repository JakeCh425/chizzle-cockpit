import { describe, it, expect, vi } from "vitest";
process.env.DATABASE_URL ||= "postgres://x:y@127.0.0.1:1/none";
const calls: string[] = [];
vi.mock("../../server/priceService", () => ({
  fetchTwelveDataOHLCBars: async () => null,
  fetchYahooBarsOHLC: async (sym: string, interval: string, opts?: { priority?: boolean }) => {
    calls.push(`${sym}:${interval}:${opts?.priority ? "P" : "n"}`);
    await new Promise((r) => setTimeout(r, 20));
    const n = interval === "1d" ? 80 : 60;
    return Array.from({ length: n }, (_, i) => ({ time: 1_700_000_000 + i * 3600, open: 10, high: 11, low: 9, close: 10.5, volume: 100 }));
  },
  fetchYahooQuote: async () => null, getQuote: () => null, yahooPrioritize: () => false,
}));
vi.mock("../../server/storage", () => ({ storage: {} }));

describe("Part 3 — bars memo: chart-first fetch and the evaluation share one vendor call", async () => {
  const feed = await import("../../server/swing/feed");
  it("concurrent + near-in-time calls for the same symbol/timeframe hit the vendor once", async () => {
    calls.length = 0;
    const [a, b] = await Promise.all([feed.fetchDaily("XLV", { priority: true }), feed.fetchDaily("XLV")]);
    const c = await feed.fetchDaily("xlv");
    expect(a.bars.length).toBe(80); expect(b).toBe(a); expect(c).toBe(a);
    expect(calls).toEqual(["XLV:1d:P"]); // the first (priority) request is the one that reached the vendor
  });
  it("different timeframes and symbols are separate entries", async () => {
    calls.length = 0;
    await Promise.all([feed.fetch1H("XLE"), feed.fetchDaily("XLE"), feed.fetch1H("XLE")]);
    expect(calls.sort()).toEqual(["XLE:1d:n", "XLE:1h:n"]);
  });
});
