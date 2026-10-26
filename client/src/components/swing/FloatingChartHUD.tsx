import React from "react";
import { ArrowUpRight, ArrowDownRight, Compass, ShieldCheck } from "lucide-react";

export interface FloatingChartHUDProps {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  timeframe: string;
  fourHourTrend?: "BULLISH" | "BEARISH" | "NEUTRAL";
  dayClassification?: "PRACTICE_SWING_DAY" | "STANDBY_DAY";
  setupStatus?: string;
  isMarketOpen?: boolean;
  isPullbackTo20Sma?: boolean;
}

export const FloatingChartHUD: React.FC<FloatingChartHUDProps> = ({
  symbol,
  price,
  change,
  changePct,
  timeframe,
  fourHourTrend = "BULLISH",
  dayClassification = "PRACTICE_SWING_DAY",
  setupStatus = "Ready",
  isMarketOpen = true,
  isPullbackTo20Sma = false,
}) => {
  const isUp = change >= 0;

  return (
    <div
      data-testid="floating-chart-hud"
      className="flex flex-wrap items-center justify-between gap-3 w-full select-none"
    >
      {/* Left Cluster: Ticker, Live Price & Session Change */}
      <div className="flex items-center gap-3">
        <span className="font-sans font-black text-3xl md:text-4xl tracking-tight text-white drop-shadow-sm">
          {symbol}
        </span>
        <span className="text-xs font-mono text-slate-400 px-2 py-0.5 rounded bg-white/5 border border-white/10">
          {timeframe}
        </span>
        <div className="h-6 w-px bg-white/10" />
        <div className="flex items-baseline gap-2 font-mono">
          <span
            className={`text-3xl md:text-4xl font-black tabular-nums tracking-tight ${
              isUp ? "text-[#00E676] drop-shadow-[0_0_12px_rgba(0,230,118,0.3)]" : "text-[#FF5252] drop-shadow-[0_0_12px_rgba(255,82,82,0.3)]"
            }`}
          >
            ${Number.isFinite(price) ? price.toFixed(2) : "0.00"}
          </span>
          <span
            className={`text-xs flex items-center font-bold px-2 py-0.5 rounded ${
              isUp
                ? "bg-emerald-500/15 text-[#00E676] border border-emerald-500/30"
                : "bg-rose-500/15 text-[#FF5252] border border-rose-500/30"
            }`}
          >
            {isUp ? <ArrowUpRight className="h-3 w-3 mr-0.5" /> : <ArrowDownRight className="h-3 w-3 mr-0.5" />}
            {isUp ? "+" : ""}{change.toFixed(2)} ({isUp ? "+" : ""}{changePct.toFixed(2)}%)
          </span>
        </div>
      </div>

      {/* Right Cluster: Floating Status Badges & HUD Pills */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Dynamic 20-SMA Pullback Glow Alert Badge */}
        {isPullbackTo20Sma && (
          <div
            data-testid="hud-buy-zone-badge"
            className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold tracking-wider uppercase border border-emerald-400/50 bg-emerald-500/15 text-[#00E676] shadow-[0_0_12px_rgba(0,230,118,0.25)] animate-pulse"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[#00E676] animate-ping" />
            <span>20-SMA PULLBACK</span>
          </div>
        )}

        {/* 4H Trend State Pill */}
        <div
          data-testid="hud-4h-trend-pill"
          className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold tracking-wider uppercase border backdrop-blur-md shadow-sm transition-colors ${
            fourHourTrend === "BULLISH"
              ? "bg-emerald-500/10 text-[#00E676] border-emerald-500/30"
              : fourHourTrend === "BEARISH"
              ? "bg-rose-500/10 text-[#FF5252] border-rose-500/30"
              : "bg-slate-800/80 text-slate-300 border-white/10"
          }`}
        >
          <Compass className="h-3.5 w-3.5" />
          <span>4H {fourHourTrend}</span>
        </div>

        {/* Daily Regime Classification Pill */}
        <div
          data-testid="hud-day-classification-pill"
          className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold tracking-wider uppercase border backdrop-blur-md shadow-sm ${
            dayClassification === "PRACTICE_SWING_DAY"
              ? "bg-cyan-500/10 text-cyan-300 border-cyan-500/30"
              : "bg-amber-500/10 text-amber-300 border-amber-500/30"
          }`}
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>{dayClassification === "PRACTICE_SWING_DAY" ? "SWING DAY" : "STANDBY"}</span>
        </div>

        {/* Setup Status Pill with soft opacity */}
        <div
          data-testid="hud-setup-status-pill"
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-bold tracking-wider uppercase border ${
            setupStatus === "Ready"
              ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
              : "bg-cyan-500/15 text-cyan-300 border-cyan-500/30"
          }`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          <span>{setupStatus}</span>
        </div>

        {/* Market Status Dot */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900/80 border border-white/10 text-[10px] font-mono text-slate-400">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              isMarketOpen ? "bg-[#00E676] shadow-[0_0_6px_#00E676]" : "bg-slate-500"
            }`}
          />
          <span>{isMarketOpen ? "LIVE RTH" : "CLOSED"}</span>
        </div>
      </div>
    </div>
  );
};
