/**
 * Zero-Disconnect Background Data Engine (Web Worker)
 *
 * Browsers do NOT throttle Web Workers in background tabs the way they throttle
 * main-thread React timers. This worker maintains ONE persistent WebSocket,
 * a 20-second heartbeat ping, REST polling fallback, and 300ms batched tick commits.
 */

let ws: WebSocket | null = null;
let wsUrl = "";
let apiBase = "";
let marketOpen = false;
let subscribedSymbols = new Set<string>();
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let restPollTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let batchTimer: ReturnType<typeof setInterval> | null = null;
let retryCount = 0;
let pingSentAt = 0;
let lastLatencyMs = 18;
let disconnectedSinceMs: number | null = null;
let isPollingBackup = false;

const tickBuffer = new Map<string, any>();

function postStatus(status: string) {
  self.postMessage({
    type: "STATUS",
    status,
    isPollingBackup,
    disconnectedSinceMs,
    latencyMs: lastLatencyMs,
  });
}

function flushTickBuffer() {
  if (tickBuffer.size === 0) return;
  const ticks = Array.from(tickBuffer.values());
  tickBuffer.clear();
  self.postMessage({
    type: "TICKS",
    ticks,
    latencyMs: lastLatencyMs,
    ts: Date.now(),
  });
}

function startBatchLoop() {
  if (batchTimer) return;
  batchTimer = setInterval(flushTickBuffer, 300);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      pingSentAt = Date.now();
      try {
        ws.send(JSON.stringify({ type: "ping", ts: pingSentAt }));
      } catch {
        handleDisconnect();
      }
    } else if (marketOpen) {
      handleDisconnect();
    }
  }, 20_000);
}

async function fetchRestSnapshot() {
  try {
    const res = await fetch(`${apiBase}/api/prices`);
    if (!res.ok) return;
    const payload = await res.json();
    if (payload && typeof payload === "object") {
      for (const [sym, q] of Object.entries(payload)) {
        if (q && typeof q === "object") {
          tickBuffer.set(sym.toUpperCase(), { ...(q as any), symbol: sym.toUpperCase() });
        }
      }
      flushTickBuffer();
    }
  } catch {
    // Transient network error ignored in background worker
  }
}

function startRestPolling() {
  if (restPollTimer) return;
  isPollingBackup = true;
  postStatus("POLLING_BACKUP");
  void fetchRestSnapshot();
  restPollTimer = setInterval(() => {
    if (!marketOpen) {
      stopRestPolling();
      return;
    }
    void fetchRestSnapshot();
  }, 5_000);
}

function stopRestPolling() {
  if (restPollTimer) {
    clearInterval(restPollTimer);
    restPollTimer = null;
  }
  isPollingBackup = false;
}

function handleDisconnect() {
  stopHeartbeat();
  if (ws) {
    try {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      ws.close();
    } catch {}
    ws = null;
  }

  if (!marketOpen) {
    disconnectedSinceMs = null;
    stopRestPolling();
    postStatus("STATIC");
    return;
  }

  if (disconnectedSinceMs === null) {
    disconnectedSinceMs = Date.now();
  }
  retryCount++;
  const delay = Math.min(10_000 * retryCount, 30_000);
  postStatus("RECONNECTING");
  startRestPolling();

  if (!reconnectTimer) {
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectWs();
    }, delay);
  }
}

function connectWs() {
  if (!marketOpen) {
    disconnectedSinceMs = null;
    stopRestPolling();
    void fetchRestSnapshot();
    postStatus("STATIC");
    return;
  }
  if (!wsUrl) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      retryCount = 0;
      disconnectedSinceMs = null;
      stopRestPolling();
      startHeartbeat();
      postStatus("LIVE");
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
        const msg = JSON.parse(ev.data);
        if (msg?.type === "pong") {
          lastLatencyMs = pingSentAt > 0 ? Math.max(5, Date.now() - pingSentAt) : 18;
          return;
        }
        if (isPollingBackup) {
          stopRestPolling();
          disconnectedSinceMs = null;
          postStatus("LIVE");
        }
        if (msg?.type === "hello" && Array.isArray(msg.quotes)) {
          for (const q of msg.quotes) {
            if (q?.symbol) tickBuffer.set(String(q.symbol).toUpperCase(), q);
          }
          flushTickBuffer();
        } else if (msg?.type === "tick" && msg.quote?.symbol) {
          tickBuffer.set(String(msg.quote.symbol).toUpperCase(), msg.quote);
        } else if (msg?.symbol) {
          tickBuffer.set(String(msg.symbol).toUpperCase(), msg);
        }
      } catch {}
    };

    ws.onerror = () => handleDisconnect();
    ws.onclose = () => handleDisconnect();
  } catch {
    handleDisconnect();
  }
}

self.onmessage = (ev: MessageEvent) => {
  const data = ev.data || {};
  switch (data.type) {
    case "INIT": {
      wsUrl = data.wsUrl || "";
      apiBase = data.apiBase || "";
      marketOpen = Boolean(data.marketOpen);
      if (Array.isArray(data.symbols)) {
        for (const s of data.symbols) {
          if (s) subscribedSymbols.add(String(s).toUpperCase());
        }
      }
      startBatchLoop();
      connectWs();
      break;
    }
    case "SUBSCRIBE": {
      if (Array.isArray(data.symbols)) {
        let added = false;
        for (const s of data.symbols) {
          const clean = String(s || "").toUpperCase();
          if (clean && !subscribedSymbols.has(clean)) {
            subscribedSymbols.add(clean);
            added = true;
          }
        }
        if (added && ws && ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: "subscribe", symbols: Array.from(subscribedSymbols) }));
          } catch {}
        }
      }
      break;
    }
    case "MARKET_OPEN": {
      const nextOpen = Boolean(data.marketOpen);
      if (nextOpen !== marketOpen) {
        marketOpen = nextOpen;
        connectWs();
      }
      break;
    }
    case "REST_CATCHUP": {
      void fetchRestSnapshot();
      if (marketOpen && (!ws || ws.readyState !== WebSocket.OPEN)) {
        connectWs();
      }
      break;
    }
    case "RECONNECT": {
      retryCount = 0;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      connectWs();
      break;
    }
  }
};
