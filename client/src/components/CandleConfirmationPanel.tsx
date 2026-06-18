// ─── Candlestick Confirmation Panel ─────────────────────────────────────────
// Renders the watchlist as a clean table powered by /api/candle-confirmation.
// Spec output fields: ticker, timeframe, price, daily_sma20,
// distance_from_sma20_percent, pattern_status, trigger_price,
// invalidation_price, entry_mode, notes.
//
// Controls: conservative/aggressive toggle, SMA band slider (1.0%–3.0%),
// timeframe toggle (Daily / 4H).

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { X } from "lucide-react";

// Persist Candle Confirmation toggles across refreshes.
const LS_CC_TF = "chizzle-cc-timeframe";
const LS_CC_MODE = "chizzle-cc-mode";
const LS_CC_BAND = "chizzle-cc-band";
const LS_CC_HIDE = "chizzle-cc-hide-notrigger";
const LS_CC_OFFBAND = "chizzle-cc-offband";
function readTf(): "daily" | "4h" {
  try { return localStorage.getItem(LS_CC_TF) === "4h" ? "4h" : "daily"; } catch { return "daily"; }
}
function readMode(): "conservative" | "aggressive" {
  try { return localStorage.getItem(LS_CC_MODE) === "aggressive" ? "aggressive" : "conservative"; }
  catch { return "conservative"; }
}
function readBand(): number {
  try {
    const v = Number(localStorage.getItem(LS_CC_BAND));
    return Number.isFinite(v) && v >= 1.0 && v <= 4.0 ? v : 2.0;
  } catch { return 2.0; }
}
function readHide(): boolean {
  try { return localStorage.getItem(LS_CC_HIDE) === "1"; } catch { return false; }
}
function readOffBand(): boolean {
  // Default ON — user requested off-band as the default behavior on the
  // live ticker watch surface. Falsy stored value ("0") respects user opt-out.
  try {
    const v = localStorage.getItem(LS_CC_OFFBAND);
    return v === null ? true : v === "1";
  } catch { return true; }
}

export type PatternStatus =
  | "No Valid Trigger Yet"
  | "Hammer Forming"
  | "Engulfing Forming"
  | "Confirmed Hammer"
  | "Confirmed Bullish Engulfing"
  | "Ready to Trade"
  | "Hammer (Off-Band)"
  | "Engulfing (Off-Band)";

export interface CandleConfirmationRow {
  ticker: string;
  timeframe: "daily" | "4h";
  price: number;
  daily_sma20: number | null;
  distance_from_sma20_percent: number | null;
  pattern_status: PatternStatus;
  trigger_price: number | null;
  invalidation_price: number | null;
  entry_mode: "aggressive" | "conservative";
  notes: string;
  near_sma20: boolean;
  short_term_decline: boolean;
  candle_closed: boolean;
  pattern_detected_on: "Hammer" | "Engulfing" | null;
}

// Status pill styling — matches the project's neon-on-ink palette.
// Off-band variants use amber + dashed border so they read as "awareness only".
const statusClass: Record<PatternStatus, string> = {
  "Ready to Trade":              "border-signal-green/70 bg-signal-green/15 text-signal-green",
  "Confirmed Hammer":            "border-signal-green/50 bg-signal-green/10 text-signal-green",
  "Confirmed Bullish Engulfing": "border-signal-green/50 bg-signal-green/10 text-signal-green",
  "Hammer Forming":              "border-signal-amber/60 bg-signal-amber/10 text-signal-amber",
  "Engulfing Forming":           "border-signal-amber/60 bg-signal-amber/10 text-signal-amber",
  "Hammer (Off-Band)":           "border-dashed border-signal-amber/60 bg-signal-amber/5 text-signal-amber",
  "Engulfing (Off-Band)":        "border-dashed border-signal-amber/60 bg-signal-amber/5 text-signal-amber",
  "No Valid Trigger Yet":        "border-ink-line/50 bg-ink-deep/20 text-slate-gray",
};

// Severity for sort order (lower = higher priority).
// Off-band sits below in-band confirmed but above forming — reflects that the
// pattern IS confirmed, just not at the textbook location.
const sevOrder: Record<PatternStatus, number> = {
  "Ready to Trade":              0,
  "Confirmed Hammer":            1,
  "Confirmed Bullish Engulfing": 1,
  "Hammer Forming":              2,
  "Engulfing Forming":           2,
  "Hammer (Off-Band)":           3,
  "Engulfing (Off-Band)":        3,
  "No Valid Trigger Yet":        9,
};

function fmt(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

export default function CandleConfirmationPanel() {
  const [timeframe, setTimeframe] = useState<"daily" | "4h">(readTf);
  const [mode, setMode] = useState<"conservative" | "aggressive">(readMode);
  const [band, setBand] = useState<number>(readBand);
  const [hideNoTrigger, setHideNoTrigger] = useState<boolean>(readHide);
  const [allowOffBand, setAllowOffBand] = useState<boolean>(readOffBand);

  useEffect(() => { try { localStorage.setItem(LS_CC_TF, timeframe); } catch {} }, [timeframe]);
  useEffect(() => { try { localStorage.setItem(LS_CC_MODE, mode); } catch {} }, [mode]);
  useEffect(() => { try { localStorage.setItem(LS_CC_BAND, String(band)); } catch {} }, [band]);
  useEffect(() => { try { localStorage.setItem(LS_CC_HIDE, hideNoTrigger ? "1" : "0"); } catch {} }, [hideNoTrigger]);
  useEffect(() => { try { localStorage.setItem(LS_CC_OFFBAND, allowOffBand ? "1" : "0"); } catch {} }, [allowOffBand]);

  const { data, isLoading, isFetching, refetch } = useQuery<CandleConfirmationRow[]>({
    queryKey: ["/api/candle-confirmation", timeframe, mode, band, allowOffBand],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/candle-confirmation?timeframe=${timeframe}&mode=${mode}&band=${band}&offband=${allowOffBand}`
      );
      return res.json();
    },
    refetchInterval: 45_000,
    staleTime: 30_000,
  });

  const rows = (data ?? [])
    .slice()
    .sort((a, b) => (sevOrder[a.pattern_status] - sevOrder[b.pattern_status]));
  const visible = hideNoTrigger
    ? rows.filter(r => r.pattern_status !== "No Valid Trigger Yet")
    : rows;

  // ─── Controls strip ──────────────────────────────────────────────────────
  const TabBtn = <T extends string>({ value, current, set, label }: { value: T; current: T; set: (v: T) => void; label: string }) => {
    const active = value === current;
    return (
      <button
        type="button"
        onClick={() => set(value)}
        className={`px-2 py-0.5 text-[9px] font-mono-num uppercase tracking-wider transition-colors ${
          active ? "bg-neon-blue/15 text-neon-blue" : "text-slate-gray hover:bg-ink-line/40 hover:text-soft-white"
        }`}
        data-testid={`button-cc-${value}`}
      >{label}</button>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 text-[11px]">
        <div className="flex items-center gap-2">
          <span className="text-slate-gray uppercase tracking-wider text-[9px]">Timeframe</span>
          <div className="flex items-center gap-px border border-ink-line/80 rounded-sm overflow-hidden">
            <TabBtn value="daily" current={timeframe} set={setTimeframe} label="Daily" />
            <TabBtn value="4h" current={timeframe} set={setTimeframe} label="4H" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-slate-gray uppercase tracking-wider text-[9px]">Mode</span>
          <div className="flex items-center gap-px border border-ink-line/80 rounded-sm overflow-hidden">
            <TabBtn value="conservative" current={mode} set={setMode} label="Conservative" />
            <TabBtn value="aggressive" current={mode} set={setMode} label="Aggressive" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-slate-gray uppercase tracking-wider text-[9px]">SMA20 Band</span>
          <input
            type="range" min={1.0} max={4.0} step={0.1}
            value={band}
            onChange={e => setBand(Number(e.target.value))}
            className="accent-neon-blue w-32"
            aria-label="SMA20 band percent"
            data-testid="input-cc-band"
          />
          <span className="font-mono-num tabular-nums text-soft-white w-12">±{band.toFixed(1)}%</span>
        </div>
        <label className="flex items-center gap-1 cursor-pointer" title="When ON, a confirmed hammer/engulfing fires even if price isn't in the SMA20 band. Tagged Off-Band, never auto-upgrades to Ready-to-Trade.">
          <input
            type="checkbox"
            checked={allowOffBand}
            onChange={e => setAllowOffBand(e.target.checked)}
            className="accent-neon-blue"
            data-testid="checkbox-cc-offband"
          />
          <span className="text-slate-gray uppercase tracking-wider text-[9px]">Allow off-band</span>
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={hideNoTrigger}
            onChange={e => setHideNoTrigger(e.target.checked)}
            className="accent-neon-blue"
            data-testid="checkbox-cc-hide-empty"
          />
          <span className="text-slate-gray uppercase tracking-wider text-[9px]">Hide no-trigger</span>
        </label>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="ml-auto px-2 py-0.5 text-[9px] font-mono-num uppercase tracking-wider border border-ink-line rounded-sm text-slate-gray hover:text-soft-white hover:bg-ink-line/40 disabled:opacity-40"
          data-testid="button-cc-refresh"
        >{isFetching ? "Scanning…" : "Refresh"}</button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        {isLoading ? (
          <div className="text-[12px] text-slate-gray py-4 text-center">Evaluating watchlist…</div>
        ) : visible.length === 0 ? (
          <div className="text-[12px] text-slate-gray py-4 text-center">
            {hideNoTrigger
              ? "No active triggers right now."
              : "No data."}
          </div>
        ) : (
          <table className="w-full text-[11px] font-mono-num tabular-nums">
            <thead>
              <tr className="text-slate-gray uppercase tracking-wider text-[9px] border-b border-ink-line/60">
                <th className="text-left  py-1 pr-2">Ticker</th>
                <th className="text-right py-1 pr-2">Price</th>
                <th className="text-right py-1 pr-2">SMA20</th>
                <th className="text-right py-1 pr-2">Δ SMA20</th>
                <th className="text-left  py-1 pr-2">Status</th>
                <th className="text-right py-1 pr-2">Trigger</th>
                <th className="text-right py-1 pr-2">Stop</th>
                <th className="text-left  py-1 pr-2">Notes</th>
                <th className="text-center py-1 pr-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(r => {
                const distSigned = r.daily_sma20 != null
                  ? ((r.price - r.daily_sma20) / r.daily_sma20) * 100
                  : null;
                const distColor =
                  distSigned == null ? "text-slate-gray"
                    : Math.abs(distSigned) <= band ? "text-signal-green"
                      : distSigned < 0 ? "text-signal-amber" : "text-signal-red";
                return (
                  <tr key={r.ticker} className="border-b border-ink-line/30 hover:bg-ink-line/20" data-testid={`row-cc-${r.ticker}`}>
                    <td className="text-left py-1 pr-2 font-semibold uppercase text-soft-white">{r.ticker}</td>
                    <td className="text-right py-1 pr-2 text-soft-white">${fmt(r.price)}</td>
                    <td className="text-right py-1 pr-2 text-slate-gray">${fmt(r.daily_sma20)}</td>
                    <td className={`text-right py-1 pr-2 ${distColor}`}>
                      {distSigned == null ? "—" : `${distSigned >= 0 ? "+" : ""}${distSigned.toFixed(2)}%`}
                    </td>
                    <td className="text-left py-1 pr-2">
                      <span
                        className={`inline-block px-1.5 py-0.5 text-[9px] uppercase tracking-wider border rounded-sm whitespace-nowrap ${statusClass[r.pattern_status]}`}
                        title={r.pattern_status}
                      >{r.pattern_status}</span>
                    </td>
                    <td className="text-right py-1 pr-2 text-soft-white">{r.trigger_price != null ? `$${fmt(r.trigger_price)}` : "—"}</td>
                    <td className="text-right py-1 pr-2 text-soft-white">{r.invalidation_price != null ? `$${fmt(r.invalidation_price)}` : "—"}</td>
                    <td className="text-left py-1 pr-2 text-slate-gray max-w-[420px] truncate" title={r.notes}>{r.notes}</td>
                    <td className="text-center py-1 pr-2">
                      <ArchiveButton ticker={r.ticker} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Legend */}
      <div className="text-[9px] text-slate-gray uppercase tracking-wider border-t border-ink-line/40 pt-2">
        <span className="mr-3">Entry: above trigger</span>
        <span className="mr-3">Stop: below invalidation</span>
        <span className="mr-3">Band: ±{band.toFixed(1)}% around daily SMA20</span>
        <span>{mode === "conservative" ? "Conservative: requires next-candle break above trigger" : "Aggressive: ready on confirmed close near SMA20"}</span>
      </div>
    </div>
  );
}

// ─── Archive button ────────────────────────────────────────────────────────────────
// Resolves the symbol → watchlist id, then PATCHes archived=true. After success,
// invalidates the candle-confirmation and watchlist caches so the row disappears
// from this panel and the watchlist editor immediately.
function ArchiveButton({ ticker }: { ticker: string }) {
  // Watchlist rows reference tickers by id, so we resolve symbol via /api/tickers.
  const { data: watchlist } = useQuery<Array<{ id: number; tickerId: number }>>({
    queryKey: ["/api/watchlist"],
    queryFn: () => apiRequest("GET", "/api/watchlist").then((r) => r.json()),
  });
  const { data: tickers } = useQuery<Array<{ id: number; symbol: string }>>({
    queryKey: ["/api/tickers"],
    queryFn: () => apiRequest("GET", "/api/tickers").then((r) => r.json()),
  });

  const archive = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("PATCH", `/api/watchlist/${id}`, { archived: true });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/candle-confirmation"] });
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist/archived"] });
    },
  });

  const tickerRow = tickers?.find((t) => t.symbol.toUpperCase() === ticker.toUpperCase());
  const row = tickerRow ? watchlist?.find((w) => w.tickerId === tickerRow.id) : undefined;
  const disabled = !row || archive.isPending;

  return (
    <button
      onClick={() => row && archive.mutate(row.id)}
      disabled={disabled}
      title={row ? `Archive ${ticker} from watchlist (use Watchlist Editor to restore)` : "Not in watchlist"}
      className="inline-flex items-center justify-center w-5 h-5 rounded text-slate-gray hover:text-signal-red hover:bg-signal-red/10 transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
      data-testid={`button-archive-cc-${ticker}`}
    >
      <X className="w-3.5 h-3.5" />
    </button>
  );
}
