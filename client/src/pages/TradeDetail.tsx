// Phase 2 — Trade Detail page (/trade/:id).
// Three panels: plan summary · executions (log form + list) · realized stats.
// Reads `tradePlan` and its `executions` via React Query, derives status &
// realized P&L on the fly using shared/executions.ts. The server persists the
// same status on writes so the planner list stays consistent.

import { useMemo } from "react";
import { Link, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Panel, Chip, StatRow } from "@/components/Panel";
import { ExecutionLogForm } from "@/components/ExecutionLogForm";
import { ExecutionsList } from "@/components/ExecutionsList";
import { TradeReviewForm } from "@/components/TradeReviewForm";
import { TagPicker } from "@/components/TagPicker";
import { calcExecutionStats, formatHoldingDuration } from "@shared/executions";
import type { TradePlan, TradeExecution, TradePlanStatus, TradeReview } from "@shared/schema";
import { calcRR } from "@/lib/positionSize";

function statusTone(s: TradePlanStatus): "blue" | "green" | "amber" | "red" | "neutral" {
  switch (s) {
    case "planned":   return "blue";
    case "open":      return "blue";
    case "partial":   return "amber";
    case "closed":    return "green";
    case "cancelled": return "red";
    default:          return "neutral";
  }
}

function fmtMoney(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}
function fmtSignedMoney(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "−";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

export default function TradeDetail() {
  const [, params] = useRoute<{ id: string }>("/trade/:id");
  const id = params?.id ?? "";

  // Default queryFn joins the queryKey array with '/' and routes through API_BASE,
  // so the URL rewriting works after deployment. No custom queryFn needed.
  const planQ = useQuery<TradePlan>({
    queryKey: ["/api/trade-plans", id],
    enabled: !!id,
  });

  const execsQ = useQuery<TradeExecution[]>({
    queryKey: ["/api/trade-plans", id, "executions"],
    enabled: !!id,
  });

  // Phase 3: review (null if not yet written).
  const reviewQ = useQuery<TradeReview | null>({
    queryKey: ["/api/trade-plans", id, "review"],
    enabled: !!id,
  });

  const direction: "long" | "short" =
    planQ.data?.direction === "short" ? "short" : "long";

  const stats = useMemo(
    () => calcExecutionStats(execsQ.data ?? [], direction),
    [execsQ.data, direction],
  );

  // Display status = persisted plan.status, falling back to derived. The server
  // already syncs them, but `derivedStatus` is a safe display when 'planned'
  // hasn't been touched yet.
  const displayStatus: TradePlanStatus =
    (planQ.data?.status as TradePlanStatus | undefined) ?? stats.derivedStatus;

  if (planQ.isLoading) {
    return <div className="p-4 text-[12px] text-slate-gray" data-testid="text-detail-loading">Loading trade…</div>;
  }
  if (planQ.error || !planQ.data) {
    return (
      <div className="p-4 text-[12px] text-signal-red" data-testid="text-detail-error">
        Could not load this trade plan.{" "}
        <Link href="/trade-planner" className="underline text-neon-blue">Back to planner</Link>.
      </div>
    );
  }

  const plan = planQ.data;
  const rr = calcRR(
    Number(plan.entryPrice),
    Number(plan.stopPrice),
    plan.targetPrice == null ? null : Number(plan.targetPrice),
  );

  const pnlTone =
    stats.netRealizedPnl > 0 ? "text-signal-green" :
    stats.netRealizedPnl < 0 ? "text-signal-red"   : "text-soft-white";

  return (
    <div className="p-4 space-y-3" data-testid="page-trade-detail">
      {/* ── Back link + page title ────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-3 min-w-0">
          <Link
            href="/trade-planner"
            className="text-[11px] uppercase tracking-wider text-slate-gray hover:text-neon-blue"
            data-testid="link-back-planner"
          >
            ← Back to Planner
          </Link>
          <span className="font-display text-[14px] text-soft-white truncate" data-testid="text-detail-ticker">
            {plan.ticker}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-slate-gray">{plan.setupType}</span>
          <Chip tone={plan.direction === "long" ? "green" : "red"}>{plan.direction}</Chip>
          <Chip tone={statusTone(displayStatus)}>{displayStatus}</Chip>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* ── Plan summary ─────────────────────────────────────────────── */}
        <Panel title="Plan">
          <div className="space-y-0.5">
            <StatRow label="Entry"   value={fmtMoney(Number(plan.entryPrice))} />
            <StatRow label="Stop"    value={fmtMoney(Number(plan.stopPrice))} />
            <StatRow label="Target"  value={plan.targetPrice == null ? "—" : fmtMoney(Number(plan.targetPrice))} />
            <StatRow label="Planned R:R" value={rr == null ? "—" : `${rr.toFixed(2)}R`} />
            <StatRow label="Risk %"  value={`${Number(plan.riskPercent).toFixed(2)}%`} />
            <StatRow label="Planned Shares" value={plan.plannedShares.toLocaleString()} valueClassName="text-neon-blue" />
          </div>
          {plan.thesis && (
            <div className="mt-3 pt-2 border-t border-ink-line/60">
              <div className="text-[10px] uppercase tracking-wider text-slate-gray mb-1">Thesis</div>
              <p className="text-[12px] text-soft-white whitespace-pre-wrap" data-testid="text-detail-thesis">
                {plan.thesis}
              </p>
            </div>
          )}
        </Panel>

        {/* ── Executions (log + list) ──────────────────────────────────── */}
        <Panel
          title="Executions"
          hint={`${stats.totalEnteredShares} in · ${stats.totalExitedShares} out · ${stats.remainingShares} open`}
          className="lg:col-span-2"
        >
          <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] gap-4">
            <div>
              {execsQ.error ? (
                <div className="text-[12px] text-signal-red" data-testid="text-executions-error">
                  Could not load executions.
                </div>
              ) : (
                <ExecutionsList
                  planId={plan.id}
                  executions={execsQ.data ?? []}
                  isLoading={execsQ.isLoading}
                  disabled={plan.status === "cancelled"}
                />
              )}
            </div>
            <div className="border-l border-ink-line/60 pl-4">
              <div className="text-[10px] uppercase tracking-wider text-slate-gray mb-2">
                Log Execution
              </div>
              <ExecutionLogForm plan={plan} stats={stats} />
            </div>
          </div>
        </Panel>
      </div>

      {/* ── Realized stats panel ───────────────────────────────────────── */}
      <Panel title="Realized">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3" data-testid="block-realized-stats">
          <Stat label="Entered" value={stats.totalEnteredShares.toLocaleString()} accent="neon-blue" />
          <Stat label="Exited"  value={stats.totalExitedShares.toLocaleString()} />
          <Stat label="Remaining" value={stats.remainingShares.toLocaleString()} accent={stats.remainingShares > 0 ? "amber" : undefined} />
          <Stat label="Avg Entry" value={fmtMoney(stats.avgEntryPrice)} />
          <Stat label="Avg Exit"  value={fmtMoney(stats.avgExitPrice)} />
          <Stat label="Gross P&L" value={fmtSignedMoney(stats.grossRealizedPnl)} className={pnlTone} testId="text-gross-pnl" />
          <Stat label="Net P&L"   value={fmtSignedMoney(stats.netRealizedPnl)}   className={pnlTone} testId="text-net-pnl" />
          <Stat label="Holding"   value={formatHoldingDuration(stats.holdingDurationMs)} />
        </div>
        {stats.totalFees > 0 && (
          <div className="mt-2 text-[10px] text-slate-gray" data-testid="text-total-fees">
            Total fees: ${stats.totalFees.toFixed(2)}
          </div>
        )}
      </Panel>

      {/* ── Review panel (Phase 3) ──────────────────────────────────── */}
      <Panel
        title="Review"
        hint={reviewQ.data ? "Last updated " + new Date(reviewQ.data.updatedAt).toLocaleString() : "Not yet reviewed"}
      >
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
          <div>
            {reviewQ.isLoading ? (
              <div className="text-[12px] text-slate-gray" data-testid="text-review-loading">Loading review…</div>
            ) : reviewQ.error ? (
              <div className="text-[12px] text-signal-red" data-testid="text-review-error">
                Could not load review.
              </div>
            ) : (
              <TradeReviewForm
                planId={plan.id}
                existing={reviewQ.data ?? null}
                disabledReason={
                  (execsQ.data ?? []).length === 0
                    ? "Log at least one execution before writing a review."
                    : undefined
                }
              />
            )}
          </div>
          <div className="lg:border-l lg:border-ink-line/60 lg:pl-4">
            <TagPicker planId={plan.id} reviewExists={!!reviewQ.data} />
            <div className="mt-4 pt-2 border-t border-ink-line/60">
              <Link
                href="/tags"
                data-testid="link-manage-tags"
                className="text-[11px] text-neon-blue hover:underline"
              >
                Manage all tags →
              </Link>
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  className,
  testId,
}: {
  label: string;
  value: string;
  accent?: "neon-blue" | "amber" | "green";
  className?: string;
  testId?: string;
}) {
  const accentCls =
    accent === "neon-blue" ? "text-neon-blue" :
    accent === "amber"     ? "text-signal-amber" :
    accent === "green"     ? "text-signal-green" : "text-soft-white";
  return (
    <div className="border border-ink-line rounded-sm px-3 py-2">
      <div className="text-[9px] uppercase tracking-wider text-slate-gray mb-0.5">{label}</div>
      <div
        className={`font-mono-num tabular-nums text-[14px] font-semibold ${className ?? accentCls}`}
        data-testid={testId}
      >
        {value}
      </div>
    </div>
  );
}
