import React, { useState } from "react";
import { GraduationCap, Zap, Copy, Check, TrendingUp, Clock, AlertTriangle, ShieldCheck } from "lucide-react";
import { useOptionalGlobalState } from "@/lib/globalState";
import { useMarketDataStore } from "@/lib/useMarketDataStore";
import { useSwingDecision } from "@/lib/swing";
import { useToast } from "@/hooks/use-toast";
import { tradeApi, invalidateTrades } from "@/lib/swingTrades";
import { tradeSetupStore } from "@/lib/useTradeSetupStore";
import type { Timeframe } from "@/lib/timeframes";

export interface AICoachPanelProps {
  ticker: string;
  bars?: Array<{ time?: number; date?: string; open: number; high: number; low: number; close: number; volume?: number }>;
  timeframe?: Timeframe;
  livePrice?: number | null;
  entryPrice?: number | null;
  stopLoss?: number | null;
  primaryTarget?: number | null;
}

export function AICoachPanel({
  ticker,
  bars = [],
  timeframe = "1D",
  livePrice: propLivePrice,
  entryPrice: propEntryPrice,
  stopLoss: propStopLoss,
  primaryTarget: propPrimaryTarget,
}: AICoachPanelProps) {
  const global = useOptionalGlobalState();
  const marketStore = useMarketDataStore();
  const { toast } = useToast();
  const [isArming, setIsArming] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data: decisionResp } = useSwingDecision(ticker, "LAST5");
  const decision = decisionResp?.decision;

  const isPractice = Boolean(global?.isPracticeMode);

  // Live price strictly from central market store or bars
  const currentLivePrice =
    (marketStore.activeTicker === ticker && marketStore.currentPrice != null)
      ? marketStore.currentPrice
      : (marketStore.prices[ticker] ?? propLivePrice ?? decision?.currentPrice ?? (bars.length > 0 ? bars[bars.length - 1].close : 0));

  // Determine if this setup is Ready to Trade
  const hasHardBlock = Boolean((decision as any)?.hasHardBlock || (decision as any)?.hardBlockReason);
  const isStatusReady = decision?.setupStatus === "READY_TO_TRADE";
  const isConfirmedInGlobal = Boolean(global?.confirmedSetups?.[ticker]);
  const isReady = (isStatusReady && !hasHardBlock && !decision?.levelsInvalid) || isConfirmedInGlobal;

  // Level derivations
  const entryPrice = +(propEntryPrice ?? decision?.entryPrice ?? decision?.currentTrigger ?? (currentLivePrice > 0 ? currentLivePrice : 100));
  const stopLoss = +(propStopLoss ?? decision?.structuralStop ?? (entryPrice * 0.98).toFixed(2));
  const target1 = +(propPrimaryTarget ?? decision?.target1 ?? (entryPrice + 1.5 * Math.abs(entryPrice - stopLoss)).toFixed(2));
  const target2 = +(decision?.target2 ?? (entryPrice + 2.0 * Math.abs(entryPrice - stopLoss)).toFixed(2));

  const riskPerShare = Math.max(0.01, +(Math.abs(entryPrice - stopLoss)).toFixed(2));
  const accountRisk = isPractice ? 100 : Math.round((global?.equity ?? 25000) * 0.01);
  const shares = Math.max(1, Math.floor(accountRisk / riskPerShare));

  const testedName = decision?.testedLine ? decision.testedLine.replace("_", "-").toUpperCase() : "20-SMA";

  const handleArmTrade = async () => {
    setIsArming(true);
    try {
      if (isPractice) {
        if (global?.logPracticeTrade) {
          global.logPracticeTrade({
            symbol: ticker.toUpperCase(),
            entryPrice,
            stopLoss,
            target1,
            target2,
            riskReward: 1.5,
            shares,
            dollarRisk: accountRisk,
            setupType: "IN_CHART_EXECUTION",
            timeframe: (timeframe || "1H").toUpperCase(),
          });
        }
        toast({
          title: `🧪 Practice Trade Armed · ${ticker}`,
          description: `Armed ${shares} shares @ $${entryPrice.toFixed(2)}. Routed to Active Trades.`,
        });
      } else {
        await tradeApi.arm({
          symbol: ticker.toUpperCase(),
          entry: entryPrice,
          stop: stopLoss,
          shares,
          riskDollars: accountRisk,
          t1: target1,
          t2: target2,
          setupType: "IN_CHART_EXECUTION",
          timeframe: (timeframe || "1H").toUpperCase(),
          notes: `Armed from In-Chart Trade Card: ${ticker}`,
        } as any);
        invalidateTrades();
        toast({
          title: `⚡ Trade Armed · ${ticker}`,
          description: `Armed ${shares} shares @ $${entryPrice.toFixed(2)} on live engine.`,
        });
      }

      tradeSetupStore.addActiveExecutionSetup({
        symbol: ticker.toUpperCase(),
        ticker: ticker.toUpperCase(),
        entryPrice,
        stopLoss,
        target1,
        target2,
        shares,
        riskPerShare,
        currentPrice: currentLivePrice,
        testedLine: decision?.testedLine || "20_SMA",
        timeframe: (timeframe || "1H").toUpperCase(),
      } as any);

      window.dispatchEvent(
        new CustomEvent("chizzle:trade-armed", {
          detail: { symbol: ticker.toUpperCase(), entry: entryPrice, stop: stopLoss },
        })
      );
    } catch (e: any) {
      toast({
        title: "Execution Error",
        description: e?.message || "Failed to arm trade.",
        variant: "destructive",
      });
    } finally {
      setIsArming(false);
    }
  };

  const handleCopyTicket = () => {
    const ticketText = [
      `FIDELITY ORDER TICKET: ${ticker.toUpperCase()}`,
      `STEP 1 - BUY LIMIT ENTRY:`,
      `• Action: BUY`,
      `• Quantity: ${shares} shares`,
      `• Order Type: LIMIT`,
      `• Limit Price: $${entryPrice.toFixed(2)}`,
      `• Time in Force: DAY`,
      ``,
      `STEP 2 - CONDITIONAL BRACKET (OCO):`,
      `[Leg 1 - Profit Target]:`,
      `• Action: SELL`,
      `• Quantity: ${Math.floor(shares / 2)} shares (50% scale)`,
      `• Order Type: LIMIT`,
      `• Limit Price: $${target1.toFixed(2)}`,
      `• Time in Force: GTC`,
      `[Leg 2 - Stop Loss Protection]:`,
      `• Action: SELL`,
      `• Quantity: ${shares} shares (Full position)`,
      `• Order Type: STOP`,
      `• Stop Price: $${stopLoss.toFixed(2)}`,
      `• Time in Force: GTC`,
    ].join("\n");

    navigator.clipboard?.writeText(ticketText);
    setCopied(true);
    toast({
      title: "📋 Bracket Order Copied",
      description: `Fidelity ticket for ${ticker.toUpperCase()} copied to clipboard.`,
    });
    setTimeout(() => setCopied(false), 2000);
  };

  // ── STATE 1: READY TO TRADE -> SWAP OUT TO IN-CHART TRADE CARD ──
  if (isReady) {
    return (
      <div
        className="w-full flex flex-col gap-3.5 p-4 rounded-lg bg-slate-800/50 border border-emerald-500/50 backdrop-blur-md shadow-[0_0_20px_rgba(16,185,129,0.15)] font-mono text-white animate-in fade-in duration-200"
        data-testid="in-chart-trade-card"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700/80 pb-2.5">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
            </span>
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
              [ ⚡ READY TO TRADE ]
            </span>
          </div>
          <span className="text-[10px] text-slate-400 font-mono">
            1H Candle Confirmed
          </span>
        </div>

        {/* Ticker & Price Header */}
        <div className="flex items-baseline justify-between py-1">
          <span className="text-2xl font-black text-white font-mono tracking-tight">{ticker}</span>
          <span className="text-xl font-bold font-mono text-emerald-400 tabular-nums">
            ${currentLivePrice > 0 ? currentLivePrice.toFixed(2) : entryPrice.toFixed(2)}
          </span>
        </div>

        {/* Core Metric 3-Column Grid */}
        <div className="grid grid-cols-3 gap-2 p-2.5 rounded-lg bg-slate-900/90 border border-slate-700/80 text-center">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase font-bold text-slate-400">Entry</span>
            <span className="text-base font-bold font-mono text-cyan-400 tabular-nums">${entryPrice.toFixed(2)}</span>
          </div>
          <div className="flex flex-col border-x border-slate-800">
            <span className="text-[10px] uppercase font-bold text-rose-400">Stop (-1R)</span>
            <span className="text-base font-bold font-mono text-rose-400 tabular-nums">${stopLoss.toFixed(2)}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] uppercase font-bold text-emerald-400">Target (1.5R)</span>
            <span className="text-base font-bold font-mono text-emerald-400 tabular-nums">${target1.toFixed(2)}</span>
          </div>
        </div>

        {/* Sizing Summary */}
        <div className="flex items-center justify-between text-xs text-slate-300 px-1 py-1 border-b border-slate-700/60">
          <span>Position Sizing:</span>
          <span className="font-bold text-white tabular-nums">{shares} Shares · ${accountRisk} Max Risk</span>
        </div>

        {/* Action Buttons: Arm Trade & Fidelity Copy */}
        <div className="flex flex-col gap-2 pt-1">
          <button
            type="button"
            onClick={handleArmTrade}
            disabled={isArming}
            className={`w-full py-2.5 px-3 rounded-lg font-mono font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 shadow-md active:scale-95 cursor-pointer ${
              isPractice
                ? "bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-amber-500/20"
                : "bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-500/20"
            }`}
            data-testid={`button-in-chart-arm-${ticker}`}
          >
            <Zap className="w-3.5 h-3.5 fill-current" />
            <span>{isArming ? "Arming..." : isPractice ? "[ 🧪 Arm Practice Trade ]" : "[ ⚡ Arm Trade / Execute ]"}</span>
          </button>

          <button
            type="button"
            onClick={handleCopyTicket}
            className="w-full py-1.5 px-3 rounded-lg border border-slate-700 bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-white font-mono text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-1.5"
            data-testid={`button-in-chart-copy-ticket-${ticker}`}
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
            <span>{copied ? "Ticket Copied!" : "[ 📋 Copy Fidelity Bracket ]"}</span>
          </button>
        </div>
      </div>
    );
  }

  // ── STATE 2: NOT READY (FORMING / PENDING) -> AI CANDLE COACH MENTOR INSTRUCTIONS ──
  return (
    <div
      className="w-full flex flex-col gap-3.5 p-4 rounded-lg bg-slate-800/50 border border-slate-700 backdrop-blur-md shadow-lg font-mono text-slate-300 animate-in fade-in duration-200"
      data-testid="ai-candle-coach-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-700 pb-2.5">
        <div className="flex items-center gap-2">
          <GraduationCap className="w-4 h-4 text-neon-blue" />
          <span className="font-mono text-xs font-bold uppercase tracking-wider text-white">
            [ 🧠 AI CANDLE COACH ]
          </span>
        </div>
        <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[10px] font-bold uppercase">
          [ ⏳ PENDING 1H CONFIRMATION ]
        </span>
      </div>

      {/* Structured Mentoring Instructions */}
      <div className="space-y-3 text-sm text-slate-300">
        {/* 1. Current State */}
        <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-700/60 flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400 uppercase tracking-wider">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            <span>1. Current State</span>
          </div>
          <p className="leading-relaxed">
            Trend is <strong className="text-emerald-400 font-semibold">Bullish</strong>. Price is pulling back to the{" "}
            <strong className="text-cyan-400 font-semibold">{testedName}</strong>.
          </p>
        </div>

        {/* 2. What to Look For */}
        <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-700/60 flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400 uppercase tracking-wider">
            <Clock className="w-3.5 h-3.5 text-neon-blue" />
            <span>2. What to Look For</span>
          </div>
          <p className="leading-relaxed">
            Wait for the current 1H candle to close green above{" "}
            <span className="font-mono text-neon-blue font-bold tabular-nums">${entryPrice.toFixed(2)}</span>.
          </p>
        </div>

        {/* 3. Invalidation */}
        <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-700/60 flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400 uppercase tracking-wider">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
            <span>3. Invalidation</span>
          </div>
          <p className="leading-relaxed">
            Cancel if the 4H candle closes below{" "}
            <span className="font-mono text-neon-blue font-bold tabular-nums">${stopLoss.toFixed(2)}</span>.
          </p>
        </div>
      </div>

      {/* Mentor Note Footer */}
      <div className="pt-1 text-[11px] text-slate-400 leading-snug border-t border-slate-700/60 flex items-center gap-1.5">
        <ShieldCheck className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
        <span>Mentor Note: Wait for the 1H candle close confirmation before committing capital.</span>
      </div>
    </div>
  );
}

export default AICoachPanel;
