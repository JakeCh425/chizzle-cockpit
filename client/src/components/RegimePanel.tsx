// ─────────────────────────────────────────────────────────────────────────────
// RegimePanel.tsx
// Compact 3-axis regime read-out: Trend (SPY vs SMA50/200) · Volatility (VIX)
// · Breadth (RSP-vs-SPY proxy %). Plus distribution days and a composite badge.
//
// Pulls from the existing /api/regime endpoint — no new backend wiring.
// ─────────────────────────────────────────────────────────────────────────────

import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { RegimeState, RegimeInputsRow } from "@shared/schema";

interface RegimePayload {
  state: RegimeState;
  latestInputs: RegimeInputsRow | null;
  effective: { code: "green" | "yellow" | "red"; source: "AUTO" | "MANUAL" };
}

type Tone = "green" | "amber" | "red" | "slate";

const TONE_CLASS: Record<Tone, string> = {
  green: "bg-signal-green/15 text-signal-green border-signal-green/40",
  amber: "bg-signal-amber/15 text-signal-amber border-signal-amber/40",
  red:   "bg-signal-red/15 text-signal-red border-signal-red/40",
  slate: "bg-slate-gray/15 text-slate-gray border-slate-gray/40",
};

function pill(tone: Tone, label: string, testId?: string) {
  return (
    <span
      className={`inline-block px-1.5 py-0.5 text-[10px] font-mono-num uppercase tracking-wider border rounded-sm ${TONE_CLASS[tone]}`}
      data-testid={testId}
    >{label}</span>
  );
}

// ── Axis classifiers ─────────────────────────────────────────────────────────
interface AxisRead { tone: Tone; label: string; detail: string; tooltip: string }

function classifyTrend(i: RegimeInputsRow): AxisRead {
  if (!i.spyAbove200) {
    return { tone: "red", label: "Bearish", detail: "SPY < SMA200",
      tooltip: "Primary trend is down: SPY is trading below its 200-day SMA. Reduce risk and favor defensive setups." };
  }
  if (i.spyAbove50 && i.spyAbove200 && i.spySma20Rising && i.spySma50Rising) {
    return { tone: "green", label: "Bullish", detail: "SPY > 20/50/200 · rising",
      tooltip: "All trend layers aligned up: SPY above SMA20/50/200 and both SMA20 and SMA50 are rising. Full risk green-light." };
  }
  if (i.spyAbove50 && i.spyAbove200) {
    return { tone: "amber", label: "Neutral", detail: "SPY > 50/200, slopes mixed",
      tooltip: "SPY holds above both SMA50 and SMA200 but short-term slopes are mixed. Stay selective; avoid full size." };
  }
  return { tone: "amber", label: "Neutral", detail: "SPY mixed vs SMA50/200",
    tooltip: "SPY is above SMA200 but below SMA50 — choppy regime. Trade smaller and demand cleaner setups." };
}

function classifyVol(i: RegimeInputsRow): AxisRead {
  const v = i.vixLevel;
  const slope = i.vixSlope5d;
  const slopeStr = `${slope >= 0 ? "+" : ""}${slope.toFixed(2)}`;
  if (v > 25) return { tone: "red", label: "Risk-Off", detail: `VIX ${v.toFixed(1)} > 25`,
    tooltip: `VIX at ${v.toFixed(1)} signals elevated fear. 5-day slope ${slopeStr}. Cut size; widen stops only on conviction trades.` };
  if (v > 18) return { tone: "amber", label: "Caution", detail: `VIX ${v.toFixed(1)} · slope ${slopeStr}`,
    tooltip: `VIX at ${v.toFixed(1)} is in the caution band (18-25). Slope ${slopeStr}. Tighten risk per trade.` };
  return { tone: "green", label: "Risk-On", detail: `VIX ${v.toFixed(1)} < 18`,
    tooltip: `VIX at ${v.toFixed(1)} is calm. 5-day slope ${slopeStr}. Risk-on environment; normal sizing.` };
}

function classifyBreadth(i: RegimeInputsRow): AxisRead {
  const b = i.breadthProxyPct;
  if (b < 40) return { tone: "red", label: "Weak", detail: `${b.toFixed(0)}% < 40`,
    tooltip: `Breadth proxy at ${b.toFixed(0)}% — narrow participation. Rally is fragile; avoid breakouts.` };
  if (b > 55) return { tone: "green", label: "Healthy", detail: `${b.toFixed(0)}% > 55`,
    tooltip: `Breadth proxy at ${b.toFixed(0)}% — broad participation across stocks. Healthy backdrop for risk-on setups.` };
  return { tone: "amber", label: "Diverging", detail: `${b.toFixed(0)}% in 40-55`,
    tooltip: `Breadth at ${b.toFixed(0)}% is in the diverging band (40-55%). Mega-caps may be hiding weaker internals — verify each setup.` };
}

function classifyDistribution(d: number): { tone: Tone; label: string; tooltip: string } {
  if (d >= 6) return { tone: "red", label: `${d} DD`,
    tooltip: `${d} distribution days in last 25 sessions — institutions are selling. Major-index pressure; reduce exposure.` };
  if (d >= 4) return { tone: "amber", label: `${d} DD`,
    tooltip: `${d} distribution days — building selling pressure. Watch for break of key support.` };
  return { tone: "green", label: `${d} DD`,
    tooltip: `${d} distribution days — accumulation phase or healthy pause. No institutional dumping detected.` };
}

// ── Component ────────────────────────────────────────────────────────────────
export default function RegimePanel({ className = "" }: { className?: string }) {
  const { data, isLoading, isError } = useQuery<RegimePayload>({
    queryKey: ["/api/regime"],
    refetchInterval: 5 * 60 * 1000,
    refetchIntervalInBackground: false,
  });

  const inputs = data?.latestInputs;
  const effective = data?.effective?.code ?? "yellow";
  const effectiveTone: Tone = effective === "green" ? "green" : effective === "red" ? "red" : "amber";
  const compositeLabel =
    effective === "green" ? "Risk-On" :
    effective === "red"   ? "Risk-Off" : "Caution";

  if (isLoading) {
    return (
      <div className={`border border-ink-line/80 bg-ink-deep/40 rounded-sm p-3 ${className}`} role="status" aria-live="polite">
        <div className="text-[10px] uppercase tracking-wider text-slate-gray">Loading regime…</div>
      </div>
    );
  }
  if (isError || !inputs) {
    return (
      <div className={`border border-ink-line/80 bg-ink-deep/40 rounded-sm p-3 ${className}`} role="status">
        <div className="text-[10px] uppercase tracking-wider text-slate-gray">Regime unavailable — retrying…</div>
      </div>
    );
  }

  const trend = classifyTrend(inputs);
  const vol = classifyVol(inputs);
  const breadth = classifyBreadth(inputs);
  const dd = classifyDistribution(inputs.distributionDays);
  const compositeTooltip =
    effective === "green" ? "Composite regime: Risk-On. Trend, volatility, and breadth all support full risk. Trade your normal size." :
    effective === "red"   ? "Composite regime: Risk-Off. One or more axes are red. Reduce exposure and demand A-tier setups only." :
                            "Composite regime: Caution. Mixed signals across trend, volatility, breadth, or distribution. Trade smaller and stay selective.";

  return (
    <div className={`border border-ink-line/80 bg-ink-deep/40 rounded-sm p-3 ${className}`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-slate-gray">Regime</span>
          <span title={compositeTooltip}>{pill(effectiveTone, compositeLabel, "badge-regime-composite")}</span>
          {data?.effective?.source === "MANUAL" && (
            <span
              className="text-[9px] uppercase tracking-wider text-signal-amber"
              title="Manual override active — regime is set by the user, not auto-computed."
            >Manual</span>
          )}
        </div>
        <span className="text-[9px] uppercase tracking-wider text-slate-gray font-mono-num" title="Last computed (local time)">
          {inputs.computedAt ? new Date(String(inputs.computedAt)).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "—"}
        </span>
      </div>

      {/* Axis grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Axis title="Trend" tone={trend.tone} label={trend.label} detail={trend.detail} tooltip={trend.tooltip} testId="regime-trend" />
        <Axis title="Volatility" tone={vol.tone} label={vol.label} detail={vol.detail} tooltip={vol.tooltip} testId="regime-vol" />
        <Axis title="Breadth" tone={breadth.tone} label={breadth.label} detail={breadth.detail} tooltip={breadth.tooltip} testId="regime-breadth" />
        <Axis title="Distribution" tone={dd.tone} label={dd.label} detail={inputs.distributionDays >= 6 ? "Selling pressure" : "OK"} tooltip={dd.tooltip} testId="regime-dd" />
      </div>
    </div>
  );
}

interface AxisProps { title: string; tone: Tone; label: string; detail: string; tooltip: string; testId?: string }

const Axis = memo(function Axis({ title, tone, label, detail, tooltip, testId }: AxisProps) {
  return (
    <div
      className="flex flex-col gap-1 border border-ink-line/40 hover:border-ink-line/70 rounded-sm p-2 transition-colors"
      data-testid={testId}
      title={tooltip}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] uppercase tracking-wider text-slate-gray">{title}</span>
        {pill(tone, label)}
      </div>
      <span className="text-[10px] text-soft-white/70 font-mono-num truncate">{detail}</span>
    </div>
  );
});
