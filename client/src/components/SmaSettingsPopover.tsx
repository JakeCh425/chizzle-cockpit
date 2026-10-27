import React, { useRef, useEffect } from "react";
import { Settings, RotateCcw, X, Sliders } from "lucide-react";
import {
  type SmaSettings,
  DEFAULT_SMA_SETTINGS,
  saveSmaSettings,
} from "@/lib/smaSettings";

export interface SmaSettingsPopoverProps {
  settings: SmaSettings;
  onChange: (settings: SmaSettings) => void;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  align?: "left" | "right";
}

const PRESET_COLORS = [
  "#2962FF", // TradingView Blue
  "#EF5350", // TradingView Salmon / Red
  "#22d3ee", // Cyan
  "#38bdf8", // Sky blue
  "#22c55e", // Green
  "#a3e635", // Lime
  "#fbbf24", // Amber
  "#ffd700", // Gold
  "#f97316", // Orange
  "#f43f5e", // Rose
  "#c084fc", // Purple/Magenta
  "#94a3b8", // Slate
];

export function SmaSettingsPopover({
  settings,
  onChange,
  isOpen,
  onToggle,
  onClose,
  align = "right",
}: SmaSettingsPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [isOpen, onClose]);

  const updateSma = (
    key: "sma20" | "sma50" | "sma200",
    patch: Partial<SmaSettings["sma20"]>
  ) => {
    const next: SmaSettings = {
      ...settings,
      [key]: { ...settings[key], ...patch },
    };
    onChange(next);
    saveSmaSettings(next);
  };

  const resetDefaults = () => {
    onChange(DEFAULT_SMA_SETTINGS);
    saveSmaSettings(DEFAULT_SMA_SETTINGS);
  };

  return (
    <div className="relative inline-block" ref={popoverRef}>
      <button
        type="button"
        data-testid="button-sma-settings"
        onClick={onToggle}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800/90 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 text-xs font-mono font-bold tracking-wide uppercase transition-colors cursor-pointer shadow-sm"
        title="Indicators & Style Settings (SMA 20/50 Ribbon, Volume, ATR 14)"
      >
        <Sliders className="h-3.5 w-3.5 text-cyan-400" />
        <span>[ Indicators + ]</span>
      </button>

      {isOpen && (
        <div
          data-testid="popover-sma-settings"
          className={`absolute ${
            align === "right" ? "right-0" : "left-0"
          } top-full mt-2 w-80 p-3.5 rounded-xl border border-slate-700 bg-slate-900/95 text-slate-200 shadow-2xl backdrop-blur-md z-50 font-mono text-xs select-none`}
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Settings className="h-4 w-4 text-cyan-400" />
              <span className="font-bold text-white uppercase tracking-wider text-[11px]">
                SMA Style Customization
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-white p-0.5 rounded cursor-pointer"
              title="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* SMA 20 Row */}
          <div className="mb-3.5 p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
            <div className="flex items-center justify-between mb-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  data-testid="sma-toggle-20"
                  checked={settings.sma20.visible}
                  onChange={(e) => updateSma("sma20", { visible: e.target.checked })}
                  className="rounded border-slate-700 text-cyan-500 focus:ring-0 cursor-pointer"
                />
                <span className="font-bold text-cyan-400">20-SMA</span>
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  data-testid="sma-color-20"
                  value={settings.sma20.color}
                  onChange={(e) => updateSma("sma20", { color: e.target.value })}
                  className="h-6 w-7 bg-transparent cursor-pointer rounded border border-slate-700 p-0.5"
                  title="Choose SMA 20 Color"
                />
                <span className="text-[10px] text-slate-400">{settings.sma20.color}</span>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 text-[11px] text-slate-400">
              <span>Thickness: {settings.sma20.lineWidth}px</span>
              <input
                type="range"
                data-testid="sma-width-20"
                min="1"
                max="4"
                step="1"
                value={settings.sma20.lineWidth}
                onChange={(e) => updateSma("sma20", { lineWidth: Number(e.target.value) })}
                className="w-28 accent-cyan-400 cursor-pointer"
              />
            </div>
          </div>

          {/* SMA 50 Row */}
          <div className="mb-3.5 p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
            <div className="flex items-center justify-between mb-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  data-testid="sma-toggle-50"
                  checked={settings.sma50.visible}
                  onChange={(e) => updateSma("sma50", { visible: e.target.checked })}
                  className="rounded border-slate-700 text-amber-500 focus:ring-0 cursor-pointer"
                />
                <span className="font-bold text-amber-400">50-SMA</span>
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  data-testid="sma-color-50"
                  value={settings.sma50.color}
                  onChange={(e) => updateSma("sma50", { color: e.target.value })}
                  className="h-6 w-7 bg-transparent cursor-pointer rounded border border-slate-700 p-0.5"
                  title="Choose SMA 50 Color"
                />
                <span className="text-[10px] text-slate-400">{settings.sma50.color}</span>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 text-[11px] text-slate-400">
              <span>Thickness: {settings.sma50.lineWidth}px</span>
              <input
                type="range"
                data-testid="sma-width-50"
                min="1"
                max="4"
                step="1"
                value={settings.sma50.lineWidth}
                onChange={(e) => updateSma("sma50", { lineWidth: Number(e.target.value) })}
                className="w-28 accent-amber-400 cursor-pointer"
              />
            </div>
          </div>

          {/* SMA 200 Row */}
          <div className="mb-3.5 p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
            <div className="flex items-center justify-between mb-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  data-testid="sma-toggle-200"
                  checked={settings.sma200.visible}
                  onChange={(e) => updateSma("sma200", { visible: e.target.checked })}
                  className="rounded border-slate-700 text-purple-500 focus:ring-0 cursor-pointer"
                />
                <span className="font-bold text-purple-400">200-SMA</span>
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  data-testid="sma-color-200"
                  value={settings.sma200.color}
                  onChange={(e) => updateSma("sma200", { color: e.target.value })}
                  className="h-6 w-7 bg-transparent cursor-pointer rounded border border-slate-700 p-0.5"
                  title="Choose SMA 200 Color"
                />
                <span className="text-[10px] text-slate-400">{settings.sma200.color}</span>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 text-[11px] text-slate-400">
              <span>Thickness: {settings.sma200.lineWidth}px</span>
              <input
                type="range"
                data-testid="sma-width-200"
                min="1"
                max="4"
                step="1"
                value={settings.sma200.lineWidth}
                onChange={(e) => updateSma("sma200", { lineWidth: Number(e.target.value) })}
                className="w-28 accent-purple-400 cursor-pointer"
              />
            </div>
          </div>

          {/* Additional TradingView Indicators: Dynamic Ribbon, Volume & ATR */}
          <div className="mb-3.5 p-2 rounded-lg bg-slate-950/60 border border-slate-800/80 space-y-2">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              TradingView Indicators & Overlays
            </div>

            {/* Dynamic Ribbon Cloud Toggle */}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  data-testid="indicator-toggle-ribbon"
                  checked={settings.showRibbon !== false}
                  onChange={(e) => {
                    const next = { ...settings, showRibbon: e.target.checked };
                    onChange(next);
                    saveSmaSettings(next);
                  }}
                  className="rounded border-slate-700 text-emerald-500 focus:ring-0 cursor-pointer"
                />
                <span className="font-bold text-emerald-400 text-[11px]">20/50 Ribbon Cloud</span>
              </label>
              <span className="text-[10px] text-slate-400">Green/Red Fill</span>
            </div>

            {/* Volume Profile Bars Toggle */}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  data-testid="indicator-toggle-volume"
                  checked={settings.showVolume !== false}
                  onChange={(e) => {
                    const next = { ...settings, showVolume: e.target.checked };
                    onChange(next);
                    saveSmaSettings(next);
                  }}
                  className="rounded border-slate-700 text-cyan-500 focus:ring-0 cursor-pointer"
                />
                <span className="font-bold text-cyan-400 text-[11px]">Volume Bars (1.2x Line)</span>
              </label>
              <span className="text-[10px] text-slate-400">Chart Bottom</span>
            </div>

            {/* ATR (14) Footer Panel Toggle */}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  data-testid="indicator-toggle-atr"
                  checked={settings.showAtr !== false}
                  onChange={(e) => {
                    const next = { ...settings, showAtr: e.target.checked };
                    onChange(next);
                    saveSmaSettings(next);
                  }}
                  className="rounded border-slate-700 text-amber-500 focus:ring-0 cursor-pointer"
                />
                <span className="font-bold text-amber-400 text-[11px]">ATR (14) Volatility Panel</span>
              </label>
              <span className="text-[10px] text-slate-400">Chart Footer</span>
            </div>

            {/* Candlestick Style Toggle */}
            <div className="flex items-center justify-between pt-1 border-t border-slate-800/80">
              <span className="text-[11px] text-slate-300 font-bold">Candle Style:</span>
              <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded border border-slate-800">
                <button
                  type="button"
                  data-testid="button-candle-style-solid"
                  onClick={() => {
                    const next: SmaSettings = { ...settings, candleStyle: "solid" };
                    onChange(next);
                    saveSmaSettings(next);
                  }}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${
                    (settings.candleStyle ?? "solid") === "solid"
                      ? "bg-cyan-500 text-slate-950"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  Solid
                </button>
                <button
                  type="button"
                  data-testid="button-candle-style-hollow"
                  onClick={() => {
                    const next: SmaSettings = { ...settings, candleStyle: "hollow" };
                    onChange(next);
                    saveSmaSettings(next);
                  }}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${
                    settings.candleStyle === "hollow"
                      ? "bg-cyan-500 text-slate-950"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  Hollow
                </button>
              </div>
            </div>
          </div>

          {/* Quick Preset: TradingView Workstation Defaults */}
          <div className="mb-3 px-2 py-1.5 rounded-lg bg-cyan-950/40 border border-cyan-800/60 flex items-center justify-between">
            <span className="text-[10px] text-cyan-300 font-bold">TradingView Standard Preset:</span>
            <button
              type="button"
              data-testid="button-apply-tradingview-preset"
              onClick={() => {
                const tvPreset: SmaSettings = {
                  sma20: { color: "#2962FF", lineWidth: 2, visible: true },
                  sma50: { color: "#EF5350", lineWidth: 2, visible: true },
                  sma200: { color: "#FFD700", lineWidth: 2, visible: true },
                  showRibbon: true,
                  showVolume: true,
                  showAtr: true,
                  candleStyle: "solid",
                };
                onChange(tvPreset);
                saveSmaSettings(tvPreset);
              }}
              className="px-2 py-0.5 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-400/40 text-[10px] font-bold cursor-pointer"
            >
              Apply (Blue/Salmon)
            </button>
          </div>

          {/* Footer Actions */}
          <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
            <button
              type="button"
              data-testid="button-reset-sma-settings"
              onClick={resetDefaults}
              className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-cyan-400 transition-colors cursor-pointer"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Reset Defaults</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-2.5 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-[11px] font-bold transition-colors cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

