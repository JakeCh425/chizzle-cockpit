// ─────────────────────────────────────────────────────────────────────────────
// WatchlistEditor.tsx
// Compact CRUD panel for the mini-chart watchlist.
//   Add    → POST   /api/watchlist            { symbol }
//   Remove → DELETE /api/watchlist/:id
//   Reorder→ POST   /api/watchlist/reorder    { ids: number[] }
//
// After every mutation we invalidate /api/watchlist + /api/tickers so the
// MiniChartGrid re-renders automatically.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Ticker, WatchlistItem } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ArrowDown, ArrowUp, Plus, Trash2, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Props { className?: string; }

const SYMBOL_RE = /^[A-Z0-9.\-]{1,12}$/;

export default function WatchlistEditor({ className = "" }: Props) {
  const { toast } = useToast();
  const [input, setInput] = useState("");

  const { data: tickers } = useQuery<Ticker[]>({ queryKey: ["/api/tickers"] });
  const { data: watchlist } = useQuery<WatchlistItem[]>({ queryKey: ["/api/watchlist"] });

  // Compose ordered list of { id, symbol } from watchlist + tickers join.
  const rows = useMemo(() => {
    const byId = new Map<number, string>();
    for (const t of tickers || []) byId.set(t.id, t.symbol);
    return (watchlist || [])
      .map(w => ({ id: w.id, tickerId: w.tickerId, symbol: byId.get(w.tickerId) || "?" }))
      .filter(r => r.symbol !== "?");
  }, [watchlist, tickers]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
    queryClient.invalidateQueries({ queryKey: ["/api/tickers"] });
  };

  const addM = useMutation({
    mutationFn: async (symbol: string) => {
      const res = await apiRequest("POST", "/api/watchlist", { symbol });
      return res.json();
    },
    onSuccess: () => { setInput(""); invalidate(); toast({ title: "Added", description: "Symbol added to watchlist" }); },
    onError: (err: any) => toast({ title: "Add failed", description: err?.message || "Could not add symbol", variant: "destructive" }),
  });

  const removeM = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/watchlist/${id}`, undefined); },
    onSuccess: invalidate,
    onError: (err: any) => toast({ title: "Remove failed", description: err?.message || "Could not remove", variant: "destructive" }),
  });

  const reorderM = useMutation({
    mutationFn: async (ids: number[]) => { await apiRequest("POST", "/api/watchlist/reorder", { ids }); },
    onSuccess: invalidate,
    onError: (err: any) => toast({ title: "Reorder failed", description: err?.message || "Could not reorder", variant: "destructive" }),
  });

  const scanM = useMutation({
    mutationFn: async () => { await apiRequest("POST", "/api/alerts/scan-sma20", undefined); },
    onSuccess: () => {
      toast({ title: "Scan started", description: "SMA20 alert sweep running in background" });
      // Alerts feed pulls on its own cadence; nudge it a few seconds out.
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["/api/alerts"] }), 5000);
    },
    onError: (err: any) => toast({ title: "Scan failed", description: err?.message || "Could not start scan", variant: "destructive" }),
  });

  const tryAdd = () => {
    const sym = input.trim().toUpperCase();
    if (!sym) return;
    if (!SYMBOL_RE.test(sym)) {
      toast({ title: "Invalid symbol", description: "Use 1-12 chars (A-Z, 0-9, . or -)", variant: "destructive" });
      return;
    }
    if (rows.some(r => r.symbol === sym)) {
      toast({ title: "Already in watchlist", description: sym });
      return;
    }
    addM.mutate(sym);
  };

  const move = (idx: number, dir: -1 | 1) => {
    const next = idx + dir;
    if (next < 0 || next >= rows.length) return;
    const ids = rows.map(r => r.id);
    [ids[idx], ids[next]] = [ids[next], ids[idx]];
    reorderM.mutate(ids);
  };

  return (
    <div className={`border border-ink-line/80 bg-ink-deep/40 rounded-sm p-3 flex flex-col gap-2 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-slate-gray">Edit Watchlist</span>
        <button
          type="button"
          onClick={() => scanM.mutate()}
          disabled={scanM.isPending}
          className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-gray hover:text-neon-blue transition-colors disabled:opacity-50"
          title="Run SMA20 alert scan now"
          data-testid="button-scan-sma20"
        >
          <Zap className="w-3 h-3" />
          {scanM.isPending ? "Scanning…" : "Scan now"}
        </button>
      </div>

      {/* Add row */}
      <div className="flex items-center gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value.toUpperCase())}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); tryAdd(); } }}
          placeholder="ADD SYMBOL"
          spellCheck={false}
          className="flex-1 bg-ink-deep/60 border border-ink-line/80 rounded-sm px-2 py-1 text-[12px] font-mono-num tracking-wider uppercase text-soft-white outline-none focus:border-neon-blue/60"
          data-testid="input-watchlist-symbol"
          aria-label="Add ticker symbol"
        />
        <button
          type="button"
          onClick={tryAdd}
          disabled={addM.isPending || !input.trim()}
          className="px-2 py-1 text-[11px] uppercase tracking-wider border border-ink-line/80 rounded-sm text-soft-white hover:border-neon-blue/60 hover:text-neon-blue transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
          data-testid="button-watchlist-add"
        >
          <Plus className="w-3 h-3" />
          Add
        </button>
      </div>

      {/* List */}
      <div className="flex flex-col gap-px max-h-[260px] overflow-y-auto">
        {rows.length === 0 && (
          <div className="text-[10px] uppercase tracking-wider text-slate-gray py-3 text-center">
            Empty — fallback symbols shown
          </div>
        )}
        {rows.map((r, i) => (
          <div
            key={r.id}
            className="flex items-center justify-between gap-2 px-2 py-1 border border-ink-line/40 hover:border-ink-line/80 hover:bg-ink-line/20 rounded-sm transition-colors"
            data-testid={`row-watchlist-${r.symbol}`}
          >
            <span className="text-[12px] font-mono-num font-semibold uppercase tracking-wider text-soft-white">
              {r.symbol}
            </span>
            <div className="flex items-center gap-px">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0 || reorderM.isPending}
                className="p-1 text-slate-gray hover:text-neon-blue transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="Move up"
                aria-label={`Move ${r.symbol} up`}
                data-testid={`button-watchlist-up-${r.symbol}`}
              ><ArrowUp className="w-3 h-3" /></button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === rows.length - 1 || reorderM.isPending}
                className="p-1 text-slate-gray hover:text-neon-blue transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="Move down"
                aria-label={`Move ${r.symbol} down`}
                data-testid={`button-watchlist-down-${r.symbol}`}
              ><ArrowDown className="w-3 h-3" /></button>
              <button
                type="button"
                onClick={() => {
                  if (!confirm(`Remove ${r.symbol} from watchlist?`)) return;
                  removeM.mutate(r.id);
                }}
                disabled={removeM.isPending}
                className="p-1 text-slate-gray hover:text-signal-red transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="Remove"
                aria-label={`Remove ${r.symbol}`}
                data-testid={`button-watchlist-remove-${r.symbol}`}
              ><Trash2 className="w-3 h-3" /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
