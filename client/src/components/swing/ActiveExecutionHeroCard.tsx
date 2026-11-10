import React, { useState, useEffect } from "react";
import { Zap, Copy, Check, ShieldCheck, ArrowRight, X, ExternalLink, ChevronDown, ChevronUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useOptionalGlobalState } from "@/lib/globalState";
import { useMarketDataStore } from "@/lib/useMarketDataStore";
import { useNotificationAuditLog } from "@/hooks/useNotificationAuditLog";
import type { ConfirmedHeroTrade } from "@/hooks/useStrategyEngine";
import { ScaleOutRLadder } from "./ScaleOutRLadder";

export interface ActiveExecutionHeroCardProps {
  trade: ConfirmedHeroTrade;
  onDismiss?: (symbol: string) => void;
  onArmOrExecute?: (trade: ConfirmedHeroTrade) => Promise<void> | void;
  className?: string;
  bulkExpanded?: boolean | null;
}

export function ActiveExecutionHeroCard({
  trade,
  onDismiss,
  onArmOrExecute,
  className = "",
  bulkExpanded,
}: ActiveExecutionHeroCardProps) {
  const { toast } = useToast();
  const global = useOptionalGlobalState();
  const marketStore = useMarketDataStore();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (bulkExpanded !== undefined && bulkExpanded !== null) {
      setIsExpanded(bulkExpanded);
    }
  }, [bulkExpanded]);

  const isPractice = Boolean(global?.isPracticeMode);
  const auditLog = useNotificationAuditLog(trade.symbol);
  const alertTimeText = auditLog.formattedTime || (trade as any).alertTimestamp || "10:00 CT";

  // Trade capital & risk calculations
  const totalCapital = trade.shares * trade.entryPrice;
  const totalRisk = trade.shares * trade.riskPerShare;

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
      className={`relative w-full rounded-2xl border-2 border-emerald-500/90 bg-gradient-to-b from-[#062419] via-[#091A14] to-[#0B0E14] p-3 sm:p-4 shadow-[0_0_35px_rgba(16,185,129,0.35)] ring-1 ring-emerald-400/40 backdrop-blur-md transition-all duration-300 animate-in fade-in ${className}`}
      data-testid={`active-execution-hero-card-${trade.symbol}`}
    >
      {/* ── COMPACT ROW (Default State): Chevron, Ticker, Badges, 3 Core Prices, Position Sizing, Live Price ── */}
      <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5 sm:gap-4 overflow-hidden w-full">
        {/* Left: Chevron Toggle + Ticker Symbol + Status Badges */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0 min-w-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded((prev) => !prev);
            }}
            className="p-1 sm:p-1.5 rounded-md border border-slate-700 bg-slate-900/90 hover:bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer flex items-center justify-center relative z-20 pointer-events-auto shrink-0 shadow-sm"
            data-testid={`button-toggle-hero-collapse-${trade.symbol}`}
            title={isExpanded ? "Collapse card details" : "Expand card details"}
            aria-label={isExpanded ? "Collapse card details" : "Expand card details"}
          >
            {isExpanded ? (
              <ChevronUp className="h-4 w-4 text-emerald-400 shrink-0" />
            ) : (
              <ChevronDown className="h-4 w-4 text-slate-300 shrink-0" />
            )}
          </button>

          {/* Pulsing Green Status Dot */}
          <span className="relative flex h-3 w-3 shrink-0" data-testid="hero-pulse-dot">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 shadow-[0_0_10px_#10B981]" />
          </span>

          <h3 className="font-mono text-xl font-extrabold uppercase tracking-tight text-signal-green shrink-0 flex items-center gap-1.5" data-testid={`hero-title-${trade.symbol}`}>
            <span className="hidden md:inline">⚡ LIVE EXECUTION READY:</span>
            <span>[{trade.symbol}]</span>
          </h3>

          <span className="rounded-full bg-emerald-500/20 border border-emerald-400/60 px-2 py-0.5 font-mono text-[9px] sm:text-[10px] font-extrabold uppercase tracking-widest text-emerald-300 shrink-0">
            [ ⚡ LIVE EXECUTION READY ]
          </span>

          <span className="rounded-full bg-emerald-500/20 border border-emerald-400/60 px-2 py-0.5 font-mono text-[9px] sm:text-[10px] font-extrabold uppercase tracking-widest text-emerald-300 shrink-0 hidden lg:inline">
            {trade.testedLine ? `1H ${trade.testedLine.replace("_", " ")} Confirmed` : "1H Candle Closed Green"}
          </span>

          <span
            className="rounded-full bg-emerald-950/80 border border-emerald-400/70 px-2 py-0.5 font-mono text-[9px] sm:text-[10px] font-bold text-emerald-300 shadow-sm flex items-center gap-1 shrink-0 hidden xl:inline-flex"
            data-testid={`badge-hero-alert-sent-${trade.symbol}`}
          >
            [ 🔔 Alert Sent: {alertTimeText} ]
          </span>
        </div>

        {/* 3 Core Prices (Limit Entry, Stop Loss, Target 1) + POSITION SIZING Block */}
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 sm:gap-4 px-3 py-1 rounded-xl border border-emerald-500/30 bg-slate-950/80 shrink-0 shadow-inner">
          {/* Entry Price */}
          <div className="flex flex-col">
            <span className="text-[9px] uppercase tracking-widest text-slate-gray font-mono font-bold">
              Limit Entry Price
            </span>
            <span className="text-2xl font-mono tabular-nums font-bold text-soft-white">
              ${trade.entryPrice.toFixed(2)}
            </span>
          </div>

          {/* Stop Loss */}
          <div className="flex flex-col border-l border-emerald-500/30 pl-3 sm:pl-4">
            <span className="text-[9px] uppercase tracking-widest text-slate-gray font-mono font-bold">
              Stop Loss (1.0R)
            </span>
            <span className="text-2xl font-mono tabular-nums font-bold text-soft-white text-rose-400">
              ${trade.stopLoss.toFixed(2)}
            </span>
          </div>

          {/* Target 1 */}
          <div className="flex flex-col border-l border-emerald-500/30 pl-3 sm:pl-4">
            <span className="text-[9px] uppercase tracking-widest text-slate-gray font-mono font-bold">
              Target 1 (1.5R - 50%)
            </span>
            <span className="text-2xl font-mono tabular-nums font-bold text-soft-white text-emerald-400">
              ${trade.target1.toFixed(2)}
            </span>
          </div>

          {/* POSITION SIZING Block next to Target 1 */}
          <div className="flex flex-col border-l border-emerald-500/30 pl-3 sm:pl-4 shrink-0" data-testid={`hero-position-sizing-${trade.symbol}`}>
            <span className="text-[9px] uppercase tracking-widest text-slate-gray font-mono font-bold">
              Position Sizing
            </span>
            <span className="font-mono text-sm font-semibold text-neon-blue tabular-nums">
              {trade.shares} Shares · ${totalCapital.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Total · Risk: ${totalRisk.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Right: Live Exchange Price and Dismiss */}
        <div className="flex items-center gap-3 shrink-0 ml-auto">
          <div className="text-right">
            <span className="block font-mono text-[9px] uppercase font-bold text-emerald-400/80">Live Exchange Price</span>
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

      {/* ── CONDITIONAL EXPANDED DETAILS (Target 2, Scale-Outs, Fidelity Ticket, Actions) ── */}
      {isExpanded && (
        <div
          className="expanded-details mt-4 border-t border-ink-line/50 pt-4"
          data-testid={`hero-expanded-details-${trade.symbol}`}
        >
          {/* Target 2 (2.0R Core) & Copy buttons */}
          <div className="rounded-xl border border-purple-500/40 bg-slate-950/80 p-3 shadow-inner mb-3">
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

          {/* ── INLINE 4-COLUMN SCALE-OUT R-LADDER (1.5R Partial + 2R/3R/4R Runners) ── */}
          <ScaleOutRLadder
            entryPrice={trade.entryPrice}
            stopLossPrice={trade.stopLoss}
            totalShares={trade.shares}
            resistancePrice={(trade as any).resistancePrice ?? (trade as any).structuralResistance}
            symbol={trade.symbol}
          />

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
                      `• Quantity: ${trade.shares} shares`,
                      `• Order Type: LIMIT`,
                      `• Limit Price: $${trade.entryPrice.toFixed(2)}`,
                      `• Time in Force: DAY`,
                      ``,
                      `STEP 2 - CONDITIONAL BRACKET (OCO):`,
                      `[Leg 1 - Profit Target]:`,
                      `• Action: SELL`,
                      `• Quantity: ${trade.t1Shares} shares (50% scale)`,
                      `• Order Type: LIMIT`,
                      `• Limit Price: $${trade.target1.toFixed(2)}`,
                      `• Time in Force: GTC (Good 'Til Canceled)`,
                      `[Leg 2 - Stop Loss Protection]:`,
                      `• Action: SELL`,
                      `• Quantity: ${trade.shares} shares (Full position)`,
                      `• Order Type: STOP`,
                      `• Stop Price: $${trade.stopLoss.toFixed(2)}`,
                      `• Time in Force: GTC`,
                    ].join("\n");
                    copyToClipboard(fullTicket, "full-ticket", "Complete Fidelity Preset");
                  }}
                  className="px-2.5 py-1 rounded bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 text-xs font-mono font-bold flex items-center gap-1.5 transition-colors cursor-pointer border border-indigo-500/40"
                  data-testid={`button-copy-fidelity-ticket-${trade.symbol}`}
                >
                  {copiedKey === "full-ticket" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copiedKey === "full-ticket" ? "ORDER TICKET COPIED TO CLIPBOARD" : "COPY FIDELITY ORDER TICKET"}</span>
                </button>
              </div>
            </div>

            {/* 2-Step Interactive Fidelity Layout */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
              {/* STEP 1: Buy Limit Entry */}
              <div className="rounded-lg border border-cyan-500/30 bg-slate-950/70 p-3 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-mono font-bold text-cyan-300 border-b border-slate-800 pb-1.5">
                  <span>Step 1: Open Initial Position</span>
                  <span className="text-[10px] uppercase text-cyan-400/80">BUY · LIMIT</span>
                </div>

                <div className="space-y-1 text-xs font-mono">
                  <div className="flex justify-between py-1 border-b border-slate-800/60">
                    <span className="text-slate-400">Order Action:</span>
                    <strong className="text-emerald-400">BUY</strong>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-800/60">
                    <span className="text-slate-400">Shares / Quantity:</span>
                    <div className="flex items-center gap-1.5">
                      <strong className="text-white tabular-nums">{trade.shares}</strong>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(String(trade.shares), "shares", "Shares")}
                        className="text-slate-400 hover:text-white"
                        title="Copy Shares"
                        data-testid={`copy-hero-shares-${trade.symbol}`}
                      >
                        {copiedKey === "shares" ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                      </button>
                    </div>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-800/60">
                    <span className="text-slate-400">Order Type:</span>
                    <strong className="text-white">Limit</strong>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-800/60">
                    <span className="text-slate-400">Limit Price:</span>
                    <div className="flex items-center gap-1.5">
                      <strong className="text-emerald-400 tabular-nums">${trade.entryPrice.toFixed(2)}</strong>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(trade.entryPrice.toFixed(2), "step1-price", "Limit Price")}
                        className="text-slate-400 hover:text-white"
                        title="Copy Limit Price"
                        data-testid={`copy-hero-step1-price-${trade.symbol}`}
                      >
                        {copiedKey === "step1-price" ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                      </button>
                    </div>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-400">Time in Force:</span>
                    <strong className="text-amber-300">DAY</strong>
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
      )}
    </div>
  );
}
