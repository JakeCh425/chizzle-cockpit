import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Chart Cleanup & Wake-from-Sleep Auto-Refresh", () => {
  const swingChartPath = path.resolve(__dirname, "../../client/src/components/swing/SwingChart.tsx");
  const priceFeedPath = path.resolve(__dirname, "../../client/src/lib/priceFeed.ts");
  const wakeRefreshPath = path.resolve(__dirname, "../../client/src/lib/wakeRefresh.tsx");
  const appPath = path.resolve(__dirname, "../../client/src/App.tsx");

  const swingChartContent = fs.readFileSync(swingChartPath, "utf-8").replace(/\r\n/g, "\n");
  const priceFeedContent = fs.readFileSync(priceFeedPath, "utf-8").replace(/\r\n/g, "\n");
  const wakeRefreshContent = fs.readFileSync(wakeRefreshPath, "utf-8").replace(/\r\n/g, "\n");
  const appContent = fs.readFileSync(appPath, "utf-8").replace(/\r\n/g, "\n");

  describe("Task 1: Auto-Hide S/R Lines When SMAs are Active (Chart Cleanup)", () => {
    it("identifies 1H and 4H timeframes and checks SMA 20 / SMA 50 active status", () => {
      expect(swingChartContent).toContain('const is1Hor4H = tf === "1H" || tf === "4H"');
      expect(swingChartContent).toContain("const hasSmaActive = Boolean(ov.sma20 || ov.sma50)");
      expect(swingChartContent).toContain("const srEffective = ov.sr && !(is1Hor4H && hasSmaActive)");
    });

    it("auto-toggles S/R zones button OFF programmatically when on 1H or 4H with SMAs active", () => {
      expect(swingChartContent).toContain('(tf === "1H" || tf === "4H") && (ov.sma20 || ov.sma50) && ov.sr');
      expect(swingChartContent).toContain('setOv((prev) => ({ ...prev, sr: false }))');
    });

    it("toggles S/R zones button OFF when user turns SMA 20 or SMA 50 ON on 1H or 4H", () => {
      expect(swingChartContent).toContain('(k === "sma20" || k === "sma50") && !ov[k] && (tf === "1H" || tf === "4H")');
      expect(swingChartContent).toContain("setOv({ ...ov, [k]: true, sr: false })");
    });

    it("ties srLines calculation to srEffective to hide red/green Support and Resistance lines", () => {
      expect(swingChartContent).toContain("if (!ind.sr.on || !srEffective || !srCtx) return []");
    });

    it("ties horizontal S/R zones overlay to srEffective", () => {
      expect(swingChartContent).toContain("overlay.zones.filter((x) => x.current && (x.kind === \"RETEST\" ? ov.plan : srEffective))");
    });

    it("renders S/R zones button with srEffective active state and aria-pressed", () => {
      expect(swingChartContent).toContain("const isSr = k === \"sr\"");
      expect(swingChartContent).toContain("const active = isSr ? srEffective : ov[k]");
      expect(swingChartContent).toContain("aria-pressed={active}");
    });
  });

  describe("Task 2: 'Wake-from-Sleep' Auto-Refresh (Fix Stale Data)", () => {
    it("exports reconnectPriceFeed from priceFeed to close dead sockets and reconnect instantly", () => {
      expect(priceFeedContent).toContain("export function reconnectPriceFeed()");
      expect(priceFeedContent).toContain("ws.close()");
      expect(priceFeedContent).toContain('setConn("CONNECTING")');
      expect(priceFeedContent).toContain("connectWS()");
      expect(priceFeedContent).toContain("fallbackPollOnce()");
    });

    it("listens to document.visibilitychange Page Visibility API at root level", () => {
      expect(wakeRefreshContent).toContain('document.addEventListener("visibilitychange", handleVisibilityChange)');
      expect(wakeRefreshContent).toContain('document.visibilityState === "visible"');
    });

    it("triggers global hard refresh on wake from sleep or tab visibility restore", () => {
      expect(wakeRefreshContent).toContain("export async function triggerGlobalHardRefresh");
      expect(wakeRefreshContent).toContain("reconnectPriceFeed()");
      expect(wakeRefreshContent).toContain("forceRefreshPrice()");
    });

    it("re-fetches candlestick data via REST API for active charts to fill missing time gaps", () => {
      expect(wakeRefreshContent).toContain('key.startsWith("/api/swing/bars")');
      expect(wakeRefreshContent).toContain('key.startsWith("/api/candles")');
      expect(wakeRefreshContent).toContain("queryClient.invalidateQueries");
      expect(wakeRefreshContent).toContain("queryClient.refetchQueries");
    });

    it("shows a 'Syncing Data...' toast and visual glowing UI loader", () => {
      expect(wakeRefreshContent).toContain('title: "Syncing Data..."');
      expect(wakeRefreshContent).toContain("export function WakeSyncLoader()");
      expect(wakeRefreshContent).toContain('data-testid="wake-sync-loader"');
    });

    it("mounts useWakeRefresh and WakeSyncLoader at the root application level in App.tsx", () => {
      expect(appContent).toContain('import { useWakeRefresh, WakeSyncLoader } from "@/lib/wakeRefresh"');
      expect(appContent).toContain("useWakeRefresh()");
      expect(appContent).toContain("<WakeSyncLoader />");
    });
  });
});
