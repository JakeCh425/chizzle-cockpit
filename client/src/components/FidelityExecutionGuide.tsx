import React, { useState } from "react";
import { Copy, Check, X } from "lucide-react";

export interface FidelityExecutionGuideProps {
  entryPrice?: number | null;
  target1?: number | null;
  target2?: number | null;
  stopLoss?: number | null;
  ticker?: string;
  isOpen?: boolean;
  onClose?: () => void;
  className?: string;
}

export function FidelityExecutionGuide({
  entryPrice,
  target1,
  target2,
  stopLoss,
  ticker,
  isOpen = true,
  onClose,
  className = "",
}: FidelityExecutionGuideProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  if (!isOpen) return null;

  const entryPriceState = entryPrice != null ? `$${entryPrice.toFixed(2)}` : "—";
  const target1State = target1 != null ? `$${target1.toFixed(2)}` : "—";
  const target2State =
    target2 != null
      ? `$${target2.toFixed(2)}`
      : entryPrice != null && target1 != null
      ? `$${(entryPrice + (target1 - entryPrice) * (2.0 / 1.5)).toFixed(2)}`
      : "—";
  const stopLossState = stopLoss != null ? `$${stopLoss.toFixed(2)}` : "—";

  const handleCopy = (text: string, field: string) => {
    if (text === "—") return;
    navigator.clipboard?.writeText(text.replace("$", ""));
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1800);
  };

  return (
    <div
      className={`absolute top-3 right-3 z-50 w-96 max-w-[calc(100%-1.5rem)] max-h-[80vh] overflow-y-auto custom-scrollbar pointer-events-auto rounded-xl border border-emerald-500/40 bg-slate-950/95 p-4 shadow-2xl backdrop-blur-md text-slate-100 font-mono text-xs select-none animate-in fade-in zoom-in-95 duration-150 ${className}`}
      data-testid="fidelity-execution-guide"
    >
      {/* Sticky Header at the top */}
      <div className="sticky top-0 z-50 bg-slate-950 border-b border-slate-800 pb-2 mb-3 -mx-4 -mt-4 p-4 rounded-t-xl flex items-center justify-between shadow-md">
        <div className="flex items-center gap-2">
          <span className="text-base">📋</span>
          <h3 className="font-bold text-white text-sm tracking-wide">
            FIDELITY EXECUTION GUIDE
          </h3>
          {ticker && (
            <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-black">
              {ticker}
            </span>
          )}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            title="Close guide"
            data-testid="button-close-fidelity-guide"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="space-y-4">
        {/* STEP 1: The Entry */}
        <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3 space-y-2" data-testid="guide-step-1">
          <div className="font-bold text-emerald-400 flex items-center justify-between">
            <span>STEP 1: The Entry</span>
            <span className="text-[10px] text-slate-400 font-normal">(Use a Standard Trade Ticket)</span>
          </div>

          <div className="space-y-1.5 pt-1 text-[11px]">
            <div className="flex items-center justify-between py-0.5">
              <span className="text-slate-400">Action:</span>
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 font-bold">
                BUY
              </span>
            </div>

            <div className="flex items-center justify-between py-0.5">
              <span className="text-slate-400">Quantity:</span>
              <span className="font-semibold text-slate-200">100% of planned position</span>
            </div>

            <div className="flex items-center justify-between py-0.5">
              <span className="text-slate-400">Order Type:</span>
              <span className="font-bold text-cyan-300">LIMIT</span>
            </div>

            <div className="flex items-center justify-between py-0.5 border-t border-slate-800/80 pt-1">
              <span className="text-slate-400">Limit Price:</span>
              <div className="flex items-center gap-1.5">
                <span className="font-black text-white text-xs tabular-nums">
                  {entryPriceState}
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy(entryPriceState, "entry")}
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
                  title="Copy Entry Price"
                  data-testid="copy-guide-entry"
                >
                  {copiedField === "entry" ? (
                    <Check className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between py-0.5">
              <span className="text-slate-400">TIF:</span>
              <span className="font-bold text-slate-200">Day</span>
            </div>
          </div>
        </div>

        {/* STEP 2: The Protection & Scale-Out (Do this immediately after Entry fills) */}
        <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3 space-y-2.5" data-testid="guide-step-2">
          <div>
            <div className="font-bold text-cyan-400">STEP 2: The Protection &amp; Scale-Out (Do this immediately after Entry fills)</div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {"(Use a Conditional Ticket -> OCO / One Cancels the Other)"}
            </div>
          </div>

          {/* Order 1 (Lock in 1.5R Profit) */}
          <div className="rounded border border-emerald-500/30 bg-slate-950/70 p-2.5 space-y-1 text-[11px]">
            <div className="font-bold text-emerald-300 text-[10.5px]">
              Order 1 (Lock in 1.5R Profit):
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Action:</span>
              <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold text-[10px]">
                SELL
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Quantity:</span>
              <span className="font-semibold text-slate-200">50% of shares</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Order Type:</span>
              <span className="font-bold text-cyan-300">LIMIT</span>
            </div>
            <div className="flex items-center justify-between pt-0.5">
              <span className="text-slate-400">Limit Price:</span>
              <div className="flex items-center gap-1.5">
                <span className="font-black text-emerald-400 text-xs tabular-nums">
                  {target1State}
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy(target1State, "t1")}
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
                  title="Copy Target 1"
                  data-testid="copy-guide-t1"
                >
                  {copiedField === "t1" ? (
                    <Check className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Order 2 (Initial Stop Loss) */}
          <div className="rounded border border-rose-500/30 bg-slate-950/70 p-2.5 space-y-1 text-[11px]">
            <div className="font-bold text-rose-300 text-[10.5px]">
              Order 2 (Initial Stop Loss):
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Action:</span>
              <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold text-[10px]">
                SELL
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Quantity:</span>
              <span className="font-semibold text-slate-200">100% of shares</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Order Type:</span>
              <span className="font-bold text-rose-300">STOP</span>
            </div>
            <div className="flex items-center justify-between pt-0.5">
              <span className="text-slate-400">Stop Price:</span>
              <div className="flex items-center gap-1.5">
                <span className="font-black text-rose-400 text-xs tabular-nums">
                  {stopLossState}
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy(stopLossState, "stop")}
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
                  title="Copy Stop Price"
                  data-testid="copy-guide-stop"
                >
                  {copiedField === "stop" ? (
                    <Check className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* STEP 3: The Adjustment (Do this the MOMENT Target 1 fills) */}
        <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3 space-y-2" data-testid="guide-step-3">
          <div>
            <div className="font-bold text-amber-400">STEP 3: The Adjustment (Do this the MOMENT Target 1 fills)</div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {"(Log into Fidelity to adjust your risk)"}
            </div>
          </div>

          <div className="p-2.5 rounded bg-amber-500/10 border border-amber-500/20 text-[10.5px] text-amber-200/90 leading-relaxed space-y-1">
            <div>
              <span className="font-bold text-amber-300">Action 1:</span> Fidelity will have automatically triggered your T1 sell. <strong className="text-white">CANCEL the remaining initial Stop Loss order.</strong>
            </div>
          </div>

          <div className="rounded border border-amber-500/30 bg-slate-950/70 p-2.5 space-y-1 text-[11px]">
            <div className="font-bold text-amber-300 text-[10.5px]">
              Action 2: Create a NEW Standard Trade Ticket.
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Action:</span>
              <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold text-[10px]">
                SELL
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Quantity:</span>
              <span className="font-semibold text-slate-200">Remaining 50% of shares</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Order Type:</span>
              <span className="font-bold text-amber-300">STOP (Break-Even)</span>
            </div>
            <div className="flex items-center justify-between pt-0.5">
              <div className="flex flex-col">
                <span className="text-slate-400">Stop Price:</span>
                <span className="text-[9.5px] text-slate-500 font-normal">(Your original entry price)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-black text-amber-300 text-xs tabular-nums">
                  {entryPriceState}
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy(entryPriceState, "be-stop")}
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
                  title="Copy Break-Even Stop Price"
                  data-testid="copy-guide-be-stop"
                >
                  {copiedField === "be-stop" ? (
                    <Check className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* STEP 4: The Core Target (Target 2) */}
        <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3 space-y-2" data-testid="guide-step-4">
          <div>
            <div className="font-bold text-emerald-400">STEP 4: The Core Target (Target 2)</div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {"(Set your final limit order)"}
            </div>
          </div>

          <div className="rounded border border-emerald-500/30 bg-slate-950/70 p-2.5 space-y-1 text-[11px]">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Action:</span>
              <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold text-[10px]">
                SELL
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Quantity:</span>
              <span className="font-semibold text-slate-200">Remaining 50% of shares</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Order Type:</span>
              <span className="font-bold text-cyan-300">LIMIT</span>
            </div>
            <div className="flex items-center justify-between pt-0.5">
              <span className="text-slate-400">Limit Price:</span>
              <div className="flex items-center gap-1.5">
                <span className="font-black text-emerald-400 text-xs tabular-nums">
                  {target2State}
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy(target2State, "t2")}
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
                  title="Copy Target 2"
                  data-testid="copy-guide-t2"
                >
                  {copiedField === "t2" ? (
                    <Check className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="text-[10.5px] text-slate-400 italic pt-0.5 leading-relaxed">
            *(Alternatively, trail your stop loss up beneath the 1H 20-SMA)*
          </div>
        </div>
      </div>
    </div>
  );
}

export default FidelityExecutionGuide;
