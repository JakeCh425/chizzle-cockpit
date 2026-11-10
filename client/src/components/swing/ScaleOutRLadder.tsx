import React, { useMemo } from "react";

export interface ScaleOutLadderResult {
  t1Shares: number;
  runnerShares: number;
  riskPerShare: number;
  price1_5R: number;
  price2_0R: number;
  price3_0R: number;
  price4_0R: number;
  profit1_5R: number;
  profit2_0R: number;
  profit3_0R: number;
  profit4_0R: number;
  gainPct1_5R: number;
  gainPct2_0R: number;
  gainPct3_0R: number;
  gainPct4_0R: number;
}

export function calculateScaleOutLadder(
  entryPrice: number,
  stopLossPrice: number,
  totalShares: number
): ScaleOutLadderResult {
  // Split shares evenly: half off at T1, remainder to runners
  const t1Shares = Math.floor(totalShares / 2);
  const runnerShares = totalShares - t1Shares;
  const riskPerShare = Math.abs(entryPrice - stopLossPrice);

  // Target Price Levels
  const price1_5R = +(entryPrice + riskPerShare * 1.5).toFixed(2);
  const price2_0R = +(entryPrice + riskPerShare * 2.0).toFixed(2);
  const price3_0R = +(entryPrice + riskPerShare * 3.0).toFixed(2);
  const price4_0R = +(entryPrice + riskPerShare * 4.0).toFixed(2);

  // Dollar Return Calculations
  // 1.5R: Exits t1Shares only
  const profit1_5R = Math.round((price1_5R - entryPrice) * t1Shares);

  // Subsequent targets: profit banked from T1 + gain on remaining runnerShares
  const profit2_0R = Math.round(profit1_5R + (price2_0R - entryPrice) * runnerShares);
  const profit3_0R = Math.round(profit1_5R + (price3_0R - entryPrice) * runnerShares);
  const profit4_0R = Math.round(profit1_5R + (price4_0R - entryPrice) * runnerShares);

  // Percentage Gain Calculations
  const gainPct1_5R = entryPrice > 0 ? +(((price1_5R - entryPrice) / entryPrice) * 100).toFixed(1) : 0;
  const gainPct2_0R = entryPrice > 0 ? +(((price2_0R - entryPrice) / entryPrice) * 100).toFixed(1) : 0;
  const gainPct3_0R = entryPrice > 0 ? +(((price3_0R - entryPrice) / entryPrice) * 100).toFixed(1) : 0;
  const gainPct4_0R = entryPrice > 0 ? +(((price4_0R - entryPrice) / entryPrice) * 100).toFixed(1) : 0;

  return {
    t1Shares,
    runnerShares,
    riskPerShare,
    price1_5R,
    price2_0R,
    price3_0R,
    price4_0R,
    profit1_5R,
    profit2_0R,
    profit3_0R,
    profit4_0R,
    gainPct1_5R,
    gainPct2_0R,
    gainPct3_0R,
    gainPct4_0R,
  };
}

export interface ScaleOutRLadderProps {
  entryPrice: number;
  stopLossPrice: number;
  totalShares: number;
  resistancePrice?: number | null;
  symbol?: string;
  className?: string;
}

export function ScaleOutRLadder({
  entryPrice,
  stopLossPrice,
  totalShares,
  resistancePrice,
  symbol,
  className = "",
}: ScaleOutRLadderProps) {
  const ladder = useMemo(
    () => calculateScaleOutLadder(entryPrice, stopLossPrice, totalShares),
    [entryPrice, stopLossPrice, totalShares]
  );

  const symSuffix = symbol ? `-${symbol}` : "";

  // Column descriptors
  const columns = [
    {
      key: "1.5R",
      label: "1.5R (T1 Scale)",
      price: ladder.price1_5R,
      gainPct: ladder.gainPct1_5R,
      profit: ladder.profit1_5R,
      pillText: "[Sell 50%]",
      subText: `Sell ${ladder.t1Shares} sh`,
      testId: `r-ladder-col-1-5r${symSuffix}`,
      hasResistance:
        resistancePrice != null &&
        resistancePrice > entryPrice &&
        resistancePrice < ladder.price1_5R,
    },
    {
      key: "2.0R",
      label: "2.0R (Core T2)",
      price: ladder.price2_0R,
      gainPct: ladder.gainPct2_0R,
      profit: ladder.profit2_0R,
      pillText: "[Remaining]",
      subText: `Running ${ladder.runnerShares} sh`,
      testId: `r-ladder-col-2-0r${symSuffix}`,
      hasResistance:
        resistancePrice != null &&
        resistancePrice > entryPrice &&
        resistancePrice < ladder.price2_0R,
    },
    {
      key: "3.0R",
      label: "3.0R (Runner)",
      price: ladder.price3_0R,
      gainPct: ladder.gainPct3_0R,
      profit: ladder.profit3_0R,
      pillText: "[Runner]",
      subText: `Running ${ladder.runnerShares} sh`,
      testId: `r-ladder-col-3-0r${symSuffix}`,
      hasResistance:
        resistancePrice != null &&
        resistancePrice > entryPrice &&
        resistancePrice < ladder.price3_0R,
    },
    {
      key: "4.0R",
      label: "4.0R (Extended)",
      price: ladder.price4_0R,
      gainPct: ladder.gainPct4_0R,
      profit: ladder.profit4_0R,
      pillText: "[Moonshot]",
      subText: `Running ${ladder.runnerShares} sh`,
      testId: `r-ladder-col-4-0r${symSuffix}`,
      hasResistance:
        resistancePrice != null &&
        resistancePrice > entryPrice &&
        resistancePrice < ladder.price4_0R,
    },
  ];

  return (
    <div
      data-testid={`scale-out-r-ladder${symSuffix}`}
      className={`grid grid-cols-4 gap-1.5 p-2 bg-gray-950/70 border border-gray-800 rounded-md my-2 leading-tight ${className}`}
    >
      {columns.map((col) => (
        <div
          key={col.key}
          data-testid={col.testId}
          className="flex flex-col justify-between min-w-0 text-left overflow-hidden"
        >
          {/* Column Header / R-Multiple */}
          <div className="flex items-center justify-between gap-1 overflow-hidden">
            <span className="text-[10px] font-mono uppercase tracking-wider text-gray-400 truncate">
              {col.label}
            </span>
          </div>

          {/* Target Price */}
          <div className="font-mono text-xs font-bold text-white tabular-nums my-0.5">
            ${col.price.toFixed(2)}
          </div>

          {/* Percentage & Dollar Return */}
          <div className="font-mono text-[11px] text-emerald-400 font-semibold tabular-nums truncate">
            +{col.gainPct}% (+${col.profit.toLocaleString()})
          </div>

          {/* Subtitle Pill / Shares Note */}
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            <span className="inline-block px-1 py-0.2 text-[9px] font-mono rounded bg-slate-900 border border-slate-700 text-slate-300">
              {col.pillText} <span className="text-slate-400">· {col.subText}</span>
            </span>

            {/* Dynamic Resistance Warning Tag */}
            {col.hasResistance && resistancePrice != null && (
              <span
                data-testid={`r-ladder-resistance-warning${symSuffix}`}
                className="inline-block px-1 py-0.2 text-[9px] font-mono font-bold rounded bg-amber-500/15 border border-amber-500/40 text-amber-300"
                title={`Overhead resistance at $${resistancePrice.toFixed(2)} sits below target level $${col.price.toFixed(2)}`}
              >
                ⚠️ Res ${resistancePrice.toFixed(2)}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
