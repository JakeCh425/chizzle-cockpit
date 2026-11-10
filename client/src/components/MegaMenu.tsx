import React, { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import {
  SlidersHorizontal,
  ChevronDown,
  Layers,
  Filter,
  ShieldCheck,
  Target,
  Zap,
  TrendingUp,
  ExternalLink,
  Cpu,
  BarChart2,
  FileSpreadsheet,
} from "lucide-react";

export function MegaMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleMouseEnter = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsOpen(true);
  };

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 150);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div
      ref={menuRef}
      className="relative inline-block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      data-testid="header-mega-menu-container"
    >
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        data-testid="button-mega-menu-trigger"
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer ${
          isOpen
            ? "bg-indigo-500/20 text-indigo-300 border border-indigo-400/50 shadow-[0_0_12px_rgba(99,102,241,0.25)]"
            : "text-slate-300 hover:text-white hover:bg-slate-800/60 border border-transparent"
        }`}
      >
        <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-400 transition-transform duration-200" />
        <span>Trading Layouts</span>
        <ChevronDown
          className={`w-3 h-3 text-indigo-300 transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Mega Menu Dropdown Panel */}
      {isOpen && (
        <div
          data-testid="header-mega-menu-panel"
          className="absolute left-0 top-full mt-2 w-[760px] max-w-[90vw] rounded-xl border border-slate-700/80 bg-slate-950/95 backdrop-blur-xl p-5 shadow-[0_12px_40px_rgba(0,0,0,0.85)] z-50 animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
              <h4 className="font-mono text-xs font-extrabold uppercase tracking-widest text-indigo-300">
                Institutional Workstation Layouts & Parameters
              </h4>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
              Interactive Mega Menu
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Column 1: Screener Criteria */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5 text-cyan-400 font-mono text-[11px] font-bold uppercase tracking-wider border-b border-cyan-500/20 pb-1">
                <Filter className="w-3.5 h-3.5" />
                <span>Screener Criteria</span>
              </div>
              <ul className="flex flex-col gap-1 text-xs">
                <li>
                  <Link
                    href="/watchlist"
                    onClick={() => setIsOpen(false)}
                    className="flex flex-col p-1.5 rounded-lg hover:bg-slate-900/80 hover:text-cyan-300 transition-all duration-200 group"
                  >
                    <span className="font-mono font-bold text-slate-200 group-hover:text-cyan-300 transition-colors">
                      10 EMA Momentum Pullback
                    </span>
                    <span className="text-[10px] text-slate-400">
                      Trend continuation setups on 1H / 4H charts
                    </span>
                  </Link>
                </li>
                <li>
                  <Link
                    href="/watchlist"
                    onClick={() => setIsOpen(false)}
                    className="flex flex-col p-1.5 rounded-lg hover:bg-slate-900/80 hover:text-cyan-300 transition-all duration-200 group"
                  >
                    <span className="font-mono font-bold text-slate-200 group-hover:text-cyan-300 transition-colors">
                      Multi-Timeframe Alignment
                    </span>
                    <span className="text-[10px] text-slate-400">
                      Confluence between Daily trend and 1H triggers
                    </span>
                  </Link>
                </li>
                <li>
                  <Link
                    href="/engine"
                    onClick={() => setIsOpen(false)}
                    className="flex flex-col p-1.5 rounded-lg hover:bg-slate-900/80 hover:text-cyan-300 transition-all duration-200 group"
                  >
                    <span className="font-mono font-bold text-slate-200 group-hover:text-cyan-300 transition-colors">
                      Volume Surge & Squeeze
                    </span>
                    <span className="text-[10px] text-slate-400">
                      Consolidation breakouts near key levels
                    </span>
                  </Link>
                </li>
              </ul>
            </div>

            {/* Column 2: Strategy Parameters */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5 text-emerald-400 font-mono text-[11px] font-bold uppercase tracking-wider border-b border-emerald-500/20 pb-1">
                <Target className="w-3.5 h-3.5" />
                <span>Strategy Parameters</span>
              </div>
              <ul className="flex flex-col gap-1 text-xs">
                <li>
                  <Link
                    href="/spec"
                    onClick={() => setIsOpen(false)}
                    className="flex flex-col p-1.5 rounded-lg hover:bg-slate-900/80 hover:text-emerald-300 transition-all duration-200 group"
                  >
                    <span className="font-mono font-bold text-slate-200 group-hover:text-emerald-300 transition-colors">
                      1.5R Scale-Out & Runners
                    </span>
                    <span className="text-[10px] text-slate-400">
                      50% partial at Target 1, trail runners to 2R-4R
                    </span>
                  </Link>
                </li>
                <li>
                  <Link
                    href="/spec"
                    onClick={() => setIsOpen(false)}
                    className="flex flex-col p-1.5 rounded-lg hover:bg-slate-900/80 hover:text-emerald-300 transition-all duration-200 group"
                  >
                    <span className="font-mono font-bold text-slate-200 group-hover:text-emerald-300 transition-colors">
                      1.0R Mechanical Stop Loss
                    </span>
                    <span className="text-[10px] text-slate-400">
                      Structural invalidation below trigger swing low
                    </span>
                  </Link>
                </li>
                <li>
                  <Link
                    href="/engine"
                    onClick={() => setIsOpen(false)}
                    className="flex flex-col p-1.5 rounded-lg hover:bg-slate-900/80 hover:text-emerald-300 transition-all duration-200 group"
                  >
                    <span className="font-mono font-bold text-slate-200 group-hover:text-emerald-300 transition-colors">
                      1H Candle Close Gate
                    </span>
                    <span className="text-[10px] text-slate-400">
                      Strict candle verification before arming alerts
                    </span>
                  </Link>
                </li>
              </ul>
            </div>

            {/* Column 3: Multi-Account & Routing */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5 text-purple-400 font-mono text-[11px] font-bold uppercase tracking-wider border-b border-purple-500/20 pb-1">
                <Cpu className="w-3.5 h-3.5" />
                <span>Routing & Accounts</span>
              </div>
              <ul className="flex flex-col gap-1 text-xs">
                <li>
                  <Link
                    href="/trade-planner"
                    onClick={() => setIsOpen(false)}
                    className="flex flex-col p-1.5 rounded-lg hover:bg-slate-900/80 hover:text-purple-300 transition-all duration-200 group"
                  >
                    <span className="font-mono font-bold text-slate-200 group-hover:text-purple-300 transition-colors">
                      Fidelity 1-Click Ticket
                    </span>
                    <span className="text-[10px] text-slate-400">
                      Pre-formatted Buy Limit + OCO Bracket Orders
                    </span>
                  </Link>
                </li>
                <li>
                  <Link
                    href="/trades"
                    onClick={() => setIsOpen(false)}
                    className="flex flex-col p-1.5 rounded-lg hover:bg-slate-900/80 hover:text-purple-300 transition-all duration-200 group"
                  >
                    <span className="font-mono font-bold text-slate-200 group-hover:text-purple-300 transition-colors">
                      Multi-Account Sizing
                    </span>
                    <span className="text-[10px] text-slate-400">
                      Dynamic cash allocation & portfolio risk guard
                    </span>
                  </Link>
                </li>
                <li>
                  <Link
                    href="/signals"
                    onClick={() => setIsOpen(false)}
                    className="flex flex-col p-1.5 rounded-lg hover:bg-slate-900/80 hover:text-purple-300 transition-all duration-200 group"
                  >
                    <span className="font-mono font-bold text-slate-200 group-hover:text-purple-300 transition-colors">
                      System Logs & Telemetry
                    </span>
                    <span className="text-[10px] text-slate-400">
                      Real-time webhook and audit history trail
                    </span>
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-[11px] font-mono text-slate-400">
            <span>Hold cursor over menu to view layout options</span>
            <Link
              href="/settings"
              onClick={() => setIsOpen(false)}
              className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors"
            >
              <span>Manage Workspace Preferences</span>
              <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
