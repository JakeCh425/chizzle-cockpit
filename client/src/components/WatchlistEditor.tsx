// ─────────────────────────────────────────────────────────────────────────────
// WatchlistEditor.tsx
// Compact CRUD panel for the mini-chart watchlist with archive/restore.
//   Add      → POST   /api/watchlist            { symbol }
//   Archive  → DELETE /api/watchlist/:id            (soft-delete, restorable)
//   Restore  → POST   /api/watchlist/:id/restore
//   Purge    → DELETE /api/watchlist/:id?purge=1    (hard-delete from archive)
//   Reorder  → POST   /api/watchlist/reorder    { ids: number[] }
//
// Persistence:
//   - Server-backed (Neon Postgres). The seed marker in kv_meta ensures the
//     default 6 tickers are never re-seeded after the first boot, so
//     deletions persist across deploys/restarts.
//   - Archive is the default delete action — destructive purge is opt-in
//     from the Archived section after a second confirmation.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Ticker, WatchlistItem } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ArrowDown, ArrowUp, Plus, Trash2, Zap, RotateCcw, X, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Props { className?: string; }

const SYMBOL_RE = /^[A-Z0-9.\-]{1,12}$/;

interface Row {
  id: number;
  tickerId: number;
  symbol: string;
}

// Simple 300ms debounce hook — used to soften the add-input filter
// against the case-insensitive duplicate check on every keystroke.
function useDebouncedValue<T>(value: T, ms: number): T {
  const [v, setV] = useState<T>(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

export default function WatchlistEditor({ className = "" }: Props) {
  const { toast } = useToast();
  const [input, setInput] = useState<string>("");
  const debouncedInput = useDebouncedValue(input, 300);
  const [showArchived, setShowArchived] = useState<boolean>(false);
  const [pendingRemove, setPendingRemove] = useState<Row | null>(null);
  const [pendingPurge, setPendingPurge] = useState<{ id: number; symbol: string } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const { data: tickers } = useQuery<Ticker[]>({ queryKey: ["/api/tickers"] });
  const { data: watchlist } = useQuery<WatchlistItem[]>({ queryKey: ["/api/watchlist"] });
  const { data: archived } = useQuery<WatchlistItem[]>({
    queryKey: ["/api/watchlist/archived"],
    enabled: showArchived,
  });

  // Compose ordered list of { id, symbol } from watchlist + tickers join.
  const rows = useMemo<Row[]>(() => {
    const byId = new Map<number, string>();
    for (const t of tickers || []) byId.set(t.id, t.symbol);
    return (watchlist || [])
      .map(w => ({ id: w.id, tickerId: w.tickerId, symbol: byId.get(w.tickerId) || "?" }))
      .filter(r => r.symbol !== "?");
  }, [watchlist, tickers]);

  const archivedRows = useMemo<Row[]>(() => {
    const byId = new Map<number, string>();
    for (const t of tickers || []) byId.set(t.id, t.symbol);
    return (archived || [])
      .map(w => ({ id: w.id, tickerId: w.tickerId, symbol: byId.get(w.tickerId) || "?" }))
      .filter(r => r.symbol !== "?");
  }, [archived, tickers]);

  // Soft client-side duplicate hint based on the debounced value — informational only.
  const duplicateHint = useMemo<string | null>(() => {
    const sym = debouncedInput.trim().toUpperCase();
    if (!sym || !SYMBOL_RE.test(sym)) return null;
    if (rows.some(r => r.symbol === sym)) return "Already in watchlist";
    return null;
  }, [debouncedInput, rows]);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
    queryClient.invalidateQueries({ queryKey: ["/api/watchlist/archived"] });
    queryClient.invalidateQueries({ queryKey: ["/api/tickers"] });
  }, []);

  const addM = useMutation({
    mutationFn: async (symbol: string) => {
      const res = await apiRequest("POST", "/api/watchlist", { symbol });
      return res.json();
    },
    onSuccess: () => { setInput(""); invalidate(); toast({ title: "Added", description: "Symbol added to watchlist" }); },
    onError: (err: unknown) => toast({ title: "Add failed", description: (err as Error)?.message || "Could not add symbol", variant: "destructive" }),
  });

  const archiveM = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/watchlist/${id}`, undefined); },
    onSuccess: (_data, id) => {
      invalidate();
      const sym = rows.find(r => r.id === id)?.symbol;
      toast({
        title: sym ? `${sym} archived` : "Removed from watchlist",
        description: "Restore anytime from the Archived section.",
      });
    },
    onError: (err: unknown) => toast({ title: "Remove failed", description: (err as Error)?.message || "Could not remove", variant: "destructive" }),
  });

  const restoreM = useMutation({
    mutationFn: async (id: number) => { await apiRequest("POST", `/api/watchlist/${id}/restore`, undefined); },
    onSuccess: invalidate,
    onError: (err: unknown) => toast({ title: "Restore failed", description: (err as Error)?.message || "Could not restore", variant: "destructive" }),
  });

  const purgeM = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/watchlist/${id}?purge=1`, undefined); },
    onSuccess: invalidate,
    onError: (err: unknown) => toast({ title: "Purge failed", description: (err as Error)?.message || "Could not purge", variant: "destructive" }),
  });

  const reorderM = useMutation({
    mutationFn: async (ids: number[]) => { await apiRequest("POST", "/api/watchlist/reorder", { ids }); },
    onSuccess: invalidate,
    onError: (err: unknown) => toast({ title: "Reorder failed", description: (err as Error)?.message || "Could not reorder", variant: "destructive" }),
  });

  const scanM = useMutation({
    mutationFn: async () => { await apiRequest("POST", "/api/alerts/scan-sma20", undefined); },
    onSuccess: () => {
      toast({ title: "Scan started", description: "SMA20 alert sweep running in background" });
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["/api/alerts"] }), 5000);
    },
    onError: (err: unknown) => toast({ title: "Scan failed", description: (err as Error)?.message || "Could not start scan", variant: "destructive" }),
  });

  const tryAdd = (): void => {
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

  const move = (idx: number, dir: -1 | 1): void => {
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
          aria-label="Run SMA20 alert scan now"
          data-testid="button-scan-sma20"
        >
          <Zap className="w-3 h-3" aria-hidden="true" />
          {scanM.isPending ? "Scanning…" : "Scan now"}
        </button>
      </div>

      {/* Add row */}
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value.toUpperCase())}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); tryAdd(); } }}
          placeholder="ADD SYMBOL"
          spellCheck={false}
          className="flex-1 bg-ink-deep/60 border border-ink-line/80 rounded-sm px-2 py-1 text-[12px] font-mono-num tracking-wider uppercase text-soft-white outline-none focus:border-neon-blue/60"
          data-testid="input-watchlist-symbol"
          aria-label="Add ticker symbol"
          aria-describedby={duplicateHint ? "watchlist-add-hint" : undefined}
        />
        <button
          type="button"
          onClick={tryAdd}
          disabled={addM.isPending || !input.trim()}
          className="px-2 py-1 text-[11px] uppercase tracking-wider border border-ink-line/80 rounded-sm text-soft-white hover:border-neon-blue/60 hover:text-neon-blue transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
          aria-label="Add symbol to watchlist"
          data-testid="button-watchlist-add"
        >
          <Plus className="w-3 h-3" aria-hidden="true" />
          Add
        </button>
      </div>
      {duplicateHint && (
        <div
          id="watchlist-add-hint"
          className="text-[10px] uppercase tracking-wider text-signal-amber pl-0.5"
          role="status"
        >
          {duplicateHint}
        </div>
      )}

      {/* List */}
      <div className="flex flex-col gap-px max-h-[260px] overflow-y-auto">
        {rows.length === 0 && (
          <div className="text-[10px] uppercase tracking-wider text-slate-gray py-3 text-center">
            Empty — add a symbol to begin
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
                aria-label={`Move ${r.symbol} up in the watchlist`}
                data-testid={`button-watchlist-up-${r.symbol}`}
              ><ArrowUp className="w-3 h-3" aria-hidden="true" /></button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === rows.length - 1 || reorderM.isPending}
                className="p-1 text-slate-gray hover:text-neon-blue transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="Move down"
                aria-label={`Move ${r.symbol} down in the watchlist`}
                data-testid={`button-watchlist-down-${r.symbol}`}
              ><ArrowDown className="w-3 h-3" aria-hidden="true" /></button>
              <button
                type="button"
                onClick={() => setPendingRemove(r)}
                disabled={archiveM.isPending}
                className="p-1 text-slate-gray hover:text-signal-red transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="Remove"
                aria-label={`Remove ${r.symbol} from watchlist`}
                data-testid={`button-watchlist-remove-${r.symbol}`}
              ><Trash2 className="w-3 h-3" aria-hidden="true" /></button>
            </div>
          </div>
        ))}
      </div>

      {/* Archived toggle */}
      <button
        type="button"
        onClick={() => setShowArchived(v => !v)}
        className="self-start text-[10px] uppercase tracking-wider text-slate-gray hover:text-neon-blue transition-colors mt-1"
        aria-expanded={showArchived}
        aria-controls="watchlist-archived-section"
        data-testid="button-watchlist-toggle-archived"
      >
        {showArchived ? "Hide" : "Show"} Archived{archived ? ` (${archived.length})` : ""}
      </button>

      {/* Archived list */}
      {showArchived && (
        <div
          id="watchlist-archived-section"
          className="flex flex-col gap-px border-t border-ink-line/40 pt-2 mt-1 max-h-[200px] overflow-y-auto"
        >
          {archivedRows.length === 0 ? (
            <div className="text-[10px] uppercase tracking-wider text-slate-gray py-2 text-center">
              No archived tickers
            </div>
          ) : archivedRows.map(r => (
            <div
              key={r.id}
              className="flex items-center justify-between gap-2 px-2 py-1 border border-ink-line/40 rounded-sm bg-ink-deep/30 opacity-80 hover:opacity-100 transition-opacity"
              data-testid={`row-watchlist-archived-${r.symbol}`}
            >
              <span className="text-[12px] font-mono-num font-semibold uppercase tracking-wider text-slate-gray line-through decoration-1">
                {r.symbol}
              </span>
              <div className="flex items-center gap-px">
                <button
                  type="button"
                  onClick={() => restoreM.mutate(r.id)}
                  disabled={restoreM.isPending}
                  className="p-1 text-slate-gray hover:text-signal-green transition-colors disabled:opacity-30"
                  title="Restore to watchlist"
                  aria-label={`Restore ${r.symbol} to watchlist`}
                  data-testid={`button-watchlist-restore-${r.symbol}`}
                ><RotateCcw className="w-3 h-3" aria-hidden="true" /></button>
                <button
                  type="button"
                  onClick={() => setPendingPurge({ id: r.id, symbol: r.symbol })}
                  disabled={purgeM.isPending}
                  className="p-1 text-slate-gray hover:text-signal-red transition-colors disabled:opacity-30"
                  title="Permanently delete"
                  aria-label={`Permanently delete ${r.symbol}`}
                  data-testid={`button-watchlist-purge-${r.symbol}`}
                ><X className="w-3 h-3" aria-hidden="true" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Archive confirmation */}
      <AlertDialog open={!!pendingRemove} onOpenChange={(open) => { if (!open) setPendingRemove(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display tracking-wider uppercase">
              Remove {pendingRemove?.symbol} from your watchlist?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This can be undone from the Archived section. Open positions referencing {pendingRemove?.symbol} are unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-watchlist-remove-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-watchlist-remove-confirm"
              onClick={() => {
                if (pendingRemove) archiveM.mutate(pendingRemove.id);
                setPendingRemove(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Purge confirmation */}
      <AlertDialog open={!!pendingPurge} onOpenChange={(open) => { if (!open) setPendingPurge(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display tracking-wider uppercase flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-signal-red" aria-hidden="true" />
              Permanently delete {pendingPurge?.symbol}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. The ticker will be removed from your watchlist entirely.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-watchlist-purge-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-watchlist-purge-confirm"
              onClick={() => {
                if (pendingPurge) purgeM.mutate(pendingPurge.id);
                setPendingPurge(null);
              }}
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
