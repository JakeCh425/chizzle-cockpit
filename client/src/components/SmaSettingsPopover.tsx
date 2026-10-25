import React, { useRef, useEffect } from "react";
import { Settings, RotateCcw, X } from "lucide-react";
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
  "#22d3ee", // Cyan
  "#38bdf8", // Sky blue
  "#22c55e", // Green
  "#a3e635", // Lime
  "#fbbf24", // Amber
  "#f97316", // Orange
  "#f43f5e", // Rose
  "#c084fc", // Purple/Magenta
  "#e879f9", // Fuchsia
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
        className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-800/90 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-mono font-medium tracking-wide uppercase transition-colors cursor-pointer shadow-sm"
        title="SMA Visual Settings (Color & Thickness)"
      >
        <Settings className="h-3.5 w-3.5 text-cyan-400" />
        <span className="hidden sm:inline">SMA Settings</span>
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
