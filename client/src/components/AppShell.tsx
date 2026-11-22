import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { MegaMenu } from "./MegaMenu";
import { useQuery } from "@tanstack/react-query";
import type { Settings, ChizzleScore, RegimeState, RegimeInputsRow } from "@shared/schema";
import { chicagoClock, marketSession, useFeedConnection, isMarketOpen, isPrimaryWsOpen } from "@/lib/priceFeed";
import { useMarketDataStore, getUnifiedFeedStatus, APP_SCHEMA_VERSION, CACHE_VERSION_KEY } from "@/lib/useMarketDataStore";
import {
  useCardTypography,
  updateCardTypography,
  type CardFontSize,
  type CardFontFamily,
} from "@/lib/statusTheme";
import { MarketDataEngine } from "@/services/MarketDataEngine";
import { queryClient } from "@/lib/queryClient";
import { regimeLabel, identityState as identityFn } from "@/lib/engine";
import {
  Gauge, LayoutDashboard, ListChecks, History, BookText, Layers,
  BarChart3, Settings as SettingsIcon, ChevronLeft, ChevronRight,
  FileText, Activity, ClipboardList, Beaker, X, Trash2, RefreshCw, Palette,
} from "lucide-react";
import {
  useTerminalTheme,
  APP_BACKGROUNDS,
  CARD_SURFACES,
  type AppBgId,
  type CardSurfaceId,
  type FontFamilyOption,
  type TextScaleOption,
  type EngineBgOption,
} from "@/lib/terminalTheme";
import { useOptionalGlobalState } from "@/lib/globalState";

interface RegimePayload {
  state: RegimeState;
  latestInputs: RegimeInputsRow | null;
  effective: { code: "green" | "yellow" | "red"; source: "AUTO" | "MANUAL" };
}

const NAV = [
  {
    href: "/",
    label: "Cockpit",
    icon: Gauge,
    neonColor: "text-cyan-400",
    neonGlow: "drop-shadow-[0_0_8px_rgba(34,211,238,0.8)]",
    activeClass: "bg-cyan-500/15 text-cyan-400 border-l-4 border-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.25)]",
    hoverColor: "hover:text-cyan-300",
  },
  {
    href: "/engine",
    label: "Wealth Studio",
    icon: LayoutDashboard,
    neonColor: "text-fuchsia-400",
    neonGlow: "drop-shadow-[0_0_8px_rgba(217,70,239,0.8)]",
    activeClass: "bg-fuchsia-500/15 text-fuchsia-400 border-l-4 border-fuchsia-400 shadow-[0_0_12px_rgba(217,70,239,0.25)]",
    hoverColor: "hover:text-fuchsia-300",
  },
  {
    href: "/watchlist",
    label: "Watchlist",
    icon: ListChecks,
    neonColor: "text-emerald-400",
    neonGlow: "drop-shadow-[0_0_8px_rgba(52,211,153,0.8)]",
    activeClass: "bg-emerald-500/15 text-emerald-400 border-l-4 border-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.25)]",
    hoverColor: "hover:text-emerald-300",
  },
  {
    href: "/trades",
    label: "Trades",
    icon: History,
    neonColor: "text-orange-400",
    neonGlow: "drop-shadow-[0_0_8px_rgba(249,115,22,0.8)]",
    activeClass: "bg-orange-500/15 text-orange-400 border-l-4 border-orange-400 shadow-[0_0_12px_rgba(249,115,22,0.25)]",
    hoverColor: "hover:text-orange-300",
  },
  {
    href: "/trade-planner",
    label: "Trade Planner",
    icon: ClipboardList,
    neonColor: "text-teal-400",
    neonGlow: "drop-shadow-[0_0_8px_rgba(45,212,191,0.8)]",
    activeClass: "bg-teal-500/15 text-teal-400 border-l-4 border-teal-400 shadow-[0_0_12px_rgba(45,212,191,0.25)]",
    hoverColor: "hover:text-teal-300",
  },
  {
    href: "/journal",
    label: "Journal",
    icon: BookText,
    neonColor: "text-amber-400",
    neonGlow: "drop-shadow-[0_0_8px_rgba(251,191,36,0.8)]",
    activeClass: "bg-amber-500/15 text-amber-400 border-l-4 border-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.25)]",
    hoverColor: "hover:text-amber-300",
  },
  {
    href: "/leap",
    label: "LEAP Ladder",
    icon: Layers,
    neonColor: "text-violet-400",
    neonGlow: "drop-shadow-[0_0_8px_rgba(167,139,250,0.8)]",
    activeClass: "bg-violet-500/15 text-violet-400 border-l-4 border-violet-400 shadow-[0_0_12px_rgba(167,139,250,0.25)]",
    hoverColor: "hover:text-violet-300",
  },
  {
    href: "/analytics",
    label: "Analytics",
    icon: BarChart3,
    neonColor: "text-pink-400",
    neonGlow: "drop-shadow-[0_0_8px_rgba(244,114,182,0.8)]",
    activeClass: "bg-pink-500/15 text-pink-400 border-l-4 border-pink-400 shadow-[0_0_12px_rgba(244,114,182,0.25)]",
    hoverColor: "hover:text-pink-300",
  },
  {
    href: "/settings",
    label: "Settings",
    icon: SettingsIcon,
    neonColor: "text-slate-200",
    neonGlow: "drop-shadow-[0_0_8px_rgba(226,232,240,0.6)]",
    activeClass: "bg-slate-500/15 text-slate-200 border-l-4 border-slate-300 shadow-[0_0_12px_rgba(226,232,240,0.25)]",
    hoverColor: "hover:text-white",
  },
];

function CandlestickIcon({ color = "#22C55E", className = "h-7 md:h-8 w-3.5 md:w-4 inline-block mx-1.5 align-middle drop-shadow-[0_0_8px_rgba(34,197,94,0.6)]" }: { color?: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 10 24"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Bullish Candlestick"
    >
      <line x1="5" y1="1" x2="5" y2="6" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <rect x="2" y="6" width="6" height="11" rx="0.75" fill={color} stroke={color} strokeWidth="0.75" />
      <line x1="5" y1="17" x2="5" y2="23" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// ── Configurable brand mark ────────────────────────────────────────────────
// Renders the brand name with the bullish green candlestick SVG logo.
function BrandMark({ settings }: { settings?: Settings }) {
  return (
    <Link href="/" className="flex items-center gap-3 min-w-0 cursor-pointer select-none" data-testid="dashboard-brand-logo" aria-label="CHIZZLE WEALTH ENGINE">
      <div className="flex items-center tracking-tight font-black font-mono text-2xl md:text-3xl text-soft-white drop-shadow-sm">
        <span>CH</span>
        <CandlestickIcon color="#22C55E" />
        <span>ZZLE</span>
        <span className="text-[11px] md:text-xs uppercase tracking-[0.22em] font-extrabold ml-3 px-2.5 py-1 rounded-md border border-cyan-400/50 bg-cyan-500/15 text-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.2)]">
          WEALTH ENGINE
        </span>
      </div>
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("chizzle-sidebar-width");
      if (saved) return Math.min(420, Math.max(180, Number(saved)));
    }
    return 260;
  });
  const isDraggingRef = useRef(false);
  const [location] = useLocation();
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const next = Math.min(420, Math.max(180, e.clientX));
      setSidebarWidth(next);
      localStorage.setItem("chizzle-sidebar-width", String(next));
    };
    const onMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const { data: settings } = useQuery<Settings>({ queryKey: ["/api/settings"] });
  // User-customized sidebar labels: JSON blob mapping href -> label. Bad JSON
  // silently falls back so a corrupted setting can't blank the whole nav.
  const navLabelOverrides: Record<string, string> = (() => {
    try { return JSON.parse(settings?.sidebarLabels || "{}"); } catch { return {}; }
  })();
  const labelFor = (href: string, fallback: string) => navLabelOverrides[href]?.trim() || fallback;
  const { data: scores } = useQuery<ChizzleScore[]>({ queryKey: ["/api/chizzle-scores"] });
  const { data: regimePayload } = useQuery<RegimePayload>({
    queryKey: ["/api/regime"],
    // Low-Credit Mode: manual refresh only — no polling.
  });
  const { state: feedState, lastEventAt, source: feedSource } = useFeedConnection();
  const session = marketSession(now);
  const ageSec = lastEventAt ? Math.round((now.getTime() - lastEventAt) / 1000) : null;
  const todayScore = scores?.[0]?.total ?? 0;
  const last7 = (scores || []).slice(0, 7);
  const rolling7 = last7.length ? Math.round(last7.reduce((s, x) => s + x.total, 0) / last7.length) : 0;
  const istate = identityFn(rolling7);

  const marketStore = useMarketDataStore();
  const cardTypo = useCardTypography();
  const [healthOpen, setHealthOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const {
    appBg,
    setAppBg,
    cardTheme,
    setCardTheme,
    fontFamily,
    setFontFamily,
    textScale,
    setTextScale,
    engineBg,
    setEngineBg,
  } = useTerminalTheme();

  const equity = settings?.equity ?? 1000;
  const ytdPct = ((equity - 1000) / 1000) * 100;
  const storeMacro = marketStore.macroRegime;
  const effectiveCode =
    storeMacro === "STAND_DOWN"
      ? "red"
      : storeMacro === "GO"
      ? "green"
      : storeMacro === "SELECTIVE"
      ? "yellow"
      : regimePayload?.effective?.code ?? (settings?.regime?.toLowerCase() as "green" | "yellow" | "red" | undefined) ?? "yellow";
  const regime = (effectiveCode.toUpperCase() as "GREEN" | "YELLOW" | "RED");
  const regimeSource = regimePayload?.effective?.source ?? "AUTO";
  const regimeStale = regimePayload?.state?.stale ?? false;

  const regimeColor =
    regime === "GREEN" ? "text-signal-green border-signal-green/40 bg-signal-green/10"
    : regime === "YELLOW" ? "text-signal-amber border-signal-amber/40 bg-signal-amber/10"
    : "text-signal-red border-signal-red/40 bg-signal-red/10";

  const sessionLabel =
    session === "PRE" ? "PRE" : session === "OPEN" ? "OPEN"
    : session === "MIDDAY" ? "MIDDAY" : session === "CLOSE" ? "CLOSE"
    : session === "POST" ? "POST" : "MARKET CLOSED";

  const global = useOptionalGlobalState();
  const isPractice = Boolean(global?.isPracticeMode);

  const macroBadgeLabel =
    storeMacro === "GO"
      ? "RISK-ON"
      : storeMacro === "STAND_DOWN"
      ? "STAND-DOWN"
      : "SELECTIVE";

  const isMarketOpenNow = isMarketOpen(now);
  const latestEngineTickTs = Math.max(marketStore.lastTickTimestamp || 0, marketStore.backendLastTickTs || 0);
  const engineFreshWithin15s = latestEngineTickTs > 0 && now.getTime() - latestEngineTickTs <= 15_000;
  const disconnectedMs =
    marketStore.disconnectedSinceMs != null ? now.getTime() - marketStore.disconnectedSinceMs : 0;
  // Anti-Flicker Telemetry Lock: locked to LIVE ENGINE if backend/worker tick within 15s during market hours
  const isReconnectingOver8s = isMarketOpenNow && !engineFreshWithin15s && disconnectedMs > 8_000;
  const isLiveWs = isMarketOpenNow && !isReconnectingOver8s;
  const unifiedFeed = getUnifiedFeedStatus(marketStore, now);

  const handleManualSync = () => {
    void queryClient.invalidateQueries({ queryKey: ["/api/swing/scan"] });
    void MarketDataEngine.recoverMissedTicks();
  };

  return (
    <div
      className="min-h-screen bg-[#06080D] text-slate-100 flex flex-col"
      data-testid="app-shell-root"
    >
      {/* Enlarged Consolidated h-14 Command Header */}
      <header className="h-14 px-5 bg-[#060913] border-b border-slate-800 sticky top-0 z-30 flex items-center justify-between gap-4">
        {/* Left: Brand Title & Navigation Pills */}
        <div className="flex items-center gap-4 min-w-0">
          <Link
            href="/"
            className="flex items-center gap-2 text-lg font-black tracking-wide text-white shrink-0 cursor-pointer"
            data-testid="dashboard-brand-logo"
          >
            <CandlestickIcon color="#00F5A0" className="h-5 w-3 inline-block" />
            <span className="hidden sm:inline">CHIZZLE</span>
          </Link>

          <nav className="flex items-center gap-1.5 overflow-x-auto" data-testid="header-essential-nav">
            {[
              { href: "/", match: (l: string) => l === "/" || l === "/cockpit" || l === "/pipeline", label: "COCKPIT", testId: "nav-header-dashboard" },
              { href: "/engine", match: (l: string) => l === "/engine" || l === "/dashboard", label: "WEALTH STUDIO", testId: "nav-header-wealth-studio" },
              { href: "/watchlist", match: (l: string) => l === "/watchlist", label: "WATCHLIST", testId: "nav-header-live-scanner" },
              { href: "/trades", match: (l: string) => l === "/trades", label: "TRADES", testId: "nav-header-trades" },
              { href: "/journal", match: (l: string) => l === "/journal", label: "JOURNAL", testId: "nav-header-journal" },
            ].map((tab) => {
              const active = tab.match(location);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  data-testid={tab.testId}
                  className={`text-sm font-semibold tracking-wide px-3.5 py-1.5 rounded-lg whitespace-nowrap transition-colors cursor-pointer ${
                    active
                      ? "bg-cyan-500/15 text-cyan-300 border border-cyan-500/40"
                      : "text-slate-300 hover:text-white hover:bg-slate-800/60 border border-transparent"
                  }`}
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Center: Fixed-Width Anti-Flicker Telemetry Pill + Quick Sync */}
        <div
          className="hidden lg:flex items-center justify-center min-w-[230px] gap-2.5 text-sm font-mono font-semibold px-4 py-1.5 rounded-full bg-slate-900 border border-slate-700 tabular-nums shrink-0"
          data-testid="badge-feed-status"
        >
          {isReconnectingOver8s ? (
            <span className="text-amber-300">🟡 RECONNECTING...</span>
          ) : (
            <>
              <span className={unifiedFeed.textClass}>{unifiedFeed.label}</span>
              {unifiedFeed.mode === "LIVE" && (
                <>
                  <span className="text-slate-600">|</span>
                  <span className="text-cyan-300">{marketStore.latencyMs || 18}ms</span>
                </>
              )}
            </>
          )}
          <span className="text-slate-600">|</span>
          <span className="text-slate-300">{chicagoClock(now)} CT</span>
          <button
            type="button"
            onClick={handleManualSync}
            title="Sync Live Quotes & Bars Now"
            data-testid="button-header-quick-sync"
            className="ml-1 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs font-bold cursor-pointer transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${marketStore.isSyncing ? "animate-spin" : ""}`} />
            <span>Sync</span>
          </button>
        </div>

        {/* Right: Equity, Daily P&L, Regime, Practice Mode, & [ 🎨 Appearance ] Popover */}
        <div className="flex items-center gap-3 shrink-0 relative">
          <div className="hidden md:flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-sm font-bold text-white">${equity.toFixed(2)}</span>
            <span className={`text-xs font-bold ${ytdPct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {ytdPct >= 0 ? "+" : ""}{ytdPct.toFixed(2)}%
            </span>
          </div>

          <div
            data-testid="text-regime-effective"
            className={`hidden sm:flex items-center gap-1.5 text-xs font-mono font-bold px-2.5 py-1 rounded-lg border ${regimeColor} uppercase`}
          >
            <span className="inline-block w-2 h-2 rounded-full bg-current" />
            <span>{macroBadgeLabel}</span>
          </div>

          <button
            type="button"
            onClick={() => global?.setIsPracticeMode && global.setIsPracticeMode(!global.isPracticeMode)}
            data-testid="button-toggle-practice-mode"
            className={`flex items-center gap-1.5 text-xs font-mono font-bold px-2.5 py-1 rounded-lg border uppercase cursor-pointer transition-colors ${
              isPractice
                ? "border-amber-400 bg-amber-500/20 text-amber-300"
                : "border-slate-700 bg-slate-900 text-slate-300 hover:text-white"
            }`}
          >
            <Beaker className="h-3.5 w-3.5 text-amber-400" />
            <span>[ 🧪 PRACTICE ]</span>
          </button>

          {/* [ 🎨 Appearance ] Popover Drawer */}
          <button
            type="button"
            onClick={() => setAppearanceOpen((prev) => !prev)}
            data-testid="button-header-appearance"
            className={`flex items-center gap-1.5 text-xs font-mono font-bold px-2.5 py-1 rounded-lg border cursor-pointer transition-colors ${
              appearanceOpen
                ? "border-cyan-400 bg-cyan-500/15 text-cyan-300"
                : "border-slate-700 bg-slate-900 text-slate-300 hover:text-white"
            }`}
          >
            <Palette className="h-3.5 w-3.5 text-cyan-400" />
            <span className="hidden xl:inline">[ 🎨 Appearance ]</span>
          </button>

          {appearanceOpen && (
            <div
              className="absolute right-0 top-12 z-50 w-72 rounded-xl border border-slate-700 bg-[#0B0F17] p-4 shadow-2xl flex flex-col gap-3 font-mono text-xs"
              data-testid="popover-appearance-drawer"
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="font-bold text-white uppercase tracking-wider">🎨 Terminal Appearance</span>
                <button
                  type="button"
                  onClick={() => setAppearanceOpen(false)}
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-slate-400 uppercase">Theme</span>
                <select
                  value={appBg}
                  onChange={(e) => setAppBg(e.target.value as AppBgId)}
                  className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 outline-none"
                >
                  {APP_BACKGROUNDS.map((bg) => (
                    <option key={bg.id} value={bg.id}>{bg.label}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-slate-400 uppercase">Card Style</span>
                <select
                  value={cardTheme}
                  onChange={(e) => setCardTheme(e.target.value as CardSurfaceId)}
                  className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 outline-none"
                >
                  {CARD_SURFACES.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-slate-400 uppercase">Engine</span>
                <select
                  value={engineBg}
                  onChange={(e) => setEngineBg(e.target.value as EngineBgOption)}
                  className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 outline-none"
                >
                  <option value="contrast-dark">Contrast Dark</option>
                  <option value="inherit">Match App</option>
                  <option value="ice-blue-pro">Ice Blue Pro</option>
                  <option value="bloomberg-classic">Bloomberg</option>
                  <option value="emerald-core">Emerald Core</option>
                  <option value="ultraviolet">Ultraviolet</option>
                </select>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-slate-400 uppercase">Font</span>
                  <select
                    value={fontFamily}
                    onChange={(e) => setFontFamily(e.target.value as FontFamilyOption)}
                    className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-slate-200 outline-none"
                  >
                    <option value="Inter">Inter</option>
                    <option value="Roboto">Roboto</option>
                    <option value="Arial">Arial</option>
                    <option value="Segoe UI">Segoe UI</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-slate-400 uppercase">Scale</span>
                  <select
                    value={textScale}
                    onChange={(e) => setTextScale(e.target.value as TextScaleOption)}
                    className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-slate-200 outline-none"
                  >
                    <option value="compact">Compact</option>
                    <option value="default">Default</option>
                    <option value="large">Large</option>
                  </select>
                </label>
              </div>

              <div className="border-t border-slate-800 pt-2.5 flex flex-col gap-2">
                <span className="text-[10px] text-cyan-300 font-bold uppercase tracking-wider">Card Typography</span>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-slate-400 uppercase">Card Font Size</span>
                  <select
                    value={cardTypo.size}
                    onChange={(e) => updateCardTypography({ size: e.target.value as CardFontSize })}
                    data-testid="select-card-font-size"
                    className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-slate-200 outline-none"
                  >
                    <option value="compact">Compact</option>
                    <option value="standard">Standard</option>
                    <option value="large">Large</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-slate-400 uppercase">Card Font Family</span>
                  <select
                    value={cardTypo.family}
                    onChange={(e) => updateCardTypography({ family: e.target.value as CardFontFamily })}
                    data-testid="select-card-font-family"
                    className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-slate-200 outline-none"
                  >
                    <option value="jetbrains">JetBrains / Tabular Mono</option>
                    <option value="geometric">Clean Geometric Sans</option>
                    <option value="bloomberg">Bloomberg Terminal</option>
                  </select>
                </label>
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 flex min-w-0 max-w-full overflow-hidden">
        {/* Sidebar (with adjustable drag-handle) */}
        <aside
          style={{ width: collapsed ? 56 : sidebarWidth }}
          className="hidden md:flex flex-col relative border-r border-slate-800 bg-slate-900/90 flex-shrink-0 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto select-none"
        >
          {/* Top Collapse Toggle Icon */}
          <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between flex-shrink-0 bg-black/20">
            {!collapsed && (
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-bold">
                NAVIGATION
              </span>
            )}
            <button
              onClick={() => setCollapsed(c => !c)}
              data-testid="button-top-collapse-sidebar"
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className={`p-1 rounded text-cyan-300 hover:text-white hover:bg-slate-800 transition-colors flex items-center gap-1 font-mono text-[10px] font-bold ${
                collapsed ? "w-full justify-center" : ""
              }`}
            >
              {collapsed ? (
                <ChevronRight className="w-4 h-4 text-cyan-400" />
              ) : (
                <>
                  <ChevronLeft className="w-4 h-4 text-cyan-400" />
                  <span>{"[ < Collapse ]"}</span>
                </>
              )}
            </button>
          </div>
          <nav className="flex-1 py-5 px-3 space-y-1.5">
            {NAV.map(item => {
              const active = location === item.href || (item.href !== "/" && location.startsWith(item.href));
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  data-testid={`link-${item.label.toLowerCase().replace(/\s/g, "-")}`}
                  className={`flex items-center gap-3.5 px-3 py-2.5 rounded-lg text-lg font-display tracking-wide uppercase transition-all duration-150 cursor-pointer select-none group
                    ${active
                      ? `${item.activeClass} pl-2.5 font-bold`
                      : `text-slate-400 ${item.hoverColor} hover:bg-slate-800/60 font-medium`}`}
                >
                  <Icon
                    className={`w-5 h-5 flex-shrink-0 transition-transform ${
                      active
                        ? `${item.neonColor} ${item.neonGlow} scale-105`
                        : `text-slate-400 group-hover:${item.neonColor} group-hover:scale-105`
                    }`}
                    strokeWidth={active ? 2.5 : 2}
                  />
                  {!collapsed && (
                    <span
                      className={`text-lg font-display truncate transition-colors ${
                        active
                          ? `${item.neonColor} ${item.neonGlow}`
                          : `text-slate-300 group-hover:${item.neonColor}`
                      }`}
                    >
                      {labelFor(item.href, item.label)}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Drag Handle to manually widen/narrow sidebar */}
          {!collapsed && (
            <div
              onMouseDown={startDrag}
              className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-cyan-500/50 active:bg-cyan-400 transition-colors z-20 group flex items-center justify-center"
              title="Drag to resize sidebar width"
              data-testid="sidebar-resize-handle"
            >
              <div className="w-0.5 h-10 bg-slate-700 group-hover:bg-cyan-400 rounded-full transition-colors" />
            </div>
          )}

          <button
            onClick={() => setCollapsed(c => !c)}
            data-testid="button-collapse-sidebar"
            className="border-t border-slate-800 py-3 px-4 flex items-center gap-2 text-slate-400 hover:text-soft-white text-xs font-mono tracking-wider uppercase"
          >
            {collapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
            {!collapsed && <span>collapse sidebar</span>}
          </button>
        </aside>

        {/* Mobile bottom nav */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 grid grid-cols-7 border-t border-slate-800 bg-slate-900">
          {NAV.map(item => {
            const active = location === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center justify-center py-2 text-[9px] uppercase tracking-wider cursor-pointer ${
                  active ? `${item.neonColor} ${item.neonGlow} font-bold` : "text-slate-gray"
                }`}
              >
                <Icon className="w-4 h-4" strokeWidth={1.5} />
              </Link>
            );
          })}
        </nav>

        <main
          className={`flex-1 min-w-0 w-full max-w-full overflow-x-hidden ${
            location === "/engine" || location === "/dashboard"
              ? "p-0 h-[calc(100vh-3.5rem)] overflow-hidden"
              : "min-h-screen p-6 pb-16 md:pb-8"
          }`}
        >
          {children}
        </main>
      </div>

      {/* Sleek Dark-Themed Global Footer for Secondary Tools */}
      <footer
        className="w-full border-t border-slate-800/80 bg-slate-950/95 py-3 px-4 md:px-6 flex flex-wrap items-center justify-between text-xs text-slate-400 gap-3 mt-auto backdrop-blur-md select-none transition-colors duration-200"
        data-testid="global-footer"
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
            <span className="font-mono text-[11px] font-bold text-slate-300 uppercase tracking-wider">
              Chizzle Terminal
            </span>
          </div>
          <span className="text-slate-600 hidden sm:inline">|</span>
          <span className="font-mono text-[10px] text-slate-500 hidden sm:inline">
            Execution Engine v2.4
          </span>
        </div>

        {/* Secondary Navigation Tools */}
        <div className="flex items-center gap-1 sm:gap-2 flex-wrap font-mono text-xs">
          <Link
            href="/settings"
            className="flex items-center gap-1 px-2.5 py-1 rounded text-slate-400 hover:text-cyan-400 hover:bg-slate-900 border border-transparent hover:border-slate-800 transition-all duration-200 cursor-pointer"
            data-testid="footer-link-api-connections"
          >
            <span>API Connections</span>
          </Link>

          <span className="text-slate-700">·</span>

          <Link
            href="/settings"
            className="flex items-center gap-1 px-2.5 py-1 rounded text-slate-400 hover:text-cyan-400 hover:bg-slate-900 border border-transparent hover:border-slate-800 transition-all duration-200 cursor-pointer"
            data-testid="footer-link-broker-settings"
          >
            <span>Broker Settings</span>
          </Link>

          <span className="text-slate-700">·</span>

          <Link
            href="/journal"
            className="flex items-center gap-1 px-2.5 py-1 rounded text-slate-400 hover:text-amber-400 hover:bg-slate-900 border border-transparent hover:border-slate-800 transition-all duration-200 cursor-pointer"
            data-testid="footer-link-trade-journal"
          >
            <span>Trade Journal/History</span>
          </Link>

          <span className="text-slate-700">·</span>

          <Link
            href="/settings"
            className="flex items-center gap-1 px-2.5 py-1 rounded text-slate-400 hover:text-fuchsia-400 hover:bg-slate-900 border border-transparent hover:border-slate-800 transition-all duration-200 cursor-pointer"
            data-testid="footer-link-account-management"
          >
            <span>Account Management</span>
          </Link>

          <span className="text-slate-700">·</span>

          <Link
            href="/signals"
            className="flex items-center gap-1 px-2.5 py-1 rounded text-slate-400 hover:text-emerald-400 hover:bg-slate-900 border border-transparent hover:border-slate-800 transition-all duration-200 cursor-pointer"
            data-testid="footer-link-system-logs"
          >
            <span>System Logs</span>
          </Link>
        </div>

        <div className="flex items-center gap-3 text-[10px] font-mono text-slate-500">
          <button
            type="button"
            onClick={() => setHealthOpen(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-cyan-300 font-bold uppercase tracking-wider cursor-pointer transition-colors"
            data-testid="button-system-health"
          >
            <span>🩺 System Health</span>
          </button>
          <span className="hidden sm:inline">Simulation Mode</span>
          <span className="hidden sm:inline text-slate-700">·</span>
          <span className="hidden sm:inline">Zero Live Capital at Risk</span>
        </div>
      </footer>

      {/* System Health Diagnostic Modal */}
      {healthOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setHealthOpen(false)}
          data-testid="modal-system-health"
        >
          <div
            className="w-full max-w-md rounded-2xl bg-[#0B101D] border border-slate-700 shadow-2xl p-5 font-mono text-white flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="System Health Diagnostics"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-black uppercase tracking-wider">🩺 System Health</h3>
              </div>
              <button
                type="button"
                onClick={() => setHealthOpen(false)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                aria-label="Close System Health Modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800">
                <div className="text-[10px] text-slate-400 uppercase">Active Feed</div>
                <div className="text-sm font-bold text-cyan-300 mt-0.5">{marketStore.activeFeed}</div>
              </div>
              <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800">
                <div className="text-[10px] text-slate-400 uppercase">Last Tick</div>
                <div className="text-sm font-bold text-white mt-0.5 tabular-nums">
                  {marketStore.lastTickTimestamp > 0
                    ? new Date(marketStore.lastTickTimestamp).toLocaleTimeString("en-US", { hour12: false })
                    : "Awaiting Tick"}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800">
                <div className="text-[10px] text-slate-400 uppercase">Reconnect Count</div>
                <div className="text-sm font-bold text-amber-300 mt-0.5 tabular-nums">{marketStore.reconnectCount}</div>
              </div>
              <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800">
                <div className="text-[10px] text-slate-400 uppercase">Schema Version</div>
                <div className="text-sm font-bold text-emerald-400 mt-0.5">
                  {(typeof window !== "undefined" && localStorage.getItem(CACHE_VERSION_KEY)) || APP_SCHEMA_VERSION}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-800">
              <span className="text-[11px] text-slate-400">
                Regime: <strong className="text-white">{marketStore.macroRegime}</strong>
              </span>
              <button
                type="button"
                onClick={() => {
                  try {
                    localStorage.clear();
                    sessionStorage.clear();
                  } catch {}
                  window.location.reload();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/50 text-rose-300 text-xs font-bold uppercase tracking-wider cursor-pointer transition-colors"
                data-testid="button-reset-local-cache"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>[ Reset Local Cache ]</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FeedBadge({
  state,
  ageSec,
  source = "FINNHUB",
  marketOpen,
}: {
  state: "CONNECTING" | "LIVE" | "STALE" | "DISCONNECTED" | "STATIC";
  ageSec: number | null;
  source?: string;
  marketOpen?: boolean;
}) {
  const isBackup = source && source !== "FINNHUB";
  const isOpen = marketOpen !== undefined ? marketOpen : isMarketOpen();
  const providerLabel =
    source === "POLYGON" ? "Polygon (Backup)"
    : source === "TWELVEDATA" ? "TwelveData (Backup)"
    : source === "NASDAQ" ? "Nasdaq (Backup)"
    : source === "YAHOO" ? "Yahoo (Backup)"
    : source === "SIMULATOR" ? "Sim (Backup)"
    : isBackup ? `${source} (Backup)`
    : "Finnhub";

  const label =
    !isOpen || state === "STATIC"
      ? "STATIC: LAST CLOSE"
      : state === "LIVE"
      ? (isBackup ? `🟡 LIVE: ${providerLabel}` : "🟢 LIVE: Finnhub")
      : state === "STALE" ? `STALE: ${providerLabel}`
      : state === "CONNECTING" ? "CONNECTING"
      : "DISCONNECTED";

  const tone =
    !isOpen || state === "STATIC"
      ? "text-slate-300 border-slate-700/60 bg-slate-900/80 shadow-[0_0_8px_rgba(148,163,184,0.15)]"
      : state === "LIVE"
      ? (isBackup ? "text-amber-300 border-amber-400/50 bg-amber-950/40 shadow-[0_0_10px_rgba(245,158,11,0.2)]" : "text-emerald-300 border-emerald-400/40 bg-emerald-950/40 shadow-[0_0_10px_rgba(52,211,153,0.15)]")
      : state === "STALE" ? "text-signal-amber border-signal-amber/40 bg-signal-amber/10"
      : state === "CONNECTING" ? "text-slate-gray border-slate-800 bg-slate-900/60"
      : "text-signal-red border-signal-red/40 bg-signal-red/10";

  const dotAnim = isOpen && state === "LIVE" ? "heartbeat" : isOpen && state === "CONNECTING" ? "animate-pulse" : "";
  return (
    <div
      data-testid="badge-feed-status"
      className={`hidden sm:flex items-center gap-2 px-2.5 py-1 border ${tone} text-[10px] font-mono font-bold tracking-wider uppercase rounded-full`}
      title={
        !isOpen
          ? "Market closed (outside regular trading hours) — displaying Last Official Close"
          : ageSec != null
          ? `Last tick ${ageSec}s ago via ${source}`
          : "Awaiting first tick"
      }
    >
      <span className={`inline-block w-2 h-2 rounded-full bg-current ${dotAnim}`} />
      <span>{label}</span>
      {isOpen && ageSec != null && ageSec >= 0 && (
        <span className="font-mono-num tabular-nums text-slate-400 font-normal">{ageSec}s</span>
      )}
    </div>
  );
}
