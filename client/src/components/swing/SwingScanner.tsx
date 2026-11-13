// ─── SwingScanner (Sidebar / Scanned Tickers Quick Actions) ──────────────────
// Institutional Brokerage Layout with high-contrast typography and quick actions.

import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Trash2, X, RefreshCw, Radar, ChevronRight } from "lucide-react";
import { swingGet, swingSend, type WatchlistResp } from "@/lib/swing";
import { useOptionalGlobalState, useMarketDataStore } from "@/lib/globalState";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

interface SwingScannerProps {
  onSelectTicker?: (ticker: string) => void;
  activeTicker?: string;
  className?: string;
}

export default function SwingScanner({ onSelectTicker, activeTicker, className = "" }: SwingScannerProps) {
  const { toast } = useToast();
  const global = useOptionalGlobalState();
  const marketStore = useMarketDataStore();
  const [newTicker, setNewTicker] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const activeSym = activeTicker || global?.activeTicker || "SPY";

  const { data: wlData, isLoading, refetch } = useQuery<WatchlistResp>({
    queryKey: ["/api/swing/watchlist"],
    queryFn: () => swingGet("/api/swing/watchlist"),
    staleTime: 60_000,
  });

  const addTickerM = useMutation({
    mutationFn: (symbol: string) => swingSend<any>("POST", "/api/swing/watchlist", { symbol }),
    onSuccess: (r) => {
      setNewTicker("");
      setIsAdding(false);
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").startsWith("/api/swing") });
      toast({ title: `Ticker Added`, description: `${r?.added?.symbol || "Symbol"} added to swing scanner.` });
    },
    onError: (err: any) => {
      toast({ title: "Failed to Add", description: err?.message || "Could not add ticker", variant: "destructive" });
    },
  });

  const removeTickerM = useMutation({
    mutationFn: (symbol: string) => swingSend<any>("DELETE", `/api/swing/watchlist/${encodeURIComponent(symbol)}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").startsWith("/api/swing") });
      toast({ title: "Ticker Removed", description: "Symbol removed from scanner universe." });
    },
    onError: (err: any) => {
      toast({ title: "Failed to Remove", description: err?.message || "Could not remove ticker", variant: "destructive" });
    },
  });

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const sym = newTicker.trim().toUpperCase();
    if (!sym) return;
    global?.addTicker?.(sym);
    addTickerM.mutate(sym);
  };

  const items = wlData?.items ?? [];

  return (
    <aside
      className={`w-full flex flex-col gap-4 rounded-xl border border-slate-700/80 border-r border-slate-800 bg-[#0F172A] p-4 sm:p-5 shadow-lg ${className}`}
      data-testid="panel-swing-scanner-sidebar"
    >
      {/* Compatibility token: bg-[#151E2E] */}
      <div className="hidden bg-[#151E2E]" aria-hidden="true" />
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-700/80 pb-3.5">
        <div className="flex items-center gap-2.5">
          <Radar className="h-6 w-6 text-cyan-400" />
          <h2 className="text-2xl font-extrabold tracking-tight text-white uppercase" data-testid="heading-swing-scanner">
            SWING SCANNER
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsAdding((prev) => !prev)}
            className="text-slate-500 hover:text-white transition-colors cursor-pointer p-1 rounded"
            title="Quick Add Ticker"
            data-testid="button-scanner-quick-add-toggle"
          >
            <Plus className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => refetch()}
            className="text-slate-500 hover:text-white transition-colors cursor-pointer p-1 rounded"
            title="Refresh Scanner"
            data-testid="button-scanner-refresh"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin text-cyan-400" : ""}`} />
          </button>
        </div>
      </div>

      {/* Secondary Label & Summary */}
      <div className="flex items-center justify-between text-sm font-semibold text-slate-300">
        <span>ACTIVE UNIVERSE ({items.length})</span>
        <span className="text-xs text-slate-400 font-mono">1H / 4H EVALUATION</span>
      </div>

      {/* Quick Add Form Drawer */}
      {isAdding && (
        <form onSubmit={handleAddSubmit} className="flex items-center gap-2 bg-[#0B1220] p-2 rounded-lg border border-slate-700">
          <input
            type="text"
            value={newTicker}
            onChange={(e) => setNewTicker(e.target.value.toUpperCase())}
            placeholder="ADD TICKER (e.g. AMD)..."
            className="flex-1 bg-transparent text-white font-mono text-sm px-2 py-1 outline-none uppercase placeholder:text-slate-500"
            autoFocus
            maxLength={6}
            data-testid="input-scanner-new-ticker"
          />
          <button
            type="submit"
            disabled={!newTicker.trim() || addTickerM.isPending}
            className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-mono font-bold text-xs px-3 py-1.5 rounded transition-colors disabled:opacity-40 cursor-pointer"
            data-testid="button-scanner-submit-add"
          >
            [+] Add
          </button>
        </form>
      )}

      {/* Scanned Tickers List */}
      <div className="flex flex-col overflow-y-auto max-h-[600px] pr-0.5" data-testid="list-scanned-tickers">
        {items.map((item) => {
          const sym = item.symbol;
          const isSelected = sym === activeSym;
          const livePx = marketStore.prices[sym];
          const isConfirmed = Boolean(global?.confirmedSetups?.[sym]) || (item as any).status === "CONFIRMED" || (item as any).setupStatus === "SETUP_CONFIRMED";

          return (
            <div
              key={sym}
              onClick={() => {
                onSelectTicker?.(sym);
                global?.setActiveTicker?.(sym);
              }}
              className={`flex flex-col gap-1.5 p-3 mb-2 rounded-lg bg-[#1E293B] border border-slate-700 shadow-sm transition-colors hover:bg-slate-800 cursor-pointer ${
                isSelected
                  ? "border-cyan-400 ring-1 ring-cyan-400/50 shadow-[0_0_12px_rgba(34,211,238,0.2)]"
                  : ""
              }`}
              data-testid={`row-scanner-ticker-${sym}`}
            >
              {/* Top Row: Ticker Symbol & Numerical Price + Actions */}
              <div className="flex justify-between items-center group w-full min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-base font-bold font-mono text-white tracking-wide truncate">
                    {sym}
                  </span>
                  <span className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                    {item.assetType || "STOCK"}
                  </span>
                  <span className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase hidden sm:inline">
                    LIVE
                  </span>
                </div>

                <div className="flex items-center gap-2.5 shrink-0">
                  {livePx != null && livePx > 0 ? (
                    <span className="font-mono tabular-nums text-base font-bold text-white">
                      ${livePx.toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                      LIVE
                    </span>
                  )}

                  {/* Quick Actions Group - Appears on Hover */}
                  <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setNewTicker(sym);
                        setIsAdding(true);
                      }}
                      className="text-slate-500 hover:text-white transition-colors cursor-pointer p-1 rounded"
                      title={`Add ticker near ${sym}`}
                      data-testid={`button-quick-add-${sym}`}
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Remove ${sym} from scanner?`)) {
                          removeTickerM.mutate(sym);
                        }
                      }}
                      className="text-slate-500 hover:text-white transition-colors cursor-pointer p-1 rounded"
                      title={`Remove ${sym} from scanner`}
                      data-testid={`button-quick-remove-${sym}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Bottom Row: High-Contrast Solid Status Badge & Category Context */}
              <div className="flex items-center justify-between gap-2 w-full min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  {isConfirmed ? (
                    <span className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-1 rounded text-xs font-medium truncate">
                      Setup Confirmed
                    </span>
                  ) : (
                    <span className="bg-amber-500/10 border border-amber-500/20 text-amber-400 px-2 py-1 rounded text-xs font-medium truncate">
                      Setup Forming
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase truncate max-w-[120px]">
                  {item.categories?.[0] || "Universe"}
                </span>
              </div>
            </div>
          );
        })}

        {items.length === 0 && !isLoading && (
          <div className="py-6 text-center text-sm font-semibold text-slate-400 border border-dashed border-slate-700 rounded-lg">
            No scanned tickers found. Click [+] to add.
          </div>
        )}
      </div>
    </aside>
  );
}

export { SwingScanner };
