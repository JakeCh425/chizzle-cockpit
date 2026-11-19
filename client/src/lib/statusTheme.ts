/**
 * Single Shared Semantic Status Theme Config (`statusTheme.ts`)
 * Applied identically across Action Center, Pending List, Watchlist, and Wealth Studio.
 */

export type SetupVisualStage = "READY" | "APPROACHING" | "FORMING" | "BLOCKED";

export interface StageThemeConfig {
  stage: SetupVisualStage;
  label: string;
  badgeClass: string;
  progressBarClass: string;
  dotClass: string;
  borderAccentClass: string;
  textClass: string;
}

export const STATUS_THEME: Record<SetupVisualStage, StageThemeConfig> = {
  READY: {
    stage: "READY",
    label: "⚡ READY TO TRADE",
    badgeClass: "bg-emerald-400 text-slate-950 font-black",
    progressBarClass: "bg-emerald-400 shadow-[0_0_10px_#00F5A0]",
    dotClass: "bg-emerald-400 shadow-[0_0_8px_#00F5A0]",
    borderAccentClass: "border-emerald-400",
    textClass: "text-emerald-400",
  },
  APPROACHING: {
    stage: "APPROACHING",
    label: "⏳ AWAITING 1H BOUNCE",
    badgeClass: "bg-amber-500/15 text-amber-300 border border-amber-400/60",
    progressBarClass: "bg-amber-400 shadow-[0_0_10px_rgba(255,184,0,0.45)]",
    dotClass: "bg-amber-400",
    borderAccentClass: "border-amber-400",
    textClass: "text-amber-300",
  },
  FORMING: {
    stage: "FORMING",
    label: "📡 FORMING PULLBACK",
    badgeClass: "bg-sky-500/15 text-sky-300 border border-sky-400/50",
    progressBarClass: "bg-sky-400",
    dotClass: "bg-sky-400",
    borderAccentClass: "border-sky-400",
    textClass: "text-sky-300",
  },
  BLOCKED: {
    stage: "BLOCKED",
    label: "🔒 MACRO STAND-DOWN",
    badgeClass: "bg-rose-500/15 text-rose-300 border border-rose-500/50",
    progressBarClass: "bg-rose-500",
    dotClass: "bg-rose-500",
    borderAccentClass: "border-rose-500",
    textClass: "text-rose-300",
  },
};

export const PRICE_COLOR_CLASSES = {
  entry: "text-cyan-300 font-mono font-bold",
  stop: "text-rose-400 font-mono",
  profitActive: "text-emerald-400/90 font-mono",
  profitDeepStandby: "text-slate-400 font-mono",
} as const;
