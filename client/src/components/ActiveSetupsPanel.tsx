// ─── ActiveSetupsPanel (v2 Overhaul) ───────────────────────────────────────
// Persistent list of confirmed swing setups. Backed by Postgres via
// /api/active-setups. Never auto-clears; only user archive removes an entry.

import React, { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Pin, PinOff, Archive, Plus, X, ArrowRight, ArrowUpRight, Play, Circle, ShieldAlert, TrendingUp, Eye, Search, ClipboardList, ChevronDown, ChevronRight } from "lucide-react";
import type { ActiveSetup } from "@shared/schema";
import Sparkline from "@/components/charts/Sparkline";
import { useCockpitTicker } from "@/components/CockpitTickerContext";
import { usePersistentState } from "@/hooks/use-persistent-state";

// ─── DESIGN SYSTEM CONSTANTS ───────────────────────────────────────────────

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
      return { label: "Stand Down", tone: "red", icon: <ShieldAlert className="h-4 w-4" />, hint: "Regime is RED — do not trigger. Wait for regime to repair." };
    }
    if (regime === "YELLOW") {
      return { label: "Wait for Trigger", tone: "amber", icon: <Circle className="h-4 w-4" />, hint: "Half size only. Confirm the trigger bar closes before entering." };
    }
    return { label: "Ready", tone: "green", icon: <Play className="h-4 w-4" />, hint: "Trigger armed. Enter at listed entry; stop at listed invalidation." };
  }
  if (s.status === "active") {
    return { label: "Manage", tone: "green", icon: <TrendingUp className="h-4 w-4" />, hint: "Trim half at T1, move stop to breakeven. Trail with 20-SMA to T2." };
  }
  if (s.status === "trimmed") {
    return { label: "Manage Runner", tone: "amber", icon: <TrendingUp className="h-4 w-4" />, hint: "T1 hit. Let the runner work; trail or exit at T2." };
  }
  if (s.status === "closed") {
    return { label: "Log & Archive", tone: "gray", icon: <ArrowRight className="h-4 w-4" />, hint: "Position closed. Log lessons in the Journal and archive when reviewed." };
  }
  return { label: "Watch", tone: "blue", icon: <Eye className="h-4 w-4" />, hint: "Setup on watch — set an alert; don't front-run." };
}

const TONE_STYLES: Record<NextAction["tone"], { border: string; bg: string; text: string; chip: string }> = {
  green: { border: "border-signal-green/40", bg: "bg-signal-green/10", text: "text-signal-green", chip: "bg-signal-green/20" },
  amber: { border: "border-signal-amber/40", bg: "bg-signal-amber/10", text: "text-signal-amber", chip: "bg-signal-amber/20" },
  red:   { border: "border-signal-red/40",   bg: "bg-signal-red/10",   text: "text-signal-red",   chip: "bg-signal-red/20" },
  blue:  { border: "border-neon-blue/40",    bg: "bg-neon-blue/10",    text: "text-neon-blue",    chip: "bg-neon-blue/20" },
  gray:  { border: "border-ink-line",        bg: "bg-ink-panel/40",    text: "text-slate-gray",   chip: "bg-ink-line" },
};

// ─── SUB-COMPONENTS ────────────────────────────────────────────────────────

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
  if (bars.length < 5) return <Sparkline data={[]} width={80} height={24} />;
  
  const closes = bars.slice(-30).map((b) => b.close);
  const stroke = closes[closes.length - 1] >= closes[0] ? "rgb(34 197 94)" : "rgb(239 68 68)";
  return <Sparkline data={closes} width={80} height={24} stroke={stroke} strokeWidth={1.5} showDot={false} />;
}

const NewSetupForm = ({ onSuccess, onCancel }: { onSuccess: () => void, onCancel: () => void }) => {
  const { toast } = useToast();
  const [draft, setDraft] = useState({
    ticker: "", thesis: "", entry: "", stop: "", targetT1: "", targetT2: "",
    riskPercent: "0.75", regime: "UNKNOWN", structureVerdict: "", sector: "", theme: "", notes: ""
  });

  const createMut = useMutation({
    mutationFn: async (payload: typeof draft) => {
      const entry = Number(payload.entry);
      const stop = Number(payload.stop);
      const t1 = Number(payload.targetT1);
      const t2 = payload.targetT2 ? Number(payload.targetT2) : null;
      const rr = stop > 0 && entry > stop ? Number(((t1 - entry) / (entry - stop)).toFixed(2)) : 0;
      
      const body = {
        ...payload,
        entry, stop, targetT1: t1, targetT2: t2, rrRatio: rr,
        riskPercent: Number(payload.riskPercent) || 0.75,
        status: "planned", pinned: false,
      };
      return apiRequest("POST", "/api/active-setups", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/active-setups"] });
      toast({ title: "Active setup saved" });
      onSuccess();
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: String(err?.message ?? err), variant: "destructive" });
    },
  });

  const handleSave = () => {
    if (!draft.ticker || !draft.entry || !draft.stop || !draft.targetT1) {
      toast({ title: "Missing fields", description: "Ticker, entry, stop, and T1 are required.", variant: "destructive" });
      return;
    }
    createMut.mutate(draft);
  };

  return (
    <div className="rounded-lg border border-ink-line bg-ink-deep p-4 space-y-4 shadow-sm" data-testid="form-add-setup">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-slate-gray">Ticker</span>
          <input value={draft.ticker} onChange={(e) => setDraft({ ...draft, ticker: e.target.value.toUpperCase() })} className="rounded-md border border-ink-line bg-ink-black px-3 py-2 text-sm font-mono text-soft-white focus:border-neon-blue focus:outline-none" placeholder="SMH" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-slate-gray">Entry</span>
          <input type="number" step="0.01" value={draft.entry} onChange={(e) => setDraft({ ...draft, entry: e.target.value })} className="rounded-md border border-ink-line bg-ink-black px-3 py-2 text-sm font-mono text-soft-white focus:border-neon-blue focus:outline-none" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-slate-gray">Stop</span>
          <input type="number" step="0.01" value={draft.stop} onChange={(e) => setDraft({ ...draft, stop: e.target.value })} className="rounded-md border border-ink-line bg-ink-black px-3 py-2 text-sm font-mono text-soft-white focus:border-neon-blue focus:outline-none" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-slate-gray">Target T1</span>
          <input type="number" step="0.01" value={draft.targetT1} onChange={(e) => setDraft({ ...draft, targetT1: e.target.value })} className="rounded-md border border-ink-line bg-ink-black px-3 py-2 text-sm font-mono text-soft-white focus:border-neon-blue focus:outline-none" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-slate-gray">Target T2 (opt)</span>
          <input type="number" step="0.01" value={draft.targetT2} onChange={(e) => setDraft({ ...draft, targetT2: e.target.value })} className="rounded-md border border-ink-line bg-ink-black px-3 py-2 text-sm font-mono text-soft-white focus:border-neon-blue focus:outline-none" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-slate-gray">Regime</span>
          <select value={draft.regime} onChange={(e) => setDraft({ ...draft, regime: e.target.value })} className="rounded-md border border-ink-line bg-ink-black px-3 py-2 text-sm text-soft-white focus:border-neon-blue focus:outline-none">
            <option>GREEN</option><option>YELLOW</option><option>RED</option><option>MIXED</option><option>UNKNOWN</option>
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-slate-gray">Thesis</span>
        <textarea rows={2} value={draft.thesis} onChange={(e) => setDraft({ ...draft, thesis: e.target.value })} className="rounded-md border border-ink-line bg-ink-black px-3 py-2 text-sm text-soft-white focus:border-neon-blue focus:outline-none" placeholder="Why this setup? What invalidates it?" />
      </label>
      <div className="flex gap-3 pt-2">
        <button onClick={handleSave} disabled={createMut.isPending} className="flex-1 rounded-md bg-neon-blue/20 border border-neon-blue/50 py-2 text-sm font-medium text-neon-blue transition-colors hover:bg-neon-blue/30 disabled:opacity-50">
          {createMut.isPending ? "Saving..." : "Save to Active Setups"}
        </button>
        <button onClick={onCancel} className="px-4 py-2 rounded-md border border-ink-line text-sm font-medium text-slate-gray hover:bg-ink-line transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
};

// ─── MAIN COMPONENT ────────────────────────────────────────────────────────

export default function ActiveSetupsPanel() {
  const { toast } = useToast();
  const [showAddForm, setShowAddForm] = useState(false);
  const { select } = useCockpitTicker();
  const [collapsed, setCollapsed] = usePersistentState<boolean>("cockpit.activeSetups.collapsed", true);

  const setupsQ = useQuery<ActiveSetup[]>({
    queryKey: ["/api/active-setups"],
    refetchInterval: 30_000,
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

  useEffect(() => {
    if (activeSetups.length > 0 && collapsed) setCollapsed(false);
  }, [activeSetups.length]);

  const summaryText = (() => {
    if (setupsQ.isLoading) return "loading...";
    if (activeSetups.length === 0) return "no qualifying setups";
    const planned = activeSetups.filter((s) => s.status === "planned").length;
    const live = activeSetups.filter((s) => s.status === "active" || s.status === "trimmed").length;
    const parts: string[] = [];
    if (live > 0) parts.push(`${live} live`);
    if (planned > 0) parts.push(`${planned} planned`);
    return parts.length ? parts.join(" · ") : `${activeSetups.length} total`;
  })();

  function goToScanLane() {
    const el = document.querySelector('[data-testid="step-scan"]');
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const hasSetups = activeSetups.length > 0;

  return (
    <div className="w-full flex flex-col gap-5 rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-md" data-testid="section-active-setups">
      
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex flex-1 items-center gap-3 text-left transition-colors hover:text-neon-blue"
        >
          {collapsed ? <ChevronRight className="h-4 w-4 text-slate-gray" /> : <ChevronDown className="h-4 w-4 text-slate-gray" />}
          <h3 className="text-sm font-bold uppercase tracking-wider text-soft-white">Active Setups</h3>
          <span className={`rounded-md border px-2 py-1 text-xs font-mono font-medium ${hasSetups ? "border-signal-green/40 bg-signal-green/10 text-signal-green" : "border-ink-line bg-ink-panel/40 text-slate-gray"}`}>
            {activeSetups.length} active
          </span>
          <span className="hidden sm:inline text-xs text-slate-gray">— {summaryText}</span>
        </button>
        {!collapsed && !showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-2 rounded-md border border-neon-blue/50 bg-neon-blue/10 px-3 py-1.5 text-xs font-medium text-neon-blue transition-colors hover:bg-neon-blue/20"
          >
            <Plus className="h-4 w-4" /> Add Setup
          </button>
        )}
      </div>

      {collapsed && (
        <div className="flex items-center justify-between rounded-lg border border-ink-line bg-ink-panel/30 p-3">
          <span className="text-xs text-slate-gray">{hasSetups ? `Review your ${activeSetups.length} active setups.` : "No confirmed setups. Expand to add one."}</span>
          <button onClick={() => setCollapsed(false)} className="rounded-md border border-ink-line px-3 py-1 text-xs font-mono uppercase text-slate-gray transition-colors hover:border-neon-blue hover:text-neon-blue">
            Expand
          </button>
        </div>
      )}

      {!collapsed && (
        <div className="flex flex-col gap-4">
          {showAddForm && <NewSetupForm onSuccess={() => setShowAddForm(false)} onCancel={() => setShowAddForm(false)} />}

          {setupsQ.isLoading ? (
            <div className="py-8 text-center text-sm text-slate-gray">Loading setups...</div>
          ) : activeSetups.length === 0 && !showAddForm ? (
            <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-ink-line bg-ink-panel/30 py-10 px-4 text-center">
              <div className="rounded-full bg-ink-line/30 p-4"><ClipboardList className="h-6 w-6 text-slate-gray" /></div>
              <div className="space-y-1 max-w-sm">
                <h4 className="font-bold text-soft-white">No Active Setups</h4>
                <p className="text-xs text-slate-gray leading-relaxed">Confirmed swing setups pinned to your Cockpit will appear here. Start by running a scan or adding a setup manually.</p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <button onClick={goToScanLane} className="flex items-center gap-2 rounded-md border border-neon-blue/50 bg-neon-blue/10 px-4 py-2 text-xs font-medium text-neon-blue transition-colors hover:bg-neon-blue/20"><Search className="h-4 w-4" /> Run Scan</button>
                <a href="/#/watchlist" className="flex items-center gap-2 rounded-md border border-ink-line bg-ink-deep px-4 py-2 text-xs font-medium text-soft-white transition-colors hover:border-neon-blue hover:text-neon-blue"><Eye className="h-4 w-4" /> Open Watchlist</a>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {activeSetups.map((s) => {
                const regimeStyle = REGIME_STYLES[s.regime] ?? REGIME_STYLES.UNKNOWN;
                const statusStyle = STATUS_STYLES[s.status] ?? STATUS_STYLES.planned;
                const next = nextActionFor(s);
                const tone = TONE_STYLES[next.tone];
                const rr = s.rrRatio > 0 ? s.rrRatio.toFixed(2) : "Unknown";

                return (
                  <div key={s.id} className={`flex flex-col gap-4 rounded-lg border bg-ink-deep p-4 shadow-sm transition-colors ${s.pinned ? "border-neon-blue/60" : "border-ink-line"}`}>
                    
                    {/* Card Header */}
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <button onClick={() => select(s.ticker)} className="text-lg font-bold font-mono text-soft-white transition-colors hover:text-neon-blue">{s.ticker}</button>
                        <SetupSparkline ticker={s.ticker} />
                        <span className={`rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${regimeStyle.bg} ${regimeStyle.text}`}>{regimeStyle.label}</span>
                        <span className={`rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${statusStyle.bg} ${statusStyle.text}`}>{s.status}</span>
                        {s.pinned && <span className="rounded-md bg-neon-blue/20 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-neon-blue">PINNED</span>}
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => pinMut.mutate({ id: s.id, pinned: !s.pinned })} className="rounded-md p-2 text-slate-gray transition-colors hover:bg-ink-line hover:text-neon-blue" title={s.pinned ? "Unpin" : "Pin to top"}>
                          {s.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                        </button>
                        <button onClick={() => { if (confirm(`Archive ${s.ticker}? This removes it from Active Setups.`)) archiveMut.mutate(s.id); }} className="rounded-md p-2 text-slate-gray transition-colors hover:bg-ink-line hover:text-signal-red" title="Archive">
                          <Archive className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {/* Next Action Strip */}
                    <div className={`flex items-start gap-3 rounded-lg border ${tone.border} ${tone.bg} p-3`}>
                      <div className={`mt-0.5 flex-shrink-0 rounded-md p-1.5 ${tone.chip} ${tone.text}`}>{next.icon}</div>
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-gray">Next Action</span>
                          <span className={`text-sm font-bold ${tone.text}`}>{next.label}</span>
                        </div>
                        <span className="text-xs leading-relaxed text-soft-white/80">{next.hint}</span>
                      </div>
                    </div>

                    {s.thesis && <p className="text-xs leading-relaxed text-soft-white/90">{s.thesis}</p>}

                    {/* Financial Levels Grid */}
                    <div className="grid grid-cols-4 gap-4 rounded-lg border border-ink-line bg-ink-black/40 p-3">
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-gray">Entry</span>
                        <span className="font-mono text-sm text-soft-white">${s.entry.toFixed(2)}</span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-gray">Stop</span>
                        <span className="font-mono text-sm text-signal-red">${s.stop.toFixed(2)}</span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-gray">T1 / T2</span>
                        <span className="truncate font-mono text-sm text-signal-green">${s.targetT1.toFixed(2)}{s.targetT2 != null ? ` / $${s.targetT2.toFixed(2)}` : ""}</span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-gray">R:R / Risk</span>
                        <span className="font-mono text-sm text-soft-white">{rr} / {s.riskPercent.toFixed(2)}%</span>
                      </div>
                    </div>

                    {/* Footer Actions */}
                    <div className="mt-2 flex items-center justify-between border-t border-ink-line pt-4 text-xs">
                      <span className="text-slate-gray">Saved {formatTimestamp(s.createdAt)}</span>
                      <div className="flex items-center gap-3">
                        <button onClick={() => select(s.ticker)} className="flex items-center gap-1.5 font-medium text-slate-gray transition-colors hover:text-neon-blue">
                          Chart <ArrowUpRight className="h-3.5 w-3.5" />
                        </button>
                        {s.status === "planned" && (
                          <button onClick={() => patchMut.mutate({ id: s.id, patch: { status: "active" } })} className="rounded-md border border-signal-green/50 bg-signal-green/10 px-3 py-1.5 font-medium text-signal-green transition-colors hover:bg-signal-green/20">
                            Mark Active
                          </button>
                        )}
                        {s.status === "active" && (
                          <button onClick={() => patchMut.mutate({ id: s.id, patch: { status: "closed" } })} className="rounded-md border border-ink-line bg-ink-panel px-3 py-1.5 font-medium text-soft-white transition-colors hover:border-slate-gray">
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
      )}
    </div>
  );
}

