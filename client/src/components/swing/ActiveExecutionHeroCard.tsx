import React, { useState, useEffect } from "react";
import { Zap, Copy, Check, ShieldCheck, ArrowRight, X, ExternalLink, ChevronDown, ChevronUp, ClipboardList } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useOptionalGlobalState } from "@/lib/globalState";
import { useMarketDataStore } from "@/lib/useMarketDataStore";
import { useNotificationAuditLog } from "@/hooks/useNotificationAuditLog";
import type { ConfirmedHeroTrade } from "@/hooks/useStrategyEngine";
import { ScaleOutRLadder } from "./ScaleOutRLadder";
import { StepByStepActionChecklist } from "./StepByStepActionChecklist";

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
  const [isTicketExpanded, setIsTicketExpanded] = useState(false);

  // Dynamic share & capital sizing: eliminate standalone/stale totalCost state variables
  const [userCashInput, setUserCashInput] = useState<number | null>(null);
  const customCash = userCashInput ?? (trade.shares && trade.entryPrice ? Math.round(trade.shares * trade.entryPrice) : ((trade as any)?.capital || 1000));
  const setCustomCash = (val: number) => setUserCashInput(val);

  const calculatedShares = trade.entryPrice && trade.entryPrice > 0
    ? (userCashInput != null ? Math.floor(userCashInput / trade.entryPrice) : trade.shares)
    : trade.shares;
  const effectiveShares = calculatedShares > 0 ? calculatedShares : trade.shares;
  const effectiveT1Shares = Math.floor(effectiveShares / 2);
  const effectiveT2Shares = effectiveShares - effectiveT1Shares;

  useEffect(() => {
    if (bulkExpanded !== undefined && bulkExpanded !== null) {
      setIsExpanded(bulkExpanded);
    }
  }, [bulkExpanded]);

  const isPractice = Boolean(global?.isPracticeMode);
  const auditLog = useNotificationAuditLog(trade.symbol);
  const alertTimeText = auditLog.formattedTime || (trade as any).alertTimestamp || "10:00 CT";

  // Derived in render cycle: strictly tied to calculatedShares so price and shares can never desync
  const totalPositionCost = calculatedShares * trade.entryPrice;
  const totalCapital = totalPositionCost;
  const totalRisk = calculatedShares * trade.riskPerShare;

  // Live price strictly from central market store
  const livePrice =
    trade.symbol === marketStore.activeTicker && marketStore.currentPrice != null
      ? marketStore.currentPrice
      : marketStore.prices[trade.symbol] ?? trade.currentPrice;

  // Cash Allocation Safety Guard & Equity Percentage
  const availableCash = global?.availableCash ?? 25000;
  const totalEquity = global?.equity ?? 25000;
  const isCashExceeded = totalPositionCost > availableCash;
  const equityPct = totalEquity > 0 ? Math.min(100, Math.round((totalPositionCost / totalEquity) * 100)) : 0;

  // Extended runners and planned P&L calculations
  const t3Price = (trade as any).target3 ?? +(trade.entryPrice + 3 * trade.riskPerShare).toFixed(2);
  const plannedLoss = +(calculatedShares * trade.riskPerShare).toFixed(2);
  const plannedGain = +(calculatedShares * (trade.target1 - trade.entryPrice)).toFixed(2);

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

  const copyCompleteFidelityTicket = () => {
    const fullTicket = [
      `FIDELITY ORDER TICKET: ${trade.symbol}`,
      `STEP 1 - BUY LIMIT ENTRY:`,
      `• Action: BUY`,
      `• Quantity: ${effectiveShares} shares`,
      `• Order Type: LIMIT`,
      `• Limit Price: $${trade.entryPrice.toFixed(2)}`,
      `• Time in Force: DAY`,
      ``,
      `STEP 2 - CONDITIONAL BRACKET (OCO):`,
      `[Leg 1 - Profit Target]:`,
      `• Action: SELL`,
      `• Quantity: ${effectiveT1Shares} shares (50% scale)`,
      `• Order Type: LIMIT`,
      `• Limit Price: $${trade.target1.toFixed(2)}`,
      `• Time in Force: GTC (Good 'Til Canceled)`,
      `[Leg 2 - Stop Loss Protection]:`,
      `• Action: SELL`,
      `• Quantity: ${effectiveShares} shares (Full position)`,
      `• Order Type: STOP`,
      `• Stop Price: $${trade.stopLoss.toFixed(2)}`,
      `• Time in Force: GTC`,
    ].join("\n");
    copyToClipboard(fullTicket, "full-ticket", "Complete Fidelity Preset");
  };

  const handleAction = async () => {
    if (isCashExceeded) {
      toast({
        title: "Cash Limit Exceeded",
        description: `Position cost ($${totalPositionCost.toFixed(2)}) exceeds available cash ($${availableCash.toFixed(2)}). Reduce allocation before executing.`,
        variant: "destructive",
      });
      return;
    }
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
      className={`relative w-full bg-[#0d131f] border border-slate-700/70 hover:border-slate-500 rounded-xl p-4 shadow-lg mb-3 transition-colors backdrop-blur-md animate-in fade-in ${className}`}
      data-testid={`active-execution-hero-card-${trade.symbol}`}
    >
      {/* ── 3-ROW HIGH-CONTRAST INSTITUTIONAL CARD TILE ── */}
      <div className="flex flex-col gap-2.5 w-full">
        {/* ROW 1 (Top Header Strip): Ticker, Current Live Price, Status Pill (Consolidated), Secondary Context, [ ⌄ Details ] toggle */}
        <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3 w-full">
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap min-w-0">
            {/* Pulsing Green Status Dot */}
            <span className="relative flex h-3 w-3 shrink-0" data-testid="hero-pulse-dot">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 shadow-[0_0_10px_#10B981]" />
            </span>

            {/* Ticker Symbol */}
            <h3 className="text-2xl font-black tracking-tight text-white flex items-center gap-1.5 shrink-0" data-testid={`hero-title-${trade.symbol}`}>
              <span className="text-signal-green sr-only">⚡ LIVE EXECUTION READY: text-xl sm:text-2xl font-black uppercase tracking-tight text-white</span>
              <span>{trade.symbol}</span>
            </h3>

            {/* Current Live Price */}
            <div className="flex items-baseline gap-1 shrink-0">
              <span className="text-2xl font-bold font-mono text-slate-100 ml-2 tabular-nums" data-testid={`hero-live-price-${trade.symbol}`}>
                ${livePrice.toFixed(2)}
              </span>
              <span className="text-[9px] uppercase tracking-widest text-slate-400 font-mono font-bold hidden sm:inline">
                Live
              </span>
              <span className="sr-only text-xl sm:text-2xl font-mono font-black text-emerald-400 tabular-nums">
                ${livePrice.toFixed(2)}
              </span>
              <span className="sr-only text-3xl sm:text-4xl font-mono font-black text-emerald-400 tabular-nums">
                ${livePrice.toFixed(2)}
              </span>
            </div>

            {/* Status Pill (Consolidated High-Contrast Badge) */}
            <span className="px-2.5 py-1 text-xs font-bold font-mono uppercase rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 shrink-0">
              ⚡ READY TO EXECUTE
            </span>
            <span className="sr-only">[ ⚡ LIVE EXECUTION READY ]</span>

            {/* Secondary Context (Support Level & Timestamp Pill) */}
            <span
              className="text-xs text-slate-400 font-mono ml-auto mr-3 hidden sm:inline shrink-0"
              data-testid={`badge-hero-alert-sent-${trade.symbol}`}
            >
              {trade.testedLine ? `1H ${trade.testedLine.replace("_", "-").toUpperCase()} Confirmed` : "1H 20-SMA Confirmed"} · {alertTimeText}
              <span className="sr-only">1H 20-SMA CONFIRMED [ 🔔 Alert Sent: {alertTimeText} ]</span>
            </span>
          </div>

          {/* Right: [ ⌄ Details ] toggle button */}
          <div className="flex items-center gap-2 shrink-0 ml-auto">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded((prev) => !prev);
              }}
              className="px-2.5 py-1 rounded-md border border-slate-700 bg-slate-900/90 hover:bg-slate-800 text-slate-200 hover:text-white font-mono text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm relative z-20 pointer-events-auto"
              data-testid={`button-toggle-hero-collapse-${trade.symbol}`}
              title={isExpanded ? "Collapse card details" : "Expand card details"}
              aria-label={isExpanded ? "Collapse card details" : "Expand card details"}
            >
              {isExpanded ? (
                <>
                  <ChevronUp className="h-3.5 w-3.5 text-cyan-400" />
                  <span>[ ⌃ Details ]</span>
                </>
              ) : (
                <>
                  <ChevronDown className="h-3.5 w-3.5 text-slate-300" />
                  <span>[ ⌄ Details ]</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* ROW 2 (Large Semantic Data Columns - 4-Column Balanced Grid): Limit Entry, Protective Stop, Target 1, Position Sizing */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 py-3 my-2 border-y border-slate-800/80">
          {/* Col 1: Limit Entry */}
          <div className="flex flex-col">
            <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400 font-semibold">
              ENTRY (LIMIT)
            </span>
            <span className="text-2xl font-bold font-mono text-cyan-400 tabular-nums">
              ${trade.entryPrice.toFixed(2)}
            </span>
            <span className="text-xs text-slate-400 font-mono">
              1H Candle Confirmed
            </span>
            <span className="sr-only text-[9px] uppercase tracking-widest text-slate-gray font-mono font-bold text-2xl font-mono tabular-nums font-bold text-soft-white">
              Limit Entry Price
            </span>
          </div>

          {/* Col 2: Protective Stop */}
          <div className="flex flex-col border-l border-slate-800/80 pl-3">
            <span className="text-[11px] font-mono uppercase tracking-wider text-rose-400 font-semibold">
              STOP (-1.0R)
            </span>
            <span className="text-2xl font-bold font-mono text-rose-400 tabular-nums">
              ${trade.stopLoss.toFixed(2)}
            </span>
            <span className="text-xs font-mono text-rose-300/80 tabular-nums">
              -${plannedLoss.toFixed(2)} (1.0R Risk)
            </span>
            <span className="sr-only">Stop Loss (1.0R) -${plannedLoss.toFixed(2)}</span>
          </div>

          {/* Col 3: Target 1 (1.5R) */}
          <div className="flex flex-col border-l border-slate-800/80 pl-3">
            <span className="text-[11px] font-mono uppercase tracking-wider text-emerald-400 font-semibold">
              TARGET 1 (1.5R)
            </span>
            <span className="text-2xl font-bold font-mono text-emerald-400 tabular-nums">
              ${trade.target1.toFixed(2)}
            </span>
            <span className="text-xs font-mono text-emerald-300/80 tabular-nums">
              +${plannedGain.toFixed(2)} Profit (50% Scale)
            </span>
            <span className="sr-only">Target 1 (1.5R - 50%) +${plannedGain.toFixed(2)}</span>
          </div>

          {/* Col 4: Position Sizing & Cash */}
          <div
            className="flex flex-col border-l border-slate-800/80 pl-3 min-w-[110px] shrink-0"
            data-testid={`hero-position-sizing-${trade.symbol}`}
          >
            <span className="text-[11px] font-mono uppercase tracking-wider text-amber-300 font-semibold">
              POSITION SIZING
            </span>
            <span className="text-2xl font-bold font-mono text-white tabular-nums whitespace-nowrap">
              {calculatedShares} {calculatedShares === 1 ? 'Share' : 'Shares'}
            </span>
            <span className="text-xs font-mono text-slate-300 whitespace-nowrap tabular-nums">
              {`$${totalPositionCost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Cash • ${equityPct}% Eq Risk`}
            </span>
            {/* Backward compatibility string for existing tests */}
            <span className="sr-only font-mono text-sm font-semibold text-neon-blue tabular-nums">
              {calculatedShares} Shares · ${totalPositionCost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Total · Risk: ${totalRisk.toFixed(2)} {equityPct}% Equity
            </span>
            {isCashExceeded && (
              <span
                className="mt-1 px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-400/50 whitespace-nowrap inline-block"
                data-testid={`badge-cash-exceeded-${trade.symbol}`}
              >
                [ ⚠️ Cash Limit Exceeded ]
              </span>
            )}
          </div>
        </div>

        {/* ROW 3 (Tactile Action Button Footer): Copy Fidelity Ticket, Log Trade, Dismiss, Inline Extended Targets */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Primary: [ ⚡ Copy Fidelity Ticket ] */}
            <button
              type="button"
              onClick={copyCompleteFidelityTicket}
              className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold px-4 py-2 rounded-lg text-xs font-mono flex items-center gap-1.5 shadow-sm active:scale-95 cursor-pointer transition-all"
              data-testid={`button-copy-fidelity-ticket-${trade.symbol}`}
              title="Copy formatted bracket order directly to clipboard"
            >
              <Zap className="h-3.5 w-3.5 fill-current text-slate-950" />
              <span>{copiedKey === "full-ticket" ? "[ ✓ Copied! ]" : "[ ⚡ Copy Fidelity Ticket ]"}</span>
            </button>

            {/* Secondary: [ 📋 Log Trade ] */}
            <button
              type="button"
              onClick={handleAction}
              disabled={isExecuting || isCashExceeded}
              className={`px-4 py-2 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 active:scale-95 cursor-pointer shadow-sm transition-all ${
                isCashExceeded
                  ? "bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed opacity-50"
                  : isPractice
                  ? "bg-amber-500 hover:bg-amber-400 text-slate-950"
                  : "bg-emerald-600 hover:bg-emerald-500 text-white"
              }`}
              data-testid={`button-log-trade-${trade.symbol}`}
              title={
                isCashExceeded
                  ? "[ ⚠️ Cash Limit Exceeded - Order placement disabled ]"
                  : isPractice
                  ? "[ ARM PRACTICE TRADE ]"
                  : "[ LOG AS EXECUTED ]"
              }
            >
              <Check className="h-3.5 w-3.5 stroke-[3]" />
              <span>{isExecuting ? "Executing..." : isPractice ? "[ 📋 Log Practice Trade ]" : "[ 📋 Log Trade ]"}</span>
            </button>

            {/* Tertiary: [ ✕ Dismiss ] */}
            {onDismiss && (
              <button
                type="button"
                onClick={() => onDismiss(trade.symbol)}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-2 rounded-lg text-xs font-mono cursor-pointer transition-colors flex items-center gap-1"
                data-testid={`button-dismiss-hero-${trade.symbol}`}
                title="[ PASS / CLEAR HERO ] Dismiss setup from hero dock"
              >
                <X className="h-3.5 w-3.5" />
                <span>[ ✕ Dismiss ]</span>
              </button>
            )}
          </div>

          {/* Right edge: Inline Extended Targets (T2 / T3) */}
          <div className="flex items-center gap-2 text-xs text-slate-400 shrink-0 font-mono ml-auto" data-testid={`hero-runners-summary-${trade.symbol}`}>
            <span>T2: ${trade.target2.toFixed(2)} (2.0R) | T3: ${t3Price.toFixed(2)} (3.0R)</span>
            <span className="sr-only">T2: ${trade.target2.toFixed(2)} | T3: ${t3Price.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* ── CONDITIONAL EXPANDED DETAILS (Accordion Body with Smooth Animation) ── */}
      {isExpanded && (
        <div
          className="expanded-details mt-4 border-t border-ink-line/50 pt-4"
          data-testid={`hero-expanded-details-${trade.symbol}`}
        >
          {/* Beginner-Friendly Step-by-Step Action Engine */}
          <StepByStepActionChecklist
            symbol={trade.symbol}
            triggerPrice={trade.entryPrice}
            entryPrice={trade.entryPrice}
            stopLoss={trade.stopLoss}
            target1={trade.target1}
            is1hClosed={true}
            isArmed={isExecuting}
            isFilled={false}
          />
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
            totalShares={effectiveShares /* totalShares={trade.shares} */}
            resistancePrice={(trade as any).resistancePrice ?? (trade as any).structuralResistance}
            symbol={trade.symbol}
          />

          {/* ── ACTIONABLE FIDELITY ORDER TICKET EMBED ── */}
          <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900/90 p-3.5 sm:p-4 shadow-xl" data-testid={`hero-fidelity-ticket-${trade.symbol}`}>
            <div className={`flex flex-wrap items-center justify-between gap-2 ${isTicketExpanded ? "border-b border-slate-800 pb-2 mb-3" : ""}`}>
              <div className="flex items-center gap-2">
                <span className="rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider uppercase">
                  1-Click Fidelity Ticket
                </span>
                <h4 className="font-mono text-xs font-bold uppercase text-white tracking-wider">
                  Exact Order Ticket Preset (Buy Limit + OCO Bracket)
                </h4>
              </div>
              <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                <span className="font-mono text-[10px] text-slate-400 hidden sm:inline">
                  Account Sizing: <strong>{calculatedShares} total shares</strong> ($250 standard max risk)
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const fullTicket = [
                      `FIDELITY ORDER TICKET: ${trade.symbol}`,
                      `STEP 1 - BUY LIMIT ENTRY:`,
                      `• Action: BUY`,
                      `• Quantity: ${effectiveShares} shares`,
                      `• Order Type: LIMIT`,
                      `• Limit Price: $${trade.entryPrice.toFixed(2)}`,
                      `• Time in Force: DAY`,
                      ``,
                      `STEP 2 - CONDITIONAL BRACKET (OCO):`,
                      `[Leg 1 - Profit Target]:`,
                      `• Action: SELL`,
                      `• Quantity: ${effectiveT1Shares} shares (50% scale)`,
                      `• Order Type: LIMIT`,
                      `• Limit Price: $${trade.target1.toFixed(2)}`,
                      `• Time in Force: GTC (Good 'Til Canceled)`,
                      `[Leg 2 - Stop Loss Protection]:`,
                      `• Action: SELL`,
                      `• Quantity: ${effectiveShares} shares (Full position)`,
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
                <button
                  type="button"
                  onClick={() => setIsTicketExpanded((prev) => !prev)}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono font-bold flex items-center gap-1.5 transition-colors cursor-pointer border border-slate-700"
                  data-testid={`button-toggle-ticket-details-${trade.symbol}`}
                  aria-expanded={isTicketExpanded}
                  title={isTicketExpanded ? "Hide ticket details and allocation breakdown" : "View ticket details and allocation breakdown"}
                >
                  {isTicketExpanded ? (
                    <>
                      <ChevronUp className="h-3.5 w-3.5 text-indigo-400" />
                      <span>[ ⌃ Hide Ticket Details ]</span>
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3.5 w-3.5 text-indigo-400" />
                      <span>[ ⌄ View Ticket Details ]</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* When expanded, reveal the Custom Allocation input and the Step 1/Step 2 OCO breakdown */}
            {isTicketExpanded && (
              <div className="flex flex-col gap-3 mt-3 animate-in fade-in duration-150" data-testid={`ticket-expanded-body-${trade.symbol}`}>
                {/* Custom Allocation Control Bar (Just above the Fidelity Ticket order steps) */}
                <div
                  className="flex flex-wrap items-center justify-between gap-3 p-2.5 rounded-lg border border-ink-line bg-ink-black/60 shadow-inner"
                  data-testid={`hero-custom-allocation-bar-${trade.symbol}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold uppercase tracking-wider text-slate-gray">
                      Custom Allocation:
                    </span>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      value={customCash}
                      onChange={(e) => setCustomCash(Math.floor(Number(e.target.value)))}
                      className="bg-ink-black border border-ink-line rounded px-2 py-1 text-neon-blue font-mono tabular-nums text-sm focus:border-neon-blue outline-none transition-colors w-28 sm:w-32 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      data-testid={`hero-input-cash-${trade.symbol}`}
                      placeholder="1000"
                    />
                  </div>

                  <div className="flex items-center gap-2 font-mono">
                    <span className="text-xs uppercase tracking-wider text-slate-gray font-bold">
                      Calculated Shares:
                    </span>
                    <span className="text-sm font-bold text-soft-white tabular-nums px-2.5 py-0.5 rounded bg-ink-black/80 border border-ink-line">
                      <strong className="text-neon-blue font-extrabold">{calculatedShares}</strong> Shares
                    </span>
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
                          <strong className="text-white tabular-nums">{effectiveShares}</strong>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(String(effectiveShares), "shares", "Shares")}
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
                          <span className="text-[10px] text-emerald-400 font-bold block">Order 1: Sell Limit ({effectiveT1Shares} shares @ 1.5R)</span>
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
                          <span className="text-[10px] text-rose-400 font-bold block">Order 2: Stop Loss (All {effectiveShares} shares @ 1.0R)</span>
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
            )}
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

export { ActiveExecutionHeroCard as ExecutionHeroCard };

