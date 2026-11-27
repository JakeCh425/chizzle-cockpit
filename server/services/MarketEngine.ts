import type { Express, Request, Response } from "express";
import { addPollSymbols, feedStatus, snapshot as getPriceSnapshot, type Quote } from "../priceService";
import { isRegularMarketHours } from "../marketHours";
import { dispatchTradeAlert } from "./tradeAlertDispatcher";

export interface EngineTickerState {
  symbol: string;
  price: number;
  prevClose: number;
  changePct: number;
  lastTickTs: number;
  source: string;
}

export interface EngineSnapshot {
  marketStatus: "OPEN" | "CLOSED";
  feedHealth: "LIVE" | "DEGRADED" | "STATIC";
  lastTickTs: number;
  updatedAt: number;
  tickers: Record<string, EngineTickerState>;
  readySetups: string[];
  pendingSetups: string[];
}

const DEFAULT_UNIVERSE = [
  "SMH", "QQQ", "SPY", "XLE", "XLV", "XLI",
  "XLF", "JPM", "CAT", "COST", "AAPL",
];

class MarketEngineService {
  private started = false;
  private evalTimer: ReturnType<typeof setInterval> | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private sseClients = new Set<Response>();
  private decisionCache = new Map<string, { setupStatus?: string; entryPrice?: number; stopLoss?: number }>();
  private prevReadySet = new Set<string>();
  private state: EngineSnapshot = {
    marketStatus: "CLOSED",
    feedHealth: "STATIC",
    lastTickTs: 0,
    updatedAt: Date.now(),
    tickers: {},
    readySetups: [],
    pendingSetups: [...DEFAULT_UNIVERSE],
  };

  public start(app: Express, port: number): void {
    if (this.started) return;
    this.started = true;

    try {
      addPollSymbols(DEFAULT_UNIVERSE);
    } catch {}

    this.registerRoutes(app);

    // 1-second continuous in-memory evaluation loop (immune to browser tab sleep)
    this.evalTimer = setInterval(() => {
      this.evaluateTick();
    }, 1_000);

    // Render Keep-Alive self-ping every 4 minutes during market hours (Mon-Fri, 9:00 AM - 4:30 PM ET)
    this.keepAliveTimer = setInterval(() => {
      if (!this.isRenderKeepAliveWindow()) return;
      const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://127.0.0.1:${port}`;
      fetch(`${baseUrl}/api/health`).catch(() => {});
    }, 4 * 60_000);

    console.log("[MarketEngine] Always-on server-side evaluation singleton started (1s loop, 4m keep-alive).");
  }

  public updateDecisionMetadata(decisions: Array<{ symbol: string; setupStatus?: string; entryPrice?: number; stopLoss?: number }>): void {
    for (const d of decisions) {
      if (!d?.symbol) continue;
      this.decisionCache.set(d.symbol.toUpperCase(), {
        setupStatus: d.setupStatus,
        entryPrice: d.entryPrice,
        stopLoss: d.stopLoss,
      });
    }
  }

  public getSnapshot(): EngineSnapshot {
    return this.state;
  }

  private isRenderKeepAliveWindow(now = new Date()): boolean {
    const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const day = et.getDay();
    if (day === 0 || day === 6) return false;
    const mins = et.getHours() * 60 + et.getMinutes();
    return mins >= 9 * 60 && mins <= 16 * 60 + 30;
  }

  private evaluateTick(): void {
    const now = Date.now();
    const open = isRegularMarketHours(now);
    const quotes: Record<string, Quote> = getPriceSnapshot();
    const fStatus = feedStatus();

    const nextTickers: Record<string, EngineTickerState> = {};
    const nextReady: string[] = [];
    const nextPending: string[] = [];
    let latestTickTs = this.state.lastTickTs;

    for (const [symRaw, q] of Object.entries(quotes)) {
      const sym = symRaw.toUpperCase();
      if (!q || typeof q.price !== "number" || q.price <= 0) continue;
      const ts = q.receivedAt || (q.ts ? q.ts * 1000 : now);
      if (ts > latestTickTs) latestTickTs = ts;

      nextTickers[sym] = {
        symbol: sym,
        price: q.price,
        prevClose: q.prevClose || q.price,
        changePct: q.changePct || 0,
        lastTickTs: ts,
        source: q.source || "FINNHUB",
      };

      const meta = this.decisionCache.get(sym);
      const isReady = meta?.setupStatus === "READY_TO_TRADE" || meta?.setupStatus === "SETUP_CONFIRMED";
      if (isReady) {
        nextReady.push(sym);
        if (open && !this.prevReadySet.has(sym)) {
          const entryPx = meta?.entryPrice ?? q.price;
          const stopPx = meta?.stopLoss ?? +(entryPx * 0.98).toFixed(2);
          void dispatchTradeAlert({
            ticker: sym,
            stage: "READY",
            livePrice: q.price,
            entryPrice: entryPx,
            stopLoss: stopPx,
          }).catch(() => {});
        }
      } else {
        nextPending.push(sym);
      }
    }
    this.prevReadySet = new Set(nextReady);

    for (const sym of DEFAULT_UNIVERSE) {
      if (!nextTickers[sym] && !nextPending.includes(sym)) {
        nextPending.push(sym);
      }
    }

    const feedHealth: EngineSnapshot["feedHealth"] = !open
      ? "STATIC"
      : fStatus.state === "LIVE" || now - latestTickTs <= 15_000
      ? "LIVE"
      : "DEGRADED";

    const changed =
      latestTickTs !== this.state.lastTickTs ||
      nextReady.length !== this.state.readySetups.length ||
      feedHealth !== this.state.feedHealth;

    this.state = {
      marketStatus: open ? "OPEN" : "CLOSED",
      feedHealth,
      lastTickTs: latestTickTs,
      updatedAt: now,
      tickers: nextTickers,
      readySetups: nextReady,
      pendingSetups: nextPending,
    };

    if (changed && this.sseClients.size > 0) {
      const payload = `data: ${JSON.stringify(this.state)}\n\n`;
      for (const client of this.sseClients) {
        try {
          client.write(payload);
        } catch {
          this.sseClients.delete(client);
        }
      }
    }
  }

  private registerRoutes(app: Express): void {
    app.get("/api/health", (_req: Request, res: Response) => {
      res.json({
        status: "ok",
        marketStatus: this.state.marketStatus,
        feedHealth: this.state.feedHealth,
        lastTickTs: this.state.lastTickTs,
        uptime: process.uptime(),
        now: new Date().toISOString(),
      });
    });

    app.get("/api/state/snapshot", (_req: Request, res: Response) => {
      res.json(this.state);
    });

    app.get("/api/state/stream", (req: Request, res: Response) => {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      this.sseClients.add(res);
      res.write(`data: ${JSON.stringify(this.state)}\n\n`);

      const keepAlive = setInterval(() => {
        try {
          res.write(": ping\n\n");
        } catch {
          clearInterval(keepAlive);
          this.sseClients.delete(res);
        }
      }, 20_000);

      req.on("close", () => {
        clearInterval(keepAlive);
        this.sseClients.delete(res);
      });
    });
  }
}

export const MarketEngine = new MarketEngineService();
