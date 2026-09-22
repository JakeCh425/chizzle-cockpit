// ─── RegimeV2Panel ─────────────────────────────────────────────────────────
// Displays the Chizzle regime engine v2 output (VIX + breadth + distribution).
// Compact strip: overall band, three sub-bands, and per-symbol breadth chips.
// Renders "Unknown" instead of hiding when data is missing (spec rule).

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TermTooltip } from "@/components/TermTooltip";
import { ShieldAlert, ShieldCheck, ShieldHalf, HelpCircle, ChevronDown, ChevronRight } from "lucide-react";

type Band = "GREEN" | "YELLOW" | "RED" | "UNKNOWN";
type VixLevel = "calm" | "normal" | "caution" | "high" | "stress" | "unknown";
type VixTrend = "falling" | "stable" | "rising" | "rising_fast" | "unknown";
type VixRiskEffect = "supportive" | "monitor" | "reduce_risk" | "defensive" | "unknown";

interface RegimeV2Snapshot {
  day_class: Band;
  reason: string;
  vix: {
    last: number | null;
    band: Band;
    // Phase 4 display fields — all optional. Never color the VIX tile from
    // `band`; use `level` + `trend5d` so the volatility tile can be amber
    // while the parent regime is green, and vice versa.
    change?: number | null;
    changePct?: number | null;
    prevClose?: number | null;
    trend5d?: VixTrend;
    level?: VixLevel;
    riskEffect?: VixRiskEffect;
    avg20d?: number | null;
    ts?: string | null;
  };
  breadth: { pct_above_20sma: number | null; universe_size: number; band: Band };
  distribution: { days_last_25: number | null; band: Band };
  detail: Array<{ ticker: string; last: number; sma20: number; above: boolean }>;
  computed_at: string;
}

// Volatility Climate palette. Green/amber/red are semantic here — supportive
// vs monitor vs defensive — and are chosen from level+trend, NOT from the
// regime combine band. Neutral gray is the "insufficient/ambiguous" state.
// PR-hotfix (user request 2026-09-22): make the falling/rising signal obvious
// at a glance. Doubled the fill tint and thickened the border on colored
// tones so "falling VIX + market up" reads as a solid green block and
// "rising VIX" as a solid red block.
const VIX_STYLES: Record<"green" | "amber" | "red" | "neutral", { text: string; border: string; bg: string }> = {
  green:   { text: "text-signal-green", border: "border-2 border-signal-green", bg: "bg-signal-green/20" },
  amber:   { text: "text-signal-amber", border: "border border-signal-amber",   bg: "bg-signal-amber/15" },
  red:     { text: "text-signal-red",   border: "border-2 border-signal-red",   bg: "bg-signal-red/20" },
  neutral: { text: "text-slate-gray",   border: "border border-ink-line",       bg: "bg-ink-line/40" },
};

// Tile color reflects the DIRECTION of VIX, not the risk climate. Falling
// VIX → volatility contracting → green. Rising VIX → volatility expanding
// → red. Stable → amber. Level (CALM/NORMAL/…) and Risk effect stay as
// separate chips so nuance is preserved.
function vixTileTone(_level: VixLevel | undefined, trend: VixTrend | undefined): keyof typeof VIX_STYLES {
  if (!trend || trend === "unknown") return "neutral";
  if (trend === "falling") return "green";
  if (trend === "stable") return "amber";
  // rising or rising_fast → volatility expanding
  return "red";
}

function levelLabel(l: VixLevel | undefined): string {
  switch (l) {
    case "calm": return "CALM";
    case "normal": return "NORMAL";
    case "caution": return "CAUTION";
    case "high": return "HIGH";
    case "stress": return "STRESS";
    default: return "—";
  }
}
function trendLabel(t: VixTrend | undefined): string {
  switch (t) {
    case "falling": return "FALLING";
    case "stable": return "STABLE";
    case "rising": return "RISING";
    case "rising_fast": return "RISING FAST";
    default: return "—";
  }
}
function trendArrow(t: VixTrend | undefined): string {
  switch (t) {
    case "falling": return "↓";
    case "rising": return "↑";
    case "rising_fast": return "↑↑";
    case "stable": return "→";
    default: return "–";
  }
}
function riskEffectLabel(r: VixRiskEffect | undefined): string {
  switch (r) {
    case "supportive": return "Supportive";
    case "monitor": return "Monitor";
    case "reduce_risk": return "Reduce risk";
    case "defensive": return "Defensive";
    default: return "—";
  }
}

const BAND_STYLES: Record<Band, { bg: string; text: string; border: string }> = {
  GREEN: { bg: "bg-signal-green/10", text: "text-signal-green", border: "border-signal-green" },
  YELLOW: { bg: "bg-signal-amber/10", text: "text-signal-amber", border: "border-signal-amber" },
  RED: { bg: "bg-signal-red/10", text: "text-signal-red", border: "border-signal-red" },
  UNKNOWN: { bg: "bg-ink-line", text: "text-slate-gray", border: "border-ink-line" },
};

function fmt(v: number | null, dp = 2): string {
  return v == null || !Number.isFinite(v) ? "Unknown" : v.toFixed(dp);
}

interface RegimeV2PanelProps {
  /**
   * When true renders the compact "Market Regime Command Card" used in the
   * 3-column Cockpit workspace: prominent state, one-line reason, playbook,
   * 2×2 metric grid, alignment chips, and a "Show Details" toggle that
   * reveals the full detail table. Defaults to false (full legacy render).
   */
  compact?: boolean;
}

export default function RegimeV2Panel({ compact = false }: RegimeV2PanelProps = {}) {
  const q = useQuery<RegimeV2Snapshot>({
    queryKey: ["/api/regime-v2"],
    refetchInterval: 60_000,
  });
  const [showDetails, setShowDetails] = useState(false);

  const snap = q.data;
  if (q.isLoading || !snap) {
    return (
      <div className="rounded-md border border-ink-line bg-ink-black p-3">
        <div className="text-xs text-slate-gray">Loading regime...</div>
      </div>
    );
  }

  const style = BAND_STYLES[snap.day_class];
  const playbook: { icon: JSX.Element; text: string } = (() => {
    if (snap.day_class === "GREEN") return { icon: <ShieldCheck className="h-3.5 w-3.5" />, text: "Today's playbook: trend-follow the strongest STANDARD READY setup. Full size. Trail with the 20-SMA." };
    if (snap.day_class === "YELLOW") return { icon: <ShieldHalf className="h-3.5 w-3.5" />, text: "Today's playbook: half size only, highest-quality setup, tighter stop. Skip anything extended above the 20-SMA." };
    if (snap.day_class === "RED") return { icon: <ShieldAlert className="h-3.5 w-3.5" />, text: "Today's playbook: capital protection. No new long risk. Manage or exit existing positions." };
    return { icon: <HelpCircle className="h-3.5 w-3.5" />, text: "Today's playbook: regime unknown — wait for data to refresh before adding risk." };
  })();

  // ── COMPACT MODE ─────────────────────────────────────────────────────────
  // Identical data — rearranged into a tighter card for the left column.
  if (compact) {
    return (
      <div className={`rounded-md border ${style.border} ${style.bg} p-3 space-y-2`} data-testid="section-regime-v2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className={style.text}>{playbook.icon}</span>
            <span className={`text-[15px] font-bold tracking-wide ${style.text}`}>
              {snap.day_class === "UNKNOWN" ? "UNKNOWN" : `REGIME ${snap.day_class}`}
            </span>
          </div>
          <span className="text-[10px] text-slate-gray font-mono flex-shrink-0">
            {new Date(snap.computed_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
          </span>
        </div>
        <div className="text-[11.5px] text-soft-white leading-snug">{snap.reason}</div>
        <div className={`rounded border ${style.border} bg-ink-black/40 px-2 py-1.5 text-[11px] text-soft-white leading-snug`}>
          {playbook.text}
        </div>

        {/* Volatility Climate strip — spans full width. Colored by VIX
            level+trend, NOT by the parent regime band. Phase 4 spec. */}
        {(() => {
          const tone = vixTileTone(snap.vix.level, snap.vix.trend5d);
          const s = VIX_STYLES[tone];
          const chg = snap.vix.change;
          const chgPct = snap.vix.changePct;
          const chgSign = chg != null && chg > 0 ? "+" : "";
          const chgText = chg != null && chgPct != null
            ? `${chgSign}${chg.toFixed(2)} (${chgSign}${chgPct.toFixed(2)}%)`
            : "—";
          return (
            <div
              className={`rounded ${s.border} ${s.bg} px-2 py-1.5 text-xs`}
              data-testid="section-volatility-climate"
              title={snap.vix.ts ? `VIX close from ${snap.vix.ts}` : undefined}
            >
              <div className="flex items-center justify-between">
                <div className="text-slate-gray text-[9px] uppercase tracking-wider">
                  Volatility Climate
                </div>
                <div className={`text-[9px] font-mono ${s.text}`}>
                  {trendArrow(snap.vix.trend5d)} {trendLabel(snap.vix.trend5d)}
                </div>
              </div>
              <div className="mt-0.5 flex items-baseline gap-2">
                <span className={`font-mono font-bold text-[15px] tabular-nums ${s.text}`}>
                  VIX {fmt(snap.vix.last, 2)}
                </span>
                <span className="font-mono text-[10px] text-soft-white/70 tabular-nums">
                  {chgText}
                </span>
              </div>
              <div className="mt-0.5 flex items-center justify-between text-[10px]">
                <span className={`font-mono ${s.text}`}>{levelLabel(snap.vix.level)}</span>
                <span className="text-slate-gray">
                  Risk effect: <span className={s.text}>{riskEffectLabel(snap.vix.riskEffect)}</span>
                </span>
              </div>
              {snap.vix.avg20d != null && (
                <div className="mt-0.5 text-[9px] text-slate-gray">
                  20-day avg: <span className="font-mono text-soft-white/80">{snap.vix.avg20d.toFixed(2)}</span>
                </div>
              )}
            </div>
          );
        })()}

        {/* Breadth / Distribution / Trend-align grid. Each tile is colored
            by its own band (Breadth by breadth, Distribution by dist). The
            trend-align tile intentionally uses NEUTRAL styling instead of
            the parent regime style, so the card no longer looks uniformly
            green when the regime is green (Phase 5 spec). */}
        <div className="grid grid-cols-3 gap-1.5 text-xs">
          <div className={`rounded border ${BAND_STYLES[snap.breadth.band].border} bg-ink-deep px-2 py-1.5`}>
            <div className="text-slate-gray text-[9px] uppercase tracking-wider">Breadth</div>
            <div className={`font-mono font-bold text-[13px] ${BAND_STYLES[snap.breadth.band].text}`}>
              {fmt(snap.breadth.pct_above_20sma, 0)}%
            </div>
          </div>
          <div className={`rounded border ${BAND_STYLES[snap.distribution.band].border} bg-ink-deep px-2 py-1.5`}>
            <div className="text-slate-gray text-[9px] uppercase tracking-wider">Distribution</div>
            <div className={`font-mono font-bold text-[13px] ${BAND_STYLES[snap.distribution.band].text}`}>
              {snap.distribution.days_last_25 ?? "—"}
            </div>
          </div>
          <div className="rounded border border-ink-line bg-ink-deep px-2 py-1.5">
            <div className="text-slate-gray text-[9px] uppercase tracking-wider">Trend align</div>
            <div className="font-mono font-bold text-[13px] text-soft-white">
              {snap.detail.length > 0
                ? `${snap.detail.filter((d) => d.above).length}/${snap.detail.length}`
                : "—"}
            </div>
          </div>
        </div>

        {/* Alignment chips */}
        {snap.detail.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {snap.detail.map((d) => (
              <span
                key={d.ticker}
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                  d.above ? "border-signal-green/50 text-signal-green bg-signal-green/5" : "border-signal-red/50 text-signal-red bg-signal-red/5"
                }`}
                title={`${d.ticker} $${d.last.toFixed(2)} vs 20-SMA $${d.sma20.toFixed(2)}`}
              >
                {d.ticker} {d.above ? "↑" : "↓"}
              </span>
            ))}
          </div>
        )}

        {/* Show Details toggle */}
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          className="w-full flex items-center justify-center gap-1 text-[10px] text-slate-gray hover:text-neon-blue py-1 border-t border-ink-line pt-2"
          data-testid="button-regime-details"
        >
          {showDetails ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {showDetails ? "Hide details" : "Show details"}
        </button>

        {showDetails && (
          <div className="space-y-1 pt-1 border-t border-ink-line/60">
            <div className="text-[9px] uppercase tracking-wider text-slate-gray">VIX band (regime input)</div>
            <div className="text-[10.5px] text-soft-white">
              {snap.vix.band === "GREEN" ? "Below 22 — regime GREEN input" : snap.vix.band === "YELLOW" ? "22–26 — regime YELLOW input" : snap.vix.band === "RED" ? "Above 26 — regime RED input" : "Unknown"}
            </div>
            <div className="text-[9px] uppercase tracking-wider text-slate-gray mt-1">Volatility level (display)</div>
            <div className="text-[10.5px] text-soft-white">
              {levelLabel(snap.vix.level)} · {trendLabel(snap.vix.trend5d)}
              {snap.vix.changePct != null ? ` · ${snap.vix.changePct >= 0 ? "+" : ""}${snap.vix.changePct.toFixed(2)}% today` : ""}
            </div>
            <div className="text-[9px] uppercase tracking-wider text-slate-gray mt-1">Breadth</div>
            <div className="text-[10.5px] text-soft-white">
              {snap.breadth.pct_above_20sma == null ? "Unknown" : `${snap.breadth.pct_above_20sma.toFixed(0)}% of ${snap.breadth.universe_size} symbols above their 20-SMA.`}
            </div>
            <div className="text-[9px] uppercase tracking-wider text-slate-gray mt-1">Distribution</div>
            <div className="text-[10.5px] text-soft-white">
              {snap.distribution.days_last_25 == null ? "Unknown" : `${snap.distribution.days_last_25} distribution days in the last 25 SPY sessions.`}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`rounded-md border ${style.border} ${style.bg} p-3 space-y-2`} data-testid="section-regime-v2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-bold ${style.text}`}>REGIME: {snap.day_class}</span>
        </div>
        <span className="text-[10px] text-slate-gray">
          {new Date(snap.computed_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
        </span>
      </div>
      <div className="text-xs text-soft-white leading-snug">
        <span className="text-[10px] uppercase tracking-wider text-slate-gray mr-1.5">What this means —</span>
        {snap.reason}
      </div>
      <div className={`flex items-start gap-2 rounded border ${style.border} bg-ink-black/40 px-2 py-1.5`}>
        <span className={`${style.text} mt-0.5`}>{playbook.icon}</span>
        <div className="text-[11px] text-soft-white leading-snug">{playbook.text}</div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        {(() => {
          const tone = vixTileTone(snap.vix.level, snap.vix.trend5d);
          const s = VIX_STYLES[tone];
          return (
            <div className={`rounded border ${s.border} ${s.bg} p-2`} data-testid="section-volatility-climate-legacy">
              <div className="text-slate-gray text-[10px] uppercase">
                <TermTooltip term="VIX">Volatility</TermTooltip>
              </div>
              <div className={`font-mono font-bold ${s.text}`}>{fmt(snap.vix.last, 2)}</div>
              <div className={`text-[10px] mt-0.5 ${s.text}`}>
                {levelLabel(snap.vix.level)} · {trendArrow(snap.vix.trend5d)} {trendLabel(snap.vix.trend5d)}
              </div>
              <div className="text-[10px] text-slate-gray mt-0.5">
                Risk: {riskEffectLabel(snap.vix.riskEffect)}
              </div>
            </div>
          );
        })()}
        <div className={`rounded border ${BAND_STYLES[snap.breadth.band].border} bg-ink-deep p-2`}>
          <div className="text-slate-gray text-[10px] uppercase">
            <TermTooltip term="Breadth">Breadth</TermTooltip>
          </div>
          <div className={`font-mono font-bold ${BAND_STYLES[snap.breadth.band].text}`}>
            {fmt(snap.breadth.pct_above_20sma, 0)}%
          </div>
          <div className="text-[10px] text-slate-gray mt-0.5">
            {snap.breadth.universe_size} symbols
          </div>
        </div>
        <div className={`rounded border ${BAND_STYLES[snap.distribution.band].border} bg-ink-deep p-2`}>
          <div className="text-slate-gray text-[10px] uppercase">
            <TermTooltip term="Distribution">Distribution</TermTooltip>
          </div>
          <div className={`font-mono font-bold ${BAND_STYLES[snap.distribution.band].text}`}>
            {snap.distribution.days_last_25 ?? "Unknown"}
          </div>
          <div className="text-[10px] text-slate-gray mt-0.5">last 25 SPY days</div>
        </div>
      </div>

      {snap.detail.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {snap.detail.map((d) => (
            <span
              key={d.ticker}
              className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                d.above ? "border-signal-green text-signal-green" : "border-signal-red text-signal-red"
              }`}
              title={`${d.ticker} $${d.last.toFixed(2)} vs 20-SMA $${d.sma20.toFixed(2)}`}
            >
              {d.ticker} {d.above ? "↑" : "↓"}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
