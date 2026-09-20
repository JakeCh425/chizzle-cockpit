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
import { useState, useRef, useEffect } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useLiveQuotes } from "@/lib/useLivePrices";
import Sparkline from "@/components/charts/Sparkline";
import { useCockpitTicker } from "@/components/CockpitTickerContext";
import { Activity, ChevronDown, ChevronRight, Plus, X, ArrowUp, ArrowDown } from "lucide-react";
import CoreTickerHoverCard from "@/components/CoreTickerHoverCard";
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
  /** × button on watch rows removes the ticker entirely. */
  onRemove?: () => void;
  /** Down-arrow on Core rows demotes to Watch (stays in list, unpinned). */
  onDemote?: () => void;
  /** Up-arrow on Watch rows promotes to Core (may bump the last Core out). */
  onPromote?: () => void;
  tickerScaleCls: string;
  bodyColor: string;
  isCore: boolean;
  /** When true (Core rows), a rich hover card is rendered. */
  showHoverCard: boolean;
}
function TickerRow({ ticker, active, onClick, onRemove, onDemote, onPromote, tickerScaleCls, bodyColor, isCore, showHoverCard }: RowProps) {
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

  // Hover card: opens on mouseenter with a 250ms delay so brief mouse
  // travel through the row doesn't spawn cards. Closes immediately on leave.
  const [hovering, setHovering] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);
  const openHover = () => {
    if (!showHoverCard) return;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    // If card is already open (user is moving across the gap from row to
    // card), open immediately; otherwise wait 250ms so brief mouse travel
    // doesn't spawn cards.
    hoverTimer.current = setTimeout(() => setHovering(true), hovering ? 0 : 250);
  };
  const closeHover = () => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    // Small close delay so cursor can bridge the ml-2 gap from row to card
    // without the card yanking shut mid-transit.
    hoverTimer.current = setTimeout(() => setHovering(false), 120);
  };
  const chgTone =
    chgPct == null ? "text-slate-gray" :
    chgPct > 0 ? "text-signal-green" :
    chgPct < 0 ? "text-signal-red" : "text-slate-gray";
  const sparkColor =
    chgPct == null ? "#64748b" :
    chgPct >= 0 ? "rgb(34 197 94)" : "rgb(239 68 68)";

  return (
    <div
      data-testid={`pulse-row-${ticker}`}
      onMouseEnter={openHover}
      onMouseLeave={closeHover}
      className={`relative w-full rounded border px-2.5 py-2 flex items-center gap-3 transition-colors ${
        active
          ? "border-neon-blue bg-neon-blue/8"
          : "border-ink-line bg-ink-panel/30 hover:border-slate-gray hover:bg-ink-panel/60"
      }`}
    >
      {/* Whole row (minus the action buttons) is a click target for focusing the chart. */}
      <button onClick={onClick} className="flex-1 min-w-0 text-left flex items-center gap-3">
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
          {isCore ? "core" : "watch"}
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
      {/* Row action buttons — Core gets ↓ (demote), Watch gets ↑ (promote) + × (remove).
          Demoting Core just unpins it; the ticker stays in the list as Watch.
          Promoting Watch bumps the last Core row down if Core is at cap. */}
      <div className="flex-shrink-0 flex items-center gap-0.5">
        {isCore && onDemote && (
          <button
            onClick={(e) => { e.stopPropagation(); onDemote(); }}
            data-testid={`pulse-demote-${ticker}`}
            title={`Move ${ticker} out of Core (keeps it in Watch)`}
            className="text-slate-gray/60 hover:text-signal-amber p-1 rounded hover:bg-signal-amber/10"
          >
            <ArrowDown className="h-3 w-3" />
          </button>
        )}
        {!isCore && onPromote && (
          <button
            onClick={(e) => { e.stopPropagation(); onPromote(); }}
            data-testid={`pulse-promote-${ticker}`}
            title={`Pin ${ticker} to Core (bumps the last Core out)`}
            className="text-slate-gray/60 hover:text-neon-blue p-1 rounded hover:bg-neon-blue/10"
          >
            <ArrowUp className="h-3 w-3" />
          </button>
        )}
        {!isCore && onRemove && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            data-testid={`pulse-remove-${ticker}`}
            title={`Remove ${ticker} from Market Pulse`}
            className="text-slate-gray/60 hover:text-signal-red p-1 rounded hover:bg-signal-red/10"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Hover card — rich trade idea + fundamentals + readiness meter.
          Anchored to right side of the row; z-index above sibling rows. */}
      {showHoverCard && hovering && (
        // pointer-events-auto so the Push button inside the card is clickable.
        // Card has its own onMouseEnter/Leave to keep itself open while the
        // cursor is on it (otherwise moving from row → card would close it).
        <div
          className="absolute z-50 left-full top-0 ml-2"
          onMouseEnter={openHover}
          onMouseLeave={closeHover}
        >
          <CoreTickerHoverCard ticker={ticker} />
        </div>
      )}
    </div>
  );
}

interface MarketPulsePanelProps {
  /** Compact left-column variant — tighter padding, shorter hint. */
  compact?: boolean;
}

export default function MarketPulsePanel({ compact = false }: MarketPulsePanelProps = {}) {
  const { chips, coreChips, active, select, add, remove, isCore, promoteToCore, demoteFromCore } = useCockpitTicker();
  const [collapsed, setCollapsed] = useState(false);
  const [addValue, setAddValue] = useState("");

  // Symbols: uppercase, letters/digits/. -/^, 1–10 chars. Covers stocks,
  // ETFs, futures, and exchange-suffix tickers like BRK.B or ^GSPC.
  const submitAdd = () => {
    const raw = addValue.trim().toUpperCase();
    if (!/^[A-Z0-9.\-^]{1,10}$/.test(raw)) return;
    add(raw);
    setAddValue("");
  };
  const settingsQ = useQuery<Settings>({ queryKey: ["/api/settings"], staleTime: 60_000 });
  const tickerScaleCls = TICKER_SCALE_CLS[settingsQ.data?.vehicleTickerScale || "lg"] || TICKER_SCALE_CLS.lg;
  const bodyColor = settingsQ.data?.vehicleBodyColor || "#94a3b8";

  // Order: Core rows first (in Core order), then everything else in
  // insertion order. Core is editable now — no more DEFAULT_CHIPS pinning.
  const ordered = [
    ...coreChips.filter((c) => chips.includes(c)),
    ...chips.filter((c) => !coreChips.includes(c)),
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
        <>
          <div className="space-y-1.5">
            {ordered.map((t) => {
              const core = isCore(t);
              return (
                <TickerRow
                  key={t}
                  ticker={t}
                  active={t === active}
                  onClick={() => select(t)}
                  onRemove={core ? undefined : () => remove(t)}
                  onDemote={core ? () => demoteFromCore(t) : undefined}
                  onPromote={core ? undefined : () => promoteToCore(t)}
                  tickerScaleCls={tickerScaleCls}
                  bodyColor={bodyColor}
                  isCore={core}
                  showHoverCard={core}
                />
              );
            })}
          </div>

          {/* Add-ticker input. New tickers land in Watch; use the ↑ to
              promote into Core (capped at 3). Removing from Core with the
              ↓ leaves the ticker in Watch so nothing is lost. */}
          <form
            onSubmit={(e) => { e.preventDefault(); submitAdd(); }}
            className="flex items-center gap-1.5 pt-1"
            data-testid="pulse-add-form"
          >
            <input
              value={addValue}
              onChange={(e) => setAddValue(e.target.value.toUpperCase())}
              placeholder="Add ticker…"
              maxLength={10}
              spellCheck={false}
              autoCapitalize="characters"
              data-testid="pulse-add-input"
              className="flex-1 min-w-0 bg-ink-panel/40 border border-ink-line rounded px-2 py-1 text-[11px] font-mono text-soft-white placeholder:text-slate-gray/60 focus:outline-none focus:border-neon-blue"
            />
            <button
              type="submit"
              disabled={!/^[A-Z0-9.\-^]{1,10}$/.test(addValue.trim())}
              data-testid="pulse-add-submit"
              className="flex-shrink-0 border border-ink-line hover:border-neon-blue text-slate-gray hover:text-neon-blue rounded px-1.5 py-1 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Add to Market Pulse"
            >
              <Plus className="h-3 w-3" />
            </button>
          </form>
        </>
      )}
    </div>
  );
}
