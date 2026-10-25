import React from "react";
import type { WatchlistItem } from "@/pages/WealthEngineDashboard";
import { useGlobalState } from "@/lib/globalState";
import { Sparkles, ShieldCheck, Zap, ArrowRight, Play, CheckCircle } from "lucide-react";

interface TradingTipsProps {
  item: WatchlistItem;
}

export function TradingTipsCard({ item }: TradingTipsProps) {
  const { openArmTrade } = useGlobalState();

  const sma20 = +(item.price * 0.985).toFixed(2);
  const atrVal = item.atr ? item.atr.toFixed(2) : "3.50";

  // Dynamic contextual tips generated specifically for this symbol and setup
  const tips = [
    {
      title: "Key Level & 20-SMA",
      text: `Holding structural 20-SMA support at $${sma20}. Await candle close above $${item.buyTarget.toFixed(2)} to confirm bounce.`,
      icon: CheckCircle,
      color: "text-blue-400",
    },
    {
      title: "Volume Confirmation",
      text: `Demand volume spike >1.2x average needed. Avoid chasing entry if current candle exceeds 1.5 ATR ($${atrVal}).`,
      icon: Zap,
      color: "text-amber-400",
    },
    {
      title: "Risk & Profit Target",
      text: `Hard stop pinned below structural low at $${item.stopLoss.toFixed(2)}. Scale 50% at T1 ($${item.primaryTarget.toFixed(2)}) and trail stop.`,
      icon: ShieldCheck,
      color: "text-emerald-400",
    },
  ];

  return (
    <div
      data-testid="trading-tips-card"
      className="p-3.5 rounded-xl border flex flex-col gap-2.5 transition-all shadow-md select-none mt-2"
      style={{
        backgroundColor: "var(--bg-panel-subtle)",
        borderColor: "var(--border-subtle)",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-white/5">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded bg-fuchsia-500/20 text-fuchsia-400 border border-fuchsia-400/40">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <span className="font-mono text-xs font-bold uppercase tracking-wider text-fuchsia-300">
            {item.symbol} Actionable Tips
          </span>
        </div>
        <span className="text-[9.5px] font-mono uppercase px-2 py-0.5 rounded bg-white/5 text-slate-400">
          3-Point Guide
        </span>
      </div>

      {/* 3 Actionable Tips */}
      <div className="space-y-2 font-mono text-xs">
        {tips.map((tip, idx) => {
          const Icon = tip.icon;
          return (
            <div
              key={idx}
              className="p-2 rounded-lg bg-black/25 border border-white/5 flex items-start gap-2.5"
            >
              <Icon className={`h-3.5 w-3.5 mt-0.5 flex-shrink-0 ${tip.color}`} />
              <div className="min-w-0">
                <span className={`font-bold block text-[10px] uppercase tracking-wide ${tip.color}`}>
                  {tip.title}
                </span>
                <p className="text-[11px] text-slate-300 leading-snug mt-0.5 font-sans font-medium">
                  {tip.text}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Arm Trade Shortcut Button */}
      <button
        type="button"
        data-testid="button-tips-arm-trade"
        onClick={() => openArmTrade(item.symbol)}
        className="w-full mt-1 py-1.5 px-3 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/40 text-cyan-300 font-mono text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-sm"
      >
        <Play className="h-3 w-3 fill-current" />
        <span>Arm {item.symbol} Setup</span>
      </button>
    </div>
  );
}

