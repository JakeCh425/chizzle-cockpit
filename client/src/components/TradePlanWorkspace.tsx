// TradePlanWorkspace — a contained UI enhancement inside the Cockpit page.
//
// Purpose: fill the empty area below the 3-column workspace (chart row) and
// above the Active Setups panel with a single unified "trade plan brief" for
// the currently-selected ticker. Reads only:
//   • useCockpitTicker() — active ticker
//   • GET /api/active-setups   — the setup, if any
//   • GET /api/regime-v2       — regime day_class + reason
//   • GET /api/candles-ohlc/:t — bars for technical alignment
//   • GET /api/flex-scan       — scanner verdict for setup type / grade context
//
// This component MUTATES NOTHING. It renders explanations derived from data
// that already exists in the app. It never invents a level, direction, setup
// type, or grade — anything unknown renders as "Not defined" / "Not available".
//
// Layout: 3-col on lg+, stacks on smaller screens.
//   LEFT   Trade Levels   (entry / stop / T1 / T2 / current + ladder)
//   CENTER Trade Thesis   (why active now — plain English from existing rules)
//   RIGHT  Technical + Risk (MA alignment, RSI, rel-vol, regime, risk state)

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useCockpitTicker } from "@/components/CockpitTickerContext";
import { useLiveQuotes } from "@/lib/useLivePrices";
import { rsi as rsiSeries } from "@/lib/rsi";
import {
  Target, Shield, Flag, Crosshair, ArrowUp, ArrowDown, Activity,
  TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, Circle,
  BarChart3, Info, ClipboardCheck, Eye,
} from "lucide-react";

// ── Local types (mirror shape of existing rows, all optional-tolerant) ───────
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

// ── Math helpers (reuse patterns already used in the app) ────────────────────
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

// ── Header state derivation ──────────────────────────────────────────────────
// Maps existing status + regime into the display badges you spec'd, WITHOUT
// creating any new state. Every branch is derived from data that already exists.
type SetupState =
  | "ACTIVE" | "READY" | "WATCHING" | "WAITING FOR TRIGGER"
  | "MANAGING" | "INVALIDATED" | "NO ACTIVE SETUP";

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

// Direction is inferred from entry vs stop (long-only convention in this app,
// but if a short setup ever gets added stop > entry will flag it as SHORT).
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

// ── Component ────────────────────────────────────────────────────────────────
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
    // Body-less POST that the app already uses. Read-only from our perspective.
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/flex-scan", {});
      return await res.json().catch(() => ({}));
    },
    staleTime: 60_000,
    // Don't block the workspace if the scanner isn't responding.
    retry: false,
  });

  // Pick the setup for the current ticker (prefer active > trimmed > planned).
  const setup: ActiveSetupRow | null = useMemo(() => {
    if (!setups) return null;
    const forTicker = setups.filter(
      (s) => s.ticker === ticker && s.status !== "archived" && s.status !== "closed",
    );
    if (forTicker.length === 0) return null;
    const rank = (s: ActiveSetupRow) => ({ active: 0, trimmed: 1, planned: 2 } as any)[s.status] ?? 9;
    return forTicker.slice().sort((a, b) => rank(a) - rank(b))[0];
  }, [setups, ticker]);

  const flexCard: FlexCard | null = useMemo(() => {
    const cards: FlexCard[] = flexScan?.cards || flexScan?.results || [];
    if (!Array.isArray(cards)) return null;
    return cards.find((c) => c.ticker === ticker) || null;
  }, [flexScan, ticker]);

  // Current price + day change from live quotes (fall back to last bar).
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

  // ── Technical alignment (identical rules to TechnicalSnapshot / gauge) ────
  const tech = useMemo(() => {
    if (!bars || bars.length < 50) return null;
    const closes = bars.map((b) => b.close);
    const last = closes[closes.length - 1];
    const s20  = sma(closes, 20);
    const s50  = sma(closes, 50);
    const s200 = closes.length >= 200 ? sma(closes, 200) : null;
    const slope50  = closes.length >= 55  ? slope(closes, 50) : null;
    const slope200 = closes.length >= 205 ? slope(closes, 200) : null;
    const rsiArr = rsiSeries(closes, 14);
    const rsi = rsiArr[rsiArr.length - 1] ?? null;
    const vols = bars.slice(-20).map((b) => b.volume || 0);
    const avgVol = vols.reduce((a, b) => a + b, 0) / vols.length;
    const lastVol = bars[bars.length - 1].volume || 0;
    const relVol = avgVol > 0 ? lastVol / avgVol : null;
    return { last, s20, s50, s200, slope50, slope200, rsi, relVol };
  }, [bars]);

  // ── Distances (used by both level cards and risk check) ───────────────────
  const dist = useMemo(() => {
    if (!setup || currentPrice == null) return null;
    const riskPerShare = setup.entry - setup.stop;
    return {
      toEntry:  ((setup.entry - currentPrice) / currentPrice) * 100,          // + if below entry
      toStop:   ((currentPrice - setup.stop)  / currentPrice) * 100,          // + if above stop
      toT1:     ((setup.targetT1 - currentPrice) / currentPrice) * 100,       // + if below T1
      toT2:     setup.targetT2 != null ? ((setup.targetT2 - currentPrice) / currentPrice) * 100 : null,
      riskPerShare,
    };
  }, [setup, currentPrice]);

  return (
    <section
      className="rounded-md border border-ink-line bg-ink-black overflow-hidden"
      data-testid="trade-plan-workspace"
      aria-label="Trade Plan Workspace"
    >
      {/* Header ------------------------------------------------------------- */}
      <header className="border-b border-ink-line bg-ink-deep/40 px-4 py-2.5 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-bold text-soft-white tracking-wide">{ticker}</span>
          {(setup?.sector || setup?.theme) && (
            <span className="text-[10px] text-slate-gray uppercase tracking-wider">
              {setup?.sector}{setup?.theme && setup?.sector ? " · " : ""}{setup?.theme}
            </span>
          )}
          <span className="text-[10px] text-slate-gray uppercase tracking-wider">— Trade Plan Workspace</span>
        </div>

        <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded border ${stateCls.bg} ${stateCls.text} ${stateCls.border}`}>
          <Circle className="w-2 h-2 fill-current" />
          <span className="text-[10px] font-mono uppercase tracking-wider">{setupState}</span>
        </div>

        <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider">
          <span className={
            direction === "LONG" ? "text-signal-green" :
            direction === "SHORT" ? "text-signal-red" :
            "text-slate-gray"
          }>
            {direction === "LONG" && <ArrowUp className="w-3 h-3 inline mr-0.5" />}
            {direction === "SHORT" && <ArrowDown className="w-3 h-3 inline mr-0.5" />}
            {direction}
          </span>
          <span className="text-slate-gray/60">·</span>
          <span className="text-slate-gray">
            {flexCard?.setup || setup?.structureVerdict || "Setup type: Not defined"}
          </span>
          {flexCard?.risk_grade && (
            <>
              <span className="text-slate-gray/60">·</span>
              <span className="text-neon-blue">Grade {flexCard.risk_grade.replace(/_/g, " ")}</span>
            </>
          )}
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-2 font-mono">
          <span className="text-[10px] text-slate-gray uppercase tracking-wider">Current</span>
          <span className="text-[13px] font-bold text-soft-white tabular-nums">{fmtDollar(currentPrice)}</span>
          {dayChangePct != null && (
            <span className={`text-[11px] tabular-nums ${dayChangePct >= 0 ? "text-signal-green" : "text-signal-red"}`}>
              ({fmtPct(dayChangePct)})
            </span>
          )}
        </div>
      </header>

      {/* Next-action strip -------------------------------------------------- */}
      <NextActionStrip setup={setup} setupState={setupState} dist={dist} regime={regime?.day_class} />

      {/* 3-column body ------------------------------------------------------ */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1fr)] gap-3 xl:gap-4 p-3 xl:p-4">
        <TradeLevelsColumn setup={setup} currentPrice={currentPrice} dist={dist} direction={direction} setupState={setupState} />
        <TradeThesisColumn setup={setup} setupState={setupState} tech={tech} regime={regime} flexCard={flexCard} ticker={ticker} />
        <TechRiskColumn setup={setup} setupState={setupState} tech={tech} regime={regime} dist={dist} ticker={ticker} currentPrice={currentPrice} />
      </div>
    </section>
  );
}

// ── Next Action strip ───────────────────────────────────────────────────────
function NextActionStrip({
  setup, setupState, dist, regime,
}: {
  setup: ActiveSetupRow | null;
  setupState: SetupState;
  dist: { toEntry: number; toStop: number; toT1: number; toT2: number | null; riskPerShare: number } | null;
  regime?: string;
}) {
  let text = "";
  if (!setup) {
    text = "No active setup. Watch the scanner and wait for a qualifying trigger — do not enter early.";
  } else if (setupState === "INVALIDATED") {
    text = `Price is below the defined stop of ${fmtDollar(setup.stop)}. The trade plan is invalidated — stand down and reassess.`;
  } else if (setupState === "WAITING FOR TRIGGER" && dist) {
    text = `Waiting for trigger. Entry ${fmtDollar(setup.entry)} is ${fmtPct(dist.toEntry)} away. Do not chase.`;
  } else if (setupState === "READY") {
    text = `Ready. Price has reached entry ${fmtDollar(setup.entry)}. Execute per plan; initial stop at ${fmtDollar(setup.stop)}.`;
  } else if (setupState === "ACTIVE" && dist) {
    text = `Active. Hold above ${fmtDollar(setup.stop)}. T1 is ${fmtPct(dist.toT1)} away — trim per management plan on approach.`;
  } else if (setupState === "MANAGING") {
    text = `Managing runner. Trail stop with the 20-SMA and let T2 (${fmtDollar(setup.targetT2 ?? undefined as any) || "not defined"}) work.`;
  } else {
    text = "Watching. Follow existing scanner rules and regime state before taking action.";
  }
  if (regime === "RED") text += " Regime is RED — capital protection reduces size / blocks new risk.";

  return (
    <div className="px-4 py-2 border-b border-ink-line bg-ink-black flex items-start gap-2">
      <ClipboardCheck className="w-3.5 h-3.5 text-neon-blue mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <div className="text-[9px] font-mono uppercase tracking-wider text-slate-gray">Next Action</div>
        <div className="text-[11px] text-soft-white leading-snug">{text}</div>
      </div>
    </div>
  );
}

// ── LEFT: Trade Levels ──────────────────────────────────────────────────────
function TradeLevelsColumn({
  setup, currentPrice, dist, direction, setupState,
}: {
  setup: ActiveSetupRow | null;
  currentPrice: number | null;
  dist: { toEntry: number; toStop: number; toT1: number; toT2: number | null; riskPerShare: number } | null;
  direction: "LONG" | "SHORT" | "WATCH";
  setupState: SetupState;
}) {
  return (
    <div className="min-w-0 space-y-2.5" data-testid="col-trade-levels">
      <ColumnHeader icon={<Target className="w-3 h-3" />} label="Trade Levels" />

      {!setup ? (
        <div className="rounded border border-ink-line bg-ink-deep/40 p-3 text-[11px] text-slate-gray">
          <div className="flex items-center gap-1.5 text-soft-white mb-1">
            <Info className="w-3 h-3 text-neon-blue" />
            <span className="font-mono uppercase tracking-wider text-[10px]">Not defined</span>
          </div>
          No active setup for this ticker. Entry, stop, and targets appear here when a setup is created or qualified.
        </div>
      ) : (
        <>
          <LevelCard
            icon={<Flag className="w-3 h-3" />}
            label="Target 2"
            price={setup.targetT2 ?? null}
            accent="green"
            caption={dist?.toT2 != null && setupState === "ACTIVE" ? `${fmtPct(dist.toT2)} away` : undefined}
          />
          <LevelCard
            icon={<Flag className="w-3 h-3" />}
            label="Target 1"
            price={setup.targetT1}
            accent="green"
            caption={dist && setupState === "ACTIVE" ? `${fmtPct(dist.toT1)} away` : undefined}
          />
          <LevelCard
            icon={<Crosshair className="w-3 h-3" />}
            label="Current"
            price={currentPrice}
            accent="white"
          />
          <LevelCard
            icon={<Target className="w-3 h-3" />}
            label="Entry / Trigger"
            price={setup.entry}
            accent="cyan"
            caption={dist && setupState === "WAITING FOR TRIGGER" ? `${fmtPct(dist.toEntry)} to trigger` : undefined}
          />
          <LevelCard
            icon={<Shield className="w-3 h-3" />}
            label="Stop Loss"
            price={setup.stop}
            accent="red"
            caption={dist && (setupState === "ACTIVE" || setupState === "MANAGING") ? `${fmtPct(dist.toStop)} above stop` : undefined}
          />

          {/* Risk / reward summary */}
          <div className="rounded border border-ink-line bg-ink-deep/40 p-2.5 grid grid-cols-2 gap-2 text-[10px] font-mono">
            <div>
              <div className="text-slate-gray uppercase tracking-wider">Risk / share</div>
              <div className="text-soft-white tabular-nums text-[12px]">{fmtDollar(dist?.riskPerShare)}</div>
            </div>
            <div>
              <div className="text-slate-gray uppercase tracking-wider">R : R</div>
              <div className="text-soft-white tabular-nums text-[12px]">
                {setup.rrRatio && setup.rrRatio > 0 ? `${setup.rrRatio.toFixed(2)} : 1` : "Not defined"}
              </div>
            </div>
          </div>

          {/* Visual level rail — actual values only */}
          <LevelRail setup={setup} currentPrice={currentPrice} direction={direction} />
        </>
      )}
    </div>
  );
}

function LevelCard({
  icon, label, price, accent, caption,
}: {
  icon: React.ReactNode;
  label: string;
  price: number | null | undefined;
  accent: "cyan" | "red" | "green" | "white";
  caption?: string;
}) {
  const accentText =
    accent === "cyan" ? "text-neon-blue" :
    accent === "red"  ? "text-signal-red" :
    accent === "green"? "text-signal-green" :
                        "text-soft-white";
  const accentBorder =
    accent === "cyan" ? "border-neon-blue/30" :
    accent === "red"  ? "border-signal-red/30" :
    accent === "green"? "border-signal-green/30" :
                        "border-ink-line";
  return (
    <div className={`rounded border ${accentBorder} bg-ink-deep/40 px-3 py-1.5 flex items-center gap-2`}>
      <span className={`${accentText} flex-shrink-0`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[9px] font-mono uppercase tracking-wider text-slate-gray">{label}</div>
        <div className={`text-[13px] font-bold tabular-nums ${accentText}`}>
          {price == null ? "Not defined" : fmtDollar(price)}
        </div>
      </div>
      {caption && <div className="text-[9px] font-mono text-slate-gray whitespace-nowrap">{caption}</div>}
    </div>
  );
}

// SVG level rail — actual values, no invented prices.
function LevelRail({
  setup, currentPrice, direction,
}: {
  setup: ActiveSetupRow;
  currentPrice: number | null;
  direction: "LONG" | "SHORT" | "WATCH";
}) {
  const points: { label: string; price: number | null | undefined; color: string; side: "left" | "right" }[] = [
    { label: "T2",   price: setup.targetT2, color: "#22c55e", side: "right" },
    { label: "T1",   price: setup.targetT1, color: "#4ade80", side: "right" },
    { label: "Now",  price: currentPrice,   color: "#e2e8f0", side: "left"  },
    { label: "Ent",  price: setup.entry,    color: "#22d3ee", side: "right" },
    { label: "Stop", price: setup.stop,     color: "#f87171", side: "right" },
  ].filter((p) => p.price != null) as any;

  if (points.length < 2) return null;
  const prices = points.map((p) => p.price as number);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const H = 130;
  const pad = 12;

  return (
    <div className="rounded border border-ink-line bg-ink-deep/40 p-2.5">
      <div className="text-[9px] font-mono uppercase tracking-wider text-slate-gray mb-1">Level Rail</div>
      <svg viewBox={`0 0 260 ${H}`} className="w-full" style={{ height: H }}>
        <line x1="130" y1={pad} x2="130" y2={H - pad} stroke="rgba(148,163,184,0.15)" strokeWidth="1" />
        {points.map((p) => {
          const y = pad + ((max - (p.price as number)) / range) * (H - pad * 2);
          const isLeft = p.side === "left";
          const labelX = isLeft ? 118 : 142;
          const anchor: "start" | "end" = isLeft ? "end" : "start";
          return (
            <g key={p.label}>
              <line x1="120" y1={y} x2="140" y2={y} stroke={p.color} strokeWidth="1.5" />
              <text x={labelX} y={y - 3} fontSize="9" fill={p.color} textAnchor={anchor}
                    fontFamily="ui-monospace, monospace" style={{ letterSpacing: 0.5 }}>
                {p.label}
              </text>
              <text x={labelX} y={y + 8} fontSize="10" fill="#e2e8f0" textAnchor={anchor}
                    fontFamily="ui-monospace, monospace" style={{ letterSpacing: 0.3 }}>
                {fmtPrice(p.price)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="text-[9px] text-slate-gray/70 text-center italic mt-1">
        {direction === "LONG" ? "Ladder oriented long: higher = profit." :
         direction === "SHORT" ? "Ladder oriented short: lower = profit." :
         "Watch only — no directional bias."}
      </div>
    </div>
  );
}

// ── CENTER: Trade Thesis ────────────────────────────────────────────────────
function TradeThesisColumn({
  setup, setupState, tech, regime, flexCard, ticker,
}: {
  setup: ActiveSetupRow | null;
  setupState: SetupState;
  tech: any;
  regime?: any;
  flexCard: FlexCard | null;
  ticker: string;
}) {
  // Build "confirms" / "invalidates" / "watch for" from actual state only.
  const dayClass: string = regime?.day_class || "UNKNOWN";

  const confirms: string[] = [];
  const invalidates: string[] = [];
  const watchFor: string[] = [];

  if (tech) {
    if (tech.s20  != null && tech.last > tech.s20)  confirms.push(`Price holds above the 20-SMA (${fmtDollar(tech.s20)}).`);
    if (tech.s50  != null && tech.last > tech.s50)  confirms.push(`Price is above the 50-SMA (${fmtDollar(tech.s50)}) — intermediate uptrend intact.`);
    if (tech.s200 != null && tech.last > tech.s200) confirms.push(`Price is above the 200-SMA (${fmtDollar(tech.s200)}) — long-term trend alignment positive.`);
    if (tech.slope50 != null && tech.slope50 > 0)   confirms.push(`50-SMA slope is positive (${fmtPct(tech.slope50)} over 5 bars).`);
    if (tech.relVol != null && tech.relVol > 1.2)   confirms.push(`Relative volume ${tech.relVol.toFixed(2)}× 20-day average — participation supportive.`);
    if (tech.rsi != null && tech.rsi >= 50 && tech.rsi <= 65) confirms.push(`RSI 14 at ${tech.rsi.toFixed(0)} — healthy momentum, not overbought.`);

    if (tech.s20  != null && tech.last < tech.s20)  invalidates.push(`Loss of the 20-SMA (${fmtDollar(tech.s20)}) weakens the short-term thesis.`);
    if (tech.s50  != null && tech.last < tech.s50)  invalidates.push(`Below the 50-SMA (${fmtDollar(tech.s50)}) — intermediate trend not supportive.`);
    if (tech.rsi != null && tech.rsi > 75)          watchFor.push(`RSI ${tech.rsi.toFixed(0)} — extended; expect a pullback before continuation.`);
    if (tech.rsi != null && tech.rsi < 40)          watchFor.push(`RSI ${tech.rsi.toFixed(0)} — weakening momentum.`);
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

  if (setup) {
    invalidates.push(`A close below the defined stop of ${fmtDollar(setup.stop)} invalidates this trade plan.`);
  }

  // Build a headline from real state.
  const headline = !setup
    ? `${ticker} — No active setup. ${dayClass === "GREEN" ? "Regime is constructive; wait for the scanner." : dayClass === "RED" ? "Regime is defensive; stand down." : "Watch for a qualifying scanner trigger."}`
    : setupState === "INVALIDATED"
      ? `${ticker} is invalidated: price has closed below the defined stop.`
      : setupState === "WAITING FOR TRIGGER"
        ? `${ticker} is waiting for its entry trigger. Do not front-run the setup.`
        : `${ticker} is ${setupState.toLowerCase()} because ${confirms.length ? confirms[0].toLowerCase() : "the existing rules currently qualify it"}.`;

  return (
    <div className="min-w-0 space-y-2.5" data-testid="col-trade-thesis">
      <ColumnHeader icon={<Info className="w-3 h-3" />} label={setup ? "Why This Is Active" : "Watchlist Analysis"} />

      <div className="rounded border border-ink-line bg-ink-deep/40 p-3 space-y-2.5">
        <p className="text-[12px] text-soft-white leading-snug">{headline}</p>

        {setup?.thesis && (
          <div>
            <div className="text-[9px] font-mono uppercase tracking-wider text-slate-gray mb-0.5">Thesis</div>
            <p className="text-[11px] text-slate-gray leading-snug whitespace-pre-wrap">{setup.thesis}</p>
          </div>
        )}

        {confirms.length > 0 && (
          <div>
            <div className="text-[9px] font-mono uppercase tracking-wider text-signal-green mb-1 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Confirms
            </div>
            <ul className="space-y-1">
              {confirms.slice(0, 5).map((c, i) => (
                <li key={i} className="text-[11px] text-soft-white leading-snug flex items-start gap-1.5">
                  <span className="mt-1 w-1 h-1 rounded-full bg-signal-green flex-shrink-0" />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {watchFor.length > 0 && (
          <div>
            <div className="text-[9px] font-mono uppercase tracking-wider text-signal-amber mb-1 flex items-center gap-1">
              <Eye className="w-3 h-3" /> Watch For
            </div>
            <ul className="space-y-1">
              {watchFor.slice(0, 5).map((c, i) => (
                <li key={i} className="text-[11px] text-soft-white leading-snug flex items-start gap-1.5">
                  <span className="mt-1 w-1 h-1 rounded-full bg-signal-amber flex-shrink-0" />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {invalidates.length > 0 && (
          <div>
            <div className="text-[9px] font-mono uppercase tracking-wider text-signal-red mb-1 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Invalidation
            </div>
            <ul className="space-y-1">
              {invalidates.slice(0, 4).map((c, i) => (
                <li key={i} className="text-[11px] text-soft-white leading-snug flex items-start gap-1.5">
                  <span className="mt-1 w-1 h-1 rounded-full bg-signal-red flex-shrink-0" />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {confirms.length === 0 && watchFor.length === 0 && invalidates.length === 0 && (
          <p className="text-[11px] text-slate-gray italic">Not enough data yet to synthesize a thesis.</p>
        )}
      </div>
    </div>
  );
}

// ── RIGHT: Technical Alignment + Risk Check ─────────────────────────────────
type AlignLabel = "Supporting" | "Neutral" | "Weakening" | "Risk" | "Not available";
function labelColor(l: AlignLabel): string {
  switch (l) {
    case "Supporting":    return "text-signal-green border-signal-green/40 bg-signal-green/5";
    case "Neutral":       return "text-slate-gray border-ink-line bg-ink-deep/40";
    case "Weakening":     return "text-signal-amber border-signal-amber/40 bg-signal-amber/5";
    case "Risk":          return "text-signal-red border-signal-red/40 bg-signal-red/5";
    case "Not available": return "text-slate-gray/60 border-ink-line bg-ink-deep/20";
  }
}

function TechRiskColumn({
  setup, setupState, tech, regime, dist, ticker, currentPrice,
}: {
  setup: ActiveSetupRow | null;
  setupState: SetupState;
  tech: any;
  regime?: any;
  dist: { toEntry: number; toStop: number; toT1: number; toT2: number | null; riskPerShare: number } | null;
  ticker: string;
  currentPrice: number | null;
}) {
  const dayClass = regime?.day_class || "UNKNOWN";

  const rows: { label: string; value: string; state: AlignLabel; note?: string }[] = [];

  const addMARow = (name: "20 SMA" | "50 SMA" | "200 SMA", ma: number | null) => {
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
      note: name === "50 SMA"
        ? (above ? "Intermediate uptrend remains supportive." : "Intermediate trend not supportive for a new long.")
        : name === "200 SMA"
          ? (above ? "Long-term trend alignment is positive." : "Long-term trend is broken.")
          : (above ? "Short-term trend intact." : "Short-term trend has broken."),
    });
  };

  addMARow("20 SMA",  tech?.s20  ?? null);
  addMARow("50 SMA",  tech?.s50  ?? null);
  addMARow("200 SMA", tech?.s200 ?? null);

  if (tech?.slope50 != null) {
    rows.push({
      label: "50 SMA slope",
      value: fmtPct(tech.slope50) + " · 5 bars",
      state: tech.slope50 > 0.2 ? "Supporting" : tech.slope50 < -0.2 ? "Risk" : "Neutral",
    });
  }

  if (tech?.rsi != null) {
    const r = tech.rsi;
    rows.push({
      label: "RSI 14",
      value: r.toFixed(1),
      state: r >= 70 ? "Weakening" : r >= 55 ? "Supporting" : r >= 45 ? "Neutral" : r >= 30 ? "Weakening" : "Risk",
      note: r >= 70 ? "Overbought." : r <= 30 ? "Oversold." : undefined,
    });
  } else {
    rows.push({ label: "RSI 14", value: "Not available", state: "Not available" });
  }

  if (tech?.relVol != null) {
    const rv = tech.relVol;
    rows.push({
      label: "Relative volume",
      value: `${rv.toFixed(2)}× 20-day`,
      state: rv >= 1.3 ? "Supporting" : rv >= 0.8 ? "Neutral" : "Weakening",
    });
  } else {
    rows.push({ label: "Relative volume", value: "Not available", state: "Not available" });
  }

  rows.push({
    label: "Market Regime",
    value: dayClass,
    state: dayClass === "GREEN" ? "Supporting" : dayClass === "YELLOW" ? "Neutral" : dayClass === "RED" ? "Risk" : "Not available",
    note: regime?.reason,
  });

  // Risk state
  const riskState: { level: "Normal" | "Caution" | "Elevated" | "Avoid" | "Unknown"; msg: string } = (() => {
    if (dayClass === "RED") return { level: "Avoid", msg: "Capital Protection active — do not open new risk." };
    if (!setup) return { level: "Unknown", msg: "No setup — nothing to size." };
    if (setupState === "INVALIDATED") return { level: "Avoid", msg: "Stop violated. Stand down and reassess." };
    if (setupState === "ACTIVE" && dist) {
      if (dist.toT1 <= 1 && dist.toT1 >= -1) return { level: "Caution", msg: "Approaching T1 — follow management plan." };
      if (dist.toStop < 1) return { level: "Elevated", msg: "Price near stop — tight risk." };
      if (tech?.s20 && currentPrice != null && ((currentPrice - tech.s20) / tech.s20) * 100 > 8) {
        return { level: "Caution", msg: "Extended from 20-SMA — avoid chasing." };
      }
      return { level: "Normal", msg: "Price above stop, not extended." };
    }
    if (setupState === "WAITING FOR TRIGGER") return { level: "Normal", msg: "No open risk yet — trigger not reached." };
    if (dayClass === "YELLOW") return { level: "Caution", msg: "Regime YELLOW — half size on any new entry." };
    return { level: "Normal", msg: "Standard risk conditions." };
  })();

  const riskColor: Record<typeof riskState.level, string> = {
    Normal:   "text-signal-green border-signal-green/40 bg-signal-green/5",
    Caution:  "text-signal-amber border-signal-amber/40 bg-signal-amber/5",
    Elevated: "text-signal-amber border-signal-amber/40 bg-signal-amber/5",
    Avoid:    "text-signal-red border-signal-red/40 bg-signal-red/5",
    Unknown:  "text-slate-gray border-ink-line bg-ink-deep/40",
  };

  return (
    <div className="min-w-0 space-y-2.5" data-testid="col-tech-risk">
      <ColumnHeader icon={<Activity className="w-3 h-3" />} label="Technical + Risk" />

      <div className="rounded border border-ink-line bg-ink-deep/40 p-2 space-y-1.5">
        <div className="text-[9px] font-mono uppercase tracking-wider text-slate-gray px-1">Alignment</div>
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2 px-1">
            <div className="text-[10px] font-mono text-slate-gray min-w-[92px] uppercase tracking-wider">{r.label}</div>
            <div className="text-[11px] text-soft-white tabular-nums flex-1 min-w-0">{r.value}</div>
            <div className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border ${labelColor(r.state)}`}>
              {r.state}
            </div>
          </div>
        ))}
      </div>

      <div className={`rounded border p-3 ${riskColor[riskState.level]}`}>
        <div className="flex items-center gap-1.5 mb-1">
          <BarChart3 className="w-3 h-3" />
          <span className="text-[10px] font-mono uppercase tracking-wider">Risk Check · {riskState.level}</span>
        </div>
        <div className="text-[11px] leading-snug text-soft-white">{riskState.msg}</div>
        {setup && dist && (
          <div className="mt-2 grid grid-cols-2 gap-1 text-[10px] font-mono text-slate-gray">
            <div>To Stop: <span className="text-soft-white tabular-nums">{fmtPct(dist.toStop)}</span></div>
            <div>To T1: <span className="text-soft-white tabular-nums">{fmtPct(dist.toT1)}</span></div>
            {dist.toT2 != null && (
              <div>To T2: <span className="text-soft-white tabular-nums">{fmtPct(dist.toT2)}</span></div>
            )}
            <div>Risk/share: <span className="text-soft-white tabular-nums">{fmtDollar(dist.riskPerShare)}</span></div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Small shared UI ─────────────────────────────────────────────────────────
function ColumnHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 px-1">
      <span className="text-neon-blue">{icon}</span>
      <span className="text-[10px] font-mono uppercase tracking-wider text-soft-white">{label}</span>
    </div>
  );
}
