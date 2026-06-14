// Phase 2 — Read-only list of executions for a single trade plan with delete.
// Sorted by executed_at ASC. Matches the Bloomberg-style table density used in
// the planner saved-plans rows.

import { useMutation } from "@tanstack/react-query";
import { Chip } from "@/components/Panel";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { errMsg } from "@/lib/errors";
import { isEntryType, isExitType } from "@shared/executions";
import type { ExecutionType, TradeExecution } from "@shared/schema";

interface Props {
  planId: string;
  executions: TradeExecution[];
  isLoading: boolean;
  disabled?: boolean; // e.g. when plan.status === "cancelled"
}

const TYPE_SHORT: Record<ExecutionType, string> = {
  entry: "ENTRY",
  add: "ADD",
  partial_exit: "PARTIAL",
  exit: "EXIT",
};

function fmtTime(ts: string | Date): string {
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ExecutionsList({ planId, executions, isLoading, disabled }: Props) {
  const { toast } = useToast();

  const deleteMutation = useMutation({
    mutationFn: async (executionId: string) => {
      const res = await apiRequest(
        "DELETE",
        `/api/trade-plans/${planId}/executions/${executionId}`,
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trade-plans", planId, "executions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trade-plans", planId] });
      queryClient.invalidateQueries({ queryKey: ["/api/trade-plans"] });
      toast({ title: "Execution removed" });
    },
    onError: (e: any) =>
      toast({ title: "Delete failed", description: errMsg(e), variant: "destructive" }),
  });

  function onDelete(executionId: string) {
    if (deleteMutation.isPending) return;
    const ok = typeof window === "undefined"
      ? true
      : window.confirm("Delete this execution? Plan status will be recomputed.");
    if (!ok) return;
    deleteMutation.mutate(executionId);
  }

  if (isLoading) {
    return <div className="text-[12px] text-slate-gray" data-testid="text-executions-loading">Loading executions…</div>;
  }
  if (executions.length === 0) {
    return (
      <div className="text-[12px] text-slate-gray" data-testid="text-executions-empty">
        No executions yet. Log the first fill on the right.
      </div>
    );
  }

  return (
    <div className="space-y-1" data-testid="list-executions">
      {/* Header */}
      <div className="grid grid-cols-[8rem_4.5rem_3rem_5rem_4rem_1fr_1.5rem] gap-2 px-2 py-1 text-[9px] uppercase tracking-wider text-slate-gray border-b border-ink-line">
        <span>Time</span>
        <span>Type</span>
        <span className="text-right">Shares</span>
        <span className="text-right">Price</span>
        <span className="text-right">Fees</span>
        <span>Notes</span>
        <span />
      </div>
      {executions.map((e) => {
        const type = e.executionType as ExecutionType;
        const tone: "green" | "amber" | "red" | "neutral" = isEntryType(type)
          ? "green"
          : isExitType(type)
          ? "amber"
          : "neutral";
        return (
          <div
            key={e.id}
            className="grid grid-cols-[8rem_4.5rem_3rem_5rem_4rem_1fr_1.5rem] gap-2 items-center px-2 py-1.5 text-[11px] font-mono-num tabular-nums border-b border-ink-line/40 last:border-b-0"
            data-testid={`row-execution-${e.id}`}
          >
            <span className="text-soft-white">{fmtTime(e.executedAt)}</span>
            <Chip tone={tone}>{TYPE_SHORT[type] ?? type}</Chip>
            <span className="text-right text-soft-white">{Number(e.shares).toLocaleString()}</span>
            <span className="text-right text-soft-white">${Number(e.price).toFixed(2)}</span>
            <span className="text-right text-slate-gray">
              {Number(e.fees) > 0 ? `$${Number(e.fees).toFixed(2)}` : "—"}
            </span>
            <span className="text-slate-gray truncate" title={e.notes || undefined}>
              {e.notes || "—"}
            </span>
            <button
              type="button"
              onClick={() => onDelete(e.id)}
              disabled={disabled || deleteMutation.isPending}
              className="text-slate-gray hover:text-signal-red disabled:opacity-40 disabled:hover:text-slate-gray text-[12px] leading-none"
              title="Delete execution"
              data-testid={`button-delete-execution-${e.id}`}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
