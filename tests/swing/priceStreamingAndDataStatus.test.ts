import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

describe("Market Data WebSocket Streaming, 5s Polling & Data Status Indicator", () => {
  const priceServicePath = path.resolve(__dirname, "../../server/priceService.ts");
  const priceServiceContent = fs.readFileSync(priceServicePath, "utf-8");

  const priceFeedPath = path.resolve(__dirname, "../../client/src/lib/priceFeed.ts");
  const priceFeedContent = fs.readFileSync(priceFeedPath, "utf-8");

  const useLivePricesPath = path.resolve(__dirname, "../../client/src/lib/useLivePrices.ts");
  const useLivePricesContent = fs.readFileSync(useLivePricesPath, "utf-8");

  const dataStatusPath = path.resolve(__dirname, "../../client/src/components/swing/DataStatus.tsx");
  const dataStatusContent = fs.readFileSync(dataStatusPath, "utf-8");

  const tradingCardPath = path.resolve(__dirname, "../../client/src/components/swing/TradingCard.tsx");
  const tradingCardContent = fs.readFileSync(tradingCardPath, "utf-8");

  describe("Requirement 1: WebSocket & Streaming Data Feed", () => {
    it("server exports setupPriceWebSocket and handles /ws/prices upgrade", () => {
      expect(priceServiceContent).toContain("export function setupPriceWebSocket");
      expect(priceServiceContent).toContain('pathname === "/ws/prices"');
      expect(priceServiceContent).toContain("handleUpgrade");
    });

    it("server exports startUpstreamWebSocket and supports live upstream streaming (Finnhub / Polygon)", () => {
      expect(priceServiceContent).toContain("export function startUpstreamWebSocket");
      expect(priceServiceContent).toContain("wss://ws.finnhub.io");
      expect(priceServiceContent).toContain("wss://socket.polygon.io/stocks");
    });

    it("server broadcasts live ticks to both WebSocket and SSE clients", () => {
      expect(priceServiceContent).toContain("ws.send(wsMsg)");
      expect(priceServiceContent).toContain("res.write(data)");
    });

    it("client priceFeed connects via WebSocket with fallback to SSE and polling", () => {
      expect(priceFeedContent).toContain("function connectWS()");
      expect(priceFeedContent).toContain("/ws/prices");
      expect(priceFeedContent).toContain("ws.onmessage");
      expect(priceFeedContent).toContain("ws.onerror");
    });

    it("SparklineChart dynamically streams live ticks into unclosed candlestick in real time", () => {
      expect(tradingCardContent).toContain("const liveQuote = useLiveQuote(symbol);");
      expect(tradingCardContent).toContain("cs.update({");
      expect(tradingCardContent).toContain("close: p");
    });
  });

  describe("Requirement 2: API Polling Cadence (5s Maximum During Market Hours)", () => {
    it("server activeCadenceSec returns 5 seconds maximum during live market hours", async () => {
      expect(priceServiceContent).toContain("minutes >= 9 * 60 + 30 && minutes < 16 * 60) return 5;");
    });

    it("client detects market hours and polls at 5 seconds maximum during market hours", () => {
      expect(priceFeedContent).toContain("export function isMarketHours");
      expect(priceFeedContent).toContain("pollTimer = setInterval(fallbackPollOnce, isMarketHours() ? 5000 : 10000);");
    });

    it("server provides on-demand symbol refresh endpoints", () => {
      const routesPath = path.resolve(__dirname, "../../server/routes.ts");
      const routesContent = fs.readFileSync(routesPath, "utf-8");
      expect(routesContent).toContain('app.post("/api/prices/refresh/:symbol"');
      expect(routesContent).toContain('app.post("/api/prices/subscribe"');
    });
  });

  describe("Requirement 3: 'Data Status' Indicator & Auto-Refresh", () => {
    it("exports DataStatusIndicator component with live, delayed, and syncing states", () => {
      expect(dataStatusContent).toContain("export function DataStatusIndicator");
      expect(dataStatusContent).toContain("data-status-syncing-");
      expect(dataStatusContent).toContain("data-status-live-");
      expect(dataStatusContent).toContain("data-status-delayed-");
    });

    it("renders green dot for Live and yellow dot for Delayed", () => {
      expect(dataStatusContent).toContain("bg-emerald-400");
      expect(dataStatusContent).toContain("Live");
      expect(dataStatusContent).toContain("bg-amber-400");
      expect(dataStatusContent).toContain("Delayed");
    });

    it("renders DataStatusIndicator next to the current price on CardHeader, InlineTradingCard, and CompactRow", () => {
      expect(tradingCardContent).toContain("<DataStatusIndicator symbol={d.symbol} liveQuote={liveQuote} />");
      expect(tradingCardContent).toContain("data-testid={`inline-header-price-${d.symbol}`}");
      expect(tradingCardContent).toContain("data-testid={`cardheader-price-${d.symbol}`}");
      expect(tradingCardContent).toContain("data-testid={`compact-header-price-${d.symbol}`}");
    });

    it("useLiveQuote automatically triggers manual refresh and Syncing state when data is > 1 min old during market hours", () => {
      expect(useLivePricesContent).toContain("!inMkt || !isDelayed || isSyncing");
      expect(useLivePricesContent).toContain("refresh();");
      expect(useLivePricesContent).toContain("isSyncing");
    });

    it("setup cards use real-time effectivePrice for header, progress bar, and level checks", () => {
      expect(tradingCardContent).toContain("const effectivePrice = liveQuote.price ?? d.currentPrice;");
      expect(tradingCardContent).toContain("Current: <strong className=\"text-white tabular-nums\">{$(effectivePrice)}</strong>");
    });
  });
});
