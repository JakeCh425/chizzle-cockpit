// ─── TradePlanWorkspace (v2 Overhaul) ──────────────────────────────────────
// A unified "trade plan brief" for the currently-selected ticker.
// MUTATES NOTHING. Renders explanations derived from data that already exists.

import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useCockpitTicker } from "@/components/CockpitTickerContext";
import { useLiveQuotes } from "@/lib/useLivePrices";
import { rsi as rsiSeries } from "@/lib/rsi";
import {
  Target, Shield, Flag, Crosshair, ArrowUp, ArrowDown, Activity,
  AlertTriangle, CheckCircle2, Circle, BarChart3, Info, ClipboardCheck, Eye,
} from "lucide-react";

// ─── TYPES ─────────────────────────────────────────────────────────────────

interface OHLCBar { time?: number; date?: string; open: number; high: number; low: number; close: number; volume?: number }

interface ActiveSetupRow {
  id: string;
  ticker: string;
  sector?: string | null;
  theme?: string | null;
  thesis?: string | null;
  entry: number;
  stop: number;
  targetT1: number;
  targetT2?: number | null;
  riskPercent?: number | null;
  regime?: string | null;
  structureVerdict?: string | null;
  rrRatio?: number | null;
  status: "planned" | "active" | "trimmed" | "closed" | "archived";
  pinned?: boolean;
  notes?: string | null;
}

interface FlexCard {
  ticker: string;
  state: "STANDARD_READY" | "FLEX_READY" | "FLEX_WATCH" | "STANDBY" | string;
  setup?: string;
  trend?: string;
  structure?: string;
  trigger?: string;
  risk_grade?: string;
}

type SetupState =
  | "ACTIVE" | "READY" | "WATCHING" | "WAITING FOR TRIGGER"
  | "MANAGING" | "INVALIDATED" | "NO ACTIVE SETUP";

// ─── MATH HELPERS ──────────────────────────────────────────────────────────

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  let s = 0;
  for (let i = values.length - period; i < values.length; i++) s += values[i];
  return s / period;
}

function slope(values: number[], period: number): number | null {
  if (values.length < period + 5) return null;
  const now = sma(values, period);
  const then = sma(values.slice(0, -5), period);
  if (now == null || then == null || then === 0) return null;
  return ((now - then) / then) * 100;
}

function fmtPrice(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  return n.toFixed(2);
}

function fmtPct(n: number | null | undefined, signed = true): string {
  if (n == null || !isFinite(n)) return "—";
  const s = signed && n > 0 ? "+" : "";
  return `${s}${n.toFixed(2)}%`;
}

function fmtDollar(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

// ─── STATE DERIVATION ──────────────────────────────────────────────────────

function deriveSetupState(setup: ActiveSetupRow | null, currentPrice: number | null): SetupState {
  if (!setup) return "NO ACTIVE SETUP";
  if (setup.status === "closed" || setup.status === "archived") return "NO ACTIVE SETUP";
  if (currentPrice != null && setup.status === "active" && currentPrice < setup.stop) return "INVALIDATED";
  if (currentPrice != null && setup.status === "planned" && currentPrice < setup.stop) return "INVALIDATED";
  if (setup.status === "trimmed") return "MANAGING";
  if (setup.status === "active") return "ACTIVE";
  if (setup.status === "planned") {
    if (currentPrice != null && currentPrice >= setup.entry) return "READY";
    return "WAITING FOR TRIGGER";
  }
  return "WATCHING";
}

function deriveDirection(setup: ActiveSetupRow | null): "LONG" | "SHORT" | "WATCH" {
  if (!setup) return "WATCH";
  if (setup.entry > setup.stop) return "LONG";
  if (setup.entry < setup.stop) return "SHORT";
  return "WATCH";
}

function stateColor(state: SetupState): { bg: string; text: string; border: string } {
  switch (state) {
    case "ACTIVE":              return { bg: "bg-signal-green/10",  text: "text-signal-green", border: "border-signal-green/40" };
    case "READY":               return { bg: "bg-neon-blue/10",     text: "text-neon-blue",    border: "border-neon-blue/40" };
    case "MANAGING":            return { bg: "bg-signal-amber/10",  text: "text-signal-amber", border: "border-signal-amber/40" };
    case "WAITING FOR TRIGGER": return { bg: "bg-slate-500/10",     text: "text-slate-gray",   border: "border-ink-line" };
    case "WATCHING":            return { bg: "bg-slate-500/10",     text: "text-slate-gray",   border: "border-ink-line" };
    case "INVALIDATED":         return { bg: "bg-signal-red/10",    text: "text-signal-red",   border: "border-signal-red/40" };
    case "NO ACTIVE SETUP":     return { bg: "bg-ink-deep/40",      text: "text-slate-gray",   border: "border-ink-line" };
  }
}

// ─── MAIN COMPONENT ────────────────────────────────────────────────────────

export default function TradePlanWorkspace() {
  const { active } = useCockpitTicker();
  const ticker = active || "SPY";
  const liveQuotes = useLiveQuotes();

  const { data: setups } = useQuery<ActiveSetupRow[]>({
    queryKey: ["/api/active-setups"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/active-setups");
      return await res.json();
    },
    staleTime: 30_000,
  });

  const { data: bars } = useQuery<OHLCBar[]>({
    queryKey: ["/api/candles-ohlc", ticker, "1D"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/candles-ohlc/${ticker}?interval=1D`);
      const json = await res.json();
      return Array.isArray(json) ? json : json?.bars || [];
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

  const { data: flexScan } = useQuery<any>({
    queryKey: ["/api/flex-scan"],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/flex-scan", {});
      return await res.json().catch(() => ({}));
    },
    staleTime: 60_000,
    retry: false,
  });

  const setup: ActiveSetupRow | null = useMemo(() => {
    if (!setups) return null;
    const forTicker = setups.filter((s) => s.ticker === ticker && s.status !== "archived" && s.status !== "closed");
    if (forTicker.length === 0) return null;
    const rank = (s: ActiveSetupRow) => ({ active: 0, trimmed: 1, planned: 2 } as any)[s.status] ?? 9;
    return forTicker.slice().sort((a, b) => rank(a) - rank(b))[0];
  }, [setups, ticker]);

  const flexCard: FlexCard | null = useMemo(() => {
    const cards: FlexCard[] = flexScan?.cards || flexScan?.results || [];
    if (!Array.isArray(cards)) return null;
    return cards.find((c) => c.ticker === ticker) || null;
  }, [flexScan, ticker]);

  const quote = liveQuotes[ticker];
  const currentPrice = quote?.price ?? (bars && bars.length ? bars[bars.length - 1].close : null);
  const dayChangePct = (() => {
    if (quote?.changePct != null && isFinite(quote.changePct)) return quote.changePct;
    if (bars && bars.length >= 2) {
      const c = bars[bars.length - 1].close;
      const p = bars[bars.length - 2].close;
      return ((c - p) / p) * 100;
    }
    return null;
  })();

  const setupState = deriveSetupState(setup, currentPrice);
  const direction = deriveDirection(setup);
  const stateCls = stateColor(setupState);

  const tech = useMemo(() => {
    if (!bars || bars.length < 50) return null;
    const closes = bars.map((b) => b.close);
    const last = closes[closes.length - 1];
    const s20  = sma(closes, 20);
    const s50  = sma(closes, 50);
    const s200 = closes.length >= 200 ? sma(closes, 200) : null;
    const slope50  = closes.length >= 55  ? slope(closes, 50) : null;
    const rsiArr = rsiSeries(closes, 14);
    const rsi = rsiArr[rsiArr.length - 1] ?? null;
    const vols = bars.slice(-20).map((b) => b.volume || 0);
    const avgVol = vols.reduce((a, b) => a + b, 0) / vols.length;
    const lastVol = bars[bars.length - 1].volume || 0;
    const relVol = avgVol > 0 ? lastVol / avgVol : null;
    return { last, s20, s50, s200, slope50, rsi, relVol };
  }, [bars]);

  const dist = useMemo(() => {
    if (!setup || currentPrice == null) return null;
    const riskPerShare = setup.entry - setup.stop;
    return {
      toEntry:  ((setup.entry - currentPrice) / currentPrice) * 100,
      toStop:   ((currentPrice - setup.stop)  / currentPrice) * 100,
      toT1:     ((setup.targetT1 - currentPrice) / currentPrice) * 100,
      toT2:     setup.targetT2 != null ? ((setup.targetT2 - currentPrice) / currentPrice) * 100 : null,
      riskPerShare,
    };
  }, [setup, currentPrice]);

  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-ink-line bg-ink-black shadow-sm" data-testid="trade-plan-workspace">
      
      {/* Header */}
      <header className="flex flex-wrap items-center gap-4 border-b border-ink-line bg-ink-deep/60 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold tracking-wide text-soft-white">{ticker}</span>
          {(setup?.sector || setup?.theme) && (
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-gray">
              {setup?.sector}{setup?.theme && setup?.sector ? " · " : ""}{setup?.theme}
            </span>
          )}
          <span className="hidden text-xs font-semibold uppercase tracking-wider text-slate-gray sm:inline">— Trade Plan Workspace</span>
        </div>

        <div className={`flex items-center gap-2 rounded-md border px-2.5 py-1 ${stateCls.bg} ${stateCls.text} ${stateCls.border}`}>
          <Circle className="h-2 w-2 fill-current" />
          <span className="text-xs font-mono font-bold uppercase tracking-wider">{setupState}</span>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono font-medium uppercase tracking-wider">
          <span className={direction === "LONG" ? "text-signal-green" : direction === "SHORT" ? "text-signal-red" : "text-slate-gray"}>
            {direction === "LONG" && <ArrowUp className="inline h-3 w-3 mr-1" />}
            {direction === "SHORT" && <ArrowDown className="inline h-3 w-3 mr-1" />}
            {direction}
          </span>
          <span className="text-slate-gray/40">·</span>
          <span className="text-slate-gray">{flexCard?.setup || setup?.structureVerdict || "Setup type: Not defined"}</span>
          {flexCard?.risk_grade && (
            <>
              <span className="text-slate-gray/40">·</span>
              <span className="text-neon-blue">Grade {flexCard.risk_grade.replace(/_/g, " ")}</span>
            </>
          )}
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-3 font-mono">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-gray">Current</span>
          <span className="text-lg font-bold tabular-nums text-soft-white">{fmtDollar(currentPrice)}</span>
          {dayChangePct != null && (
            <span className={`text-sm font-medium tabular-nums ${dayChangePct >= 0 ? "text-signal-green" : "text-signal-red"}`}>
              ({fmtPct(dayChangePct)})
            </span>
          )}
        </div>
      </header>

      {/* Next-action strip */}
      <NextActionStrip setup={setup} setupState={setupState} dist={dist} regime={regime?.day_class} />

      {/* 3-Column Body */}
      <div className="grid grid-cols-1 gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1fr)]">
        <TradeLevelsColumn setup={setup} currentPrice={currentPrice} dist={dist} direction={direction} setupState={setupState} />
        <TradeThesisColumn setup={setup} setupState={setupState} tech={tech} regime={regime} flexCard={flexCard} ticker={ticker} />
        <TechRiskColumn setup={setup} setupState={setupState} tech={tech} regime={regime} dist={dist} ticker={ticker} currentPrice={currentPrice} />
      </div>
    </section>
  );
}

// ─── SUB-COMPONENTS ────────────────────────────────────────────────────────

function NextActionStrip({ setup, setupState, dist, regime }: any) {
  let text = "";
  if (!setup) text = "No active setup. Watch the scanner and wait for a qualifying trigger — do not enter early.";
  else if (setupState === "INVALIDATED") text = `Price is below the defined stop of ${fmtDollar(setup.stop)}. The trade plan is invalidated — stand down and reassess.`;
  else if (setupState === "WAITING FOR TRIGGER" && dist) text = `Waiting for trigger. Entry ${fmtDollar(setup.entry)} is ${fmtPct(dist.toEntry)} away. Do not chase.`;
  else if (setupState === "READY") text = `Ready. Price has reached entry ${fmtDollar(setup.entry)}. Execute per plan; initial stop at ${fmtDollar(setup.stop)}.`;
  else if (setupState === "ACTIVE" && dist) text = `Active. Hold above ${fmtDollar(setup.stop)}. T1 is ${fmtPct(dist.toT1)} away — trim per management plan on approach.`;
  else if (setupState === "MANAGING") text = `Managing runner. Trail stop with the 20-SMA and let T2 (${fmtDollar(setup.targetT2) || "not defined"}) work.`;
  else text = "Watching. Follow existing scanner rules and regime state before taking action.";
  
  if (regime === "RED") text += " Regime is RED — capital protection reduces size / blocks new risk.";

  return (
    <div className="flex items-start gap-3 border-b border-ink-line bg-ink-black px-4 py-3">
      <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-neon-blue" />
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-gray">Next Action</span>
        <span className="text-sm font-medium text-soft-white">{text}</span>
      </div>
    </div>
  );
}

// ── LEFT: Trade Levels ──
function TradeLevelsColumn({ setup, currentPrice, dist, direction, setupState }: any) {
  return (
    <div className="flex flex-col gap-4">
      <ColumnHeader icon={<Target className="h-4 w-4" />} label="Trade Levels" />

      {!setup ? (
        <div className="flex flex-col gap-2 rounded-lg border border-ink-line bg-ink-deep/40 p-4">
          <div className="flex items-center gap-2 text-soft-white">
            <Info className="h-4 w-4 text-neon-blue" />
            <span className="text-xs font-mono font-bold uppercase tracking-wider">Not defined</span>
          </div>
          <span className="text-xs leading-relaxed text-slate-gray">No active setup for this ticker. Entry, stop, and targets appear here when a setup is created or qualified.</span>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <LevelCard icon={<Flag className="h-4 w-4" />} label="Target 2" price={setup.targetT2} accent="green" caption={dist?.toT2 != null && setupState === "ACTIVE" ? `${fmtPct(dist.toT2)} away` : undefined} />
          <LevelCard icon={<Flag className="h-4 w-4" />} label="Target 1" price={setup.targetT1} accent="green" caption={dist && setupState === "ACTIVE" ? `${fmtPct(dist.toT1)} away` : undefined} />
          <LevelCard icon={<Crosshair className="h-4 w-4" />} label="Current" price={currentPrice} accent="white" />
          <LevelCard icon={<Target className="h-4 w-4" />} label="Entry / Trigger" price={setup.entry} accent="cyan" caption={dist && setupState === "WAITING FOR TRIGGER" ? `${fmtPct(dist.toEntry)} to trigger` : undefined} />
          <LevelCard icon={<Shield className="h-4 w-4" />} label="Stop Loss" price={setup.stop} accent="red" caption={dist && (setupState === "ACTIVE" || setupState === "MANAGING") ? `${fmtPct(dist.toStop)} above stop` : undefined} />

          <div className="grid grid-cols-2 gap-4 rounded-lg border border-ink-line bg-ink-deep/40 p-4">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-gray">Risk / share</span>
              <span className="text-sm font-mono font-bold tabular-nums text-soft-white">{fmtDollar(dist?.riskPerShare)}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-gray">R : R</span>
              <span className="text-sm font-mono font-bold tabular-nums text-soft-white">{setup.rrRatio && setup.rrRatio > 0 ? `${setup.rrRatio.toFixed(2)} : 1` : "Not defined"}</span>
            </div>
          </div>

          <LevelRail setup={setup} currentPrice={currentPrice} direction={direction} />
        </div>
      )}
    </div>
  );
}

function LevelCard({ icon, label, price, accent, caption }: any) {
  const accentText = accent === "cyan" ? "text-neon-blue" : accent === "red" ? "text-signal-red" : accent === "green" ? "text-signal-green" : "text-soft-white";
  const accentBorder = accent === "cyan" ? "border-neon-blue/30" : accent === "red" ? "border-signal-red/30" : accent === "green" ? "border-signal-green/30" : "border-ink-line";
  
  return (
    <div className={`flex items-center gap-4 rounded-lg border ${accentBorder} bg-ink-deep/40 p-3`}>
      <span className={`${accentText} shrink-0`}>{icon}</span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-gray">{label}</span>
        <span className={`text-base font-bold tabular-nums ${accentText}`}>{price == null ? "Not defined" : fmtDollar(price)}</span>
      </div>
      {caption && <span className="whitespace-nowrap text-xs font-mono font-medium text-slate-gray">{caption}</span>}
    </div>
  );
}

function LevelRail({ setup, currentPrice, direction }: any) {
  const points = [
    { label: "T2",   price: setup.targetT2, color: "#22c55e", side: "right" },
    { label: "T1",   price: setup.targetT1, color: "#4ade80", side: "right" },
    { label: "Now",  price: currentPrice,   color: "#e2e8f0", side: "left"  },
    { label: "Ent",  price: setup.entry,    color: "#22d3ee", side: "right" },
    { label: "Stop", price: setup.stop,     color: "#f87171", side: "right" },
  ].filter((p) => p.price != null);

  if (points.length < 2) return null;
  const prices = points.map((p) => p.price as number);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const H = 140;
  const pad = 16;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-ink-line bg-ink-deep/40 p-4">
      <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-gray">Level Rail</span>
      <svg viewBox={`0 0 260 ${H}`} className="w-full" style={{ height: H }}>
        <line x1="130" y1={pad} x2="130" y2={H - pad} stroke="rgba(148,163,184,0.15)" strokeWidth="1" />
        {points.map((p) => {
          const y = pad + ((max - (p.price as number)) / range) * (H - pad * 2);
          const isLeft = p.side === "left";
          const labelX = isLeft ? 116 : 144;
          const anchor = isLeft ? "end" : "start";
          return (
            <g key={p.label}>
              <line x1="120" y1={y} x2="140" y2={y} stroke={p.color} strokeWidth="2" />
              <text x={labelX} y={y - 4} fontSize="10" fill={p.color} textAnchor={anchor} fontFamily="ui-monospace, monospace" fontWeight="600" style={{ letterSpacing: 0.5 }}>{p.label}</text>
              <text x={labelX} y={y + 10} fontSize="11" fill="#e2e8f0" textAnchor={anchor} fontFamily="ui-monospace, monospace" fontWeight="500" style={{ letterSpacing: 0.3 }}>{fmtPrice(p.price)}</text>
            </g>
          );
        })}
      </svg>
      <span className="text-center text-[10px] italic text-slate-gray/70">
        {direction === "LONG" ? "Ladder oriented long: higher = profit." : direction === "SHORT" ? "Ladder oriented short: lower = profit." : "Watch only — no directional bias."}
      </span>
    </div>
  );
}

// ── CENTER: Trade Thesis ──
function TradeThesisColumn({ setup, setupState, tech, regime, flexCard, ticker }: any) {
  const dayClass = regime?.day_class || "UNKNOWN";
  const confirms: string[] = [];
  const invalidates: string[] = [];
  const watchFor: string[] = [];

  if (tech) {
    if (tech.s20 != null && tech.last > tech.s20) confirms.push(`Price holds above the 20-SMA (${fmtDollar(tech.s20)}).`);
    if (tech.s50 != null && tech.last > tech.s50) confirms.push(`Price is above the 50-SMA (${fmtDollar(tech.s50)}) — intermediate uptrend intact.`);
    if (tech.s200 != null && tech.last > tech.s200) confirms.push(`Price is above the 200-SMA (${fmtDollar(tech.s200)}) — long-term trend alignment positive.`);
    if (tech.slope50 != null && tech.slope50 > 0) confirms.push(`50-SMA slope is positive (${fmtPct(tech.slope50)} over 5 bars).`);
    if (tech.relVol != null && tech.relVol > 1.2) confirms.push(`Relative volume ${tech.relVol.toFixed(2)}× 20-day average — participation supportive.`);
    if (tech.rsi != null && tech.rsi >= 50 && tech.rsi <= 65) confirms.push(`RSI 14 at ${tech.rsi.toFixed(0)} — healthy momentum, not overbought.`);

    if (tech.s20 != null && tech.last < tech.s20) invalidates.push(`Loss of the 20-SMA (${fmtDollar(tech.s20)}) weakens the short-term thesis.`);
    if (tech.s50 != null && tech.last < tech.s50) invalidates.push(`Below the 50-SMA (${fmtDollar(tech.s50)}) — intermediate trend not supportive.`);
    if (tech.rsi != null && tech.rsi > 75) watchFor.push(`RSI ${tech.rsi.toFixed(0)} — extended; expect a pullback before continuation.`);
    if (tech.rsi != null && tech.rsi < 40) watchFor.push(`RSI ${tech.rsi.toFixed(0)} — weakening momentum.`);
  }

  if (dayClass === "GREEN") confirms.push("Market Regime is GREEN — breakouts have edge.");
  else if (dayClass === "YELLOW") watchFor.push("Regime YELLOW — cut size, no fresh breakouts without confirmation.");
  else if (dayClass === "RED") invalidates.push("Regime shift to RED / Capital Protection requires reassessment.");

  if (flexCard) {
    if (flexCard.state === "STANDARD_READY") confirms.push(`Scanner verdict: STANDARD READY (${flexCard.risk_grade ?? "grade N/A"}).`);
    else if (flexCard.state === "FLEX_READY") confirms.push(`Scanner verdict: FLEX READY.`);
    else if (flexCard.state === "FLEX_WATCH") watchFor.push(`Scanner verdict: FLEX WATCH — not yet qualifying.`);
    else if (flexCard.state === "STANDBY") watchFor.push(`Scanner verdict: STANDBY — no qualifying trigger.`);
  }

  if (setup) invalidates.push(`A close below the defined stop of ${fmtDollar(setup.stop)} invalidates this trade plan.`);

  const headline = !setup
    ? `${ticker} — No active setup. ${dayClass === "GREEN" ? "Regime is constructive; wait for the scanner." : dayClass === "RED" ? "Regime is defensive; stand down." : "Watch for a qualifying scanner trigger."}`
    : setupState === "INVALIDATED"
      ? `${ticker} is invalidated: price has closed below the defined stop.`
      : setupState === "WAITING FOR TRIGGER"
        ? `${ticker} is waiting for its entry trigger. Do not front-run the setup.`
        : `${ticker} is ${setupState.toLowerCase()} because ${confirms.length ? confirms[0].toLowerCase() : "the existing rules currently qualify it"}.`;

  return (
    <div className="flex flex-col gap-4">
      <ColumnHeader icon={<Info className="h-4 w-4" />} label={setup ? "Why This Is Active" : "Watchlist Analysis"} />

      <div className="flex flex-col gap-6 rounded-lg border border-ink-line bg-ink-deep/40 p-5">
        <p className="text-sm font-medium text-soft-white leading-relaxed">{headline}</p>

        {setup?.thesis && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-gray">Thesis</span>
            <p className="text-xs leading-relaxed text-slate-gray whitespace-pre-wrap">{setup.thesis}</p>
          </div>
        )}

        {confirms.length > 0 && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-[10px] font-mono font-bold uppercase tracking-wider text-signal-green">
              <CheckCircle2 className="h-4 w-4" /> Confirms
            </div>
            <ul className="flex flex-col gap-2">
              {confirms.slice(0, 5).map((c, i) => (
                <li key={i} className="flex items-start gap-2 text-xs leading-relaxed text-soft-white">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-signal-green" />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {watchFor.length > 0 && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-[10px] font-mono font-bold uppercase tracking-wider text-signal-amber">
              <Eye className="h-4 w-4" /> Watch For
            </div>
            <ul className="flex flex-col gap-2">
              {watchFor.slice(0, 5).map((c, i) => (
                <li key={i} className="flex items-start gap-2 text-xs leading-relaxed text-soft-white">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-signal-amber" />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {invalidates.length > 0 && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-[10px] font-mono font-bold uppercase tracking-wider text-signal-red">
              <AlertTriangle className="h-4 w-4" /> Invalidation
            </div>
            <ul className="flex flex-col gap-2">
              {invalidates.slice(0, 4).map((c, i) => (
                <li key={i} className="flex items-start gap-2 text-xs leading-relaxed text-soft-white">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-signal-red" />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {confirms.length === 0 && watchFor.length === 0 && invalidates.length === 0 && (
          <p className="text-xs italic text-slate-gray">Not enough data yet to synthesize a thesis.</p>
        )}
      </div>
    </div>
  );
}

// ── RIGHT: Tech & Risk ──
function TechRiskColumn({ setup, setupState, tech, regime, dist, ticker, currentPrice }: any) {
  const dayClass = regime?.day_class || "UNKNOWN";
  const rows: any[] = [];

  const addMARow = (name: string, ma: number | null) => {
    if (ma == null || tech == null) {
      rows.push({ label: name, value: "Not available", state: "Not available" });
      return;
    }
    const above = tech.last > ma;
    const dpct = ((tech.last - ma) / ma) * 100;
    rows.push({
      label: name,
      value: `${above ? "Above" : "Below"} ${fmtDollar(ma)} · ${fmtPct(dpct)}`,
      state: above ? "Supporting" : "Risk",
    });
  };

  addMARow("20 SMA", tech?.s20);
  addMARow("50 SMA", tech?.s50);
  addMARow("200 SMA", tech?.s200);

  if (tech?.slope50 != null) rows.push({ label: "50 SMA slope", value: fmtPct(tech.slope50) + " · 5 bars", state: tech.slope50 > 0.2 ? "Supporting" : tech.slope50 < -0.2 ? "Risk" : "Neutral" });
  
  if (tech?.rsi != null) rows.push({ label: "RSI 14", value: tech.rsi.toFixed(1), state: tech.rsi >= 70 ? "Weakening" : tech.rsi >= 55 ? "Supporting" : tech.rsi >= 45 ? "Neutral" : tech.rsi >= 30 ? "Weakening" : "Risk" });
  else rows.push({ label: "RSI 14", value: "Not available", state: "Not available" });

  if (tech?.relVol != null) rows.push({ label: "Relative volume", value: `${tech.relVol.toFixed(2)}× 20-day`, state: tech.relVol >= 1.3 ? "Supporting" : tech.relVol >= 0.8 ? "Neutral" : "Weakening" });
  else rows.push({ label: "Relative volume", value: "Not available", state: "Not available" });

  rows.push({ label: "Market Regime", value: dayClass, state: dayClass === "GREEN" ? "Supporting" : dayClass === "YELLOW" ? "Neutral" : dayClass === "RED" ? "Risk" : "Not available" });

  const riskState = (() => {
    if (dayClass === "RED") return { level: "Avoid", msg: "Capital Protection active — do not open new risk." };
    if (!setup) return { level: "Unknown", msg: "No setup — nothing to size." };
    if (setupState === "INVALIDATED") return { level: "Avoid", msg: "Stop violated. Stand down and reassess." };
    if (setupState === "ACTIVE" && dist) {
      if (dist.toT1 <= 1 && dist.toT1 >= -1) return { level: "Caution", msg: "Approaching T1 — follow management plan." };
      if (dist.toStop < 1) return { level: "Elevated", msg: "Price near stop — tight risk." };
      if (tech?.s20 && currentPrice != null && ((currentPrice - tech.s20) / tech.s20) * 100 > 8) return { level: "Caution", msg: "Extended from 20-SMA — avoid chasing." };
      return { level: "Normal", msg: "Price above stop, not extended." };
    }
    if (setupState === "WAITING FOR TRIGGER") return { level: "Normal", msg: "No open risk yet — trigger not reached." };
    if (dayClass === "YELLOW") return { level: "Caution", msg: "Regime YELLOW — half size on any new entry." };
    return { level: "Normal", msg: "Standard risk conditions." };
  })();

  const riskColor: Record<string, string> = {
    Normal:   "text-signal-green border-signal-green/40 bg-signal-green/5",
    Caution:  "text-signal-amber border-signal-amber/40 bg-signal-amber/5",
    Elevated: "text-signal-amber border-signal-amber/40 bg-signal-amber/5",
    Avoid:    "text-signal-red border-signal-red/40 bg-signal-red/5",
    Unknown:  "text-slate-gray border-ink-line bg-ink-deep/40",
  };

  const badgeColor = (state: string) => {
    switch (state) {
      case "Supporting":    return "text-signal-green border-signal-green/40 bg-signal-green/10";
      case "Neutral":       return "text-slate-gray border-ink-line bg-ink-deep/40";
      case "Weakening":     return "text-signal-amber border-signal-amber/40 bg-signal-amber/10";
      case "Risk":          return "text-signal-red border-signal-red/40 bg-signal-red/10";
      default:              return "text-slate-gray/60 border-ink-line bg-ink-deep/20";
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <ColumnHeader icon={<Activity className="h-4 w-4" />} label="Technical + Risk" />

      <div className="flex flex-col gap-3 rounded-lg border border-ink-line bg-ink-deep/40 p-4">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-gray">Alignment</span>
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-3">
            <span className="min-w-[100px] text-xs font-mono font-medium uppercase tracking-wider text-slate-gray">{r.label}</span>
            <span className="flex-1 truncate text-xs font-medium tabular-nums text-soft-white">{r.value}</span>
            <span className={`rounded-md border px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider ${badgeColor(r.state)}`}>
              {r.state}
            </span>
          </div>
        ))}
      </div>

      <div className={`flex flex-col gap-2 rounded-lg border p-5 ${riskColor[riskState.level]}`}>
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider">Risk Check · {riskState.level}</span>
        </div>
        <span className="text-sm font-medium leading-relaxed">{riskState.msg}</span>
        
        {setup && dist && (
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-current/20 pt-3 text-xs font-mono font-medium opacity-80">
            <div>To Stop: <span className="tabular-nums font-bold">{fmtPct(dist.toStop)}</span></div>
            <div>To T1: <span className="tabular-nums font-bold">{fmtPct(dist.toT1)}</span></div>
            {dist.toT2 != null && <div>To T2: <span className="tabular-nums font-bold">{fmtPct(dist.toT2)}</span></div>}
            <div>Risk/share: <span className="tabular-nums font-bold">{fmtDollar(dist.riskPerShare)}</span></div>
          </div>
        )}
      </div>
    </div>
  );
}

function ColumnHeader({ icon, label }: any) {
  return (
    <div className="flex items-center gap-2 pl-1">
      <span className="text-neon-blue">{icon}</span>
      <span className="text-xs font-bold uppercase tracking-wider text-soft-white">{label}</span>
    </div>
  );
}
