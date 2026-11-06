import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  TrendingUp,
  ShieldAlert,
  CheckCircle2,
  Hourglass,
  RefreshCw,
  Zap,
  ChevronDown,
  ChevronRight,
  Layers,
  ArrowRight,
  Info,
} from "lucide-react";

export type MechanicalStatus =
  | "STANDBY_DAY (Red Regime)"
  | "CONFIRMED BOUNCE"
  | "TESTING SMA (Wait for Close)"
  | "WAIT FOR RETEST (Entry Missed)";

export interface MechanicalScanItem {
  ticker: string;
  status: MechanicalStatus;
  actionable: boolean;
  price: number;
  regime4H: "Bullish" | "Bearish";
  is4hBullish: boolean;
  testedLine: "10_SMA" | "20_SMA" | "50_SMA" | null;
  testedPrice: number | null;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit2R: number | null;
  riskPerShare: number | null;
  sma10_1h: number;
  sma20_1h: number;
  sma50_1h: number;
  atr14_1h: number;
  subtext: string;
  updatedAt: string;
}

interface MechanicalScanResponse {
  ok: boolean;
  timestamp: string;
  watchlist: string[];
  results: MechanicalScanItem[];
}

interface MechanicalSMAPanelProps {
  onArmTrade?: (item: MechanicalScanItem) => void;
  className?: string;
}

export function MechanicalSMAPanel({ onArmTrade, className = "" }: MechanicalSMAPanelProps) {
  const [isOpen, setIsOpen] = useState(true);
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching, refetch } = useQuery<MechanicalScanResponse>({
    queryKey: ["/api/swing/mechanical-scan"],
    queryFn: async () => {
      const res = await fetch("/api/swing/mechanical-scan");
      if (!res.ok) throw new Error("Failed to fetch mechanical SMA scan");
      return res.json();
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const scanMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/swing/mechanical-scan?force=true");
      if (!res.ok) throw new Error("Scan refresh failed");
      return res.json();
    },
    onSuccess: (newData) => {
      queryClient.setQueryData(["/api/swing/mechanical-scan"], newData);
    },
  });

  const results = data?.results ?? [];
  const confirmedCount = results.filter((r) => r.status === "CONFIRMED BOUNCE").length;
  const testingCount = results.filter((r) => r.status === "TESTING SMA (Wait for Close)").length;
  const standbyCount = results.filter((r) => r.status.includes("STANDBY_DAY")).length;
  const anyBearish = results.some((r) => !r.is4hBullish);

  const formatLine = (line: string | null) => {
    if (!line) return "SMA Floor";
    if (line === "10_SMA") return "10 SMA (Super Fast)";
    if (line === "20_SMA") return "20 SMA (Fast Institutional)";
    return "50 SMA (Slow Anchor)";
  };

  return (
    <div
      className={`rounded-xl border border-cyan-500/30 bg-[#0B0E14] shadow-2xl backdrop-blur-md overflow-hidden transition-all ${className}`}
      data-testid="mechanical-sma-scanner-panel"
    >
      {/* ── HEADER ACCORDION BAR ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-gradient-to-r from-[#0F172A] via-[#111827] to-[#0B0E14] border-b border-gray-800">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2.5 text-left cursor-pointer group"
        >
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-cyan-400 transition-transform group-hover:scale-110" />
          ) : (
            <ChevronRight className="h-4 w-4 text-cyan-400 transition-transform group-hover:scale-110" />
          )}
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
            <h3 className="font-mono text-xs sm:text-sm font-black uppercase tracking-wider text-white">
              Mechanical SMA Strategy Engine
            </h3>
            <span className="rounded bg-cyan-500/10 px-2 py-0.5 text-[10px] font-mono font-bold text-cyan-300 border border-cyan-500/30">
              4H Filter + 1H Execution
            </span>
          </div>
        </button>

        {/* Status Pill Counters */}
        <div className="flex items-center gap-2 font-mono text-[11px]">
          {confirmedCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-2 py-0.5 font-bold text-emerald-300 border border-emerald-500/40 animate-pulse">
              🟢 {confirmedCount} Confirmed
            </span>
          )}
          {testingCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded bg-yellow-500/20 px-2 py-0.5 font-bold text-yellow-300 border border-yellow-500/40">
              🟡 {testingCount} Testing
            </span>
          )}
          {standbyCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded bg-red-500/20 px-2 py-0.5 font-bold text-red-300 border border-red-500/40">
              🔴 {standbyCount} Standby
            </span>
          )}

          <button
            type="button"
            onClick={() => scanMutation.mutate()}
            disabled={isFetching || scanMutation.isPending}
            className="flex items-center gap-1 rounded border border-gray-700 bg-gray-800/80 px-2.5 py-1 text-[11px] font-bold text-gray-200 hover:bg-gray-700 transition-colors cursor-pointer disabled:opacity-50"
            title="Force refresh 1H & 4H SMA scan"
            data-testid="button-refresh-mechanical-scan"
          >
            <RefreshCw
              className={`h-3 w-3 ${isFetching || scanMutation.isPending ? "animate-spin text-cyan-400" : ""}`}
            />
            <span>{isFetching || scanMutation.isPending ? "Scanning..." : "Refresh"}</span>
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="p-4 space-y-4">
          {/* ── 4-HOUR MARKET REGIME BANNER ── */}
          <div
            className={`flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border font-mono text-xs ${
              anyBearish
                ? "border-amber-500/40 bg-amber-950/30 text-amber-200"
                : "border-emerald-500/40 bg-emerald-950/30 text-emerald-200"
            }`}
          >
            <div className="flex items-center gap-2.5">
              {anyBearish ? (
                <ShieldAlert className="h-4 w-4 shrink-0 text-amber-400" />
              ) : (
                <TrendingUp className="h-4 w-4 shrink-0 text-emerald-400" />
              )}
              <div>
                <span className="font-bold uppercase tracking-wider">
                  4H Trend Regime: {anyBearish ? "Mixed / Selective Standby" : "Bullish Upward Trend"}
                </span>
                <span className="block text-[11px] opacity-80 mt-0.5 font-sans">
                  {anyBearish
                    ? "Tickers where 4H 20 SMA < 50 SMA treat moving averages as resistance ceilings — Long swing setups are physically blocked."
                    : "4H 20 SMA > 50 SMA across leading ETFs. Moving averages act as supportive demand floors below price."}
                </span>
              </div>
            </div>
            <div className="text-[10px] opacity-75 font-mono">
              Auto-refreshes every 30s
            </div>
          </div>

          {/* ── WATCHLIST CARDS GRID ── */}
          {isLoading && results.length === 0 ? (
            <div className="py-8 text-center text-xs font-mono text-gray-400 animate-pulse">
              Syncing 1-Hour & 4-Hour SMAs across Watchlist (SMH, QQQ, SPY, PLTR, AVGO, MRVL)...
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {results.map((item) => {
                const isConfirmed = item.status === "CONFIRMED BOUNCE";
                const isTesting = item.status === "TESTING SMA (Wait for Close)";
                const isStandby = item.status.includes("STANDBY_DAY");
                const isWaitRetest = item.status === "WAIT FOR RETEST (Entry Missed)";

                return (
                  <div
                    key={item.ticker}
                    className={`relative rounded-xl border p-4 transition-all shadow-md flex flex-col justify-between ${
                      isConfirmed
                        ? "border-emerald-500/60 bg-gradient-to-b from-[#091D16] to-[#0A1015] shadow-emerald-950/30 ring-1 ring-emerald-500/30"
                        : isTesting
                        ? "border-yellow-500/50 bg-gradient-to-b from-[#1E190A] to-[#0A1015]"
                        : isStandby
                        ? "border-red-900/50 bg-gradient-to-b from-[#18090C] to-[#0A1015] opacity-85"
                        : "border-gray-800 bg-[#0E131F]/90"
                    }`}
                    data-testid={`card-mechanical-${item.ticker}`}
                  >
                    <div>
                      {/* Top Symbol & Price */}
                      <div className="flex items-center justify-between pb-2 border-b border-gray-800/80">
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-black tracking-tight text-white font-mono">
                            {item.ticker}
                          </span>
                          <span className="text-sm font-mono font-bold text-gray-200">
                            ${item.price > 0 ? item.price.toFixed(2) : "---"}
                          </span>
                        </div>
                        <span
                          className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border uppercase ${
                            item.is4hBullish
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                              : "bg-red-500/10 text-red-400 border-red-500/30"
                          }`}
                        >
                          4H {item.is4hBullish ? "Floor" : "Ceiling"}
                        </span>
                      </div>

                      {/* Status Badge */}
                      <div className="mt-2.5">
                        {isConfirmed && (
                          <div className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/20 border border-emerald-500/50 px-2 py-0.5 text-xs font-black text-emerald-300 uppercase tracking-wide">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            CONFIRMED BOUNCE ({item.testedLine?.replace("_", " ")})
                          </div>
                        )}
                        {isTesting && (
                          <div className="inline-flex items-center gap-1.5 rounded-md bg-yellow-500/20 border border-yellow-500/50 px-2 py-0.5 text-xs font-black text-yellow-300 uppercase tracking-wide">
                            <Hourglass className="h-3.5 w-3.5" />
                            TESTING SMA ({item.testedLine?.replace("_", " ")})
                          </div>
                        )}
                        {isWaitRetest && (
                          <div className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 text-xs font-bold text-amber-300 uppercase tracking-wide">
                            <Hourglass className="h-3.5 w-3.5 opacity-70" />
                            WAIT FOR RETEST (No Chasing)
                          </div>
                        )}
                        {isStandby && (
                          <div className="inline-flex items-center gap-1.5 rounded-md bg-red-500/20 border border-red-500/40 px-2 py-0.5 text-xs font-black text-red-300 uppercase tracking-wide">
                            <ShieldAlert className="h-3.5 w-3.5" />
                            STANDBY DAY (Hard Block)
                          </div>
                        )}
                      </div>

                      {/* Subtext Note */}
                      <p className="mt-2 text-[11px] text-gray-300 leading-snug font-sans">
                        {item.subtext}
                      </p>

                      {/* 1H SMA Levels Reference */}
                      <div className="mt-3 grid grid-cols-3 gap-1 rounded bg-black/40 p-2 font-mono text-[10px] text-center border border-gray-800">
                        <div>
                          <span className="text-gray-400 block font-semibold">10 SMA</span>
                          <span className="font-bold text-gray-200">${item.sma10_1h.toFixed(2)}</span>
                        </div>
                        <div>
                          <span className="text-cyan-400 block font-semibold">20 SMA</span>
                          <span className="font-bold text-cyan-200">${item.sma20_1h.toFixed(2)}</span>
                        </div>
                        <div>
                          <span className="text-purple-400 block font-semibold">50 SMA</span>
                          <span className="font-bold text-purple-200">${item.sma50_1h.toFixed(2)}</span>
                        </div>
                      </div>

                      {/* Confirmed 2:1 R:R Trade Ticket Details */}
                      {isConfirmed && item.entryPrice && item.stopLoss && item.takeProfit2R && (
                        <div className="mt-3 rounded-lg border border-emerald-800/60 bg-[#08120E] p-2.5 font-mono text-[11px] space-y-1">
                          <div className="flex items-center justify-between text-emerald-400 font-bold uppercase text-[10px]">
                            <span>Strict 2:1 R:R Bracket</span>
                            <span>Risk: ${item.riskPerShare?.toFixed(2)}/sh</span>
                          </div>
                          <div className="grid grid-cols-3 gap-1 pt-1 border-t border-emerald-900/60 text-center">
                            <div>
                              <span className="text-[9px] text-gray-400 block uppercase">Entry</span>
                              <span className="font-extrabold text-white">${item.entryPrice.toFixed(2)}</span>
                            </div>
                            <div>
                              <span className="text-[9px] text-rose-400 block uppercase">Stop (-1 ATR)</span>
                              <span className="font-extrabold text-rose-300">${item.stopLoss.toFixed(2)}</span>
                            </div>
                            <div>
                              <span className="text-[9px] text-emerald-400 block uppercase">2:1 Target</span>
                              <span className="font-extrabold text-emerald-300">${item.takeProfit2R.toFixed(2)}</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Bottom Action Footer */}
                    <div className="mt-3.5 pt-2 border-t border-gray-800/80 flex items-center justify-between">
                      <span className="text-[10px] text-gray-400 font-mono">
                        {item.testedLine ? `Floor: ${item.testedLine.replace("_", " ")}` : "Awaiting Retest"}
                      </span>

                      {isConfirmed ? (
                        <button
                          type="button"
                          onClick={() => onArmTrade?.(item)}
                          className="flex items-center gap-1.5 rounded-md bg-emerald-500 hover:bg-emerald-400 px-3 py-1.5 text-xs font-mono font-black text-gray-950 uppercase tracking-wider transition-all shadow-md shadow-emerald-500/20 active:scale-95 cursor-pointer"
                          data-testid={`button-arm-mechanical-${item.ticker}`}
                        >
                          <Zap className="h-3.5 w-3.5 fill-gray-950" />
                          <span>Arm 2:1 Swing</span>
                        </button>
                      ) : (
                        <span className="text-[10px] font-mono text-gray-500 font-bold uppercase">
                          {isStandby ? "Orders Blocked" : "No Action"}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
