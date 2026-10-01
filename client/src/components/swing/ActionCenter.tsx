// Section R5 + stat-card upgrade — Action Center: the top-of-Cockpit summary of every watchlist symbol,
// ordered Ready > Confirmed > Forming > Retest > Extended > R:R/stop > Data > No trade (unchanged).
// Reads the SAME scan + selected plan versions as the workspace. Practice / analysis only.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BookOpen, ListChecks, MinusCircle, Palette } from "lucide-react";
import type { ScanSelection, SwingDecision, SwingSettings } from "@shared/swingDecision";
import { actionGroupOf, setupIdOf, sortForActionCenter } from "@shared/practicePlan";
import { swingGet } from "@/lib/swing";
import { activeVersion, staleVersion, useSelectedPlans } from "@/lib/plans";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { useScan } from "./SwingWorkspace";
import { AlertsPanel } from "./PriceAlerts";
import { AppearanceControls, InlineTradingCard, TradingCardDialog, acAttrs, isPopulated, useAcPrefs } from "./TradingCard";

export default function ActionCenter() {
  const req = { selection: "DEFAULT_PLUS_CUSTOM" as ScanSelection, symbols: [], force: 0 };
  const scan = useScan(req);
  const plans = useSelectedPlans();
  const settings = useQuery<SwingSettings>({ queryKey: ["/api/swing/settings"], queryFn: () => swingGet("/api/swing/settings") });
  const [prefs, setPrefs] = useAcPrefs();
  const [showAppearance, setShowAppearance] = usePersistentState<boolean>("ac-appearance-open", false);
  const [showQuiet, setShowQuiet] = useState(false);
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
  const markSeen = (k: string) => { if (!seen.includes(k)) setSeen([...seen.slice(-199), k]); };
  const dlgDecision: SwingDecision | undefined = dlg ? rows.find((d) => d.symbol === dlg.symbol) : undefined;

  return (
    <section className="ac-root ac-shell rounded-2xl p-4 sm:p-5 space-y-4" {...acAttrs(prefs)} aria-label="Action Center" data-testid="action-center">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-extrabold tracking-wide" style={{ fontSize: "calc(var(--ac-fs) * 1.35)" }}>ACTION CENTER</h2>
        <span className="ac-muted ac-num" style={{ fontSize: "var(--ac-fs-sm)" }} data-testid="text-ac-counts">
          {scan.isLoading ? "Evaluating watchlist…" : `${counts.READY ?? 0} ready · ${counts.CONFIRMED ?? 0} confirmed · ${counts.FORMING ?? 0} forming · ${(counts.RETEST ?? 0) + (counts.EXTENDED ?? 0) + (counts.RR_STOP ?? 0)} watch · ${counts.DATA ?? 0} data · ${counts.NO_TRADE ?? 0} no trade`}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg overflow-hidden" role="group" aria-label="Card view" style={{ border: "1px solid var(--ac-border)" }}>
            {(["guided", "compact"] as const).map((v) => (
              <button key={v} className="px-3 py-1 font-semibold inline-flex items-center gap-1.5" aria-pressed={prefs.view === v} onClick={() => setPrefs({ view: v })}
                style={{ fontSize: "var(--ac-fs-sm)", background: prefs.view === v ? "var(--ac-accent)" : "transparent", color: prefs.view === v ? "var(--ac-on-accent)" : "var(--ac-text)" }}
                data-testid={`button-view-${v}`}>
                {v === "guided" ? <BookOpen className="h-4 w-4" aria-hidden /> : <ListChecks className="h-4 w-4" aria-hidden />}{v === "guided" ? "Guided View" : "Compact View"}
              </button>
            ))}
          </div>
          <button className="ac-btn" onClick={() => setShowAppearance(!showAppearance)} aria-expanded={showAppearance} data-testid="button-ac-appearance"><Palette className="h-4 w-4" aria-hidden /> Appearance</button>
        </div>
      </div>
      <div className="font-semibold ac-warn" style={{ fontSize: "var(--ac-fs-xs)" }}>PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE</div>
      {showAppearance && <AppearanceControls prefs={prefs} set={setPrefs} />}

      {scan.data?.emptyReason && <div className="ac-warn flex items-center gap-1.5" style={{ fontSize: "var(--ac-fs-sm)" }}><AlertTriangle className="h-4 w-4" aria-hidden /> {scan.data.emptyReason}</div>}
      {!scan.isLoading && !loud.length && (
        <div className="ac-tile rounded-xl px-4 py-3" style={{ fontSize: "var(--ac-fs)" }} data-testid="text-ac-nothing">
          Nothing ready, confirmed or forming right now. That is a valid answer: no trade is a position. Next conditions are listed below.
        </div>
      )}
      <div className="space-y-4">
        {loud.map((d) => {
          const ver = activeVersion(d, sel);
          const stale = staleVersion(d, sel);
          const key = setupIdOf(d);
          const populated = isPopulated(d, ver);
          return (
            <div key={d.symbol}>
              <InlineTradingCard d={d} group={actionGroupOf(d)} ver={ver} equity={equity} expiryBars={expiryBars} prefs={prefs}
                setupKey={key} isNew={populated && !seen.includes(key)} onSeen={() => markSeen(key)}
                onOpen={() => setDlg({ symbol: d.symbol, mode: "view" })} onAdjust={() => { markSeen(key); setDlg({ symbol: d.symbol, mode: "adjust" }); }} />
              {stale && <div className="ac-muted mt-1 pl-1" style={{ fontSize: "var(--ac-fs-xs)" }} data-testid={`text-stale-version-${d.symbol}`}>Your Plan v{stale.version} was for an older {d.symbol} setup. It's kept in history and not applied to this new setup.</div>}
            </div>
          );
        })}
      </div>
      {quiet.length > 0 && (
        <div>
          <button className="ac-btn" onClick={() => setShowQuiet(!showQuiet)} aria-expanded={showQuiet} data-testid="button-ac-toggle-quiet">
            {showQuiet ? "Hide" : "Show"} no-trade symbols ({quiet.length})
          </button>
          {showQuiet && (
            <ul className="mt-2 space-y-1">
              {quiet.map((d) => (
                <li key={d.symbol} className="flex flex-wrap items-baseline gap-2" style={{ fontSize: "var(--ac-fs-sm)" }} data-testid={`row-ac-quiet-${d.symbol}`}>
                  <MinusCircle className="h-4 w-4 ac-muted self-center" aria-hidden />
                  <span className="ac-num font-bold">{d.symbol}</span>
                  <span className="ac-muted" style={{ fontSize: "var(--ac-fs-xs)" }}>NO TRADE — NEXT CONDITION</span>
                  <span className="ac-muted">{d.nextAction}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {dlgDecision && (
        <TradingCardDialog open={!!dlg} onClose={() => setDlg(null)} mode={dlg!.mode} setMode={(m) => setDlg({ symbol: dlg!.symbol, mode: m })}
          d={dlgDecision} group={actionGroupOf(dlgDecision)} ver={activeVersion(dlgDecision, sel)} equity={equity} expiryBars={expiryBars} prefs={prefs} />
      )}
      {/* Alerts keep the cockpit's own colours, so they read correctly in every card theme. */}
      <div className="bg-ink-panel text-soft-white rounded-xl px-1 pb-1"><AlertsPanel /></div>
    </section>
  );
}
