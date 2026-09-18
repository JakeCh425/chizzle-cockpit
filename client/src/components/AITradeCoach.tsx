// AITradeCoach — deterministic templated coaching. No LLM calls.
//
// Reads: active ticker bars, regime v2 result, flex-scan verdict for the ticker.
// Outputs a plain-English playbook: setup call, size guidance, stop idea,
// invalidation, and a "if regime is X do Y" line.
//
// All logic here is rule-based. Change the rules → change the coach.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { GraduationCap } from "lucide-react";
import { rsi as rsiSeries } from "@/lib/rsi";

interface OHLCBar { date: string; open: number; high: number; low: number; close: number; volume: number }

interface Props {
  ticker: string;
  bars: OHLCBar[] | undefined;
}

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  let s = 0;
  for (let i = values.length - period; i < values.length; i++) s += values[i];
  return s / period;
}

export default function AITradeCoach({ ticker, bars }: Props) {
  const { data: regime } = useQuery<any>({
    queryKey: ["/api/regime-v2"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/regime-v2");
      return await res.json();
    },
    staleTime: 60_000,
  });

  const coach = useMemo(() => {
    if (!bars || bars.length < 50) {
      return {
        headline: "Warming up",
        body: `Need at least 50 bars of history for ${ticker} to build a plan.`,
        bullets: [],
        alignment: "neutral" as const,
      };
    }
    const closes = bars.map((b) => b.close);
    const last = closes[closes.length - 1];
    const s20 = sma(closes, 20);
    const s50 = sma(closes, 50);
    const s200 = sma(closes.length >= 200 ? closes : closes, Math.min(200, closes.length));
    const rsiArr = rsiSeries(closes, 14);
    const rsi = rsiArr[rsiArr.length - 1];
    const vols = bars.slice(-20).map((b) => b.volume || 0);
    const avgVol = vols.reduce((a, b) => a + b, 0) / vols.length;
    const lastVol = bars[bars.length - 1].volume || 0;
    const relVol = avgVol > 0 ? lastVol / avgVol : 1;

    const distFrom20 = s20 ? ((last - s20) / s20) * 100 : 0;
    const distFrom50 = s50 ? ((last - s50) / s50) * 100 : 0;
    const distFrom200 = s200 ? ((last - s200) / s200) * 100 : 0;

    const dayClass = regime?.day_class || "UNKNOWN";
    const bullish = last > (s20 || 0) && last > (s50 || 0) && (s50 || 0) > (s200 || 0);
    const bearish = last < (s20 || 0) && last < (s50 || 0) && (s50 || 0) < (s200 || 0);

    let headline = "";
    let alignment: "bull" | "bear" | "neutral" = "neutral";
    const bullets: string[] = [];

    if (bullish && dayClass === "GREEN") {
      headline = `${ticker} — Constructive uptrend in a GREEN regime`;
      alignment = "bull";
      bullets.push(`Price ${distFrom20.toFixed(1)}% above SMA20 and ${distFrom50.toFixed(1)}% above SMA50 — trend intact.`);
      bullets.push(`Use SMA20 (~$${s20!.toFixed(2)}) as the trailing stop reference; below SMA50 (~$${s50!.toFixed(2)}) is a full exit.`);
      if (relVol > 1.3) bullets.push(`Volume ${relVol.toFixed(1)}× 20-day avg — participation confirming the move.`);
      bullets.push(`Full pilot size acceptable. Consider scaling in on any pullback to SMA20.`);
    } else if (bullish && dayClass === "YELLOW") {
      headline = `${ticker} — Trend intact but regime is mixed`;
      alignment = "bull";
      bullets.push(`Cut position size by ~50% vs a GREEN day. Trend is fine, but tape is not confirming.`);
      bullets.push(`Stop under SMA50 (~$${s50!.toFixed(2)}); no adds until breadth improves.`);
    } else if (bullish && dayClass === "RED") {
      headline = `${ticker} — Fighting the tape`;
      alignment = "neutral";
      bullets.push(`Stock is strong but regime is RED. Skip new longs. Trim existing runners into any strength.`);
      bullets.push(`If already held: raise stop to SMA20 (~$${s20?.toFixed(2)}), no fresh capital.`);
    } else if (bearish) {
      headline = `${ticker} — Broken trend, avoid`;
      alignment = "bear";
      bullets.push(`Below SMA20/50/200 — no long setup here regardless of regime.`);
      bullets.push(`Wait for reclaim of SMA50 (~$${s50?.toFixed(2)}) with volume before revisiting.`);
    } else {
      headline = `${ticker} — Mixed / consolidation`;
      alignment = "neutral";
      bullets.push(`Price hovering around key MAs — no clean entry. Wait for either a breakout above SMA20 or a full flush.`);
      if (rsi != null && rsi >= 70) bullets.push(`RSI ${rsi.toFixed(0)} — overbought, expect a pullback before continuation.`);
      if (rsi != null && rsi <= 30) bullets.push(`RSI ${rsi.toFixed(0)} — oversold, watch for a reversal bar with volume.`);
    }

    // Regime footer.
    if (dayClass === "GREEN") bullets.push(`Regime GREEN: breakouts have edge, size up on quality names.`);
    else if (dayClass === "YELLOW") bullets.push(`Regime YELLOW: 50% size, no fresh breakouts without confirmation.`);
    else if (dayClass === "RED") bullets.push(`Regime RED: defense. No new longs, tighten stops.`);

    return { headline, body: "", bullets, alignment };
  }, [bars, ticker, regime]);

  const alignColor =
    coach.alignment === "bull" ? "text-signal-green border-signal-green/40 bg-signal-green/5" :
    coach.alignment === "bear" ? "text-signal-red border-signal-red/40 bg-signal-red/5" :
    "text-slate-gray border-ink-line bg-ink-deep/40";

  return (
    <div className="rounded-md border border-ink-line bg-ink-black" data-testid="panel-ai-coach">
      <div className="px-3 py-1.5 border-b border-ink-line flex items-center gap-1.5">
        <GraduationCap className="w-3 h-3 text-neon-blue" />
        <span className="text-[11px] font-mono uppercase tracking-wider text-soft-white">AI Trade Coach</span>
        <span className="text-[9px] text-slate-gray ml-auto italic">Deterministic · rule-based</span>
      </div>
      <div className="p-3 space-y-2">
        <div className={`rounded border px-2 py-1.5 text-[11px] font-semibold ${alignColor}`}>
          {coach.headline}
        </div>
        {coach.body && <div className="text-[11px] text-slate-gray">{coach.body}</div>}
        {coach.bullets.length > 0 && (
          <ul className="space-y-1">
            {coach.bullets.map((b, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[11px] text-soft-white leading-snug">
                <span className="mt-1 w-1 h-1 rounded-full bg-neon-blue flex-shrink-0" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
