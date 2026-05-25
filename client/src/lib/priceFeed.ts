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
  source: "FINNHUB" | "SIMULATOR" | "OVERRIDE";
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
let pollTimer: any = null;
let reconnectTimer: any = null;
let started = false;

function setSnapshot(next: Record<string, LiveQuote>) {
  snapshotState = next;
  listeners.forEach(l => l(snapshotState));
}

function applyQuote(q: LiveQuote) {
  snapshotState = { ...snapshotState, [q.symbol]: q };
  lastEventAt = Date.now();
  listeners.forEach(l => l(snapshotState));
}

function setConn(next: ConnState) {
  if (connState === next) return;
  connState = next;
  statusListeners.forEach(l => l(connState));
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
  pollTimer = setInterval(fallbackPollOnce, 10000);
}
function stopFallbackPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
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
  connectSSE();
  // Stale-monitor: re-evaluate every 1s based on lastEventAt
  setInterval(() => {
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
export function useFeedConnection(): { state: ConnState; lastEventAt: number; ageSec: number } {
  const [state, setState] = useState<ConnState>(connState);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    ensurePriceFeed();
    const off = subscribeStatus(setState);
    const t = setInterval(() => setTick(x => x + 1), 1000);
    return () => { off(); clearInterval(t); };
  }, []);
  const ageSec = lastEventAt ? Math.round((Date.now() - lastEventAt) / 1000) : -1;
  return { state, lastEventAt, ageSec };
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
