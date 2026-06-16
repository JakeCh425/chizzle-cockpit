// ─────────────────────────────────────────────────────────────────────────────
// FullChartModal.tsx
// Full-screen chart inspector — larger Recharts ComposedChart with SMA20/50/200
// overlays, volume bars, interval switching, and A-score badge.
//
// Opens from MiniChartWidget when the user clicks the badge or chart area.
// Mirrors CloseModal's container pattern (fixed inset, backdrop, click-outside).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ComposedChart, Line, Bar, ResponsiveContainer, YAxis, XAxis, Tooltip,
  CartesianGrid, ReferenceDot, ReferenceLine,
} from "recharts";
import { X } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { computeSMAs, getAScore, type SignalColor } from "@/lib/sma";
import { formatShares } from "@/lib/engine";
import { sharesForPlan, useSharesContext } from "@/lib/useShares";

interface SmaVisibility { sma20: boolean; sma50: boolean; sma200: boolean }
// Recharts' Formatter accepts ValueType = string | number | (string|number)[].
function fmtTooltip(v: number | string | Array<number | string>, name: unknown, item?: any): [string, string] | null {
  const label = String(name ?? "");
  // Suppress the synthetic candle range entries — we render OHLC separately
  // via the bar payload below so the tooltip stays compact.
  if (label === "Wick") return null;
  if (label === "Candle" && item?.payload) {
    const p = item.payload as { open?: number; high?: number; low?: number; close?: number };
    if ([p.open, p.high, p.low, p.close].every((n) => Number.isFinite(n))) {
      return [
        `O ${p.open!.toFixed(2)}  H ${p.high!.toFixed(2)}  L ${p.low!.toFixed(2)}  C ${p.close!.toFixed(2)}`,
        "OHLC",
      ];
    }
  }
  const n = Array.isArray(v) ? Number(v[0]) : Number(v);
  return [Number.isFinite(n) ? n.toFixed(2) : String(v), label];
}
function fmtVolume(v: number | string | Array<number | string>): [string, string] {
  const n = Array.isArray(v) ? Number(v[0]) : Number(v);
  return [Number.isFinite(n) ? n.toLocaleString() : String(v), "Vol"];
}

type Candle = { time: number; close: number; volume?: number };
type OHLC = { time: number; open: number; high: number; low: number; close: number; volume: number };
type LiveQuote = { symbol: string; price: number; prevClose: number; change: number; changePct: number; ts: number };
export type Interval = "1D" | "4H" | "1H" | "30M" | "5M";

interface Props {
  open: boolean;
  symbol: string;
  defaultInterval?: Interval;
  onClose: () => void;
}

const INTERVALS: Interval[] = ["5M", "30M", "1H", "4H", "1D"];

// Window of bars rendered. The user can pinch to fewer via the buttons.
const WINDOW_PRESETS: { key: string; label: string; bars: number }[] = [
  { key: "30",  label: "30D",  bars: 30 },
  { key: "60",  label: "60D",  bars: 60 },
  { key: "90",  label: "90D",  bars: 90 },
  { key: "all", label: "All",  bars: 400 },
];

function badgeBg(color: SignalColor): string {
  switch (color) {
    case "green": return "bg-signal-green/20 text-signal-green border-signal-green/40";
    case "amber": return "bg-signal-amber/20 text-signal-amber border-signal-amber/40";
    case "red":   return "bg-signal-red/20 text-signal-red border-signal-red/40";
    default:      return "bg-slate-gray/20 text-slate-gray border-slate-gray/40";
  }
}

export default function FullChartModal({ open, symbol, defaultInterval = "1D", onClose }: Props) {
  const [interval, setInterval] = useState<Interval>(defaultInterval);
  const [windowBars, setWindowBars] = useState<number>(60);
  const [visible, setVisible] = useState<SmaVisibility>({ sma20: true, sma50: true, sma200: true });
  const chartHostRef = useRef<HTMLDivElement>(null);

  // Shares-to-buy context: equity × day-color risk % ÷ plan risk_per_share.
  const sharesCtx = useSharesContext();

  // Refresh interval when reopening with a different default.
  useEffect(() => { if (open) setInterval(defaultInterval); }, [open, defaultInterval]);

  // Close on Esc.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // OHLC bars (for candle bodies + wicks). Polled every 60s like the close-only
  // series — candle bars only repaint on close, the live overlay (below) handles
  // intra-bar price movement.
  //
  // Defensive: a third-party browser extension (Capital One Shopping, coupon
  // helpers, ad blockers, etc.) can wrap window.fetch and corrupt the JSON
  // body. We log + throw with a clear message so the error state surfaces
  // instead of leaving the modal blank.
  const { data: candles = [], isLoading, error, refetch } = useQuery<OHLC[]>({
    queryKey: ["/api/candles-ohlc", symbol, interval, "full"],
    queryFn: async ({ signal }) => {
      try {
        const res = await apiRequest("GET", `/api/candles-ohlc/${symbol}?interval=${interval}`, undefined, signal);
        const body = await res.json();
        if (!Array.isArray(body)) {
          console.error("[FullChartModal] candles-ohlc returned non-array:", body);
          throw new Error(`Unexpected response shape (got ${typeof body})`);
        }
        return body;
      } catch (e) {
        // Surface fetch failures (CORS, extension shims, network) with a
        // readable message rather than a silent empty array.
        if (e instanceof Error) {
          console.error("[FullChartModal] candles-ohlc fetch failed:", e);
          throw e;
        }
        throw new Error("Chart fetch failed (unknown error)");
      }
    },
    enabled: open && !!symbol,
    staleTime: 30_000,
    refetchInterval: open ? 60_000 : false,
    retry: 1,
  });

  // Bull Bar Monitor poll — same source as the dashboard panel. Used to surface
  // a top-of-modal alert banner when a Confirmed Bull Bar or Ready to Trade
  // setup fires for this symbol on the 1H chart. Conservative mode + 1:2 R:R
  // mirrors the panel's default — Jake can still flip modes in the panel itself.
  const { data: bullBar } = useQuery<any>({
    queryKey: ["/api/bull-bar-monitor", symbol, "conservative", 2],
    queryFn: async ({ signal }) => {
      const res = await apiRequest("GET", `/api/bull-bar-monitor?symbol=${symbol}&mode=conservative&rr=2`, undefined, signal);
      if (!res.ok) throw new Error(`bull-bar ${res.status}`);
      return res.json();
    },
    enabled: open && !!symbol,
    staleTime: 30_000,
    refetchInterval: open ? 60_000 : false,
    retry: false,
  });

  // SMH-only hammer monitor poll. Hammer route is SMH-fixed today, so only
  // attempt the query when the modal is showing SMH.
  const { data: hammer } = useQuery<any>({
    queryKey: ["/api/smh-hammer-monitor", "conservative", 2],
    queryFn: async ({ signal }) => {
      const res = await apiRequest("GET", `/api/smh-hammer-monitor?mode=conservative&rr=2`, undefined, signal);
      if (!res.ok) throw new Error(`hammer ${res.status}`);
      return res.json();
    },
    enabled: open && symbol === "SMH",
    staleTime: 30_000,
    refetchInterval: open && symbol === "SMH" ? 60_000 : false,
    retry: false,
  });

  // Live quote: separate, fast-polling query that powers the header price and
  // the dashed "live" line + dot overlay on the chart. 5s cadence is well
  // within the server's 90s upstream cadence — we'll just re-read the cached
  // snapshot most of the time, which is cheap.
  const { data: liveQuote } = useQuery<LiveQuote>({
    queryKey: ["/api/prices", symbol],
    queryFn: async ({ signal }) => {
      const res = await apiRequest("GET", `/api/prices/${symbol}`, undefined, signal);
      if (!res.ok) throw new Error(`live quote ${res.status}`);
      return res.json();
    },
    enabled: open && !!symbol,
    staleTime: 4_000,
    refetchInterval: open ? 5_000 : false,
    retry: false,
  });

  const { rows, aScore, barLastPrice, barLastChange, signalMarkers, sma20Last, sma50Last, sma200Last } = useMemo(() => {
    const closes = candles.map(c => c.close);
    const { sma20, sma50, sma200 } = computeSMAs(closes);
    const fullRows = candles.map((c, i) => ({
      i,
      time: c.time,
      price: c.close,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      // Recharts custom <Bar shape> receives the row through `payload`. Encode
      // wick + body endpoints as the bar's value so axis scaling sees them.
      wick: [c.low, c.high] as [number, number],
      body: [Math.min(c.open, c.close), Math.max(c.open, c.close)] as [number, number],
      bullish: c.close >= c.open,
      sma20: sma20[i],
      sma50: sma50[i],
      sma200: sma200[i],
      volume: c.volume ?? 0,
      dateLabel: new Date(c.time * 1000).toLocaleDateString(undefined, {
        month: "short", day: "numeric",
        ...(interval !== "1D" ? { hour: "2-digit", minute: "2-digit" } : {}),
      }),
    }));
    const slice = fullRows.slice(-windowBars);

    // Re-index so XAxis labels still line up.
    const rows = slice.map((r, i) => ({ ...r, i }));

    // Signal markers: scan the window for crosses + at-SMA touches.
    const markers: { i: number; price: number; kind: "A4" | "REJ" | "A3" }[] = [];
    for (let k = 1; k < rows.length; k++) {
      const r = rows[k];
      const p = rows[k - 1];
      if (r.sma20 == null || p.sma20 == null) continue;
      if (p.price < p.sma20 && r.price >= r.sma20) {
        markers.push({ i: r.i, price: r.price, kind: "A4" });
      } else if (p.price > p.sma20 && r.price <= r.sma20) {
        markers.push({ i: r.i, price: r.price, kind: "REJ" });
      } else if (Math.abs(r.price - r.sma20) / r.sma20 <= 0.002) {
        markers.push({ i: r.i, price: r.price, kind: "A3" });
      }
    }

    const aScore = getAScore(closes, sma20);
    const barLastPrice = closes[closes.length - 1];
    const prev = closes[closes.length - 2];
    const barLastChange = barLastPrice != null && prev != null ? ((barLastPrice - prev) / prev) * 100 : null;
    const last = (arr: (number | null)[]) => {
      for (let k = arr.length - 1; k >= 0; k--) if (arr[k] != null) return arr[k] as number;
      return null;
    };
    return {
      rows, aScore, barLastPrice, barLastChange, signalMarkers: markers,
      sma20Last: last(sma20), sma50Last: last(sma50), sma200Last: last(sma200),
    };
  }, [candles, windowBars, interval]);

  // Live overlay: prefer the live tick when it's reasonably fresh (≤ 5 min old).
  // Otherwise fall back to the last bar close, preserving the previous behavior.
  const liveFresh = liveQuote && Number.isFinite(liveQuote.price)
    && (Date.now() / 1000 - liveQuote.ts) < 300;
  const lastPrice = liveFresh ? liveQuote!.price : barLastPrice;
  const lastChange = liveFresh
    ? (Number.isFinite(liveQuote!.changePct) ? liveQuote!.changePct : null)
    : barLastChange;

  // ── Pattern alert banner state ─────────────────────────────────────
  // Highest-priority status across hammer + bull bar monitors. Ready to Trade
  // > Confirmed > Forming. Scanning/Invalidated do not surface a banner.
  const patternAlert = useMemo(() => {
    type Tone = "ready" | "confirmed" | "forming";
    const RANK: Record<string, Tone> = {
      "Ready to Trade": "ready",
      "Confirmed Bull Bar": "confirmed",
      "Confirmed Hammer": "confirmed",
      "Bull Bar Forming": "forming",
      "Hammer Forming": "forming",
    };
    const RANK_ORDER: Record<Tone, number> = { ready: 3, confirmed: 2, forming: 1 };
    type Banner = { tone: Tone; pattern: "Bull Bar" | "Hammer"; phase: string; plan?: any; mode?: string; rr?: number };
    const candidates: Banner[] = [];
    if (bullBar?.phase && RANK[bullBar.phase]) {
      candidates.push({ tone: RANK[bullBar.phase], pattern: "Bull Bar", phase: bullBar.phase, plan: bullBar.trade_plan, mode: bullBar.mode, rr: bullBar.rr });
    }
    if (hammer?.phase && RANK[hammer.phase]) {
      candidates.push({ tone: RANK[hammer.phase], pattern: "Hammer", phase: hammer.phase, plan: hammer.trade_plan, mode: hammer.mode, rr: hammer.rr });
    }
    if (candidates.length === 0) return null;
    return candidates.sort((a, b) => RANK_ORDER[b.tone] - RANK_ORDER[a.tone])[0];
  }, [bullBar, hammer]);

  // Explicit price-axis domain so candle highs/lows + live-price overlay are
  // always in view, with a small padding so candles don't hug the edges.
  const priceDomain = useMemo<[number, number]>(() => {
    if (rows.length === 0) return [0, 1];
    let lo = Infinity, hi = -Infinity;
    for (const r of rows) {
      if (Number.isFinite(r.low)) lo = Math.min(lo, r.low);
      if (Number.isFinite(r.high)) hi = Math.max(hi, r.high);
      // SMAs visible — include them in the range.
      if (visible.sma20 && r.sma20 != null) { lo = Math.min(lo, r.sma20); hi = Math.max(hi, r.sma20); }
      if (visible.sma50 && r.sma50 != null) { lo = Math.min(lo, r.sma50); hi = Math.max(hi, r.sma50); }
      if (visible.sma200 && r.sma200 != null) { lo = Math.min(lo, r.sma200); hi = Math.max(hi, r.sma200); }
    }
    if (liveFresh) {
      lo = Math.min(lo, liveQuote!.price);
      hi = Math.max(hi, liveQuote!.price);
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
    const pad = Math.max(0.5, (hi - lo) * 0.04);
    return [lo - pad, hi + pad];
  }, [rows, visible, liveFresh, liveQuote]);

  const toggleSma = (key: keyof SmaVisibility) =>
    setVisible(v => ({ ...v, [key]: !v[key] }));

  const errMsg = error instanceof Error ? error.message : "";

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="modal-fullchart-backdrop"
    >
      <div
        className="bg-ink-panel border border-ink-line rounded-sm w-full max-w-6xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-ink-line">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-[18px] font-mono-num font-semibold uppercase tracking-wider text-soft-white">
              {symbol}
            </span>
            <span
              className={`px-1.5 py-0.5 text-[10px] font-mono-num uppercase tracking-wider border rounded-sm ${badgeBg(aScore.color)}`}
              title={aScore.tooltip}
              data-testid={`badge-ascore-modal-${symbol}`}
            >{aScore.label}</span>
            {lastPrice != null && (
              <span className="text-[14px] font-mono-num tabular-nums text-soft-white">
                ${lastPrice.toFixed(2)}
                {lastChange != null && (
                  <span className={`ml-2 ${lastChange >= 0 ? "text-signal-green" : "text-signal-red"}`}>
                    {lastChange >= 0 ? "+" : ""}{lastChange.toFixed(2)}%
                  </span>
                )}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-slate-gray hover:text-soft-white transition-colors p-1"
            aria-label="Close full chart"
            data-testid="button-close-fullchart"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Pattern alert banner — surfaces when bull bar / hammer confirms. */}
        {patternAlert && (() => {
          const tone = patternAlert.tone;
          const toneClass =
            tone === "ready"     ? "bg-signal-green/15 border-signal-green/50 text-signal-green" :
            tone === "confirmed" ? "bg-signal-green/10 border-signal-green/40 text-signal-green" :
                                   "bg-signal-amber/10 border-signal-amber/40 text-signal-amber";
          const icon =
            tone === "ready"     ? "▲" :
            tone === "confirmed" ? "●" :
                                   "·";
          const plan = patternAlert.plan;
          return (
            <div
              className={`px-4 py-2 border-b text-[11px] font-mono-num uppercase tracking-wider flex items-center gap-3 ${toneClass}`}
              data-testid={`banner-pattern-${patternAlert.pattern.toLowerCase().replace(" ", "-")}-${tone}`}
            >
              <span className="text-[12px]" aria-hidden="true">{icon}</span>
              <span className="font-semibold">{patternAlert.pattern} · {patternAlert.phase}</span>
              {plan?.entry != null && (() => {
                const rps = Number(plan.risk_per_share);
                const shares = sharesForPlan(sharesCtx, rps);
                const showShares = sharesCtx.equity > 0 && Number.isFinite(rps) && rps > 0;
                const sharesTitle = showShares
                  ? `${sharesCtx.regime} day · ${(sharesCtx.riskPct * 100).toFixed(2)}% of $${sharesCtx.equity.toFixed(2)} ÷ $${rps.toFixed(2)}/sh`
                  : undefined;
                return (
                  <span className="text-soft-white/90 normal-case tracking-normal">
                    Entry <b className="tabular-nums">{Number(plan.entry).toFixed(2)}</b>
                    {" · "}Stop <b className="tabular-nums">{Number(plan.stop_loss).toFixed(2)}</b>
                    {plan.target != null && <>{" · "}Target <b className="tabular-nums">{Number(plan.target).toFixed(2)}</b></>}
                    {showShares && (
                      <>
                        {" · "}
                        <span title={sharesTitle} data-testid="text-modal-shares">
                          Shares <b className="tabular-nums">{formatShares(shares)}</b>
                        </span>
                      </>
                    )}
                    {patternAlert.rr != null && <>{" (1:"}{patternAlert.rr}{")"}</>}
                  </span>
                );
              })()}
              <span className="ml-auto text-slate-gray">{patternAlert.mode || ""}{patternAlert.mode ? " · 1H" : "1H"}</span>
            </div>
          );
        })()}

        {/* Toolbar: interval + window pickers */}
        <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-ink-line/60 text-[10px] uppercase tracking-wider">
          <div className="flex items-center gap-2">
            <span className="text-slate-gray">Interval</span>
            <div className="flex items-center border border-ink-line/80 rounded-sm overflow-hidden">
              {INTERVALS.map(iv => {
                const active = iv === interval;
                return (
                  <button
                    key={iv}
                    onClick={() => setInterval(iv)}
                    data-testid={`button-modal-interval-${iv}`}
                    className={`px-2 py-1 font-mono-num tracking-wider transition-colors ${
                      active ? "bg-neon-blue/15 text-neon-blue" : "text-slate-gray hover:bg-ink-line/40 hover:text-soft-white"
                    }`}
                  >{iv}</button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-gray">Window</span>
            <div className="flex items-center border border-ink-line/80 rounded-sm overflow-hidden">
              {WINDOW_PRESETS.map(w => {
                const active = (w.key === "all" ? rows.length >= 200 : windowBars === w.bars);
                return (
                  <button
                    key={w.key}
                    onClick={() => setWindowBars(w.bars)}
                    data-testid={`button-modal-window-${w.key}`}
                    className={`px-2 py-1 font-mono-num tracking-wider transition-colors ${
                      active ? "bg-neon-blue/15 text-neon-blue" : "text-slate-gray hover:bg-ink-line/40 hover:text-soft-white"
                    }`}
                  >{w.label}</button>
                );
              })}
            </div>
          </div>
          {/* SMA legend + last values — lives in the toolbar so values never
              overlap the candles. Click to toggle each line on/off. */}
          <div className="ml-auto flex gap-3 text-slate-gray font-mono-num tabular-nums">
            <button
              type="button"
              onClick={() => toggleSma("sma20")}
              aria-pressed={visible.sma20}
              aria-label={`Toggle SMA20 line ${visible.sma20 ? "off" : "on"}`}
              className={`flex items-center gap-1.5 transition-opacity ${visible.sma20 ? "opacity-100" : "opacity-40"} hover:text-soft-white`}
              data-testid={`button-modal-legend-sma20`}
            >
              <i className="w-2 h-px bg-neon-blue inline-block" aria-hidden="true" />
              <span>20</span>
              <span className="text-neon-blue">{sma20Last != null ? sma20Last.toFixed(2) : "—"}</span>
            </button>
            <button
              type="button"
              onClick={() => toggleSma("sma50")}
              aria-pressed={visible.sma50}
              aria-label={`Toggle SMA50 line ${visible.sma50 ? "off" : "on"}`}
              className={`flex items-center gap-1.5 transition-opacity ${visible.sma50 ? "opacity-100" : "opacity-40"} hover:text-soft-white`}
              data-testid={`button-modal-legend-sma50`}
            >
              <i className="w-2 h-px bg-signal-amber inline-block" aria-hidden="true" />
              <span>50</span>
              <span className="text-signal-amber">{sma50Last != null ? sma50Last.toFixed(2) : "—"}</span>
            </button>
            <button
              type="button"
              onClick={() => toggleSma("sma200")}
              aria-pressed={visible.sma200}
              aria-label={`Toggle SMA200 line ${visible.sma200 ? "off" : "on"}`}
              className={`flex items-center gap-1.5 transition-opacity ${visible.sma200 ? "opacity-100" : "opacity-40"} hover:text-soft-white`}
              data-testid={`button-modal-legend-sma200`}
            >
              <i className="w-2 h-px bg-signal-red inline-block" aria-hidden="true" />
              <span>200</span>
              <span className="text-signal-red">{sma200Last != null ? sma200Last.toFixed(2) : "—"}</span>
            </button>
          </div>
        </div>

        {/* Chart body */}
        <div className="flex-1 min-h-0 p-4 flex flex-col gap-2">
          {isLoading && rows.length === 0 && (
            <div className="flex-1 flex items-center justify-center text-[11px] uppercase tracking-wider text-slate-gray" data-testid="chart-modal-loading">
              Loading chart…
            </div>
          )}
          {error && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[11px] uppercase tracking-wider" data-testid="chart-modal-error">
              <div className="text-signal-red max-w-md text-center">{errMsg.slice(0, 180) || "Fetch error"}</div>
              <button
                onClick={() => refetch()}
                className="px-3 py-1 border border-neon-blue/40 text-neon-blue rounded-sm hover:bg-neon-blue/10 transition-colors"
                data-testid="button-chart-retry"
              >Retry</button>
              <div className="text-slate-gray text-[10px] normal-case tracking-normal max-w-md text-center">
                If this keeps failing, try disabling browser extensions (coupon, ad-block, shopping helpers) — they sometimes intercept network requests.
              </div>
            </div>
          )}
          {!isLoading && !error && rows.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[11px] uppercase tracking-wider" data-testid="chart-modal-empty">
              <div className="text-slate-gray">No chart data available for {symbol} · {interval}</div>
              <button
                onClick={() => refetch()}
                className="px-3 py-1 border border-neon-blue/40 text-neon-blue rounded-sm hover:bg-neon-blue/10 transition-colors"
                data-testid="button-chart-reload"
              >Reload</button>
            </div>
          )}
          {rows.length > 0 && (
            <>
              {/* Price + SMAs (main pane) */}
              <div
                ref={chartHostRef}
                className="relative"
                style={{ height: 360, width: "100%" }}
                role="img"
                aria-label={`${symbol} price chart, ${interval} timeframe, ${rows.length} bars` + (lastPrice != null ? `, last ${lastPrice.toFixed(2)}` : "")}
                data-testid={`chart-fullchart-${symbol}`}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="hsl(var(--ink-line))" strokeOpacity={0.4} vertical={false} />
                    <XAxis
                      dataKey="dateLabel"
                      tick={{ fill: "hsl(var(--slate-gray))", fontSize: 10, fontFamily: "var(--font-mono)" }}
                      stroke="hsl(var(--ink-line))"
                      interval="preserveStartEnd"
                      minTickGap={40}
                    />
                    <YAxis
                      yAxisId="price"
                      domain={priceDomain}
                      tick={{ fill: "hsl(var(--slate-gray))", fontSize: 10, fontFamily: "var(--font-mono)" }}
                      stroke="hsl(var(--ink-line))"
                      width={48}
                      orientation="right"
                      allowDataOverflow={false}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--ink-panel))",
                        border: "1px solid hsl(var(--ink-line))",
                        borderRadius: 2,
                        fontSize: 11,
                        fontFamily: "var(--font-mono)",
                      }}
                      formatter={fmtTooltip}
                    />
                    {visible.sma200 && (
                      <Line yAxisId="price" type="monotone" dataKey="sma200" name="SMA200" stroke="hsl(var(--signal-red))" strokeWidth={1} dot={false} isAnimationActive={false} connectNulls />
                    )}
                    {visible.sma50 && (
                      <Line yAxisId="price" type="monotone" dataKey="sma50"  name="SMA50"  stroke="hsl(var(--signal-amber))" strokeWidth={1} dot={false} isAnimationActive={false} connectNulls />
                    )}
                    {visible.sma20 && (
                      <Line yAxisId="price" type="monotone" dataKey="sma20"  name="SMA20"  stroke="hsl(var(--neon-blue))"   strokeWidth={1.25} dot={false} isAnimationActive={false} connectNulls />
                    )}
                    {/* Faint price line — guarantees ResponsiveContainer mounts
                        a series, gives the tooltip a hit target, and provides a
                        subtle reference path through the candle bodies. */}
                    <Line yAxisId="price" type="linear" dataKey="price" name="Price" stroke="hsl(var(--soft-white))" strokeOpacity={0.08} strokeWidth={1} dot={false} isAnimationActive={false} />
                    {/* Candle wicks (high↔low) drawn as range bars with custom shape. */}
                    <Bar yAxisId="price" dataKey="wick" name="Wick" shape={CandleWickShape} isAnimationActive={false} legendType="none" />
                    {/* Candle bodies (open↔close) drawn as range bars with custom shape. */}
                    <Bar yAxisId="price" dataKey="body" name="Candle" shape={CandleBodyShape} isAnimationActive={false} legendType="none" />
                    {/* Live price overlay — horizontal dashed line at the live tick. */}
                    {liveFresh && (
                      <ReferenceLine
                        yAxisId="price"
                        y={liveQuote!.price}
                        stroke={liveQuote!.price >= barLastPrice ? "hsl(var(--signal-green))" : "hsl(var(--signal-red))"}
                        strokeDasharray="3 3"
                        strokeWidth={1}
                        label={{
                          value: `LIVE ${liveQuote!.price.toFixed(2)}`,
                          position: "insideTopRight",
                          fill: liveQuote!.price >= barLastPrice ? "hsl(var(--signal-green))" : "hsl(var(--signal-red))",
                          fontSize: 10,
                          fontFamily: "var(--font-mono)",
                          offset: 6,
                        }}
                        ifOverflow="extendDomain"
                      />
                    )}
                    {signalMarkers.map((m, idx) => (
                      <ReferenceDot
                        key={idx}
                        yAxisId="price"
                        x={rows[m.i]?.dateLabel}
                        y={m.price}
                        r={4}
                        fill={
                          m.kind === "A4" ? "hsl(var(--signal-green))" :
                          m.kind === "REJ" ? "hsl(var(--signal-red))" :
                          "hsl(var(--signal-amber))"
                        }
                        stroke="hsl(var(--ink-panel))"
                        strokeWidth={1}
                        ifOverflow="hidden"
                      />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Volume bars pane */}
              <div className="h-20">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={rows} margin={{ top: 0, right: 12, bottom: 8, left: 0 }}>
                    <CartesianGrid stroke="hsl(var(--ink-line))" strokeOpacity={0.3} vertical={false} />
                    <XAxis
                      dataKey="dateLabel"
                      tick={false}
                      stroke="hsl(var(--ink-line))"
                      axisLine={false}
                    />
                    <YAxis
                      yAxisId="vol"
                      domain={[0, "auto"]}
                      tick={{ fill: "hsl(var(--slate-gray))", fontSize: 9, fontFamily: "var(--font-mono)" }}
                      stroke="hsl(var(--ink-line))"
                      width={48}
                      orientation="right"
                      tickFormatter={(v: number) => {
                        if (v >= 1e9) return (v / 1e9).toFixed(1) + "B";
                        if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
                        if (v >= 1e3) return (v / 1e3).toFixed(0) + "K";
                        return String(v);
                      }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--ink-panel))",
                        border: "1px solid hsl(var(--ink-line))",
                        borderRadius: 2,
                        fontSize: 11,
                        fontFamily: "var(--font-mono)",
                      }}
                      formatter={fmtVolume}
                    />
                    <Bar yAxisId="vol" dataKey="volume" name="Volume" fill="hsl(var(--slate-gray))" fillOpacity={0.5} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-ink-line/60 text-[10px] uppercase tracking-wider text-slate-gray flex items-center justify-between gap-2">
          <span title={aScore.tooltip}>{aScore.tooltip}</span>
          <div className="flex items-center gap-4">
            <a
              href={`https://www.tradingview.com/chart/?symbol=${symbol}`}
              target="_blank" rel="noopener noreferrer"
              className="hover:text-neon-blue transition-colors"
              data-testid={`link-tv-fullchart-${symbol}`}
            >Open in TradingView</a>
            <a
              href={`https://finviz.com/quote.ashx?t=${symbol}`}
              target="_blank" rel="noopener noreferrer"
              className="hover:text-neon-blue transition-colors"
              data-testid={`link-fv-fullchart-${symbol}`}
            >Finviz</a>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Candle shapes (custom <Bar shape>) ─────────────────────────────
// Recharts passes each bar `x`, `y`, `width`, `height`, and the row in
// `payload`. For range bars (dataKey returns [lo, hi]) Recharts maps the
// range to y/height already; we still re-derive from payload so the wick
// and body line up exactly with OHLC values and the price scale.
//
// `background` carries the full plot rect (y0..yEnd) — we use it to grab
// the price-axis pixel range and compute our own y from the row OHLC.
function CandleWickShape(props: any) {
  const { x, y, width, height, payload } = props;
  if (!payload) return null;
  const { high, low, open, close } = payload;
  if (![high, low, open, close].every((n: any) => Number.isFinite(n))) return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  const cx = x + width / 2;
  const color = close >= open ? "hsl(var(--signal-green))" : "hsl(var(--signal-red))";
  return <line x1={cx} x2={cx} y1={y} y2={y + height} stroke={color} strokeWidth={1} />;
}

function CandleBodyShape(props: any) {
  const { x, y, width, height, payload } = props;
  if (!payload) return null;
  const { open, close } = payload;
  if (!Number.isFinite(open) || !Number.isFinite(close)) return null;
  const color = close >= open ? "hsl(var(--signal-green))" : "hsl(var(--signal-red))";
  // Body width: 60% of the slot width, min 2px.
  const bodyW = Math.max(2, width * 0.6);
  const bodyX = x + (width - bodyW) / 2;
  const h = Math.max(1, height);
  return <rect x={bodyX} y={y} width={bodyW} height={h} fill={color} stroke={color} strokeWidth={1} />;
}

