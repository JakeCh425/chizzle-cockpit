// ─── Active Setups Strip ────────────────────────────────────────────────────
// Sticky at the top of the cockpit. Aggregates live monitors and prints small
// "trade-ready" cards for any setup that's either firing (READY) or one step
// away (WARNING). Hidden entirely when no active setups exist.
//
// Sources merged:
//   GET /api/bull-bar-monitor/scan?symbols=...&mode=...&rr=...&offband=...
//   GET /api/smh-hammer-monitor?mode=...&rr=...
//   GET /api/multi-pattern-monitor?timeframe=1h&mode=...&rr=...&symbols=...
//   GET /api/continuation-monitor?timeframe=4h&rr=...&symbols=...
//
// Each card renders: ticker · source · phase · tier · entry / stop / target ·
// shares · R$. READY cards get a teal solid border + pulsing dot. WARNING
// cards get a dashed amber border + slow pulse.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { apiRequest } from "@/lib/queryClient";
import { sharesForPlan, useSharesContext } from "@/lib/useShares";
import { formatShares } from "@/lib/engine";
import { buildPlannerHref } from "@/lib/planLink";
import { ChevronDown, ChevronUp, Zap } from "lucide-react";

const DEFAULT_SYMBOLS = "SMH,QQQ,SPY,AAPL";

// ─── Common card shape ─────────────────────────────────────────────────────
type CardStatus = "READY" | "WARNING";
type Tier = "A+" | "RULES-LOOSENED" | "REJECTED" | null;

interface ActiveCard {
  key: string;
  source: string;        // short label: "Bull Bar" | "SMH Hammer" | "Multi-Pattern" | "Continuation"
  symbol: string;
  status: CardStatus;
  phase: string;         // human-readable phase from the underlying monitor
  tier: Tier;
  entry: number | null;
  stop: number | null;
  target: number | null;
  rr: number | null;
  riskPerShare: number | null;
  setupType?: string | null;
  mode?: string | null;
  plannerHref?: string;
}

// ─── Phase → status classifier ─────────────────────────────────────────────
// READY  = signal fully fired, ready to enter on next bar
// WARN   = forming or confirmed-but-not-yet-triggered
// HIDE   = scanning, expired, invalidated
function classifyStatus(phase: string): CardStatus | null {
  const p = phase.toLowerCase();
  // Ready states across all monitors
  if (
    p === "ready to trade" ||
    p === "breakout confirmed" ||
    p === "confirmed bullish hammer" ||
    p === "confirmed bullish engulfing" ||
    p === "confirmed strong bull bar" ||
    p === "confirmed aggressive bounce"
  )
    return "READY";
  // Warning / forming states
  if (
    p === "confirmed bull bar" ||
    p === "hammer confirmed" ||
    p === "hammer forming" ||
    p === "bull bar forming" ||
    p.endsWith(" forming") ||
    p.startsWith("confirmed ")
  )
    return "WARNING";
  return null;
}

// ─── Tier classifier (mirrors SmhHammerMonitor.classifyTier) ───────────────
function classifyTier(opts: {
  phase: string;
  mode?: string | null;
  setupType?: string | null;
}): Tier {
  const phase = opts.phase.toLowerCase();
  if (phase === "invalidated") return "REJECTED";
  const mode = (opts.mode ?? "").toLowerCase();
  const isReady =
    phase === "breakout confirmed" ||
    phase === "ready to trade" ||
    phase.startsWith("confirmed ");
  if (!isReady) return null;
  if (mode === "conservative" && opts.setupType !== "post_decline_hammer") return "A+";
  return "RULES-LOOSENED";
}

const tierStyles: Record<Exclude<Tier, null>, string> = {
  "A+": "border-signal-green/60 bg-signal-green/20 text-signal-green font-bold",
  "RULES-LOOSENED": "border-signal-amber/60 bg-signal-amber/15 text-signal-amber font-semibold",
  REJECTED: "border-signal-red/60 bg-signal-red/15 text-signal-red font-semibold",
};

// ─── Per-source response shapes (minimal subset used here) ─────────────────
interface TradePlanish {
  entry: number;
  stop_loss: number;
  target: number;
  risk_reward?: number;
  risk_per_share?: number;
}

interface BullBarItem {
  symbol: string;
  phase: string;
  mode?: string;
  setup_kind?: string | null;
  trade_plan: TradePlanish | null;
}

interface SmhItem {
  symbol: string;
  phase: string;
  mode?: string;
  setup_type?: string;
  trade_plan: TradePlanish | null;
}

interface MultiPatternItem {
  symbol: string;
  pattern_status: string;
  mode?: string;
  trade_plan: TradePlanish | null;
}

interface ContinuationItem {
  symbol: string;
  status: string;
  trade_plan: TradePlanish | null;
}

// Persistent-state defaults pulled from the existing monitors so the strip
// reflects what the user has already chosen elsewhere.
function useStripInputs() {
  // Bull Bar persisted opts
  const [bbMode] = usePersistentState<"conservative" | "aggressive">("bullbar-mode", "aggressive");
  const [bbRr] = usePersistentState<number>("bullbar-rr", 2);
  const [bbOffBand] = usePersistentState<boolean>("bullbar-offband", true);
  // SMH Hammer persisted opts
  const [smhMode] = usePersistentState<"conservative" | "aggressive">("smh-hammer-mode", "aggressive");
  const [smhRr] = usePersistentState<number>("smh-hammer-rr", 2);
  // Multi-pattern persisted opts
  const [mpTf] = usePersistentState<"1h" | "4h">("multipattern-tf", "1h");
  const [mpMode] = usePersistentState<"conservative" | "aggressive">("multipattern-mode", "conservative");
  const [mpRr] = usePersistentState<number>("multipattern-rr", 2);
  // Continuation persisted opts
  const [ctTf] = usePersistentState<"1h" | "4h">("continuation-tf", "4h");
  const [ctRr] = usePersistentState<number>("continuation-rr", 2);
  return { bbMode, bbRr, bbOffBand, smhMode, smhRr, mpTf, mpMode, mpRr, ctTf, ctRr };
}

export default function ActiveSetupsStrip() {
  const [collapsed, setCollapsed] = usePersistentState<boolean>("cockpit-active-strip-collapsed", false);
  const sharesCtx = useSharesContext();
  const opts = useStripInputs();

  // Bull-Bar scan endpoint covers all watchlist symbols in one shot
  const bullBarQ = useQuery<BullBarItem[]>({
    queryKey: ["/api/bull-bar-monitor/scan", DEFAULT_SYMBOLS, opts.bbMode, opts.bbRr, opts.bbOffBand],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/bull-bar-monitor/scan?symbols=${DEFAULT_SYMBOLS}&mode=${opts.bbMode}&rr=${opts.bbRr}&offband=${opts.bbOffBand}`,
      ).then((r) => r.json()),
    refetchInterval: 60_000,
  });

  // SMH-only hammer monitor
  const smhQ = useQuery<SmhItem>({
    queryKey: ["/api/smh-hammer-monitor", opts.smhMode, opts.smhRr],
    queryFn: () =>
      apiRequest("GET", `/api/smh-hammer-monitor?mode=${opts.smhMode}&rr=${opts.smhRr}`).then((r) => r.json()),
    refetchInterval: 60_000,
  });

  // Multi-pattern across the watchlist
  const multiQ = useQuery<{ symbols: MultiPatternItem[] }>({
    queryKey: ["/api/multi-pattern-monitor", opts.mpTf, opts.mpMode, opts.mpRr],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/multi-pattern-monitor?timeframe=${opts.mpTf}&mode=${opts.mpMode}&rr=${opts.mpRr}&symbols=${encodeURIComponent(DEFAULT_SYMBOLS)}`,
      ).then((r) => r.json()),
    refetchInterval: 90_000,
  });

  // Continuation across the watchlist
  const contQ = useQuery<{ symbols: ContinuationItem[] }>({
    queryKey: ["/api/continuation-monitor", opts.ctTf, opts.ctRr],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/continuation-monitor?timeframe=${opts.ctTf}&rr=${opts.ctRr}&min_risk_pct=0.5&symbols=${encodeURIComponent(DEFAULT_SYMBOLS)}`,
      ).then((r) => r.json()),
    refetchInterval: 90_000,
  });

  const cards: ActiveCard[] = useMemo(() => {
    const out: ActiveCard[] = [];

    // Bull-Bar Monitor → may return array, or { results: [] } depending on endpoint
    const bbList = Array.isArray(bullBarQ.data)
      ? bullBarQ.data
      : (bullBarQ.data as unknown as { results?: BullBarItem[] } | undefined)?.results ?? [];
    for (const it of bbList) {
      const status = classifyStatus(it.phase);
      if (!status || !it.trade_plan) continue;
      out.push({
        key: `bullbar-${it.symbol}-${it.phase}`,
        source: "Bull Bar",
        symbol: it.symbol,
        status,
        phase: it.phase,
        tier: classifyTier({ phase: it.phase, mode: it.mode, setupType: it.setup_kind }),
        entry: it.trade_plan.entry,
        stop: it.trade_plan.stop_loss,
        target: it.trade_plan.target,
        rr: it.trade_plan.risk_reward ?? null,
        riskPerShare: it.trade_plan.risk_per_share ?? null,
        setupType: it.setup_kind ?? null,
        mode: it.mode ?? null,
        plannerHref: buildPlannerHref({
          ticker: it.symbol,
          entry: it.trade_plan.entry,
          stop: it.trade_plan.stop_loss,
          target: it.trade_plan.target,
          setup: "bull-bar",
        }),
      });
    }

    // SMH Hammer Monitor (single symbol)
    const smh = smhQ.data;
    if (smh) {
      const status = classifyStatus(smh.phase);
      if (status && smh.trade_plan) {
        out.push({
          key: `smh-${smh.symbol}-${smh.phase}`,
          source: "SMH Hammer",
          symbol: smh.symbol,
          status,
          phase: smh.phase,
          tier: classifyTier({ phase: smh.phase, mode: smh.mode, setupType: smh.setup_type }),
          entry: smh.trade_plan.entry,
          stop: smh.trade_plan.stop_loss,
          target: smh.trade_plan.target,
          rr: smh.trade_plan.risk_reward ?? null,
          riskPerShare: smh.trade_plan.risk_per_share ?? null,
          setupType: smh.setup_type ?? null,
          mode: smh.mode ?? null,
          plannerHref: buildPlannerHref({
            ticker: smh.symbol,
            entry: smh.trade_plan.entry,
            stop: smh.trade_plan.stop_loss,
            target: smh.trade_plan.target,
            setup: "smh-hammer",
          }),
        });
      }
    }

    // Multi-pattern monitor (array under .symbols)
    for (const it of multiQ.data?.symbols ?? []) {
      const status = classifyStatus(it.pattern_status);
      if (!status || !it.trade_plan) continue;
      out.push({
        key: `multi-${it.symbol}-${it.pattern_status}`,
        source: "Multi-Pattern",
        symbol: it.symbol,
        status,
        phase: it.pattern_status,
        tier: classifyTier({ phase: it.pattern_status, mode: it.mode }),
        entry: it.trade_plan.entry,
        stop: it.trade_plan.stop_loss,
        target: it.trade_plan.target,
        rr: it.trade_plan.risk_reward ?? null,
        riskPerShare: it.trade_plan.risk_per_share ?? null,
        mode: it.mode ?? null,
        plannerHref: buildPlannerHref({
          ticker: it.symbol,
          entry: it.trade_plan.entry,
          stop: it.trade_plan.stop_loss,
          target: it.trade_plan.target,
          setup: "multi-pattern",
        }),
      });
    }

    // Continuation monitor (array under .symbols)
    for (const it of contQ.data?.symbols ?? []) {
      const status = classifyStatus(it.status);
      if (!status || !it.trade_plan) continue;
      out.push({
        key: `cont-${it.symbol}-${it.status}`,
        source: "Continuation",
        symbol: it.symbol,
        status,
        phase: it.status,
        tier: classifyTier({ phase: it.status }),
        entry: it.trade_plan.entry,
        stop: it.trade_plan.stop_loss,
        target: it.trade_plan.target,
        rr: it.trade_plan.risk_reward ?? null,
        riskPerShare: it.trade_plan.risk_per_share ?? null,
        plannerHref: buildPlannerHref({
          ticker: it.symbol,
          entry: it.trade_plan.entry,
          stop: it.trade_plan.stop_loss,
          target: it.trade_plan.target,
          setup: "continuation",
        }),
      });
    }

    // READY first, then WARNING; preserve insertion order within each bucket
    return out.sort((a, b) => {
      if (a.status === b.status) return 0;
      return a.status === "READY" ? -1 : 1;
    });
  }, [bullBarQ.data, smhQ.data, multiQ.data, contQ.data]);

  // Hide entirely when nothing active — never show an empty state
  if (cards.length === 0) return null;

  const readyCount = cards.filter((c) => c.status === "READY").length;
  const warnCount = cards.length - readyCount;

  return (
    <section
      data-testid="active-setups-strip"
      className="sticky top-0 z-30 bg-ink-panel/95 backdrop-blur-md border border-ink-line rounded-sm shadow-lg"
    >
      {/* Header */}
      <header className="px-3.5 py-2 border-b border-ink-line flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="relative inline-flex h-2.5 w-2.5">
            {readyCount > 0 && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-signal-green opacity-75" />
            )}
            <span
              className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                readyCount > 0 ? "bg-signal-green" : "bg-signal-amber animate-pulse"
              }`}
            />
          </span>
          <h2 className="font-display text-[11px] tracking-[0.18em] uppercase text-soft-white">
            Active Setups
          </h2>
          <span className="text-[10px] text-slate-gray font-mono tabular-nums">
            {readyCount > 0 && (
              <span className="text-signal-green">{readyCount} READY</span>
            )}
            {readyCount > 0 && warnCount > 0 && <span className="text-slate-gray"> · </span>}
            {warnCount > 0 && (
              <span className="text-signal-amber">{warnCount} WARNING</span>
            )}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-gray hover:text-soft-white"
          data-testid="button-toggle-active-strip"
          aria-label={collapsed ? "Expand active setups" : "Collapse active setups"}
        >
          {collapsed ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
          <span>{collapsed ? "Show" : "Hide"}</span>
        </button>
      </header>

      {!collapsed && (
        <div className="p-2.5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {cards.map((c) => (
            <ActiveCardView key={c.key} card={c} sharesCtx={sharesCtx} />
          ))}
        </div>
      )}
    </section>
  );
}

function fmt(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

interface CardViewProps {
  card: ActiveCard;
  sharesCtx: ReturnType<typeof useSharesContext>;
}

function ActiveCardView({ card, sharesCtx }: CardViewProps) {
  const shares = sharesForPlan(sharesCtx, card.riskPerShare);
  const riskDollars =
    card.riskPerShare != null && shares > 0
      ? card.riskPerShare * shares
      : sharesCtx.riskDollarsValue;

  const isReady = card.status === "READY";
  const borderCls = isReady
    ? "border-2 border-signal-green/70 bg-signal-green/[0.04]"
    : "border border-dashed border-signal-amber/60 bg-signal-amber/[0.03]";
  const statusDotCls = isReady
    ? "bg-signal-green animate-pulse"
    : "bg-signal-amber animate-pulse [animation-duration:2s]";

  const inner = (
    <div
      data-testid={`card-active-${card.source.toLowerCase().replace(/\s+/g, "-")}-${card.symbol}`}
      className={`rounded-sm px-2.5 py-2 ${borderCls} hover:brightness-110 transition cursor-pointer`}
    >
      {/* Top row: symbol + status badge + tier */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`inline-block w-2 h-2 rounded-full ${statusDotCls}`} />
          <span className="font-display text-[13px] tracking-wide text-soft-white">{card.symbol}</span>
          <span className="text-[9px] uppercase tracking-wider text-slate-gray">{card.source}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {card.tier && (
            <span
              className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${tierStyles[card.tier]}`}
            >
              {card.tier}
            </span>
          )}
          <span
            className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${
              isReady
                ? "border-signal-green/50 text-signal-green bg-signal-green/10"
                : "border-signal-amber/50 text-signal-amber bg-signal-amber/10"
            }`}
          >
            {card.status}
          </span>
        </div>
      </div>

      {/* Phase line */}
      <div className="text-[10px] text-slate-gray mb-1.5 truncate" title={card.phase}>
        {card.phase}
      </div>

      {/* Numbers grid */}
      <div className="grid grid-cols-3 gap-1 text-[10px] font-mono tabular-nums">
        <div className="flex flex-col">
          <span className="text-[9px] text-slate-gray uppercase tracking-wider">Entry</span>
          <span className="text-soft-white">${fmt(card.entry)}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[9px] text-slate-gray uppercase tracking-wider">Stop</span>
          <span className="text-signal-red">${fmt(card.stop)}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[9px] text-slate-gray uppercase tracking-wider">Target</span>
          <span className="text-signal-green">${fmt(card.target)}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[9px] text-slate-gray uppercase tracking-wider">Shares</span>
          <span className="text-soft-white">{shares > 0 ? formatShares(shares) : "—"}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[9px] text-slate-gray uppercase tracking-wider">Risk $</span>
          <span className="text-soft-white">${riskDollars.toFixed(0)}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[9px] text-slate-gray uppercase tracking-wider">R:R</span>
          <span className="text-soft-white">1:{fmt(card.rr, 1)}</span>
        </div>
      </div>

      {isReady && (
        <div className="mt-1.5 pt-1.5 border-t border-signal-green/20 flex items-center gap-1.5">
          <Zap className="w-3 h-3 text-signal-green" />
          <span className="text-[9px] uppercase tracking-wider text-signal-green font-semibold">
            Fire-ready · click to plan
          </span>
        </div>
      )}
    </div>
  );

  if (card.plannerHref) {
    return <Link href={card.plannerHref}>{inner}</Link>;
  }
  return inner;
}
