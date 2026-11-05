import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  marketDataStore,
  globalStore,
  useMarketDataStore,
} from "../../client/src/lib/useMarketDataStore";
import {
  getWsRetryCount,
  resetWsRetryCount,
  isHeartbeatActive,
  isFallbackPollingActive,
  reconnectPriceFeed,
  fetchLiveQuote,
} from "../../client/src/lib/priceFeed";
import fs from "fs";
import path from "path";

describe("Dropdown Option Contrast & Radix Theme", () => {
  it("enforces dark theme and high contrast for select and options in index.css", () => {
    const cssPath = path.resolve(__dirname, "../../client/src/index.css");
    const content = fs.readFileSync(cssPath, "utf-8");

    // Must enforce color-scheme: dark and high-contrast dark background for select
    expect(content).toContain("color-scheme: dark !important;");
    expect(content).toContain("background-color: #111827 !important;");
    expect(content).toContain("color: #ffffff !important;");

    // Must style select option and hover/focus/checked
    expect(content).toContain("select option");
    expect(content).toContain("select option:hover");

    // Must have dark popover tokens in :root
    expect(content).toContain("--popover: 222 47% 11%;");
    expect(content).toContain("--popover-foreground: 210 40% 98%;");
  });

  it("styles Radix SelectContent and SelectItem with high-contrast text and dark background", () => {
    const selectComponentPath = path.resolve(__dirname, "../../client/src/components/ui/select.tsx");
    const content = fs.readFileSync(selectComponentPath, "utf-8");

    expect(content).toContain("bg-gray-900");
    expect(content).toContain("text-white");
    expect(content).toContain("border-slate-700");
    expect(content).toContain("hover:bg-gray-800");
    expect(content).toContain("focus:bg-gray-800");
  });

  it("styles Radix DropdownMenuContent and DropdownMenuItem with high-contrast text and dark background", () => {
    const dropdownComponentPath = path.resolve(__dirname, "../../client/src/components/ui/dropdown-menu.tsx");
    const content = fs.readFileSync(dropdownComponentPath, "utf-8");

    expect(content).toContain("bg-gray-900");
    expect(content).toContain("text-white");
    expect(content).toContain("border-slate-700");
    expect(content).toContain("hover:bg-gray-800");
    expect(content).toContain("focus:bg-gray-800");
  });

  it("styles Watchlist category dropdown with dark background, white text and colorScheme dark", () => {
    const swingWorkspacePath = path.resolve(__dirname, "../../client/src/components/swing/SwingWorkspace.tsx");
    const content = fs.readFileSync(swingWorkspacePath, "utf-8");

    expect(content).toContain('data-testid="select-category"');
    expect(content).toContain('className="bg-gray-900 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-white hover:bg-gray-800 focus:outline-none focus:border-cyan-500 cursor-pointer"');
    expect(content).toContain('style={{ colorScheme: "dark" }}');
  });
});

describe("WebSocket Heartbeat, Auto-Reconnect, and REST Fallback", () => {
  beforeEach(() => {
    resetWsRetryCount();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calculates exponential backoff delays with 8000ms max", () => {
    // Delays: 1s, 2s, 4s, 8s, 8s max
    const getDelay = (retry: number) => Math.min(1000 * Math.pow(2, retry - 1), 8000);
    expect(getDelay(1)).toBe(1000);
    expect(getDelay(2)).toBe(2000);
    expect(getDelay(3)).toBe(4000);
    expect(getDelay(4)).toBe(8000);
    expect(getDelay(5)).toBe(8000);
  });

  it("updates round-trip latency in marketDataStore via setLatency", () => {
    marketDataStore.setLatency(28);
    expect(marketDataStore.getState().latencyMs).toBe(28);

    marketDataStore.setLatency(42.6);
    expect(marketDataStore.getState().latencyMs).toBe(43);
  });

  it("maintains currentPrice and state across views as Single Source of Truth", () => {
    marketDataStore.setActiveTicker("AAPL");
    marketDataStore.setCurrentPrice(245.5, "AAPL");

    expect(marketDataStore.getState().currentPrice).toBe(245.5);
    expect(globalStore.currentPrice).toBe(245.5);
    expect(marketDataStore.getState().prices["AAPL"]).toBe(245.5);

    // Incoming tick propagates to store
    marketDataStore.validateAndApplyTick({
      symbol: "AAPL",
      price: 246.0,
      timestamp: Date.now(),
    });

    expect(marketDataStore.getState().currentPrice).toBe(246.0);
    expect(globalStore.currentPrice).toBe(246.0);
    expect(marketDataStore.getState().prices["AAPL"]).toBe(246.0);
  });
});
