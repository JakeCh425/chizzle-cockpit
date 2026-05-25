import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Logo } from "./Logo";
import { useQuery } from "@tanstack/react-query";
import type { Settings, ChizzleScore, Ticker, RegimeState, RegimeInputsRow } from "@shared/schema";
import { chicagoClock, marketSession, useFeedConnection } from "@/lib/priceFeed";
import { regimeLabel, identityState as identityFn } from "@/lib/engine";
import {
  Gauge, ListChecks, History, BookText, Layers,
  BarChart3, Settings as SettingsIcon, ChevronLeft, ChevronRight,
  FileText,
} from "lucide-react";

interface RegimePayload {
  state: RegimeState;
  latestInputs: RegimeInputsRow | null;
  effective: { code: "green" | "yellow" | "red"; source: "AUTO" | "MANUAL" };
}

const NAV = [
  { href: "/", label: "Cockpit", icon: Gauge },
  { href: "/watchlist", label: "Watchlist", icon: ListChecks },
  { href: "/trades", label: "Trades", icon: History },
  { href: "/journal", label: "Journal", icon: BookText },
  { href: "/leap", label: "LEAP Ladder", icon: Layers },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/spec", label: "Spec Review", icon: FileText },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [location] = useLocation();
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const { data: settings } = useQuery<Settings>({ queryKey: ["/api/settings"] });
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
  const effectiveCode = regimePayload?.effective?.code ?? (settings?.regime?.toLowerCase() as any) ?? "yellow";
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
    <div className="min-h-screen bg-ink-black text-soft-white flex flex-col">
      {/* Header strip */}
      <header className="border-b border-ink-line bg-ink-panel/60 backdrop-blur sticky top-0 z-30">
        <div className="px-4 md:px-6 h-14 flex items-center gap-4">
          <div className="flex items-center gap-2 md:gap-3 text-neon-blue">
            <Logo size={26} />
            <span className="font-display font-semibold tracking-tight text-[15px] md:text-[16px] text-soft-white">
              CHIZZLE <span className="text-neon-blue">WEALTH ENGINE</span>
            </span>
          </div>

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

          <div className="ml-auto flex items-center gap-5 md:gap-7">
            <div className="hidden md:flex flex-col items-end leading-tight">
              <div className="text-[9px] uppercase tracking-[0.18em] text-slate-gray">Equity</div>
              <div className="font-mono-num text-[14px] text-soft-white tabular-nums leading-tight">
                ${equity.toFixed(2)}
                <span className={`ml-2 text-[10px] tabular-nums ${ytdPct >= 0 ? "text-signal-green" : "text-signal-red"}`}>
                  {ytdPct >= 0 ? "+" : ""}{ytdPct.toFixed(2)}% YTD
                </span>
              </div>
            </div>
            <div className="hidden lg:flex flex-col items-end leading-tight border-l border-ink-line/40 pl-5">
              <div className="text-[9px] uppercase tracking-[0.18em] text-slate-gray">Chizzle</div>
              <div className="flex items-baseline gap-2 leading-tight">
                <span className={`font-mono-num text-[14px] tabular-nums ${rolling7 >= 90 ? "text-gold-lux" : "text-soft-white"}`}>
                  {todayScore} <span className="text-slate-gray/70">/</span> {rolling7}
                </span>
                <span className="text-[9px] uppercase tracking-wider text-slate-gray">{istate.replace("_", "-")}</span>
              </div>
            </div>
            <div className="flex flex-col items-end leading-tight border-l border-ink-line/40 pl-5">
              <div className="text-[9px] uppercase tracking-[0.18em] text-slate-gray">{sessionLabel}</div>
              <div className="font-mono-num text-[12px] tabular-nums leading-tight">
                {chicagoClock(now)} <span className="text-slate-gray/70">CT</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 flex">
        {/* Sidebar */}
        <aside className={`hidden md:flex flex-col ${collapsed ? "w-14" : "w-52"} border-r border-ink-line bg-ink-panel/40 transition-all duration-200`}>
          <nav className="flex-1 py-4 px-2 space-y-1">
            {NAV.map(item => {
              const active = location === item.href || (item.href !== "/" && location.startsWith(item.href));
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  data-testid={`link-${item.label.toLowerCase().replace(/\s/g, "-")}`}
                  className={`flex items-center gap-3 px-2.5 py-2 rounded-sm text-[13px] font-display tracking-wide uppercase transition-colors cursor-pointer
                    ${active
                      ? "bg-neon-blue/10 text-neon-blue border-l-2 border-neon-blue pl-2"
                      : "text-slate-gray hover:text-soft-white hover:bg-ink-line/50"}`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" strokeWidth={1.5} />
                  {!collapsed && <span>{item.label}</span>}
                </Link>
              );
            })}
          </nav>
          <button
            onClick={() => setCollapsed(c => !c)}
            data-testid="button-collapse-sidebar"
            className="border-t border-ink-line py-2 px-3 flex items-center gap-2 text-slate-gray hover:text-soft-white text-[11px] font-mono"
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            {!collapsed && <span>collapse</span>}
          </button>
        </aside>

        {/* Mobile bottom nav */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 grid grid-cols-7 border-t border-ink-line bg-ink-panel">
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

        <main className="flex-1 min-w-0 pb-16 md:pb-0">{children}</main>
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
    : state === "CONNECTING" ? "text-slate-gray border-ink-line bg-ink-line/20"
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
