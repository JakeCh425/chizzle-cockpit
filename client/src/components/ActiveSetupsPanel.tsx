// ─── ActiveSetupsPanel ─────────────────────────────────────────────────────
// Persistent list of confirmed swing setups. Backed by Postgres via
// /api/active-setups. Never auto-clears; only user archive removes an entry.
// Renders in Chizzle operator style: hard section boundaries, no emojis,
// no color noise, no repeated info.

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Pin, PinOff, Archive, Pencil, Plus, X } from "lucide-react";
import type { ActiveSetup } from "@shared/schema";

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

export default function ActiveSetupsPanel() {
  const { toast } = useToast();
  const [showAddForm, setShowAddForm] = useState(false);
  const [draft, setDraft] = useState<NewSetupDraft>(BLANK_DRAFT);

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

  return (
    <div className="rounded-md border border-ink-line bg-ink-black p-4 space-y-3" data-testid="section-active-setups">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-soft-white uppercase tracking-wide">Active Setups</h3>
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
        <div className="text-xs text-slate-gray py-4 text-center" data-testid="text-empty-setups">
          Active Setups: None
        </div>
      ) : (
        <div className="space-y-2">
          {activeSetups.map((s) => {
            const regimeStyle = REGIME_STYLES[s.regime] ?? REGIME_STYLES.UNKNOWN;
            const statusStyle = STATUS_STYLES[s.status] ?? STATUS_STYLES.planned;
            const rr = s.rrRatio > 0 ? s.rrRatio.toFixed(2) : "Unknown";
            return (
              <div
                key={s.id}
                className={`rounded-md border ${s.pinned ? "border-neon-blue" : "border-ink-line"} bg-ink-deep p-3`}
                data-testid={`setup-${s.ticker}`}
              >
                <div className="flex items-start justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-soft-white font-mono">{s.ticker}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${regimeStyle.bg} ${regimeStyle.text} font-bold`}>
                      {regimeStyle.label}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusStyle.bg} ${statusStyle.text} uppercase`}>
                      {s.status}
                    </span>
                    {s.pinned && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-neon-blue/20 text-neon-blue">PINNED</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
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

                {s.thesis && (
                  <div className="text-xs text-soft-white mb-2 leading-snug" data-testid={`text-thesis-${s.ticker}`}>
                    {s.thesis}
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-xs">
                  <div>
                    <div className="text-slate-gray">Entry</div>
                    <div className="font-mono text-soft-white">${s.entry.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-slate-gray">Stop</div>
                    <div className="font-mono text-signal-red">${s.stop.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-slate-gray">T1 / T2</div>
                    <div className="font-mono text-signal-green">
                      ${s.targetT1.toFixed(2)}
                      {s.targetT2 != null ? ` / $${s.targetT2.toFixed(2)}` : ""}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-gray">R:R / Risk</div>
                    <div className="font-mono text-soft-white">
                      {rr} / {s.riskPercent.toFixed(2)}%
                    </div>
                  </div>
                </div>

                {(s.structureVerdict || s.sector || s.theme) && (
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
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

                <div className="mt-2 flex items-center justify-between text-[10px] text-slate-gray">
                  <span>Saved {formatTimestamp(s.createdAt)}</span>
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
            );
          })}
        </div>
      )}
    </div>
  );
}
