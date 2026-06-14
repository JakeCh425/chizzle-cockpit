// Phase 2 — Compact form for logging a single execution against a trade plan.
// Reuses shadcn primitives and the existing planner styling. No react-hook-form;
// local state is enough for this surface and matches the rest of the app.

import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { errMsg } from "@/lib/errors";
import {
  validateExecution,
  isExitType,
  type ExecutionStats,
} from "@shared/executions";
import {
  EXECUTION_TYPES,
  type ExecutionType,
  type TradePlan,
} from "@shared/schema";

const TYPE_LABELS: Record<ExecutionType, string> = {
  entry: "Entry",
  add: "Add",
  partial_exit: "Partial Exit",
  exit: "Final Exit",
};

interface Props {
  plan: TradePlan;
  stats: ExecutionStats;
}

/** datetime-local needs `YYYY-MM-DDTHH:MM` in local time. */
function nowLocalForInput(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ExecutionLogForm({ plan, stats }: Props) {
  const { toast } = useToast();

  // Sensible default execution type based on current state:
  //   no entries yet     → entry
  //   shares remaining   → partial_exit
  //   all out (closed)   → form disabled below; type doesn't matter
  const defaultType: ExecutionType = useMemo(() => {
    if (stats.totalEnteredShares === 0) return "entry";
    if (stats.remainingShares > 0) return "partial_exit";
    return "exit";
  }, [stats.totalEnteredShares, stats.remainingShares]);

  const [executionType, setExecutionType] = useState<ExecutionType>(defaultType);
  const [sharesStr, setSharesStr] = useState<string>("");
  const [priceStr, setPriceStr] = useState<string>("");
  const [feesStr, setFeesStr] = useState<string>("");
  const [executedAt, setExecutedAt] = useState<string>(nowLocalForInput());
  const [notes, setNotes] = useState<string>("");
  const [inlineError, setInlineError] = useState<string | null>(null);

  // When the underlying stats change (e.g. a new execution lands), retarget the
  // default type, but only if the user hasn't typed anything yet.
  useEffect(() => {
    if (sharesStr === "" && priceStr === "" && notes === "") {
      setExecutionType(defaultType);
    }
  }, [defaultType, sharesStr, priceStr, notes]);

  const isClosed = stats.derivedStatus === "closed";
  const isCancelled = plan.status === "cancelled";
  const disableAll = isClosed || isCancelled;

  const shares = Number(sharesStr);
  const price = Number(priceStr);
  const fees = feesStr.trim() === "" ? 0 : Number(feesStr);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/trade-plans/${plan.id}/executions`, {
        executionType,
        shares,
        price,
        fees,
        executedAt: new Date(executedAt).toISOString(),
        notes: notes.trim(),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trade-plans", plan.id, "executions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trade-plans", plan.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/trade-plans"] });
      toast({ title: "Execution logged", description: `${TYPE_LABELS[executionType]} · ${shares} @ $${price.toFixed(2)}` });
      setSharesStr("");
      setPriceStr("");
      setFeesStr("");
      setNotes("");
      setExecutedAt(nowLocalForInput());
      setInlineError(null);
    },
    onError: (e: any) => {
      const msg = errMsg(e);
      setInlineError(msg);
      toast({ title: "Could not log execution", description: msg, variant: "destructive" });
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disableAll) return;

    const clientError = validateExecution(
      { executionType, shares, price, fees },
      stats,
    );
    if (clientError) {
      setInlineError(clientError);
      return;
    }
    if (!executedAt) {
      setInlineError("Execution date/time is required.");
      return;
    }
    setInlineError(null);
    mutation.mutate();
  }

  if (isCancelled) {
    return (
      <div className="text-[12px] text-slate-gray" data-testid="text-form-cancelled">
        This trade plan has been cancelled. No further executions can be logged.
      </div>
    );
  }
  if (isClosed) {
    return (
      <div className="text-[12px] text-slate-gray" data-testid="text-form-closed">
        Trade is closed — no more executions allowed. Delete an exit below to reopen.
      </div>
    );
  }

  const showRemainingHint = isExitType(executionType) && stats.remainingShares > 0;

  return (
    <form onSubmit={onSubmit} className="space-y-2.5" data-testid="form-execution">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-slate-gray">Type</Label>
          <Select value={executionType} onValueChange={(v) => setExecutionType(v as ExecutionType)}>
            <SelectTrigger className="h-8 text-[12px]" data-testid="select-execution-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXECUTION_TYPES.map((t) => (
                <SelectItem key={t} value={t} data-testid={`option-type-${t}`}>
                  {TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-slate-gray">
            Shares {showRemainingHint && <span className="text-slate-gray/70">(max {stats.remainingShares})</span>}
          </Label>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={sharesStr}
            onChange={(e) => setSharesStr(e.target.value)}
            placeholder="e.g. 2"
            className="h-8 font-mono-num tabular-nums text-[12px]"
            data-testid="input-shares"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-slate-gray">Price</Label>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={priceStr}
            onChange={(e) => setPriceStr(e.target.value)}
            placeholder="e.g. 620.00"
            className="h-8 font-mono-num tabular-nums text-[12px]"
            data-testid="input-price"
          />
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-slate-gray">Fees (optional)</Label>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={feesStr}
            onChange={(e) => setFeesStr(e.target.value)}
            placeholder="0.00"
            className="h-8 font-mono-num tabular-nums text-[12px]"
            data-testid="input-fees"
          />
        </div>
      </div>

      <div>
        <Label className="text-[10px] uppercase tracking-wider text-slate-gray">Executed at</Label>
        <Input
          type="datetime-local"
          value={executedAt}
          onChange={(e) => setExecutedAt(e.target.value)}
          className="h-8 font-mono-num tabular-nums text-[12px]"
          data-testid="input-executed-at"
        />
      </div>

      <div>
        <Label className="text-[10px] uppercase tracking-wider text-slate-gray">Notes (optional)</Label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything to remember about this fill"
          rows={2}
          className="text-[12px]"
          data-testid="input-notes"
        />
      </div>

      {inlineError && (
        <div className="text-[11px] text-signal-red" data-testid="text-form-error">
          {inlineError}
        </div>
      )}

      <Button
        type="submit"
        disabled={mutation.isPending || disableAll}
        className="w-full"
        data-testid="button-log-execution"
      >
        {mutation.isPending ? "Logging…" : "Log Execution"}
      </Button>
    </form>
  );
}
