// ─── AITipsOverlay.tsx ────────────────────────────────────────────────────────
// Dynamic AI Actionable Tips Overlay with contextual 10-SMA momentum instructions.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import { Sparkles } from "lucide-react";

export interface AITipsOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  ticker?: string;
  is10SmaMomentum?: boolean;
  price?: number;
  entryPrice?: number | null;
  stopPrice?: number | null;
  targetPrice?: number | null;
  atr?: number;
}

export function AITipsOverlay({
  isOpen,
  onClose,
  ticker = "NVDA",
  is10SmaMomentum = false,
  price = 100,
  entryPrice = 100,
  stopPrice = 98.5,
  targetPrice = 103,
  atr = 3.5,
}: AITipsOverlayProps) {
  if (!isOpen) return null;

  return (
    <div
      data-testid="chart-ai-actionable-tips"
      className="absolute top-16 right-4 z-50 w-80 p-3.5 bg-gray-950/85 backdrop-blur-md border border-cyan-900/50 shadow-2xl rounded-xl text-xs text-gray-200 select-none"
    >
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-cyan-900/40">
        <div className="flex items-center gap-1.5">
          <span className="p-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 text-[10px]">
            ✨
          </span>
          <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-cyan-300">
            AI Actionable Tips
          </span>
          <span className="text-[9.5px] font-mono uppercase px-1.5 py-0.5 rounded bg-white/10 text-slate-400">
            {ticker}
          </span>
        </div>
        <button
          type="button"
          data-testid="button-close-ai-tips"
          onClick={onClose}
          aria-label="Close AI Actionable Tips"
          title="Dismiss AI Actionable Tips"
          className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold text-slate-400 hover:text-white hover:bg-white/10 border border-transparent hover:border-cyan-800/60 transition-colors cursor-pointer"
        >
          [ X ]
        </button>
      </div>

      <div className="space-y-1.5 font-sans text-[11px]">
        {is10SmaMomentum ? (
          <>
            <div className="flex items-start gap-1.5">
              <span className="text-purple-400 font-bold shrink-0 mt-0.5">●</span>
              <p className="text-slate-200 leading-snug">
                Holding tight 10-SMA momentum support. This is a runaway trend trade.
              </p>
            </div>
            <div className="flex items-start gap-1.5">
              <span className="text-cyan-400 font-bold shrink-0 mt-0.5">●</span>
              <p className="text-slate-300 leading-snug">
                Await 1H candle close above the 10-SMA line to confirm shallow bounce.
              </p>
            </div>
            <div className="flex items-start gap-1.5">
              <span className="text-emerald-400 font-bold shrink-0 mt-0.5">●</span>
              <p className="text-slate-300 leading-snug">
                Keep stops tight directly below the 10-SMA wick (-1R). Scale 50% at 1.5R.
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-start gap-1.5">
              <span className="text-cyan-400 font-bold shrink-0 mt-0.5">●</span>
              <p className="text-slate-200 leading-snug">
                Holding structural 20-SMA support at ${+(price * 0.985).toFixed(2)}. Await candle close above ${entryPrice != null ? entryPrice.toFixed(2) : "0.00"} to confirm bounce.
              </p>
            </div>
            <div className="flex items-start gap-1.5">
              <span className="text-amber-400 font-bold shrink-0 mt-0.5">●</span>
              <p className="text-slate-300 leading-snug">
                Demand volume spike &gt;1.2x average needed. Avoid chasing entry if current candle exceeds 1.5 ATR (${atr ? atr.toFixed(2) : "3.50"}).
              </p>
            </div>
            <div className="flex items-start gap-1.5">
              <span className="text-emerald-400 font-bold shrink-0 mt-0.5">●</span>
              <p className="text-slate-300 leading-snug">
                Hard stop pinned below structural low at ${stopPrice != null ? stopPrice.toFixed(2) : "0.00"}. Scale 50% at T1 (${targetPrice != null ? targetPrice.toFixed(2) : "0.00"}).
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
export default AITipsOverlay;
