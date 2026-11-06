import React from "react";
import { useCardTheme, CARD_THEMES, type CardThemePreset } from "@/lib/cardTheme";
import { Palette } from "lucide-react";

export function CardThemeSwitcher({ className = "" }: { className?: string }) {
  const { theme, setCardTheme } = useCardTheme();

  return (
    <div
      className={`flex items-center gap-1.5 rounded-md border border-slate-800 bg-black/60 p-1 font-mono text-xs backdrop-blur-sm shadow-sm ${className}`}
      data-testid="card-theme-switcher"
    >
      <div className="flex items-center gap-1 text-[10px] text-slate-400 uppercase tracking-wider px-1.5 font-bold select-none">
        <Palette className="h-3 w-3 text-cyan-400" />
        <span>Card Style:</span>
      </div>
      <div className="flex items-center gap-1">
        {(Object.keys(CARD_THEMES) as CardThemePreset[]).map((key) => {
          const cfg = CARD_THEMES[key];
          const isActive = theme === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setCardTheme(key)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-bold transition-all cursor-pointer ${
                isActive
                  ? `${cfg.chipBorder} border bg-white/10 text-white shadow-[0_0_10px_rgba(255,255,255,0.15)] ring-1 ring-white/30 font-extrabold`
                  : "text-slate-400 hover:text-white hover:bg-white/5 border border-transparent"
              }`}
              data-testid={`card-theme-${key}`}
              aria-pressed={isActive}
              title={`Switch cards to ${cfg.name} preset`}
            >
              <span>{cfg.chipEmoji}</span>
              <span className="font-sans text-[11px] font-bold tracking-tight">{cfg.chipLabel}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

