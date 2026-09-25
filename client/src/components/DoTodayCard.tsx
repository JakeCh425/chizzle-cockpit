// ─── DoTodayCard ──────────────────────────────────────────────────────────
// One plain-English sentence answering "What should I do today?" derived
// entirely from existing regime-v2 output + flex-scan counts. No new signals
// are invented — this is a translation layer over rules we already publish.
//
// Read order of authority (highest wins):
//   1. regime day_class = RED       -> capital protection, stand down
//   2. flex-scan day_type STAND_DOWN-> stand down
//   3. regime YELLOW + no STANDARD  -> highest-quality only, half size
//   4. STANDARD_READY count > 0     -> take the best; standard size
//   5. FLEX_READY count > 0         -> half size, best only
//   6. FLEX_WATCH count > 0         -> alerts only, don't front-run
//   7. otherwise                    -> quiet day, no new risk

import { useQuery } from "@tanstack/react-query";
import { Compass, ChevronDown, ChevronUp, LineChart, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { usePanelCollapsed } from "@/components/CollapsibleSection";
import { stopLimitFor } from "@/components/swing/TradeTicket";
import type { FlexScanResult } from "@shared/flexScanTypes";

type Band = "GREEN" | "YELLOW" | "RED" | "UNKNOWN";
interface RegimeSnap {
  day_class: Band;
  reason?: string;
  vix?: { last: number | null };
}

interface Verdict {
  tone: "green" | "amber" | "red" | "blue" | "gray";
  headline: string;
  detail: string;
}

function pickVerdict(regime: RegimeSnap | undefined, scan: FlexScanResult | undefined): Verdict {
  const band: Band = regime?.day_class ?? "UNKNOWN";
  const cards = scan?.cards ?? [];
  const readyCount = cards.filter((c) => c.state === "STANDARD_READY").length;
  const flexReadyCount = cards.filter((c) => c.state === "FLEX_READY").length;
  const watchCount = cards.filter((c) => c.state === "FLEX_WATCH").length;
  const dayType = scan?.day_type;

  if (band === "RED" || dayType === "STAND_DOWN_DAY") {
    return {
      tone: "red",
      headline: "Stand down — capital protection",
      detail:
        "Regime is RED. No new long risk today. Manage existing positions to plan; do not add.",
    };
  }
  if (band === "YELLOW" && readyCount === 0) {
    return {
      tone: "amber",
      headline: "Highest-quality only, half size",
      detail:
        "Mixed regime — focus on the strongest setup, take half size, and skip anything extended.",
    };
  }
  const readyNames = cards.filter((c) => c.state === "STANDARD_READY" || c.state === "FLEX_READY").map((c) => c.ticker);
  if (readyNames.length > 0 && cards.some((c: any) => c.unified)) {
    return {
      tone: "green",
      headline: `${readyNames.join(", ")} ${readyNames.length === 1 ? "is" : "are"} ready — practice plan below`,
      detail:
        "The swing engine lines up on trend, structure and a closed 1H trigger. Review the plan card, then open the chart to check it yourself.",
    };
  }
  if (readyCount > 0) {
    return {
      tone: "green",
      headline: `${readyCount} STANDARD READY — take the best`,
      detail:
        "Trend, structure, and volume line up. Enter the top-graded setup at listed trigger and stop.",
    };
  }
  if (flexReadyCount > 0) {
    return {
      tone: "green",
      headline: `${flexReadyCount} FLEX READY — half size on best`,
      detail:
        "One factor is soft. Take half size only, and confirm the trigger bar closes before entering.",
    };
  }
  if (watchCount > 0) {
    return {
      tone: "blue",
      headline: `${watchCount} on watch — alerts only`,
      detail:
        "Patterns forming. Set trigger alerts; don't front-run. Wait for the setup to arm.",
    };
  }
  return {
    tone: "gray",
    headline: "Quiet day — no qualifying setups",
    detail:
      "No qualifying long setups right now. Continue watching regime, breadth, and volume — no new risk.",
  };
}

const TONE_STYLES: Record<Verdict["tone"], { border: string; bg: string; text: string; chip: string }> = {
  green: { border: "border-signal-green/40", bg: "bg-signal-green/8", text: "text-signal-green", chip: "bg-signal-green/15" },
  amber: { border: "border-signal-amber/40", bg: "bg-signal-amber/8", text: "text-signal-amber", chip: "bg-signal-amber/15" },
  red:   { border: "border-signal-red/40",   bg: "bg-signal-red/8",   text: "text-signal-red",   chip: "bg-signal-red/15" },
  blue:  { border: "border-neon-blue/40",    bg: "bg-neon-blue/8",    text: "text-neon-blue",    chip: "bg-neon-blue/15" },
  gray:  { border: "border-ink-line",        bg: "bg-ink-panel/40",   text: "text-slate-gray",   chip: "bg-ink-line" },
};

const money = (n: number | null | undefined) => (n == null || !isFinite(n) ? "—" : `$${n.toFixed(2)}`);

/** Ask the Unified Swing Engine workspace to focus a ticker (adds it to the watchlist first if needed). */
async function openChart(sym: string) {
  try {
    const wl: any = queryClient.getQueryData(["/api/swing/watchlist"]) ?? (await (await apiRequest("GET", "/api/swing/watchlist")).json());
    const have = (wl?.items ?? []).some((x: any) => x.symbol === sym);
    if (!have) {
      await apiRequest("POST", "/api/swing/watchlist", { symbol: sym });
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").startsWith("/api/swing") });
    }
  } catch { /* still try to focus */ }
  window.dispatchEvent(new CustomEvent("chizzle:focus-symbol", { detail: sym }));
}

// Trade-type ladder, driven by the engine's card grade. Beginner wording; sizes are practice guides only.
const TRADE_TYPES = [
  { id: "A4_CORE", name: "Core trade", size: 1, meaning: "Strongest setup — everything lines up. Normal practice size." },
  { id: "A3_SWING", name: "Standard trade", size: 1, meaning: "Solid swing setup. Normal practice size." },
  { id: "A2_PRACTICE", name: "Practice trade", size: 0.5, meaning: "Valid but one thing is soft. Half size to learn from it." },
  { id: "WATCH", name: "Watch only", size: 0, meaning: "Not ready yet. Set an alert, don't buy." },
  { id: "NO_TRADE", name: "No trade", size: 0, meaning: "Nothing to do here today." },
] as const;
function tradeTypeFor(c: any) {
  const g = c.unified?.grade;
  const hit = TRADE_TYPES.find((t) => t.id === g);
  if (hit && !(hit.size === 0 && (c.state === "STANDARD_READY" || c.state === "FLEX_READY"))) return hit;
  return c.state === "STANDARD_READY" ? TRADE_TYPES[1] : c.state === "FLEX_READY" ? TRADE_TYPES[2] : c.state === "FLEX_WATCH" ? TRADE_TYPES[3] : TRADE_TYPES[4];
}

function TradeTypeLadder({ c }: { c: any }) {
  const cur = tradeTypeFor(c);
  return (
    <div className="space-y-1" data-testid={`ladder-trade-type-${c.ticker}`}>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[9.5px] uppercase tracking-wider text-slate-gray mr-1">Trade type</span>
        {TRADE_TYPES.map((t) => {
          const on = t.id === cur.id;
          return (
            <span
              key={t.id}
              title={t.meaning}
              className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${on ? (t.size ? "border-signal-green bg-signal-green/20 text-signal-green font-bold" : "border-neon-blue bg-neon-blue/15 text-neon-blue font-bold") : "border-ink-line text-slate-gray/70"}`}
              data-testid={`chip-trade-type-${t.id}-${c.ticker}`}
              aria-current={on ? "true" : undefined}
            >
              {on ? "● " : ""}{t.name}
            </span>
          );
        })}
      </div>
      <div className="text-[10.5px] text-soft-white/85" data-testid={`text-trade-type-${c.ticker}`}>
        <span className={`font-semibold ${cur.size ? "text-signal-green" : "text-neon-blue"}`}>{cur.name}:</span> {cur.meaning}
      </div>
    </div>
  );
}

function ReadyPlanCard({ c, maxRisk }: { c: any; maxRisk: number | null }) {
  const [busy, setBusy] = useState(false);
  const entry: number | null = c.entry_zone?.high ?? null;
  const stop: number | null = c.stop?.price ?? null;
  const lmt = stopLimitFor(stop);
  const risk = entry != null && stop != null ? entry - stop : null;
  const tt = tradeTypeFor(c);
  const sizeRisk = maxRisk ? maxRisk * (tt.size || 1) : null;
  const isWatch = tt.size === 0;
  const shares = !isWatch && risk && risk > 0 && sizeRisk ? Math.floor(sizeRisk / risk) : null;
  const pct = (t: number | null | undefined) => (t != null && entry ? `+${(((t - entry) / entry) * 100).toFixed(1)}%` : "");
  const ext = c.extension?.tier && c.extension.tier !== "none" && c.extension.tier !== "normal" ? c.extension : null;
  const cells = [
    { k: "Entry", v: money(entry), sub: "buy only after a closed 1H candle above this", cls: "border-signal-green/40 text-signal-green" },
    { k: "Stop loss", v: money(stop), sub: risk != null ? `risk ${money(risk)} / share` : "", cls: "border-signal-red/40 text-signal-red" },
    { k: "Stop limit", v: money(lmt), sub: "lowest sell price if the stop triggers", cls: "border-signal-red/30 text-rose-600 dark:text-rose-300" },
    { k: "Target 1", v: money(c.target_1?.price), sub: `${pct(c.target_1?.price)} · ${c.target_1?.r_multiple ?? "—"}R · take some profit`, cls: "border-neon-blue/40 text-neon-blue" },
    { k: "Target 2", v: money(c.target_2?.price), sub: `${pct(c.target_2?.price)} · ${c.target_2?.r_multiple ?? "—"}R · let the rest run`, cls: "border-purple-400/40 text-purple-600 dark:text-purple-300" },
  ];
  return (
    <div className={`rounded border ${isWatch ? "border-neon-blue/40" : "border-signal-green/40"} bg-ink-deep/60 p-2.5 space-y-2`} data-testid={`card-today-plan-${c.ticker}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-base font-bold text-soft-white" data-testid={`text-today-ticker-${c.ticker}`}>{c.ticker}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${isWatch ? "bg-neon-blue/15 text-neon-blue" : "bg-signal-green/15 text-signal-green"}`}>{c.unified?.label ?? "Ready"}</span>
        {c.unified?.setupType && <span className="text-[10px] font-mono text-slate-gray">{String(c.unified.setupType).replace(/_/g, " ")}</span>}
        <span className="ml-auto text-[10.5px] font-mono text-slate-gray">
          {isWatch ? "alert only — no shares yet" : shares != null ? `≈ ${shares} share${shares === 1 ? "" : "s"} at ${money(sizeRisk)} risk${tt.size === 0.5 ? " (half size)" : ""}` : ""}
        </span>
        <button
          className="inline-flex items-center gap-1 rounded border border-neon-blue/50 px-2 py-0.5 text-[11px] text-neon-blue hover:bg-neon-blue/10 disabled:opacity-50"
          disabled={busy}
          onClick={async () => { setBusy(true); await openChart(c.ticker); setBusy(false); }}
          data-testid={`button-open-chart-${c.ticker}`}
        >
          <LineChart className="h-3 w-3" /> {busy ? "Opening…" : "Open chart"}
        </button>
      </div>
      <TradeTypeLadder c={c} />
      <div className="grid gap-1.5 grid-cols-2 sm:grid-cols-5">
        {cells.map((x) => (
          <div key={x.k} className={`rounded border ${x.cls.split(" ")[0]} bg-ink-panel/40 px-2 py-1.5`} data-testid={`cell-today-${x.k.replace(/\s/g, "-").toLowerCase()}-${c.ticker}`}>
            <div className={`text-[9.5px] uppercase tracking-wider ${x.cls.split(" ").slice(1).join(" ")}`}>{x.k}</div>
            <div className="font-mono text-sm font-bold text-soft-white">{x.v}</div>
            <div className="text-[9.5px] text-slate-gray leading-tight">{x.sub}</div>
          </div>
        ))}
      </div>
      <div className="text-[11px] text-soft-white/85 leading-snug">
        <span className="text-slate-gray">How to read it: </span>
        {isWatch ? "Not a trade yet — set an alert near the entry. If it turns Ready, the plan would be: " : ""}wait for a 1H candle to close above {money(entry)}. If price falls to {money(stop)} the plan is wrong — the stop sells, and the limit {money(lmt)} is the lowest price it will accept. Sell part at {money(c.target_1?.price)} and the rest at {money(c.target_2?.price)}.
      </div>
      {ext && (
        <div className="flex items-start gap-1.5 rounded border border-signal-amber/40 bg-signal-amber/5 px-2 py-1 text-[10.5px] text-signal-amber" data-testid={`warn-extended-${c.ticker}`}>
          <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
          <span>Heads up: price is stretched ({c.extension.pct_distance?.toFixed?.(1)}% above the 20-SMA). Chasing stretched moves is riskier — a pullback toward the 20-SMA is a calmer entry.</span>
        </div>
      )}
      <div className="text-[9.5px] font-mono text-slate-gray">PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE · OVERNIGHT GAP RISK — STOP ORDERS CAN FILL BELOW STOP PRICE.</div>
    </div>
  );
}

export default function DoTodayCard() {
  const regimeQ = useQuery<RegimeSnap>({
    queryKey: ["/api/regime-v2"],
    refetchInterval: 60_000,
  });
  const scanQ = useQuery<FlexScanResult>({
    queryKey: ["/api/flex-scan-cached"],
    queryFn: async () => {
      // Use the same POST endpoint the scanner uses. Empty universe = defaults.
      const res = await apiRequest("POST", "/api/flex-scan", { include_tech_concentrated: true });
      return await res.json();
    },
    staleTime: 60_000,
    // While the engine is still warming up some tickers, check back quickly so a READY plan shows up fast.
    refetchInterval: (q) => ((q.state.data as any)?.cards ?? []).some((c: any) => c.unified?.pending) ? 15_000 : 5 * 60_000,
  });
  const pendingCount = ((scanQ.data as any)?.cards ?? []).filter((c: any) => c.unified?.pending).length;

  const settingsQ = useQuery<{ maxDollarRisk?: number }>({
    queryKey: ["/api/swing/settings"],
    queryFn: async () => (await apiRequest("GET", "/api/swing/settings")).json(),
    staleTime: 60_000,
  });
  const { collapsed, toggle } = usePanelCollapsed("do-today-plan", false);

  const v = pickVerdict(regimeQ.data, scanQ.data);
  const style = TONE_STYLES[v.tone];
  const allCards: any[] = scanQ.data?.cards ?? [];
  const readyOnly = allCards.filter((c: any) => c.unified && (c.state === "STANDARD_READY" || c.state === "FLEX_READY"));
  // Nothing ready? Show the closest watch setups (with levels) so a beginner sees what to set alerts on.
  const watchRank = (c: any) => (c.unified?.status === "SETUP_CONFIRMED" ? 0 : 1);
  const closest = allCards
    .filter((c: any) => c.unified && !c.unified.pending && c.state === "FLEX_WATCH" && c.entry_zone?.high != null && c.stop?.price != null)
    .sort((a: any, b: any) => watchRank(a) - watchRank(b) || (b.readiness_score ?? 0) - (a.readiness_score ?? 0))
    .slice(0, 3);
  const ready = readyOnly.length ? readyOnly : closest;
  const watchMode = readyOnly.length === 0 && closest.length > 0;

  return (
    <div
      className={`rounded-md border ${style.border} ${style.bg} p-3.5 flex items-start gap-3`}
      data-testid="card-do-today"
    >
      <div className={`rounded-md ${style.chip} p-2 flex-shrink-0`}>
        <Compass className={`h-4 w-4 ${style.text}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-slate-gray">What should I do today?</span>
          <span className={`text-[13px] font-bold ${style.text}`} data-testid="text-do-today-headline">
            {v.headline}
          </span>
        </div>
        <div className="text-[11.5px] text-soft-white/90 leading-snug mt-1">{v.detail}</div>
        {pendingCount > 0 && (
          <div className="text-[10.5px] font-mono text-slate-gray mt-1" data-testid="text-today-pending">Still checking {pendingCount} ticker{pendingCount === 1 ? "" : "s"}… this updates on its own.</div>
        )}
        {ready.length > 0 && !collapsed && (
          <div className="mt-2 space-y-2" data-testid="list-today-plans">
            {watchMode && <div className="text-[10px] uppercase tracking-wider text-slate-gray" data-testid="text-today-closest">Closest to ready — levels to watch, not trades yet</div>}
            {ready.map((c: any) => <ReadyPlanCard key={c.ticker} c={c} maxRisk={settingsQ.data?.maxDollarRisk ?? null} />)}
          </div>
        )}
      </div>
      {ready.length > 0 && (
        <button
          className="flex-shrink-0 inline-flex items-center gap-1 rounded border border-ink-line px-1.5 py-0.5 text-[10.5px] text-slate-gray hover:text-soft-white"
          onClick={toggle}
          aria-expanded={!collapsed}
          data-testid="button-toggle-today-plan"
        >
          {collapsed ? <><ChevronDown className="h-3 w-3" /> Show plan</> : <><ChevronUp className="h-3 w-3" /> Hide plan</>}
        </button>
      )}
    </div>
  );
}
