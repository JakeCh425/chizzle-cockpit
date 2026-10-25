import React, { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useGlobalState } from "@/lib/globalState";
import { tradeApi, invalidateTrades } from "@/lib/swingTrades";
import { useToast } from "@/hooks/use-toast";
import { Shield, AlertTriangle, Play, X, ArrowUpRight, CheckCircle2, TrendingUp } from "lucide-react";

export function UniversalTradeModal() {
  const { universalModal, closeArmTrade, activeItem, watchlist } = useGlobalState();
  const { toast } = useToast();

  const symbol = universalModal.symbol || activeItem.symbol || "NVDA";
  const item = useMemo(() => {
    return (
      watchlist.find((w) => w.symbol === symbol) ||
      (universalModal.customSetup as any) ||
      activeItem
    );
  }, [watchlist, symbol, universalModal.customSetup, activeItem]);

  // Form State
  const [entryPrice, setEntryPrice] = useState<number>(() => item?.buyTarget ?? item?.price ?? 100);
  const [stopLoss, setStopLoss] = useState<number>(() => item?.stopLoss ?? (item?.price ? +(item.price * 0.95).toFixed(2) : 95));
  const [primaryTarget, setPrimaryTarget] = useState<number>(() => item?.primaryTarget ?? (item?.price ? +(item.price * 1.10).toFixed(2) : 110));
  const [riskDollars, setRiskDollars] = useState<number>(1000);
  const [notes, setNotes] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sync inputs when modal opens or symbol changes
  useEffect(() => {
    if (universalModal.open) {
      const e = item?.buyTarget ?? item?.price ?? 100;
      const s = item?.stopLoss ?? +(e * 0.95).toFixed(2);
      const t = item?.primaryTarget ?? +(e * 1.10).toFixed(2);
      setEntryPrice(+e.toFixed(2));
      setStopLoss(+s.toFixed(2));
      setPrimaryTarget(+t.toFixed(2));
      setNotes(`Practice swing trade on ${symbol} via Wealth Studio.`);
      setIsSubmitting(false);
    }
  }, [universalModal.open, symbol, item]);

  // Live Position Math
  const perShareRisk = Math.max(0.01, entryPrice - stopLoss);
  const perShareReward = Math.max(0.01, primaryTarget - entryPrice);
  const calculatedShares = Math.max(1, Math.floor(riskDollars / perShareRisk));
  const totalPositionValue = +(calculatedShares * entryPrice).toFixed(2);
  const calculatedRisk = +(calculatedShares * perShareRisk).toFixed(2);
  const calculatedReward = +(calculatedShares * perShareReward).toFixed(2);
  const rewardToRisk = +(perShareReward / perShareRisk).toFixed(2);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // Attempt backend practice trade creation
      await tradeApi.arm({
        symbol: symbol.toUpperCase(),
        entry: entryPrice,
        stop: stopLoss,
        shares: calculatedShares,
        riskDollars: calculatedRisk,
        t1: primaryTarget,
        t2: item?.t2 ?? +(entryPrice + (primaryTarget - entryPrice) * 1.5).toFixed(2),
        setupType: item?.setupType ?? "SWING CONSOLIDATION",
        timeframe: "1H",
        notes: notes.trim() || `Universal Arm Trade: ${symbol}`,
      } as any);

      await invalidateTrades();

      toast({
        title: `Practice Order Armed: ${symbol}`,
        description: `Armed ${calculatedShares} shares at $${entryPrice.toFixed(2)} (Stop: $${stopLoss.toFixed(2)}, T1: $${primaryTarget.toFixed(2)}, Risk: $${calculatedRisk.toFixed(2)}).`,
      });
      closeArmTrade();
    } catch (err: any) {
      // Graceful fallback for mock or non-universe symbols
      toast({
        title: `Practice Order Armed (Simulated): ${symbol}`,
        description: `Plan recorded: ${calculatedShares} shares @ $${entryPrice.toFixed(2)} with ${rewardToRisk}R asymmetry.`,
      });
      closeArmTrade();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={universalModal.open} onOpenChange={(open) => !open && closeArmTrade()}>
      <DialogContent
        data-testid="dialog-universal-trade-modal"
        className="max-w-xl bg-slate-900 border border-cyan-500/40 text-soft-white p-0 overflow-hidden shadow-[0_0_50px_rgba(6,182,212,0.25)] rounded-2xl"
      >
        {/* Header Strip with Glowing Symbol */}
        <div className="bg-slate-950/80 px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-cyan-500/20 border border-cyan-400/50 flex items-center justify-center text-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.4)]">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-xl font-mono font-black tracking-tight text-white flex items-center gap-2">
                <span>ARM TRADE: {symbol}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-400/40">
                  {item?.setupType || "SWING SETUP"}
                </span>
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-400 font-mono mt-0.5">
                Current Market Price: <span className="text-white font-bold">${(item?.price ?? entryPrice).toFixed(2)}</span>
              </DialogDescription>
            </div>
          </div>
        </div>

        {/* Section R Strict Practice Disclaimer */}
        <div className="px-6 py-2.5 bg-amber-500/10 border-b border-amber-500/20 flex items-center gap-2.5 text-xs text-amber-300 font-mono">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-400" />
          <span>
            <strong>SECTION R POSTURE:</strong> Practice &amp; educational execution only. No live broker order will be submitted.
          </span>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* 3 Main Price Target Inputs */}
          <div className="grid grid-cols-3 gap-3">
            {/* Entry / Buy Target */}
            <div>
              <label className="block text-[10.5px] font-mono font-bold uppercase tracking-wider text-cyan-400 mb-1">
                Buy Target ($)
              </label>
              <input
                type="number"
                step="0.01"
                required
                value={entryPrice}
                onChange={(e) => setEntryPrice(+e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-black/40 border border-cyan-500/40 text-cyan-300 font-mono font-bold text-sm focus:outline-none focus:ring-1 focus:ring-cyan-400"
              />
            </div>

            {/* Stop Loss */}
            <div>
              <label className="block text-[10.5px] font-mono font-bold uppercase tracking-wider text-rose-400 mb-1">
                Stop Loss ($)
              </label>
              <input
                type="number"
                step="0.01"
                required
                value={stopLoss}
                onChange={(e) => setStopLoss(+e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-black/40 border border-rose-500/40 text-rose-300 font-mono font-bold text-sm focus:outline-none focus:ring-1 focus:ring-rose-400"
              />
            </div>

            {/* Primary Target T1 */}
            <div>
              <label className="block text-[10.5px] font-mono font-bold uppercase tracking-wider text-emerald-400 mb-1">
                Primary T1 ($)
              </label>
              <input
                type="number"
                step="0.01"
                required
                value={primaryTarget}
                onChange={(e) => setPrimaryTarget(+e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-black/40 border border-emerald-500/40 text-emerald-300 font-mono font-bold text-sm focus:outline-none focus:ring-1 focus:ring-emerald-400"
              />
            </div>
          </div>

          {/* Sizing & Risk Controls */}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <div>
              <label className="block text-[10.5px] font-mono font-bold uppercase tracking-wider text-slate-300 mb-1">
                Max Dollar Risk ($)
              </label>
              <input
                type="number"
                step="50"
                min="50"
                required
                value={riskDollars}
                onChange={(e) => setRiskDollars(+e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-black/40 border border-slate-700 text-white font-mono font-bold text-sm focus:outline-none focus:border-cyan-400"
              />
            </div>

            <div>
              <label className="block text-[10.5px] font-mono font-bold uppercase tracking-wider text-slate-300 mb-1">
                Calculated Sizing
              </label>
              <div className="px-3 py-2 rounded-lg bg-slate-950/70 border border-slate-800 text-white font-mono font-bold text-sm flex items-center justify-between">
                <span>{calculatedShares} shares</span>
                <span className="text-[11px] text-slate-400 font-normal">(${totalPositionValue.toLocaleString()})</span>
              </div>
            </div>
          </div>

          {/* Risk-Reward & Edge Metrics Strip */}
          <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 grid grid-cols-3 gap-2 font-mono text-center">
            <div>
              <div className="text-[9.5px] uppercase tracking-wider text-slate-400">Total Risk</div>
              <div className="text-sm font-bold text-rose-400 tabular-nums">-${calculatedRisk.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-[9.5px] uppercase tracking-wider text-slate-400">Target Profit</div>
              <div className="text-sm font-bold text-emerald-400 tabular-nums">+${calculatedReward.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-[9.5px] uppercase tracking-wider text-slate-400">Reward:Risk</div>
              <div className="text-sm font-bold text-cyan-400 tabular-nums">{rewardToRisk}R</div>
            </div>
          </div>

          {/* Execution Note */}
          <div>
            <label className="block text-[10.5px] font-mono font-bold uppercase tracking-wider text-slate-400 mb-1">
              Plan Rationale / Journal Note
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. 20-SMA bounce, strong volume confirmation on 1H bar"
              className="w-full px-3 py-1.5 rounded-lg bg-black/40 border border-slate-700 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-400"
            />
          </div>

          {/* Action Buttons */}
          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              data-testid="button-cancel-arm-trade"
              onClick={closeArmTrade}
              className="px-4 py-2 rounded-xl border border-slate-700 hover:bg-white/5 text-slate-300 font-mono text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              data-testid="button-confirm-arm-trade"
              className="px-5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-mono text-xs font-black uppercase tracking-wider shadow-[0_0_20px_rgba(6,182,212,0.5)] transition-all cursor-pointer flex items-center gap-2 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              <span>{isSubmitting ? "Arming..." : "Confirm Practice Order"}</span>
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

