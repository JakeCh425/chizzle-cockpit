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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { apiRequest } from "@/lib/queryClient";
import { sharesForPlan, useSharesContext } from "@/lib/useShares";
import { formatShares } from "@/lib/engine";
import { buildPlannerHref } from "@/lib/planLink";
import { ChevronDown, ChevronUp, Zap, RefreshCw, Info } from "lucide-react";

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
  // Reject states — explicitly hide from strip
  if (p === "invalidated" || p === "expired" || p === "rejected" || p === "scanning" || p === "") {
    return null;
  }
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
// Beginner-friendly explainer for each phase + source.
function phasePlainEnglish(phase: string, source: string): string {
  const p = phase.toLowerCase();
  if (p === "ready to trade") return "Buy at entry if price reaches it";
  if (p === "breakout confirmed") return "Breakout fired — enter on the next push above entry";
  if (p === "hammer confirmed") return "Bounce candle confirmed — fire on next bar";
  if (p === "hammer forming") return "Bounce candle building — not safe yet, wait for close";
  if (p === "confirmed bull bar") return "Strong up bar printed — wait for breakout above its high";
  if (p === "bull bar forming") return "Up bar building — still inside the bar";
  if (p.endsWith(" forming")) return "Pattern forming — still developing, not actionable";
  if (p.startsWith("confirmed ")) {
    if (source === "Continuation") return "Trend pullback confirmed — ride the next push";
    return "Pattern confirmed — watch for trigger price";
  }
  return phase;
}

function sourceExplanation(source: string): string {
  if (source === "Bull Bar") return "Momentum: strong green candle setup";
  if (source === "SMH Hammer") return "Reversal: bounce off support on SMH";
  if (source === "Multi-Pattern") return "Hybrid: multiple candle signals combined";
  if (source === "Continuation") return "Trend-follow: buy-the-dip inside uptrend";
  return source;
}

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
  const qc = useQueryClient();

  // Shared query config — force fresh reads every poll so entry/stop/target reflect
  // the latest intraday bars from the monitor endpoints.
  const freshOpts = { staleTime: 0, refetchOnWindowFocus: true } as const;

  // Bull-Bar scan endpoint covers all watchlist symbols in one shot
  const bullBarQ = useQuery<BullBarItem[]>({
    queryKey: ["/api/bull-bar-monitor/scan", DEFAULT_SYMBOLS, opts.bbMode, opts.bbRr, opts.bbOffBand],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/bull-bar-monitor/scan?symbols=${DEFAULT_SYMBOLS}&mode=${opts.bbMode}&rr=${opts.bbRr}&offband=${opts.bbOffBand}`,
      ).then((r) => r.json()),
    refetchInterval: 30_000,
    ...freshOpts,
  });

  // SMH-only hammer monitor
  const smhQ = useQuery<SmhItem>({
    queryKey: ["/api/smh-hammer-monitor", opts.smhMode, opts.smhRr],
    queryFn: () =>
      apiRequest("GET", `/api/smh-hammer-monitor?mode=${opts.smhMode}&rr=${opts.smhRr}`).then((r) => r.json()),
    refetchInterval: 30_000,
    ...freshOpts,
  });

  // Multi-pattern across the watchlist
  const multiQ = useQuery<{ symbols: MultiPatternItem[] }>({
    queryKey: ["/api/multi-pattern-monitor", opts.mpTf, opts.mpMode, opts.mpRr],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/multi-pattern-monitor?timeframe=${opts.mpTf}&mode=${opts.mpMode}&rr=${opts.mpRr}&symbols=${encodeURIComponent(DEFAULT_SYMBOLS)}`,
      ).then((r) => r.json()),
    refetchInterval: 45_000,
    ...freshOpts,
  });

  // Continuation across the watchlist
  const contQ = useQuery<{ symbols: ContinuationItem[] }>({
    queryKey: ["/api/continuation-monitor", opts.ctTf, opts.ctRr],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/continuation-monitor?timeframe=${opts.ctTf}&rr=${opts.ctRr}&min_risk_pct=0.5&symbols=${encodeURIComponent(DEFAULT_SYMBOLS)}`,
      ).then((r) => r.json()),
    refetchInterval: 45_000,
    ...freshOpts,
  });

  // Live last-price snapshot (cheap server-side cache, no third-party hit)
  // Used to show "now: $X" and "% to entry" on every card.
  const pricesQ = useQuery<Record<string, { last?: number; close?: number; price?: number }>>({
    queryKey: ["/api/prices"],
    queryFn: () => apiRequest("GET", "/api/prices").then((r) => r.json()),
    refetchInterval: 10_000, // poll prices every 10s for live feel
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  // Manual refresh — nukes the React-Query cache for every monitor + prices
  // so the user can pull fresh entry/stop/target on demand.
  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["/api/bull-bar-monitor/scan"] });
    qc.invalidateQueries({ queryKey: ["/api/smh-hammer-monitor"] });
    qc.invalidateQueries({ queryKey: ["/api/multi-pattern-monitor"] });
    qc.invalidateQueries({ queryKey: ["/api/continuation-monitor"] });
    qc.invalidateQueries({ queryKey: ["/api/prices"] });
  };

  const lastUpdated = useMemo(() => {
    const ts = [
      bullBarQ.dataUpdatedAt,
      smhQ.dataUpdatedAt,
      multiQ.dataUpdatedAt,
      contQ.dataUpdatedAt,
    ].filter((n) => n > 0);
    return ts.length === 0 ? 0 : Math.max(...ts);
  }, [bullBarQ.dataUpdatedAt, smhQ.dataUpdatedAt, multiQ.dataUpdatedAt, contQ.dataUpdatedAt]);

  const isFetching = bullBarQ.isFetching || smhQ.isFetching || multiQ.isFetching || contQ.isFetching;

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

    // Drop REJECTED tier rows entirely — they don't belong in an "active" strip.
    const live = out.filter((c) => c.tier !== "REJECTED");

    // READY first, then WARNING; preserve insertion order within each bucket
    return live.sort((a, b) => {
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
        <div className="flex items-center gap-3">
          <span
            className="text-[9px] uppercase tracking-wider text-slate-gray font-mono tabular-nums hidden sm:inline"
            title="Time the monitor data was last fetched. Click refresh for fresh entry/stop/target."
          >
            {lastUpdated > 0
              ? `updated ${new Date(lastUpdated).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}`
              : "—"}
          </span>
          <button
            type="button"
            onClick={refreshAll}
            disabled={isFetching}
            className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-gray hover:text-soft-white disabled:opacity-50"
            data-testid="button-refresh-active-strip"
            aria-label="Refresh entry, stop, and target prices"
            title="Pull fresh entry, stop, target, and live price"
          >
            <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
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
        </div>
      </header>

      {!collapsed && (
        <>
          {/* Beginner help line — visible on every render of the strip */}
          <div className="px-3.5 py-1.5 border-b border-ink-line bg-ink-panel/60 flex items-center gap-2 text-[10px] text-slate-gray">
            <Info className="w-3 h-3 shrink-0" />
            <span>
              <span className="text-signal-green">READY</span> = setup is firing, you can enter at the listed price.{" "}
              <span className="text-signal-amber">WARNING</span> = setup is forming, wait for confirmation.{" "}
              <span className="text-soft-white">Now</span> shows live price — the % is how far it is from entry.
            </span>
          </div>
          <div className="p-2.5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {cards.map((c) => (
              <ActiveCardView
                key={c.key}
                card={c}
                sharesCtx={sharesCtx}
                livePrice={
                  pricesQ.data?.[c.symbol]?.last ??
                  pricesQ.data?.[c.symbol]?.price ??
                  pricesQ.data?.[c.symbol]?.close ??
                  null
                }
              />
            ))}
          </div>
        </>
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
  livePrice: number | null;
}

function ActiveCardView({ card, sharesCtx, livePrice }: CardViewProps) {
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

      {/* Plain-English explainer (beginner-friendly) */}
      <div className="mb-1.5">
        <div
          className="text-[10px] text-soft-white/90 leading-tight"
          title={`Raw phase: ${card.phase}`}
        >
          {phasePlainEnglish(card.phase, card.source)}
        </div>
        <div className="text-[9px] text-slate-gray italic mt-0.5">
          {sourceExplanation(card.source)}
        </div>
      </div>

      {/* Live price + distance to entry */}
      {livePrice != null && card.entry != null && (
        <div className="flex items-center justify-between gap-2 mb-1.5 px-1.5 py-1 rounded-sm bg-ink-line/40 border border-ink-line/60">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] uppercase tracking-wider text-slate-gray">Now</span>
            <span className="font-mono tabular-nums text-[11px] text-soft-white font-semibold">
              ${livePrice.toFixed(2)}
            </span>
          </div>
          <DistanceToEntry livePrice={livePrice} entry={card.entry} />
        </div>
      )}

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

// ─── % distance from live price to entry ───────────────────────────────
function DistanceToEntry({ livePrice, entry }: { livePrice: number; entry: number }) {
  if (entry <= 0) return null;
  const diff = livePrice - entry;
  const pct = (diff / entry) * 100;
  const abovePending = pct >= 0; // price already above entry
  const cls = abovePending
    ? "text-signal-green"
    : Math.abs(pct) < 0.5
    ? "text-signal-amber"
    : "text-slate-gray";
  const sign = abovePending ? "+" : "";
  const label = abovePending
    ? "at/above entry"
    : Math.abs(pct) < 0.5
    ? "near entry"
    : "to entry";
  return (
    <span className="flex items-center gap-1 text-[10px] font-mono tabular-nums">
      <span className={cls}>
        {sign}
        {pct.toFixed(2)}%
      </span>
      <span className="text-[9px] text-slate-gray uppercase tracking-wider">{label}</span>
    </span>
  );
}
