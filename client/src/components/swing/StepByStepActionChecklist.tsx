import React from "react";
import { CheckCircle2, Loader2, ArrowRight } from "lucide-react";

export interface StepByStepActionChecklistProps {
  symbol: string;
  triggerPrice: number;
  entryPrice: number;
  stopLoss: number;
  target1: number;
  is1hClosed?: boolean;
  isArmed?: boolean;
  isFilled?: boolean;
  className?: string;
}

export function formatPriceNumber(val: number | null | undefined): string {
  if (val == null || !Number.isFinite(val)) return "$0.00";
  return `$${val.toFixed(2)}`;
}

/**
 * StepByStepActionChecklist
 * Beginner-friendly, idiot-proof execution guide with dynamic state tracking.
 * - STEP 1: Await 1H Candle Close above ${triggerPrice} (spinner if waiting, green check if closed)
 * - STEP 2: Place Limit BUY order at ${entryPrice}
 * - STEP 3: Set Hard Stop Loss at ${stopLoss}
 * - STEP 4: Set OCO Target 1 at ${target1}
 * Highlights the current required step in bright neon green or cyan, dimming future steps.
 */
export function StepByStepActionChecklist({
  symbol,
  triggerPrice,
  entryPrice,
  stopLoss,
  target1,
  is1hClosed = false,
  isArmed = false,
  isFilled = false,
  className = "",
}: StepByStepActionChecklistProps) {
  // Step state calculations
  const step1Done = is1hClosed;
  const step1Active = !step1Done;

  const step2Done = step1Done && (isArmed || isFilled);
  const step2Active = step1Done && !step2Done;
  const step2Dimmed = !step1Done;

  const step3Done = step2Done && isFilled;
  const step3Active = step2Done && !step3Done;
  const step3Dimmed = !step2Done;

  const step4Done = step3Done && false; // Remains active until target hit
  const step4Active = step3Done && !step4Done;
  const step4Dimmed = !step3Done;

  return (
    <div
      className={`rounded-lg border border-gray-800 bg-black/60 p-2.5 font-sans space-y-2 backdrop-blur-sm ${className}`}
      data-testid={`action-engine-checklist-${symbol}`}
    >
      <div className="flex items-center justify-between border-b border-gray-800 pb-1.5 px-0.5">
        <span className="font-mono text-[11px] font-black uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-cyan-400 shadow-[0_0_6px_#22D3EE]" />
          Step-by-Step Action Engine
        </span>
        <span className="font-mono text-[10px] font-bold text-slate-400 uppercase tracking-widest">
          {symbol}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        {/* STEP 1: Await 1H Candle Close */}
        <div
          data-testid={`step-1-${symbol}`}
          data-step-status={step1Done ? "COMPLETED" : "ACTIVE"}
          className={`flex items-start gap-2.5 p-2 rounded-md border text-xs transition-all ${
            step1Done
              ? "border-emerald-500/40 bg-emerald-950/20 text-emerald-300"
              : "border-cyan-400/80 bg-cyan-950/40 text-cyan-300 ring-1 ring-cyan-400/50 shadow-[0_0_12px_rgba(6,182,212,0.3)] animate-pulse"
          }`}
        >
          <div className="shrink-0 mt-0.5">
            {step1Done ? (
              <span className="flex items-center gap-1 font-mono font-black text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                <span>[✓]</span>
              </span>
            ) : (
              <span className="flex items-center gap-1 font-mono font-black text-cyan-300">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400" />
                <span>[ ]</span>
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <span className="font-bold">
              STEP 1: Await 1H Candle Close above{" "}
              <strong className="font-mono font-bold tabular-nums text-white">
                {formatPriceNumber(triggerPrice)}
              </strong>
              .
            </span>
            <span className="sr-only">[ ] STEP 1: Await 1H Candle Close.</span>
            <span className="ml-1.5 text-[10.5px] opacity-80">
              {step1Done ? (
                <span className="text-emerald-400 font-semibold">(Closed above trigger ✅)</span>
              ) : (
                <span className="text-cyan-300 font-semibold">(Waiting for 1H candle close)</span>
              )}
            </span>
          </div>
        </div>

        {/* STEP 2: Place Limit BUY order */}
        <div
          data-testid={`step-2-${symbol}`}
          data-step-status={step2Done ? "COMPLETED" : step2Active ? "ACTIVE" : "DIMMED"}
          className={`flex items-start gap-2.5 p-2 rounded-md border text-xs transition-all ${
            step2Done
              ? "border-emerald-500/40 bg-emerald-950/20 text-emerald-300"
              : step2Active
              ? "border-emerald-400/80 bg-emerald-950/40 text-emerald-300 ring-1 ring-emerald-400/50 shadow-[0_0_12px_rgba(16,185,129,0.3)]"
              : "opacity-40 border-gray-800 bg-black/20 text-slate-500"
          }`}
        >
          <div className="shrink-0 mt-0.5 font-mono font-black">
            {step2Done ? (
              <span className="flex items-center gap-1 text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                <span>[✓]</span>
              </span>
            ) : step2Active ? (
              <span className="flex items-center gap-1 text-emerald-400 animate-pulse">
                <ArrowRight className="h-3.5 w-3.5 text-emerald-400" />
                <span>[ ]</span>
              </span>
            ) : (
              <span>[ ]</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <span className="font-bold">
              STEP 2: Place Limit BUY order at{" "}
              <strong className="font-mono font-bold tabular-nums text-white">
                {formatPriceNumber(entryPrice)}
              </strong>
              .
            </span>
            <span className="sr-only">[ ] STEP 2: Limit BUY at {formatPriceNumber(entryPrice)}.</span>
            {step2Active && (
              <span className="ml-1.5 text-[10.5px] text-emerald-300 font-semibold">
                (Action Required · Current Step)
              </span>
            )}
            {step2Done && (
              <span className="ml-1.5 text-[10.5px] text-emerald-400 font-semibold">
                (Order Armed / Active ✅)
              </span>
            )}
          </div>
        </div>

        {/* STEP 3: Set Hard Stop Loss */}
        <div
          data-testid={`step-3-${symbol}`}
          data-step-status={step3Done ? "COMPLETED" : step3Active ? "ACTIVE" : "DIMMED"}
          className={`flex items-start gap-2.5 p-2 rounded-md border text-xs transition-all ${
            step3Done
              ? "border-emerald-500/40 bg-emerald-950/20 text-emerald-300"
              : step3Active
              ? "border-amber-400/80 bg-amber-950/40 text-amber-300 ring-1 ring-amber-400/50 shadow-[0_0_12px_rgba(245,158,11,0.3)]"
              : "opacity-40 border-gray-800 bg-black/20 text-slate-500"
          }`}
        >
          <div className="shrink-0 mt-0.5 font-mono font-black">
            {step3Done ? (
              <span className="flex items-center gap-1 text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                <span>[✓]</span>
              </span>
            ) : step3Active ? (
              <span className="flex items-center gap-1 text-amber-400 animate-pulse">
                <ArrowRight className="h-3.5 w-3.5 text-amber-400" />
                <span>[ ]</span>
              </span>
            ) : (
              <span>[ ]</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <span className="font-bold">
              STEP 3: Set Hard Stop Loss at{" "}
              <strong className="font-mono font-bold tabular-nums text-white">
                {formatPriceNumber(stopLoss)}
              </strong>
              .
            </span>
            <span className="ml-1 text-[10.5px] font-mono text-rose-400 font-bold">(-1R)</span>
            {step3Active && (
              <span className="ml-1.5 text-[10.5px] text-amber-300 font-semibold">
                (Queue Stop Protection)
              </span>
            )}
          </div>
        </div>

        {/* STEP 4: Set OCO Target 1 */}
        <div
          data-testid={`step-4-${symbol}`}
          data-step-status={step4Done ? "COMPLETED" : step4Active ? "ACTIVE" : "DIMMED"}
          className={`flex items-start gap-2.5 p-2 rounded-md border text-xs transition-all ${
            step4Done
              ? "border-emerald-500/40 bg-emerald-950/20 text-emerald-300"
              : step4Active
              ? "border-emerald-400/80 bg-emerald-950/40 text-emerald-300 ring-1 ring-emerald-400/50 shadow-[0_0_12px_rgba(16,185,129,0.3)]"
              : "opacity-40 border-gray-800 bg-black/20 text-slate-500"
          }`}
        >
          <div className="shrink-0 mt-0.5 font-mono font-black">
            {step4Done ? (
              <span className="flex items-center gap-1 text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                <span>[✓]</span>
              </span>
            ) : step4Active ? (
              <span className="flex items-center gap-1 text-emerald-400">
                <ArrowRight className="h-3.5 w-3.5 text-emerald-400" />
                <span>[ ]</span>
              </span>
            ) : (
              <span>[ ]</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <span className="font-bold">
              STEP 4: Set OCO Target 1 at{" "}
              <strong className="font-mono font-bold tabular-nums text-white">
                {formatPriceNumber(target1)}
              </strong>
              .
            </span>
            <span className="ml-1 text-[10.5px] font-mono text-emerald-400 font-bold">(+1.5R)</span>
            {step4Active && (
              <span className="ml-1.5 text-[10.5px] text-emerald-300 font-semibold">
                (Once filled, lock in 1.5R)
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

