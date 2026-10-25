// ============================================================================
//  Client-side price feed plumbing — connects to the backend SSE stream and
//  exposes hooks: useLivePrices, useFeedConnection, useFeedStatus.
//  The Finnhub credential never reaches the browser. All quotes are pushed
//  by the backend price service.
// ============================================================================
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

// Match server snapshot shape
export interface LiveQuote {
  symbol: string;
  price: number;
  prevClose: number;
  change: number;
  changePct: number;
  high: number;
  low: number;
  open: number;
  ts: number;
  receivedAt: number; // ms
  source: "FINNHUB" | "POLYGON" | "TWELVEDATA" | "TIINGO_IEX" | "YAHOO" | "NASDAQ" | "SIMULATOR" | "OVERRIDE";
}

// Backwards-compat alias (older code imports `SimTick`)
export type SimTick = { symbol: string; price: number; ts: number };

// ─────────────────────────────────────────────────────────────────────────────
// Market session classifier (America/New_York basis, label is independent
// of viewer's locale)
export type Session = "PRE" | "OPEN" | "MIDDAY" | "CLOSE" | "POST" | "OFF";

export function marketSession(now = new Date()): Session {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  if (day === 0 || day === 6) return "OFF";
  const minutes = et.getHours() * 60 + et.getMinutes();
  if (minutes < 4 * 60) return "OFF";
  if (minutes < 9 * 60 + 30) return "PRE";
  if (minutes < 10 * 60 + 30) return "OPEN";
  if (minutes < 15 * 60) return "MIDDAY";
  if (minutes < 16 * 60) return "CLOSE";
  if (minutes < 20 * 60) return "POST";
  return "OFF";
}


export function isMarketHours(now = new Date()): boolean {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = et.getHours() * 60 + et.getMinutes();
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

export function chicagoClock(now = new Date()): string {
  return now.toLocaleTimeString("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-level singleton state for the SSE connection. We share one stream
// across the whole app and let components subscribe to updates.
const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

type Listener = (snap: Record<string, LiveQuote>) => void;
const listeners = new Set<Listener>();
const statusListeners = new Set<(s: ConnState) => void>();

export type ConnState = "CONNECTING" | "LIVE" | "STALE" | "DISCONNECTED";

let snapshotState: Record<string, LiveQuote> = {};
let connState: ConnState = "CONNECTING";
let lastEventAt = 0;
let es: EventSource | null = null;
let ws: WebSocket | null = null;
const subscribedSymbols = new Set<string>();

export function subscribeSymbol(symbol: string) {
  const s = symbol.toUpperCase().split(":").pop()!;
  if (!s || subscribedSymbols.has(s)) return;
  subscribedSymbols.add(s);
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({ type: "subscribe", symbols: [s] }));
    } catch {}
  } else {
    fetch(`${API_BASE}/api/prices/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: [s] }),
    }).catch(() => {});
  }
}

export async function forceRefreshPrice(symbol?: string): Promise<boolean> {
  const sym = symbol ? symbol.toUpperCase().split(":").pop()! : undefined;
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({ type: "refresh", symbol: sym }));
    } catch {}
  }
  try {
    const res = await fetch(`${API_BASE}/api/prices/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: sym }),
    });
    if (res.ok) {
      fallbackPollOnce();
      return true;
    }
  } catch {}
  return false;
}

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let wsReconnectInterval: ReturnType<typeof setInterval> | null = null;
let started = false;

/**
 * Outlier Rejection / Bad Tick Filter:
 * Rejects sudden anomalies where an incoming tick is >3.5% away from reference price.
 */
export function isBadTick(symbol: string, newPrice: number, referencePrice?: number): boolean {
  if (!Number.isFinite(newPrice) || newPrice <= 0) return true;
  const ref = referencePrice ?? snapshotState[symbol]?.price;
  if (ref && ref > 0) {
    const deviation = Math.abs(newPrice - ref) / ref;
    if (deviation > 0.035) {
      console.warn(`[priceFeed:badTick] Dropped outlier tick for ${symbol}: $${newPrice} vs ref $${ref} (${(deviation * 100).toFixed(1)}% deviation)`);
      return true;
    }
  }
  return false;
}

function setSnapshot(next: Record<string, LiveQuote>) {
  const filtered: Record<string, LiveQuote> = {};
  for (const [sym, q] of Object.entries(next)) {
    if (isBadTick(sym, q.price, q.prevClose)) {
      if (snapshotState[sym]) filtered[sym] = snapshotState[sym];
    } else {
      filtered[sym] = q;
    }
  }
  snapshotState = filtered;
  listeners.forEach(l => l(snapshotState));
}

function applyQuote(q: LiveQuote) {
  if (isBadTick(q.symbol, q.price, q.prevClose)) {
    return;
  }
  snapshotState = { ...snapshotState, [q.symbol]: q };
  lastEventAt = Date.now();
  listeners.forEach(l => l(snapshotState));
}

function setConn(next: ConnState) {
  if (connState === next) return;
  connState = next;
  statusListeners.forEach(l => l(connState));
}

function ensureBackgroundWsReconnect() {
  if (wsReconnectInterval) return;
  wsReconnectInterval = setInterval(() => {
    // If primary WebSocket is not open, continuously attempt reconnection every 5 seconds
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.info("[priceFeed] Background 5s check: attempting primary WebSocket reconnection...");
      connectWS();
    }
  }, 5000);
}

function fallbackPollOnce() {
  fetch(`${API_BASE}/api/prices`)
    .then(r => r.ok ? r.json() : null)
    .then(j => {
      if (!j) return;
      const next: Record<string, LiveQuote> = {};
      for (const k of Object.keys(j)) next[k] = j[k];
      lastEventAt = Date.now();
      setSnapshot(next);
    })
    .catch(() => { /* ignore */ });
}

function startFallbackPolling() {
  if (pollTimer) return;
  fallbackPollOnce();
  pollTimer = setInterval(fallbackPollOnce, isMarketHours() ? 5000 : 10000);
}
function stopFallbackPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}


function connectWS() {
  if (typeof window === "undefined" || typeof WebSocket === "undefined") {
    connectSSE();
    return;
  }
  try {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${proto}//${host}/ws/prices`;

    if (typeof console !== "undefined") {
      console.log("[Boot:PriceFeed] Attempting primary WebSocket connection to:", wsUrl);
    }

    ws = new WebSocket(wsUrl);
    setConn("CONNECTING");

    ws.onopen = () => {
      console.info("[Boot:PriceFeed] Primary WebSocket reconnected! Clearing STALE state.");
      lastEventAt = Date.now();
      setConn("LIVE");
      stopFallbackPolling();
      if (es) {
        try { es.close(); } catch {}
        es = null;
      }
      if (subscribedSymbols.size > 0) {
        try {
          ws?.send(JSON.stringify({ type: "subscribe", symbols: Array.from(subscribedSymbols) }));
        } catch {}
      }
      try {
        ws?.send(JSON.stringify({ type: "refresh" }));
      } catch {}
    };

    ws.onmessage = (ev) => {
      try {
        const j = JSON.parse(ev.data);
        if (j?.type === "hello" && Array.isArray(j?.quotes)) {
          const next: Record<string, LiveQuote> = { ...snapshotState };
          for (const q of j.quotes as LiveQuote[]) {
            if (!isBadTick(q.symbol, q.price, q.prevClose)) {
              next[q.symbol] = q;
            }
          }
          if (Object.keys(next).length) {
            lastEventAt = Date.now();
            setSnapshot(next);
            setConn("LIVE");
          }
        } else if (j?.type === "tick" && j?.quote) {
          applyQuote(j.quote as LiveQuote);
          setConn("LIVE");
          stopFallbackPolling();
        }
      } catch {}
    };

    ws.onerror = () => {
      ws = null;
      if (!es) connectSSE();
      startFallbackPolling();
      ensureBackgroundWsReconnect();
    };

    ws.onclose = () => {
      ws = null;
      if (!es) connectSSE();
      startFallbackPolling();
      ensureBackgroundWsReconnect();
    };
  } catch {
    connectSSE();
    startFallbackPolling();
    ensureBackgroundWsReconnect();
  }
}


/**
 * Hard reconnect function for wake-from-sleep or connection resets.
 * Closes dead WebSocket and SSE handles, resets timers, and instantly reconnects.
 */
export function reconnectPriceFeed() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    try {
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
    } catch {}
    ws = null;
  }
  if (es) {
    try {
      es.close();
    } catch {}
    es = null;
  }
  setConn("CONNECTING");
  connectWS();
  fallbackPollOnce();
}

function connectSSE() {
  if (typeof window === "undefined" || typeof EventSource === "undefined") {
    startFallbackPolling();
    return;
  }
  try {
    es = new EventSource(`${API_BASE}/api/prices/stream`);
  } catch (e) {
    setConn("DISCONNECTED");
    startFallbackPolling();
    return;
  }
  setConn("CONNECTING");

  es.addEventListener("hello", (ev: MessageEvent) => {
    try {
      const j = JSON.parse(ev.data);
      const next: Record<string, LiveQuote> = {};
      for (const q of (j.quotes || []) as LiveQuote[]) next[q.symbol] = q;
      if (Object.keys(next).length) {
        lastEventAt = Date.now();
        setSnapshot(next);
      }
    } catch (e) { /* ignore */ }
  });

  es.onmessage = (ev: MessageEvent) => {
    try {
      const j = JSON.parse(ev.data);
      if (j?.type === "tick" && j?.quote) {
        applyQuote(j.quote as LiveQuote);
        setConn("LIVE");
        stopFallbackPolling();
      }
    } catch (e) { /* ignore */ }
  };

  es.onerror = () => {
    setConn("DISCONNECTED");
    if (es) { try { es.close(); } catch {} es = null; }
    startFallbackPolling();
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectSSE();
      }, 5000);
    }
  };

  es.onopen = () => {
    // Don't go straight to LIVE until first tick arrives; "hello" triggers above.
    setConn(lastEventAt ? "LIVE" : "CONNECTING");
  };
}

export function ensurePriceFeed() {
  if (started) return;
  started = true;
  if (typeof console !== "undefined") {
    console.log("[Boot:PriceFeed] ensurePriceFeed() starting singleton price feed stream");
  }
  connectWS();
  ensureBackgroundWsReconnect();
  // Stale-monitor: re-evaluate every 1s based on WebSocket status and lastEventAt
  setInterval(() => {
    // If primary WebSocket is healthy and open, state is always LIVE (no stale lock)
    if (ws && ws.readyState === WebSocket.OPEN) {
      setConn("LIVE");
      return;
    }
    if (!lastEventAt) return;
    const age = Date.now() - lastEventAt;
    if (age < 30000) setConn("LIVE");
    else if (age < 5 * 60 * 1000) setConn("STALE");
    else setConn("DISCONNECTED");
  }, 1000);
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  // Push current snapshot immediately
  if (Object.keys(snapshotState).length) l(snapshotState);
  return () => listeners.delete(l);
}

export function subscribeStatus(l: (s: ConnState) => void): () => void {
  statusListeners.add(l);
  l(connState);
  return () => statusListeners.delete(l);
}

export function getSnapshot(): Record<string, LiveQuote> {
  return snapshotState;
}

export function getLastEventAt(): number {
  return lastEventAt;
}

// ─────────────────────────────────────────────────────────────────────────────
// React hooks
export function useFeedConnection(): { state: ConnState; lastEventAt: number; ageSec: number; source: string } {
  const [state, setState] = useState<ConnState>(connState);
  const [tick, setTick] = useState(0);
  const [source, setSource] = useState<string>(() => {
    const snap = getSnapshot();
    const first = Object.values(snap)[0];
    return first?.source || "FINNHUB";
  });

  useEffect(() => {
    ensurePriceFeed();
    const off = subscribeStatus(setState);
    const offSnap = subscribe((snap) => {
      const first = Object.values(snap)[0];
      if (first?.source) setSource(first.source);
    });
    const t = setInterval(() => setTick(x => x + 1), 1000);
    return () => { off(); offSnap(); clearInterval(t); };
  }, []);

  const ageSec = lastEventAt ? Math.round((Date.now() - lastEventAt) / 1000) : -1;
  return { state, lastEventAt, ageSec, source };
}

export function useFeedSource(): string {
  const { source } = useFeedConnection();
  return source;
}

export interface FeedStatusPayload {
  provider: "Finnhub";
  tier: "Free";
  cadenceSec: number;
  session: string;
  useSimulator: boolean;
  lastTickAt: number | null;
  ageSec: number | null;
  symbols: Array<{ symbol: string; lastOk: number | null; ageSec: number | null; price: number | null }>;
  errorsLastHour: number;
}

export function useFeedStatus() {
  return useQuery<FeedStatusPayload>({
    queryKey: ["/api/price-feed-status"],
    // Low-Credit Mode: manual refresh only — no polling.
  });
}
