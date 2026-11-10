import React, { useState } from "react";
import { Zap, Copy, Check, ShieldCheck, ArrowRight, X, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useOptionalGlobalState } from "@/lib/globalState";
import { useMarketDataStore } from "@/lib/useMarketDataStore";
import { useNotificationAuditLog } from "@/hooks/useNotificationAuditLog";
import type { ConfirmedHeroTrade } from "@/hooks/useStrategyEngine";

export interface ActiveExecutionHeroCardProps {
  trade: ConfirmedHeroTrade;
  onDismiss?: (symbol: string) => void;
  onArmOrExecute?: (trade: ConfirmedHeroTrade) => Promise<void> | void;
  className?: string;
}

export function ActiveExecutionHeroCard({
  trade,
  onDismiss,
  onArmOrExecute,
  className = "",
}: ActiveExecutionHeroCardProps) {
  const { toast } = useToast();
  const global = useOptionalGlobalState();
  const marketStore = useMarketDataStore();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  const isPractice = Boolean(global?.isPracticeMode);
  const auditLog = useNotificationAuditLog(trade.symbol);
  const alertTimeText = auditLog.formattedTime || (trade as any).alertTimestamp || "10:00 CT";

  // Live price strictly from central market store
  const livePrice =
    trade.symbol === marketStore.activeTicker && marketStore.currentPrice != null
      ? marketStore.currentPrice
      : marketStore.prices[trade.symbol] ?? trade.currentPrice;

  const copyToClipboard = async (text: string, key: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      toast({
        title: `Copied ${label}`,
        description: `${text} copied to clipboard for Fidelity order entry.`,
      });
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      toast({
        title: "Copy Failed",
        description: "Clipboard access blocked by browser.",
        variant: "destructive",
      });
    }
  };

  const handleAction = async () => {
    setIsExecuting(true);
    try {
      if (onArmOrExecute) {
        await onArmOrExecute(trade);
      }
      onDismiss?.(trade.symbol);
    } catch (e: any) {
      toast({
        title: "Execution Error",
        description: e?.message || "Failed to log or arm trade.",
        variant: "destructive",
      });
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div
      className={`relative w-full rounded-2xl border-2 border-emerald-500/90 bg-gradient-to-b from-[#062419] via-[#091A14] to-[#0B0E14] p-4 sm:p-5 shadow-[0_0_35px_rgba(16,185,129,0.35)] ring-1 ring-emerald-400/40 backdrop-blur-md transition-all duration-300 animate-in fade-in ${className}`}
      data-testid={`active-execution-hero-card-${trade.symbol}`}
    >
      {/* ── TOP HEADER DOCK ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-500/40 pb-3.5">
        <div className="flex items-center gap-3">
          {/* Pulsing Green Status Dot */}
          <span className="relative flex h-3.5 w-3.5" data-testid="hero-pulse-dot">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 shadow-[0_0_12px_#10B981]" />
          </span>

          <h3 className="font-mono text-base sm:text-xl font-black uppercase tracking-wider text-emerald-300 flex items-center gap-1.5" data-testid={`hero-title-${trade.symbol}`}>
            <span>⚡ LIVE EXECUTION READY:</span>
            <span className="text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.4)]">[{trade.symbol}]</span>
          </h3>

          <span className="rounded-full bg-emerald-500/20 border border-emerald-400/60 px-2.5 py-0.5 font-mono text-[10px] sm:text-[11px] font-extrabold uppercase tracking-widest text-emerald-300">
            {trade.testedLine ? `1H ${trade.testedLine.replace("_", " ")} Confirmed` : "1H Candle Closed Green"}
          </span>

          <span
            className="rounded-full bg-emerald-950/80 border border-emerald-400/70 px-2.5 py-0.5 font-mono text-[10px] sm:text-[11px] font-bold text-emerald-300 shadow-sm flex items-center gap-1 shrink-0"
            data-testid={`badge-hero-alert-sent-${trade.symbol}`}
          >
            [ 🔔 Alert Sent: {alertTimeText} ]
          </span>
        </div>

        {/* Live Price in text-3xl font-mono font-black */}
        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="block font-mono text-[10px] uppercase font-bold text-emerald-400/80">Live Exchange Price</span>
            <span className="text-3xl sm:text-4xl font-mono font-black text-emerald-400 tabular-nums drop-shadow-[0_0_12px_rgba(16,185,129,0.5)]" data-testid={`hero-live-price-${trade.symbol}`}>
              ${livePrice.toFixed(2)}
            </span>
          </div>

          {onDismiss && (
            <button
              type="button"
              onClick={() => onDismiss(trade.symbol)}
              className="rounded-lg p-1 text-emerald-400/70 hover:bg-emerald-950 hover:text-emerald-200 transition-colors cursor-pointer"
              title="Dismiss from Hero Zone"
              data-testid={`button-dismiss-hero-${trade.symbol}`}
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      {/* ── CORE MATH GRID ── */}
      <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3" data-testid={`hero-math-grid-${trade.symbol}`}>
        {/* Limit Entry Price */}
        <div className="rounded-xl border border-cyan-500/40 bg-slate-950/80 p-3 shadow-inner">
          <div className="flex items-center justify-between text-cyan-400 font-mono text-[10px] font-bold uppercase tracking-wider">
            <span>Limit Entry Price</span>
            <span className="text-[9px] text-cyan-300/70">Planned Trigger</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-xl sm:text-2xl font-mono font-black text-white tabular-nums">
              ${trade.entryPrice.toFixed(2)}
            </span>
            <button
              type="button"
              onClick={() => copyToClipboard(trade.entryPrice.toFixed(2), "entry", "Entry Price")}
              className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
              title="Copy Entry Price"
              data-testid={`copy-hero-entry-${trade.symbol}`}
            >
              {copiedKey === "entry" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        {/* Stop Loss (-1.0R) */}
        <div className="rounded-xl border border-rose-500/40 bg-slate-950/80 p-3 shadow-inner">
          <div className="flex items-center justify-between text-rose-400 font-mono text-[10px] font-bold uppercase tracking-wider">
            <span>Stop Loss (1.0R)</span>
            <span className="text-[9px] text-rose-400/80 font-bold">Risk: ${trade.riskPerShare.toFixed(2)}/sh</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-xl sm:text-2xl font-mono font-black text-rose-400 tabular-nums">
              ${trade.stopLoss.toFixed(2)}
            </span>
            <button
              type="button"
              onClick={() => copyToClipboard(trade.stopLoss.toFixed(2), "stop", "Stop Loss")}
              className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
              title="Copy Stop Loss"
              data-testid={`copy-hero-stop-${trade.symbol}`}
            >
              {copiedKey === "stop" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        {/* Target 1 (1.5R - 50% scale) */}
        <div className="rounded-xl border border-emerald-500/40 bg-slate-950/80 p-3 shadow-inner">
          <div className="flex items-center justify-between text-emerald-400 font-mono text-[10px] font-bold uppercase tracking-wider">
            <span>Target 1 (1.5R - 50%)</span>
            <span className="text-[9px] text-emerald-300 font-bold">{trade.t1Shares} shares</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-xl sm:text-2xl font-mono font-black text-emerald-300 tabular-nums">
              ${trade.target1.toFixed(2)}
            </span>
            <button
              type="button"
              onClick={() => copyToClipboard(trade.target1.toFixed(2), "target1", "Target 1")}
              className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
              title="Copy Target 1"
              data-testid={`copy-hero-target1-${trade.symbol}`}
            >
              {copiedKey === "target1" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        {/* Target 2 (2.0R core) */}
        <div className="rounded-xl border border-purple-500/40 bg-slate-950/80 p-3 shadow-inner">
          <div className="flex items-center justify-between text-purple-400 font-mono text-[10px] font-bold uppercase tracking-wider">
            <span>Target 2 (2.0R Core)</span>
            <span className="text-[9px] text-purple-300 font-bold">{trade.t2Shares} runner</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-xl sm:text-2xl font-mono font-black text-purple-300 tabular-nums">
              ${trade.target2.toFixed(2)}
            </span>
            <button
              type="button"
              onClick={() => copyToClipboard(trade.target2.toFixed(2), "target2", "Target 2")}
              className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
              title="Copy Target 2"
              data-testid={`copy-hero-target2-${trade.symbol}`}
            >
              {copiedKey === "target2" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>

      {/* ── ACTIONABLE FIDELITY ORDER TICKET EMBED ── */}
      <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900/90 p-3.5 sm:p-4 shadow-xl" data-testid={`hero-fidelity-ticket-${trade.symbol}`}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2 mb-3">
          <div className="flex items-center gap-2">
            <span className="rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider uppercase">
              1-Click Fidelity Ticket
            </span>
            <h4 className="font-mono text-xs font-bold uppercase text-white tracking-wider">
              Exact Order Ticket Preset (Buy Limit + OCO Bracket)
            </h4>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] text-slate-400">
              Account Sizing: <strong>{trade.shares} total shares</strong> ($250 standard max risk)
            </span>
            <button
              type="button"
              onClick={() => {
                const fullTicket = [
                  `FIDELITY ORDER TICKET: ${trade.symbol}`,
                  `STEP 1 - BUY LIMIT ENTRY:`,
                  `• Action: BUY`,
                  `• Quantity: ${trade.shares} Shares`,
                  `• Order Type: LIMIT`,
                  `• Limit Price: $${trade.entryPrice.toFixed(2)}`,
                  `• TIF: Day`,
                  ``,
                  `STEP 2 - CONDITIONAL BRACKET (OCO):`,
                  `• Order 1 (T1 Limit @ 1.5R): SELL ${trade.t1Shares} Shares @ LIMIT $${trade.target1.toFixed(2)}`,
                  `• Order 2 (Stop Loss @ 1.0R): SELL ${trade.shares} Shares @ STOP $${trade.stopLoss.toFixed(2)}`,
                  `• TIF: GTC`,
                ].join("\n");
                copyToClipboard(fullTicket, "full-ticket", "Fidelity Order Ticket");
              }}
              className="px-2.5 py-1 rounded bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-400/40 text-indigo-200 font-mono text-[11px] font-bold flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
              data-testid={`button-copy-fidelity-ticket-${trade.symbol}`}
              title="Copy pre-formatted Fidelity order ticket directly to clipboard"
            >
              {copiedKey === "full-ticket" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              <span>
                {copiedKey === "full-ticket"
                  ? "[ 📋 ORDER TICKET COPIED TO CLIPBOARD ]"
                  : "[ 📋 COPY FIDELITY ORDER TICKET ]"}
              </span>
            </button>
          </div>
        </div>

        {/* Step 1 & Step 2 Columns */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* STEP 1: Buy Limit Entry */}
          <div className="rounded-lg border border-cyan-500/30 bg-slate-950/70 p-3 space-y-2">
            <div className="flex items-center justify-between text-[11px] font-mono font-bold text-cyan-300 border-b border-slate-800 pb-1.5">
              <span>Step 1: Open Initial Position</span>
              <span className="text-[10px] uppercase text-cyan-400/80">Order: Buy Limit</span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <div className="p-2 rounded bg-slate-900 border border-slate-800">
                <span className="text-[10px] text-slate-400 block">Action / Type</span>
                <span className="font-extrabold text-white">BUY · LIMIT</span>
              </div>
              <div className="p-2 rounded bg-slate-900 border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-slate-400 block">Shares</span>
                  <span className="font-extrabold text-cyan-300 tabular-nums">{trade.shares}</span>
                </div>
                <button
                  type="button"
                  onClick={() => copyToClipboard(String(trade.shares), "shares-step1", "Shares")}
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white"
                  title="Copy Shares"
                  data-testid={`copy-hero-shares-${trade.symbol}`}
                >
                  {copiedKey === "shares-step1" ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                </button>
              </div>
              <div className="col-span-2 p-2 rounded bg-slate-900 border border-cyan-500/40 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-slate-400 block">Limit Price</span>
                  <span className="font-black text-cyan-400 text-sm tabular-nums">${trade.entryPrice.toFixed(2)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => copyToClipboard(trade.entryPrice.toFixed(2), "entry-step1", "Limit Price")}
                  className="px-2 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                  data-testid={`copy-hero-ticket-limit-${trade.symbol}`}
                >
                  {copiedKey === "entry-step1" ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  <span>Copy Limit</span>
                </button>
              </div>
            </div>
          </div>

          {/* STEP 2: OCO Bracket Protection */}
          <div className="rounded-lg border border-emerald-500/30 bg-slate-950/70 p-3 space-y-2">
            <div className="flex items-center justify-between text-[11px] font-mono font-bold text-emerald-300 border-b border-slate-800 pb-1.5">
              <span>Step 2: Conditional Bracket (OCO)</span>
              <span className="text-[10px] uppercase text-emerald-400/80">One Cancels Other</span>
            </div>

            <div className="space-y-1.5 text-xs font-mono">
              <div className="p-2 rounded bg-slate-900 border border-emerald-900/60 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-emerald-400 font-bold block">Order 1: Sell Limit ({trade.t1Shares} shares @ 1.5R)</span>
                  <span className="font-extrabold text-white text-sm tabular-nums">${trade.target1.toFixed(2)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => copyToClipboard(trade.target1.toFixed(2), "oco-t1", "Target 1 Limit")}
                  className="px-2 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                  data-testid={`copy-hero-oco-t1-${trade.symbol}`}
                >
                  {copiedKey === "oco-t1" ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  <span>Copy T1</span>
                </button>
              </div>

              <div className="p-2 rounded bg-slate-900 border border-rose-900/60 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-rose-400 font-bold block">Order 2: Stop Loss (All {trade.shares} shares @ 1.0R)</span>
                  <span className="font-extrabold text-rose-400 text-sm tabular-nums">${trade.stopLoss.toFixed(2)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => copyToClipboard(trade.stopLoss.toFixed(2), "oco-stop", "Stop Loss")}
                  className="px-2 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                  data-testid={`copy-hero-oco-stop-${trade.symbol}`}
                >
                  {copiedKey === "oco-stop" ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  <span>Copy Stop</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── DISMISS / LOG ACTIONS BAR ── */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-emerald-500/30">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleAction}
            disabled={isExecuting}
            className={`px-5 py-2.5 rounded-xl font-mono font-black text-xs sm:text-sm uppercase tracking-wider transition-all cursor-pointer flex items-center gap-2 shadow-lg disabled:opacity-50 ${
              isPractice
                ? "bg-amber-500 hover:bg-amber-400 text-gray-950 shadow-amber-500/30 ring-2 ring-amber-300 active:scale-95 animate-pulse"
                : "bg-emerald-500 hover:bg-emerald-400 text-gray-950 shadow-emerald-500/30 ring-2 ring-emerald-300 active:scale-95 animate-pulse"
            }`}
            data-testid={`button-arm-hero-${trade.symbol}`}
          >
            <Zap className="h-4 w-4 fill-gray-950" />
            <span>
              {isExecuting
                ? "Recording..."
                : isPractice
                ? "[ ARM PRACTICE TRADE ]"
                : "[ LOG AS EXECUTED ]"}
            </span>
          </button>

          {onDismiss && (
            <button
              type="button"
              onClick={() => onDismiss(trade.symbol)}
              className="px-4 py-2.5 rounded-xl font-mono font-bold text-xs uppercase tracking-wider bg-slate-900 border border-slate-700 hover:bg-slate-800 hover:border-slate-600 text-slate-300 hover:text-white transition-colors cursor-pointer"
              data-testid={`button-pass-hero-${trade.symbol}`}
            >
              [ PASS / CLEAR HERO ]
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 text-[10.5px] font-mono text-emerald-400/80">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
          <span>Mechanical Confirmation Verified · Top Dock Auto-Pinned</span>
        </div>
      </div>
    </div>
  );
}
