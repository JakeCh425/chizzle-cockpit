// ─── Action Center (v2 Overhaul) ───────────────────────────────────────────
// Top-of-Cockpit summary of every watchlist symbol.
// PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE.

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BookOpen, Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, ListChecks, MinusCircle, MoreHorizontal, Palette, Pencil, X, Zap } from "lucide-react";
import type { ScanSelection, SwingDecision, SwingSettings } from "@shared/swingDecision";
import { actionGroupOf, setupIdOf } from "@shared/practicePlan";
import { sortForCockpit } from "@shared/readyAlerts";
import { swingGet } from "@/lib/swing";
import { activeVersion, staleVersion, useSelectedPlans } from "@/lib/plans";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { useScan } from "./SwingWorkspace";
import { AlertsPanel } from "./PriceAlerts";
import { PlanRefreshBar, TargetDefaultControl } from "./PlanRefresh";
import { CardStyleSection } from "./CardStyle";
import { AppearanceControls, DisclosureProvider, LiveCtx, InlineTradingCard, Section, TradingCardDialog, acAttrs, isPopulated, useAcPrefs, useDisclosure, useDisclosureAll } from "./TradingCard";
import { LockedTradeCard } from "./LockedCard";
import { PriorityBoard } from "./SetupScore";
import { useAccountSnapshot } from "./FundingPanel";
import { useSwingTrades } from "@/lib/swingTrades";
import { useFreshness } from "@/lib/freshness";
import { COLLAPSE_STORAGE_KEY as COLLAPSE_KEY, splitOlder, STATE_LABEL, STATE_TONE, type CollapsePref } from "@shared/cardFreshness";

const DEFAULT_TITLE = "Action Center";

function EditableTitle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const start = () => { setDraft(value); setEditing(true); };
  const commit = () => { onChange(draft.trim().slice(0, 40) || DEFAULT_TITLE); setEditing(false); };
  
  if (editing) return (
    <div className="flex items-center gap-2">
      <input autoFocus className="w-56 rounded-md border border-neon-blue/50 bg-ink-black px-3 py-1 text-sm font-bold text-soft-white focus:outline-none" maxLength={40} value={draft} aria-label="Action Center title"
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
  
  const sel = plans.data?.selected;
  const acct = useAccountSnapshot();
  const equity = acct.equity;
  const expiryBars = settings.data?.expiryBars4h ?? 2;
  const minRr = settings.data?.minRrT1 ?? null;
  const markSeen = (k: string) => { if (!seen.includes(k)) setSeen([...seen.slice(-199), k]); };
  const dlgDecision: SwingDecision | undefined = dlg ? rows.find((d) => d.symbol === dlg.symbol) : undefined;

  return (
    <LiveCtx.Provider value={scan.data?.livePermission ?? null}>
    <section className="flex flex-col gap-4 rounded-xl border border-ink-line bg-ink-black/60 p-4 shadow-sm" {...acAttrs(prefs)} aria-label={title} data-testid="action-center" data-open={boxOpen}>
      
      {/* ─── HEADER ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-4 border-b border-ink-line/50 pb-4">
        <button className="rounded-md p-1.5 text-slate-gray transition-colors hover:bg-ink-line hover:text-soft-white" onClick={() => setBoxOpen(!boxOpen)} aria-expanded={boxOpen} aria-controls="ac-body" aria-label={`${boxOpen ? "Collapse" : "Expand"} ${title}`} data-testid="button-toggle-action-center">
          {boxOpen ? <ChevronDown className="h-5 w-5" aria-hidden /> : <ChevronRight className="h-5 w-5" aria-hidden />}
        </button>
        
        <EditableTitle value={title} onChange={setTitle} />
        
        <span className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[10px] font-mono font-bold uppercase tracking-wider ${readyCount ? "border-signal-green/40 bg-signal-green/10 text-signal-green" : "border-ink-line bg-ink-deep/40 text-slate-gray"}`} data-testid="text-ac-ready-count" title="Fresh, tradeable practice setups">
          <Zap className="h-3.5 w-3.5" aria-hidden /> {readyCount} fresh
        </span>
        
        {older.length > 0 && <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-signal-amber" data-testid="text-ac-older-count">{older.length} older / not tradeable</span>}
        
        <span className="text-[10px] font-mono font-medium uppercase tracking-wider text-slate-gray" data-testid="text-ac-counts">
          {scan.isLoading ? "Evaluating watchlist…" : scan.data?.pending?.length ? `Evaluating ${scan.data.pending.length} of ${scan.data.scanned}… · ` : ""}
          {scan.isLoading ? "" : `${counts.CONFIRMED ?? 0} confirmed · ${counts.FORMING ?? 0} forming · ${(counts.RETEST ?? 0) + (counts.EXTENDED ?? 0) + (counts.RR_STOP ?? 0)} watch · ${counts.DATA ?? 0} data · ${counts.NO_TRADE ?? 0} no trade`}
        </span>
        
        <span className="text-[10px] font-bold uppercase tracking-wider text-signal-amber">PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE</span>
        
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
                <div className="absolute right-0 top-full z-40 mt-2 w-72 rounded-lg border border-ink-line bg-ink-black p-3 shadow-2xl" role="menu" data-testid="menu-ac-more">
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
        <div id="ac-body" className="flex flex-col gap-4">
          <PlanRefreshBar settings={settings.data} />
          
          {appOpen && <div id="ac-appearance" data-testid="sec-appearance" data-open="true"><AppearanceControls prefs={prefs} set={setPrefs} /></div>}
          {appOpen && <CardStyleSection />}
          
          {scan.data?.emptyReason && (
            <div className="flex items-center gap-2 rounded-md border border-signal-amber/40 bg-signal-amber/10 px-4 py-3 text-xs font-medium text-signal-amber">
              <AlertTriangle className="h-4 w-4" aria-hidden /> {scan.data.emptyReason}
            </div>
          )}

          {!scan.isLoading && !loud.length && !openTrades.length && (
            <div className="rounded-lg border border-dashed border-ink-line bg-ink-deep/20 p-6 text-center text-sm font-medium text-slate-gray" data-testid="text-ac-nothing">
              {older.length ? `No fresh setups right now. ${older.length} older setup${older.length === 1 ? " is" : "s are"} listed under "Older / not tradeable" below — each shows what resets it.` : "Nothing ready, confirmed or forming right now. That is a valid answer: no trade is a position. Next conditions are listed below."}
            </div>
          )}

          {openTrades.length > 0 && (
            <div className="flex flex-col gap-3" data-testid="sec-pinned-trades">
              <div className="flex flex-wrap items-center gap-3 px-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-soft-white">MY TRADES — PINNED</span>
                <span className="text-[10px] font-medium uppercase tracking-wider text-slate-gray">{openTrades.length} locked card{openTrades.length === 1 ? "" : "s"} · levels come from your practice trade, not the scanner</span>
              </div>
              {openTrades.map((t) => { 
                const d = rows.find((x) => x.symbol === t.symbol) ?? null; 
                return <LockedTradeCard key={t.id} trade={t} d={d} ver={d ? activeVersion(d, sel) : null} price={prices?.[t.symbol]?.price ?? null} onOpen={d ? () => setDlg({ symbol: t.symbol, mode: "view" }) : undefined} />; 
              })}
            </div>
          )}

          <PriorityBoard rows={rows} settings={settings.data} onOpen={(sym) => setDlg({ symbol: sym, mode: "view" })} />
          
          <div className="flex flex-col gap-4">
            {loud.map((d) => {
              const ver = activeVersion(d, sel);
              const stale = staleVersion(d, sel);
              const key = setupIdOf(d);
              const populated = isPopulated(d, ver);
              return (
                <div key={d.symbol} className="flex flex-col gap-1.5">
                  <InlineTradingCard d={d} group={actionGroupOf(d)} ver={ver} equity={equity} expiryBars={expiryBars} minRr={minRr} prefs={prefs} setupKey={key} isNew={populated && !seen.includes(key)} onSeen={() => markSeen(key)} onOpen={() => setDlg({ symbol: d.symbol, mode: "view" })} onAdjust={() => { markSeen(key); setDlg({ symbol: d.symbol, mode: "adjust" }); }} />
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
            <div className="flex flex-col rounded-lg border border-dashed border-ink-line bg-ink-deep/20" data-testid="sec-older" data-open={cp.section}>
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

          <div className="grid items-start gap-4 lg:grid-cols-2">
            {quiet.length > 0 && (
              <Section id="quiet" title="Watch / No-trade list" def={false} testId="sec-quiet" summary={`${quiet.length} symbols: ${quiet.map((d) => d.symbol).join(", ")}`}>
                <ul className="flex flex-col gap-2">
                  {quiet.map((d) => (
                    <li key={d.symbol} className="flex flex-wrap items-center gap-3 text-sm" data-testid={`row-ac-quiet-${d.symbol}`}>
                      <MinusCircle className="h-4 w-4 shrink-0 text-slate-gray" aria-hidden />
                      <span className="font-mono font-bold text-soft-white">{d.symbol}</span>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-gray">NO TRADE — NEXT CONDITION</span>
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
            
            <div className={`rounded-xl bg-ink-panel p-1 text-soft-white ${quiet.length ? "" : "lg:col-span-2"}`}>
              <AlertsPanel open={alertsOpen} onOpenChange={setAlertsOpen} />
            </div>
          </div>
        </div>
      )}
    </section>
    </LiveCtx.Provider>
  );
}
