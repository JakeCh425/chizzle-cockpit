import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  isMarketOpen,
  getMarketStatus,
  getEtTimeParts,
  isUSMarketHoliday,
  getEasterSunday,
} from "../../client/src/lib/marketHours";

describe("Market Hours Logic & 'Market Closed' State Handling", () => {
  const marketHoursPath = path.resolve(__dirname, "../../client/src/lib/marketHours.ts");
  const marketHoursContent = fs.readFileSync(marketHoursPath, "utf-8").replace(/\r\n/g, "\n");

  const priceFeedPath = path.resolve(__dirname, "../../client/src/lib/priceFeed.ts");
  const priceFeedContent = fs.readFileSync(priceFeedPath, "utf-8").replace(/\r\n/g, "\n");

  const globalStatePath = path.resolve(__dirname, "../../client/src/lib/globalState.tsx");
  const globalStateContent = fs.readFileSync(globalStatePath, "utf-8").replace(/\r\n/g, "\n");

  const dashboardPath = path.resolve(__dirname, "../../client/src/pages/WealthEngineDashboard.tsx");
  const dashboardContent = fs.readFileSync(dashboardPath, "utf-8").replace(/\r\n/g, "\n");

  const appShellPath = path.resolve(__dirname, "../../client/src/components/AppShell.tsx");
  const appShellContent = fs.readFileSync(appShellPath, "utf-8").replace(/\r\n/g, "\n");

  describe("1. Market Hours Utility Function (isMarketOpen & Holiday Calendar)", () => {
    it("exports isMarketOpen, getMarketStatus, getEtTimeParts, and isUSMarketHoliday from marketHours and priceFeed", () => {
      expect(marketHoursContent).toContain("export function isMarketOpen");
      expect(marketHoursContent).toContain("export function getMarketStatus");
      expect(marketHoursContent).toContain("export function isUSMarketHoliday");
      expect(priceFeedContent).toContain("export { isMarketOpen");
    });

    it("evaluates true during US Regular Trading Hours (Mon-Fri 9:30 AM to 4:00 PM Eastern Time)", () => {
      // Monday 10:00 AM EDT (14:00 UTC)
      const openMonday = new Date("2026-10-26T14:00:00Z");
      expect(isMarketOpen(openMonday)).toBe(true);

      // Friday 2:30 PM EDT (18:30 UTC)
      const openFriday = new Date("2026-10-23T18:30:00Z");
      expect(isMarketOpen(openFriday)).toBe(true);

      // Exact market open 9:30 AM EDT (13:30 UTC)
      const exactOpen = new Date("2026-10-26T13:30:00Z");
      expect(isMarketOpen(exactOpen)).toBe(true);
    });

    it("evaluates false outside regular hours (pre-market, after-hours, and overnight)", () => {
      // Monday 9:29:59 AM EDT (Pre-market)
      const preMarket = new Date("2026-10-26T13:29:59Z");
      expect(isMarketOpen(preMarket)).toBe(false);

      // Monday 4:00:00 PM EDT (Exact close boundary)
      const atClose = new Date("2026-10-26T20:00:00Z");
      expect(isMarketOpen(atClose)).toBe(false);

      // Monday 6:00 PM EDT (After-hours)
      const afterHours = new Date("2026-10-26T22:00:00Z");
      expect(isMarketOpen(afterHours)).toBe(false);

      // Monday 11:30 PM EDT (Overnight)
      const overnight = new Date("2026-10-27T03:30:00Z");
      expect(isMarketOpen(overnight)).toBe(false);
    });

    it("evaluates false on weekends (Saturday and Sunday)", () => {
      // Saturday 12:00 PM EDT
      const saturday = new Date("2026-10-24T16:00:00Z");
      expect(isMarketOpen(saturday)).toBe(false);

      // Sunday 12:00 PM EDT
      const sunday = new Date("2026-10-25T16:00:00Z");
      expect(isMarketOpen(sunday)).toBe(false);
    });

    it("evaluates false on standard US equity market holidays", () => {
      // MLK Day (3rd Monday in Jan): Jan 19, 2026
      expect(isUSMarketHoliday(2026, 1, 19)).toBe(true);
      expect(isMarketOpen(new Date("2026-01-19T15:00:00Z"))).toBe(false);

      // Presidents' Day (3rd Monday in Feb): Feb 16, 2026
      expect(isUSMarketHoliday(2026, 2, 16)).toBe(true);
      expect(isMarketOpen(new Date("2026-02-16T15:00:00Z"))).toBe(false);

      // Good Friday (2 days before Easter): April 3, 2026
      expect(isUSMarketHoliday(2026, 4, 3)).toBe(true);
      expect(isMarketOpen(new Date("2026-04-03T15:00:00Z"))).toBe(false);

      // Memorial Day (Last Monday in May): May 25, 2026
      expect(isUSMarketHoliday(2026, 5, 25)).toBe(true);
      expect(isMarketOpen(new Date("2026-05-25T15:00:00Z"))).toBe(false);

      // Juneteenth (June 19, 2026)
      expect(isUSMarketHoliday(2026, 6, 19)).toBe(true);
      expect(isMarketOpen(new Date("2026-06-19T15:00:00Z"))).toBe(false);

      // Independence Day (July 4, 2026 is Sat -> observed Fri July 3)
      expect(isUSMarketHoliday(2026, 7, 3)).toBe(true);
      expect(isMarketOpen(new Date("2026-07-03T15:00:00Z"))).toBe(false);

      // Labor Day (1st Monday in Sep): Sep 7, 2026
      expect(isUSMarketHoliday(2026, 9, 7)).toBe(true);
      expect(isMarketOpen(new Date("2026-09-07T15:00:00Z"))).toBe(false);

      // Thanksgiving Day (4th Thursday in Nov): Nov 26, 2026
      expect(isUSMarketHoliday(2026, 11, 26)).toBe(true);
      expect(isMarketOpen(new Date("2026-11-26T15:00:00Z"))).toBe(false);

      // Christmas Day (Dec 25, 2026)
      expect(isUSMarketHoliday(2026, 12, 25)).toBe(true);
      expect(isMarketOpen(new Date("2026-12-25T15:00:00Z"))).toBe(false);
    });

    it("getMarketStatus returns structured telemetry with session and labels", () => {
      const sundayStatus = getMarketStatus(new Date("2026-10-25T16:00:00Z"));
      expect(sundayStatus.isOpen).toBe(false);
      expect(sundayStatus.session).toBe("WEEKEND");
      expect(sundayStatus.statusBadgeText).toBe("STATIC: LAST CLOSE");

      const openStatus = getMarketStatus(new Date("2026-10-26T15:00:00Z"));
      expect(openStatus.isOpen).toBe(true);
      expect(openStatus.session).toBe("REGULAR");
      expect(openStatus.statusBadgeText).toBe("LIVE");
    });
  });

  describe("2. Conditional Data Fetching (Live vs. Static)", () => {
    it("completely disables live WebSocket connection attempts when market is closed", () => {
      expect(priceFeedContent).toContain("if (!isMarketOpen()) {");
      expect(priceFeedContent).toContain("Disabling WebSocket connection attempts");
      expect(priceFeedContent).toContain("fetchLastOfficialClose()");
      expect(priceFeedContent).toContain('setConn("STATIC")');
    });

    it("disables background WebSocket reconnect intervals when market is closed", () => {
      expect(priceFeedContent).toContain("if (!isMarketOpen()) {");
      expect(priceFeedContent).toContain("if (ws) {");
      expect(priceFeedContent).toContain("ws.close();");
    });

    it("fetches Last Official Close via REST when market is closed and populates snapshot", () => {
      expect(priceFeedContent).toContain("export async function fetchLastOfficialClose()");
      expect(priceFeedContent).toContain("fetch(`${API_BASE}/api/prices`)");
      expect(priceFeedContent).toContain("setSnapshot(next);");
      expect(priceFeedContent).toContain('setConn("STATIC");');
    });

    it("disables simulated micro-ticks in globalState when market is closed to prevent artificial price drift", () => {
      expect(globalStateContent).toContain("isMarketOpen");
      expect(globalStateContent).toContain("if (!marketOpen) return;");
    });
  });

  describe("3. UI / Status Bar Clarity & Chart Animations", () => {
    it("renders STATIC: LAST CLOSE on the top status pill and changes color to gray/slate when market is closed", () => {
      expect(dashboardContent).toContain('data-testid="pill-feed-provider"');
      expect(dashboardContent).toContain("STATIC: LAST CLOSE");
      expect(dashboardContent).toContain("border-slate-700/60 bg-slate-900/80 text-slate-300");
      expect(dashboardContent).toContain("bg-slate-400 shadow-[0_0_6px_#94A3B8]");
      expect(dashboardContent).toContain("🟢 LIVE: WebSocket (Finnhub)");
    });

    it("removes the Live Bar tag from the chart OHLC legend and displays Last Close when market is closed", () => {
      expect(dashboardContent).toContain('data-testid="chart-ohlc-legend"');
      expect(dashboardContent).toContain('hoveredData?.candle ? "Hovered Bar" : isMarketOpenNow ? "Live Bar" : "Last Close"');
    });

    it("stops pulsing and animation on the active candlestick and chart badges when market is closed", () => {
      expect(dashboardContent).toContain('autoScroll && isMarketOpenNow ? "bg-cyan-400 animate-pulse shadow-[0_0_6px_#22D3EE]" : autoScroll ? "bg-cyan-400" : "bg-slate-500"');
      expect(dashboardContent).toContain('isMarketOpenNow ? "animate-pulse" : ""');
      expect(dashboardContent).toContain('{isMarketOpenNow ? "▲ GET IN · LIVE" : "▲ GET IN"}');
    });

    it("updates AppShell FeedBadge to show STATIC: LAST CLOSE with slate styling and no heartbeat when closed", () => {
      expect(appShellContent).toContain("data-testid=\"badge-feed-status\"");
      expect(appShellContent).toContain("STATIC: LAST CLOSE");
      expect(appShellContent).toContain("text-slate-300 border-slate-700/60 bg-slate-900/80");
      expect(appShellContent).toContain("isOpen && state === \"LIVE\" ? \"heartbeat\"");
    });
  });
});
