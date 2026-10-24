import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { useQuery } from "@tanstack/react-query";
import type { Settings, ChizzleScore, RegimeState, RegimeInputsRow } from "@shared/schema";
import { chicagoClock, marketSession, useFeedConnection } from "@/lib/priceFeed";
import { regimeLabel, identityState as identityFn } from "@/lib/engine";
import {
  Gauge, LayoutDashboard, ListChecks, History, BookText, Layers,
  BarChart3, Settings as SettingsIcon, ChevronLeft, ChevronRight,
  FileText, Activity, ClipboardList,
} from "lucide-react";

interface RegimePayload {
  state: RegimeState;
  latestInputs: RegimeInputsRow | null;
  effective: { code: "green" | "yellow" | "red"; source: "AUTO" | "MANUAL" };
}

const NAV = [
  { href: "/", label: "Cockpit", icon: Gauge },
  { href: "/engine", label: "Wealth Studio", icon: LayoutDashboard },
  { href: "/watchlist", label: "Watchlist", icon: ListChecks },
  { href: "/trades", label: "Trades", icon: History },
  { href: "/trade-planner", label: "Trade Planner", icon: ClipboardList },
  { href: "/journal", label: "Journal", icon: BookText },
  { href: "/leap", label: "LEAP Ladder", icon: Layers },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
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
  const { state: feedState, lastEventAt } = useFeedConnection();
  const session = marketSession(now);
  const ageSec = lastEventAt ? Math.round((now.getTime() - lastEventAt) / 1000) : null;
  const todayScore = scores?.[0]?.total ?? 0;
  const last7 = (scores || []).slice(0, 7);
  const rolling7 = last7.length ? Math.round(last7.reduce((s, x) => s + x.total, 0) / last7.length) : 0;
  const istate = identityFn(rolling7);

  const equity = settings?.equity ?? 1000;
  const ytdPct = ((equity - 1000) / 1000) * 100;
  const effectiveCode = regimePayload?.effective?.code ?? (settings?.regime?.toLowerCase() as "green" | "yellow" | "red" | undefined) ?? "yellow";
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

  return (
    <div className="min-h-screen bg-slate-950 text-soft-white flex flex-col" data-testid="app-shell-root">
      {/* Header strip */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-30">
        <div className="px-4 md:px-6 h-14 flex items-center gap-4">
          <BrandMark settings={settings} />

          <div
            data-testid="text-regime-effective"
            className={`hidden md:flex items-center gap-2 px-2.5 py-1 border ${regimeColor} text-[11px] font-display tracking-wider uppercase rounded-sm`}
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-current heartbeat" />
            {regimeLabel(regime)}
          </div>
          <span
            data-testid="pill-regime-source"
            className={`hidden md:inline-flex items-center px-1.5 py-0.5 border text-[9px] tracking-widest uppercase font-display rounded-sm ${
              regimeSource === "MANUAL"
                ? "border-signal-amber/40 bg-signal-amber/10 text-signal-amber"
                : "border-neon-blue/40 bg-neon-blue/10 text-neon-blue"
            }`}
            title={regimeSource === "MANUAL" ? "Manual override active" : "Auto-classified from live market data"}
          >
            {regimeSource}
          </span>
          {regimeStale && (
            <span
              className="hidden md:inline-flex items-center px-1.5 py-0.5 border border-signal-amber/40 bg-signal-amber/10 text-signal-amber text-[9px] tracking-widest uppercase font-display rounded-sm"
              title="Last regime classification failed — showing cached values"
            >
              STALE
            </span>
          )}

          <FeedBadge state={feedState} ageSec={ageSec} />

          <div className="ml-auto flex items-center gap-3 md:gap-5">
            <ThemeSwitcher />
            <div className="hidden md:flex flex-col items-end leading-tight">
              <div className="text-[9px] uppercase tracking-[0.18em] text-slate-gray">Equity</div>
              <div className="font-mono-num text-[14px] text-soft-white tabular-nums leading-tight">
                ${equity.toFixed(2)}
                <span className={`ml-2 text-[10px] tabular-nums ${ytdPct >= 0 ? "text-signal-green" : "text-signal-red"}`}>
                  {ytdPct >= 0 ? "+" : ""}{ytdPct.toFixed(2)}% YTD
                </span>
              </div>
            </div>
            <div className="hidden lg:flex flex-col items-end leading-tight border-l border-slate-800 pl-5">
              <div className="text-[9px] uppercase tracking-[0.18em] text-slate-gray">Chizzle</div>
              <div className="flex items-baseline gap-2 leading-tight">
                <span className={`font-mono-num text-[14px] tabular-nums ${rolling7 >= 90 ? "text-gold-lux" : "text-soft-white"}`}>
                  {todayScore} <span className="text-slate-gray/70">/</span> {rolling7}
                </span>
                <span className="text-[9px] uppercase tracking-wider text-slate-gray">{istate.replace("_", "-")}</span>
              </div>
            </div>
            <div className="flex flex-col items-end leading-tight border-l border-slate-800 pl-5">
              <div className="text-[9px] uppercase tracking-[0.18em] text-slate-gray">{sessionLabel}</div>
              <div className="font-mono-num text-[12px] tabular-nums leading-tight">
                {chicagoClock(now)} <span className="text-slate-gray/70">CT</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 flex min-w-0">
        {/* Sidebar (with adjustable drag-handle) */}
        <aside
          style={{ width: collapsed ? 56 : sidebarWidth }}
          className="hidden md:flex flex-col relative border-r border-slate-800 bg-slate-900/90 flex-shrink-0 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto select-none"
        >
          <nav className="flex-1 py-5 px-3 space-y-1.5">
            {NAV.map(item => {
              const active = location === item.href || (item.href !== "/" && location.startsWith(item.href));
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  data-testid={`link-${item.label.toLowerCase().replace(/\s/g, "-")}`}
                  className={`flex items-center gap-3.5 px-3 py-2.5 rounded-lg text-lg font-display tracking-wide uppercase transition-colors cursor-pointer
                    ${active
                      ? "bg-neon-blue/15 text-neon-blue border-l-4 border-neon-blue pl-2.5 font-bold shadow-sm"
                      : "text-slate-400 hover:text-soft-white hover:bg-slate-800/60 font-medium"}`}
                >
                  <Icon className="w-5 h-5 flex-shrink-0" strokeWidth={2} />
                  {!collapsed && <span className="text-lg font-display truncate">{labelFor(item.href, item.label)}</span>}
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
                className={`flex flex-col items-center justify-center py-2 text-[9px] uppercase tracking-wider cursor-pointer ${active ? "text-neon-blue" : "text-slate-gray"}`}
              >
                <Icon className="w-4 h-4" strokeWidth={1.5} />
              </Link>
            );
          })}
        </nav>

        <main className="flex-1 min-w-0 w-full overflow-y-auto p-4 sm:p-6 pb-16 md:pb-8">{children}</main>
      </div>
    </div>
  );
}

function FeedBadge({ state, ageSec }: { state: "CONNECTING" | "LIVE" | "STALE" | "DISCONNECTED"; ageSec: number | null }) {
  const label =
    state === "LIVE" ? "LIVE • FINNHUB"
    : state === "STALE" ? "STALE • FINNHUB"
    : state === "CONNECTING" ? "CONNECTING"
    : "DISCONNECTED";
  const tone =
    state === "LIVE" ? "text-neon-blue border-neon-blue/40 bg-neon-blue/10"
    : state === "STALE" ? "text-signal-amber border-signal-amber/40 bg-signal-amber/10"
    : state === "CONNECTING" ? "text-slate-gray border-slate-800 bg-slate-900/60"
    : "text-signal-red border-signal-red/40 bg-signal-red/10";
  const dotAnim = state === "LIVE" ? "heartbeat" : state === "CONNECTING" ? "animate-pulse" : "";
  return (
    <div
      data-testid="badge-feed-status"
      className={`hidden sm:flex items-center gap-2 px-2 py-1 border ${tone} text-[10px] font-display tracking-widest uppercase rounded-sm`}
      title={ageSec != null ? `Last tick ${ageSec}s ago` : "Awaiting first tick"}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full bg-current ${dotAnim}`} />
      <span>{label}</span>
      {ageSec != null && ageSec >= 0 && (
        <span className="font-mono-num tabular-nums text-slate-gray">{ageSec}s</span>
      )}
    </div>
  );
}
