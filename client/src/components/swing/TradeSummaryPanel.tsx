// Trade Summary — unified decision + AI coach merged into one detailed write-up.
// When a card prints READY, shows a "go to your broker" step (the app never
// places orders — there is deliberately no order button here).
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Check, ExternalLink } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { swingGet, type BarsResp } from "@/lib/swing";
import { coachRead } from "@/components/AITradeCoach";
import { buildTradeSummary, type TradeSummary } from "@shared/tradeSummary";
import type { SwingDecision } from "@shared/swingDecision";

export function useTradeSummary(d: SwingDecision | undefined): TradeSummary | null {
  const bars = useQuery<BarsResp>({
    queryKey: ["/api/swing/bars", d?.symbol ?? "", "D", "1Y", "0"],
    queryFn: () => swingGet<BarsResp>(`/api/swing/bars/${d!.symbol}?tf=D&range=1Y`),
    enabled: !!d, staleTime: 10 * 60_000, retry: false,
  });
  const regime = useQuery<any>({
    queryKey: ["/api/regime-v2"],
    queryFn: async () => (await apiRequest("GET", "/api/regime-v2")).json(),
    staleTime: 60_000,
  });
  return useMemo(() => {
    if (!d) return null;
    const b = bars.data?.bars?.filter((x) => x.closed !== false).map((x) => ({ date: String(x.t), open: x.o, high: x.h, low: x.l, close: x.c, volume: x.v }));
    const coach = b && b.length >= 50 ? coachRead(d.symbol, b, regime.data?.day_class || "UNKNOWN") : null;
    return buildTradeSummary(d, coach);
  }, [d, bars.data, regime.data]);
}

export function BrokerStep({ s, compact = false }: { s: TradeSummary; compact?: boolean }) {
  if (!s.brokerStep) return null;
  return (
    <div className="rounded border border-emerald-500/60 bg-emerald-500/10 p-2.5 space-y-1" data-testid={`broker-step-${s.symbol}`} role="status">
      <div className="text-[11px] font-mono font-bold uppercase tracking-wide text-emerald-300 flex items-center gap-1">
        <ExternalLink className="h-3 w-3" /> Card printed — go to your broker
      </div>
      <ul className="list-disc pl-4 text-[11.5px] text-soft-white/90 space-y-0.5">
        {(compact ? s.brokerStep.slice(0, 2) : s.brokerStep).map((x, i) => <li key={i}>{x}</li>)}
      </ul>
    </div>
  );
}

export default function TradeSummaryPanel({ d }: { d: SwingDecision | undefined }) {
  const s = useTradeSummary(d);
  const [copied, setCopied] = useState(false);
  if (!s) return <div className="text-xs text-slate-gray">Waiting for the decision…</div>;
  const copy = async () => {
    try { await navigator.clipboard.writeText(s.text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked in iframe */ }
  };
  return (
    <div className="space-y-2.5" data-testid={`trade-summary-${s.symbol}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-bold text-soft-white" data-testid="text-summary-headline">{s.headline}</div>
        <button onClick={copy} className="shrink-0 text-[10.5px] px-2 py-1 rounded border border-ink-line text-slate-gray hover:text-soft-white hover:border-neon-blue flex items-center gap-1" data-testid="button-copy-summary">
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {copied ? "Copied" : "Copy summary"}
        </button>
      </div>
      <BrokerStep s={s} />
      <div className="grid gap-2 md:grid-cols-2">
        {s.sections.map((sec) => (
          <div key={sec.title} className="rounded border border-ink-line bg-ink-deep px-2.5 py-2" data-testid={`summary-section-${sec.title.toLowerCase().replace(/[^a-z]+/g, "-").replace(/-+$/, "")}`}>
            <div className="text-[10px] font-mono uppercase tracking-wide text-slate-gray mb-1">{sec.title}</div>
            <ul className="space-y-0.5">
              {sec.lines.map((x, i) => <li key={i} className="text-[11.5px] text-soft-white/90 leading-snug">{x}</li>)}
            </ul>
          </div>
        ))}
      </div>
      <div className="space-y-0.5">
        {s.warnings.map((w) => <div key={w} className="text-[10.5px] font-mono text-rose-300">{w}</div>)}
      </div>
    </div>
  );
}
