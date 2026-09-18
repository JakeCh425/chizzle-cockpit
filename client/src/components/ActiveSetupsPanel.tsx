// ─── ActiveSetupsPanel ─────────────────────────────────────────────────────
// Persistent list of confirmed swing setups. Backed by Postgres via
// /api/active-setups. Never auto-clears; only user archive removes an entry.
//
// Cockpit v2 refinement: card layout is visually cleaner — a "next action"
// header (derived from existing status + regime; NO new state), a compact
// levels row, a display-only sparkline (reuses the /api/candles-ohlc cache),
// and a nicer empty state. All mutations, form fields, event handlers, and
// status rules are preserved exactly.

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Pin, PinOff, Archive, Plus, X, ArrowRight, ArrowUpRight, Play, Circle, ShieldAlert, TrendingUp, Eye, Search, ClipboardList } from "lucide-react";
import type { ActiveSetup } from "@shared/schema";
import Sparkline from "@/components/charts/Sparkline";
import { useCockpitTicker } from "@/components/CockpitTickerContext";

const REGIME_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  GREEN: { bg: "bg-signal-green/10", text: "text-signal-green", label: "GREEN" },
  YELLOW: { bg: "bg-signal-amber/10", text: "text-signal-amber", label: "YELLOW" },
  RED: { bg: "bg-signal-red/10", text: "text-signal-red", label: "RED" },
  MIXED: { bg: "bg-neon-blue/10", text: "text-neon-blue", label: "MIXED" },
  UNKNOWN: { bg: "bg-ink-line", text: "text-slate-gray", label: "UNKNOWN" },
};

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  planned: { bg: "bg-neon-blue/10", text: "text-neon-blue" },
  active: { bg: "bg-signal-green/10", text: "text-signal-green" },
  trimmed: { bg: "bg-signal-amber/10", text: "text-signal-amber" },
  closed: { bg: "bg-ink-line", text: "text-slate-gray" },
  archived: { bg: "bg-ink-panel", text: "text-slate-gray" },
};

function formatTimestamp(iso: string | Date | null | undefined): string {
  if (!iso) return "Unknown";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (isNaN(d.getTime())) return "Unknown";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

interface NewSetupDraft {
  ticker: string;
  thesis: string;
  entry: string;
  stop: string;
  targetT1: string;
  targetT2: string;
  riskPercent: string;
  regime: "GREEN" | "YELLOW" | "RED" | "UNKNOWN" | "MIXED";
  structureVerdict: string;
  sector: string;
  theme: string;
  notes: string;
}

const BLANK_DRAFT: NewSetupDraft = {
  ticker: "",
  thesis: "",
  entry: "",
  stop: "",
  targetT1: "",
  targetT2: "",
  riskPercent: "0.75",
  regime: "UNKNOWN",
  structureVerdict: "",
  sector: "",
  theme: "",
  notes: "",
};

// ── Next-action label — display-only derivation from existing status+regime ─
// No new state, no schema change. Just translates status into a beginner
// label that visually explains what the user should do next.
interface NextAction {
  label: string;
  tone: "green" | "amber" | "red" | "blue" | "gray";
  icon: JSX.Element;
  hint: string;
}
function nextActionFor(s: ActiveSetup): NextAction {
  const regime = (s.regime || "UNKNOWN") as string;
  if (s.status === "planned") {
    if (regime === "RED") {
      return {
        label: "Stand Down",
        tone: "red",
        icon: <ShieldAlert className="h-3 w-3" />,
        hint: "Regime is RED — do not trigger. Wait for regime to repair.",
      };
    }
    if (regime === "YELLOW") {
      return {
        label: "Wait for Trigger",
        tone: "amber",
        icon: <Circle className="h-3 w-3" />,
        hint: "Half size only. Confirm the trigger bar closes before entering.",
      };
    }
    return {
      label: "Ready",
      tone: "green",
      icon: <Play className="h-3 w-3" />,
      hint: "Trigger armed. Enter at listed entry; stop at listed invalidation.",
    };
  }
  if (s.status === "active") {
    return {
      label: "Manage",
      tone: "green",
      icon: <TrendingUp className="h-3 w-3" />,
      hint: "Trim half at T1, move stop to breakeven. Trail with 20-SMA to T2.",
    };
  }
  if (s.status === "trimmed") {
    return {
      label: "Manage Runner",
      tone: "amber",
      icon: <TrendingUp className="h-3 w-3" />,
      hint: "T1 hit. Let the runner work; trail or exit at T2.",
    };
  }
  if (s.status === "closed") {
    return {
      label: "Log & Archive",
      tone: "gray",
      icon: <ArrowRight className="h-3 w-3" />,
      hint: "Position closed. Log lessons in the Journal and archive when reviewed.",
    };
  }
  return {
    label: "Watch",
    tone: "blue",
    icon: <Eye className="h-3 w-3" />,
    hint: "Setup on watch — set an alert; don't front-run.",
  };
}

const TONE_STYLES: Record<NextAction["tone"], { border: string; bg: string; text: string; chip: string }> = {
  green: { border: "border-signal-green/40", bg: "bg-signal-green/8",  text: "text-signal-green", chip: "bg-signal-green/15" },
  amber: { border: "border-signal-amber/40", bg: "bg-signal-amber/8",  text: "text-signal-amber", chip: "bg-signal-amber/15" },
  red:   { border: "border-signal-red/40",   bg: "bg-signal-red/8",    text: "text-signal-red",   chip: "bg-signal-red/15" },
  blue:  { border: "border-neon-blue/40",    bg: "bg-neon-blue/8",     text: "text-neon-blue",    chip: "bg-neon-blue/15" },
  gray:  { border: "border-ink-line",        bg: "bg-ink-panel/40",    text: "text-slate-gray",   chip: "bg-ink-line" },
};

// ── Display-only sparkline. Reuses the /api/candles-ohlc cache that other
//    panels already populate. No new endpoint, no extra churn — TanStack
//    Query dedupes per key, so this rides existing fetches.
function SetupSparkline({ ticker }: { ticker: string }) {
  const q = useQuery<{ time: number; open: number; high: number; low: number; close: number; volume: number }[]>({
    queryKey: ["/api/candles-ohlc", ticker, "1D"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/candles-ohlc/${ticker}?interval=1D`);
      return await res.json();
    },
    staleTime: 5 * 60_000,
  });
  const bars = q.data ?? [];
  if (bars.length < 5) {
    return <Sparkline data={[]} width={72} height={22} />;
  }
  const closes = bars.slice(-30).map((b) => b.close);
  const stroke = closes[closes.length - 1] >= closes[0] ? "rgb(34 197 94)" : "rgb(239 68 68)";
  return <Sparkline data={closes} width={72} height={22} stroke={stroke} strokeWidth={1.2} showDot={false} />;
}

export default function ActiveSetupsPanel() {
  const { toast } = useToast();
  const [showAddForm, setShowAddForm] = useState(false);
  const [draft, setDraft] = useState<NewSetupDraft>(BLANK_DRAFT);
  const { select } = useCockpitTicker();

  const setupsQ = useQuery<ActiveSetup[]>({
    queryKey: ["/api/active-setups"],
    refetchInterval: 30_000,
  });

  const createMut = useMutation({
    mutationFn: async (payload: NewSetupDraft) => {
      const entry = Number(payload.entry);
      const stop = Number(payload.stop);
      const t1 = Number(payload.targetT1);
      const t2 = payload.targetT2 ? Number(payload.targetT2) : null;
      const rr = stop > 0 && entry > stop ? Number(((t1 - entry) / (entry - stop)).toFixed(2)) : 0;
      const body = {
        ticker: payload.ticker,
        thesis: payload.thesis,
        entry,
        stop,
        targetT1: t1,
        targetT2: t2,
        riskPercent: Number(payload.riskPercent) || 0.75,
        regime: payload.regime,
        structureVerdict: payload.structureVerdict,
        rrRatio: rr,
        sector: payload.sector,
        theme: payload.theme,
        notes: payload.notes,
        status: "planned" as const,
        pinned: false,
      };
      return apiRequest("POST", "/api/active-setups", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/active-setups"] });
      setDraft(BLANK_DRAFT);
      setShowAddForm(false);
      toast({ title: "Active setup saved" });
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: String(err?.message ?? err), variant: "destructive" });
    },
  });

  const patchMut = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<ActiveSetup> }) => {
      return apiRequest("PATCH", `/api/active-setups/${id}`, patch);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/active-setups"] }),
  });

  const archiveMut = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/active-setups/${id}/archive`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/active-setups"] });
      toast({ title: "Setup archived" });
    },
  });

  const pinMut = useMutation({
    mutationFn: async ({ id, pinned }: { id: string; pinned: boolean }) =>
      apiRequest("POST", `/api/active-setups/${id}/pin`, { pinned }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/active-setups"] }),
  });

  const setups = setupsQ.data ?? [];
  const activeSetups = setups.filter((s) => s.status !== "archived");

  // Reveal the existing SCAN lane so the user can run the existing scanner.
  // No new route, no new event handler on scanner state — just scroll to it.
  function goToScanLane() {
    const el = document.querySelector('[data-testid="step-scan"]');
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="rounded-md border border-ink-line bg-ink-black p-4 space-y-3" data-testid="section-active-setups">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-bold text-soft-white uppercase tracking-wide">Active Setups</h3>
          {activeSetups.length > 0 && (
            <span className="text-[10px] font-mono text-slate-gray">
              {activeSetups.length} {activeSetups.length === 1 ? "setup" : "setups"}
            </span>
          )}
        </div>
        <button
          onClick={() => setShowAddForm((v) => !v)}
          className="text-xs px-2 py-1 rounded border border-neon-blue text-neon-blue hover:bg-neon-blue/10 flex items-center gap-1"
          data-testid="button-add-setup"
        >
          {showAddForm ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
          {showAddForm ? "Cancel" : "Add Setup"}
        </button>
      </div>

      {showAddForm && (
        <div className="rounded-md border border-ink-line bg-ink-deep p-3 space-y-2" data-testid="form-add-setup">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <label className="text-xs">
              <div className="text-slate-gray mb-0.5">Ticker</div>
              <input
                value={draft.ticker}
                onChange={(e) => setDraft({ ...draft, ticker: e.target.value.toUpperCase() })}
                className="w-full bg-ink-black border border-ink-line rounded px-2 py-1 text-soft-white font-mono"
                placeholder="SMH"
                data-testid="input-ticker"
              />
            </label>
            <label className="text-xs">
              <div className="text-slate-gray mb-0.5">Entry</div>
              <input
                value={draft.entry}
                onChange={(e) => setDraft({ ...draft, entry: e.target.value })}
                type="number"
                step="0.01"
                className="w-full bg-ink-black border border-ink-line rounded px-2 py-1 text-soft-white font-mono"
                data-testid="input-entry"
              />
            </label>
            <label className="text-xs">
              <div className="text-slate-gray mb-0.5">Stop</div>
              <input
                value={draft.stop}
                onChange={(e) => setDraft({ ...draft, stop: e.target.value })}
                type="number"
                step="0.01"
                className="w-full bg-ink-black border border-ink-line rounded px-2 py-1 text-soft-white font-mono"
                data-testid="input-stop"
              />
            </label>
            <label className="text-xs">
              <div className="text-slate-gray mb-0.5">Target T1</div>
              <input
                value={draft.targetT1}
                onChange={(e) => setDraft({ ...draft, targetT1: e.target.value })}
                type="number"
                step="0.01"
                className="w-full bg-ink-black border border-ink-line rounded px-2 py-1 text-soft-white font-mono"
                data-testid="input-target-t1"
              />
            </label>
            <label className="text-xs">
              <div className="text-slate-gray mb-0.5">Target T2 (optional)</div>
              <input
                value={draft.targetT2}
                onChange={(e) => setDraft({ ...draft, targetT2: e.target.value })}
                type="number"
                step="0.01"
                className="w-full bg-ink-black border border-ink-line rounded px-2 py-1 text-soft-white font-mono"
                data-testid="input-target-t2"
              />
            </label>
            <label className="text-xs">
              <div className="text-slate-gray mb-0.5">Risk %</div>
              <input
                value={draft.riskPercent}
                onChange={(e) => setDraft({ ...draft, riskPercent: e.target.value })}
                type="number"
                step="0.05"
                className="w-full bg-ink-black border border-ink-line rounded px-2 py-1 text-soft-white font-mono"
                data-testid="input-risk-percent"
              />
            </label>
            <label className="text-xs">
              <div className="text-slate-gray mb-0.5">Regime</div>
              <select
                value={draft.regime}
                onChange={(e) => setDraft({ ...draft, regime: e.target.value as any })}
                className="w-full bg-ink-black border border-ink-line rounded px-2 py-1 text-soft-white"
                data-testid="select-regime"
              >
                <option>GREEN</option>
                <option>YELLOW</option>
                <option>RED</option>
                <option>MIXED</option>
                <option>UNKNOWN</option>
              </select>
            </label>
            <label className="text-xs col-span-2">
              <div className="text-slate-gray mb-0.5">Structure Verdict</div>
              <input
                value={draft.structureVerdict}
                onChange={(e) => setDraft({ ...draft, structureVerdict: e.target.value })}
                className="w-full bg-ink-black border border-ink-line rounded px-2 py-1 text-soft-white"
                placeholder="Breakout-pullback near 20-SMA"
                data-testid="input-structure"
              />
            </label>
          </div>
          <label className="text-xs block">
            <div className="text-slate-gray mb-0.5">Thesis</div>
            <textarea
              value={draft.thesis}
              onChange={(e) => setDraft({ ...draft, thesis: e.target.value })}
              rows={2}
              className="w-full bg-ink-black border border-ink-line rounded px-2 py-1 text-soft-white text-xs"
              placeholder="Why this setup, what invalidates"
              data-testid="input-thesis"
            />
          </label>
          <button
            onClick={() => {
              if (!draft.ticker || !draft.entry || !draft.stop || !draft.targetT1) {
                toast({ title: "Missing fields", description: "Ticker, entry, stop, and T1 required", variant: "destructive" });
                return;
              }
              createMut.mutate(draft);
            }}
            disabled={createMut.isPending}
            className="w-full text-xs py-1.5 rounded bg-neon-blue/20 text-neon-blue border border-neon-blue hover:bg-neon-blue/30 disabled:opacity-50"
            data-testid="button-save-setup"
          >
            {createMut.isPending ? "Saving..." : "Save to Active Setups"}
          </button>
        </div>
      )}

      {setupsQ.isLoading ? (
        <div className="text-xs text-slate-gray py-4 text-center">Loading...</div>
      ) : activeSetups.length === 0 ? (
        // ── Improved empty state ─────────────────────────────────────────
        // Same as before functionally (existing routes/handlers only),
        // just presented with clear next-step options.
        <div className="rounded-md border border-dashed border-ink-line bg-ink-panel/30 p-5 flex flex-col items-center gap-3" data-testid="empty-setups">
          <div className="rounded-full bg-ink-line/40 p-2.5">
            <ClipboardList className="h-5 w-5 text-slate-gray" />
          </div>
          <div className="text-center space-y-0.5">
            <div className="text-sm font-bold text-soft-white">No Active Setups</div>
            <div className="text-[11px] text-slate-gray max-w-md">
              Confirmed swing setups pinned to your Cockpit will appear here. Start by running a scan or adding a setup manually.
            </div>
          </div>
          <div className="flex flex-wrap gap-2 justify-center pt-1">
            <button
              onClick={goToScanLane}
              className="text-xs px-3 py-1.5 rounded border border-neon-blue text-neon-blue hover:bg-neon-blue/10 flex items-center gap-1.5"
              data-testid="button-empty-run-scan"
            >
              <Search className="h-3 w-3" /> Run Scan
            </button>
            <button
              onClick={() => setShowAddForm(true)}
              className="text-xs px-3 py-1.5 rounded border border-ink-line text-soft-white hover:border-neon-blue hover:text-neon-blue flex items-center gap-1.5"
              data-testid="button-empty-add-setup"
            >
              <Plus className="h-3 w-3" /> Add Setup
            </button>
            <a
              href="/#/watchlist"
              className="text-xs px-3 py-1.5 rounded border border-ink-line text-soft-white hover:border-neon-blue hover:text-neon-blue flex items-center gap-1.5"
              data-testid="button-empty-open-watchlist"
            >
              <Eye className="h-3 w-3" /> Open Watchlist
            </a>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
          {activeSetups.map((s) => {
            const regimeStyle = REGIME_STYLES[s.regime] ?? REGIME_STYLES.UNKNOWN;
            const statusStyle = STATUS_STYLES[s.status] ?? STATUS_STYLES.planned;
            const rr = s.rrRatio > 0 ? s.rrRatio.toFixed(2) : "Unknown";
            const next = nextActionFor(s);
            const tone = TONE_STYLES[next.tone];
            return (
              <div
                key={s.id}
                className={`rounded-md border ${s.pinned ? "border-neon-blue" : "border-ink-line"} bg-ink-deep p-3.5 flex flex-col gap-2.5`}
                data-testid={`setup-${s.ticker}`}
              >
                {/* Header row: ticker + chips + actions */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <button
                      onClick={() => select(s.ticker)}
                      className="text-[15px] font-bold text-soft-white font-mono hover:text-neon-blue"
                      title={`Focus chart on ${s.ticker}`}
                      data-testid={`setup-ticker-${s.ticker}`}
                    >
                      {s.ticker}
                    </button>
                    <SetupSparkline ticker={s.ticker} />
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${regimeStyle.bg} ${regimeStyle.text} font-bold uppercase tracking-wide`}>
                      {regimeStyle.label}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusStyle.bg} ${statusStyle.text} uppercase tracking-wide`}>
                      {s.status}
                    </span>
                    {s.pinned && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-neon-blue/20 text-neon-blue uppercase tracking-wide">PINNED</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => pinMut.mutate({ id: s.id, pinned: !s.pinned })}
                      className="p-1 rounded hover:bg-ink-line text-slate-gray hover:text-neon-blue"
                      title={s.pinned ? "Unpin" : "Pin to top"}
                      data-testid={`button-pin-${s.ticker}`}
                    >
                      {s.pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Archive ${s.ticker}? This removes it from Active Setups.`)) {
                          archiveMut.mutate(s.id);
                        }
                      }}
                      className="p-1 rounded hover:bg-ink-line text-slate-gray hover:text-signal-red"
                      title="Archive"
                      data-testid={`button-archive-${s.ticker}`}
                    >
                      <Archive className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                {/* Next-action strip — display-only translation of existing status */}
                <div
                  className={`rounded border ${tone.border} ${tone.bg} px-2.5 py-1.5 flex items-start gap-2`}
                  data-testid={`next-action-${s.ticker}`}
                >
                  <div className={`rounded ${tone.chip} ${tone.text} p-1 flex-shrink-0 mt-0.5`}>{next.icon}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[9.5px] uppercase tracking-wider text-slate-gray">Next Action</span>
                      <span className={`text-[12px] font-bold ${tone.text}`}>{next.label}</span>
                    </div>
                    <div className="text-[10.5px] text-soft-white/85 leading-snug mt-0.5">{next.hint}</div>
                  </div>
                </div>

                {/* Thesis (optional) */}
                {s.thesis && (
                  <div className="text-[11.5px] text-soft-white/90 leading-snug" data-testid={`text-thesis-${s.ticker}`}>
                    {s.thesis}
                  </div>
                )}

                {/* Levels row — compact & scannable */}
                <div className="grid grid-cols-4 gap-2 rounded border border-ink-line bg-ink-black/40 p-2">
                  <div>
                    <div className="text-[9px] uppercase tracking-wider text-slate-gray">Entry</div>
                    <div className="font-mono text-[12px] text-soft-white tabular-nums">${s.entry.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase tracking-wider text-slate-gray">Stop</div>
                    <div className="font-mono text-[12px] text-signal-red tabular-nums">${s.stop.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase tracking-wider text-slate-gray">T1 / T2</div>
                    <div className="font-mono text-[12px] text-signal-green tabular-nums truncate">
                      ${s.targetT1.toFixed(2)}
                      {s.targetT2 != null ? ` / $${s.targetT2.toFixed(2)}` : ""}
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase tracking-wider text-slate-gray">R:R / Risk</div>
                    <div className="font-mono text-[12px] text-soft-white tabular-nums">
                      {rr} / {s.riskPercent.toFixed(2)}%
                    </div>
                  </div>
                </div>

                {/* Tags */}
                {(s.structureVerdict || s.sector || s.theme) && (
                  <div className="flex flex-wrap gap-1.5 text-[10px]">
                    {s.structureVerdict && (
                      <span className="px-1.5 py-0.5 rounded border border-ink-line text-slate-gray">
                        {s.structureVerdict}
                      </span>
                    )}
                    {s.sector && (
                      <span className="px-1.5 py-0.5 rounded border border-ink-line text-slate-gray">
                        {s.sector}
                      </span>
                    )}
                    {s.theme && (
                      <span className="px-1.5 py-0.5 rounded border border-ink-line text-slate-gray">
                        {s.theme}
                      </span>
                    )}
                  </div>
                )}

                {/* Footer row: timestamp + status transition */}
                <div className="flex items-center justify-between text-[10px] text-slate-gray pt-1 border-t border-ink-line">
                  <span>Saved {formatTimestamp(s.createdAt)}</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => select(s.ticker)}
                      className="text-[10px] text-slate-gray hover:text-neon-blue flex items-center gap-1"
                      title="Focus chart"
                      data-testid={`button-focus-chart-${s.ticker}`}
                    >
                      Chart <ArrowUpRight className="h-2.5 w-2.5" />
                    </button>
                    {s.status === "planned" && (
                      <button
                        onClick={() => patchMut.mutate({ id: s.id, patch: { status: "active" } })}
                        className="px-2 py-0.5 rounded border border-signal-green text-signal-green hover:bg-signal-green/10"
                        data-testid={`button-execute-${s.ticker}`}
                      >
                        Mark Active
                      </button>
                    )}
                    {s.status === "active" && (
                      <button
                        onClick={() => patchMut.mutate({ id: s.id, patch: { status: "closed" } })}
                        className="px-2 py-0.5 rounded border border-ink-line text-slate-gray hover:text-soft-white"
                        data-testid={`button-close-${s.ticker}`}
                      >
                        Mark Closed
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
