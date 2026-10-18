// ─── Trading Card (v2 Overhaul) ────────────────────────────────────────────
// The Action Center's stat-card view of one engine decision.
// PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE.

import LiveTickerCornerBadge from "./LiveTickerCornerBadge";
import { useLiveStatusLabel } from "@/lib/liveStatus";
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { addJournalEntry, levelsOf, snapshotOf } from "@/lib/journal";
import {
  AlertTriangle, BookOpen, Crosshair, Lock, CheckCircle2, ChevronDown, ChevronRight, CircleDashed, Clock, Eye, LineChart,
  Maximize2, MinusCircle, Pencil, RefreshCw, RotateCcw, ShieldAlert, Sprout, Ban, WifiOff, XCircle, Undo2, Save, Zap,
} from "lucide-react";
import { ScoreChip, ScoreSection } from "./SetupScore";
import { FundingPanel, useCardSizing } from "./FundingPanel";
import { MarketContextSection } from "./MarketContextSection";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { usePersistentState } from "@/hooks/use-persistent-state";
import type { StructureLevel, SwingDecision } from "@shared/swingDecision";
import { STATUS_LABEL, levelsInvalidOf } from "@shared/swingDecision";
import { readyStatusLabel, type LivePermission } from "@shared/readyAlerts";
import {
  ACTION_GROUP_LABEL, canEditPlan, engineChangedSince, enginePlanSig, inputsFromCardChoice, obstacleBefore, plannedR, recalcPlan, rMultipleOf,
  R_CHOICES, R_EXPLAIN, R_PRESETS, CARD_TARGET_METHOD_LABEL, validateCardLevels, suggestStops,
  type ActionGroup, type CardTargetMethod, type PlanContext, type PlanVersion, type TargetChoice,
} from "@shared/practicePlan";
import { fmtCT, swingGet, swingSend } from "@/lib/swing";
import { afterCardClose, effectivePlan, focusSymbol, invalidatePlans, openPlanEditor, selectPlanVersion } from "@/lib/plans";
import { defaultAlertFor, openAlertDialog } from "@/lib/alerts";
import { RefreshDataButton } from "./DataStatus";
import { PlanFreshness, saveTargetDefault } from "./PlanRefresh";
import { openTradeDialog, openTradeFor, useSwingTrades } from "@/lib/swingTrades";
import { useCardBg } from "./CardStyle";
import { ProximityTips } from "./ProximityTips";
import { useFreshness } from "@/lib/freshness";
import { replacesEngineStatus, rrText, STATE_LABEL, STATE_TONE, type FreshnessResult } from "@shared/cardFreshness";

// ─── UTILS & CONSTANTS ─────────────────────────────────────────────────────
const BAD_DATA = ["DELAYED", "STALE", "ERROR", "MISMATCH"];
const $ = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const rr1 = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}R`);
const rTxt = (r: number | null | undefined) => (r == null ? null : `${r.toFixed(2)}R`);

const ICON: Record<ActionGroup, typeof CheckCircle2> = { READY: CheckCircle2, CONFIRMED: Clock, FORMING: Sprout, RETEST: RotateCcw, EXTENDED: ShieldAlert, RR_STOP: Ban, DATA: WifiOff, NO_TRADE: MinusCircle };
const CLASS_LABEL: Record<string, string> = { A4_CORE: "Core", A3_SWING: "Standard", A2_PRACTICE: "Practice (half size)", WATCH: "Watch", NO_TRADE: "No trade" };
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
const TF_EXPLAIN: Record<string, string> = {
  "1H": "1-hour setup: each candle represents one hour of price activity.",
  "4H": "4-hour setup: each candle represents four hours of price activity.",
  "1D": "Daily setup: each candle represents one trading day.",
  "1W": "Weekly setup: each candle represents one trading week.",
};

export const LiveCtx = createContext<LivePermission | null>(null);

export function statusText(d: SwingDecision, group: ActionGroup, live: LivePermission | null, f?: FreshnessResult | null): string {
  if (f && overridesStatus(d, f)) return f.displayStatus;
  return readyStatusLabel(d.setupStatus, live) || STATUS_LABEL[d.setupStatus] || ACTION_GROUP_LABEL[group];
}

export const overridesStatus = replacesEngineStatus;

const TONE_CLASSES = {
  good: "text-signal-green border-signal-green/40 bg-signal-green/10",
  warn: "text-signal-amber border-signal-amber/40 bg-signal-amber/10",
  bad: "text-signal-red border-signal-red/40 bg-signal-red/10",
  accent: "text-neon-blue border-neon-blue/40 bg-neon-blue/10",
  muted: "text-slate-gray border-ink-line bg-ink-deep/40",
};

export const freshTone = (d: SwingDecision, group: ActionGroup, f?: FreshnessResult | null): keyof typeof TONE_CLASSES => {
  const map: Record<ActionGroup, keyof typeof TONE_CLASSES> = { READY: "good", CONFIRMED: "accent", FORMING: "warn", RETEST: "accent", EXTENDED: "warn", RR_STOP: "bad", DATA: "bad", NO_TRADE: "muted" };
  if (f && overridesStatus(d, f)) {
    return STATE_TONE[f.state] === "good" ? "warn" : (STATE_TONE[f.state] as keyof typeof TONE_CLASSES);
  }
  return map[group];
};

export const setupName = (t: string | null) => (t ? t.replace(/_/g, " ").toLowerCase().replace(/(^|[\s-])\w/g, (c) => c.toUpperCase()) : "No setup");

// ─── FRESHNESS PANEL ───────────────────────────────────────────────────────
export function FreshnessPanel({ d, f, p }: { d: SwingDecision; f: FreshnessResult; p: { entry: number | null; stop: number | null; t1: number | null } }) {
  const nt = !f.isTradeable;
  const rrLow = f.liveRr == null || f.liveRr < f.minRr;
  const riskUp = f.liveRiskPerShare > f.plannedRiskPerShare + 0.005;

  const Box = ({ label, value, warn, colorClass }: { label: string; value: React.ReactNode; warn?: boolean; colorClass?: string }) => (
    <div className={`flex flex-col gap-1 rounded-lg border p-3 ${warn || colorClass ? colorClass || "border-signal-amber/40 bg-signal-amber/5" : "border-ink-line bg-ink-deep/40"}`}>
      <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-gray">{label}</span>
      <span className={`text-sm font-mono font-bold ${warn || colorClass ? colorClass?.split(" ")[0] || "text-signal-amber" : "text-soft-white"}`}>{value}</span>
    </div>
  );

  return (
    <div className={`flex flex-col gap-3 rounded-lg border p-4 shadow-sm ${nt ? "border-signal-amber/40 bg-signal-amber/5" : "border-ink-line bg-ink-black/40"}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-gray">
          <Clock className="h-4 w-4" /> {f.confirmedAtText} · {f.ageBarsUsed}/{f.ageBarsTotal} 4H bars
        </span>
        {f.sessionTag && <span className="rounded-md border border-ink-line bg-ink-deep/40 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-gray">{f.sessionTag}</span>}
      </div>

      {nt && (
        <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-slate-gray">
          <span className="line-through opacity-70">Original plan: Entry {$(p.entry)} · Stop {$(p.stop)} · T1 {$(p.t1)}</span>
          <span className="opacity-50">|</span>
          <span className="font-bold text-soft-white">Retest zone: {$(f.retestZone.low)} – {$(f.retestZone.high)}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Box label="Planned R:R" value={rr1(f.plannedRr)} />
        <Box label="Live R:R" value={<>{rrText(f.liveRr, f.minRr)}R {rrLow && <span className="text-[10px]">· below {f.minRr.toFixed(0)}R min</span>}</>} warn={rrLow} />
        <Box label="Live risk/share" value={<>{$(f.liveRiskPerShare)} <span className="text-[10px] font-medium text-slate-gray">(was {$(f.plannedRiskPerShare)})</span></>} warn={riskUp} />
        <Box label="Freshness" value={STATE_LABEL[f.state]} colorClass={nt ? "text-signal-amber border-signal-amber/40 bg-signal-amber/10" : "text-signal-green border-signal-green/40 bg-signal-green/10"} />
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-ink-line bg-ink-deep/40 p-3">
        {f.checklist.map((c) => (
          <div key={c.label} className="flex items-center gap-2 text-xs font-medium">
            <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${c.passed ? "bg-signal-green/20 text-signal-green" : "bg-signal-red/20 text-signal-red"}`}>
              {c.passed ? "✓" : "✗"}
            </span>
            <span className="text-soft-white">{c.label}</span>
            {c.valueText && <span className="font-mono text-[10px] text-slate-gray">{c.valueText}</span>}
          </div>
        ))}
        {f.resetConditionText && <div className="mt-1 border-t border-ink-line/60 pt-2 text-xs font-medium text-soft-white"><span className="font-bold text-neon-blue">Resets when:</span> {f.resetConditionText}</div>}
      </div>

      {f.aiTip && <div className="rounded-lg border border-neon-blue/30 bg-neon-blue/10 p-3 text-xs font-medium leading-relaxed text-neon-blue">{f.aiTip}</div>}
    </div>
  );
}

// ─── APPEARANCE ────────────────────────────────────────────────────────────
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
    <div className="flex flex-col gap-4 rounded-lg border border-ink-line bg-ink-deep/40 p-4">
      <div className="flex flex-col gap-2">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-gray">Theme</span>
        <div className="flex flex-wrap gap-2">
          {AC_THEMES.map((t) => (
            <button key={t.id} onClick={() => set({ theme: t.id })}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${prefs.theme === t.id ? "border-neon-blue bg-neon-blue/10 text-neon-blue" : "border-ink-line bg-ink-black text-slate-gray hover:text-soft-white"}`}>
              <div className="flex overflow-hidden rounded border border-ink-line/50">
                {t.sw.map((c) => <span key={c} style={{ background: c, width: 12, height: 16 }} />)}
              </div>
              {t.name}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-gray">Font</span>
          <select className="rounded-md border border-ink-line bg-ink-black px-3 py-1.5 text-xs text-soft-white focus:border-neon-blue" value={prefs.font} onChange={(e) => set({ font: e.target.value as AcPrefs["font"] })}>
            <option value="modern">Modern (Inter)</option><option value="desk">Trading Desk (Inter + IBM Plex Mono)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-gray">Size</span>
          <select className="rounded-md border border-ink-line bg-ink-black px-3 py-1.5 text-xs text-soft-white focus:border-neon-blue" value={prefs.size} onChange={(e) => set({ size: e.target.value as AcPrefs["size"] })}>
            <option value="standard">Standard</option><option value="large">Large</option><option value="xl">Extra Large</option>
          </select>
        </label>
      </div>
    </div>
  );
}

function StatusPill({ d, f, tone, Icon, text }: { d: SwingDecision; f: FreshnessResult; tone: keyof typeof TONE_CLASSES; Icon?: typeof CheckCircle2; text: string }) {
  const cls = TONE_CLASSES[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-mono font-bold uppercase tracking-wider ${cls}`}>
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />}{text}
    </span>
  );
}

// ─── SHARED LOGIC ──────────────────────────────────────────────────────────
export function stopBreach(d: SwingDecision, stop: number | null, t1?: number | null): { text: string; short: string; tone: "bad" | "warn"; kind?: "BELOW_STOP" | "PAST_T1" } | null {
  if (t1 != null && d.currentPrice != null && !(stop != null && d.currentPrice < stop)) {
    const inv = levelsInvalidOf(d, { entry: d.entryPrice, stop, t1 });
    if (inv?.kind === "PAST_T1") return { text: inv.text, short: inv.short, tone: "bad", kind: "PAST_T1" };
  }
  if (d.currentPrice == null || stop == null || !(d.currentPrice < stop)) return null;
  if (d.setupStatus === "SIGNAL_EXPIRED") return { text: "This setup has ended. These levels are history only.", short: "Ended — levels are history only", tone: "bad" };
  return {
    text: `Price ${$(d.currentPrice)} is below the planned stop ${$(stop)}. If the next 1H bar closes below it, this setup is cancelled.`,
    short: `LEVELS INVALID — price below stop ${$(stop)}`,
    tone: "warn", kind: "BELOW_STOP",
  };
}

export function nextStepFor(d: SwingDecision, group: ActionGroup, ver: PlanVersion | null): { text: string; tone: keyof typeof TONE_CLASSES } {
  const trig = d.currentTrigger ?? d.originalTrigger;
  if (d.setupStatus === "SIGNAL_EXPIRED") return { text: "This setup is no longer valid.", tone: "bad" };
  if (group === "DATA" || BAD_DATA.includes(d.dataStatus)) return { text: "Verify the data before using any level on this card.", tone: "bad" };
  const br = stopBreach(d, d.structuralStop, d.target1);
  if (br) return { text: br.text, tone: br.tone };
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

export function targetSources(d: SwingDecision, ver: PlanVersion | null, minRr: number | null): { t1: string; t2: string } {
  if (ver) {
    const m = (ver.chartState?.targetMethod as CardTargetMethod | undefined);
    const lab = m ? CARD_TARGET_METHOD_LABEL[m] : ver.inputs.targetMethod === "R_MULTIPLE" ? "Fixed R" : ver.inputs.targetMethod === "RESISTANCE" ? "Resistance" : "Manual Prices";
    const fx = ver.inputs.targetMethod === "R_MULTIPLE";
    return { t1: `My plan · ${lab}${fx ? ` (${ver.inputs.t1R}R)` : ""}`, t2: `My plan · ${lab}${fx ? ` (${ver.inputs.t2R}R)` : ""}` };
  }
  const pt = d.planTargets;
  if (pt && pt.method !== "ENGINE") {
    const eng = (t: number | null, rr: number | null) => `Engine structure target ${t != null ? `$${t.toFixed(2)}` : "—"}${rr != null ? ` (${rr.toFixed(2)}R)` : ""} stays the readiness check.`;
    const how = pt.method === "FIXED_R" ? (m: number | null) => `Default · Fixed R: entry + ${m}R × $${(d.riskPerShare ?? 0).toFixed(2)}.` : () => "Default · Structure-Based.";
    return { t1: `${how(pt.t1R)} ${eng(d.target1, d.rewardRiskT1)}`, t2: `${how(pt.t2R)} ${eng(d.target2, d.rewardRiskT2)}` };
  }
  const t1 = d.target1Source === "resistance" ? `Engine · nearest resistance above entry` : d.target1Source === "r-multiple" ? `Engine · no resistance above entry, so entry + ${minRr ?? "min"}R` : "Engine plan";
  const t2 = d.target2Source === "resistance" ? `Engine · next resistance beyond Target 1` : d.target2Source === "r-multiple" ? "Engine · no resistance beyond Target 1, so entry + 3 × R" : "Engine plan";
  return { t1, t2 };
}

function targetFlags(which: 1 | 2, rr: number | null, minRr: number | null, obstacle: StructureLevel | null): { text: string; tone: string }[] {
  const out: { text: string; tone: string }[] = [];
  if (rr != null) {
    if (which === 1 && minRr != null && minRr > 0 && rr + 1e-9 < minRr) out.push({ text: `Below your ${minRr}R minimum for Target 1.`, tone: "warn" });
    else if (rr < 1) out.push({ text: "Below 1R.", tone: "muted" });
  }
  if (obstacle) out.push({ text: `Resistance ${$(obstacle.price)} sits before this target.`, tone: "warn" });
  return out;
}

// ─── DISCLOSURE STATE ──────────────────────────────────────────────────────
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

export function Section({ id, title, summary, def = true, children, testId }: { id: string; title: string; summary?: React.ReactNode; def?: boolean; children: React.ReactNode; testId: string }) {
  const [open, setOpen] = useDisclosure(id, def);
  return (
    <section className="flex flex-col rounded-lg border border-ink-line bg-ink-black/40" data-testid={testId} data-open={open}>
      <button className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-ink-deep/40" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-gray" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-gray" />}
        <span className="text-sm font-bold text-soft-white">{title}</span>
        {summary != null && <span className="min-w-0 truncate text-xs font-medium text-slate-gray">{summary}</span>}
      </button>
      {open && <div className="p-4 pt-0">{children}</div>}
    </section>
  );
}

// ─── CARD COMPONENTS ───────────────────────────────────────────────────────
function PriceTile({ label, sub, value, tone, guided, engineValue, changed, moved, rText, source, flags }: any) {
  const cls = TONE_CLASSES[tone as keyof typeof TONE_CLASSES] || TONE_CLASSES.muted;
  return (
    <div className={`flex flex-col gap-1.5 rounded-lg border p-3 ${cls.split(" ")[1]} bg-ink-deep/40`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-[10px] font-mono font-bold uppercase tracking-wider ${cls.split(" ")[0]}`}>{label}</span>
        {changed && <span className="rounded bg-neon-blue/20 px-1.5 py-0.5 text-[9px] font-bold text-neon-blue">ADJUSTED</span>}
        {moved && <span className="rounded border border-neon-blue/40 px-1.5 py-0.5 text-[9px] font-bold text-neon-blue">UPDATED · was {moved}</span>}
      </div>
      {guided && <span className="text-[10px] leading-snug text-slate-gray">{sub}</span>}
      <span className="text-lg font-mono font-bold tabular-nums text-soft-white">{value}</span>
      {rText && <span className="text-sm font-mono font-bold tabular-nums text-neon-blue">{rText}</span>}
      {changed && engineValue != null && <span className="text-[10px] font-mono text-slate-gray">Engine: {engineValue}</span>}
      {source && <span className="text-[10px] text-slate-gray">{source}</span>}
      {flags?.map((f: any) => (
        <span key={f.text} className={`flex items-start gap-1 text-[10px] font-medium leading-snug ${f.tone === "warn" ? "text-signal-amber" : "text-signal-red"}`}>
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {f.text}
        </span>
      ))}
    </div>
  );
}

function Stat({ k, v, explain, guided }: any) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-ink-line bg-ink-deep/40 p-3">
      <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-gray">{k}</span>
      <span className="text-sm font-mono font-bold tabular-nums leading-tight text-soft-white whitespace-pre-line">{v}</span>
      {guided && <span className="text-[10px] leading-snug text-slate-gray">{explain}</span>}
    </div>
  );
}

export interface CardProps {
  d: SwingDecision; group: ActionGroup; ver: PlanVersion | null; equity: number | null; expiryBars: number; minRr: number | null;
  prefs: AcPrefs; inDialog?: boolean; onOpen?: () => void; onAdjust?: () => void;
}

export function CriticalWarnings({ d, ver }: { d: SwingDecision; ver: PlanVersion | null }) {
  const p = effectivePlan(d, ver);
  const expired = d.setupStatus === "SIGNAL_EXPIRED";
  const badData = BAD_DATA.includes(d.dataStatus) || d.setupStatus === "BLOCKED_DATA_MISMATCH";
  const br = stopBreach(d, p.stop, p.t1);
  const invalidPlan = ver != null && ver.result.state === "INVALID";
  const tone = expired || badData || invalidPlan || br?.tone !== "warn" ? "bad" : "warn";
  const cls = TONE_CLASSES[tone];

  return (
    <div className="flex flex-col gap-2">
      {(expired || badData || br || invalidPlan) && (
        <div className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-xs font-bold ${cls}`}>
          {tone === "bad" ? <XCircle className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
          {expired ? "Expired setup: these levels are history only." : badData ? `Data ${d.dataStatus}: don't rely on these levels until the data is verified.` : br ? br.text : "My Adjusted Plan is invalid: entry must be above the stop."}
        </div>
      )}
      <PlanFreshness d={d} adjusted={ver != null} />
      <span className="text-[10px] font-bold uppercase tracking-wider text-signal-amber">
        PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE · OVERNIGHT GAP RISK — STOP ORDERS CAN FILL BELOW STOP PRICE.
      </span>
    </div>
  );
}

export function TradingCardBody({ d, group, ver, equity, expiryBars, minRr, prefs, inDialog, onOpen, onAdjust }: CardProps) {
  const guided = prefs.view === "guided";
  const scope = `${inDialog ? "dlg" : "card"}:${d.symbol}`;
  const p = effectivePlan(d, ver);
  const populated = p.entry != null && p.stop != null;
  const changed = new Set(ver?.result.changedFields ?? []);
  const mv = (f: string) => { const c = !ver && d.planRefresh?.changedAt ? d.planRefresh.changes.find((x) => x.field === f) : null; return c ? $(c.from) : null; };
  const engine = { entry: d.entryPrice, stop: d.structuralStop, t1: d.target1, t2: d.target2 };
  
  const fr = useFreshness()(d, ver);
  const step0 = nextStepFor(d, group, ver);
  const step = overridesStatus(d, fr) && step0.tone === "good" ? { text: fr.resetConditionText ? `Don't chase. Resets when: ${fr.resetConditionText}.` : "Not tradeable yet. Wait for a fresh setup.", tone: "warn" as const } : step0;
  
  const sz = useCardSizing(d, ver);
  const src = targetSources(d, ver, minRr);
  const ob1 = obstacleBefore(d.structureLevels, p.entry, p.t1), ob2 = obstacleBefore(d.structureLevels, p.entry, p.t2);

  return (
    <div className={`flex flex-col gap-4 ${inDialog ? "p-4 sm:p-6" : "p-4 pt-0"}`}>
      {fr.hasLevels && (overridesStatus(d, fr) || d.setupStatus === "READY_TO_TRADE") && <FreshnessPanel d={d} f={fr} p={p} />}
      
      {guided && <p className="text-sm font-medium leading-relaxed text-slate-gray">{STATUS_EXPLAIN[d.setupStatus] ?? d.nextAction}</p>}

      {group !== "NO_TRADE" && (
        <Section id={`${scope}:ready`} title="Readiness" testId={`sec-ready-${d.symbol}`} summary={`${d.passedRules.length} passed · ${d.missingConditions.length} missing`}>
          <ExtensionLine d={d} />
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-signal-green"><CheckCircle2 className="h-4 w-4" /> Passed</span>
              <ul className="flex flex-col gap-1 text-xs text-soft-white">{d.passedRules.slice(0, 6).map((x) => <li key={x}>• {x}</li>)}</ul>
            </div>
            <div className="flex flex-col gap-2">
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-signal-amber"><CircleDashed className="h-4 w-4" /> Missing</span>
              <ul className="flex flex-col gap-1 text-xs text-soft-white">{(d.missingConditions.length ? d.missingConditions : d.whyNotReady).slice(0, 5).map((x) => <li key={x}>• {x}</li>)}</ul>
            </div>
            <div className="flex flex-col gap-2">
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-neon-blue"><Eye className="h-4 w-4" /> Watch next</span>
              <span className="text-xs leading-relaxed text-soft-white">{group === "CONFIRMED" ? `A closed 1H candle above ${$(d.currentTrigger ?? d.originalTrigger)}.` : d.nextAction}</span>
            </div>
          </div>
        </Section>
      )}

      {populated ? (
        <Section id={`${scope}:levels`} title="Trade Levels & Target Method" testId={`sec-levels-${d.symbol}`} summary={`Entry ${$(p.entry)} · Stop ${$(p.stop)} · T1 ${$(p.t1)}`}>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <span className={`rounded-md border px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider ${p.source === "USER" ? "border-neon-blue/40 bg-neon-blue/10 text-neon-blue" : "border-ink-line bg-ink-deep/40 text-slate-gray"}`}>
              Target method: {ver ? (CARD_TARGET_METHOD_LABEL[ver.chartState?.targetMethod as CardTargetMethod] ?? "Adjusted") : (d.planTargets?.label ?? "Engine Original")}
            </span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-gray">R = |entry − stop loss| = <strong className="text-soft-white">{$(p.risk)}</strong></span>
          </div>

          <div className={`grid grid-cols-2 gap-4 sm:grid-cols-5 ${stopBreach(d, p.stop, p.t1) ? "opacity-50 grayscale" : ""}`}>
            <PriceTile moved={mv("entry")} label="ENTRY" sub="Planned starting price" value={$(p.entry)} tone="good" guided={guided} changed={changed.has("entry")} engineValue={$(engine.entry)} />
            <PriceTile moved={mv("stop")} label="STOP LOSS" sub="Protective exit trigger" value={$(p.stop)} tone="bad" guided={guided} changed={changed.has("stop")} engineValue={$(engine.stop)} />
            <PriceTile moved={mv("stopLimit")} label="STOP LIMIT" sub="Lowest limit price" value={p.stopLimit != null ? $(p.stopLimit) : "Not configured"} tone="bad" guided={guided} />
            <PriceTile moved={mv("t1")} label="TARGET 1" sub="First profit level" value={$(p.t1)} tone="accent" guided={guided} rText={rTxt(p.rrT1)} changed={changed.has("target1")} engineValue={$(engine.t1)} source={src.t1} flags={targetFlags(1, p.rrT1, minRr, ob1)} />
            <PriceTile moved={mv("t2")} label="TARGET 2" sub="Further level" value={$(p.t2)} tone="accent" guided={guided} rText={rTxt(p.rrT2)} changed={changed.has("target2")} engineValue={$(engine.t2)} source={src.t2} flags={targetFlags(2, p.rrT2, minRr, ob2)} />
          </div>
        </Section>
      ) : (
        <div className="rounded-lg border border-ink-line bg-ink-deep/40 p-4 text-sm font-medium text-slate-gray">
          No plan yet. The engine fills in Entry, Stop Loss and Targets once the setup has enough structure.
        </div>
      )}

      {populated && <FundingPanel d={d} ver={ver} scope={scope} sz={sz} />}
      <ScoreSection d={d} scope={scope} />
      <ProximityTips symbol={d.symbol} stamp={d.evaluatedAt} variant="card" />
      <MarketContextSection d={d} p={p} scope={scope} />

      <div className={`flex flex-col gap-2 rounded-lg border p-4 ${TONE_CLASSES[step.tone]}`}>
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider opacity-80">NEXT STEP</span>
        <span className="text-lg font-bold leading-snug">{step.text}</span>
      </div>

      <CardActions d={d} group={group} ver={ver} inDialog={inDialog} onOpen={onOpen} onAdjust={onAdjust} sizedShares={sz.sizing.ok && !sz.override ? sz.sizing.shares : null} />
    </div>
  );
}

export function LastBarLine({ d }: { d: SwingDecision }) {
  return (
    <span className="text-[10px] font-medium text-slate-gray">
      Last bar evaluated: 1H · 4H closed
    </span>
  );
}

export function ExtensionLine({ d }: { d: SwingDecision }) {
  const x = d.extensionCheck;
  if (!x) return (
    <div className="mb-4 flex items-center gap-2 text-xs font-medium text-slate-gray">
      <CircleDashed className="h-4 w-4" /> Not extended — checked against live quote after 1H confirmation.
    </div>
  );
  return (
    <div className={`mb-4 flex flex-wrap items-center gap-3 text-xs ${x.extended ? "font-bold text-signal-amber" : "font-medium text-soft-white"}`}>
      {x.extended ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4 text-signal-green" />}
      <span>{x.extended ? "Extended — do not chase" : "Not extended"}</span>
      <span className="font-mono text-slate-gray">{x.pct}% vs {x.fromLabel}</span>
    </div>
  );
}

function CardActions({ d, group, ver, inDialog, onOpen, onAdjust, sizedShares = null }: any) {
  const { toast } = useToast();
  const journal = useMutation({
    mutationFn: () => addJournalEntry({ action: "PRACTICE_TRADE", symbol: d.symbol, notes: "Saved from trading card", levels: levelsOf(effectivePlan(d, ver)), snapshot: snapshotOf(d) }),
    onSuccess: (r) => toast({ title: `Saved to practice journal — ${d.symbol}` }),
  });

  return (
    <div className="flex flex-wrap items-center gap-3 pt-2">
      {group === "READY" && <button className="flex items-center gap-2 rounded-md border border-signal-green/50 bg-signal-green/10 px-4 py-2 text-xs font-bold text-signal-green transition-colors hover:bg-signal-green/20" onClick={() => {}}><Crosshair className="h-4 w-4" /> Arm Trade</button>}
      {!inDialog && onOpen && <button className="flex items-center gap-2 rounded-md border border-neon-blue/50 bg-neon-blue/10 px-4 py-2 text-xs font-bold text-neon-blue transition-colors hover:bg-neon-blue/20" onClick={onOpen}><Maximize2 className="h-4 w-4" /> Open Trading Card</button>}
      {canEditPlan(d) && onAdjust && <button className="flex items-center gap-2 rounded-md border border-ink-line bg-ink-deep/40 px-4 py-2 text-xs font-medium text-soft-white transition-colors hover:border-neon-blue hover:text-neon-blue" onClick={onAdjust}><Pencil className="h-4 w-4" /> Adjust My Practice Plan</button>}
      <button className="flex items-center gap-2 rounded-md border border-ink-line bg-ink-deep/40 px-4 py-2 text-xs font-medium text-soft-white transition-colors hover:border-neon-blue hover:text-neon-blue" onClick={() => focusSymbol(d.symbol)}><LineChart className="h-4 w-4" /> Open Chart</button>
      {group === "READY" && <button className="rounded-md border border-ink-line bg-ink-black px-4 py-2 text-xs font-medium text-slate-gray transition-colors hover:bg-ink-deep hover:text-soft-white" disabled={journal.isPending} onClick={() => journal.mutate()}>{journal.isPending ? "Saving…" : "Save to Journal"}</button>}
    </div>
  );
}

export function LockedNotice({ symbol }: { symbol: string }) {
  const tradesQ = useSwingTrades();
  const t = openTradeFor(tradesQ.data?.trades, symbol);
  if (!t) return null;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-neon-blue/50 bg-neon-blue/10 p-3 text-xs">
      <Lock className="h-4 w-4 text-neon-blue" />
      <span className="font-bold text-neon-blue">Locked — {t.status} practice trade #{t.id}</span>
      <span className="font-mono text-slate-gray">Your levels: entry {$(t.entry)} · stop {$(t.stop)} · T1 {$(t.t1)}</span>
    </div>
  );
}

export function PendingChip({ d }: { d: SwingDecision }) {
  if (!d.evalPending) return null;
  return <span className="flex items-center gap-2 rounded-md border border-ink-line bg-ink-deep/40 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-gray"><RefreshCw className="h-3 w-3 animate-spin" /> Evaluating…</span>;
}

function CardHeader({ d, group, ver, isNew, open, toggle, action }: any) {
  const p = effectivePlan(d, ver);
  const live = useContext(LiveCtx);
  const f = useFreshness()(d, ver);
  const tone = freshTone(d, group, f), Icon = overridesStatus(d, f) ? AlertTriangle : ICON[group];

  return (
    <div className="flex flex-wrap items-center gap-3">
      {toggle && <button className="rounded p-1 text-slate-gray hover:bg-ink-line hover:text-soft-white" onClick={toggle}>{open ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}</button>}
      <span className="text-2xl font-bold tracking-tight text-soft-white">{d.symbol}</span>
      <span className="text-sm font-medium text-slate-gray">{setupName(d.setupType)}{d.setupTimeframe && <span className="text-neon-blue"> · {d.setupTimeframe}</span>}</span>
      
      <StatusPill d={d} f={f} tone={tone} Icon={Icon} text={statusText(d, group, live, f)} />
      
      <span className={`rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${p.source === "USER" ? "border-neon-blue/40 bg-neon-blue/10 text-neon-blue" : "border-ink-line bg-ink-deep/40 text-slate-gray"}`}>
        {p.source === "USER" ? `My Plan v${p.version}` : "Engine Plan"}
      </span>
      {isNew && <span className="rounded-md bg-neon-blue/20 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-neon-blue">NEW PLAN</span>}
      <PendingChip d={d} />

      <div className="ml-auto flex flex-col items-end gap-1">
        <span className="text-xl font-mono font-bold text-soft-white">{$(d.currentPrice)}</span>
        <span className="text-[10px] font-medium text-slate-gray">Data {d.dataStatus} · {fmtCT(d.quoteTimestamp)}</span>
      </div>
    </div>
  );
}

export const readyVariant = (d: SwingDecision, live: LivePermission | null | undefined, f?: FreshnessResult | null): "live" | "practice" | null =>
  d.setupStatus !== "READY_TO_TRADE" || (f && !f.isTradeable) ? null : live && !live.allowed ? "practice" : "live";

export function ReadyRibbon({ d, ver = null }: { d: SwingDecision; ver?: PlanVersion | null }) {
  const live = useContext(LiveCtx);
  const f = useFreshness()(d, ver);
  const v = readyVariant(d, live, f);
  
  if (!v) return overridesStatus(d, f) ? (
    <div className="flex w-full items-center justify-center gap-2 bg-signal-amber/20 py-2 text-[10px] font-bold uppercase tracking-wider text-signal-amber">
      <AlertTriangle className="h-3.5 w-3.5" /> {f.displayStatus} · PRACTICE ONLY
    </div>
  ) : null;

  return v === "live" ? (
    <div className="flex w-full items-center justify-center gap-2 bg-signal-green/20 py-2 text-[10px] font-bold uppercase tracking-wider text-signal-green">
      <Zap className="h-3.5 w-3.5" /> READY TO TRADE · LIVE RISK ALLOWED
    </div>
  ) : (
    <div className="flex w-full items-center justify-center gap-2 bg-signal-amber/20 py-2 text-[10px] font-bold uppercase tracking-wider text-signal-amber">
      <ShieldAlert className="h-3.5 w-3.5" /> PRACTICE READY · LIVE ENTRY NOT PERMITTED
    </div>
  );
}

export function SignalAgeLine({ d, short }: any) {
  if (!d.signalAge) return null;
  return <span className="text-[10px] font-medium text-slate-gray"><Clock className="inline h-3 w-3 mr-1" /> Confirmed {d.signalAge.bars4h} 4H bars ago</span>;
}
export function EarlyLookLine({ d }: any) {
  if (!d.earlyLook) return null;
  return <span className="text-[10px] font-bold text-signal-amber"><Eye className="inline h-3 w-3 mr-1" /> Heads up: 30m closed above trigger</span>;
}

export function InlineTradingCard(props: Omit<CardProps, "inDialog"> & { setupKey: string; isNew: boolean; onSeen: () => void }) {
  const { d, group, setupKey, isNew, onSeen } = props;
  const [open, setOpen] = useDisclosure(`card:${setupKey}`, false);
  const toggle = () => { setOpen(!open); onSeen(); };
  
  return (
    <article className="flex flex-col overflow-hidden rounded-lg border border-ink-line bg-ink-black shadow-sm transition-colors hover:border-ink-line/80">
      <ReadyRibbon d={d} ver={props.ver} />
      {open ? (
        <>
          <div className="flex flex-col gap-4 border-b border-ink-line/50 p-4">
            <CardHeader d={d} group={group} ver={props.ver} isNew={isNew} open={open} toggle={toggle} />
            <CriticalWarnings d={d} ver={props.ver} />
          </div>
          <TradingCardBody {...props} onOpen={props.onOpen ? () => { onSeen(); props.onOpen!(); } : undefined} />
        </>
      ) : <CompactRow {...props} toggle={toggle} />}
    </article>
  );
}

function CompactRow(props: Omit<CardProps, "inDialog"> & { setupKey: string; isNew: boolean; onSeen: () => void; toggle: () => void }) {
  const { d, group, ver, isNew, toggle } = props;
  const live = useContext(LiveCtx);
  const p = effectivePlan(d, ver);
  const f = useFreshness()(d, ver);
  const tone = freshTone(d, group, f), Icon = overridesStatus(d, f) ? AlertTriangle : ICON[group];

  return (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-6">
      <div className="flex items-center gap-3">
        <button className="rounded p-1 text-slate-gray hover:bg-ink-line hover:text-soft-white" onClick={toggle}><ChevronRight className="h-5 w-5" /></button>
        <span className="text-lg font-bold tracking-tight text-soft-white">{d.symbol}</span>
        <StatusPill d={d} f={f} tone={tone} Icon={Icon} text={statusText(d, group, live, f)} />
      </div>
      
      <div className="flex flex-1 flex-wrap items-center gap-4 text-sm font-mono text-slate-gray">
        {p.entry != null ? (
          <>
            <span>Entry <strong className="text-soft-white">{$(p.entry)}</strong></span>
            <span>Stop <strong className="text-soft-white">{$(p.stop)}</strong></span>
            <span>T1 <strong className="text-soft-white">{$(p.t1)}</strong></span>
            <span>Risk/sh <strong className="text-soft-white">{$(p.risk)}</strong></span>
          </>
        ) : <span>{d.nextAction || "No plan levels yet."}</span>}
      </div>

      <div className="flex items-center gap-4">
        <span className="text-lg font-mono font-bold text-soft-white">{$(d.currentPrice)}</span>
        {props.onOpen && <button className="rounded-md border border-neon-blue/50 bg-neon-blue/10 px-3 py-1.5 text-xs font-bold text-neon-blue transition-colors hover:bg-neon-blue/20" onClick={() => { props.onSeen(); props.onOpen!(); }}><Maximize2 className="h-4 w-4" /></button>}
      </div>
    </div>
  );
}

export function TradingCardDialog({ open, onClose, mode, setMode, ...props }: Omit<CardProps, "inDialog" | "onOpen" | "onAdjust"> & { open: boolean; onClose: () => void; mode: "view" | "adjust"; setMode: (m: "view" | "adjust") => void; }) {
  const { d } = props;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] w-[95vw] max-w-5xl overflow-y-auto rounded-xl border border-ink-line bg-ink-black p-0 shadow-2xl">
        <div className="flex flex-col">
          <ReadyRibbon d={d} ver={props.ver} />
          <div className="flex flex-col gap-4 border-b border-ink-line/50 p-6">
            <DialogTitle className="sr-only">Trading Card — {d.symbol}</DialogTitle>
            <CardHeader d={d} group={props.group} ver={props.ver} />
            <CriticalWarnings d={d} ver={props.ver} />
            <LockedNotice symbol={d.symbol} />
          </div>
          {mode === "adjust" && canEditPlan(d) ? <AdjustPlan {...props} onDone={() => setMode("view")} /> : <TradingCardBody {...props} inDialog onAdjust={canEditPlan(d) ? () => setMode("adjust") : undefined} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RPicker({ id, label, sel, onChange }: any) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-bold text-slate-gray">{label}</span>
      <div className="flex gap-2">
        <select className="rounded-md border border-ink-line bg-ink-black px-3 py-2 text-sm text-soft-white focus:border-neon-blue" value={String(sel.v)} onChange={(e) => onChange({ ...sel, v: e.target.value === "custom" ? "custom" : Number(e.target.value) })}>
          {R_CHOICES.map((r) => <option key={r} value={r}>{r}R</option>)}<option value="custom">Custom…</option>
        </select>
        {sel.v === "custom" && <input className="rounded-md border border-ink-line bg-ink-black px-3 py-2 text-sm text-soft-white focus:border-neon-blue" type="number" step="0.1" min="0.1" value={sel.custom} onChange={(e) => onChange({ ...sel, custom: e.target.value })} />}
      </div>
    </label>
  );
}

export function AdjustPlan({ d, ver, equity, minRr, onDone }: Omit<CardProps, "inDialog" | "onOpen" | "onAdjust"> & { onDone: () => void }) {
  const p = effectivePlan(d, ver);
  const [raw, setRaw] = useState({ entry: p.entry?.toFixed(2) ?? "", stop: p.stop?.toFixed(2) ?? "", stopLimit: p.stopLimit?.toFixed(2) ?? "", t1: p.t1?.toFixed(2) ?? "", t2: p.t2?.toFixed(2) ?? "" });
  
  const priceField = (k: "entry" | "stop" | "stopLimit" | "t1" | "t2", label: string, help: string) => (
    <div className="flex flex-col gap-2 rounded-lg border border-ink-line bg-ink-deep/40 p-4">
      <label htmlFor={`adj-${k}`} className="text-xs font-bold uppercase tracking-wider text-slate-gray">{label}</label>
      <span className="text-[10px] text-slate-gray/80">{help}</span>
      <input id={`adj-${k}`} type="number" step="0.01" min="0.01" className="rounded-md border border-ink-line bg-ink-black px-3 py-2 font-mono text-sm text-soft-white focus:border-neon-blue focus:outline-none" value={raw[k]} onChange={(e) => setRaw({ ...raw, [k]: e.target.value })} />
    </div>
  );

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h3 className="text-xl font-bold text-soft-white">Adjust My Practice Plan</h3>
        <p className="text-sm font-medium leading-relaxed text-slate-gray">
          Edits make <b>My Adjusted Plan</b> when saved. They don't change the engine's decision or place any order.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {priceField("entry", "Entry", "Planned starting price")}
        {priceField("stop", "Stop Loss", "R is measured from this price")}
        {priceField("stopLimit", "Stop Limit", "Lowest sell price after trigger")}
      </div>

      <div className="flex flex-wrap items-center gap-4 border-t border-ink-line/50 pt-4">
        <button className="flex items-center gap-2 rounded-md border border-neon-blue/50 bg-neon-blue/10 px-6 py-2.5 text-sm font-bold text-neon-blue transition-colors hover:bg-neon-blue/20" onClick={onDone}><Save className="h-4 w-4" /> Save Changes</button>
        <button className="rounded-md border border-ink-line bg-ink-deep/40 px-6 py-2.5 text-sm font-medium text-soft-white transition-colors hover:border-slate-gray hover:text-slate-gray" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}


