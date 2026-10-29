import React from "react";
import { Sparkles, Zap } from "lucide-react";
import type { SwingDecision } from "@shared/swingDecision";
import type { PlanVersion } from "@shared/practicePlan";
import { effectivePlan } from "@shared/practicePlan";

export function formatCurrency(val: number | null | undefined): string {
  if (val == null || !Number.isFinite(val)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);
}

export interface AIExecutionEngineProps {
  decision: SwingDecision;
  version?: PlanVersion | null;
  onArm?: () => void;
  isArming?: boolean;
  className?: string;
}

export function AIExecutionEngine({
  decision: d,
  version: ver,
  onArm,
  isArming = false,
  className = "",
}: AIExecutionEngineProps) {
  const plan = effectivePlan(d, ver ?? null);
  const entryPrice =
    plan?.entry != null && plan.entry > 0
      ? plan.entry
      : d.entryPrice != null && d.entryPrice > 0
      ? d.entryPrice
      : d.triggerPrice != null && d.triggerPrice > 0
      ? d.triggerPrice
      : d.currentPrice != null && d.currentPrice > 0
      ? d.currentPrice
      : 0;

  const stopLoss =
    plan?.stop != null && plan.stop > 0
      ? plan.stop
      : d.structuralStop != null && d.structuralStop > 0
      ? d.structuralStop
      : Number((entryPrice * 0.95).toFixed(2));

  const target1 =
    plan?.t1 != null && plan.t1 > 0
      ? plan.t1
      : d.planTargets?.t1 != null && d.planTargets.t1 > 0
      ? d.planTargets.t1
      : d.target1 != null && d.target1 > 0
      ? d.target1
      : Number((entryPrice + 1.5 * Math.max(0.01, Math.abs(entryPrice - stopLoss))).toFixed(2));

  return (
    <div
      className={`flex flex-col justify-between gap-3.5 rounded-lg border border-emerald-500/40 bg-black/70 p-4 backdrop-blur-sm ${className}`}
      data-testid={`ai-execution-engine-${d.symbol}`}
      data-sidebar-testid={`ai-context-sidebar-${d.symbol}`}
    >
      <div>
        <div className="flex items-center justify-between border-b border-emerald-500/30 pb-2 mb-3">
          <span className="font-mono text-xs font-black uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-emerald-300" /> AI Execution Engine
          </span>
          <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-slate-400">
            {d.symbol}
          </span>
        </div>

        <div className="flex flex-col gap-2.5 font-mono text-xs">
          <div className="flex items-start gap-2 text-emerald-300">
            <span className="font-bold text-emerald-400 shrink-0">Step 1:</span>
            <span>1H Candle Confirmed ✅</span>
          </div>
          <div className="flex items-start gap-2 text-slate-200">
            <span className="font-bold text-cyan-400 shrink-0">Step 2:</span>
            <span>Place Limit Buy at <strong className="text-white font-bold">{formatCurrency(entryPrice)}</strong>.</span>
          </div>
          <div className="flex items-start gap-2 text-slate-200">
            <span className="font-bold text-amber-400 shrink-0">Step 3:</span>
            <span>Set Hard Stop at <strong className="text-white font-bold">{formatCurrency(stopLoss)}</strong> (-1R).</span>
          </div>
          <div className="flex items-start gap-2 text-slate-200">
            <span className="font-bold text-emerald-400 shrink-0">Step 4:</span>
            <span>Once filled, queue OCO Target 1 at <strong className="text-white font-bold">{formatCurrency(target1)}</strong> (+1.5R).</span>
          </div>
        </div>
      </div>

      {onArm && (
        <div className="mt-2 pt-2 border-t border-emerald-500/20">
          <button
            type="button"
            onClick={onArm}
            disabled={isArming}
            className="w-full py-3.5 px-4 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-mono font-black text-sm uppercase tracking-wider shadow-[0_0_20px_rgba(16,185,129,0.7)] animate-pulse transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid={`button-massive-arm-${d.symbol}`}
            aria-label={`Arm Trade for ${d.symbol}`}
          >
            <Zap className="h-4 w-4 fill-gray-950 text-gray-950" />
            <span>{isArming ? "Executing..." : "[ ARM TRADE ]"}</span>
          </button>
          <p className="mt-1.5 text-center font-mono text-[9px] uppercase tracking-wider text-slate-400">
            Routes directly to Active Trades · Clears from Action Center
          </p>
        </div>
      )}
    </div>
  );
}

export default AIExecutionEngine;

