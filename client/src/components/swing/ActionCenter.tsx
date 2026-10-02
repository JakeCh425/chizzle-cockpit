// Section R5 + stat-card upgrade — Action Center: the top-of-Cockpit summary of every watchlist symbol,
// ordered Ready > Confirmed > Forming > Retest > Extended > R:R/stop > Data > No trade (unchanged).
// Reads the SAME scan + selected plan versions as the workspace. Practice / analysis only.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BookOpen, Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, ListChecks, MinusCircle, Palette, Pencil, X } from "lucide-react";
import type { ScanSelection, SwingDecision, SwingSettings } from "@shared/swingDecision";
import { actionGroupOf, setupIdOf, sortForActionCenter } from "@shared/practicePlan";
import { swingGet } from "@/lib/swing";
import { activeVersion, staleVersion, useSelectedPlans } from "@/lib/plans";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { useScan } from "./SwingWorkspace";
import { AlertsPanel } from "./PriceAlerts";
import { PlanRefreshBar } from "./PlanRefresh";
import { AppearanceControls, DisclosureProvider, InlineTradingCard, Section, TradingCardDialog, acAttrs, isPopulated, useAcPrefs, useDisclosure, useDisclosureAll } from "./TradingCard";

const DEFAULT_TITLE = "Action Center";

/** Click the title (or the pencil) to rename; Enter saves, Escape cancels, empty restores the default. */
function EditableTitle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const start = () => { setDraft(value); setEditing(true); };
  const commit = () => { onChange(draft.trim().slice(0, 40) || DEFAULT_TITLE); setEditing(false); };
  if (editing) return (
    <span className="inline-flex items-center gap-1">
      <input autoFocus className="ac-input !w-56 font-bold" maxLength={40} value={draft} aria-label="Action Center title"
        onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
        onBlur={commit} data-testid="input-ac-title" />
      <button className="ac-btn !px-1.5 !py-1" onMouseDown={(e) => e.preventDefault()} onClick={commit} aria-label="Save title" data-testid="button-ac-title-save"><Check className="h-3.5 w-3.5" aria-hidden /></button>
      <button className="ac-btn !px-1.5 !py-1" onMouseDown={(e) => e.preventDefault()} onClick={() => setEditing(false)} aria-label="Cancel" data-testid="button-ac-title-cancel"><X className="h-3.5 w-3.5" aria-hidden /></button>
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 group">
      <h2 className="font-extrabold tracking-wide uppercase cursor-text" style={{ fontSize: "calc(var(--ac-fs) * 1.1)" }} onDoubleClick={start} data-testid="text-ac-title">{value}</h2>
      <button className="ac-btn !px-1.5 !py-0.5 opacity-60 hover:opacity-100 focus-visible:opacity-100" onClick={start} aria-label="Rename" title="Rename" data-testid="button-ac-title-edit"><Pencil className="h-3 w-3" aria-hidden /></button>
    </span>
  );
}

export default function ActionCenter() {
  return <DisclosureProvider><ActionCenterInner /></DisclosureProvider>;
}

function ActionCenterInner() {
  const req = { selection: "DEFAULT_PLUS_CUSTOM" as ScanSelection, symbols: [], force: 0 };
  const scan = useScan(req);
  const plans = useSelectedPlans();
  const settings = useQuery<SwingSettings>({ queryKey: ["/api/swing/settings"], queryFn: () => swingGet("/api/swing/settings") });
  const [prefs, setPrefs] = useAcPrefs();
  const all = useDisclosureAll();
  const [alertsOpen, setAlertsOpen] = useDisclosure("alerts", true);
  const [boxOpen, setBoxOpen] = usePersistentState<boolean>("ac-box-open", true);   // whole Action Center fold (not touched by Expand/Collapse All)
  const [appOpen, setAppOpen] = useDisclosure("appearance", false);
  const [savedTitle, setTitle] = usePersistentState<string>("ac-title", DEFAULT_TITLE);
  const title = savedTitle?.trim() || DEFAULT_TITLE;
  // Setups whose populated plan the user has already seen (NEW PLAN badge shows once per setup instance).
  const [seen, setSeen] = usePersistentState<string[]>("ac-seen-setups", []);
  // The dialog is ONLY opened by a click — never by polling or refresh.
  const [dlg, setDlg] = useState<{ symbol: string; mode: "view" | "adjust" } | null>(null);

  const rows = sortForActionCenter((scan.data?.rows ?? []).map((r) => r.decision));
  const loud = rows.filter((d) => actionGroupOf(d) !== "NO_TRADE");
  const quiet = rows.filter((d) => actionGroupOf(d) === "NO_TRADE");
  const counts = rows.reduce<Record<string, number>>((m, d) => { const g = actionGroupOf(d); m[g] = (m[g] ?? 0) + 1; return m; }, {});
  const sel = plans.data?.selected;
  const equity = settings.data?.riskLinkInfo?.equity ?? null;
  const expiryBars = settings.data?.expiryBars4h ?? 2;
  const minRr = settings.data?.minRrT1 ?? null;
  const markSeen = (k: string) => { if (!seen.includes(k)) setSeen([...seen.slice(-199), k]); };
  const dlgDecision: SwingDecision | undefined = dlg ? rows.find((d) => d.symbol === dlg.symbol) : undefined;

  return (
    <section className="ac-root ac-shell rounded-2xl px-3 py-2 sm:px-4 space-y-2" {...acAttrs(prefs)} aria-label={title} data-testid="action-center" data-open={boxOpen}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <button className="ac-btn !px-2 !py-1" onClick={() => setBoxOpen(!boxOpen)} aria-expanded={boxOpen} aria-controls="ac-body"
          aria-label={`${boxOpen ? "Collapse" : "Expand"} ${title}`} data-testid="button-toggle-action-center">
          {boxOpen ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
        </button>
        <EditableTitle value={title} onChange={setTitle} />
        <span className="ac-muted ac-num" style={{ fontSize: "var(--ac-fs-xs)" }} data-testid="text-ac-counts">
          {scan.isLoading ? "Evaluating watchlist…" : `${counts.READY ?? 0} ready · ${counts.CONFIRMED ?? 0} confirmed · ${counts.FORMING ?? 0} forming · ${(counts.RETEST ?? 0) + (counts.EXTENDED ?? 0) + (counts.RR_STOP ?? 0)} watch · ${counts.DATA ?? 0} data · ${counts.NO_TRADE ?? 0} no trade`}
        </span>
        <span className="font-semibold ac-warn" style={{ fontSize: "var(--ac-fs-xs)" }}>PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE</span>
        {boxOpen && (
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <div className="inline-flex rounded-lg overflow-hidden" role="group" aria-label="Card view" style={{ border: "1px solid var(--ac-border)" }}>
              {(["guided", "compact"] as const).map((v) => (
                <button key={v} className="px-2.5 py-1 font-semibold inline-flex items-center gap-1.5" aria-pressed={prefs.view === v} onClick={() => setPrefs({ view: v })}
                  style={{ fontSize: "var(--ac-fs-xs)", background: prefs.view === v ? "var(--ac-accent)" : "transparent", color: prefs.view === v ? "var(--ac-on-accent)" : "var(--ac-text)" }}
                  data-testid={`button-view-${v}`}>
                  {v === "guided" ? <BookOpen className="h-3.5 w-3.5" aria-hidden /> : <ListChecks className="h-3.5 w-3.5" aria-hidden />}{v === "guided" ? "Guided" : "Compact"}
                </button>
              ))}
            </div>
            <button className="ac-btn !py-1" style={{ fontSize: "var(--ac-fs-xs)" }} onClick={() => all(true)} data-testid="button-expand-all"><ChevronsUpDown className="h-3.5 w-3.5" aria-hidden /> Expand All</button>
            <button className="ac-btn !py-1" style={{ fontSize: "var(--ac-fs-xs)" }} onClick={() => all(false)} data-testid="button-collapse-all"><ChevronsDownUp className="h-3.5 w-3.5" aria-hidden /> Collapse All</button>
            <button className="ac-btn !py-1" style={{ fontSize: "var(--ac-fs-xs)" }} onClick={() => setAppOpen(!appOpen)} aria-expanded={appOpen} aria-controls="ac-appearance" data-testid="sec-appearance-toggle">
              <Palette className="h-3.5 w-3.5" aria-hidden /> Appearance
            </button>
          </div>
        )}
      </div>
      {boxOpen && <div id="ac-body" className="space-y-2">
      <PlanRefreshBar settings={settings.data} />
      {appOpen && <div id="ac-appearance" data-testid="sec-appearance" data-open="true"><AppearanceControls prefs={prefs} set={setPrefs} /></div>}
      {scan.data?.emptyReason && <div className="ac-warn flex items-center gap-1.5" style={{ fontSize: "var(--ac-fs-sm)" }}><AlertTriangle className="h-4 w-4" aria-hidden /> {scan.data.emptyReason}</div>}
      {!scan.isLoading && !loud.length && (
        <div className="ac-tile rounded-xl px-4 py-3" style={{ fontSize: "var(--ac-fs)" }} data-testid="text-ac-nothing">
          Nothing ready, confirmed or forming right now. That is a valid answer: no trade is a position. Next conditions are listed below.
        </div>
      )}
      <div className="space-y-3">
        {loud.map((d) => {
          const ver = activeVersion(d, sel);
          const stale = staleVersion(d, sel);
          const key = setupIdOf(d);
          const populated = isPopulated(d, ver);
          return (
            <div key={d.symbol}>
              <InlineTradingCard d={d} group={actionGroupOf(d)} ver={ver} equity={equity} expiryBars={expiryBars} minRr={minRr} prefs={prefs}
                setupKey={key} isNew={populated && !seen.includes(key)} onSeen={() => markSeen(key)}
                onOpen={() => setDlg({ symbol: d.symbol, mode: "view" })} onAdjust={() => { markSeen(key); setDlg({ symbol: d.symbol, mode: "adjust" }); }} />
              {stale && <div className="ac-muted mt-1 pl-1" style={{ fontSize: "var(--ac-fs-xs)" }} data-testid={`text-stale-version-${d.symbol}`}>Your Plan v{stale.version} was for an older {d.symbol} setup. It's kept in history and not applied to this new setup.</div>}
            </div>
          );
        })}
      </div>
      <div className="grid gap-2 lg:grid-cols-2 items-start">
      {quiet.length > 0 && (
        <Section id="quiet" title="Watch / No-trade list" def={false} testId="sec-quiet" summary={`${quiet.length} symbol${quiet.length === 1 ? "" : "s"}: ${quiet.map((d) => d.symbol).join(", ")}`}>
          <ul className="space-y-1">
            {quiet.map((d) => (
              <li key={d.symbol} className="flex flex-wrap items-baseline gap-2" style={{ fontSize: "var(--ac-fs-sm)" }} data-testid={`row-ac-quiet-${d.symbol}`}>
                <MinusCircle className="h-4 w-4 ac-muted self-center" aria-hidden />
                <span className="ac-num font-bold">{d.symbol}</span>
                <span className="ac-muted" style={{ fontSize: "var(--ac-fs-xs)" }}>NO TRADE — NEXT CONDITION</span>
                <span className="ac-muted">{d.nextAction}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {dlgDecision && (
        <TradingCardDialog open={!!dlg} onClose={() => setDlg(null)} mode={dlg!.mode} setMode={(m) => setDlg({ symbol: dlg!.symbol, mode: m })}
          d={dlgDecision} group={actionGroupOf(dlgDecision)} ver={activeVersion(dlgDecision, sel)} equity={equity} expiryBars={expiryBars} minRr={minRr} prefs={prefs} />
      )}
      {/* Alerts keep the cockpit's own colours, so they read correctly in every card theme. */}
      <div className={`bg-ink-panel text-soft-white rounded-xl px-1 pb-1 ${quiet.length ? "" : "lg:col-span-2"}`}><AlertsPanel open={alertsOpen} onOpenChange={setAlertsOpen} /></div>
      </div>
      </div>}
    </section>
  );
}
