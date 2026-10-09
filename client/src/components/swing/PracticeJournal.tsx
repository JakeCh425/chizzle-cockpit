// Journal → Practice Journal tab. Lists every swing_journal entry (all symbols) so a
// "Save to Journal" from a Trading Card is visible where the user looks for it.
// PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE. Nothing here is an order.
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { Panel } from "@/components/Panel";
import { queryClient } from "@/lib/queryClient";
import { fmtCT, swingGet, swingSend } from "@/lib/swing";
import { JOURNAL_KEY, type JournalEntry } from "@/lib/journal";
import { useToast } from "@/hooks/use-toast";
import { PRACTICE_BANNER } from "@shared/swingDecision";

const ACTION_LABEL: Record<string, string> = {
  PRACTICE_TRADE: "Practice Trade Plan", WATCH: "Watch", OBSERVED: "Observed", MISSED: "Missed", DO_NOT_TAKE: "Do Not Take", NOTE: "Note",
  ARMED: "Armed (practice)", FILLED: "Marked filled (practice)", CLOSED: "Closed (practice)", CANCELLED: "Cancelled",
};
const pretty = (t: string | null) => (t ? t.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : null);
const $ = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(2));

export function PracticeJournal() {
  const { toast } = useToast();
  const [sym, setSym] = useState<string>("ALL");
  const q = useQuery<JournalEntry[]>({ queryKey: [...JOURNAL_KEY], queryFn: () => swingGet("/api/swing/journal"), staleTime: 15_000 });
  const remove = useMutation({
    mutationFn: (id: number) => swingSend<any>("DELETE", `/api/swing/journal/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: [...JOURNAL_KEY] }); toast({ title: "Journal entry deleted" }); },
    onError: (e: any) => toast({ title: "Delete failed", description: e?.body?.error ?? e.message, variant: "destructive" }),
  });
  const symbols = useMemo(() => Array.from(new Set((q.data ?? []).map((j) => j.symbol))).sort(), [q.data]);
  const rows = (q.data ?? []).filter((j) => sym === "ALL" || j.symbol === sym);

  return (
    <div className="space-y-3" data-testid="panel-practice-journal">
      <div className="text-[10px] uppercase tracking-wider text-amber-300/90" data-testid="text-practice-journal-banner">{PRACTICE_BANNER}</div>
      <Panel title="Practice Journal" hint={q.data ? `${rows.length} ${rows.length === 1 ? "entry" : "entries"}` : "Loading…"}>
        <div className="flex flex-wrap items-center gap-1 mb-2">
          {["ALL", ...symbols].map((s) => (
            <button key={s} onClick={() => setSym(s)} data-testid={`button-pj-filter-${s}`}
              className={`px-2 py-0.5 text-[10px] uppercase tracking-wider rounded-sm border ${sym === s ? "border-neon-blue text-neon-blue" : "border-ink-line text-slate-gray hover:text-soft-white"}`}>{s}</button>
          ))}
        </div>
        {q.isLoading ? <div className="text-[12px] text-slate-gray py-4">Loading practice journal…</div>
          : q.isError ? <div className="text-[12px] text-signal-red py-4" data-testid="text-pj-error">Could not load the journal: {(q.error as any)?.message ?? "error"}</div>
          : rows.length === 0 ? <div className="text-[12px] text-slate-gray py-4" data-testid="text-pj-empty">No practice journal entries yet. Use "Save to Journal" on a Ready trading card, or the journal buttons in the Why panel.</div>
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-[11.5px]" data-testid="table-practice-journal">
                <thead className="text-[10px] uppercase tracking-wider text-slate-gray">
                  <tr className="text-left border-b border-ink-line">
                    <th className="py-1 pr-2">When (CT)</th><th className="pr-2">Symbol</th><th className="pr-2">Action</th><th className="pr-2">Setup</th>
                    <th className="pr-2 text-right">Entry</th><th className="pr-2 text-right">Stop</th><th className="pr-2 text-right">T1</th><th className="pr-2 text-right">T2</th><th className="pr-2 text-right">Planned $ risk</th><th className="pr-2">Notes</th><th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-line">
                  {rows.map((j) => (
                    <tr key={j.id} data-testid={`row-pj-${j.id}`}>
                      <td className="py-1 pr-2 whitespace-nowrap text-slate-gray">{fmtCT(j.createdAt)}</td>
                      <td className="pr-2 font-mono text-soft-white">{j.symbol}</td>
                      <td className="pr-2">{ACTION_LABEL[j.action] ?? j.action}</td>
                      <td className="pr-2 text-slate-gray">{[pretty(j.setupType), j.grade ? `Grade ${j.grade}` : null, j.decision?.journalMeta?.planLabel].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="pr-2 text-right font-mono">{$(j.entry)}</td><td className="pr-2 text-right font-mono">{$(j.stop)}</td>
                      <td className="pr-2 text-right font-mono">{$(j.target1)}</td><td className="pr-2 text-right font-mono">{$(j.target2)}</td>
                      <td className="pr-2 text-right font-mono">{j.plannedRisk != null ? `$${j.plannedRisk.toFixed(0)}` : "—"}</td>
                      <td className="pr-2 max-w-[28ch] truncate text-slate-gray" title={[j.notes, j.lesson].filter(Boolean).join(" — ")}>{[j.notes, j.lesson].filter(Boolean).join(" — ") || "—"}</td>
                      <td className="text-right"><button className="p-1 text-slate-gray hover:text-signal-red" aria-label="Delete journal entry" disabled={remove.isPending} onClick={() => remove.mutate(j.id)} data-testid={`button-pj-delete-${j.id}`}><Trash2 className="h-3.5 w-3.5" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Panel>
    </div>
  );
}
