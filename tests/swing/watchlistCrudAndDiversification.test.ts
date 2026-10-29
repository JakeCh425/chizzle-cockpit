import { describe, it, expect } from "vitest";
import { DEFAULT_WATCHLIST } from "@/lib/wealthWatchlist";
import fs from "fs";
import path from "path";

describe("Watchlist Expansion & Dynamic Ticker Management Engine", () => {
  it("DEFAULT_WATCHLIST explicitly includes all required tickers: QQQ, SMH, SPY, AAPL, MSFT, XLF, XLI, JPM, CAT, COST", () => {
    const required = ["QQQ", "SMH", "SPY", "AAPL", "MSFT", "XLF", "XLI", "JPM", "CAT", "COST"];
    const symbols = DEFAULT_WATCHLIST.map((i) => i.symbol);

    for (const req of required) {
      expect(symbols).toContain(req);
      const item = DEFAULT_WATCHLIST.find((i) => i.symbol === req);
      expect(item).toBeDefined();
      expect(item?.price).toBeGreaterThan(0);
      expect(item?.buyTarget).toBeGreaterThan(0);
      expect(item?.stopLoss).toBeGreaterThan(0);
      expect(item?.primaryTarget).toBeGreaterThan(item?.buyTarget || 0);
    }
  });

  it("contains remove ticker buttons with data-testid='button-remove-ticker-${symbol}' on each watchlist row", () => {
    const dashSrc = fs.readFileSync(path.join(__dirname, "../../client/src/pages/WealthEngineDashboard.tsx"), "utf8");
    expect(dashSrc).toContain('data-testid={`button-remove-ticker-${item.symbol}`}');
    expect(dashSrc).toContain("removeTicker(item.symbol)");
  });

  it("contains quick-add ticker input and submit button with expected test IDs", () => {
    const dashSrc = fs.readFileSync(path.join(__dirname, "../../client/src/pages/WealthEngineDashboard.tsx"), "utf8");
    expect(dashSrc).toContain('data-testid="input-quick-add-ticker"');
    expect(dashSrc).toContain('data-testid="button-quick-add-ticker"');
  });

  it("globalState persists removed tickers to chizzle-removed-tickers and unsubscribes from WebSocket feed", () => {
    const gsSrc = fs.readFileSync(path.join(__dirname, "../../client/src/lib/globalState.tsx"), "utf8");
    expect(gsSrc).toContain('const STORAGE_KEY_REMOVED_TICKERS = "chizzle-removed-tickers"');
    expect(gsSrc).toContain("unsubscribeSymbol(sym)");
    expect(gsSrc).toContain("removeTicker");
    expect(gsSrc).toContain("addTicker");
  });

  it("auto-migrates newly added default universe tickers into existing saved lists unless previously removed", () => {
    const gsSrc = fs.readFileSync(path.join(__dirname, "../../client/src/lib/globalState.tsx"), "utf8");
    expect(gsSrc).toContain("DEFAULT_WATCHLIST");
    expect(gsSrc).toContain("STORAGE_KEY_REMOVED_TICKERS");
    expect(gsSrc).toContain("existingSymbols");
  });

  it("falls back to SPY or first item when active ticker is removed", () => {
    const gsSrc = fs.readFileSync(path.join(__dirname, "../../client/src/lib/globalState.tsx"), "utf8");
    expect(gsSrc).toContain('next.find((i) => i.symbol === "SPY")');
  });
});
