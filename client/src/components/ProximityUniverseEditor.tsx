// ─── ProximityUniverseEditor ───────────────────────────────────────────────
// Operator-editable ticker list that drives /api/proximity-watch.
// Presented as a modal drawer opened from ProximityWatchPanel's "Edit" button.
//
// Capabilities:
//  - Add any ticker from the web (validation is delegated to the market-data
//    provider; unknown tickers still get stored and simply return REJECTED with
//    reason on the next scan, so nothing is silently lost).
//  - Edit kind (etf/stock), sort order, notes.
//  - Archive (soft-delete) — hidden from scans, kept in DB.
//  - Restore — un-archive or un-dismiss.
//  - Hard delete — removes permanently (used only when the user truly wants it).
//
// Grouped by kind for clarity: ETFs first, then single stocks.

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Plus, Archive, RotateCcw, Trash2, Edit2, X, Check } from "lucide-react";

export interface ProximityUniverseRow {
  id: string;
  ticker: string;
  kind: "etf" | "stock";
  status: "active" | "archived" | "dismissed";
  sortOrder: number;
  notes: string;
  dismissedAt: string | null;
  dismissalReason: string;
  lastStatus: string;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ProximityUniverseEditor({ open, onClose }: Props) {
  const [showArchived, setShowArchived] = useState(false);
  const [newTicker, setNewTicker] = useState("");
  const [newKind, setNewKind] = useState<"etf" | "stock">("stock");
  const [newNotes, setNewNotes] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editKind, setEditKind] = useState<"etf" | "stock">("etf");
  const [editSort, setEditSort] = useState<string>("100");
  const [editNotes, setEditNotes] = useState("");

  const listQ = useQuery<ProximityUniverseRow[]>({
    queryKey: ["/api/proximity-universe", showArchived ? "archived" : "active"],
    queryFn: async () => {
      const url = showArchived
        ? "/api/proximity-universe?includeArchived=true&includeDismissed=true"
        : "/api/proximity-universe";
      const r = await apiRequest("GET", url);
      return r.json();
    },
    enabled: open,
  });

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["/api/proximity-universe"] });
    queryClient.invalidateQueries({ queryKey: ["/api/proximity-watch"] });
  }

  const addMut = useMutation({
    mutationFn: async () => {
      const symbol = newTicker.trim().toUpperCase();
      if (!symbol) throw new Error("Ticker required");
      const r = await apiRequest("POST", "/api/proximity-universe", {
        ticker: symbol,
        kind: newKind,
        sortOrder: newKind === "etf" ? 60 : 200,
        notes: newNotes,
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      setNewTicker("");
      setNewNotes("");
      invalidateAll();
    },
  });

  const patchMut = useMutation({
    mutationFn: async (payload: { id: string; patch: Partial<ProximityUniverseRow> }) => {
      const r = await apiRequest("PATCH", `/api/proximity-universe/${payload.id}`, payload.patch);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      setEditingId(null);
      invalidateAll();
    },
  });

  const archiveMut = useMutation({
    mutationFn: async (id: string) => {
      const r = await apiRequest("POST", `/api/proximity-universe/${id}/archive`);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: invalidateAll,
  });

  const restoreMut = useMutation({
    mutationFn: async (id: string) => {
      const r = await apiRequest("POST", `/api/proximity-universe/${id}/restore`);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: invalidateAll,
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const r = await apiRequest("DELETE", `/api/proximity-universe/${id}`);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: invalidateAll,
  });

  function startEdit(row: ProximityUniverseRow) {
    setEditingId(row.id);
    setEditKind(row.kind);
    setEditSort(String(row.sortOrder));
    setEditNotes(row.notes ?? "");
  }

  function submitEdit(id: string) {
    patchMut.mutate({
      id,
      patch: {
        kind: editKind,
        sortOrder: Number(editSort) || 100,
        notes: editNotes,
      } as any,
    });
  }

  if (!open) return null;

  const rows = listQ.data ?? [];
  const etfs = rows.filter((r) => r.kind === "etf");
  const stocks = rows.filter((r) => r.kind === "stock");

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
      data-testid="drawer-universe-editor"
    >
      <div
        className="max-w-3xl w-full bg-ink-black border border-ink-line rounded-md p-4 my-8 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-soft-white uppercase tracking-wide">Proximity Universe</h3>
            <p className="text-xs text-slate-gray mt-1">
              Add any ticker from the web. Archive removes from scans. Dismissed tickers auto-return when they leave NO TRADE.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-xs px-2 py-1 rounded border border-ink-line text-slate-gray hover:text-soft-white"
            data-testid="button-close-universe-editor"
          >
            Close
          </button>
        </div>

        {/* Add form */}
        <div className="rounded-md border border-ink-line bg-ink-deep p-3 space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-neon-blue">Add ticker</div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={newTicker}
              onChange={(e) => setNewTicker(e.target.value.toUpperCase())}
              placeholder="TICKER"
              maxLength={10}
              className="w-24 text-sm font-mono px-2 py-1.5 rounded border border-ink-line bg-ink-black text-soft-white uppercase focus:border-neon-blue outline-none"
              data-testid="input-new-ticker"
            />
            <div className="flex rounded border border-ink-line overflow-hidden">
              <button
                type="button"
                onClick={() => setNewKind("etf")}
                className={`text-xs px-3 py-1.5 ${newKind === "etf" ? "bg-neon-blue/10 text-neon-blue" : "text-slate-gray hover:text-soft-white"}`}
                data-testid="button-newkind-etf"
              >
                ETF
              </button>
              <button
                type="button"
                onClick={() => setNewKind("stock")}
                className={`text-xs px-3 py-1.5 border-l border-ink-line ${newKind === "stock" ? "bg-neon-blue/10 text-neon-blue" : "text-slate-gray hover:text-soft-white"}`}
                data-testid="button-newkind-stock"
              >
                Stock
              </button>
            </div>
            <input
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              placeholder="Notes (optional)"
              maxLength={200}
              className="flex-1 min-w-[160px] text-xs px-2 py-1.5 rounded border border-ink-line bg-ink-black text-soft-white focus:border-neon-blue outline-none"
              data-testid="input-new-notes"
            />
            <button
              type="button"
              onClick={() => addMut.mutate()}
              disabled={!newTicker.trim() || addMut.isPending}
              className="text-xs px-3 py-1.5 rounded border border-signal-green text-signal-green hover:bg-signal-green/10 disabled:opacity-50 flex items-center gap-1"
              data-testid="button-add-ticker"
            >
              <Plus className="h-3 w-3" /> {addMut.isPending ? "Adding..." : "Add"}
            </button>
          </div>
          {addMut.error && (
            <div className="text-[10px] text-signal-red">{(addMut.error as Error).message}</div>
          )}
        </div>

        {/* Toggle archived */}
        <div className="flex items-center gap-3">
          <label className="text-xs text-slate-gray flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="accent-neon-blue"
              data-testid="checkbox-show-archived"
            />
            Show archived & dismissed
          </label>
        </div>

        {/* List — grouped */}
        {listQ.isLoading ? (
          <div className="p-6 text-center text-xs text-slate-gray">Loading...</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-gray">No tickers yet — add one above.</div>
        ) : (
          <div className="space-y-4">
            <UniverseGroup
              title="ETFs"
              rows={etfs}
              editingId={editingId}
              editKind={editKind}
              editSort={editSort}
              editNotes={editNotes}
              onKindChange={setEditKind}
              onSortChange={setEditSort}
              onNotesChange={setEditNotes}
              onStartEdit={startEdit}
              onSubmitEdit={submitEdit}
              onCancelEdit={() => setEditingId(null)}
              onArchive={(id) => archiveMut.mutate(id)}
              onRestore={(id) => restoreMut.mutate(id)}
              onDelete={(id) => {
                if (confirm("Permanently delete this ticker? Archive is usually enough.")) {
                  deleteMut.mutate(id);
                }
              }}
            />
            <UniverseGroup
              title="Single stocks"
              rows={stocks}
              editingId={editingId}
              editKind={editKind}
              editSort={editSort}
              editNotes={editNotes}
              onKindChange={setEditKind}
              onSortChange={setEditSort}
              onNotesChange={setEditNotes}
              onStartEdit={startEdit}
              onSubmitEdit={submitEdit}
              onCancelEdit={() => setEditingId(null)}
              onArchive={(id) => archiveMut.mutate(id)}
              onRestore={(id) => restoreMut.mutate(id)}
              onDelete={(id) => {
                if (confirm("Permanently delete this ticker? Archive is usually enough.")) {
                  deleteMut.mutate(id);
                }
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── UniverseGroup ─────────────────────────────────────────────────────────
interface GroupProps {
  title: string;
  rows: ProximityUniverseRow[];
  editingId: string | null;
  editKind: "etf" | "stock";
  editSort: string;
  editNotes: string;
  onKindChange: (k: "etf" | "stock") => void;
  onSortChange: (s: string) => void;
  onNotesChange: (n: string) => void;
  onStartEdit: (row: ProximityUniverseRow) => void;
  onSubmitEdit: (id: string) => void;
  onCancelEdit: () => void;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
}

function UniverseGroup(p: GroupProps) {
  if (p.rows.length === 0) return null;
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-gray mb-2">
        {p.title} · {p.rows.length}
      </div>
      <div className="space-y-1">
        {p.rows.map((row) => {
          const isEditing = p.editingId === row.id;
          const statusColor =
            row.status === "active" ? "text-signal-green" :
            row.status === "dismissed" ? "text-signal-amber" :
            "text-signal-red";
          return (
            <div
              key={row.id}
              className="flex items-center gap-2 rounded border border-ink-line bg-ink-deep p-2"
              data-testid={`universe-row-${row.ticker}`}
            >
              <span className="w-16 text-sm font-mono font-bold text-soft-white">{row.ticker}</span>
              {isEditing ? (
                <>
                  <div className="flex rounded border border-ink-line overflow-hidden">
                    <button
                      type="button"
                      onClick={() => p.onKindChange("etf")}
                      className={`text-[10px] px-2 py-1 ${p.editKind === "etf" ? "bg-neon-blue/10 text-neon-blue" : "text-slate-gray"}`}
                    >
                      ETF
                    </button>
                    <button
                      type="button"
                      onClick={() => p.onKindChange("stock")}
                      className={`text-[10px] px-2 py-1 border-l border-ink-line ${p.editKind === "stock" ? "bg-neon-blue/10 text-neon-blue" : "text-slate-gray"}`}
                    >
                      Stock
                    </button>
                  </div>
                  <input
                    type="number"
                    value={p.editSort}
                    onChange={(e) => p.onSortChange(e.target.value)}
                    className="w-16 text-xs px-2 py-1 rounded border border-ink-line bg-ink-black text-soft-white outline-none focus:border-neon-blue"
                    data-testid={`input-sort-${row.ticker}`}
                  />
                  <input
                    value={p.editNotes}
                    onChange={(e) => p.onNotesChange(e.target.value)}
                    placeholder="Notes"
                    className="flex-1 text-xs px-2 py-1 rounded border border-ink-line bg-ink-black text-soft-white outline-none focus:border-neon-blue"
                    data-testid={`input-notes-${row.ticker}`}
                  />
                  <button
                    type="button"
                    onClick={() => p.onSubmitEdit(row.id)}
                    className="text-xs px-2 py-1 rounded border border-signal-green text-signal-green hover:bg-signal-green/10 flex items-center gap-1"
                    data-testid={`button-save-${row.ticker}`}
                  >
                    <Check className="h-3 w-3" /> Save
                  </button>
                  <button
                    type="button"
                    onClick={p.onCancelEdit}
                    className="text-xs px-2 py-1 rounded border border-ink-line text-slate-gray hover:text-soft-white"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </>
              ) : (
                <>
                  <span className="w-16 text-[10px] uppercase text-slate-gray">{row.kind}</span>
                  <span className={`w-20 text-[10px] uppercase font-bold ${statusColor}`}>
                    {row.status}
                  </span>
                  <span className="w-14 text-[10px] font-mono text-slate-gray">
                    #{row.sortOrder}
                  </span>
                  <span className="flex-1 text-[11px] text-slate-gray truncate" title={row.notes}>
                    {row.status === "dismissed" && row.dismissalReason
                      ? `Dismissed: ${row.dismissalReason}`
                      : row.notes || "\u00A0"}
                  </span>
                  <button
                    type="button"
                    onClick={() => p.onStartEdit(row)}
                    className="text-[10px] px-2 py-1 rounded border border-ink-line text-slate-gray hover:text-neon-blue hover:border-neon-blue flex items-center gap-1"
                    data-testid={`button-edit-${row.ticker}`}
                  >
                    <Edit2 className="h-3 w-3" /> Edit
                  </button>
                  {row.status === "active" ? (
                    <button
                      type="button"
                      onClick={() => p.onArchive(row.id)}
                      className="text-[10px] px-2 py-1 rounded border border-ink-line text-slate-gray hover:text-signal-amber hover:border-signal-amber flex items-center gap-1"
                      data-testid={`button-archive-${row.ticker}`}
                    >
                      <Archive className="h-3 w-3" /> Archive
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => p.onRestore(row.id)}
                      className="text-[10px] px-2 py-1 rounded border border-ink-line text-slate-gray hover:text-signal-green hover:border-signal-green flex items-center gap-1"
                      data-testid={`button-restore-${row.ticker}`}
                    >
                      <RotateCcw className="h-3 w-3" /> Restore
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => p.onDelete(row.id)}
                    className="text-[10px] px-2 py-1 rounded border border-ink-line text-slate-gray hover:text-signal-red hover:border-signal-red"
                    title="Permanently delete"
                    data-testid={`button-delete-${row.ticker}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
