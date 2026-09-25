// PR 3d — data feed for the Unified Swing Engine. Reuses the existing vendor
// fetchers (and their caches / credit guards) and normalizes to SwingBar.
// Adds no background load when ENABLE_UNIFIED_SWING_ENGINE is off (nothing calls it).
import { fetchTwelveDataOHLCBars, fetchYahooBarsOHLC, fetchYahooQuote, getQuote } from "../priceService";
import { safeHistory } from "../marketData";
import type { SwingBar } from "./candleMath";
import { chicago, chicagoTs } from "./bars";
import type { ReferenceQuote } from "./lifecycle";

type Raw = { time: number; open: number; high: number; low: number; close: number; volume: number };
const toBar = (r: Raw): SwingBar => ({ t: r.time, o: r.open, h: r.high, l: r.low, c: r.close, v: r.volume });
const ok = (b: SwingBar) => [b.o, b.h, b.l, b.c].every((x) => Number.isFinite(x) && x > 0);

/** Twelve Data returns exchange-local (ET) wall time; the shared fetcher parses it as UTC.
 *  Re-interpret: fake-UTC wall clock (ET) → Chicago wall (−60 min) → true unix seconds. */
export function fixTwelveDataTs(fakeUtcSec: number): number {
  const d = new Date(fakeUtcSec * 1000);
  const ymd = d.toISOString().slice(0, 10);
  const etMin = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (etMin < 60) { // crosses midnight in Chicago — rare (extended hours); fall back to previous day
    const prev = new Date((fakeUtcSec - 86400) * 1000).toISOString().slice(0, 10);
    return chicagoTs(prev, etMin - 60 + 1440);
  }
  return chicagoTs(ymd, etMin - 60);
}

export interface BarsResult { bars: SwingBar[]; source: string | null; error?: string }

export async function fetch1H(symbol: string): Promise<BarsResult> {
  const sym = symbol.toUpperCase();
  try {
    const td = await fetchTwelveDataOHLCBars(sym, "1h");
    if (td && td.length >= 40) return { bars: td.map((r) => ({ ...toBar(r), t: fixTwelveDataTs(r.time) })).filter(ok).sort((a, z) => a.t - z.t), source: "twelvedata" };
  } catch { /* fall through */ }
  try {
    const y = await fetchYahooBarsOHLC(sym, "1h");
    if (y && y.length >= 40) return { bars: y.map(toBar).filter(ok).sort((a, z) => a.t - z.t), source: "yahoo" };
  } catch { /* fall through */ }
  const d = await yahooChart(sym, "60m", 180);
  if (d && d.length >= 40) return { bars: d, source: "yahoo" };
  return { bars: [], source: null, error: "Data unavailable" };
}

export async function fetchDaily(symbol: string): Promise<BarsResult> {
  const sym = symbol.toUpperCase();
  try {
    const y = await fetchYahooBarsOHLC(sym, "1d");
    if (y && y.length >= 60) return { bars: y.map(toBar).filter(ok).sort((a, z) => a.t - z.t), source: "yahoo" };
  } catch { /* fall through */ }
  const d = await yahooChart(sym, "1d", 800);
  if (d && d.length >= 60) return { bars: d.map((b) => ({ ...b, t: chicagoTs(new Date(b.t * 1000 - 5 * 3600e3).toISOString().slice(0, 10), 8 * 60 + 30) })), source: "yahoo" };
  try {
    const h = await safeHistory(sym);
    if (h && h.length >= 60) return { bars: h.map((d) => ({ t: chicagoTs(d.date, 8 * 60 + 30), o: d.open, h: d.high, l: d.low, c: d.close, v: d.volume })).filter(ok), source: "history" };
  } catch { /* fall through */ }
  return { bars: [], source: null, error: "Data unavailable" };
}

/** Direct Yahoo chart call with query1 → query2 host fallback and a 5-min memo (avoids 429s). */
const chartMemo = new Map<string, { at: number; bars: SwingBar[] }>();
export async function yahooChart(symbol: string, interval: "15m" | "30m" | "60m" | "1d", days: number): Promise<SwingBar[] | null> {
  const sym = symbol.toUpperCase(), key = `${sym}|${interval}|${days}`;
  const hit = chartMemo.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.bars;
  const to = Math.floor(Date.now() / 1000), from = to - days * 86400;
  for (const host of ["query1", "query2"]) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${from}&period2=${to}&interval=${interval}`,
        { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const j: any = await r.json();
      const res = j?.chart?.result?.[0]; const q = res?.indicators?.quote?.[0];
      if (!res?.timestamp || !q) continue;
      const bars: SwingBar[] = res.timestamp.map((t: number, i: number) => ({ t, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] ?? 0 })).filter(ok);
      chartMemo.set(key, { at: Date.now(), bars });
      return bars;
    } catch { /* next host */ }
  }
  return hit?.bars ?? null; // stale-but-real beats nothing; caller still marks status from timestamps
}

/** 15m / 30m — visual only (Yahoo, ~30 days). Never feeds signal logic unless Intraday Learning Mode. */
export async function fetchIntraday(symbol: string, interval: "15m" | "30m"): Promise<BarsResult> {
  const bars = await yahooChart(symbol, interval, 30);
  return bars?.length ? { bars, source: "yahoo" } : { bars: [], source: null, error: "Data unavailable" };
}

export async function fetchQuote(symbol: string): Promise<{ price: number; ts: number; source: string } | null> {
  const sym = symbol.toUpperCase();
  const q = getQuote(sym);
  if (q && q.price > 0) return { price: q.price, ts: q.ts || Math.floor(q.receivedAt / 1000), source: String(q.source).toLowerCase() };
  try { const y = await fetchYahooQuote(sym); if (y && y.price > 0) return { price: y.price, ts: y.ts, source: "yahoo" }; } catch { /* none */ }
  return null;
}

/** Second-vendor reference close for the last closed 1H bar (used when no fresh TradingView webhook close). */
export async function secondVendorReference(symbol: string, primarySource: string | null, now: number, targetEnd?: number | null): Promise<ReferenceQuote | null> {
  const sym = symbol.toUpperCase();
  try {
    let bars: SwingBar[] | null = null, source = "";
    if (primarySource === "twelvedata") { const y = await fetchYahooBarsOHLC(sym, "1h"); bars = y ? y.map(toBar) : null; source = "yahoo"; }
    else { const td = await fetchTwelveDataOHLCBars(sym, "1h"); bars = td ? td.map((r) => ({ ...toBar(r), t: fixTwelveDataTs(r.time) })) : null; source = "twelvedata"; }
    if (!bars?.length) return null;
    const closed = bars.filter((b) => b.t + 3600 <= now && chicago(b.t).minutes >= 510 && chicago(b.t).minutes < 900).sort((a, z) => a.t - z.t);
    const endOf = (b: SwingBar) => Math.min(b.t + 3600, chicagoTs(chicago(b.t).ymd, 900));
    // Compare the SAME completed bar the engine has; a vendor that is simply ahead/behind is not a mismatch.
    const last = targetEnd != null ? closed.find((b) => endOf(b) === targetEnd) : closed[closed.length - 1];
    if (!last) return null;
    return { symbol: sym, close: last.c, barEnd: endOf(last), source, session: "RTH" };
  } catch { return null; }
}
