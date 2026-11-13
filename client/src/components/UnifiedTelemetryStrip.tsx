// ─── UnifiedTelemetryStrip ───────────────────────────────────────────────────
// Single unified top telemetry strip consolidating system health, practice mode switch,
// and account metrics in an institutional single-row layout.

import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Beaker, ShieldCheck, Zap, Wifi } from "lucide-react";
import { useFeedConnection, isMarketOpen, isFallbackPollingActive } from "@/lib/priceFeed";
import { useMarketDataStore } from "@/lib/useMarketDataStore";
import { useOptionalGlobalState } from "@/lib/globalState";
import { useTradesSummary } from "@/lib/swingTrades";
import { syncAllPanels } from "@/components/SyncClock";
import { useToast } from "@/hooks/use-toast";
import type { Settings, Trade, EquityHistory } from "@shared/schema";

export default function UnifiedTelemetryStrip() {
  const { toast } = useToast();
  const global = useOptionalGlobalState();
  const marketStore = useMarketDataStore();
  const feed = useFeedConnection();
  const isPractice = Boolean(global?.isPracticeMode);
  const [isSyncing, setIsSyncing] = useState(false);

  const isConnected = feed.state === "LIVE" || marketStore.status === "LIVE";
  const isMarketOpenNow = feed.isMarketOpen ?? isMarketOpen();
  const isStaticClose = Boolean(marketStore.isStaticLastClose || marketStore.status === "STATIC" || feed.state === "STATIC");
  const isPollingBackup = Boolean(marketStore.isPollingBackup || marketStore.status === "POLLING_BACKUP" || isFallbackPollingActive());

  const settingsQ = useQuery<Settings>({ queryKey: ["/api/settings"], staleTime: 60_000 });
  const tradesQ = useQuery<Trade[]>({ queryKey: ["/api/trades"], refetchInterval: 30_000 });
  const equityQ = useQuery<EquityHistory[]>({ queryKey: ["/api/equity-history"], refetchInterval: 60_000 });
  const swing = useTradesSummary().data;

  // Account metrics
  const equityVal = settingsQ.data?.equity ?? 1614.95;
  const trades = tradesQ.data ?? [];
  const todayStr = new Date().toISOString().slice(0, 10);
  const closedToday = trades.filter((t: any) => t.status === "closed" && String(t.closedAt ?? t.closed_at ?? "").slice(0, 10) === todayStr);
  const dailyPnl = closedToday.reduce((sum, t: any) => sum + Number(t.pnl ?? 0), 0) + (swing?.dailyPnl ?? 0);
  const openRiskDollars = swing?.openRiskDollars ?? 0;
  const openRiskPct = equityVal > 0 ? (openRiskDollars / equityVal) * 100 : 0;

  // Chicago timestamp
  const now = new Date();
  const ctTimeFormatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(now);

  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      await syncAllPanels();
      toast({ title: "Panels Synced", description: "Telemetry and scanner engines refreshed." });
    } catch {
      toast({ title: "Sync failed", variant: "destructive" });
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div
      className={`w-full h-12 px-4 md:px-6 bg-[#0A0F1D] border-b transition-all flex items-center justify-between text-xs font-mono select-none z-20 ${
        isPractice ? "border-b-2 border-b-[#FFB800] shadow-[0_2px_15px_rgba(255,184,0,0.15)]" : "border-b border-slate-800"
      }`}
      data-testid="unified-telemetry-strip"
    >
      {/* ─── LEFT: Market Status Pill + Data Feed Status + Sync Button ─── */}
      <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
        <span
          className={`px-2.5 py-1 rounded-md text-[11px] font-bold tracking-wider uppercase border flex items-center gap-1.5 ${
            isMarketOpenNow
              ? "bg-emerald-500/15 border-emerald-500/40 text-[#00F5A0]"
              : "bg-slate-800/80 border-slate-700 text-slate-300"
          }`}
          data-testid="telemetry-market-state"
        >
          <span className={`h-2 w-2 rounded-full ${isMarketOpenNow ? "bg-[#00F5A0] animate-pulse" : "bg-slate-500"}`} />
          <span>{isMarketOpenNow ? "MARKET OPEN" : "MARKET CLOSED"}</span>
        </span>

        <span className="text-slate-700 hidden sm:inline">|</span>

        <div className="hidden sm:flex items-center gap-1.5 text-slate-300" data-testid="telemetry-feed-status">
          <Wifi className={`h-3.5 w-3.5 ${isConnected && !isPollingBackup ? "text-cyan-400" : "text-amber-400"}`} />
          <span className="text-slate-400">Feed:</span>
          <span className="text-white font-medium">
            {isConnected && !isPollingBackup
              ? "WebSocket Live"
              : isPollingBackup
              ? "Polling Backup"
              : `Last Close Sync: ${ctTimeFormatted} CT`}
          </span>
        </div>

        <button
          type="button"
          onClick={handleManualSync}
          disabled={isSyncing}
          className="flex items-center gap-1 px-2 py-1 rounded border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
          title="Force telemetry and bar synchronization"
          data-testid="button-telemetry-sync"
        >
          <RefreshCw className={`h-3 w-3 ${isSyncing ? "animate-spin text-cyan-400" : ""}`} />
          <span className="hidden md:inline">Sync</span>
        </button>
      </div>

      {/* ─── CENTER: Prominent Practice Mode Switch Pill ─── */}
      <div className="flex items-center justify-center shrink-0">
        <button
          type="button"
          onClick={() => global?.setIsPracticeMode && global.setIsPracticeMode(!global.isPracticeMode)}
          data-testid="button-telemetry-practice-mode"
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full border text-xs font-mono font-bold tracking-wider uppercase transition-all shadow-sm cursor-pointer ${
            isPractice
              ? "border-[#FFB800] bg-amber-500/20 text-[#FFB800] shadow-[0_0_15px_rgba(255,184,0,0.3)] ring-1 ring-amber-400/50"
              : "border-slate-700 bg-slate-900/90 text-slate-400 hover:border-slate-500 hover:text-white"
          }`}
          title="Toggle Practice Sandbox Paper Trading Mode"
        >
          <Beaker className={`h-3.5 w-3.5 ${isPractice ? "text-[#FFB800]" : "text-slate-500"}`} />
          <span>{isPractice ? "[ 🧪 PRACTICE MODE: ON ]" : "[ 🧪 PRACTICE MODE: OFF ]"}</span>
        </button>
      </div>

      {/* ─── RIGHT: Account Equity, Daily P&L, Open Risk & Disclaimer ─── */}
      <div className="flex items-center gap-3 sm:gap-4 shrink-0">
        <div className="flex items-center gap-3 text-xs font-mono">
          <div>
            <span className="text-slate-500 text-[10px] uppercase block leading-none">Equity</span>
            <span className="text-white font-bold tabular-nums text-sm">${equityVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>

          <div className="hidden md:block">
            <span className="text-slate-500 text-[10px] uppercase block leading-none">Daily P&L</span>
            <span className={`font-bold tabular-nums text-sm ${dailyPnl >= 0 ? "text-[#00F5A0]" : "text-[#FF4D6D]"}`}>
              {dailyPnl >= 0 ? "+" : ""}${dailyPnl.toFixed(2)}
            </span>
          </div>

          <div className="hidden lg:block">
            <span className="text-slate-500 text-[10px] uppercase block leading-none">Open Risk</span>
            <span className="text-slate-300 font-bold tabular-nums text-sm">
              {openRiskPct.toFixed(1)}% (${openRiskDollars.toFixed(2)})
            </span>
          </div>
        </div>

        <span className="text-slate-700 hidden lg:inline">|</span>

        <span
          className="hidden xl:inline text-[10px] font-sans text-slate-500 uppercase tracking-wider"
          title="Practice analysis and institutional simulation engine only."
        >
          Educational Tool • Not Financial Advice
        </span>
      </div>
    </div>
  );
}
