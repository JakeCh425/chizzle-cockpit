import React, { useState } from "react";
import {
  ClipboardList,
  Copy,
  Check,
  AlertTriangle,
  X,
  ShieldAlert,
  ArrowRight,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

export interface FidelityExecutionCheatSheetProps {
  symbol: string;
  entry: number;
  stop: number;
  target1: number;
  shares?: number;
  isOpenModal?: boolean;
  onCloseModal?: () => void;
  className?: string;
  isCollapsible?: boolean;
  defaultCollapsed?: boolean;
}

export function FidelityExecutionCheatSheet({
  symbol,
  entry,
  stop,
  target1,
  shares,
  isOpenModal = false,
  onCloseModal,
  className = "",
  isCollapsible = false,
  defaultCollapsed = false,
}: FidelityExecutionCheatSheetProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  // Fallback share calculation based on 1.0% risk ($1,000 max dollar risk)
  const riskPerShare = Math.max(0.01, Math.abs(entry - stop));
  const fullShares = shares ?? Math.max(1, Math.floor(1000 / riskPerShare));
  const halfShares = Math.max(1, Math.floor(fullShares * 0.5));

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const renderContent = () => (
    <div className="space-y-4 font-mono text-xs select-none">
      {/* STEP 1: The Entry Order */}
      <div
        className="rounded-xl border border-slate-700 bg-slate-900/95 p-4 shadow-xl"
        data-testid="fidelity-step-1"
      >
        <div className="flex items-center justify-between border-b border-slate-800 pb-2.5 mb-3">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold text-[10px] tracking-wider uppercase">
              Step 1
            </span>
            <h4 className="font-bold text-white text-sm tracking-wide">
              The Entry Order
            </h4>
          </div>
          <span className="text-[11px] text-slate-400 font-normal">
            Use a standard Trade Ticket
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {/* Action */}
          <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950/70 border border-slate-800">
            <span className="text-slate-400 font-semibold text-[11px]">Action:</span>
            <span className="px-2.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 font-black tracking-wider text-xs shadow-sm">
              BUY
            </span>
          </div>

          {/* Quantity */}
          <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950/70 border border-slate-800">
            <span className="text-slate-400 font-semibold text-[11px]">Quantity:</span>
            <div className="flex items-center gap-1.5">
              <span className="font-black text-white text-sm tabular-nums">
                {fullShares}
              </span>
              <span className="text-[10px] text-slate-400">shares</span>
              <button
                type="button"
                onClick={() => copyToClipboard(String(fullShares), "full-shares")}
                className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
                title="Copy share amount"
                data-testid="copy-entry-qty"
              >
                {copiedKey === "full-shares" ? (
                  <Check className="h-3 w-3 text-emerald-400" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </button>
            </div>
          </div>

          {/* Order Type */}
          <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950/70 border border-slate-800">
            <span className="text-slate-400 font-semibold text-[11px]">Order Type:</span>
            <span className="font-bold text-cyan-300 text-xs">LIMIT</span>
          </div>

          {/* Limit Price */}
          <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950/70 border border-cyan-500/30">
            <span className="text-slate-400 font-semibold text-[11px]">Limit Price:</span>
            <div className="flex items-center gap-1.5">
              <span className="text-base font-black text-cyan-400 tabular-nums drop-shadow-[0_0_6px_rgba(6,182,212,0.4)]">
                ${entry.toFixed(2)}
              </span>
              <button
                type="button"
                onClick={() => copyToClipboard(entry.toFixed(2), "entry-price")}
                className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
                title="Copy Entry Price"
                data-testid="copy-entry-price"
              >
                {copiedKey === "entry-price" ? (
                  <Check className="h-3 w-3 text-emerald-400" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </button>
            </div>
          </div>

          {/* TIF */}
          <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950/70 border border-slate-800 sm:col-span-2">
            <span className="text-slate-400 font-semibold text-[11px]">TIF:</span>
            <span className="font-bold text-slate-200 text-xs">Day</span>
          </div>
        </div>
      </div>

      {/* STEP 2: The Scale-Out (Once Entry Fills) */}
      <div
        className="rounded-xl border border-slate-700 bg-slate-900/95 p-4 shadow-xl space-y-3.5"
        data-testid="fidelity-step-2"
      >
        <div className="border-b border-slate-800 pb-2.5">
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 font-bold text-[10px] tracking-wider uppercase">
              Step 2
            </span>
            <h4 className="font-bold text-white text-sm tracking-wide">
              The Scale-Out (Once Entry Fills)
            </h4>
          </div>
          <div className="text-[11px] text-cyan-400 font-semibold flex items-center gap-1.5 mt-1">
            <span>Open a Conditional Ticket</span>
            <ArrowRight className="h-3 w-3" />
            <span className="px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-500/50 text-white font-bold">
              Select 'OCO' (One Cancels the Other)
            </span>
          </div>
        </div>

        {/* Order 1 (Take 1.5R Profit) */}
        <div className="p-3 rounded-lg border border-emerald-500/30 bg-slate-950/80 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-bold text-emerald-400 text-xs flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#34D399]" />
              Order 1 (Take 1.5R Profit)
            </span>
            <span className="text-[10px] text-slate-400 uppercase font-bold">Leg 1</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
            <div className="flex items-center justify-between p-2 rounded bg-slate-900/80 border border-slate-800">
              <span className="text-slate-400">Action:</span>
              <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/50 font-black tracking-wider text-xs">
                SELL
              </span>
            </div>

            <div className="flex items-center justify-between p-2 rounded bg-slate-900/80 border border-slate-800">
              <span className="text-slate-400">Quantity:</span>
              <div className="flex items-center gap-1">
                <span className="font-bold text-white tabular-nums">
                  {halfShares} shares
                </span>
                <span className="text-[10px] text-emerald-400 font-bold">(50%)</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(String(halfShares), "half-shares")}
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
                  title="Copy 50% shares"
                  data-testid="copy-target1-qty"
                >
                  {copiedKey === "half-shares" ? (
                    <Check className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between p-2 rounded bg-slate-900/80 border border-slate-800">
              <span className="text-slate-400">Order Type:</span>
              <span className="font-bold text-cyan-300">LIMIT</span>
            </div>

            <div className="flex items-center justify-between p-2 rounded bg-slate-900/80 border border-emerald-500/40">
              <span className="text-slate-400">Limit Price:</span>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-black text-emerald-400 tabular-nums">
                  ${target1.toFixed(2)}
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(target1.toFixed(2), "target1-price")}
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
                  title="Copy Target 1 Price"
                  data-testid="copy-target1-price"
                >
                  {copiedKey === "target1-price" ? (
                    <Check className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Order 2 (Protect with Stop Loss) */}
        <div className="p-3 rounded-lg border border-rose-500/30 bg-slate-950/80 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-bold text-rose-400 text-xs flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-rose-400 shadow-[0_0_6px_#F43F5E]" />
              Order 2 (Protect with Stop Loss)
            </span>
            <span className="text-[10px] text-slate-400 uppercase font-bold">Leg 2</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
            <div className="flex items-center justify-between p-2 rounded bg-slate-900/80 border border-slate-800">
              <span className="text-slate-400">Action:</span>
              <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/50 font-black tracking-wider text-xs">
                SELL
              </span>
            </div>

            <div className="flex items-center justify-between p-2 rounded bg-slate-900/80 border border-slate-800">
              <span className="text-slate-400">Quantity:</span>
              <div className="flex items-center gap-1">
                <span className="font-bold text-white tabular-nums">
                  {fullShares} shares
                </span>
                <span className="text-[10px] text-rose-400 font-bold">(100%)</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(String(fullShares), "stop-shares")}
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
                  title="Copy 100% shares"
                  data-testid="copy-stop-qty"
                >
                  {copiedKey === "stop-shares" ? (
                    <Check className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between p-2 rounded bg-slate-900/80 border border-slate-800">
              <span className="text-slate-400">Order Type:</span>
              <span className="font-bold text-rose-300">STOP</span>
            </div>

            <div className="flex items-center justify-between p-2 rounded bg-slate-900/80 border border-rose-500/40">
              <span className="text-slate-400">Stop Price:</span>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-black text-rose-400 tabular-nums">
                  ${stop.toFixed(2)}
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(stop.toFixed(2), "stop-price")}
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
                  title="Copy Stop Loss Price"
                  data-testid="copy-stop-price"
                >
                  {copiedKey === "stop-price" ? (
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

      {/* Critical Trade Management Reminder Banner */}
      <div
        className="rounded-xl border-2 border-amber-500/80 bg-amber-950/40 p-3.5 shadow-lg flex items-start gap-3"
        data-testid="fidelity-reminder-banner"
      >
        <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5 animate-pulse" />
        <div className="space-y-1">
          <div className="text-[11px] font-black uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
            <span>⚠️ REMINDER: Active Stop Management Required</span>
          </div>
          <p className="text-[11px] leading-relaxed text-amber-200/90 font-medium">
            The moment Order 1 (Target) fills, you must manually go into Fidelity and cancel the remaining Stop order, then create a new Stop order at <strong>Break-Even (${entry.toFixed(2)})</strong> for your remaining {fullShares - halfShares} shares!
          </p>
        </div>
      </div>
    </div>
  );

  // If used as modal
  if (isOpenModal) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
        data-testid="modal-fidelity-guide"
      >
        <div className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-6 shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
                <ClipboardList className="h-5 w-5 text-cyan-400" />
              </div>
              <div>
                <h3 className="font-mono text-base font-black text-white tracking-wide uppercase">
                  📋 Fidelity Execution Guide · {symbol}
                </h3>
                <p className="font-mono text-xs text-slate-400">
                  Exact trade ticket & conditional bracket inputs
                </p>
              </div>
            </div>
            {onCloseModal && (
              <button
                type="button"
                onClick={onCloseModal}
                className="h-8 w-8 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                title="Close Guide"
                data-testid="button-close-fidelity-modal"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {renderContent()}

          <div className="mt-5 pt-3 border-t border-slate-800 flex justify-end">
            <button
              type="button"
              onClick={onCloseModal}
              className="px-4 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-xs font-mono font-bold tracking-wider uppercase transition-colors cursor-pointer"
            >
              Done / Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Collapsible inline card
  return (
    <div
      className={`rounded-xl border border-slate-800 bg-slate-900/90 shadow-xl overflow-hidden ${className}`}
      data-testid="fidelity-execution-cheat-sheet"
    >
      {/* Accordion Trigger Header */}
      <div
        onClick={() => isCollapsible && setIsCollapsed((prev) => !prev)}
        className={`w-full flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-950/60 select-none ${
          isCollapsible ? "cursor-pointer hover:bg-slate-900/80 transition-colors" : ""
        }`}
        data-testid="fidelity-sheet-header"
      >
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
            <ClipboardList className="h-4 w-4 text-emerald-400" />
          </div>
          <div>
            <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-white">
              📋 Fidelity Execution Guide
            </h4>
            <p className="font-mono text-[10px] text-slate-400">
              Exact Scale-Out & Bracket Template for {symbol}
            </p>
          </div>
        </div>

        {isCollapsible && (
          <button
            type="button"
            className="text-slate-400 hover:text-white p-1"
            aria-label="Toggle Fidelity Guide"
          >
            {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
        )}
      </div>

      {!isCollapsed && <div className="p-4">{renderContent()}</div>}
    </div>
  );
}

export default FidelityExecutionCheatSheet;

