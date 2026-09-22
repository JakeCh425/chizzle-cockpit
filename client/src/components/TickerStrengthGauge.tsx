// TickerStrengthGauge — Semicircle 0–100 needle summarizing ticker strength.
//
// Score is a weighted composite of:
//   • Price vs SMA20 / SMA50 / SMA200 (from flex-scan metrics)
//   • SMA50 slope (from flex-scan metrics)
//   • RSI 14 (computed from bars via @/lib/rsi)
//   • Relative volume (from flex-scan metrics)
//   • Regime alignment (from /api/regime-v2 day_class)
//
// Missing metrics drop out of both the weighted sum and the total weight, so a
// partial dataset still yields a normalized 0–100 score. "Not available" surfaces
// when zero components are present.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { rsi } from "@/lib/rsi";
import { AlertTriangle } from "lucide-react";

interface OHLCBar { date: string; open: number; high: number; low: number; close: number; volume: number }

interface Props {
  ticker: string;
  bars: OHLCBar[] | undefined;
  /** Active chart timeframe (e.g. "1H"). Purely a label — the score already
   *  recalculates because `bars` swaps when the timeframe changes. */
  timeframe?: string;
}

interface Zone {
  min: number;
  max: number;
  label: string;
  color: string;         // stroke color for the arc segment
  textColor: string;     // tailwind class for label text
  action: string;
  direction: "Bearish" | "Neutral" | "Bullish";
  bias: "No Trade" | "Watch" | "Long";
}

const ZONES: Zone[] = [
  { min: 0,  max: 29, label: "Weak / Avoid",  color: "rgb(239 68 68)",  textColor: "text-signal-red",    action: "No trade — trend is against you. Stand aside or hedge.",           direction: "Bearish", bias: "No Trade" },
  { min: 30, max: 44, label: "Caution",       color: "rgb(251 146 60)", textColor: "text-orange-400",    action: "Watch only — not enough alignment for a real entry.",              direction: "Bearish", bias: "No Trade" },
  { min: 45, max: 59, label: "Neutral",       color: "rgb(250 204 21)", textColor: "text-signal-amber",  action: "Wait for a confirming break or wait for the setup to clarify.",     direction: "Neutral", bias: "Watch" },
  { min: 60, max: 74, label: "Constructive",  color: "rgb(74 222 128)", textColor: "text-signal-green",  action: "Watchlist — plan an entry on the next FLEX-scanner trigger.",       direction: "Bullish", bias: "Watch" },
  { min: 75, max: 100,label: "Strong",        color: "rgb(34 197 94)",  textColor: "text-signal-green",  action: "Trade candidate — size normally when the setup fires and regime is aligned.", direction: "Bullish", bias: "Long" },
];

function zoneFor(score: number): Zone {
  return ZONES.find((z) => score >= z.min && score <= z.max) ?? ZONES[2];
}

// Map a value on [inMin, inMax] linearly to a 0–100 score, clamped.
function mapToScore(v: number, inMin: number, inMax: number): number {
  if (!Number.isFinite(v)) return NaN;
  const t = (v - inMin) / (inMax - inMin);
  return Math.max(0, Math.min(100, t * 100));
}

// Score dist-from-SMA%. Bullish above; bearish below. ±10% saturates.
function scoreDistFromSma(pct: number | null | undefined): number {
  if (pct == null || !Number.isFinite(pct)) return NaN;
  return mapToScore(pct, -10, 10);
}

// Score SMA50 slope %. Bullish positive; bearish negative. ±5% saturates.
function scoreSmaSlope(pct: number | null | undefined): number {
  if (pct == null || !Number.isFinite(pct)) return NaN;
  return mapToScore(pct, -5, 5);
}

// Score RSI 14. 30 → 0, 50 → 50, 70 → 100. Clamp outside 30–70.
function scoreRsi(v: number | null | undefined): number {
  if (v == null || !Number.isFinite(v)) return NaN;
  return mapToScore(v, 30, 70);
}

// Score relative volume. 1.0 = 50, 2.0 = 100, 0.5 = 0. Clamp.
function scoreRelVol(v: number | null | undefined): number {
  if (v == null || !Number.isFinite(v)) return NaN;
  return mapToScore(v, 0.5, 2.0);
}

// Score regime day_class.
function scoreRegime(dayClass: string | undefined): number {
  if (!dayClass) return NaN;
  if (dayClass === "GREEN") return 80;
  if (dayClass === "YELLOW") return 50;
  if (dayClass === "RED") return 15;
  return NaN;
}

export default function TickerStrengthGauge({ ticker, bars, timeframe }: Props) {
  // Flex-scan metrics (already used by TechnicalSnapshot — reuse queryKey so
  // React Query dedupes the network call).
  const { data: flex, isLoading: flexLoading } = useQuery<any>({
    queryKey: ["/api/flex-scan", ticker],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/flex-scan", { universe: [ticker], include_tech_concentrated: true });
      return await res.json();
    },
    staleTime: 60_000,
  });

  const { data: regime } = useQuery<any>({
    queryKey: ["/api/regime-v2"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/regime-v2");
      return await res.json();
    },
    staleTime: 60_000,
  });

  const row = flex?.results?.find?.((r: any) => r.ticker === ticker) || flex?.results?.[0];
  const m = row?.metrics || {};

  const rsiVal = useMemo(() => {
    if (!bars || bars.length < 20) return null;
    const closes = bars.map((b) => b.close);
    const series = rsi(closes, 14);
    for (let i = series.length - 1; i >= 0; i--) {
      const v = series[i];
      if (v != null && Number.isFinite(v)) return v as number;
    }
    return null;
  }, [bars]);

  // Weighted composite. Missing metrics drop out of both numerator and denominator.
  const components: { key: string; weight: number; score: number; label: string }[] = [
    { key: "sma20",   weight: 1.2, score: scoreDistFromSma(m.dist_from_sma20_pct),  label: "Price vs SMA20" },
    { key: "sma50",   weight: 1.5, score: scoreDistFromSma(m.dist_from_sma50_pct),  label: "Price vs SMA50" },
    { key: "sma200",  weight: 1.5, score: scoreDistFromSma(m.dist_from_sma200_pct), label: "Price vs SMA200" },
    { key: "slope",   weight: 1.0, score: scoreSmaSlope(m.sma50_slope_pct),         label: "SMA50 slope" },
    { key: "rsi",     weight: 1.0, score: scoreRsi(rsiVal),                          label: "RSI 14" },
    { key: "relvol",  weight: 0.8, score: scoreRelVol(m.relative_volume),            label: "Relative volume" },
    { key: "regime",  weight: 1.0, score: scoreRegime(regime?.day_class),            label: "Market regime" },
  ];

  let num = 0;
  let den = 0;
  const missing: string[] = [];
  for (const c of components) {
    if (Number.isFinite(c.score)) {
      num += c.score * c.weight;
      den += c.weight;
    } else {
      missing.push(c.label);
    }
  }

  const isReady = !flexLoading && den > 0;
  const score = isReady ? Math.round(num / den) : NaN;
  const zone = isReady ? zoneFor(score) : null;

  // ── Gauge geometry: semicircle from 180° → 360° (top-left to top-right). ──
  const W = 200;
  const H = 120;
  const cx = W / 2;
  const cy = H - 10;
  const R = 82;

  // Polar → cartesian.
  const polar = (deg: number, r: number) => {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + Math.cos(rad) * r, y: cy + Math.sin(rad) * r };
  };

  // Map score 0–100 → 180° → 360° (i.e. 180° sweep along the top).
  const scoreToAngle = (s: number) => 180 + (s / 100) * 180;

  // Arc path helper.
  const arcPath = (startDeg: number, endDeg: number, r: number) => {
    const s = polar(startDeg, r);
    const e = polar(endDeg, r);
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
  };

  return (
    <div className="rounded-md border border-ink-line bg-ink-black p-4 space-y-3" data-testid="panel-ticker-strength">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-bold uppercase tracking-wider text-soft-white">Entry Readiness</h3>
          <span className="text-[10px] font-mono text-slate-gray">{ticker}</span>
          {timeframe && (
            <span className="text-[9px] font-mono uppercase tracking-wider px-1 py-0.5 rounded bg-neon-blue/10 text-neon-blue border border-neon-blue/30">{timeframe}</span>
          )}
        </div>
        <span className="text-[9px] uppercase tracking-wider text-slate-gray/70">0–100</span>
      </div>

      {!isReady ? (
        <div className="flex items-center gap-2 text-[11px] text-slate-gray py-6 justify-center">
          <AlertTriangle className="w-3.5 h-3.5" />
          {flexLoading ? "Computing strength…" : "Not available — no metrics loaded."}
        </div>
      ) : (
        <>
          {/* Gauge */}
          <div className="flex items-center justify-center">
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="max-w-[240px]" data-testid="strength-gauge-svg">
              {/* Zone arcs */}
              {ZONES.map((z) => {
                const a1 = scoreToAngle(z.min);
                const a2 = scoreToAngle(Math.min(100, z.max + 1));
                return (
                  <path
                    key={z.label}
                    d={arcPath(a1, a2, R)}
                    stroke={z.color}
                    strokeWidth={10}
                    fill="none"
                    opacity={zone && zone.label === z.label ? 1 : 0.35}
                  />
                );
              })}
              {/* Zone tick labels */}
              {[0, 25, 50, 75, 100].map((v) => {
                const p = polar(scoreToAngle(v), R + 12);
                return (
                  <text
                    key={v}
                    x={p.x}
                    y={p.y}
                    fontSize={8}
                    fontFamily="ui-monospace, monospace"
                    fill="rgb(148 163 184 / 0.7)"
                    textAnchor="middle"
                    dominantBaseline="middle"
                  >
                    {v}
                  </text>
                );
              })}
              {/* Needle */}
              {(() => {
                const tip = polar(scoreToAngle(score), R - 6);
                return (
                  <g>
                    <line x1={cx} y1={cy} x2={tip.x} y2={tip.y} stroke="rgb(226 232 240)" strokeWidth={2} strokeLinecap="round" />
                    <circle cx={cx} cy={cy} r={4} fill="rgb(226 232 240)" />
                  </g>
                );
              })()}
              {/* Score readout */}
              <text x={cx} y={cy - 30} fontSize={22} fontFamily="ui-monospace, monospace" fontWeight={700} fill={zone?.color} textAnchor="middle">
                {score}
              </text>
            </svg>
          </div>

          {/* Zone label + direction/bias/action */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className={`text-[12px] font-mono uppercase tracking-wider ${zone?.textColor}`} data-testid="strength-zone-label">
                {zone?.label}
              </span>
              <div className="flex items-center gap-1">
                <span className="text-[9px] font-mono uppercase text-slate-gray px-1.5 py-0.5 border border-ink-line rounded">
                  {zone?.direction}
                </span>
                <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${
                  zone?.bias === "Long" ? "text-signal-green border-signal-green/40 bg-signal-green/10"
                  : zone?.bias === "Watch" ? "text-signal-amber border-signal-amber/40 bg-signal-amber/10"
                  : "text-signal-red border-signal-red/40 bg-signal-red/10"
                }`}>
                  {zone?.bias}
                </span>
              </div>
            </div>
            <p className="text-[11px] text-slate-gray leading-snug" data-testid="strength-action-text">
              {zone?.action}
            </p>
            {missing.length > 0 && (
              <p className="text-[9px] uppercase tracking-wider text-slate-gray/60">
                Not available: {missing.join(" · ")}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
