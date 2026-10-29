// ─── Action Center (v2 Overhaul) ───────────────────────────────────────────
// Top-of-Cockpit summary of every watchlist symbol.
// PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE.

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BookOpen, Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, ListChecks, MinusCircle, MoreHorizontal, Palette, Pencil, Sparkles, X, Zap } from "lucide-react";
import type { ScanSelection, SwingDecision, SwingSettings } from "@shared/swingDecision";
import { levelsInvalidOf } from "@shared/swingDecision";
import { actionGroupOf, setupIdOf, effectivePlan } from "@shared/practicePlan";
import { sortForCockpit } from "@shared/readyAlerts";
import { swingGet } from "@/lib/swing";
import { activeVersion, staleVersion, useSelectedPlans } from "@/lib/plans";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { useScan } from "./SwingWorkspace";
import { AlertsPanel } from "./PriceAlerts";
import { PlanRefreshBar, TargetDefaultControl } from "./PlanRefresh";
import { CardStyleSection } from "./CardStyle";
import { AppearanceControls, DisclosureProvider, LiveCtx, InlineTradingCard, Section, TradingCardDialog, acAttrs, isPopulated, useAcPrefs, useDisclosure, useDisclosureAll } from "./TradingCard";
import { AIExecutionEngine, formatCurrency } from "./AIExecutionEngine";
import { LockedTradeCard } from "./LockedCard";
import { PriorityBoard } from "./SetupScore";
import { useAccountSnapshot } from "./FundingPanel";
import { useSwingTrades, tradeApi, invalidateTrades } from "@/lib/swingTrades";
import { useFreshness } from "@/lib/freshness";
import { useOptionalGlobalState } from "@/lib/globalState";
import { useToast } from "@/hooks/use-toast";
import { COLLAPSE_STORAGE_KEY as COLLAPSE_KEY, splitOlder, STATE_LABEL, STATE_TONE, type CollapsePref } from "@shared/cardFreshness";

const DEFAULT_TITLE = "Action Center";

export type CyberTheme =
  | "cyber-neon"
  | "midnight-ocean"
  | "stealth"
  | "bloomberg-classic"
  | "solarized-dark"
  | "nord"
  | "dracula"
  | "high-contrast-light"
  | "monochrome-slate";

export interface CyberThemeConfig {
  id: CyberTheme;
  name: string;
  badgeLabel: string;
  description: string;
  previewGradient: string;
  previewBorder: string;
  previewGlow: string;
  containerBg: string;
  containerBorder: string;
  accentText: string;
}

export const CYBER_THEMES: CyberThemeConfig[] = [
  {
    id: "cyber-neon",
    name: "Cyber Neon",
    badgeLabel: "NEON",
    description: "Deep black background with bright cyan & magenta card glow",
    previewGradient: "from-[#060913] via-cyan-400 to-fuchsia-500",
    previewBorder: "border-cyan-400",
    previewGlow: "shadow-[0_0_15px_rgba(34,211,238,0.5)] border-cyan-400/80 ring-1 ring-cyan-400/50",
    containerBg: "bg-ink-black/60 backdrop-blur-md",
    containerBorder: "border-cyan-500/30 shadow-[0_0_15px_rgba(34,211,238,0.1)]",
    accentText: "text-cyan-400",
  },
  {
    id: "midnight-ocean",
    name: "Midnight Ocean",
    badgeLabel: "OCEAN",
    description: "Deep navy blue background with teal & ocean blue accents",
    previewGradient: "from-[#030E1E] via-teal-400 to-sky-500",
    previewBorder: "border-teal-400",
    previewGlow: "shadow-[0_0_15px_rgba(45,212,191,0.5)] border-teal-400/80 ring-1 ring-teal-400/50",
    containerBg: "bg-[#030E1E]/80 backdrop-blur-md",
    containerBorder: "border-teal-500/40 shadow-[0_0_25px_rgba(45,212,191,0.12)]",
    accentText: "text-teal-400",
  },
  {
    id: "stealth",
    name: "Stealth",
    badgeLabel: "STEALTH",
    description: "Pure black background with monochromatic titanium & silver accents",
    previewGradient: "from-black via-zinc-600 to-slate-200",
    previewBorder: "border-zinc-400",
    previewGlow: "shadow-[0_0_15px_rgba(255,255,255,0.3)] border-zinc-300 ring-1 ring-white/30",
    containerBg: "bg-black/80 backdrop-blur-md",
    containerBorder: "border-zinc-800 shadow-[0_0_25px_rgba(255,255,255,0.04)]",
    accentText: "text-zinc-200",
  },
  {
    id: "bloomberg-classic",
    name: "Bloomberg Classic",
    badgeLabel: "TERMINAL",
    description: "Pure black #000000 background, high-contrast neon cyan/magenta/yellow accents, monospace fonts",
    previewGradient: "from-black via-amber-500 to-cyan-400",
    previewBorder: "border-amber-400",
    previewGlow: "shadow-[0_0_15px_rgba(245,158,11,0.5)] border-amber-400/80 ring-1 ring-amber-400/50",
    containerBg: "bg-black backdrop-blur-md",
    containerBorder: "border-amber-500/40 shadow-[0_0_25px_rgba(245,158,11,0.15)]",
    accentText: "text-amber-400",
  },
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    badgeLabel: "SOLAR",
    description: "Deep teal/blue-gray background (#002b36), muted pastel accents for low eye strain",
    previewGradient: "from-[#002b36] via-[#268bd2] to-[#2aa198]",
    previewBorder: "border-[#2aa198]",
    previewGlow: "shadow-[0_0_15px_rgba(42,161,152,0.4)] border-[#2aa198]/80 ring-1 ring-[#2aa198]/50",
    containerBg: "bg-[#002b36]/90 backdrop-blur-md",
    containerBorder: "border-[#2aa198]/40 shadow-[0_0_25px_rgba(42,161,152,0.12)]",
    accentText: "text-[#2aa198]",
  },
  {
    id: "nord",
    name: "Nord Aesthetic",
    badgeLabel: "NORD",
    description: "Icy blue/gray palette (#2E3440), soft frost-blue highlights, very clean and minimalist",
    previewGradient: "from-[#2E3440] via-[#88C0D0] to-[#81A1C1]",
    previewBorder: "border-[#88C0D0]",
    previewGlow: "shadow-[0_0_15px_rgba(136,192,208,0.4)] border-[#88C0D0]/80 ring-1 ring-[#88C0D0]/50",
    containerBg: "bg-[#2E3440]/90 backdrop-blur-md",
    containerBorder: "border-[#88C0D0]/30 shadow-[0_0_20px_rgba(136,192,208,0.1)]",
    accentText: "text-[#88C0D0]",
  },
  {
    id: "dracula",
    name: "Dracula",
    badgeLabel: "VAMP",
    description: "Dark purple/slate background (#282a36), vibrant pink, green, and purple accents",
    previewGradient: "from-[#282a36] via-[#ff79c6] to-[#bd93f9]",
    previewBorder: "border-[#ff79c6]",
    previewGlow: "shadow-[0_0_15px_rgba(255,121,198,0.5)] border-[#ff79c6]/80 ring-1 ring-[#ff79c6]/50",
    containerBg: "bg-[#282a36]/90 backdrop-blur-md",
    containerBorder: "border-[#ff79c6]/30 shadow-[0_0_25px_rgba(255,121,198,0.12)]",
    accentText: "text-[#ff79c6]",
  },
  {
    id: "high-contrast-light",
    name: "High-Contrast Light",
    badgeLabel: "DAYLIGHT",
    description: "Pure white background, pitch-black text, sharp royal blue and crimson accents",
    previewGradient: "from-white via-blue-600 to-rose-600",
    previewBorder: "border-blue-600",
    previewGlow: "shadow-[0_0_15px_rgba(37,99,235,0.3)] border-blue-600/80 ring-1 ring-blue-600/50",
    containerBg: "bg-white/95 backdrop-blur-md",
    containerBorder: "border-blue-500/40 shadow-[0_0_20px_rgba(0,0,0,0.08)]",
    accentText: "text-blue-600",
  },
  {
    id: "monochrome-slate",
    name: "Monochrome Slate",
    badgeLabel: "SLATE",
    description: "Shades of charcoal and gray, with color only on active execution buttons and live price",
    previewGradient: "from-slate-950 via-slate-700 to-slate-400",
    previewBorder: "border-slate-400",
    previewGlow: "shadow-[0_0_15px_rgba(148,163,184,0.3)] border-slate-300 ring-1 ring-white/20",
    containerBg: "bg-slate-950/90 backdrop-blur-md",
    containerBorder: "border-slate-700 shadow-[0_0_20px_rgba(0,0,0,0.4)]",
    accentText: "text-slate-200",
  },
];

export function CyberThemeSwitcher({
  currentTheme,
  onThemeChange,
}: {
  currentTheme: CyberTheme;
  onThemeChange: (t: CyberTheme) => void;
}) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-line/50 bg-ink-black/60 px-3.5 py-2.5 backdrop-blur-md shadow-lg"
      data-testid="theme-switcher-deck"
    >
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-cyan-400" aria-hidden />
        <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-slate-gray">
          Terminal Theme Switcher
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        {CYBER_THEMES.map((t) => {
          const isActive = currentTheme === t.id;
          return (
            <button
              key={t.id}
              onClick={() => onThemeChange(t.id)}
              className={`group flex items-center gap-2.5 rounded-lg border px-3 py-1.5 transition-all duration-200 select-none ${
                isActive
                  ? `bg-white/10 ${t.previewGlow} scale-[1.03]`
                  : "border-white/10 bg-black/40 hover:border-white/20 hover:bg-white/5 opacity-70 hover:opacity-100"
              }`}
              title={t.description}
              aria-label={`Switch theme to ${t.name}: ${t.description}`}
              aria-pressed={isActive}
              data-testid={`button-theme-${t.id}`}
            >
              <div
                className={`h-4.5 w-4.5 rounded-md bg-gradient-to-br ${t.previewGradient} border ${
                  isActive ? t.previewBorder : "border-white/20"
                } shadow-sm shrink-0`}
              />
              <div className="flex flex-col text-left">
                <span className="font-mono text-[11px] font-bold text-soft-white leading-tight">
                  {t.name}
                </span>
                <span className="font-mono text-[8.5px] uppercase tracking-widest text-slate-gray">
                  {t.badgeLabel}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function getTrafficLightStatus(regimeCode: string, readyCount: number, extendedCount: number) {
  const normRegime = (regimeCode || "yellow").toLowerCase();
  if (normRegime === "red") {
    return {
      status: "RED",
      headline: "DO NOT ENTER",
      detail: "Regime is red or setups are extended. Stand down.",
      icon: "🔴",
      textColor: "text-rose-400",
      borderColor: "border-rose-500/30",
      bgColor: "bg-rose-950/40",
      badgeClass: "bg-rose-500/20 text-rose-300 border-rose-500/40",
    };
  }
  if (readyCount > 0) {
    return {
      status: "GREEN",
      headline: "ACTION REQUIRED",
      detail: `${readyCount} fresh setup${readyCount === 1 ? " is" : "s are"} ready to evaluate.`,
      icon: "🟢",
      textColor: "text-emerald-400",
      borderColor: "border-emerald-500/30",
      bgColor: "bg-emerald-950/40",
      badgeClass: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    };
  }
  if (extendedCount > 0 && normRegime !== "green") {
    return {
      status: "RED",
      headline: "DO NOT ENTER",
      detail: "Regime is red or setups are extended. Stand down.",
      icon: "🔴",
      textColor: "text-rose-400",
      borderColor: "border-rose-500/30",
      bgColor: "bg-rose-950/40",
      badgeClass: "bg-rose-500/20 text-rose-300 border-rose-500/40",
    };
  }
  return {
    status: "YELLOW",
    headline: "MANAGE / HOLD",
    detail: "No fresh setups; manage existing trades.",
    icon: "🟡",
    textColor: "text-amber-400",
    borderColor: "border-amber-500/30",
    bgColor: "bg-amber-950/40",
    badgeClass: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  };
}

export function GlobalTrafficLightBanner({
  regimeCode = "yellow",
  readyCount = 0,
  extendedCount = 0,
}: {
  regimeCode?: string;
  readyCount?: number;
  extendedCount?: number;
}) {
  const light = getTrafficLightStatus(regimeCode, readyCount, extendedCount);
  return (
    <div
      className={`sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border ${light.borderColor} bg-ink-black/60 px-4 py-3 backdrop-blur-md shadow-lg transition-colors`}
      data-testid="traffic-light-banner"
    >
      <div className="flex items-center gap-3">
        <span className="text-base select-none" aria-hidden>{light.icon}</span>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className={`font-mono text-xs font-black uppercase tracking-wider ${light.textColor}`}>
            {light.headline}:
          </span>
          <span className="text-xs font-medium text-slate-200">
            {light.detail}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="rounded-md border border-ink-line/50 bg-black/50 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-slate-gray">
          Market Regime: <strong className={light.textColor}>{regimeCode.toUpperCase()}</strong>
        </span>
        <span className="rounded-md border border-ink-line/50 bg-black/50 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-slate-gray">
          Ready: <strong className="font-mono tabular-nums font-bold text-emerald-400">{readyCount}</strong>
        </span>
      </div>
    </div>
  );
}

function EditableTitle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const start = () => { setDraft(value); setEditing(true); };
  const commit = () => { onChange(draft.trim().slice(0, 40) || DEFAULT_TITLE); setEditing(false); };
  
  if (editing) return (
    <div className="flex items-center gap-2">
      <input autoFocus className="w-56 rounded-md border border-neon-blue/50 bg-ink-black/60 backdrop-blur-md px-3 py-1 font-mono text-sm font-bold text-soft-white focus:outline-none" maxLength={40} value={draft} aria-label="Action Center title"
        onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }} onBlur={commit} data-testid="input-ac-title" />
      <button className="rounded-md bg-signal-green/20 p-1.5 text-signal-green transition-colors hover:bg-signal-green/30" onMouseDown={(e) => e.preventDefault()} onClick={commit} aria-label="Save title" data-testid="button-ac-title-save"><Check className="h-4 w-4" aria-hidden /></button>
      <button className="rounded-md bg-ink-line p-1.5 text-slate-gray transition-colors hover:bg-ink-deep hover:text-soft-white" onMouseDown={(e) => e.preventDefault()} onClick={() => setEditing(false)} aria-label="Cancel" data-testid="button-ac-title-cancel"><X className="h-4 w-4" aria-hidden /></button>
    </div>
  );
  
  return (
    <div className="group flex items-center gap-2">
      <h2 className="cursor-text text-xl font-extrabold uppercase tracking-wide text-soft-white" onDoubleClick={start} data-testid="text-ac-title">{value}</h2>
      <button className="rounded p-1 text-slate-gray opacity-0 transition-all hover:bg-ink-line hover:text-neon-blue focus-visible:opacity-100 group-hover:opacity-100" onClick={start} aria-label="Rename" title="Rename" data-testid="button-ac-title-edit"><Pencil className="h-3 w-3" aria-hidden /></button>
    </div>
  );
}

export default function ActionCenter() {
  return <DisclosureProvider><ActionCenterInner /></DisclosureProvider>;
}

function ActionCenterInner() {
  const req = { selection: "DEFAULT_PLUS_CUSTOM" as ScanSelection, symbols: [], force: 0 };
  const scan = useScan(req);
  const plans = useSelectedPlans();
  const tradesQ = useSwingTrades();
  const openTrades = (tradesQ.data?.trades ?? []).filter((t) => t.status === "ARMED" || t.status === "ACTIVE");
  const lockedSyms = new Set(openTrades.map((t) => t.symbol));
  const { data: prices } = useQuery<Record<string, { price: number }>>({ queryKey: ["/api/prices"], refetchInterval: 30_000, enabled: openTrades.length > 0 });
  const settings = useQuery<SwingSettings>({ queryKey: ["/api/swing/settings"], queryFn: () => swingGet("/api/swing/settings") });
  const { data: regimePayload } = useQuery<{
    effective?: { code: "green" | "yellow" | "red"; source?: string };
  }>({
    queryKey: ["/api/regime"],
    staleTime: 60_000,
  });
  const regimeCode = regimePayload?.effective?.code?.toLowerCase() ?? (settings.data?.regime?.toLowerCase() as "green" | "yellow" | "red" | undefined) ?? "yellow";
  const [prefs, setPrefs] = useAcPrefs();
  const all = useDisclosureAll();
  const [alertsOpen, setAlertsOpen] = useDisclosure("alerts", true);
  const [boxOpen, setBoxOpen] = usePersistentState<boolean>("ac-box-open", true);
  const [appOpen, setAppOpen] = useDisclosure("appearance", false);
  const [savedTitle, setTitle] = usePersistentState<string>("ac-title", DEFAULT_TITLE);
  const title = savedTitle?.trim() || DEFAULT_TITLE;
  const [seen, setSeen] = usePersistentState<string[]>("ac-seen-setups", []);
  const [dlg, setDlg] = useState<{ symbol: string; mode: "view" | "adjust" } | null>(null);

  const rows = sortForCockpit((scan.data?.rows ?? []).map((r) => r.decision));
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);
  
  useEffect(() => {
    if (!moreOpen) return;
    const close = (e: MouseEvent) => { if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMoreOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [moreOpen]);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const sym = String((e as CustomEvent).detail?.symbol ?? "").toUpperCase();
      if (!sym) return;
      setBoxOpen(true); setDlg({ symbol: sym, mode: "view" });
    };
    const onClose = () => setDlg(null);
    window.addEventListener("chizzle:open-card", onOpen);
    window.addEventListener("chizzle:close-card", onClose);
    return () => { window.removeEventListener("chizzle:open-card", onOpen); window.removeEventListener("chizzle:close-card", onClose); };
  }, [setBoxOpen]);

  const fresh = useFreshness();
  const [cpRaw, setCp] = usePersistentState<CollapsePref>(COLLAPSE_KEY, { section: true, cards: {} });
  const cp: CollapsePref = { section: cpRaw?.section ?? true, cards: cpRaw?.cards ?? {} };
  const setCard = (k: string, collapsed: boolean) => setCp({ ...cp, cards: { ...Object.fromEntries(Object.entries(cp.cards).slice(-199)), [k]: collapsed } });
  
  const loudAll = rows.filter((d) => actionGroupOf(d) !== "NO_TRADE" && !lockedSyms.has(d.symbol));
  const fOf = (d: SwingDecision) => fresh(d, activeVersion(d, plans.data?.selected));
  const { older, active: loud } = splitOlder(loudAll, setupIdOf, fOf, cp, { locked: lockedSyms, tradeStatusOf: (d) => openTrades.find((t) => t.symbol === d.symbol)?.status ?? null });
  
  const readyCount = rows.filter((d) => actionGroupOf(d) === "READY" && !lockedSyms.has(d.symbol) && fOf(d).isTradeable).length;
  const quiet = rows.filter((d) => actionGroupOf(d) === "NO_TRADE" && !lockedSyms.has(d.symbol));
  const counts = rows.reduce<Record<string, number>>((m, d) => { const g = actionGroupOf(d); m[g] = (m[g] ?? 0) + 1; return m; }, {});
  
  // Confirmed Trades Global State Synchronization (Cockpit <-> Wealth Studio)
  const global = useOptionalGlobalState();
  const confirmedCount = global
    ? Math.max(global.confirmedCount, counts.CONFIRMED ?? 0)
    : (counts.CONFIRMED ?? 0);

  // Sync scan detections of confirmed setups into Global State Manager
  useEffect(() => {
    if (global && rows.length > 0) {
      for (const r of rows) {
        const isEligible = isConfirmedSetup(r);
        if (isEligible) {
          global.setConfirmedSetup(r.symbol, true);
        } else if (global.confirmedSetups?.[r.symbol]) {
          global.setConfirmedSetup(r.symbol, false);
        }
      }
    }
  }, [rows, global]);
  
  const sel = plans.data?.selected;
  const acct = useAccountSnapshot();
  const safeEquity = Number(acct?.equity) || 25000;
  const equity = safeEquity;
  const expiryBars = settings.data?.expiryBars4h ?? 2;
  const minRr = settings.data?.minRrT1 ?? null;
  const markSeen = (k: string) => { if (!seen.includes(k)) setSeen([...seen.slice(-199), k]); };
  const dlgDecision: SwingDecision | undefined = dlg ? rows.find((d) => d.symbol === dlg.symbol) : undefined;

  const [armingSymbol, setArmingSymbol] = useState<string | null>(null);
  const { toast } = useToast();

  // Strict State-Routing Gatekeeper for the "Active Execution Zone":
  // A card may ONLY mount in the top row if isSetupReady === true AND levelsValid === true AND 1hCandleConfirmed === true.
  // If any parameter fails (or if the trade is just "Forming", "Retest", "Levels Invalid", or "Expired"),
  // the card automatically demotes back to the standard middle "Setup Priority Board".
  const isConfirmedSetup = (d: SwingDecision) => {
    if (lockedSyms.has(d.symbol)) return false;

    // Reject non-tradeable, watch-only, forming, or retest statuses
    const invalidStatuses = new Set([
      "WATCH_RETEST",
      "WATCH_EXTENDED",
      "WATCH_STOP_TOO_WIDE",
      "WATCH_RR_TOO_LOW",
      "SIGNAL_EXPIRED",
      "NO_TRADE",
      "SETUP_FORMING",
    ]);
    if (invalidStatuses.has(d.setupStatus)) return false;

    const g = actionGroupOf(d);
    if (g === "NO_TRADE" || g === "FORMING" || g === "RETEST" || g === "EXTENDED" || g === "RR_STOP" || g === "DATA") {
      return false;
    }

    // Freshness & tradeability check
    const f = fOf(d);
    if (!f.isTradeable) return false;
    if (f.state === "MISSED_ENTRY" || f.state === "INVALIDATED" || f.state === "EXPIRED" || f.state === "STALE") {
      return false;
    }

    // 1. levelsValid: strict verification
    const ver = activeVersion(d, sel);
    const plan = effectivePlan(d, ver);
    const entry = plan.entry ?? d.entryPrice;
    const stop = plan.stop ?? d.structuralStop;
    const t1 = plan.t1 ?? (d.planTargets?.t1 ?? d.target1);

    if (entry == null || stop == null || entry <= stop || entry <= 0 || stop <= 0) {
      return false;
    }

    const invalid = levelsInvalidOf(d, { entry, stop, t1: t1 ?? null });
    if (invalid != null) {
      return false;
    }
    const levelsValid = true;

    // 2. 1hCandleConfirmed: 1H candle confirmed above trigger
    const candleConfirmed1h =
      actionGroupOf(d) === "CONFIRMED" ||
      g === "READY" ||
      (d as any).setupStatus === "SETUP_CONFIRMED" ||
      d.setupStatus === "READY_TO_TRADE" ||
      Boolean(global?.confirmedSetups?.[d.symbol]);
    const is1hCandleConfirmed = candleConfirmed1h;

    // 3. isSetupReady: trade rules met and ready to arm
    const isSetupReady = (g === "READY" || actionGroupOf(d) === "CONFIRMED" || d.setupStatus === "READY_TO_TRADE" || (d as any).setupStatus === "SETUP_CONFIRMED") && f.isTradeable;

    return isSetupReady && levelsValid && is1hCandleConfirmed;
  };

  const confirmedRows = rows.filter(isConfirmedSetup);
  const confirmedSymSet = new Set(confirmedRows.map((d) => d.symbol));
  const generalPriorityRows = rows.filter((d) => !confirmedSymSet.has(d.symbol));
  const generalLoud = loud.filter((d) => !confirmedSymSet.has(d.symbol));

  const handleDirectArmExecute = async (d: SwingDecision, ver: any) => {
    try {
      setArmingSymbol(d.symbol);
      const plan = effectivePlan(d, ver);
      const entryPrice =
        plan?.entry != null && plan.entry > 0
          ? plan.entry
          : d.entryPrice != null && d.entryPrice > 0
          ? d.entryPrice
          : d.triggerPrice != null && d.triggerPrice > 0
          ? d.triggerPrice
          : d.currentPrice != null && d.currentPrice > 0
          ? d.currentPrice
          : 0;
      const stopLoss =
        plan?.stop != null && plan.stop > 0
          ? plan.stop
          : d.structuralStop != null && d.structuralStop > 0
          ? d.structuralStop
          : Number((entryPrice * 0.95).toFixed(2));
      const target1 =
        plan?.t1 != null && plan.t1 > 0
          ? plan.t1
          : d.planTargets?.t1 != null && d.planTargets.t1 > 0
          ? d.planTargets.t1
          : d.target1 != null && d.target1 > 0
          ? d.target1
          : Number((entryPrice + 1.5 * Math.max(0.01, Math.abs(entryPrice - stopLoss))).toFixed(2));
      const target2 = plan?.t2 ?? d.planTargets?.t2 ?? d.target2;
      const perShareRisk = Math.max(0.01, entryPrice - stopLoss);
      const calculatedShares = Math.max(1, Math.floor((equity * 0.01) / perShareRisk));
      const calculatedRisk = +(calculatedShares * perShareRisk).toFixed(2);

      const armedTrade = await tradeApi.arm({
        symbol: d.symbol.toUpperCase(),
        entry: entryPrice,
        stop: stopLoss,
        shares: calculatedShares,
        riskDollars: calculatedRisk,
        t1: target1,
        t2: target2,
        setupType: d.setupType ?? "CONFIRMED_BREAKOUT",
        timeframe: "1H",
        notes: `Automated Execution from Active Execution Zone: ${d.symbol}`,
      } as any);

      if (armedTrade?.id) {
        await tradeApi.fill(armedTrade.id, {
          fillPrice: entryPrice,
          note: "Auto-fill confirmed 1H trade execution",
        });
      }

      if (global?.setConfirmedSetup) {
        global.setConfirmedSetup(d.symbol, false);
      }

      await invalidateTrades();
      toast({
        title: "Trade Executed & Active",
        description: `${d.symbol} armed and filled at ${formatCurrency(entryPrice)}. Routed to Active Trades.`,
      });
    } catch (err: any) {
      toast({
        title: "Execution Error",
        description: err?.message || "Failed to execute trade.",
        variant: "destructive",
      });
    } finally {
      setArmingSymbol(null);
    }
  };

  const [cyberTheme, setCyberTheme] = usePersistentState<CyberTheme>("ac-cyber-theme", "cyber-neon");
  const activeThemeConfig = CYBER_THEMES.find((t) => t.id === cyberTheme) ?? CYBER_THEMES[0];
  const [gridSize, setGridSize] = usePersistentState<"sm" | "md" | "lg">("ac-grid-size", "md");
  const [isCollapsedAll, setIsCollapsedAll] = usePersistentState<boolean>("ac-cards-collapsed-all", false);
  const gridColsClass =
    gridSize === "lg" ? "grid-cols-1 md:grid-cols-2"
    : gridSize === "sm" ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
    : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

  return (
    <LiveCtx.Provider value={scan.data?.livePermission ?? null}>
    <section
      className={`w-full flex flex-col gap-3.5 rounded-xl p-3 sm:p-4 transition-all duration-300 bg-slate-900/90 border border-slate-800 shadow-md ${activeThemeConfig.containerBorder}`}
      data-cyber-theme={cyberTheme}
      {...acAttrs(prefs)}
      aria-label={title}
      data-testid="action-center"
      data-open={boxOpen}
    >
      
      {/* ─── HEADER ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-4 border-b border-slate-800 pb-4">
        <button className="rounded-md p-1.5 text-slate-gray transition-colors hover:bg-ink-line hover:text-soft-white" onClick={() => setBoxOpen(!boxOpen)} aria-expanded={boxOpen} aria-controls="ac-body" aria-label={`${boxOpen ? "Collapse" : "Expand"} ${title}`} data-testid="button-toggle-action-center">
          {boxOpen ? <ChevronDown className="h-5 w-5" aria-hidden /> : <ChevronRight className="h-5 w-5" aria-hidden />}
        </button>
        
        <EditableTitle value={title} onChange={setTitle} />
        
        <span
          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-mono font-bold uppercase tracking-widest ${
            readyCount
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.15)]"
              : "border-white/10 bg-black/40 text-slate-gray"
          }`}
          data-testid="text-ac-ready-count"
          title="Fresh, tradeable practice setups"
        >
          <Zap className="h-3.5 w-3.5 text-emerald-400" aria-hidden /> <strong className="font-mono tabular-nums font-bold text-emerald-400">{readyCount}</strong> fresh
        </span>
        
        {older.length > 0 && (
          <span
            className="rounded-full border border-amber-500/30 bg-amber-950/40 px-2.5 py-1 text-[10px] font-mono font-bold uppercase tracking-widest text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.15)]"
            data-testid="text-ac-older-count"
          >
            <strong className="font-mono tabular-nums font-bold text-amber-300">{older.length}</strong> older / not tradeable
          </span>
        )}

        {/* High-Contrast Glowing Status Pill: Confirmed Trades */}
        <span
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10.5px] font-mono uppercase tracking-wider transition-all ${
            confirmedCount > 0
              ? "border-emerald-400 bg-emerald-500 font-extrabold text-gray-950 shadow-[0_0_20px_rgba(16,185,129,0.85)] ring-2 ring-emerald-300 animate-pulse"
              : "border-white/10 bg-transparent text-slate-400 font-medium"
          }`}
          data-testid="pill-confirmed-trades"
          data-active={confirmedCount > 0 ? "true" : "false"}
          title={
            confirmedCount > 0
              ? `${confirmedCount} setup(s) confirmed — ready to execute`
              : "Setups where price has confirmed above trigger"
          }
        >
          <span
            className={`h-2 w-2 rounded-full transition-colors ${
              confirmedCount > 0 ? "bg-gray-950 shadow-sm" : "bg-slate-600"
            }`}
          />
          <span>
            [ CONFIRMED TRADES:{" "}
            <strong
              className={`font-mono tabular-nums font-black ${
                confirmedCount > 0 ? "text-gray-950" : "text-slate-400"
              }`}
            >
              {confirmedCount}
            </strong>{" "}
            ]
          </span>
        </span>

        {/* High-Contrast Glowing Status Pill: Practice Trades Active */}
        <span
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10.5px] font-mono font-bold uppercase tracking-wider transition-all ${
            openTrades.length > 0
              ? "border-amber-400 bg-amber-950/80 text-amber-300 shadow-[0_0_18px_rgba(245,158,11,0.5)] ring-1 ring-amber-400/40 animate-pulse"
              : "border-white/10 bg-black/40 text-slate-400"
          }`}
          data-testid="pill-practice-trades-active"
          title="Active practice trades being tracked in Cockpit"
        >
          <span className={`h-2 w-2 rounded-full ${openTrades.length > 0 ? "bg-amber-400 shadow-[0_0_8px_#F59E0B]" : "bg-slate-600"}`} />
          <span>Practice Trades Active: <strong className="font-mono tabular-nums font-black">{openTrades.length}</strong></span>
        </span>
        
        <span
          className="rounded-full border border-ink-line/40 bg-black/40 px-3 py-1 text-[10px] font-mono tabular-nums font-medium uppercase tracking-wider text-slate-gray"
          data-testid="text-ac-counts"
        >
          {scan.isLoading ? "Evaluating watchlist…" : scan.data?.pending?.length ? `Evaluating ${scan.data.pending.length} of ${scan.data.scanned}… · ` : ""}
          {scan.isLoading ? "" : `${confirmedCount} confirmed · ${counts.FORMING ?? 0} forming · ${(counts.RETEST ?? 0) + (counts.EXTENDED ?? 0) + (counts.RR_STOP ?? 0)} watch · ${counts.DATA ?? 0} data · ${counts.NO_TRADE ?? 0} no trade`}
        </span>
        
        <span className="rounded-md border border-amber-500/30 bg-amber-950/40 px-2.5 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-wider text-amber-300">
          PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE
        </span>
        
        {boxOpen && (
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <div className="flex overflow-hidden rounded-md border border-ink-line" role="group" aria-label="Card view">
              {(["guided", "compact"] as const).map((v) => (
                <button key={v} className={`flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${prefs.view === v ? "bg-neon-blue/20 text-neon-blue" : "bg-ink-black text-slate-gray hover:bg-ink-deep"}`} aria-pressed={prefs.view === v} onClick={() => setPrefs({ view: v })} data-testid={`button-view-${v}`}>
                  {v === "guided" ? <BookOpen className="h-3 w-3" aria-hidden /> : <ListChecks className="h-3 w-3" aria-hidden />}{v === "guided" ? "Guided" : "Compact"}
                </button>
              ))}
            </div>
            
            <div className="relative" ref={moreRef}>
              <button className="flex items-center gap-1.5 rounded-md border border-ink-line bg-ink-deep/40 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-gray transition-colors hover:text-soft-white" onClick={() => setMoreOpen(!moreOpen)} aria-expanded={moreOpen} aria-haspopup="true" data-testid="button-ac-more">
                <MoreHorizontal className="h-4 w-4" aria-hidden /> More
              </button>
              {moreOpen && (
                <div className="absolute right-0 top-full z-40 mt-2 w-72 rounded-lg border border-ink-line/50 bg-ink-black/90 backdrop-blur-md p-3 shadow-2xl" role="menu" data-testid="menu-ac-more">
                  <div className="flex flex-wrap gap-2">
                    <button className="flex flex-1 items-center justify-center gap-2 rounded-md bg-ink-deep/40 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-soft-white transition-colors hover:bg-ink-line hover:text-neon-blue" role="menuitem" onClick={() => { all(true); setMoreOpen(false); }} data-testid="button-expand-all"><ChevronsUpDown className="h-3.5 w-3.5" aria-hidden /> Expand</button>
                    <button className="flex flex-1 items-center justify-center gap-2 rounded-md bg-ink-deep/40 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-soft-white transition-colors hover:bg-ink-line hover:text-neon-blue" role="menuitem" onClick={() => { all(false); setMoreOpen(false); }} data-testid="button-collapse-all"><ChevronsDownUp className="h-3.5 w-3.5" aria-hidden /> Collapse</button>
                    <button className="flex w-full items-center justify-center gap-2 rounded-md bg-ink-deep/40 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-soft-white transition-colors hover:bg-ink-line hover:text-neon-blue" role="menuitem" onClick={() => { setAppOpen(!appOpen); setMoreOpen(false); }} aria-expanded={appOpen} aria-controls="ac-appearance" data-testid="sec-appearance-toggle">
                      <Palette className="h-3.5 w-3.5" aria-hidden /> Appearance
                    </button>
                  </div>
                  <div className="mt-3 border-t border-ink-line/50 pt-3">
                    <TargetDefaultControl settings={settings.data} />
                  </div>
                  <div className="mt-3 text-[9px] font-bold uppercase tracking-wider text-signal-amber">OVERNIGHT GAP RISK — STOP ORDERS CAN FILL BELOW STOP PRICE.</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ─── BODY ───────────────────────────────────────────────────────────── */}
      {boxOpen && (
        <div id="ac-body" className="flex flex-col gap-3.5">
          {/* ─── ACTIVE EXECUTION ZONE - CONFIRMED TRADES ─── */}
          {confirmedRows.length > 0 && (
            <div
              className="flex flex-col gap-3 rounded-xl border-2 border-emerald-500/80 bg-emerald-950/30 p-4 shadow-[0_0_25px_rgba(16,185,129,0.35)] backdrop-blur-md animate-in fade-in duration-300"
              data-testid="active-execution-zone"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-500/30 pb-3">
                <div className="flex items-center gap-2.5">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
                  </span>
                  <h3 className="font-mono text-sm font-extrabold uppercase tracking-widest text-emerald-300">
                    [ ACTIVE EXECUTION ZONE - CONFIRMED TRADES ]
                  </h3>
                  <span className="rounded-full bg-emerald-500 px-2.5 py-0.5 font-mono text-[11px] font-black text-gray-950">
                    {confirmedRows.length} ACTIVE
                  </span>
                </div>
                <span className="font-mono text-[10.5px] uppercase tracking-wider text-emerald-400/80">
                  Trigger Confirmed · 1H Candle Close Validated · Ready For Immediate Arm
                </span>
              </div>

              <div className="flex flex-col gap-3">
                {confirmedRows.map((d) => {
                  const ver = activeVersion(d, sel);
                  const plan = effectivePlan(d, ver);
                  const isArming = armingSymbol === d.symbol;

                  const liveQuote = prices?.[d.symbol];
                  const globalPrice = global?.livePrices?.[d.symbol] ?? (d.symbol === global?.activeTicker ? global?.activePrice : null);
                  const effectivePrice = globalPrice ?? liveQuote?.price ?? d.currentPrice;

                  const entryPrice = plan.entry ?? d.entryPrice;
                  const stopLoss = plan.stop ?? d.structuralStop;
                  const target1 = plan.t1 ?? (d.planTargets?.t1 ?? d.target1);

                  return (
                    <div
                      key={d.symbol}
                      className="flex flex-wrap items-center justify-between gap-3 sm:gap-4 rounded-xl border-2 border-emerald-500 bg-emerald-950/40 px-4 py-2.5 shadow-[0_0_15px_rgba(16,185,129,0.5)] shadow-md shadow-emerald-900/20 ring-2 ring-emerald-400/40 animate-pulse transition-all hover:border-emerald-400"
                      data-testid={`active-execution-card-${d.symbol}`}
                    >
                      {/* Ticker & Live Price */}
                      <div className="flex items-center gap-2.5 shrink-0">
                        <span className="font-mono text-xl sm:text-2xl font-black tracking-tight text-white">{d.symbol}</span>
                        <span className="font-mono text-base sm:text-lg font-extrabold text-emerald-400 tabular-nums">{formatCurrency(effectivePrice)}</span>
                        <span className="rounded bg-emerald-500/20 border border-emerald-400/40 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-300 hidden sm:inline-block">CONFIRMED</span>
                      </div>

                      {/* BUY LIMIT | STOP | TARGET */}
                      <div className="flex flex-wrap items-center gap-4 sm:gap-6 font-mono text-xs sm:text-sm">
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-slate-400">BUY LIMIT:</span>
                          <span className="font-extrabold text-white tabular-nums text-sm sm:text-base">{formatCurrency(entryPrice)}</span>
                        </div>
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-slate-400">STOP:</span>
                          <span className="font-extrabold text-rose-400 tabular-nums text-sm sm:text-base">{formatCurrency(stopLoss)}</span>
                        </div>
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-slate-400">TARGET:</span>
                          <span className="font-extrabold text-emerald-400 tabular-nums text-sm sm:text-base">{formatCurrency(target1)}</span>
                        </div>
                      </div>

                      {/* [ ⚡ ARM TRADE ] button */}
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleDirectArmExecute(d, ver)}
                          disabled={isArming}
                          className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-mono font-black text-xs sm:text-sm uppercase tracking-wider shadow-[0_0_15px_rgba(16,185,129,0.5)] animate-pulse transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                          data-testid={`button-massive-arm-${d.symbol}`}
                          aria-label={`Arm Trade for ${d.symbol}`}
                        >
                          <Zap className="h-4 w-4 fill-gray-950 text-gray-950" />
                          <span>{isArming ? "Executing..." : "[ ⚡ ARM TRADE ]"}</span>
                        </button>
                      </div>
                      <div data-testid={`ai-context-sidebar-${d.symbol}`} className="hidden" aria-hidden="true" />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <GlobalTrafficLightBanner
            regimeCode={regimeCode}
            readyCount={readyCount}
            extendedCount={counts.EXTENDED ?? 0}
          />
          <PlanRefreshBar settings={settings.data} />
          <CyberThemeSwitcher currentTheme={cyberTheme} onThemeChange={setCyberTheme} />
          
          {appOpen && <div id="ac-appearance" data-testid="sec-appearance" data-open="true"><AppearanceControls prefs={prefs} set={setPrefs} /></div>}
          {appOpen && <CardStyleSection />}
          
          {scan.data?.emptyReason && (
            <div className="flex items-center gap-2 rounded-md border border-signal-amber/40 bg-signal-amber/10 px-4 py-3 text-xs font-medium text-signal-amber">
              <AlertTriangle className="h-4 w-4" aria-hidden /> {scan.data.emptyReason}
            </div>
          )}

          {!scan.isLoading && !generalLoud.length && !confirmedRows.length && !openTrades.length && (
            <div className="rounded-lg border border-dashed border-ink-line/50 bg-ink-black/40 backdrop-blur-md p-6 text-center text-sm font-medium text-slate-gray" data-testid="text-ac-nothing">
              {older.length ? `No fresh setups right now. ${older.length} older setup${older.length === 1 ? " is" : "s are"} listed under "Older / not tradeable" below — each shows what resets it.` : "Nothing ready, confirmed or forming right now. That is a valid answer: no trade is a position. Next conditions are listed below."}
            </div>
          )}

          {openTrades.length > 0 && (
            <div className="flex flex-col gap-3" data-testid="sec-pinned-trades">
              <div className="flex flex-wrap items-center gap-3 px-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-gray">MY TRADES — PINNED</span>
                <span className="text-[10px] font-medium uppercase tracking-wider text-slate-gray">{openTrades.length} locked card{openTrades.length === 1 ? "" : "s"} · levels come from your practice trade, not the scanner</span>
              </div>
              {openTrades.map((t) => { 
                const d = rows.find((x) => x.symbol === t.symbol) ?? null; 
                return <LockedTradeCard key={t.id} trade={t} d={d} ver={d ? activeVersion(d, sel) : null} price={prices?.[t.symbol]?.price ?? null} onOpen={d ? () => setDlg({ symbol: t.symbol, mode: "view" }) : undefined} />; 
              })}
            </div>
          )}

          <PriorityBoard rows={generalPriorityRows} settings={settings.data} onOpen={(sym) => setDlg({ symbol: sym, mode: "view" })} />

          {/* Cockpit Grid Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-2.5 rounded-lg border border-slate-800 bg-slate-950/60 backdrop-blur-sm" data-testid="cockpit-grid-toolbar">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsCollapsedAll(!isCollapsedAll)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-700 bg-slate-800 hover:bg-slate-700 text-xs font-mono font-bold text-slate-200 transition-colors shadow-sm cursor-pointer"
                data-testid="button-collapse-expand-all"
              >
                {isCollapsedAll ? (
                  <>
                    <ChevronsUpDown className="h-3.5 w-3.5 text-cyan-400" />
                    <span>Expand All Cards</span>
                  </>
                ) : (
                  <>
                    <ChevronsDownUp className="h-3.5 w-3.5 text-cyan-400" />
                    <span>Collapse All Cards</span>
                  </>
                )}
              </button>
              <span className="text-[11px] font-mono text-slate-400 hidden sm:inline">
                {isCollapsedAll ? "Compact view: ticker & status only" : "Detailed view: levels & progress active"}
              </span>
            </div>

            {/* Grid Size Toggle: Small, Medium, Large */}
            <div className="flex items-center gap-1 rounded-md border border-slate-800 bg-black/40 p-1 font-mono text-xs" data-testid="grid-size-toggle">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider px-2 font-bold">Grid Size:</span>
              {(["sm", "md", "lg"] as const).map((sz) => (
                <button
                  key={sz}
                  type="button"
                  onClick={() => setGridSize(sz)}
                  className={`px-2.5 py-1 rounded text-xs font-bold transition-all cursor-pointer ${
                    gridSize === sz
                      ? "bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 shadow-sm"
                      : "text-slate-400 hover:text-white"
                  }`}
                  data-testid={`grid-size-${sz}`}
                >
                  {sz === "sm" ? "Small" : sz === "md" ? "Medium" : "Large"}
                </button>
              ))}
            </div>
          </div>
          
          <div className={`grid ${gridColsClass} gap-3.5 sm:gap-4 w-full`} data-testid="ac-cards-grid">
            {generalLoud.map((d) => {
              const ver = activeVersion(d, sel);
              const stale = staleVersion(d, sel);
              const key = setupIdOf(d);
              const populated = isPopulated(d, ver);
              return (
                <div key={d.symbol} className="flex flex-col gap-1.5">
                  <InlineTradingCard d={d} group={actionGroupOf(d)} ver={ver} equity={equity} expiryBars={expiryBars} minRr={minRr} prefs={prefs} setupKey={key} isNew={populated && !seen.includes(key)} onSeen={() => markSeen(key)} onOpen={() => setDlg({ symbol: d.symbol, mode: "view" })} onAdjust={() => { markSeen(key); setDlg({ symbol: d.symbol, mode: "adjust" }); }} collapsed={isCollapsedAll} />
                  {stale && <span className="px-2 text-[10px] font-medium text-slate-gray" data-testid={`text-stale-version-${d.symbol}`}>Your Plan v{stale.version} was for an older {d.symbol} setup. It's kept in history and not applied to this new setup.</span>}
                  {fOf(d).shouldCollapse && (
                    <button className="flex w-max items-center gap-1.5 rounded-md px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-gray transition-colors hover:bg-ink-deep hover:text-soft-white" onClick={() => setCard(key, true)} data-testid={`button-move-older-${d.symbol}`}>
                      <ChevronsDownUp className="h-3 w-3" aria-hidden /> Move to Older / not tradeable
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {older.length > 0 && (
            <div className="w-full flex flex-col rounded-xl border border-dashed border-slate-800 bg-slate-950/60 p-4" data-testid="sec-older" data-open={cp.section}>
              <button className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-ink-deep/40" onClick={() => setCp({ ...cp, section: !cp.section })} aria-expanded={cp.section} data-testid="button-toggle-older">
                {cp.section ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-gray" aria-hidden /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-gray" aria-hidden />}
                <span className="text-sm font-bold text-soft-white">Older / not tradeable ({older.length})</span>
                <span className="min-w-0 truncate text-[10px] font-medium text-slate-gray">auto-collapsed: missed entry, stale, invalidated or expired · your trades and armed plans are never collapsed</span>
              </button>
              {cp.section && (
                <ul className="flex flex-col gap-2 px-4 pb-4">
                  {older.map((d) => { 
                    const f = fOf(d), k = setupIdOf(d); 
                    const isWarn = STATE_TONE[f.state] === "good" ? false : true;
                    const toneClass = isWarn ? "text-signal-amber border-signal-amber/40 bg-signal-amber/10" : "text-slate-gray border-ink-line bg-ink-deep/40";
                    return (
                      <li key={d.symbol} className="flex flex-wrap items-center gap-3 text-sm" data-testid={`row-older-${d.symbol}`} data-state={f.state}>
                        <ChevronRight className="h-4 w-4 shrink-0 text-slate-gray" aria-hidden />
                        <span className="font-mono font-bold text-soft-white">{d.symbol}</span>
                        <span className={`rounded-md border px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider ${toneClass}`} data-testid={`badge-older-state-${d.symbol}`}>{STATE_LABEL[f.state]}</span>
                        <span className="text-xs text-slate-gray" data-testid={`text-older-reason-${d.symbol}`}>{f.reasonSummary}</span>
                        {f.resetConditionText && <span className="text-xs text-slate-gray" data-testid={`text-older-reset-${d.symbol}`}>· <span className="font-medium text-neon-blue">Resets:</span> {f.resetConditionText}</span>}
                        <button className="ml-auto flex items-center gap-1.5 rounded-md border border-ink-line px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-gray transition-colors hover:bg-ink-deep hover:text-soft-white" onClick={() => setCard(k, false)} data-testid={`button-older-expand-${d.symbol}`}>
                          <ChevronsUpDown className="h-3 w-3" aria-hidden /> Expand
                        </button>
                      </li>
                    ); 
                  })}
                </ul>
              )}
            </div>
          )}

          <div className="grid items-start gap-6 lg:grid-cols-2 w-full">
            {quiet.length > 0 && (
              <Section id="quiet" title="Watch / No-trade list" def={false} testId="sec-quiet" summary={`${quiet.length} symbols: ${quiet.map((d) => d.symbol).join(", ")}`}>
                <ul className="flex flex-col gap-2">
                  {quiet.map((d) => (
                    <li key={d.symbol} className="flex flex-wrap items-center gap-3 text-sm" data-testid={`row-ac-quiet-${d.symbol}`}>
                      <MinusCircle className="h-4 w-4 shrink-0 text-slate-gray" aria-hidden />
                      <span className="font-mono tabular-nums font-bold text-soft-white">{d.symbol}</span>
                      <span className="text-[10px] uppercase tracking-wider text-slate-gray">NO TRADE — NEXT CONDITION</span>
                      <span className="text-xs text-slate-gray">{d.nextAction}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            
            {dlgDecision && (
              <TradingCardDialog open={!!dlg} onClose={() => setDlg(null)} mode={dlg!.mode} setMode={(m) => setDlg({ symbol: dlg!.symbol, mode: m })}
                d={dlgDecision} group={actionGroupOf(dlgDecision)} ver={activeVersion(dlgDecision, sel)} equity={equity} expiryBars={expiryBars} minRr={minRr} prefs={prefs} />
            )}
            
            <div className={`w-full rounded-xl bg-slate-900 border border-slate-800 p-5 text-soft-white shadow-md ${quiet.length ? "" : "lg:col-span-2"}`}>
              <AlertsPanel open={alertsOpen} onOpenChange={setAlertsOpen} />
            </div>
          </div>
        </div>
      )}
    </section>
    </LiveCtx.Provider>
  );
}
