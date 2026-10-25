import React, { useState } from "react";
import { Copy, Check, X, ClipboardList, ShieldAlert } from "lucide-react";

export interface FidelityExecutionGuideProps {
  entryPrice?: number | null;
  target1?: number | null;
  stopLoss?: number | null;
  ticker?: string;
  isOpen?: boolean;
  onClose?: () => void;
  className?: string;
}

export function FidelityExecutionGuide({
  entryPrice,
  target1,
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
  const stopLossState = stopLoss != null ? `$${stopLoss.toFixed(2)}` : "—";

  const handleCopy = (text: string, field: string) => {
    if (text === "—") return;
    navigator.clipboard?.writeText(text.replace("$", ""));
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1800);
  };

  return (
    <div
      className={`absolute top-3 right-3 z-40 w-96 max-w-[calc(100%-1.5rem)] rounded-xl border border-emerald-500/40 bg-slate-950/95 p-4 shadow-2xl backdrop-blur-md text-slate-100 font-mono text-xs select-none animate-in fade-in zoom-in-95 duration-150 ${className}`}
      data-testid="fidelity-execution-guide"
    >
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2.5 mb-3">
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
        {/* STEP 1: The Entry Order */}
        <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3 space-y-2" data-testid="guide-step-1">
          <div className="font-bold text-emerald-400 flex items-center justify-between">
            <span>STEP 1: The Entry Order</span>
            <span className="text-[10px] text-slate-400 font-normal">(Standard Trade Ticket)</span>
          </div>

          <div className="space-y-1.5 pt-1 text-[11px]">
            <div className="flex items-center justify-between py-0.5">
              <span className="text-slate-400">Action:</span>
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 font-bold">
                BUY
              </span>
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

        {/* STEP 2: The Scale-Out (Once Entry Fills) */}
        <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3 space-y-2.5" data-testid="guide-step-2">
          <div>
            <div className="font-bold text-cyan-400">STEP 2: The Scale-Out (Once Entry Fills)</div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {"(Conditional Ticket -> OCO / One Cancels the Other)"}
            </div>
          </div>

          {/* Order 1 (Take 1.5R Profit) */}
          <div className="rounded border border-emerald-500/30 bg-slate-950/70 p-2.5 space-y-1 text-[11px]">
            <div className="font-bold text-emerald-300 text-[10.5px]">
              Order 1 (Take 1.5R Profit):
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Action:</span>
              <span className="px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold text-[10px]">
                SELL (50% Quantity)
              </span>
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

          {/* Order 2 (Protect with Stop Loss) */}
          <div className="rounded border border-rose-500/30 bg-slate-950/70 p-2.5 space-y-1 text-[11px]">
            <div className="font-bold text-rose-300 text-[10.5px]">
              Order 2 (Protect with Stop Loss):
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Action:</span>
              <span className="px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold text-[10px]">
                SELL (Remaining Quantity)
              </span>
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
      </div>
    </div>
  );
}

export default FidelityExecutionGuide;
