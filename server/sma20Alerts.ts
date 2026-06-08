// ─────────────────────────────────────────────────────────────────────────────
// SMA20 alert engine.
//
// Scans the user's watchlist on a slow timer, fetches recent 1D closes from
// the same Stooq path the mini-chart uses, and emits A2/A3/A4/REJECTION
// alerts via storage.createAlert (visible in the cockpit's Alerts Feed).
// Optionally posts the same payload to ALERT_WEBHOOK_URL so the user can wire
// up email/Slack/etc. via Zapier, Make, n8n, Resend, etc.
//
// Zero new deps. No-ops if the watchlist is empty or the webhook is unset.
// ─────────────────────────────────────────────────────────────────────────────

import { storage } from "./storage";

type Candle = { time: number; close: number };
type SignalKind = "A2_APPROACHING" | "A3_AT" | "A4_BOUNCE" | "REJECTION";

// Per-(symbol+kind) cooldown to prevent alert spam.
// Cross signals (A4/REJECTION) cool down longer because they're stronger.
const COOLDOWN_MS: Record<SignalKind, number> = {
  A2_APPROACHING: 4 * 60 * 60 * 1000, // 4h
  A3_AT: 2 * 60 * 60 * 1000,          // 2h
  A4_BOUNCE: 12 * 60 * 60 * 1000,     // 12h
  REJECTION: 12 * 60 * 60 * 1000,     // 12h
};
const lastFiredAt = new Map<string, number>();

// Local SMA20 evaluator — small, self-contained so the engine has no frontend deps.
function sma20(closes: number[]): number | null {
  if (closes.length < 20) return null;
  const slice = closes.slice(-20);
  return slice.reduce((s, x) => s + x, 0) / 20;
}
function sma20Prev(closes: number[]): number | null {
  if (closes.length < 21) return null;
  const slice = closes.slice(-21, -1);
  return slice.reduce((s, x) => s + x, 0) / 20;
}

async function fetchDailyCloses(symbol: string): Promise<Candle[]> {
  // 1. Tiingo (reliable from Render datacenter IPs)
  const tiingoTok = process.env.TIINGO_API_KEY || process.env.TIINGO_TOKEN || "";
  if (tiingoTok) {
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const url = `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(symbol)}/prices?startDate=${start}&endDate=${end}&format=json&token=${tiingoTok}`;
    try {
      const r = await fetch(url, {
        headers: { "Accept": "application/json", "User-Agent": "chizzle-cockpit/1.0" },
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) {
        const j = (await r.json()) as Array<{ date?: string; close?: number; adjClose?: number }>;
        if (Array.isArray(j) && j.length > 0) {
          const out: Candle[] = [];
          for (const row of j) {
            const ts = row.date ? Math.floor(new Date(row.date).getTime() / 1000) : NaN;
            const c = Number.isFinite(row.adjClose as number) ? (row.adjClose as number) : (row.close as number);
            if (Number.isFinite(ts) && Number.isFinite(c)) out.push({ time: ts, close: c });
          }
          if (out.length > 0) return out.slice(-250);
        }
      }
    } catch (e) {
      // ignore and try Stooq
    }
  }
  // 2. Stooq fallback (often blocked on datacenter IPs — keep timeout short)
  const apikey = process.env.STOOQ_APIKEY || "";
  const qs = apikey ? `&apikey=${apikey}` : "";
  const url = `https://stooq.com/q/d/l/?s=${symbol.toLowerCase()}.us&i=d${qs}`;
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept": "text/csv,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://stooq.com/",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return [];
    const csv = await r.text();
    const lines = csv.trim().split("\n").slice(1);
    const out: Candle[] = [];
    for (const line of lines) {
      const [date, , , , close] = line.split(",");
      const ts = Math.floor(new Date(date).getTime() / 1000);
      const c = parseFloat(close);
      if (Number.isFinite(c) && Number.isFinite(ts)) out.push({ time: ts, close: c });
    }
    return out.slice(-250);
  } catch (e) {
    return [];
  }
}

function classify(closes: number[]): SignalKind | null {
  if (closes.length < 21) return null;
  const price = closes[closes.length - 1];
  const prev = closes[closes.length - 2];
  const s = sma20(closes);
  const sPrev = sma20Prev(closes);
  if (s == null || sPrev == null) return null;

  // Cross detection has priority over proximity.
  if (prev < sPrev && price >= s) return "A4_BOUNCE";
  if (prev > sPrev && price <= s) return "REJECTION";

  const dist = Math.abs(price - s) / s;
  if (dist <= 0.002) return "A3_AT";
  if (dist <= 0.01) return "A2_APPROACHING";
  return null;
}

// Webhook sender — Resend / Zapier / n8n / Make / Slack / any HTTPS endpoint.
// User-controlled via ALERT_WEBHOOK_URL env var. Optional bearer via
// ALERT_WEBHOOK_TOKEN. POSTs JSON. Failures are swallowed (logged) so the
// scanner is never blocked by a downstream outage.
async function postWebhook(payload: Record<string, unknown>) {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (process.env.ALERT_WEBHOOK_TOKEN) {
      headers["Authorization"] = `Bearer ${process.env.ALERT_WEBHOOK_TOKEN}`;
    }
    await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      // 5s soft timeout via AbortController
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    console.warn("[sma20-alerts] webhook failed:", (err as any)?.message || err);
  }
}

const SEVERITY: Record<SignalKind, "info" | "action" | "critical"> = {
  A2_APPROACHING: "info",
  A3_AT: "action",
  A4_BOUNCE: "action",
  REJECTION: "critical",
};

const LABEL: Record<SignalKind, string> = {
  A2_APPROACHING: "Approaching SMA20",
  A3_AT: "At SMA20",
  A4_BOUNCE: "Bounce off SMA20",
  REJECTION: "Rejected at SMA20",
};

async function evaluateOne(symbol: string) {
  const candles = await fetchDailyCloses(symbol);
  if (candles.length < 21) return;
  const closes = candles.map(c => c.close);
  const kind = classify(closes);
  if (!kind) return;
  const cooldownKey = `${symbol}:${kind}`;
  const last = lastFiredAt.get(cooldownKey) ?? 0;
  const now = Date.now();
  if (now - last < COOLDOWN_MS[kind]) return;
  lastFiredAt.set(cooldownKey, now);

  const price = closes[closes.length - 1];
  const s = sma20(closes) ?? 0;
  const distPct = ((price - s) / s) * 100;
  const message = `${symbol} \u00b7 ${LABEL[kind]} \u00b7 px ${price.toFixed(2)} \u00b7 SMA20 ${s.toFixed(2)} (${distPct >= 0 ? "+" : ""}${distPct.toFixed(2)}%)`;
  const firedAt = new Date().toISOString();

  // 1) In-app alert (cockpit Alerts Feed picks this up immediately).
  try {
    await storage.createAlert({
      ticker: symbol,
      type: `SMA20_${kind}`,
      severity: SEVERITY[kind],
      message,
      firedAt,
      acknowledged: false,
    } as any);
  } catch (err) {
    console.warn("[sma20-alerts] createAlert failed:", (err as any)?.message || err);
  }

  // 2) Email / webhook fan-out (no-op if env unset).
  await postWebhook({
    source: "chizzle-cockpit",
    kind: `SMA20_${kind}`,
    label: LABEL[kind],
    ticker: symbol,
    interval: "1D",
    price,
    sma20: s,
    distPct,
    firedAt,
    severity: SEVERITY[kind],
  });
}

let scanning = false;
async function scanOnce() {
  if (scanning) return;
  scanning = true;
  try {
    const wl = await storage.listWatchlist();
    if (wl.length === 0) return;
    const tickers = await storage.listTickers();
    const byId = new Map(tickers.map(t => [t.id, t.symbol]));
    // Throttle requests \u2014 sequential with a small delay so Stooq doesn't ban us.
    for (const w of wl) {
      const sym = byId.get(w.tickerId);
      if (!sym) continue;
      try { await evaluateOne(sym); } catch (err) {
        console.warn(`[sma20-alerts] ${sym} failed:`, (err as any)?.message || err);
      }
      await new Promise(r => setTimeout(r, 300));
    }
  } catch (err) {
    console.warn("[sma20-alerts] scanOnce failed:", (err as any)?.message || err);
  } finally {
    scanning = false;
  }
}

// Exposed for the manual trigger route (POST /api/alerts/scan-sma20).
export async function triggerScan() {
  await scanOnce();
}

let started = false;
export function startSMA20AlertEngine() {
  if (started) return;
  started = true;
  // First scan after 30s (avoid blocking startup), then every 15 minutes.
  setTimeout(scanOnce, 30_000);
  setInterval(scanOnce, 15 * 60 * 1000);
  console.log("[sma20-alerts] engine started (15-min cadence)");
}

// Explicit trigger for tests / manual runs.
export const _internal = { scanOnce, evaluateOne, classify, sma20, sma20Prev };
