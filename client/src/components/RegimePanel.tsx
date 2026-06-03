// ─────────────────────────────────────────────────────────────────────────────
// RegimePanel.tsx
// Compact 3-axis regime read-out: Trend (SPY vs SMA50/200) · Volatility (VIX)
// · Breadth (RSP-vs-SPY proxy %). Plus distribution days and a composite badge.
//
// Pulls from the existing /api/regime endpoint — no new backend wiring.
// ─────────────────────────────────────────────────────────────────────────────

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
function classifyTrend(i: RegimeInputsRow): { tone: Tone; label: string; detail: string } {
  if (!i.spyAbove200) return { tone: "red", label: "Bearish", detail: "SPY < SMA200" };
  if (i.spyAbove50 && i.spyAbove200 && i.spySma20Rising && i.spySma50Rising) {
    return { tone: "green", label: "Bullish", detail: "SPY > 20/50/200 · rising" };
  }
  if (i.spyAbove50 && i.spyAbove200) return { tone: "amber", label: "Neutral", detail: "SPY > 50/200, slopes mixed" };
  return { tone: "amber", label: "Neutral", detail: "SPY mixed vs SMA50/200" };
}

function classifyVol(i: RegimeInputsRow): { tone: Tone; label: string; detail: string } {
  const v = i.vixLevel;
  const slope = i.vixSlope5d;
  if (v > 25) return { tone: "red",   label: "Risk-Off",   detail: `VIX ${v.toFixed(1)} > 25` };
  if (v > 18) return { tone: "amber", label: "Caution",    detail: `VIX ${v.toFixed(1)} · slope ${slope >= 0 ? "+" : ""}${slope.toFixed(2)}` };
  return        { tone: "green", label: "Risk-On",   detail: `VIX ${v.toFixed(1)} < 18` };
}

function classifyBreadth(i: RegimeInputsRow): { tone: Tone; label: string; detail: string } {
  const b = i.breadthProxyPct;
  if (b < 40) return { tone: "red",   label: "Weak",      detail: `${b.toFixed(0)}% < 40` };
  if (b > 55) return { tone: "green", label: "Healthy",   detail: `${b.toFixed(0)}% > 55` };
  return        { tone: "amber", label: "Diverging", detail: `${b.toFixed(0)}% in 40-55` };
}

function classifyDistribution(d: number): { tone: Tone; label: string } {
  if (d >= 6) return { tone: "red",   label: `${d} DD` };
  if (d >= 4) return { tone: "amber", label: `${d} DD` };
  return        { tone: "green", label: `${d} DD` };
}

// ── Component ────────────────────────────────────────────────────────────────
export default function RegimePanel({ className = "" }: { className?: string }) {
  const { data, isLoading } = useQuery<RegimePayload>({
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

  if (isLoading || !inputs) {
    return (
      <div className={`border border-ink-line/80 bg-ink-deep/40 rounded-sm p-3 ${className}`}>
        <div className="text-[10px] uppercase tracking-wider text-slate-gray">Loading regime…</div>
      </div>
    );
  }

  const trend = classifyTrend(inputs);
  const vol = classifyVol(inputs);
  const breadth = classifyBreadth(inputs);
  const dd = classifyDistribution(inputs.distributionDays);

  return (
    <div className={`border border-ink-line/80 bg-ink-deep/40 rounded-sm p-3 ${className}`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-slate-gray">Regime</span>
          {pill(effectiveTone, compositeLabel, "badge-regime-composite")}
          {data?.effective?.source === "MANUAL" && (
            <span className="text-[9px] uppercase tracking-wider text-signal-amber">Manual</span>
          )}
        </div>
        <span className="text-[9px] uppercase tracking-wider text-slate-gray font-mono-num">
          {inputs.computedAt ? new Date(inputs.computedAt as any).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "—"}
        </span>
      </div>

      {/* Axis grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Axis title="Trend" tone={trend.tone} label={trend.label} detail={trend.detail} testId="regime-trend" />
        <Axis title="Volatility" tone={vol.tone} label={vol.label} detail={vol.detail} testId="regime-vol" />
        <Axis title="Breadth" tone={breadth.tone} label={breadth.label} detail={breadth.detail} testId="regime-breadth" />
        <Axis title="Distribution" tone={dd.tone} label={dd.label} detail={inputs.distributionDays >= 6 ? "Selling pressure" : "OK"} testId="regime-dd" />
      </div>
    </div>
  );
}

function Axis({ title, tone, label, detail, testId }: { title: string; tone: Tone; label: string; detail: string; testId?: string }) {
  return (
    <div className="flex flex-col gap-1 border border-ink-line/40 rounded-sm p-2" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] uppercase tracking-wider text-slate-gray">{title}</span>
        {pill(tone, label)}
      </div>
      <span className="text-[10px] text-soft-white/70 font-mono-num truncate" title={detail}>{detail}</span>
    </div>
  );
}
