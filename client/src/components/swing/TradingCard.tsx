// Trading Card — the Action Center's stat-card view of one engine decision, plus the expanded
// dialog / mobile sheet and "Adjust My Practice Plan". Everything shown comes from the shared
// SwingDecision and the existing practice-plan math (recalcPlan); nothing here changes engine
// readiness, and nothing here can send an order. PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, BookOpen, CheckCircle2, ChevronDown, ChevronRight, CircleDashed, Clock, Eye, Hourglass, LineChart,
  Maximize2, MinusCircle, Pencil, RotateCcw, ShieldAlert, Sprout, Ban, WifiOff, XCircle, Undo2, Save,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { usePersistentState } from "@/hooks/use-persistent-state";
import type { StructureLevel, SwingDecision } from "@shared/swingDecision";
import { STATUS_LABEL } from "@shared/swingDecision";
import {
  ACTION_GROUP_LABEL, canEditPlan, engineChangedSince, enginePlanSig, inputsFromCardChoice, obstacleBefore, plannedR, recalcPlan, rMultipleOf,
  R_CHOICES, R_EXPLAIN, R_PRESETS, CARD_TARGET_METHOD_LABEL, validateCardLevels,
  type ActionGroup, type CardTargetMethod, type PlanContext, type PlanVersion, type TargetChoice,
} from "@shared/practicePlan";
import { fmtCT, swingGet, swingSend } from "@/lib/swing";
import { effectivePlan, focusSymbol, invalidatePlans, openPlanEditor, selectPlanVersion } from "@/lib/plans";
import { defaultAlertFor, openAlertDialog } from "@/lib/alerts";
import { RefreshDataButton } from "./DataStatus";

// ─── Appearance (scoped to the Action Center + cards) ────────────────────────
export const AC_THEMES = [
  { id: "signature", name: "Chizzle Signature", sw: ["#0B1220", "#22D3EE", "#F5C451"] },
  { id: "mint", name: "Midnight Mint", sw: ["#101816", "#5EEAD4", "#CBD5E1"] },
  { id: "violet", name: "Royal Violet", sw: ["#171226", "#A78BFA", "#BAE6FD"] },
  { id: "copper", name: "Graphite Copper", sw: ["#191919", "#FB923C", "#FFF7ED"] },
  { id: "arctic", name: "Arctic Light", sw: ["#F5F7FB", "#14243B", "#0F766E"] },
  { id: "ocean", name: "Ocean Blue", sw: ["#071A2B", "#38BDF8", "#E0F2FE"] },
  { id: "burgundy", name: "Burgundy Slate", sw: ["#20151C", "#FDA4AF", "#F8FAFC"] },
] as const;
export type AcTheme = typeof AC_THEMES[number]["id"];
export interface AcPrefs { theme: AcTheme; font: "modern" | "desk"; size: "standard" | "large" | "xl"; view: "guided" | "compact" }
export const DEFAULT_AC_PREFS: AcPrefs = { theme: "signature", font: "desk", size: "standard", view: "compact" };
export function useAcPrefs() {
  const [p, setP] = usePersistentState<AcPrefs>("ac-appearance", DEFAULT_AC_PREFS);
  const prefs = { ...DEFAULT_AC_PREFS, ...p };
  return [prefs, (patch: Partial<AcPrefs>) => setP({ ...prefs, ...patch })] as const;
}
export const acAttrs = (p: AcPrefs) => ({ "data-ac-theme": p.theme, "data-ac-font": p.font, "data-ac-size": p.size });

export function AppearanceControls({ prefs, set }: { prefs: AcPrefs; set: (p: Partial<AcPrefs>) => void }) {
  return (
    <div className="ac-tile rounded-xl p-3 space-y-3" data-testid="panel-ac-appearance">
      <fieldset>
        <legend className="font-semibold" style={{ fontSize: "var(--ac-fs-sm)" }}>Theme</legend>
        <div className="flex flex-wrap gap-2 mt-1.5" role="radiogroup" aria-label="Action Center theme">
          {AC_THEMES.map((t) => (
            <button key={t.id} role="radio" aria-checked={prefs.theme === t.id} onClick={() => set({ theme: t.id })}
              className="ac-btn" style={prefs.theme === t.id ? { borderColor: "var(--ac-accent)", borderWidth: 2 } : undefined} data-testid={`button-theme-${t.id}`}>
              <span className="inline-flex rounded-md overflow-hidden border" style={{ borderColor: "var(--ac-border)" }} aria-hidden>
                {t.sw.map((c) => <span key={c} style={{ background: c, width: 14, height: 18 }} />)}
              </span>
              {t.name}{prefs.theme === t.id && <CheckCircle2 className="h-4 w-4" aria-hidden />}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2" style={{ fontSize: "var(--ac-fs-sm)" }}>Font
          <select className="ac-input w-auto" value={prefs.font} onChange={(e) => set({ font: e.target.value as AcPrefs["font"] })} data-testid="select-ac-font">
            <option value="modern">Modern (Inter)</option><option value="desk">Trading Desk (Inter + IBM Plex Mono numbers)</option>
          </select></label>
        <label className="flex items-center gap-2" style={{ fontSize: "var(--ac-fs-sm)" }}>Size
          <select className="ac-input w-auto" value={prefs.size} onChange={(e) => set({ size: e.target.value as AcPrefs["size"] })} data-testid="select-ac-size">
            <option value="standard">Standard</option><option value="large">Large</option><option value="xl">Extra Large</option>
          </select></label>
      </div>
    </div>
  );
}

// ─── Plain-English copy ──────────────────────────────────────────────────────
const TF_EXPLAIN: Record<string, string> = {
  "1H": "1-hour setup: each candle represents one hour of price activity.",
  "4H": "4-hour setup: each candle represents four hours of price activity.",
  "1D": "Daily setup: each candle represents one trading day.",
  "1W": "Weekly setup: each candle represents one trading week.",
};
const STATUS_EXPLAIN: Record<string, string> = {
  READY_TO_TRADE: "Ready: every engine rule passed on closed candles. A practice plan is available to review. This is not an instruction to trade.",
  SETUP_CONFIRMED: "Confirmed on the setup chart, but not ready yet: the engine still needs a closed 1-hour candle above the trigger.",
  SETUP_FORMING: "Still forming: some conditions have passed, but the setup is not ready.",
  WATCH_RETEST: "Watching for a retest: price moved away from the entry area and the engine wants it to come back first.",
  WATCH_EXTENDED: "Extended: price ran too far above the trigger. Chasing adds risk, so the engine waits for a retest.",
  WATCH_STOP_TOO_WIDE: "Stop too wide: the distance to the stop is too large for your risk budget.",
  WATCH_RR_TOO_LOW: "Reward too small: Target 1 does not offer enough reward for the planned risk.",
  BLOCKED_DATA_MISMATCH: "Blocked: the data feeds disagree, so no level should be trusted until the data is verified.",
  SIGNAL_EXPIRED: "Expired: this setup is no longer valid. Its levels are history only.",
  NO_SETUP: "No setup right now.", NO_TRADE: "No trade right now.",
};
const CLASS_LABEL: Record<string, string> = { A4_CORE: "Core", A3_SWING: "Standard", A2_PRACTICE: "Practice (half size)", WATCH: "Watch", NO_TRADE: "No trade" };
const ICON: Record<ActionGroup, typeof CheckCircle2> = { READY: CheckCircle2, CONFIRMED: Hourglass, FORMING: Sprout, RETEST: RotateCcw, EXTENDED: ShieldAlert, RR_STOP: Ban, DATA: WifiOff, NO_TRADE: MinusCircle };
const TONE: Record<ActionGroup, "good" | "warn" | "bad" | "accent" | "muted"> = { READY: "good", CONFIRMED: "accent", FORMING: "warn", RETEST: "accent", EXTENDED: "warn", RR_STOP: "bad", DATA: "bad", NO_TRADE: "muted" };
const toneVar = (t: string) => `var(--ac-${t === "accent" ? "accent" : t === "muted" ? "muted" : t})`;

const $ = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const BAD_DATA = ["DELAYED", "STALE", "ERROR", "MISMATCH"];

/** One clear next step, always consistent with the engine status (never upgrades it). */
export function nextStepFor(d: SwingDecision, group: ActionGroup, ver: PlanVersion | null): { text: string; tone: "good" | "warn" | "bad" | "accent" } {
  const trig = d.currentTrigger ?? d.originalTrigger;
  if (d.setupStatus === "SIGNAL_EXPIRED") return { text: "This setup is no longer valid.", tone: "bad" };
  if (group === "DATA" || BAD_DATA.includes(d.dataStatus)) return { text: "Verify the data before using any level on this card.", tone: "bad" };
  if (d.currentPrice != null && d.structuralStop != null && d.currentPrice < d.structuralStop && d.entryPrice != null) return { text: "Price is below the stop. This plan is invalidated.", tone: "bad" };
  if (ver && ver.result.state !== "VALID") return { text: "Review your adjusted risk. Your plan does not meet every rule.", tone: "warn" };
  switch (group) {
    case "READY": return { text: "Review the plan and the live data before any independent decision.", tone: "good" };
    case "CONFIRMED": return { text: `Wait for a 1-hour candle to close above ${$(trig)}.`, tone: "accent" };
    case "FORMING": return { text: `Wait for the ${d.setupTimeframe === "1H" ? "1-hour" : "4-hour"} candle to close.`, tone: "warn" };
    case "RETEST": case "EXTENDED": return { text: d.retestLevel ? `Don't chase. Watch for a retest of ${$(d.retestLevel.low)}–${$(d.retestLevel.high)}.` : "Don't chase. Wait for a retest.", tone: "warn" };
    case "RR_STOP": return { text: "This plan doesn't fit your risk rules. Wait or skip.", tone: "bad" };
    default: return { text: d.nextAction, tone: "accent" };
  }
}

export const isPopulated = (d: SwingDecision, ver: PlanVersion | null) => { const p = effectivePlan(d, ver); return p.entry != null && p.stop != null; };

// ─── Disclosure state (independent, persisted; Expand All / Collapse All) ────
interface DisclosureApi { isOpen: (key: string, def: boolean) => boolean; set: (key: string, open: boolean) => void; all: (open: boolean) => void }
const DisclosureCtx = createContext<DisclosureApi | null>(null);
export function DisclosureProvider({ children }: { children: React.ReactNode }) {
  const [st, setSt] = usePersistentState<{ all: boolean | null; o: Record<string, boolean> }>("ac-disclosure", { all: null, o: {} });
  const api: DisclosureApi = {
    isOpen: (k, def) => st.o[k] ?? st.all ?? def,
    set: (k, open) => setSt({ ...st, o: { ...st.o, [k]: open } }),
    all: (open) => setSt({ all: open, o: {} }),
  };
  return <DisclosureCtx.Provider value={api}>{children}</DisclosureCtx.Provider>;
}
export function useDisclosure(key: string, def = true): [boolean, (o: boolean) => void] {
  const api = useContext(DisclosureCtx);
  const [local, setLocal] = useState(def);
  if (!api) return [local, setLocal];
  return [api.isOpen(key, def), (o) => api.set(key, o)];
}
export const useDisclosureAll = () => useContext(DisclosureCtx)?.all ?? (() => {});

/** Keyboard-accessible disclosure: a real <button aria-expanded> that keeps a one-line summary when collapsed. */
export function Section({ id, title, summary, def = true, children, testId }: { id: string; title: string; summary?: React.ReactNode; def?: boolean; children: React.ReactNode; testId: string }) {
  const [open, setOpen] = useDisclosure(id, def);
  const bodyId = `sec-${id.replace(/[^a-z0-9]/gi, "-")}`;
  return (
    <section className="ac-tile rounded-xl" data-testid={testId} data-open={open}>
      <button className="w-full flex items-center gap-2 px-3 py-2 text-left rounded-xl" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={bodyId} data-testid={`${testId}-toggle`}>
        {open ? <ChevronDown className="h-4 w-4 shrink-0" aria-hidden /> : <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />}
        <span className="font-bold shrink-0" style={{ fontSize: "var(--ac-fs-sm)" }}>{title}</span>
        {summary != null && <span className="ac-muted ac-num truncate min-w-0" style={{ fontSize: "var(--ac-fs-xs)" }} data-testid={`${testId}-summary`}>{summary}</span>}
      </button>
      {open && <div id={bodyId} className="px-3 pb-3">{children}</div>}
    </section>
  );
}

// ─── Small building blocks ───────────────────────────────────────────────────
function Badge({ tone, Icon, children, testId }: { tone: string; Icon?: typeof CheckCircle2; children: React.ReactNode; testId?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-semibold whitespace-nowrap" data-testid={testId}
      style={{ fontSize: "var(--ac-fs-xs)", color: toneVar(tone), border: `1.5px solid ${toneVar(tone)}` }}>
      {Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}{children}
    </span>
  );
}
const autoGrid = (min: number) => ({ display: "grid", gap: "0.6rem", gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))` });
function PriceTile({ label, sub, value, tone, guided, engineValue, changed, rText, source, flags, testId }: {
  label: string; sub: string; value: string; tone: string; guided: boolean; engineValue?: string | null; changed?: boolean;
  rText?: string | null; source?: string | null; flags?: { text: string; tone: string }[]; testId: string;
}) {
  return (
    <div className="rounded-lg p-2.5 flex flex-col gap-0.5 min-w-0" style={{ background: "var(--ac-surface)", border: "1px solid var(--ac-border)", borderTop: `3px solid ${toneVar(tone)}` }} data-testid={testId}>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="font-bold tracking-wide" style={{ fontSize: "var(--ac-fs-xs)", color: toneVar(tone) }}>{label}</span>
        {changed && <span className="rounded px-1.5 font-semibold" style={{ fontSize: "11px", background: "var(--ac-accent)", color: "var(--ac-on-accent)" }} data-testid={`${testId}-changed`}>ADJUSTED</span>}
      </div>
      {guided && <div className="ac-muted leading-tight" style={{ fontSize: "var(--ac-fs-xs)" }}>{sub}</div>}
      <div className="ac-num font-bold leading-none mt-1" style={{ fontSize: "var(--ac-price)" }} data-testid={`${testId}-value`}>{value}</div>
      {rText && <div className="ac-num font-semibold ac-accent" style={{ fontSize: "var(--ac-fs-sm)" }} data-testid={`${testId}-r`}>{rText}</div>}
      {changed && engineValue != null && <div className="ac-muted ac-num" style={{ fontSize: "var(--ac-fs-xs)" }}>Engine: {engineValue}</div>}
      {source && <div className="ac-muted leading-snug" style={{ fontSize: "var(--ac-fs-xs)" }} data-testid={`${testId}-source`}>{source}</div>}
      {flags?.map((f) => <div key={f.text} className="font-semibold leading-snug flex gap-1" style={{ fontSize: "var(--ac-fs-xs)", color: toneVar(f.tone) }} data-testid={`${testId}-flag`}><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-[2px]" aria-hidden />{f.text}</div>)}
    </div>
  );
}
function Stat({ k, v, explain, guided, testId }: { k: string; v: string; explain: string; guided: boolean; testId: string }) {
  return (
    <div className="rounded-lg p-2.5 min-w-0" style={{ background: "var(--ac-surface)", border: "1px solid var(--ac-border)" }} data-testid={testId}>
      <div className="font-semibold ac-muted" style={{ fontSize: "var(--ac-fs-xs)" }}>{k}</div>
      <div className="ac-num font-bold whitespace-pre-line leading-tight" style={{ fontSize: v.length > 12 ? "var(--ac-fs)" : "calc(var(--ac-fs) * 1.25)" }} data-testid={`${testId}-value`}>{v}</div>
      {guided && <div className="ac-muted leading-snug mt-0.5" style={{ fontSize: "var(--ac-fs-xs)" }}>{explain}</div>}
    </div>
  );
}
const levelLabel = (l: StructureLevel) => `${$(l.price)} · ${l.timeframe} pivot high · ${fmtCT(l.time)}`;
const rTxt = (r: number | null | undefined) => (r == null ? null : `${r.toFixed(2)}R`);

/** Where each target came from — shown, never silently replaced. */
export function targetSources(d: SwingDecision, ver: PlanVersion | null, minRr: number | null): { t1: string; t2: string } {
  if (ver) {
    const m = (ver.chartState?.targetMethod as CardTargetMethod | undefined);
    const lab = m ? CARD_TARGET_METHOD_LABEL[m] : ver.inputs.targetMethod === "R_MULTIPLE" ? "Fixed R" : ver.inputs.targetMethod === "RESISTANCE" ? "Resistance" : "Manual Prices";
    const fx = ver.inputs.targetMethod === "R_MULTIPLE";
    return { t1: `My plan · ${lab}${fx ? ` (${ver.inputs.t1R}R)` : ""}`, t2: `My plan · ${lab}${fx ? ` (${ver.inputs.t2R}R)` : ""}` };
  }
  const t1 = d.target1Source === "resistance"
    ? `Engine · nearest resistance above entry${d.target1Ref ? `: ${d.target1Ref.timeframe} pivot high from ${fmtCT(d.target1Ref.time)}` : ""}`
    : d.target1Source === "r-multiple" ? `Engine · no resistance above entry, so entry + ${minRr ?? "min"}R` : "Engine plan";
  const t2 = d.target2Source === "resistance"
    ? `Engine · next resistance beyond Target 1${d.target2Ref ? `: ${d.target2Ref.timeframe} pivot high from ${fmtCT(d.target2Ref.time)}` : ""}`
    : d.target2Source === "r-multiple" ? "Engine · no resistance beyond Target 1, so entry + 3 × R" : "Engine plan";
  return { t1, t2 };
}
function targetFlags(which: 1 | 2, rr: number | null, minRr: number | null, obstacle: StructureLevel | null): { text: string; tone: string }[] {
  const out: { text: string; tone: string }[] = [];
  if (rr != null) {
    if (which === 1 && minRr != null && minRr > 0 && rr + 1e-9 < minRr) out.push({ text: `Below your ${minRr}R minimum for Target 1 (existing rule).`, tone: "warn" });
    else if (rr < 1) out.push({ text: "Below 1R.", tone: "muted" });
  }
  if (obstacle) out.push({ text: `Resistance ${$(obstacle.price)} (${obstacle.timeframe} pivot high) sits before this target.`, tone: "warn" });
  return out;
}

// ─── The card body (used inline and in the dialog) ───────────────────────────
export interface CardProps {
  d: SwingDecision; group: ActionGroup; ver: PlanVersion | null; equity: number | null; expiryBars: number; minRr: number | null;
  prefs: AcPrefs; inDialog?: boolean; onOpen?: () => void; onAdjust?: () => void;
}

/** Warnings that never collapse: practice-only, gap risk, and any stale / invalid / expired state. */
export function CriticalWarnings({ d, ver }: { d: SwingDecision; ver: PlanVersion | null }) {
  const p = effectivePlan(d, ver);
  const expired = d.setupStatus === "SIGNAL_EXPIRED";
  const badData = BAD_DATA.includes(d.dataStatus) || d.setupStatus === "BLOCKED_DATA_MISMATCH";
  const invalidated = d.currentPrice != null && p.stop != null && d.currentPrice < p.stop;
  const invalidPlan = ver != null && ver.result.state === "INVALID";
  return (
    <div className="space-y-1" data-testid={`card-warnings-${d.symbol}`}>
      {(expired || badData || invalidated || invalidPlan) && (
        <div className="rounded-lg px-3 py-1.5 font-semibold ac-bad flex items-center gap-2" role="alert" style={{ border: "1.5px solid var(--ac-bad)", fontSize: "var(--ac-fs-sm)" }} data-testid={`banner-levels-caution-${d.symbol}`}>
          <XCircle className="h-4 w-4 shrink-0" aria-hidden />
          {expired ? "Expired setup: these levels are history only." : badData ? `Data ${d.dataStatus}: don't rely on these levels until the data is verified.` : invalidated ? "Price is below the stop: this plan is invalidated." : "My Adjusted Plan is invalid: entry must be above the stop."}
        </div>
      )}
      <div className="font-semibold ac-warn leading-snug" style={{ fontSize: "var(--ac-fs-xs)" }}>
        PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE · OVERNIGHT GAP RISK — STOP ORDERS CAN FILL BELOW STOP PRICE.
      </div>
    </div>
  );
}

export function TradingCardBody({ d, group, ver, equity, expiryBars, minRr, prefs, inDialog, onOpen, onAdjust }: CardProps) {
  const guided = prefs.view === "guided";
  const scope = `${inDialog ? "dlg" : "card"}:${d.symbol}`;
  const p = effectivePlan(d, ver);
  const tone = TONE[group];
  const populated = p.entry != null && p.stop != null;
  const changed = new Set(ver?.result.changedFields ?? []);
  const engine = { entry: d.entryPrice, stop: d.structuralStop, t1: d.target1, t2: d.target2 };
  const [acks, setAcks] = usePersistentState<Record<string, string>>("ac-engine-change-acks", {});
  const engineMoved = engineChangedSince(ver, d);
  const needsChoice = ver != null && engineMoved.length > 0 && acks[String(ver.id)] !== enginePlanSig(d);
  const step = nextStepFor(d, group, ver);
  const shares = p.shares;
  const posValue = shares != null && p.entry != null ? shares * p.entry : null;
  const totalRisk = shares != null && p.risk != null ? shares * p.risk : null;
  const acctPct = totalRisk != null && equity ? (totalRisk / equity) * 100 : null;
  const passed = d.passedRules.slice(0, 6);
  const missing = (d.missingConditions.length ? d.missingConditions : d.whyNotReady).slice(0, 5);
  const trig = d.currentTrigger ?? d.originalTrigger;
  const src = targetSources(d, ver, minRr);
  const ob1 = obstacleBefore(d.structureLevels, p.entry, p.t1), ob2 = obstacleBefore(d.structureLevels, p.entry, p.t2);

  return (
    <div className={`space-y-2.5 ${inDialog ? "p-4 sm:p-5" : "px-3 pb-3 sm:px-4"}`}>
      {guided && (
        <p className="ac-muted" style={{ fontSize: "var(--ac-fs-sm)" }} data-testid={`text-card-status-explain-${d.symbol}`}>{STATUS_EXPLAIN[d.setupStatus] ?? d.nextAction}</p>
      )}
      {needsChoice && (
        <div className="rounded-xl p-3 space-y-2" style={{ border: "2px solid var(--ac-warn)" }} role="alert" data-testid={`banner-engine-changed-${d.symbol}`}>
          <div className="font-bold ac-warn flex items-center gap-2"><AlertTriangle className="h-4 w-4" aria-hidden /> The engine plan changed after you saved My Adjusted Plan v{ver!.version}.</div>
          <div style={{ fontSize: "var(--ac-fs-sm)" }}>{engineMoved.join(" · ")}. Your adjusted plan is still the one in use. Choose what to do:</div>
          <div className="flex flex-wrap gap-2">
            <button className="ac-btn" onClick={() => setAcks({ ...acks, [String(ver!.id)]: enginePlanSig(d) })} data-testid={`button-keep-adjusted-${d.symbol}`}>Keep my adjusted plan</button>
            {onAdjust && <button className="ac-btn" onClick={onAdjust} data-testid={`button-rebase-${d.symbol}`}>Rebase: review my edits against the new plan</button>}
            <button className="ac-btn" onClick={() => void selectPlanVersion(d.symbol, 0)} data-testid={`button-reset-engine-banner-${d.symbol}`}><Undo2 className="h-4 w-4" aria-hidden /> Reset to Engine Plan</button>
          </div>
        </div>
      )}

      {group !== "NO_TRADE" && (
        <Section id={`${scope}:ready`} title="Readiness" testId={`sec-ready-${d.symbol}`}
          summary={`${passed.length} passed · ${missing.length} missing · watch: ${group === "CONFIRMED" ? `1H close above ${$(trig)}` : d.nextAction}`}>
          <div style={autoGrid(200)}>
            <div>
              <div className="font-bold ac-good flex items-center gap-1.5" style={{ fontSize: "var(--ac-fs-sm)" }}><CheckCircle2 className="h-4 w-4" aria-hidden /> Passed</div>
              <ul className="mt-0.5 space-y-0.5" style={{ fontSize: "var(--ac-fs-sm)" }} data-testid={`list-passed-${d.symbol}`}>{passed.length ? passed.map((x) => <li key={x}>{x}</li>) : <li className="ac-muted">Nothing yet.</li>}</ul>
            </div>
            <div>
              <div className="font-bold ac-warn flex items-center gap-1.5" style={{ fontSize: "var(--ac-fs-sm)" }}><CircleDashed className="h-4 w-4" aria-hidden /> Missing</div>
              <ul className="mt-0.5 space-y-0.5" style={{ fontSize: "var(--ac-fs-sm)" }} data-testid={`list-missing-${d.symbol}`}>{missing.length ? missing.map((x) => <li key={x}>{x}</li>) : <li className="ac-muted">Nothing. All conditions passed.</li>}</ul>
            </div>
            <div>
              <div className="font-bold ac-accent flex items-center gap-1.5" style={{ fontSize: "var(--ac-fs-sm)" }}><Eye className="h-4 w-4" aria-hidden /> Watch next</div>
              <div className="mt-0.5" style={{ fontSize: "var(--ac-fs-sm)" }}>
                {group === "CONFIRMED" ? `A closed 1H candle above ${$(trig)}. Expires after ${expiryBars} completed 4H bar${expiryBars === 1 ? "" : "s"}${d.expiryTime ? ` (${fmtCT(d.expiryTime)})` : ""}.` : d.nextAction}
              </div>
            </div>
          </div>
        </Section>
      )}

      {populated ? (
        <Section id={`${scope}:levels`} title="Trade Levels & Target Method" testId={`sec-levels-${d.symbol}`}
          summary={`Entry ${$(p.entry)} · Stop ${$(p.stop)} · T1 ${$(p.t1)} (${rTxt(p.rrT1) ?? "—"}) · T2 ${$(p.t2)} (${rTxt(p.rrT2) ?? "—"})`}>
          <div className="flex flex-wrap items-center gap-2 mb-2" style={{ fontSize: "var(--ac-fs-xs)" }}>
            <Badge tone={p.source === "USER" ? "accent" : "muted"} Icon={p.source === "USER" ? Pencil : undefined} testId={`badge-target-method-${d.symbol}`}>
              Target method: {ver ? (CARD_TARGET_METHOD_LABEL[ver.chartState?.targetMethod as CardTargetMethod] ?? "Adjusted") : "Engine Original"}
            </Badge>
            <span className="ac-muted">R = |entry − stop loss| = <b className="ac-num">{$(p.risk)}</b> (stop loss, not the stop-limit price).</span>
          </div>
          <div style={autoGrid(150)}>
            <PriceTile testId={`tile-entry-${d.symbol}`} label="ENTRY" sub="Planned starting price, not a fill" value={$(p.entry)} tone="good" guided={guided} changed={changed.has("entry")} engineValue={$(engine.entry)} />
            <PriceTile testId={`tile-stop-${d.symbol}`} label="STOP LOSS" sub="Planned protective exit trigger" value={$(p.stop)} tone="bad" guided={guided} changed={changed.has("stop")} engineValue={$(engine.stop)} />
            <PriceTile testId={`tile-stoplimit-${d.symbol}`} label="STOP LIMIT" sub="Lowest price the sell limit accepts" value={p.stopLimit != null ? $(p.stopLimit) : "Not configured"} tone="bad" guided={guided}
              source={p.stopLimit != null && p.source === "SYSTEM" ? "Default: 0.2% below stop (min $0.05)" : null} flags={p.stopLimit != null ? [{ text: "May not fill in a fast drop or gap.", tone: "warn" }] : undefined} />
            <PriceTile testId={`tile-t1-${d.symbol}`} label="TARGET 1" sub="First planned profit level" value={$(p.t1)} tone="accent" guided={guided} rText={rTxt(p.rrT1)}
              changed={changed.has("target1")} engineValue={$(engine.t1)} source={src.t1} flags={targetFlags(1, p.rrT1, minRr, ob1)} />
            <PriceTile testId={`tile-t2-${d.symbol}`} label="TARGET 2" sub="Further level for any remaining position" value={$(p.t2)} tone="accent" guided={guided} rText={rTxt(p.rrT2)}
              changed={changed.has("target2")} engineValue={$(engine.t2)} source={src.t2} flags={targetFlags(2, p.rrT2, minRr, ob2)} />
          </div>
        </Section>
      ) : (
        <div className="ac-tile rounded-xl px-3 py-2" style={{ fontSize: "var(--ac-fs-sm)" }} data-testid={`text-plan-pending-${d.symbol}`}>
          No plan yet. The engine fills in Entry, Stop Loss and Targets once the setup has enough structure.{trig != null ? ` Estimated trigger: ${$(trig)}.` : ""}
        </div>
      )}

      {populated && (
        <Section id={`${scope}:risk`} title="Risk & Position Size" testId={`sec-risk-${d.symbol}`}
          summary={`${shares ?? "—"} sh · risk ${$(totalRisk)} · ${acctPct != null ? `${acctPct.toFixed(2)}% of account` : "account % n/a"} · ${$(p.risk)}/sh`}>
          <div style={autoGrid(130)}>
            <Stat testId={`stat-shares-${d.symbol}`} guided={guided} k="Practice shares" v={shares != null ? String(shares) : "—"} explain="Sized to your risk budget." />
            <Stat testId={`stat-value-${d.symbol}`} guided={guided} k="Position value" v={$(posValue)} explain="Shares × entry." />
            <Stat testId={`stat-rps-${d.symbol}`} guided={guided} k="Risk per share" v={$(p.risk)} explain="Entry − stop loss." />
            <Stat testId={`stat-risk-${d.symbol}`} guided={guided} k="Planned dollar risk" v={$(totalRisk)} explain="If all shares exit at the stop." />
            <Stat testId={`stat-acct-${d.symbol}`} guided={guided} k="Account risk" v={acctPct != null ? `${acctPct.toFixed(2)}%` : "Not available"} explain={!equity ? "Set equity in Settings → Risk Profile." : totalRisk == null ? "Shown once shares are sized." : `Dollar risk ÷ equity (${$(equity)}).`} />
            <Stat testId={`stat-rr-${d.symbol}`} guided={guided} k="Reward-to-risk" v={p.rrT1 != null ? `T1 ${rTxt(p.rrT1)}\nT2 ${rTxt(p.rrT2) ?? "—"}` : "Not calculated yet"} explain="Separate scenarios." />
          </div>
        </Section>
      )}

      <Section id={`${scope}:explain`} title="Explanations" def={guided} testId={`sec-explain-${d.symbol}`} summary="What each number means">
        <ul className="space-y-1 leading-snug" style={{ fontSize: "var(--ac-fs-sm)" }} data-testid={`list-rr-explain-${d.symbol}`}>
          <li>{STATUS_EXPLAIN[d.setupStatus] ?? d.nextAction}</li>
          {d.setupTimeframe && <li>{TF_EXPLAIN[d.setupTimeframe]} Classification ({CLASS_LABEL[d.cardGrade] ?? d.cardGrade}) describes quality and size tier. It is not a readiness signal.</li>}
          <li><b>Entry</b> is a planned starting price, not a confirmed fill. <b>Stop loss</b> is the planned protective exit; the actual exit may differ.</li>
          {p.stopLimit != null && <li><b>Stop limit:</b> when price trades at or below the stop trigger ({$(p.stop)}), a limit sell at {$(p.stopLimit)} or better is used. If price gaps below {$(p.stopLimit)}, it may not fill.</li>}
          <li>{R_EXPLAIN}</li>
          {p.rrT1 != null && <li>At Target 1, this plan models <b className="ac-num">${p.rrT1.toFixed(2)}</b> of potential reward for each $1 of planned risk.</li>}
          {p.rrT2 != null && <li>At Target 2, this plan models <b className="ac-num">${p.rrT2.toFixed(2)}</b> of potential reward for each $1 of planned risk.</li>}
          <li className="ac-muted">Each target is a separate scenario. Don't add them together. A more distant target does not make a setup better or more likely. Slippage and fees are not included.</li>
        </ul>
      </Section>

      <div className="rounded-xl px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1" style={{ border: `2px solid ${toneVar(step.tone)}` }} data-testid={`card-next-step-${d.symbol}`}>
        <span className="font-bold ac-muted" style={{ fontSize: "var(--ac-fs-xs)" }}>NEXT STEP</span>
        <span className="font-bold" style={{ fontSize: "calc(var(--ac-fs) * 1.1)", color: toneVar(step.tone) }} data-testid={`text-next-step-${d.symbol}`}>{step.text}</span>
      </div>
      <CardActions d={d} group={group} ver={ver} inDialog={inDialog} onOpen={onOpen} onAdjust={onAdjust} />
    </div>
  );
}

function CardActions({ d, group, ver, inDialog, onOpen, onAdjust }: { d: SwingDecision; group: ActionGroup; ver: PlanVersion | null; inDialog?: boolean; onOpen?: () => void; onAdjust?: () => void }) {
  const [saved, setSaved] = useState<string | null>(null);
  const journal = async () => {
    try { await swingSend("POST", "/api/swing/journal", { action: "PRACTICE_TRADE", symbol: d.symbol, notes: `Saved from trading card (${ver ? `My Adjusted Plan v${ver.version}` : "Engine Plan"}, practice only, not an order).` }); setSaved("Saved to journal"); }
    catch (e: any) { setSaved(e?.message ?? "Save failed"); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!inDialog && onOpen && <button className="ac-btn ac-btn-primary" onClick={onOpen} data-testid={`button-open-card-${d.symbol}`}><Maximize2 className="h-4 w-4" aria-hidden /> Open Trading Card</button>}
      {canEditPlan(d) && onAdjust && <button className={`ac-btn ${inDialog ? "ac-btn-primary" : ""}`} onClick={onAdjust} data-testid={`button-adjust-plan-${d.symbol}`}><Pencil className="h-4 w-4" aria-hidden /> Adjust My Practice Plan</button>}
      <button className="ac-btn" onClick={() => focusSymbol(d.symbol)} data-testid={`button-ac-chart-${d.symbol}`}><LineChart className="h-4 w-4" aria-hidden /> {group === "FORMING" ? "Watch Setup" : "Open Chart"}</button>
      <button className="ac-btn" onClick={() => focusSymbol(d.symbol, "why")} data-testid={`button-ac-why-${d.symbol}`}><BookOpen className="h-4 w-4" aria-hidden /> {group === "FORMING" ? "Learn Pattern" : group === "EXTENDED" || group === "RETEST" ? "View Original Setup" : "Learn Why"}</button>
      {group !== "NO_TRADE" && (
        <button className="ac-btn" onClick={() => openAlertDialog(defaultAlertFor(d, group, effectivePlan(d, ver)))} data-testid={`button-set-alert-${d.symbol}`}>
          {group === "DATA" ? "Set Data-Recovery Alert" : "Set Alert"}
        </button>
      )}
      {group === "DATA" && <RefreshDataButton symbols={[d.symbol]} />}
      {canEditPlan(d) && <button className="ac-btn" onClick={() => openPlanEditor(d.symbol)} data-testid={`button-edit-plan-${d.symbol}`}>Advanced editor</button>}
      {group === "READY" && <button className="ac-btn" onClick={journal} data-testid={`button-ac-journal-${d.symbol}`}>Save to Journal</button>}
      {saved && <span className="ac-muted" role="status" style={{ fontSize: "var(--ac-fs-xs)" }}>{saved}</span>}
    </div>
  );
}

/** Card header — always visible; the whole card collapses under it but keeps ticker, status and key prices. */
function CardHeader({ d, group, ver, isNew, open, toggle, action }: { d: SwingDecision; group: ActionGroup; ver: PlanVersion | null; isNew?: boolean; open?: boolean; toggle?: () => void; action?: React.ReactNode }) {
  const p = effectivePlan(d, ver);
  const tone = TONE[group], Icon = ICON[group];
  const badData = BAD_DATA.includes(d.dataStatus);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {toggle && (
        <button className="ac-btn !px-2" onClick={toggle} aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${d.symbol} card`} data-testid={`button-collapse-card-${d.symbol}`}>
          {open ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
        </button>
      )}
      <span className="ac-num font-extrabold leading-none tracking-tight" style={{ fontSize: "var(--ac-ticker)" }} data-testid={`text-card-ticker-${d.symbol}`}>{d.symbol}</span>
      <span className="font-semibold" style={{ fontSize: "var(--ac-fs-sm)" }}>
        {d.setupType ? d.setupType.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : "No setup"}
        {d.setupTimeframe && <span className="ac-accent"> · {d.setupTimeframe}</span>}
      </span>
      <Badge tone={tone} Icon={Icon} testId={`text-ac-status-${d.symbol}`}>{STATUS_LABEL[d.setupStatus] ?? ACTION_GROUP_LABEL[group]}</Badge>
      <Badge tone="muted" testId={`badge-classification-${d.symbol}`}>Class: {CLASS_LABEL[d.cardGrade] ?? d.cardGrade}</Badge>
      <Badge tone={p.source === "USER" ? "accent" : "muted"} Icon={p.source === "USER" ? Pencil : undefined} testId={`text-ac-plan-source-${d.symbol}`}>
        {p.source === "USER" ? `My Adjusted Plan v${p.version}` : "Engine Plan"}
      </Badge>
      {isNew && <span className="rounded-full px-2.5 py-0.5 font-bold" style={{ fontSize: "var(--ac-fs-xs)", background: "var(--ac-accent-2)", color: "var(--ac-bg)" }} data-testid={`badge-new-plan-${d.symbol}`}>NEW PLAN</span>}
      <div className="ml-auto text-right" data-testid={`text-card-data-${d.symbol}`}>
        <span className="ac-num font-bold" style={{ fontSize: "calc(var(--ac-fs) * 1.2)" }}>{$(d.currentPrice)}</span>
        <span className="flex items-center gap-1 justify-end" style={{ fontSize: "var(--ac-fs-xs)" }}>
          {badData ? <AlertTriangle className="h-3.5 w-3.5 ac-bad" aria-hidden /> : <Clock className="h-3.5 w-3.5 ac-muted" aria-hidden />}
          <span className={badData ? "ac-bad font-semibold" : "ac-muted"}>Data {d.dataStatus}</span>
          <span className="ac-muted">· {d.dataSource ?? "—"} · {fmtCT(d.quoteTimestamp)}</span>
        </span>
      </div>
      {action}
      {!open && toggle && p.entry != null && (
        <div className="basis-full ac-num ac-muted" style={{ fontSize: "var(--ac-fs-sm)" }} data-testid={`text-card-summary-${d.symbol}`}>
          Entry {$(p.entry)} · Stop {$(p.stop)} · T1 {$(p.t1)} ({rTxt(p.rrT1) ?? "—"}) · T2 {$(p.t2)} ({rTxt(p.rrT2) ?? "—"}) · Risk/sh {$(p.risk)}
        </div>
      )}
    </div>
  );
}

// ─── Inline stat card (collapsible, remembered per setup) ────────────────────
export function InlineTradingCard(props: Omit<CardProps, "inDialog"> & { setupKey: string; isNew: boolean; onSeen: () => void }) {
  const { d, group, setupKey, isNew, onSeen } = props;
  const [open, setOpen] = useDisclosure(`card:${setupKey}`, true);
  const toggle = () => { setOpen(!open); onSeen(); };
  return (
    <article className="ac-card rounded-2xl overflow-hidden" style={{ borderLeft: `5px solid ${toneVar(TONE[group])}` }}
      aria-label={`${d.symbol} trading card: ${STATUS_LABEL[d.setupStatus]}`} data-testid={`card-ac-${d.symbol}`} data-group={group} data-open={open}>
      <div className="px-3 pt-2 sm:px-4 space-y-1 pb-1.5">
        <CardHeader d={d} group={group} ver={props.ver} isNew={isNew} open={open} toggle={toggle}
          action={!open && props.onOpen ? <button className="ac-btn ac-btn-primary !py-1" onClick={() => { onSeen(); props.onOpen!(); }} data-testid={`button-open-card-collapsed-${d.symbol}`}><Maximize2 className="h-4 w-4" aria-hidden /> Open Trading Card</button> : undefined} />
        <CriticalWarnings d={d} ver={props.ver} />
      </div>
      {open && <TradingCardBody {...props} onOpen={props.onOpen ? () => { onSeen(); props.onOpen!(); } : undefined} />}
    </article>
  );
}

// ─── Expanded dialog / mobile sheet ──────────────────────────────────────────
interface CtxResp { setupId: string; context: PlanContext; maxDollarRisk: number; minRrT1: number }

export function TradingCardDialog({ open, onClose, mode, setMode, ...props }: Omit<CardProps, "inDialog" | "onOpen" | "onAdjust"> & {
  open: boolean; onClose: () => void; mode: "view" | "adjust"; setMode: (m: "view" | "adjust") => void;
}) {
  const returnTo = useRef<HTMLElement | null>(null);
  useEffect(() => { if (open) returnTo.current = document.activeElement as HTMLElement | null; }, [open]);
  const { d, prefs } = props;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="p-0 border-0 bg-transparent shadow-none max-w-5xl w-[96vw] max-h-[94vh] overflow-y-auto max-sm:w-screen max-sm:max-w-none max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:rounded-none"
        onCloseAutoFocus={(e) => { e.preventDefault(); returnTo.current?.focus?.(); }}
        data-testid="dialog-trading-card">
        <div className="ac-root ac-shell rounded-2xl max-sm:rounded-none min-h-full" {...acAttrs(prefs)}>
          <div className="px-4 pt-4 sm:px-5 space-y-1.5 pr-12">
            <DialogTitle className="sr-only">Trading Card — {d.symbol}</DialogTitle>
            <DialogDescription className="sr-only">Practice-only analysis card for {d.symbol}. Not financial advice.</DialogDescription>
            <CardHeader d={d} group={props.group} ver={props.ver} />
            <CriticalWarnings d={d} ver={props.ver} />
          </div>
          {mode === "adjust" && canEditPlan(d)
            ? <AdjustPlan {...props} onDone={() => setMode("view")} />
            : <TradingCardBody {...props} inDialog onAdjust={canEditPlan(d) ? () => setMode("adjust") : undefined} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Adjust My Practice Plan ─────────────────────────────────────────────────
type RSel = { v: number | "custom"; custom: string };
const rVal = (s: RSel) => (s.v === "custom" ? Number(s.custom) : s.v);
const rSel = (n: number | undefined, def: number): RSel => { const x = n ?? def; return (R_CHOICES as readonly number[]).includes(x) ? { v: x, custom: "" } : { v: "custom", custom: String(x) }; };

function RPicker({ id, label, sel, onChange }: { id: string; label: string; sel: RSel; onChange: (s: RSel) => void }) {
  return (
    <label className="flex flex-col gap-1 min-w-0" style={{ fontSize: "var(--ac-fs-sm)" }}>
      <span className="font-bold">{label}</span>
      <div className="flex gap-2">
        <select className="ac-input" value={String(sel.v)} onChange={(e) => onChange({ ...sel, v: e.target.value === "custom" ? "custom" : Number(e.target.value) })} data-testid={`select-${id}`}>
          {R_CHOICES.map((r) => <option key={r} value={r}>{r}R</option>)}<option value="custom">Custom…</option>
        </select>
        {sel.v === "custom" && <input className="ac-input" type="number" step="0.1" min="0.1" aria-label={`${label} custom multiple`} value={sel.custom} onChange={(e) => onChange({ ...sel, custom: e.target.value })} data-testid={`input-${id}-custom`} />}
      </div>
    </label>
  );
}

export function AdjustPlan({ d, ver, equity, minRr, onDone }: Omit<CardProps, "inDialog" | "onOpen" | "onAdjust"> & { onDone: () => void }) {
  const ctxQ = useQuery<CtxResp>({ queryKey: ["/api/swing/plan-context", d.symbol], queryFn: () => swingGet(`/api/swing/plan-context/${encodeURIComponent(d.symbol)}`), staleTime: 30_000 });
  const p = effectivePlan(d, ver);
  const cs = (ver?.chartState ?? {}) as Record<string, any>;
  const [raw, setRaw] = useState({ entry: p.entry?.toFixed(2) ?? "", stop: p.stop?.toFixed(2) ?? "", stopLimit: p.stopLimit?.toFixed(2) ?? "", t1: p.t1?.toFixed(2) ?? "", t2: p.t2?.toFixed(2) ?? "" });
  const initialMethod: CardTargetMethod = (cs.targetMethod as CardTargetMethod) ?? (ver ? (ver.inputs.targetMethod === "R_MULTIPLE" ? "FIXED_R" : "MANUAL") : "ENGINE");
  const [method, setMethod] = useState<CardTargetMethod>(initialMethod);
  const [r1, setR1] = useState<RSel>(rSel(ver?.inputs.targetMethod === "R_MULTIPLE" ? ver.inputs.t1R : undefined, 2));
  const [r2s, setR2] = useState<RSel>(rSel(ver?.inputs.targetMethod === "R_MULTIPLE" ? ver.inputs.t2R : undefined, 3));
  const [ref1, setRef1] = useState<number | null>(cs.t1Ref ?? d.target1Ref?.price ?? null);
  const [ref2, setRef2] = useState<number | null>(cs.t2Ref ?? d.target2Ref?.price ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const num = (k: keyof typeof raw) => (raw[k].trim() === "" ? null : Number(raw[k]));
  const entry = num("entry"), stop = num("stop"), stopLimit = num("stopLimit");
  const levels = (d.structureLevels ?? []).filter((l) => entry != null && l.price > entry * 1.001);
  const structureOk = levels.length > 0;
  const ctx = ctxQ.data;
  const o = ctx?.context.original;
  const engineT = { t1: o?.t1 ?? d.target1, t2: o?.t2 ?? d.target2 };
  const choice: TargetChoice = {
    method, t1R: rVal(r1), t2R: rVal(r2s),
    t1Ref: method === "STRUCTURE" ? (ref1 != null && levels.some((l) => l.price === ref1) ? ref1 : levels[0]?.price ?? null) : null,
    t2Ref: method === "STRUCTURE" ? (ref2 != null && levels.some((l) => l.price === ref2) ? ref2 : null) : null,
    manualT1: num("t1"), manualT2: num("t2"),
  };
  if (method === "STRUCTURE" && choice.t2Ref == null) choice.t2R = rVal(r2s);
  const built = ctx && entry != null && stop != null && stopLimit != null ? inputsFromCardChoice(ctx.context, { entry, stop, stopLimit }, choice, engineT, ctx.maxDollarRisk, ctx.minRrT1) : null;
  const t1 = built?.resolved.t1 ?? null, t2 = built?.resolved.t2 ?? null;
  const errors = validateCardLevels({ entry, stop, stopLimit, t1, t2 });
  const R = plannedR(entry, stop);
  const result = useMemo(() => (ctx && built?.inputs && !Object.keys(errors).length ? recalcPlan(ctx.context, built.inputs) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx, JSON.stringify(built?.inputs), Object.keys(errors).join()]);
  const engineVal = { entry: o?.entry ?? d.entryPrice, stop: o?.stop ?? d.structuralStop, stopLimit: o?.stopLimit ?? null, t1: engineT.t1, t2: engineT.t2 };
  const isChanged = (v: number | null, e: number | null) => v != null && e != null && Math.abs(v - e) >= 0.005;
  const rr1 = rMultipleOf(entry, stop, t1), rr2 = rMultipleOf(entry, stop, t2);
  const ob1 = obstacleBefore(d.structureLevels, entry, t1), ob2 = obstacleBefore(d.structureLevels, entry, t2);
  const minRequired = ctx?.minRrT1 ?? minRr;

  const save = async () => {
    if (!ctx || !built?.inputs || !result) return;
    setBusy(true); setErr(null);
    try {
      await swingSend("POST", `/api/swing/plans/${encodeURIComponent(d.symbol)}`, {
        inputs: built.inputs, reason: `Adjusted on the trading card · target method: ${CARD_TARGET_METHOD_LABEL[method]}`,
        chartState: { source: "trading-card", targetMethod: method, t1Ref: choice.t1Ref, t2Ref: choice.t2Ref, t1R: choice.t1R, t2R: choice.t2R },
      });
      invalidatePlans(d.symbol); onDone();
    } catch (e: any) { setErr(e?.message ?? "Could not save"); }
    finally { setBusy(false); }
  };
  const reset = async () => { await selectPlanVersion(d.symbol, 0); setConfirmReset(false); onDone(); };
  const fieldErr = (k: keyof typeof errors) => errors[k] ? <span className="ac-bad font-semibold" data-testid={`error-adjust-${k}`}>{errors[k]}</span> : null;
  const priceField = (k: "entry" | "stop" | "stopLimit" | "t1" | "t2", label: string, help: string, eng: number | null) => (
    <div className="rounded-lg p-2.5" style={{ background: "var(--ac-surface)", border: "1px solid var(--ac-border)" }}>
      <label htmlFor={`adj-${k}`} className="font-bold block" style={{ fontSize: "var(--ac-fs-sm)" }}>{label}</label>
      <div className="ac-muted mb-1" style={{ fontSize: "var(--ac-fs-xs)" }}>{help}</div>
      <input id={`adj-${k}`} type="number" inputMode="decimal" step="0.01" min="0.01" className="ac-input" value={raw[k]}
        onChange={(e) => setRaw({ ...raw, [k]: e.target.value })} aria-invalid={!!errors[k]} aria-describedby={`adj-${k}-msg`} data-testid={`input-adjust-${k}`} />
      <div id={`adj-${k}-msg`} className="mt-1" style={{ fontSize: "var(--ac-fs-xs)" }}>
        {fieldErr(k) ?? <span className="ac-muted">Engine: <span className="ac-num">{$(eng)}</span>{isChanged(num(k), eng) && <b className="ac-accent"> · changed</b>}</span>}
      </div>
    </div>
  );
  const targetOut = (which: 1 | 2, price: number | null, rr: number | null, ob: StructureLevel | null, eng: number | null) => (
    <div className="rounded-lg p-2.5" style={{ background: "var(--ac-surface)", border: "1px solid var(--ac-border)", borderTop: "3px solid var(--ac-accent)" }} data-testid={`adj-target${which}`}>
      <div className="font-bold ac-accent" style={{ fontSize: "var(--ac-fs-xs)" }}>TARGET {which}</div>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="ac-num font-bold" style={{ fontSize: "calc(var(--ac-price) * .85)" }} data-testid={`adj-target${which}-price`}>{$(price)}</span>
        <span className="ac-num font-semibold ac-accent" data-testid={`adj-target${which}-r`}>{rTxt(rr) ?? "—"}</span>
      </div>
      <div className="ac-muted" style={{ fontSize: "var(--ac-fs-xs)" }}>Engine: <span className="ac-num">{$(eng)}</span>{isChanged(price, eng) && <b className="ac-accent"> · changed</b>}</div>
      {fieldErr(which === 1 ? "t1" : "t2")}
      {targetFlags(which, rr, minRequired, ob).map((f) => <div key={f.text} className="font-semibold flex gap-1" style={{ fontSize: "var(--ac-fs-xs)", color: toneVar(f.tone) }} data-testid={`adj-target${which}-flag`}><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-[2px]" aria-hidden />{f.text}</div>)}
    </div>
  );

  return (
    <div className="p-4 sm:p-5 space-y-3" data-testid={`panel-adjust-${d.symbol}`}>
      <div>
        <h3 className="font-bold" style={{ fontSize: "calc(var(--ac-fs) * 1.2)" }}>Adjust My Practice Plan</h3>
        <p className="ac-muted" style={{ fontSize: "var(--ac-fs-sm)" }}>
          Edits make <b>My Adjusted Plan</b> when saved. They don't change the engine's decision or place any order. Shares re-size to your existing risk budget ({ctx ? $(ctx.maxDollarRisk) : "…"} max; Target 1 minimum {ctx ? `${ctx.minRrT1}R` : "…"}).
        </p>
      </div>
      {ctxQ.isLoading && <div className="ac-muted">Loading the engine plan…</div>}
      {ctxQ.error && <div className="ac-bad" role="alert">{(ctxQ.error as Error).message.replace(/^\d{3}: /, "")}</div>}
      <div style={autoGrid(170)}>
        {priceField("entry", "Entry", "Planned starting price", engineVal.entry)}
        {priceField("stop", "Stop Loss (trigger)", "R is measured from this price", engineVal.stop)}
        {priceField("stopLimit", "Stop Limit (limit price)", "Lowest sell price after the trigger", engineVal.stopLimit)}
      </div>
      <div className="ac-muted ac-num" style={{ fontSize: "var(--ac-fs-xs)" }} data-testid="text-adjust-R">
        R = |entry − stop loss| = {R != null ? $(R) : "invalid (zero risk)"}. The stop-limit price is not used for R.
      </div>

      <fieldset className="rounded-xl p-3 space-y-2.5" style={{ border: "1px solid var(--ac-border)" }}>
        <legend className="font-bold px-1" style={{ fontSize: "var(--ac-fs-sm)" }}>Target Method</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Target method">
          {(["ENGINE", "FIXED_R", "STRUCTURE", "MANUAL"] as CardTargetMethod[]).map((m) => {
            const disabled = m === "STRUCTURE" && !structureOk;
            return (
              <button key={m} role="radio" aria-checked={method === m} disabled={disabled} onClick={() => setMethod(m)}
                className={`ac-btn ${method === m ? "ac-btn-primary" : ""}`} style={disabled ? { opacity: 0.5, cursor: "not-allowed" } : undefined} data-testid={`button-target-method-${m}`}
                title={disabled ? "No supported structure level above this entry" : undefined}>
                {CARD_TARGET_METHOD_LABEL[m]}
              </button>
            );
          })}
        </div>
        {!structureOk && <div className="ac-muted" style={{ fontSize: "var(--ac-fs-xs)" }} data-testid="text-structure-unavailable">Structure-Based is unavailable: the engine found no supported pivot-high resistance above this entry. Measured-move levels are not produced by the engine. Support levels apply to short targets, and this engine plans long only.</div>}
        <div className="ac-muted" style={{ fontSize: "var(--ac-fs-xs)" }}>{R_EXPLAIN}</div>

        {method === "FIXED_R" && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2 items-center"><span className="font-semibold" style={{ fontSize: "var(--ac-fs-sm)" }}>Quick presets:</span>
              {R_PRESETS.map(([a, b]) => (
                <button key={`${a}-${b}`} className="ac-btn" aria-pressed={rVal(r1) === a && rVal(r2s) === b} onClick={() => { setR1({ v: a, custom: "" }); setR2({ v: b, custom: "" }); }} data-testid={`button-preset-${a}-${b}`}>{a}R / {b}R</button>
              ))}
            </div>
            <div style={autoGrid(180)}>
              <RPicker id="t1r" label="Target 1 multiple" sel={r1} onChange={setR1} />
              <RPicker id="t2r" label="Target 2 multiple" sel={r2s} onChange={setR2} />
            </div>
          </div>
        )}
        {method === "STRUCTURE" && structureOk && (
          <div style={autoGrid(240)}>
            <label className="flex flex-col gap-1" style={{ fontSize: "var(--ac-fs-sm)" }}><span className="font-bold">Target 1 level</span>
              <select className="ac-input" value={String(choice.t1Ref ?? "")} onChange={(e) => setRef1(Number(e.target.value))} data-testid="select-structure-t1">
                {levels.map((l) => <option key={l.price} value={l.price}>{levelLabel(l)}</option>)}
              </select></label>
            <label className="flex flex-col gap-1" style={{ fontSize: "var(--ac-fs-sm)" }}><span className="font-bold">Target 2 level</span>
              <select className="ac-input" value={choice.t2Ref != null ? String(choice.t2Ref) : "fixed"} onChange={(e) => setRef2(e.target.value === "fixed" ? null : Number(e.target.value))} data-testid="select-structure-t2">
                {levels.filter((l) => choice.t1Ref == null || l.price > choice.t1Ref).map((l) => <option key={l.price} value={l.price}>{levelLabel(l)}</option>)}
                <option value="fixed">No further level: use a fixed multiple</option>
              </select></label>
            {choice.t2Ref == null && <RPicker id="t2r-structure" label="Target 2 fixed multiple" sel={r2s} onChange={setR2} />}
            <div className="ac-muted" style={{ fontSize: "var(--ac-fs-xs)" }}>Levels are 2-bar pivot highs on closed 1H / 4H / daily candles that the engine saw when this setup's plan was built.</div>
          </div>
        )}
        {method === "MANUAL" && (
          <div style={autoGrid(170)}>
            {priceField("t1", "Target 1 price", "Your first profit level", engineVal.t1)}
            {priceField("t2", "Target 2 price", "Your further profit level", engineVal.t2)}
          </div>
        )}
        {built?.resolved.error ? <div className="ac-bad font-semibold" role="alert" data-testid="text-target-error">{built.resolved.error}</div>
          : built?.resolved.why && <div style={{ fontSize: "var(--ac-fs-xs)" }} data-testid="text-target-why">{built.resolved.why}</div>}
        <div style={autoGrid(200)}>
          {targetOut(1, t1, rr1, ob1, engineVal.t1)}
          {targetOut(2, t2, rr2, ob2, engineVal.t2)}
        </div>
      </fieldset>

      {result && (
        <div className="space-y-2" data-testid={`panel-adjust-result-${d.symbol}`}>
          <div style={autoGrid(130)}>
            <Stat guided testId="adj-shares" k="Practice shares" v={String(result.shares)} explain="Re-sized to your risk budget." />
            <Stat guided testId="adj-value" k="Position value" v={$(result.capital)} explain="Shares × entry." />
            <Stat guided testId="adj-rps" k="Risk per share" v={$(result.riskPerShare)} explain="Entry − stop loss." />
            <Stat guided testId="adj-risk" k="Planned dollar risk" v={$(result.totalRisk)} explain="If all shares exit at the stop." />
            <Stat guided testId="adj-acct" k="Account risk" v={result.totalRisk != null && equity ? `${((result.totalRisk / equity) * 100).toFixed(2)}%` : "Not available"} explain="Dollar risk ÷ equity." />
            <Stat guided testId="adj-rr" k="Reward-to-risk" v={`T1 ${rTxt(result.rrT1) ?? "—"}\nT2 ${rTxt(result.rrT2) ?? "—"}`} explain="Separate scenarios." />
          </div>
          <ul className="space-y-0.5" style={{ fontSize: "var(--ac-fs-sm)" }}>
            <li><b>What changed:</b> {result.explain.whatChanged}</li>
            {result.messages.map((m) => <li key={m} className="ac-warn font-semibold">{m}</li>)}
            <li className="ac-muted">This plan {result.state === "VALID" ? "meets your rules" : "does not meet every rule"}. The engine's status stays <b>{STATUS_LABEL[d.setupStatus]}</b>. A distant target does not improve setup quality or make it more likely.</li>
          </ul>
        </div>
      )}
      <div className="rounded-lg px-3 py-1.5 font-semibold ac-warn" style={{ border: "1.5px dashed var(--ac-warn)", fontSize: "var(--ac-fs-xs)" }}>
        A stop-limit may not fill. Slippage and fees are not included. PRACTICE ONLY — NOT A BROKER ORDER.
      </div>
      {err && <div className="ac-bad font-semibold" role="alert" data-testid="text-adjust-error">{err}</div>}
      <div className="flex flex-wrap gap-2">
        <button className="ac-btn ac-btn-primary" disabled={busy || !result} onClick={save} data-testid="button-adjust-save"><Save className="h-4 w-4" aria-hidden /> {busy ? "Saving…" : "Save Changes"}</button>
        <button className="ac-btn" onClick={onDone} data-testid="button-adjust-cancel">Cancel</button>
        <button className="ac-btn" onClick={() => { setRaw({ entry: engineVal.entry?.toFixed(2) ?? "", stop: engineVal.stop?.toFixed(2) ?? "", stopLimit: engineVal.stopLimit?.toFixed(2) ?? "", t1: engineVal.t1?.toFixed(2) ?? "", t2: engineVal.t2?.toFixed(2) ?? "" }); setMethod("ENGINE"); }} data-testid="button-adjust-load-engine">
          Start from engine values</button>
        {ver && (confirmReset
          ? <span className="flex items-center gap-2"><span className="ac-warn font-semibold" style={{ fontSize: "var(--ac-fs-sm)" }}>Use the engine plan again? Your versions stay in history.</span>
              <button className="ac-btn" onClick={reset} data-testid="button-adjust-reset-confirm">Yes, reset</button>
              <button className="ac-btn" onClick={() => setConfirmReset(false)}>No</button></span>
          : <button className="ac-btn" onClick={() => setConfirmReset(true)} data-testid="button-adjust-reset"><Undo2 className="h-4 w-4" aria-hidden /> Reset to Engine Plan</button>)}
      </div>
    </div>
  );
}
