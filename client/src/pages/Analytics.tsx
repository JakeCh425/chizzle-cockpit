import { useQuery } from "@tanstack/react-query";
import { Panel, Chip } from "@/components/Panel";
import type { Trade, EquityHistory } from "@shared/schema";
import { expectancy, drawdown, fmtR } from "@/lib/engine";
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, ResponsiveContainer, Tooltip, ReferenceLine,
} from "recharts";

export default function Analytics() {
  const { data: trades } = useQuery<Trade[]>({ queryKey: ["/api/trades"] });
  const { data: equity } = useQuery<EquityHistory[]>({ queryKey: ["/api/equity-history"] });

  const closed = (trades || []).filter(t => t.status === "CLOSED");
  const exp = expectancy(closed);
  const dd = drawdown(equity || []);
  const last20 = closed.slice(0, 20).map((t, i) => ({ i, r: t.rMultiple ?? 0 })).reverse();
  const eqData = (equity || []).map(e => ({ date: e.date, equity: e.equity, dd: e.drawdownPct }));

  // Per ticker breakdown
  const byTicker: Record<string, { count: number; totalR: number; wins: number }> = {};
  for (const t of closed) {
    if (!byTicker[t.ticker]) byTicker[t.ticker] = { count: 0, totalR: 0, wins: 0 };
    byTicker[t.ticker].count++;
    byTicker[t.ticker].totalR += t.rMultiple ?? 0;
    if ((t.rMultiple ?? 0) > 0) byTicker[t.ticker].wins++;
  }
  const tickerData = Object.entries(byTicker).map(([sym, v]) => ({ sym, totalR: v.totalR, count: v.count }));

  // Per setup (now with win rate + avg R)
  const setups = ["TREND_PULLBACK", "BREAKOUT"] as const;
  const setupData = setups.map(s => {
    const arr = closed.filter(t => t.setup === s);
    const expe = expectancy(arr);
    const totalR = arr.reduce((acc, t) => acc + (t.rMultiple ?? 0), 0);
    const avgR = arr.length ? totalR / arr.length : 0;
    return {
      setup: s === "BREAKOUT" ? "Breakout" : "Trend",
      expectancy: expe.value,
      winRate: expe.winRate * 100,
      avgR,
      n: arr.length,
    };
  });

  // Avg R across all closed trades
  const totalRAll = closed.reduce((s, t) => s + (t.rMultiple ?? 0), 0);
  const avgRAll = closed.length ? totalRAll / closed.length : 0;

  // Per quality grade (A / B / C / unknown)
  const qualities = ["A", "B", "C"] as const;
  const qualityData = qualities.map(q => {
    const arr = closed.filter(t => (t.qualityAtEntry || "") === q);
    const expe = expectancy(arr);
    const totalR = arr.reduce((acc, t) => acc + (t.rMultiple ?? 0), 0);
    const avgR = arr.length ? totalR / arr.length : 0;
    return { grade: q, n: arr.length, winRate: expe.winRate * 100, avgR, totalR };
  });

  // Per regime
  const regimes = ["GREEN", "YELLOW", "RED"] as const;
  const regimeData = regimes.map(r => {
    const arr = closed.filter(t => t.regimeAtEntry === r);
    const totalR = arr.reduce((s, t) => s + (t.rMultiple ?? 0), 0);
    return { regime: r, totalR, n: arr.length };
  });

  // Hold buckets
  const buckets = [
    { label: "1–3d", min: 1, max: 3 },
    { label: "4–7d", min: 4, max: 7 },
    { label: "8–15d", min: 8, max: 15 },
  ];
  const bucketData = buckets.map(b => {
    const arr = closed.filter(t => {
      if (!t.closedAt) return false;
      const days = Math.floor((new Date(t.closedAt).getTime() - new Date(t.openedAt).getTime()) / 86400000);
      return days >= b.min && days <= b.max;
    });
    const expe = expectancy(arr);
    return { bucket: b.label, expectancy: expe.value, n: arr.length };
  });

  // Health flags
  const flags: { label: string; tone: "red" | "amber" | "green" }[] = [];
  if (exp.n >= 10 && exp.value < 0.1) flags.push({ label: "Expectancy Decay", tone: "red" });
  for (const s of setupData) {
    if (s.n >= 10 && s.expectancy < 0) flags.push({ label: `Setup Drift · ${s.setup}`, tone: "red" });
  }

  return (
    <div className="p-3 md:p-4 space-y-4">
      <div className="flex items-baseline gap-3 pb-1 border-b border-ink-line/60">
        <h1 className="font-display text-[15px] tracking-[0.2em] uppercase text-soft-white">Analytics</h1>
        <span className="text-[10px] uppercase tracking-wider text-slate-gray">{exp.n} closed trades</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KPI label="Closed Trades" value={exp.n.toString()} />
        <KPI label="Win Rate" value={exp.n === 0 ? "—" : `${(exp.winRate * 100).toFixed(1)}%`} tone={exp.n === 0 ? "empty" : exp.winRate >= 0.5 ? "green" : exp.winRate >= 0.35 ? "neutral" : "red"} />
        <KPI label="Avg R" value={exp.n === 0 ? "—" : fmtR(avgRAll)} tone={exp.n === 0 ? "empty" : avgRAll >= 0.35 ? "green" : avgRAll >= 0 ? "neutral" : "red"} />
        <KPI label="Expectancy" value={exp.n === 0 ? "—" : fmtR(exp.value)} tone={exp.n === 0 ? "empty" : exp.value >= 0.35 ? "green" : exp.value >= 0 ? "neutral" : "red"} />
        <KPI label="Max Drawdown" value={!equity || equity.length === 0 ? "—" : `${dd.max.toFixed(2)}%`} tone={!equity || equity.length === 0 ? "empty" : dd.max <= -15 ? "red" : "neutral"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Equity Curve · Drawdown">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={eqData} margin={{ top: 4, right: 12, left: -4, bottom: 0 }}>
                <CartesianGrid stroke="hsl(var(--ink-line))" vertical={false} />
                <XAxis dataKey="date" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: "hsl(var(--ink-panel))", border: "1px solid hsl(var(--ink-line))", fontSize: 11 }} />
                <Area type="monotone" dataKey="equity" stroke="hsl(var(--neon-blue))" fill="hsl(var(--neon-blue) / 0.15)" strokeWidth={1.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Expectancy — 20-Trade Rolling">
          {last20.length === 0 ? (
            <div className="text-[12px] text-slate-gray py-8 text-center">No closed trades yet.</div>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={last20}>
                  <CartesianGrid stroke="hsl(var(--ink-line))" vertical={false} />
                  <XAxis dataKey="i" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis fontSize={10} tickLine={false} axisLine={false} />
                  <ReferenceLine y={0.35} stroke="hsl(var(--signal-green))" strokeDasharray="2 2" />
                  <ReferenceLine y={0} stroke="hsl(var(--ink-line))" />
                  <Bar dataKey="r" fill="hsl(var(--neon-blue))" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Panel title="Per Ticker P/L (R)">
          {tickerData.length === 0 ? <Empty /> : (
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={tickerData}>
                  <CartesianGrid stroke="hsl(var(--ink-line))" vertical={false} />
                  <XAxis dataKey="sym" fontSize={10} />
                  <YAxis fontSize={10} />
                  <Bar dataKey="totalR" fill="hsl(var(--neon-blue))" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
        <Panel title="Per Setup Expectancy (R)">
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={setupData}>
                <CartesianGrid stroke="hsl(var(--ink-line))" vertical={false} />
                <XAxis dataKey="setup" fontSize={10} />
                <YAxis fontSize={10} />
                <ReferenceLine y={0.35} stroke="hsl(var(--signal-green))" strokeDasharray="2 2" />
                <Bar dataKey="expectancy" fill="hsl(var(--neon-blue))" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Per Hold-Bucket Expectancy">
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bucketData}>
                <CartesianGrid stroke="hsl(var(--ink-line))" vertical={false} />
                <XAxis dataKey="bucket" fontSize={10} />
                <YAxis fontSize={10} />
                <Bar dataKey="expectancy" fill="hsl(var(--gold-lux))" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <Panel title="Setup Performance — Win Rate · Avg R">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {setupData.map(s => (
            <div key={s.setup} className="border border-ink-line p-3 rounded-sm">
              <div className="flex justify-between items-baseline">
                <span className="font-display text-[12px] uppercase tracking-widest text-soft-white">{s.setup}</span>
                <span className="text-[10px] text-slate-gray tabular-nums">{s.n} closed</span>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-2">
                <div>
                  <div className="text-[10px] text-slate-gray uppercase tracking-wider">Win Rate</div>
                  <div className={`font-mono-num text-[16px] tabular-nums ${s.n ? "" : "text-slate-gray/60"}`}>{s.n ? `${s.winRate.toFixed(1)}%` : "—"}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-gray uppercase tracking-wider">Avg R</div>
                  <div className={`font-mono-num text-[16px] tabular-nums ${!s.n ? "text-slate-gray/60" : s.avgR > 0 ? "text-signal-green" : s.avgR < 0 ? "text-signal-red" : ""}`}>{s.n ? fmtR(s.avgR) : "—"}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-gray uppercase tracking-wider">Expectancy</div>
                  <div className={`font-mono-num text-[16px] tabular-nums ${!s.n ? "text-slate-gray/60" : s.expectancy >= 0.35 ? "text-signal-green" : s.expectancy < 0 ? "text-signal-red" : ""}`}>{s.n ? fmtR(s.expectancy) : "—"}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Per Quality Grade (A / B / C)">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {qualityData.map(q => (
            <div key={q.grade} className="border border-ink-line p-3 rounded-sm">
              <div className="flex items-baseline justify-between">
                <Chip tone={q.grade === "A" ? "green" : q.grade === "B" ? "amber" : "red"}>Grade {q.grade}</Chip>
                <span className="text-[10px] text-slate-gray tabular-nums">{q.n} trades</span>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div>
                  <div className="text-[10px] text-slate-gray uppercase tracking-wider">Win Rate</div>
                  <div className={`font-mono-num text-[16px] tabular-nums ${q.n ? "" : "text-slate-gray/60"}`}>{q.n ? `${q.winRate.toFixed(1)}%` : "—"}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-gray uppercase tracking-wider">Avg R</div>
                  <div className={`font-mono-num text-[16px] tabular-nums ${!q.n ? "text-slate-gray/60" : q.avgR > 0 ? "text-signal-green" : q.avgR < 0 ? "text-signal-red" : ""}`}>{q.n ? fmtR(q.avgR) : "—"}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Per Regime P/L (R)">
        <div className="grid grid-cols-3 gap-3">
          {regimeData.map(r => (
            <div key={r.regime} className="border border-ink-line p-3 rounded-sm">
              <div className="flex justify-between">
                <Chip tone={r.regime === "GREEN" ? "green" : r.regime === "YELLOW" ? "amber" : "red"}>{r.regime}</Chip>
                <span className="text-[10px] text-slate-gray tabular-nums">{r.n} trades</span>
              </div>
              <div className={`mt-2 font-mono-num text-[18px] tabular-nums ${r.totalR > 0 ? "text-signal-green" : r.totalR < 0 ? "text-signal-red" : ""}`}>{fmtR(r.totalR)}</div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Health Flags">
        {flags.length === 0 ? (
          <div className="text-[12px] text-signal-green">All clear. No health flags.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {flags.map((f, i) => <Chip key={i} tone={f.tone}>{f.label}</Chip>)}
          </div>
        )}
      </Panel>
    </div>
  );
}

function KPI({ label, value, tone }: { label: string; value: string; tone?: "green" | "red" | "neutral" | "empty" }) {
  const color =
    tone === "green" ? "text-signal-green"
    : tone === "red" ? "text-signal-red"
    : tone === "empty" ? "text-slate-gray/60"
    : "text-soft-white";
  return (
    <Panel title={label}>
      <div className={`font-mono-num text-[22px] tabular-nums leading-none ${color}`}>{value}</div>
    </Panel>
  );
}

function Empty() {
  return <div className="text-[11px] text-slate-gray py-6 text-center">No data yet.</div>;
}
