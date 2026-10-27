import React, { useState, useRef, useEffect } from "react";
import { Sliders, DollarSign, Percent, Shield, X, Check } from "lucide-react";
import { useGlobalState } from "@/lib/globalState";

export const RISK_PERCENTAGE_OPTIONS = [0.5, 1.0, 1.5, 2.0];

export function RiskSettingsBar() {
  const { accountEquity, setAccountEquity, riskPercentage, setRiskPercentage } = useGlobalState();
  const [isOpen, setIsOpen] = useState(false);
  const [tempEquity, setTempEquity] = useState(String(accountEquity));
  const popoverRef = useRef<HTMLDivElement>(null);

  // Sync tempEquity when accountEquity changes externally
  useEffect(() => {
    setTempEquity(String(accountEquity));
  }, [accountEquity]);

  // Click outside listener
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleEquityChange = (val: string) => {
    setTempEquity(val);
    const parsed = parseFloat(val);
    if (!isNaN(parsed) && parsed > 0) {
      setAccountEquity(parsed);
    }
  };

  const dollarRiskAllowed = (accountEquity * (riskPercentage / 100)).toFixed(2);

  return (
    <div className="relative font-mono" ref={popoverRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        data-testid="button-risk-settings"
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs font-mono font-bold tracking-wider uppercase transition-all shadow-sm cursor-pointer hover:scale-105 active:scale-95"
        style={{
          borderColor: isOpen ? "var(--accent-cyan)" : "var(--border-main)",
          backgroundColor: isOpen ? "rgba(6, 182, 212, 0.15)" : "var(--bg-panel-subtle)",
          color: "var(--accent-cyan)",
        }}
        title="Risk & Position Sizing Settings"
      >
        <Sliders className="h-3.5 w-3.5 text-cyan-400" />
        <span className="tabular-nums">
          ${accountEquity.toLocaleString()}
        </span>
        <span className="text-slate-400 font-normal">·</span>
        <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-black">
          {riskPercentage}% Risk
        </span>
      </button>

      {/* Popover Panel */}
      {isOpen && (
        <div
          data-testid="panel-risk-settings"
          className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-cyan-500/40 bg-slate-950/95 p-3.5 shadow-2xl backdrop-blur-md text-slate-100 z-50 text-xs select-none animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="flex items-center justify-between pb-2 mb-2.5 border-b border-slate-800">
            <div className="flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5 text-cyan-400" />
              <span className="font-bold text-white text-xs tracking-wide">ACCOUNT RISK SIZER</span>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="space-y-3">
            {/* Account Size ($) */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-300 flex items-center justify-between">
                <span>Account Size ($)</span>
                <span className="text-[10px] text-slate-400">Total Equity</span>
              </label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                <input
                  type="number"
                  step="500"
                  min="100"
                  max="10000000"
                  value={tempEquity}
                  onChange={(e) => handleEquityChange(e.target.value)}
                  data-testid="input-account-equity"
                  placeholder="25000"
                  className="w-full pl-7 pr-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900 text-white font-mono font-bold text-xs focus:outline-none focus:border-cyan-400 transition-colors"
                />
              </div>
            </div>

            {/* Default Risk (%) Pill Selector */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-300 flex items-center justify-between">
                <span>Default Risk (% per Trade)</span>
                <span className="text-[10px] text-slate-400">1R Risk Budget</span>
              </label>
              <div className="grid grid-cols-4 gap-1 p-0.5 rounded-lg bg-slate-900 border border-slate-800">
                {RISK_PERCENTAGE_OPTIONS.map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => setRiskPercentage(pct)}
                    data-testid={`risk-pill-${pct.toFixed(1)}`}
                    className={`py-1 rounded text-[11px] font-bold transition-all ${
                      riskPercentage === pct
                        ? "bg-cyan-500 text-slate-950 shadow-sm"
                        : "text-slate-400 hover:text-white hover:bg-slate-800"
                    }`}
                  >
                    {pct}%
                  </button>
                ))}
              </div>
            </div>

            {/* Real-Time Calculation Preview */}
            <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
              <span className="text-slate-400">Total 1R Risk Allowed:</span>
              <span className="font-bold text-emerald-400 font-mono text-xs tabular-nums">
                ${dollarRiskAllowed}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default RiskSettingsBar;

