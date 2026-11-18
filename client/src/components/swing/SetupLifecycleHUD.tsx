import React, { memo } from "react";
import { Activity } from "lucide-react";
import {
  getCapsuleColor,
  getReadinessTier,
  resolveLifecycleStep,
} from "@/hooks/useSwingMath";

export interface SetupLifecycleHUDProps {
  symbol: string;
  livePrice: number;
  entryPrice: number;
  setupStatus?: string | null;
}

const STEPS = [
  { step: 1 as const, label: "[ 1. SCANNING ]" },
  { step: 2 as const, label: "[ 2. FORMING ]" },
  { step: 3 as const, label: "[ 3. PENDING ]" },
  { step: 4 as const, label: "[ 4. READY ]" },
] as const;

function SetupLifecycleHUDInner({
  symbol,
  livePrice,
  entryPrice,
  setupStatus,
}: SetupLifecycleHUDProps) {
  const activeStep = resolveLifecycleStep(setupStatus, entryPrice > 0);
  const proximity =
    entryPrice > 0 && livePrice > 0
      ? Math.abs((livePrice - entryPrice) / entryPrice) * 100
      : 999;
  const readiness = getReadinessTier(proximity, setupStatus);
  const capsuleColor = getCapsuleColor(proximity);

  return (
    <div
      className="flex flex-col gap-3 p-4 rounded-xl bg-[#151E2E] border border-slate-800 shadow-lg"
      data-testid={`setup-lifecycle-hud-${symbol}`}
    >
      {/* Top Row: Ticker + Live Price + Pipeline Steps */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl font-black tracking-widest text-white">
            {symbol}
          </span>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#0B1220] border border-slate-800">
            <Activity className="w-4 h-4 text-cyan-400 shrink-0" />
            <span className="font-mono tabular-nums text-lg font-bold text-white">
              {livePrice > 0 ? `$${livePrice.toFixed(2)}` : "—"}
            </span>
          </div>
          {entryPrice > 0 && (
            <span className="text-xs font-mono tabular-nums text-slate-400">
              ENTRY TARGET:{" "}
              <strong className="text-cyan-400 font-bold">
                ${entryPrice.toFixed(2)}
              </strong>
            </span>
          )}
        </div>

        {/* Horizontal Pipeline Tracker */}
        <div
          className="flex flex-wrap items-center gap-2 font-mono text-xs font-bold tracking-wider"
          data-testid={`lifecycle-pipeline-steps-${symbol}`}
        >
          {STEPS.map((s, idx) => {
            const isActive = s.step === activeStep;
            const isReadyActive = isActive && s.step === 4;
            const isPendingActive = isActive && s.step === 3;
            return (
              <React.Fragment key={s.step}>
                <span
                  className={`px-2.5 py-1 rounded border transition-all ${
                    isReadyActive
                      ? "bg-emerald-500/20 border-emerald-400 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.35)]"
                      : isPendingActive
                      ? "bg-amber-500/15 border-amber-400 text-amber-300 shadow-[0_0_10px_rgba(251,191,36,0.25)]"
                      : isActive
                      ? "bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-[0_0_10px_rgba(6,182,212,0.25)]"
                      : "bg-[#0B1220] border-slate-800 text-slate-500 opacity-50"
                  }`}
                  data-active={isActive ? "true" : "false"}
                >
                  {s.label}
                </span>
                {idx < STEPS.length - 1 && (
                  <span className="text-slate-600 select-none">➔</span>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Proximity Capsule embedded under PENDING step */}
      {activeStep === 3 && (
        <div
          className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-800"
          data-testid={`hud-pending-proximity-${symbol}`}
        >
          <span className={`text-xs font-mono font-bold uppercase tracking-wider shrink-0 ${readiness.textClass}`}>
            {readiness.label} · PROXIMITY TO ENTRY:
          </span>
          <div className="flex-1 min-w-[160px] h-3 bg-slate-800 rounded-full overflow-hidden border border-slate-700 relative">
            <div
              className={`h-full rounded-full transition-all duration-700 ${capsuleColor}`}
              style={{
                width: `${
                  proximity < 999
                    ? Math.max(0, Math.min(100, 100 - proximity * 10))
                    : 0
                }%`,
              }}
            />
          </div>
          <span
            className={`text-sm font-mono tabular-nums font-bold shrink-0 ${readiness.textClass}`}
            data-testid={`hud-proximity-pct-${symbol}`}
          >
            {proximity < 999 ? `${proximity.toFixed(2)}%` : "—"}
          </span>
        </div>
      )}
    </div>
  );
}

export const SetupLifecycleHUD = memo(
  SetupLifecycleHUDInner,
  (prev, next) =>
    prev.symbol === next.symbol &&
    prev.livePrice === next.livePrice &&
    prev.setupStatus === next.setupStatus &&
    prev.entryPrice === next.entryPrice
);

export default SetupLifecycleHUD;
