import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Panel, Chip } from "@/components/Panel";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Trade, ChizzleScore, EquityHistory, JournalEntry } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { detectLeaks, fmtR } from "@/lib/engine";

function startOfWeek(d = new Date()): Date {
  const x = new Date(d);
  const day = x.getDay(); // Sun=0
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfWeek(d = new Date()): Date {
  const x = startOfWeek(d);
  x.setDate(x.getDate() + 6);
  x.setHours(23, 59, 59, 999);
  return x;
}
function startOfMonth(d = new Date()): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), 1);
  return x;
}
function endOfMonth(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

export default function Journal() {
  const [tab, setTab] = useState<"weekly" | "monthly" | "per-trade">("weekly");
  return (
    <div className="p-3 md:p-4 space-y-4">
      <div className="flex items-baseline gap-3 pb-1 border-b border-ink-line/60">
        <h1 className="font-display text-[15px] tracking-[0.2em] uppercase text-soft-white">Journal</h1>
        <span className="text-[10px] uppercase tracking-wider text-slate-gray">Weekly · Monthly · Per-Trade</span>
      </div>
      <div className="flex gap-1 border-b border-ink-line">
        {(["weekly", "monthly", "per-trade"] as const).map(t => (
          <button
            key={t}
            data-testid={`tab-${t}`}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-[11px] uppercase tracking-widest font-display border-b-2 ${tab === t ? "border-neon-blue text-neon-blue" : "border-transparent text-slate-gray hover:text-soft-white"}`}
          >
            {t === "per-trade" ? "Per-Trade Reflection" : `${t} Review`}
          </button>
        ))}
      </div>
      {tab === "weekly" ? <WeeklyReview /> : tab === "monthly" ? <MonthlyReview /> : <PerTradeReflection />}
    </div>
  );
}

// ─── Per-Trade Reflection ───────────────────────────────────────────
function PerTradeReflection() {
  const { data: trades } = useQuery<Trade[]>({ queryKey: ["/api/trades"] });
  const { toast } = useToast();
  const closed = (trades || []).filter(t => t.status === "CLOSED").slice(0, 20);
  if (closed.length === 0) {
    return <div className="text-[12px] text-slate-gray py-6">No closed trades to reflect on yet.</div>;
  }
  return (
    <div className="space-y-3">
      {closed.map(t => (
        <ReflectionCard key={t.id} trade={t} onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
          toast({ title: `Reflection saved for ${t.ticker}` });
        }} />
      ))}
    </div>
  );
}

const EMOTIONS = ["calm", "excited", "anxious", "fomo", "doubt"] as const;
function ReflectionCard({ trade, onSaved }: { trade: Trade; onSaved: () => void }) {
  const [emotion, setEmotion] = useState<string>((trade as any).emotionTag || "");
  const [confidence, setConfidence] = useState<number>((trade as any).confidenceRating ?? 5);
  const [reflection, setReflection] = useState<string>((trade as any).reflection || "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await apiRequest("PATCH", `/api/trades/${trade.id}/journal`, {
        emotionTag: emotion || null,
        confidenceRating: confidence,
        reflection,
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const r = trade.rMultiple ?? 0;
  const rTone = r > 0 ? "text-signal-green" : r < 0 ? "text-signal-red" : "text-slate-gray";
  return (
    <Panel title={`${trade.ticker} · ${trade.setup}`} hint={`R ${fmtR(r)}`}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-gray">Emotion at exit</div>
          <div className="flex flex-wrap gap-1">
            {EMOTIONS.map(e => (
              <button
                key={e}
                onClick={() => setEmotion(emotion === e ? "" : e)}
                data-testid={`button-emotion-${trade.id}-${e}`}
                className={`px-2 py-0.5 text-[10px] uppercase tracking-wider rounded-sm border ${
                  emotion === e
                    ? "bg-neon-blue/20 border-neon-blue/60 text-neon-blue"
                    : "border-ink-line text-slate-gray hover:text-soft-white"
                }`}
              >{e}</button>
            ))}
          </div>
          <div className="text-[10px] text-slate-gray">Pick the dominant feeling. Cap at one.</div>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] uppercase tracking-wider text-slate-gray">Confidence (1–10)</span>
            <span className="font-mono-num tabular-nums text-[14px]">{confidence}</span>
          </div>
          <input
            type="range" min={1} max={10} step={1}
            value={confidence}
            onChange={e => setConfidence(Number(e.target.value))}
            data-testid={`slider-confidence-${trade.id}`}
            className="w-full"
          />
        </div>
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-gray">Outcome</div>
          <div className={`font-mono-num text-[18px] tabular-nums ${rTone}`}>{fmtR(r)}</div>
          <div className="text-[10px] text-slate-gray">{trade.exitReason || "—"}</div>
        </div>
      </div>
      <div className="mt-3">
        <div className="text-[10px] uppercase tracking-wider text-slate-gray mb-1">Reflection — what would you change?</div>
        <textarea
          value={reflection}
          onChange={e => setReflection(e.target.value)}
          data-testid={`textarea-reflection-${trade.id}`}
          placeholder="What did you see? What did you miss? Would you take it again?"
          className="w-full h-24 bg-ink-deep/50 border border-ink-line rounded-sm px-3 py-2 text-[12px] text-soft-white leading-relaxed focus:border-neon-blue/60 focus:bg-ink-black focus:ring-1 focus:ring-neon-blue/30 outline-none transition-colors placeholder:text-slate-gray/50"
        />
      </div>
      <div className="flex justify-end mt-2">
        <button
          onClick={save}
          disabled={saving}
          data-testid={`button-save-reflection-${trade.id}`}
          className="px-3 py-1.5 border border-neon-blue/60 bg-neon-blue/20 text-neon-blue text-[11px] uppercase tracking-wider rounded-sm disabled:opacity-50"
        >{saving ? "Saving…" : "Save Reflection"}</button>
      </div>
    </Panel>
  );
}

// ─── Weekly Review ──────────────────────────────────────────────────────────
function WeeklyReview() {
  const { data: trades } = useQuery<Trade[]>({ queryKey: ["/api/trades"] });
  const { data: scores } = useQuery<ChizzleScore[]>({ queryKey: ["/api/chizzle-scores"] });
  const { data: journal } = useQuery<JournalEntry[]>({ queryKey: ["/api/journal"] });
  const { toast } = useToast();

  const start = startOfWeek();
  const end = endOfWeek();
  const weekTrades = (trades || []).filter(t => {
    const d = new Date(t.openedAt);
    return d >= start && d <= end;
  });

  const closed = weekTrades.filter(t => t.status === "CLOSED");
  const setupA = closed.filter(t => t.setup === "TREND_PULLBACK");
  const setupB = closed.filter(t => t.setup === "BREAKOUT");
  const avgR = (arr: Trade[]) => arr.length ? arr.reduce((s, x) => s + (x.rMultiple ?? 0), 0) / arr.length : 0;

  const leaks = detectLeaks({
    trades: (trades || []).map(t => ({
      openedAt: t.openedAt, closedAt: t.closedAt,
      setup: t.setup, regimeAtEntry: t.regimeAtEntry,
      rMultiple: t.rMultiple, entry: t.entry, stop: t.stop,
      status: t.status, ticker: t.ticker,
    })),
    periodStartISO: start.toISOString(),
    periodEndISO: end.toISOString(),
  });

  const weekScores = (scores || []).filter(s => {
    const d = new Date(s.date);
    return d >= start && d <= end;
  });
  const avgScore = weekScores.length ? Math.round(weekScores.reduce((s, x) => s + x.total, 0) / weekScores.length) : 0;
  let lowestComp = "—", lowestVal = 100;
  if (weekScores.length) {
    for (const s of weekScores) {
      const comps = JSON.parse(s.components || "{}");
      for (const [k, v] of Object.entries(comps) as [string, number][]) {
        if (v < lowestVal) { lowestVal = v; lowestComp = k; }
      }
    }
  }

  const existing = (journal || []).find(j => j.type === "weekly" && j.periodStart === start.toISOString().slice(0, 10));
  const [decisions, setDecisions] = useState(existing?.decisionsText || "");

  const save = async () => {
    await apiRequest("POST", "/api/journal", {
      type: "weekly",
      periodStart: start.toISOString().slice(0, 10),
      periodEnd: end.toISOString().slice(0, 10),
      decisionsText: decisions,
      processChangeText: "",
      leakFlags: JSON.stringify(leaks),
    });
    queryClient.invalidateQueries({ queryKey: ["/api/journal"] });
    toast({ title: "Weekly review saved" });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <Panel title="Trade Log — This Week" hint={`${weekTrades.length} trades`}>
        {weekTrades.length === 0 ? (
          <div className="text-[12px] text-slate-gray">No trades this week.</div>
        ) : (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-slate-gray">
                <th className="text-left">Ticker</th><th className="text-left">Setup</th>
                <th className="text-right">R</th><th className="text-left">Plan</th>
              </tr>
            </thead>
            <tbody>
              {weekTrades.map(t => (
                <tr key={t.id} className="border-t border-ink-line/60">
                  <td className="py-1.5 font-mono-num">{t.ticker}</td>
                  <td className="text-[10px] text-slate-gray uppercase">{t.setup === "BREAKOUT" ? "Breakout" : "Trend"}</td>
                  <td className={`text-right font-mono-num tabular-nums ${(t.rMultiple ?? 0) > 0 ? "text-signal-green" : (t.rMultiple ?? 0) < 0 ? "text-signal-red" : ""}`}>
                    {t.status === "CLOSED" ? fmtR(t.rMultiple ?? 0) : "—"}
                  </td>
                  <td>{t.planFollowed == null ? "—" : t.planFollowed ? <Chip tone="green">Y</Chip> : <Chip tone="red">N</Chip>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="Setup Scoreboard">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-gray">Trend-Pullback</div>
            <div className="font-mono-num text-[18px] tabular-nums">{setupA.length ? fmtR(avgR(setupA)) : "—"}</div>
            <div className="text-[10px] text-slate-gray">{setupA.length} trades</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-gray">Breakout</div>
            <div className="font-mono-num text-[18px] tabular-nums">{setupB.length ? fmtR(avgR(setupB)) : "—"}</div>
            <div className="text-[10px] text-slate-gray">{setupB.length} trades</div>
          </div>
        </div>
      </Panel>

      <Panel title="Chizzle Score — This Week">
        <div className="space-y-2">
          <div className="flex items-baseline gap-3">
            <div className={`font-mono-num text-[22px] tabular-nums leading-none ${avgScore === 0 ? "text-slate-gray/60" : avgScore >= 90 ? "text-gold-lux" : "text-soft-white"}`}>{avgScore || "—"}</div>
            <span className="text-[10px] uppercase tracking-wider text-slate-gray">7-day avg</span>
          </div>
          <div className="text-[11px] text-slate-gray">Lowest component: <span className="text-soft-white">{lowestComp}</span> {weekScores.length > 0 && <span className="font-mono-num tabular-nums">({lowestVal})</span>}</div>
        </div>
      </Panel>

      <Panel title="Leak Flags">
        {leaks.length === 0 ? (
          <div className="text-[12px] text-signal-green">Clean. No leaks detected this week.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {leaks.map(l => <Chip key={l} tone="red">{l.replace("_", " ")}</Chip>)}
          </div>
        )}
      </Panel>

      <Panel title="Three Decisions for Next Week" className="lg:col-span-2">
        <textarea
          value={decisions}
          onChange={e => setDecisions(e.target.value)}
          data-testid="textarea-decisions"
          placeholder={"1. ...\n2. ...\n3. ..."}
          className="w-full h-32 bg-ink-deep/50 border border-ink-line rounded-sm px-3 py-2 text-[13px] text-soft-white leading-relaxed focus:border-neon-blue/60 focus:bg-ink-black focus:ring-1 focus:ring-neon-blue/30 outline-none transition-colors placeholder:text-slate-gray/50"
        />
        <div className="flex justify-end mt-2">
          <button onClick={save} data-testid="button-save-weekly" className="px-3 py-1.5 border border-neon-blue/60 bg-neon-blue/20 text-neon-blue text-[11px] uppercase tracking-wider rounded-sm hover:bg-neon-blue/30">Save Review</button>
        </div>
      </Panel>
    </div>
  );
}

// ─── Monthly Review ─────────────────────────────────────────────────────────
function MonthlyReview() {
  const { data: trades } = useQuery<Trade[]>({ queryKey: ["/api/trades"] });
  const { data: equity } = useQuery<EquityHistory[]>({ queryKey: ["/api/equity-history"] });
  const { data: journal } = useQuery<JournalEntry[]>({ queryKey: ["/api/journal"] });
  const { toast } = useToast();

  const start = startOfMonth();
  const end = endOfMonth();
  const monthTrades = (trades || []).filter(t => {
    const d = new Date(t.openedAt);
    return d >= start && d <= end;
  });

  // ticker concentration
  const byTicker: Record<string, number> = {};
  for (const t of monthTrades) byTicker[t.ticker] = (byTicker[t.ticker] || 0) + 1;
  const concentration = Object.entries(byTicker).sort((a, b) => b[1] - a[1]);

  const existing = (journal || []).find(j => j.type === "monthly" && j.periodStart === start.toISOString().slice(0, 10));
  const [process, setProcess] = useState(existing?.processChangeText || "");

  const save = async () => {
    await apiRequest("POST", "/api/journal", {
      type: "monthly",
      periodStart: start.toISOString().slice(0, 10),
      periodEnd: end.toISOString().slice(0, 10),
      decisionsText: "",
      processChangeText: process,
      leakFlags: "[]",
    });
    queryClient.invalidateQueries({ queryKey: ["/api/journal"] });
    toast({ title: "Monthly review saved" });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <Panel title="Equity Snapshot">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-gray">Equity Now</div>
            <div className="font-mono-num text-[20px] tabular-nums">${equity?.[equity.length - 1]?.equity?.toFixed(2) ?? "—"}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-gray">Trades This Month</div>
            <div className="font-mono-num text-[20px] tabular-nums">{monthTrades.length}</div>
          </div>
        </div>
      </Panel>

      <Panel title="Ticker Concentration">
        {concentration.length === 0 ? (
          <div className="text-[12px] text-slate-gray">No trades this month.</div>
        ) : (
          <ul className="space-y-1">
            {concentration.map(([sym, n]) => (
              <li key={sym} className="flex justify-between text-[12px]">
                <span className="font-mono-num">{sym}</span>
                <span className="font-mono-num tabular-nums text-slate-gray">{n}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="One Process Change for Next Month" className="lg:col-span-2">
        <textarea
          value={process}
          onChange={e => setProcess(e.target.value)}
          data-testid="textarea-process"
          placeholder="Pick ONE thing to change. No more."
          className="w-full h-32 bg-ink-deep/50 border border-ink-line rounded-sm px-3 py-2 text-[13px] text-soft-white leading-relaxed focus:border-neon-blue/60 focus:bg-ink-black focus:ring-1 focus:ring-neon-blue/30 outline-none transition-colors placeholder:text-slate-gray/50"
        />
        <div className="flex justify-end mt-2">
          <button onClick={save} data-testid="button-save-monthly" className="px-3 py-1.5 border border-neon-blue/60 bg-neon-blue/20 text-neon-blue text-[11px] uppercase tracking-wider rounded-sm hover:bg-neon-blue/30">Save Review</button>
        </div>
      </Panel>
    </div>
  );
}
