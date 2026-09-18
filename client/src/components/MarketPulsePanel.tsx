// ─── MarketPulsePanel ─────────────────────────────────────────────────────
// Compact watchlist-at-a-glance for the Cockpit. Uses:
//   - existing live price feed (useLiveQuotes) for price + intraday change
//   - existing /api/candles-ohlc endpoint for the 20-bar sparkline + status
// Clicking a ticker sets it as the active Cockpit chart ticker.
//
// Status derivation (leading/improving/neutral/choppy/weakening/breakdown)
// is a translation over signals we already emit — nothing new. Rules:
//   price > 20SMA > 50SMA  and up-day             -> LEADING
//   price > 20SMA                                 -> IMPROVING
//   |price/20SMA - 1| < 0.5%                      -> NEUTRAL
//   price < 20SMA but > 50SMA                     -> WEAKENING
//   price < 20SMA < 50SMA and down-day            -> BREAKDOWN RISK
//   choppy 20SMA slope near zero                  -> CHOPPY
// Data missing on any leg -> shown as a dash, no fake status.

import { useQuery, useQueries } from "@tanstack/react-query";
import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useLiveQuotes } from "@/lib/useLivePrices";
import Sparkline from "@/components/charts/Sparkline";
import { useCockpitTicker, DEFAULT_CHIPS } from "@/components/CockpitTickerContext";
import { Activity, ChevronDown, ChevronRight } from "lucide-react";
import type { Settings } from "@shared/schema";

// Ticker symbol size, driven by settings.vehicleTickerScale.
const TICKER_SCALE_CLS: Record<string, string> = {
  sm:   "text-[11px]",
  md:   "text-[13px]",
  lg:   "text-[15px]",
  xl:   "text-[17px]",
  "2xl": "text-[20px]",
};

interface OHLCBar { time: number; open: number; high: number; low: number; close: number; volume: number }

type Status = "LEADING" | "IMPROVING" | "NEUTRAL" | "CHOPPY" | "WEAKENING" | "BREAKDOWN";
const STATUS_STYLES: Record<Status, { text: string; bg: string; border: string; label: string }> = {
  LEADING:    { text: "text-signal-green", bg: "bg-signal-green/10", border: "border-signal-green/40", label: "Leading" },
  IMPROVING:  { text: "text-signal-green", bg: "bg-signal-green/8",  border: "border-signal-green/30", label: "Improving" },
  NEUTRAL:    { text: "text-slate-gray",   bg: "bg-ink-panel/60",    border: "border-ink-line",       label: "Neutral" },
  CHOPPY:     { text: "text-signal-amber", bg: "bg-signal-amber/8",  border: "border-signal-amber/30", label: "Choppy" },
  WEAKENING:  { text: "text-signal-amber", bg: "bg-signal-amber/10", border: "border-signal-amber/40", label: "Weakening" },
  BREAKDOWN:  { text: "text-signal-red",   bg: "bg-signal-red/10",   border: "border-signal-red/40",   label: "Breakdown Risk" },
};

function sma(vals: number[], period: number): number | null {
  if (vals.length < period) return null;
  let sum = 0;
  for (let i = vals.length - period; i < vals.length; i++) sum += vals[i];
  return sum / period;
}

function slopePct(vals: number[]): number | null {
  if (vals.length < 6) return null;
  const first = vals[vals.length - 5];
  const last = vals[vals.length - 1];
  if (!first) return null;
  return ((last - first) / first) * 100;
}

function pickStatus(bars: OHLCBar[] | undefined): Status | null {
  if (!bars || bars.length < 25) return null;
  const closes = bars.map((b) => b.close);
  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);
  if (s20 == null) return null;
  const last = closes[closes.length - 1];
  const prev = closes[closes.length - 2];
  const upDay = last >= prev;
  const distFrom20Pct = ((last - s20) / s20) * 100;
  const slope20 = slopePct(closes.slice(-20));

  if (s50 != null && last > s20 && s20 > s50 && upDay) return "LEADING";
  if (last > s20) return "IMPROVING";
  if (Math.abs(distFrom20Pct) < 0.5 && (slope20 == null || Math.abs(slope20) < 0.3)) return "NEUTRAL";
  if (s50 != null && last < s20 && last > s50) return "WEAKENING";
  if (s50 != null && last < s20 && s20 < s50 && !upDay) return "BREAKDOWN";
  if (slope20 != null && Math.abs(slope20) < 0.3) return "CHOPPY";
  return "NEUTRAL";
}

function fmt$(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}
function fmtSignedPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

interface RowProps {
  ticker: string;
  active: boolean;
  onClick: () => void;
  tickerScaleCls: string;
  bodyColor: string;
  isCore: boolean;
}
function TickerRow({ ticker, active, onClick, tickerScaleCls, bodyColor, isCore }: RowProps) {
  const quotes = useLiveQuotes();
  const q = quotes[ticker];
  const barsQ = useQuery<OHLCBar[]>({
    queryKey: ["/api/candles-ohlc", ticker, "1D"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/candles-ohlc/${ticker}?interval=1D`);
      return await res.json();
    },
    staleTime: 5 * 60_000,
  });
  const bars = barsQ.data;
  const status = pickStatus(bars);
  const s = status ? STATUS_STYLES[status] : null;

  // Last 20 closes for the sparkline. Falls back to empty (Sparkline handles it).
  const spark = bars ? bars.slice(-20).map((b) => b.close) : [];
  const chgPct = q?.changePct ?? null;
  const chgTone =
    chgPct == null ? "text-slate-gray" :
    chgPct > 0 ? "text-signal-green" :
    chgPct < 0 ? "text-signal-red" : "text-slate-gray";
  const sparkColor =
    chgPct == null ? "#64748b" :
    chgPct >= 0 ? "rgb(34 197 94)" : "rgb(239 68 68)";

  return (
    <button
      onClick={onClick}
      data-testid={`pulse-row-${ticker}`}
      className={`w-full text-left rounded border px-2.5 py-2 flex items-center gap-3 transition-colors ${
        active
          ? "border-neon-blue bg-neon-blue/8"
          : "border-ink-line bg-ink-panel/30 hover:border-slate-gray hover:bg-ink-panel/60"
      }`}
    >
      <div className="flex-shrink-0 w-16">
        <div
          className={`${isCore ? tickerScaleCls : "text-[12px]"} font-mono font-bold ${active ? "text-neon-blue" : "text-soft-white"}`}
        >
          {ticker}
        </div>
        <div
          className="text-[9px] uppercase tracking-wider"
          style={isCore ? { color: bodyColor } : undefined}
        >
          {DEFAULT_CHIPS.includes(ticker) ? "core" : "watch"}
        </div>
      </div>
      <div className="flex-shrink-0 w-16 text-right font-mono">
        <div
          className="text-[11px] text-soft-white"
          style={isCore ? { color: bodyColor } : undefined}
        >
          {fmt$(q?.price)}
        </div>
        <div className={`text-[10px] ${chgTone}`}>{fmtSignedPct(chgPct)}</div>
      </div>
      <div className="flex-shrink-0">
        <Sparkline data={spark} width={72} height={22} stroke={sparkColor} strokeWidth={1.2} showDot={false} />
      </div>
      <div className="flex-1 min-w-0 flex justify-end">
        {s ? (
          <span
            className={`text-[10px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded border ${s.border} ${s.bg} ${s.text}`}
            data-testid={`pulse-status-${ticker}`}
          >
            {s.label}
          </span>
        ) : (
          <span className="text-[10px] text-slate-gray">—</span>
        )}
      </div>
    </button>
  );
}

interface MarketPulsePanelProps {
  /** Compact left-column variant — tighter padding, shorter hint. */
  compact?: boolean;
}

export default function MarketPulsePanel({ compact = false }: MarketPulsePanelProps = {}) {
  const { chips, active, select } = useCockpitTicker();
  const [collapsed, setCollapsed] = useState(false);
  const settingsQ = useQuery<Settings>({ queryKey: ["/api/settings"], staleTime: 60_000 });
  const tickerScaleCls = TICKER_SCALE_CLS[settingsQ.data?.vehicleTickerScale || "lg"] || TICKER_SCALE_CLS.lg;
  const bodyColor = settingsQ.data?.vehicleBodyColor || "#94a3b8";

  // Order: defaults (SMH, SPY, QQQ) first, then user-added.
  const ordered = [
    ...DEFAULT_CHIPS.filter((d) => chips.includes(d)),
    ...chips.filter((c) => !DEFAULT_CHIPS.includes(c)),
  ];

  return (
    <div
      className={`rounded-md border border-ink-line bg-ink-black ${compact ? "p-3" : "p-4"} space-y-2.5`}
      data-testid="section-market-pulse"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="text-slate-gray hover:text-neon-blue flex-shrink-0"
            title={collapsed ? "Expand" : "Collapse"}
            data-testid="button-toggle-market-pulse"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          <Activity className="h-4 w-4 text-neon-blue flex-shrink-0" />
          <h3 className="text-[13px] font-bold text-soft-white uppercase tracking-wider">
            Market Pulse
          </h3>
        </div>
        {!compact && !collapsed && (
          <span className="text-[10px] text-slate-gray">click a row to focus the chart</span>
        )}
      </div>
      {!collapsed && (
        <div className="space-y-1.5">
          {ordered.map((t) => (
            <TickerRow
              key={t}
              ticker={t}
              active={t === active}
              onClick={() => select(t)}
              tickerScaleCls={tickerScaleCls}
              bodyColor={bodyColor}
              isCore={DEFAULT_CHIPS.includes(t)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
