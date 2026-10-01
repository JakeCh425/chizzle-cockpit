// Trading Card — the Action Center's stat-card view of one engine decision, plus the expanded
// dialog / mobile sheet and "Adjust My Practice Plan". Everything shown comes from the shared
// SwingDecision and the existing practice-plan math (recalcPlan); nothing here changes engine
// readiness, and nothing here can send an order. PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, BookOpen, CheckCircle2, ChevronDown, ChevronRight, CircleDashed, Clock, Eye, Hourglass, LineChart,
  Maximize2, MinusCircle, Pencil, RotateCcw, ShieldAlert, Sprout, Ban, WifiOff, XCircle, Undo2, Save,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { usePersistentState } from "@/hooks/use-persistent-state";
import type { SwingDecision } from "@shared/swingDecision";
import { STATUS_LABEL } from "@shared/swingDecision";
import {
  ACTION_GROUP_LABEL, canEditPlan, engineChangedSince, enginePlanSig, inputsFromCardLevels, recalcPlan, validateCardLevels,
  type ActionGroup, type CardLevels, type PlanContext, type PlanVersion,
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
] as const;
export type AcTheme = typeof AC_THEMES[number]["id"];
export interface AcPrefs { theme: AcTheme; font: "modern" | "desk"; size: "standard" | "large" | "xl"; view: "guided" | "compact" }
export const DEFAULT_AC_PREFS: AcPrefs = { theme: "signature", font: "desk", size: "standard", view: "guided" };
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

// ─── Small building blocks ───────────────────────────────────────────────────
function Badge({ tone, Icon, children, testId }: { tone: string; Icon?: typeof CheckCircle2; children: React.ReactNode; testId?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-semibold" data-testid={testId}
      style={{ fontSize: "var(--ac-fs-xs)", color: toneVar(tone), border: `1.5px solid ${toneVar(tone)}` }}>
      {Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}{children}
    </span>
  );
}
function SectionTitle({ n, children }: { n: number; children: React.ReactNode }) {
  return <h4 className="font-bold flex items-center gap-2 mb-1.5" style={{ fontSize: "var(--ac-fs)" }}><span className="ac-num ac-muted" style={{ fontSize: "var(--ac-fs-xs)" }}>{n}</span>{children}</h4>;
}
function PriceTile({ label, sub, value, tone, explain, guided, engineValue, changed, testId }: {
  label: string; sub: string; value: string; tone: string; explain: string; guided: boolean; engineValue?: string | null; changed?: boolean; testId: string;
}) {
  return (
    <div className="ac-tile rounded-xl p-3 flex flex-col gap-1 min-w-0" style={{ borderTop: `3px solid ${toneVar(tone)}` }} data-testid={testId}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-bold tracking-wide" style={{ fontSize: "var(--ac-fs-xs)", color: toneVar(tone) }}>{label}</span>
        {changed && <span className="rounded px-1.5 font-semibold" style={{ fontSize: "11px", background: "var(--ac-accent)", color: "var(--ac-on-accent)" }} data-testid={`${testId}-changed`}>ADJUSTED</span>}
      </div>
      <div className="ac-muted font-medium" style={{ fontSize: "var(--ac-fs-xs)" }}>{sub}</div>
      <div className="ac-num font-bold leading-none my-1" style={{ fontSize: "var(--ac-price)" }} data-testid={`${testId}-value`}>{value}</div>
      {changed && engineValue != null && <div className="ac-muted ac-num" style={{ fontSize: "var(--ac-fs-xs)" }}>Engine: {engineValue}</div>}
      {guided && <p className="ac-muted leading-snug" style={{ fontSize: "var(--ac-fs-xs)" }}>{explain}</p>}
    </div>
  );
}
function Stat({ k, v, explain, guided, testId }: { k: string; v: string; explain: string; guided: boolean; testId: string }) {
  return (
    <div className="ac-tile rounded-xl p-2.5 min-w-0" data-testid={testId}>
      <div className="font-semibold ac-muted" style={{ fontSize: "var(--ac-fs-xs)" }}>{k}</div>
      <div className="ac-num font-bold whitespace-pre-line leading-tight" style={{ fontSize: v.length > 12 ? "var(--ac-fs)" : "calc(var(--ac-fs) * 1.3)" }} data-testid={`${testId}-value`}>{v}</div>
      {guided && <div className="ac-muted leading-snug mt-0.5" style={{ fontSize: "var(--ac-fs-xs)" }}>{explain}</div>}
    </div>
  );
}

// ─── The card body (used inline and in the dialog) ───────────────────────────
export interface CardProps {
  d: SwingDecision; group: ActionGroup; ver: PlanVersion | null; equity: number | null; expiryBars: number;
  prefs: AcPrefs; inDialog?: boolean; onOpen?: () => void; onAdjust?: () => void;
}

export function TradingCardBody({ d, group, ver, equity, expiryBars, prefs, inDialog, onOpen, onAdjust }: CardProps) {
  const guided = prefs.view === "guided";
  const p = effectivePlan(d, ver);
  const tone = TONE[group], Icon = ICON[group];
  const populated = p.entry != null && p.stop != null;
  const expired = d.setupStatus === "SIGNAL_EXPIRED";
  const badData = BAD_DATA.includes(d.dataStatus) || d.setupStatus === "BLOCKED_DATA_MISMATCH";
  const invalidated = d.currentPrice != null && p.stop != null && d.currentPrice < p.stop;
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
  const passed = d.passedRules.slice(0, guided ? 6 : 3);
  const missing = (d.missingConditions.length ? d.missingConditions : d.whyNotReady).slice(0, guided ? 5 : 3);
  const trig = d.currentTrigger ?? d.originalTrigger;
  const pad = inDialog ? "p-5 sm:p-6" : "p-4";

  return (
    <div className={`space-y-4 ${pad}`}>
      {/* Header — what am I watching? */}
      <header className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="ac-num font-extrabold leading-none tracking-tight" style={{ fontSize: "var(--ac-ticker)" }} data-testid={`text-card-ticker-${d.symbol}`}>{d.symbol}</span>
            <span className="ac-muted" style={{ fontSize: "var(--ac-fs-sm)" }}>{d.exchange}</span>
          </div>
          <div className="mt-1 font-semibold" style={{ fontSize: "var(--ac-fs-sm)" }}>
            {d.setupType ? d.setupType.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : "No setup"}
            {d.setupTimeframe && <> · <span className="ac-accent">{d.setupTimeframe} setup</span></>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Badge tone={tone} Icon={Icon} testId={`text-ac-status-${d.symbol}`}>{STATUS_LABEL[d.setupStatus] ?? ACTION_GROUP_LABEL[group]}</Badge>
          <Badge tone="muted" testId={`badge-classification-${d.symbol}`}>Classification: {CLASS_LABEL[d.cardGrade] ?? d.cardGrade}</Badge>
          <Badge tone={p.source === "USER" ? "accent" : "muted"} Icon={p.source === "USER" ? Pencil : undefined} testId={`text-ac-plan-source-${d.symbol}`}>
            {p.source === "USER" ? `My Adjusted Plan v${p.version}` : "Engine Plan"}
          </Badge>
        </div>
        <div className="sm:ml-auto text-right" data-testid={`text-card-data-${d.symbol}`}>
          <div className="ac-num font-bold" style={{ fontSize: "calc(var(--ac-fs) * 1.25)" }}>{$(d.currentPrice)}</div>
          <div className="flex items-center gap-1 justify-end" style={{ fontSize: "var(--ac-fs-xs)" }}>
            {badData ? <AlertTriangle className="h-3.5 w-3.5 ac-bad" aria-hidden /> : <Clock className="h-3.5 w-3.5 ac-muted" aria-hidden />}
            <span className={badData ? "ac-bad font-semibold" : "ac-muted"}>Data {d.dataStatus}</span>
            <span className="ac-muted">· {d.dataSource ?? "—"} · as of {fmtCT(d.quoteTimestamp)}</span>
          </div>
        </div>
      </header>
      {guided && (
        <p className="ac-muted -mt-2" style={{ fontSize: "var(--ac-fs-sm)" }}>
          {d.setupTimeframe ? TF_EXPLAIN[d.setupTimeframe] ?? "" : ""} Classification describes the setup's quality and size tier. It is not a readiness signal.
        </p>
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

      {/* 2 — Is it ready? */}
      <section aria-label="Is it ready?">
        <SectionTitle n={1}>Is it ready?</SectionTitle>
        <p className="font-semibold" style={{ fontSize: "var(--ac-fs)", color: toneVar(tone) }} data-testid={`text-card-status-explain-${d.symbol}`}>
          {STATUS_EXPLAIN[d.setupStatus] ?? d.nextAction}
        </p>
        {(group !== "NO_TRADE") && (
          <div className="grid sm:grid-cols-3 gap-3 mt-2">
            <div className="ac-tile rounded-xl p-3">
              <div className="font-bold ac-good flex items-center gap-1.5" style={{ fontSize: "var(--ac-fs-sm)" }}><CheckCircle2 className="h-4 w-4" aria-hidden /> Passed</div>
              <ul className="mt-1 space-y-0.5" style={{ fontSize: "var(--ac-fs-sm)" }} data-testid={`list-passed-${d.symbol}`}>{passed.length ? passed.map((x) => <li key={x}>{x}</li>) : <li className="ac-muted">Nothing yet.</li>}</ul>
            </div>
            <div className="ac-tile rounded-xl p-3">
              <div className="font-bold ac-warn flex items-center gap-1.5" style={{ fontSize: "var(--ac-fs-sm)" }}><CircleDashed className="h-4 w-4" aria-hidden /> Still missing</div>
              <ul className="mt-1 space-y-0.5" style={{ fontSize: "var(--ac-fs-sm)" }} data-testid={`list-missing-${d.symbol}`}>{missing.length ? missing.map((x) => <li key={x}>{x}</li>) : <li className="ac-muted">Nothing. All conditions passed.</li>}</ul>
            </div>
            <div className="ac-tile rounded-xl p-3">
              <div className="font-bold ac-accent flex items-center gap-1.5" style={{ fontSize: "var(--ac-fs-sm)" }}><Eye className="h-4 w-4" aria-hidden /> Watch next</div>
              <div className="mt-1" style={{ fontSize: "var(--ac-fs-sm)" }}>
                {group === "CONFIRMED" ? `A closed 1H candle above ${$(trig)}. Expires after ${expiryBars} completed 4H bar${expiryBars === 1 ? "" : "s"}${d.expiryTime ? ` (${fmtCT(d.expiryTime)})` : ""}.` : d.nextAction}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 3 — The plan */}
      {populated ? (
        <section aria-label="My plan">
          <SectionTitle n={2}>What is the plan?</SectionTitle>
          {(expired || invalidated || badData) && (
            <div className="rounded-lg px-3 py-2 mb-2 font-semibold ac-bad flex items-center gap-2" style={{ border: "1.5px solid var(--ac-bad)", fontSize: "var(--ac-fs-sm)" }} data-testid={`banner-levels-caution-${d.symbol}`}>
              <XCircle className="h-4 w-4" aria-hidden />
              {expired ? "Expired setup: these levels are history only." : invalidated ? "Price is below the stop: this plan is invalidated." : "Data not verified: don't rely on these levels until the data is LIVE."}
            </div>
          )}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <PriceTile testId={`tile-entry-${d.symbol}`} label="ENTRY" sub="Planned starting price" value={$(p.entry)} tone="good" guided={guided}
              explain="The price where this practice plan assumes you enter. It is not a confirmed purchase or a guaranteed fill." changed={changed.has("entry")} engineValue={$(engine.entry)} />
            <PriceTile testId={`tile-stop-${d.symbol}`} label="STOP LOSS" sub="Planned exit if the trade goes against you" value={$(p.stop)} tone="bad" guided={guided}
              explain="The stop trigger: where the plan calls for an exit to limit the loss. The actual exit price may differ." changed={changed.has("stop")} engineValue={$(engine.stop)} />
            <PriceTile testId={`tile-stoplimit-${d.symbol}`} label="STOP LIMIT" sub="Lowest price your sell limit accepts" value={p.stopLimit != null ? $(p.stopLimit) : "Not configured"} tone="bad" guided={guided}
              explain={p.stopLimit != null
                ? `Protective stop-limit sell. When price trades at or below the stop trigger (${$(p.stop)}), a limit sell at ${$(p.stopLimit)} or better is used. If price gaps below ${$(p.stopLimit)}, it may not fill.${p.source === "SYSTEM" ? " Engine default: 0.2% below the stop (at least $0.05)." : ""}`
                : "No stop is set, so no stop-limit price exists."} />
            <PriceTile testId={`tile-t1-${d.symbol}`} label="TARGET 1" sub="First planned profit level" value={$(p.t1)} tone="accent" guided={guided}
              explain="The first price where you plan to take some or all profit, according to your exit plan. Not guaranteed." changed={changed.has("target1")} engineValue={$(engine.t1)} />
            <PriceTile testId={`tile-t2-${d.symbol}`} label="TARGET 2" sub="Further profit level" value={$(p.t2)} tone="accent" guided={guided}
              explain="A further profit level for any position remaining after Target 1. Not guaranteed." changed={changed.has("target2")} engineValue={$(engine.t2)} />
          </div>
        </section>
      ) : (
        <section aria-label="My plan" className="ac-tile rounded-xl p-3" data-testid={`text-plan-pending-${d.symbol}`}>
          <SectionTitle n={2}>What is the plan?</SectionTitle>
          <p style={{ fontSize: "var(--ac-fs-sm)" }}>No plan yet. The engine fills in Entry, Stop Loss and Targets once the setup has enough structure.{trig != null ? ` Estimated trigger: ${$(trig)}.` : ""}</p>
        </section>
      )}

      {/* 4 — Risk */}
      {populated && (
        <section aria-label="How much am I risking?">
          <SectionTitle n={3}>How much am I risking?</SectionTitle>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Stat testId={`stat-shares-${d.symbol}`} guided={guided} k="Practice shares" v={shares != null ? String(shares) : "—"} explain="Planned number of shares, sized to your risk budget." />
            <Stat testId={`stat-value-${d.symbol}`} guided={guided} k="Position value" v={$(posValue)} explain="Estimated money allocated (shares × entry)." />
            <Stat testId={`stat-rps-${d.symbol}`} guided={guided} k="Risk per share" v={$(p.risk)} explain="Distance between entry and stop." />
            <Stat testId={`stat-risk-${d.symbol}`} guided={guided} k="Planned dollar risk" v={$(totalRisk)} explain="Estimated loss if all shares exit exactly at the stop." />
            <Stat testId={`stat-acct-${d.symbol}`} guided={guided} k="Account risk" v={acctPct != null ? `${acctPct.toFixed(2)}%` : "Not available"} explain={!equity ? "Set account equity in Settings → Risk Profile." : totalRisk == null ? "Shown once practice shares are sized." : `Planned dollar risk ÷ account equity (${$(equity)}).`} />
            <Stat testId={`stat-rr-${d.symbol}`} guided={guided} k="Reward-to-risk" v={p.rrT1 != null ? `T1 ${p.rrT1.toFixed(2)}R\nT2 ${p.rrT2 != null ? `${p.rrT2.toFixed(2)}R` : "—"}` : "Not calculated yet"} explain="Potential reward compared with planned risk." />
          </div>
          {guided && (
            <ul className="mt-2 space-y-0.5" style={{ fontSize: "var(--ac-fs-sm)" }} data-testid={`list-rr-explain-${d.symbol}`}>
              {p.rrT1 != null && <li>At Target 1, this plan models <b className="ac-num">${p.rrT1.toFixed(2)}</b> of potential reward for each $1 of planned risk.</li>}
              {p.rrT2 != null && <li>At Target 2, this plan models <b className="ac-num">${p.rrT2.toFixed(2)}</b> of potential reward for each $1 of planned risk.</li>}
              {p.rrT1 == null && <li className="ac-muted">The engine calculates reward-to-risk once the setup confirms.</li>}
              <li className="ac-muted">Each target is a separate scenario. Don't add them together.</li>
            </ul>
          )}
        </section>
      )}

      {/* Warnings — always visible, Guided and Compact */}
      <div className="rounded-xl px-3 py-2 space-y-0.5 font-semibold ac-warn" style={{ border: "1.5px dashed var(--ac-warn)", fontSize: "var(--ac-fs-xs)" }} data-testid={`card-warnings-${d.symbol}`}>
        <div>OVERNIGHT GAP RISK — STOP ORDERS CAN FILL BELOW STOP PRICE.</div>
        <div>A stop-limit may not fill during a fast decline or gap. Slippage and fees are not included.</div>
        <div>PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE. Nothing here places an order.</div>
      </div>

      {/* 5 — Next step */}
      <section aria-label="Next step" className="rounded-xl p-3" style={{ border: `2px solid ${toneVar(step.tone)}` }} data-testid={`card-next-step-${d.symbol}`}>
        <div className="font-bold ac-muted" style={{ fontSize: "var(--ac-fs-xs)" }}>NEXT STEP</div>
        <div className="font-bold" style={{ fontSize: "calc(var(--ac-fs) * 1.2)", color: toneVar(step.tone) }} data-testid={`text-next-step-${d.symbol}`}>{step.text}</div>
        {guided && step.text !== d.nextAction && <div className="ac-muted mt-0.5" style={{ fontSize: "var(--ac-fs-sm)" }}>Engine note: {d.nextAction}</div>}
      </section>

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

// ─── Inline stat card (collapsible, remembered per setup) ────────────────────
export function InlineTradingCard(props: Omit<CardProps, "inDialog"> & { setupKey: string; isNew: boolean; onSeen: () => void }) {
  const { d, group, setupKey, isNew, onSeen } = props;
  const [collapsedMap, setCollapsedMap] = usePersistentState<Record<string, boolean>>("ac-card-collapsed", {});
  const collapsed = collapsedMap[setupKey] ?? false;
  const p = effectivePlan(d, props.ver);
  const tone = TONE[group], Icon = ICON[group];
  const toggle = () => { setCollapsedMap({ ...collapsedMap, [setupKey]: !collapsed }); onSeen(); };
  return (
    <article className="ac-card rounded-2xl overflow-hidden" style={{ borderLeft: `6px solid ${toneVar(tone)}` }}
      aria-label={`${d.symbol} trading card: ${STATUS_LABEL[d.setupStatus]}`} data-testid={`card-ac-${d.symbol}`} data-group={group}>
      <div className="flex items-center gap-3 px-4 pt-3">
        <button className="ac-btn !px-2" onClick={toggle} aria-expanded={!collapsed} aria-label={`${collapsed ? "Expand" : "Collapse"} ${d.symbol} card`} data-testid={`button-collapse-card-${d.symbol}`}>
          {collapsed ? <ChevronRight className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
        </button>
        {isNew && <span className="rounded-full px-2.5 py-0.5 font-bold" style={{ fontSize: "var(--ac-fs-xs)", background: "var(--ac-accent-2)", color: "var(--ac-bg)" }} data-testid={`badge-new-plan-${d.symbol}`}>NEW PLAN</span>}
        {collapsed && (
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            <span className="ac-num font-extrabold" style={{ fontSize: "calc(var(--ac-ticker) * .7)" }}>{d.symbol}</span>
            <span className="inline-flex items-center gap-1 font-semibold" style={{ color: toneVar(tone), fontSize: "var(--ac-fs-sm)" }}><Icon className="h-4 w-4" aria-hidden />{STATUS_LABEL[d.setupStatus]}</span>
            {p.entry != null && <span className="ac-num ac-muted" style={{ fontSize: "var(--ac-fs-sm)" }}>Entry {$(p.entry)} · Stop {$(p.stop)} · T1 {$(p.t1)}</span>}
          </div>
        )}
        {collapsed && props.onOpen && <button className="ac-btn ac-btn-primary ml-auto" onClick={() => { onSeen(); props.onOpen!(); }} data-testid={`button-open-card-collapsed-${d.symbol}`}><Maximize2 className="h-4 w-4" aria-hidden /> Open Trading Card</button>}
      </div>
      {!collapsed && <TradingCardBody {...props} onOpen={props.onOpen ? () => { onSeen(); props.onOpen!(); } : undefined} />}
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
        className="p-0 border-0 bg-transparent shadow-none max-w-6xl w-[96vw] max-h-[94vh] overflow-y-auto max-sm:w-screen max-sm:max-w-none max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:rounded-none"
        onCloseAutoFocus={(e) => { e.preventDefault(); returnTo.current?.focus?.(); }}
        data-testid="dialog-trading-card">
        <div className="ac-root ac-shell rounded-2xl max-sm:rounded-none min-h-full" {...acAttrs(prefs)}>
          <div className="flex items-center gap-3 px-5 pt-4 sm:px-6">
            <DialogTitle className="font-bold" style={{ fontSize: "var(--ac-fs)" }}>Trading Card — {d.symbol}</DialogTitle>
            <DialogDescription className="ac-warn font-semibold" style={{ fontSize: "var(--ac-fs-xs)" }}>PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE</DialogDescription>
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
type Field = keyof CardLevels;
const FIELDS: { k: Field; label: string; help: string }[] = [
  { k: "entry", label: "Entry", help: "Planned starting price" },
  { k: "stop", label: "Stop Loss (trigger)", help: "Exit trigger if the trade goes against you" },
  { k: "stopLimit", label: "Stop Limit (limit price)", help: "Lowest price your sell limit accepts after the trigger" },
  { k: "t1", label: "Target 1", help: "First planned profit level" },
  { k: "t2", label: "Target 2", help: "Further profit level" },
];

export function AdjustPlan({ d, ver, equity, onDone }: Omit<CardProps, "inDialog" | "onOpen" | "onAdjust"> & { onDone: () => void }) {
  const ctxQ = useQuery<CtxResp>({ queryKey: ["/api/swing/plan-context", d.symbol], queryFn: () => swingGet(`/api/swing/plan-context/${encodeURIComponent(d.symbol)}`), staleTime: 30_000 });
  const p = effectivePlan(d, ver);
  const seed = (): Record<Field, string> => ({
    entry: p.entry?.toFixed(2) ?? "", stop: p.stop?.toFixed(2) ?? "", stopLimit: p.stopLimit?.toFixed(2) ?? "", t1: p.t1?.toFixed(2) ?? "", t2: p.t2?.toFixed(2) ?? "",
  });
  const [raw, setRaw] = useState<Record<Field, string>>(seed);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const num = (k: Field) => (raw[k].trim() === "" ? null : Number(raw[k]));
  const levels = { entry: num("entry"), stop: num("stop"), stopLimit: num("stopLimit"), t1: num("t1"), t2: num("t2") };
  const errors = validateCardLevels(levels);
  const ctx = ctxQ.data;
  const result = useMemo(() => {
    if (!ctx || Object.keys(errors).length) return null;
    return recalcPlan(ctx.context, inputsFromCardLevels(ctx.context, levels as CardLevels, ctx.maxDollarRisk, ctx.minRrT1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, raw.entry, raw.stop, raw.stopLimit, raw.t1, raw.t2]);
  const o = ctx?.context.original;
  const engineVal: Record<Field, number | null> = { entry: o?.entry ?? d.entryPrice, stop: o?.stop ?? d.structuralStop, stopLimit: o?.stopLimit ?? null, t1: o?.t1 ?? d.target1, t2: o?.t2 ?? d.target2 };
  const isChanged = (k: Field) => levels[k] != null && engineVal[k] != null && Math.abs((levels[k] as number) - (engineVal[k] as number)) >= 0.005;

  const save = async () => {
    if (!ctx || !result) return;
    setBusy(true); setErr(null);
    try {
      const inputs = inputsFromCardLevels(ctx.context, levels as CardLevels, ctx.maxDollarRisk, ctx.minRrT1);
      await swingSend("POST", `/api/swing/plans/${encodeURIComponent(d.symbol)}`, { inputs, reason: "Adjusted on the trading card", chartState: { source: "trading-card" } });
      invalidatePlans(d.symbol); onDone();
    } catch (e: any) { setErr(e?.message ?? "Could not save"); }
    finally { setBusy(false); }
  };
  const reset = async () => { await selectPlanVersion(d.symbol, 0); setConfirmReset(false); onDone(); };
  const shares = result?.shares ?? null;
  const acct = result?.totalRisk != null && equity ? (result.totalRisk / equity) * 100 : null;

  return (
    <div className="p-5 sm:p-6 space-y-4" data-testid={`panel-adjust-${d.symbol}`}>
      <div>
        <h3 className="font-bold" style={{ fontSize: "calc(var(--ac-fs) * 1.25)" }}>Adjust My Practice Plan — {d.symbol}</h3>
        <p className="ac-muted mt-1" style={{ fontSize: "var(--ac-fs-sm)" }}>
          Try different prices to see how they change your planned risk and potential reward. Your edits don't change the engine's decision and don't place any order.
          Shares are re-sized to your existing risk budget ({ctx ? $(ctx.maxDollarRisk) : "…"} max, T1 minimum {ctx ? `${ctx.minRrT1}R` : "…"}).
        </p>
      </div>
      {ctxQ.isLoading && <div className="ac-muted">Loading the engine plan…</div>}
      {ctxQ.error && <div className="ac-bad" role="alert">{(ctxQ.error as Error).message.replace(/^\d{3}: /, "")}</div>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {FIELDS.map((f) => (
          <div key={f.k} className="ac-tile rounded-xl p-3">
            <label htmlFor={`adj-${f.k}`} className="font-bold block" style={{ fontSize: "var(--ac-fs-sm)" }}>{f.label}</label>
            <div className="ac-muted mb-1.5" style={{ fontSize: "var(--ac-fs-xs)" }}>{f.help}</div>
            <input id={`adj-${f.k}`} type="number" inputMode="decimal" step="0.01" min="0.01" className="ac-input" value={raw[f.k]}
              onChange={(e) => setRaw({ ...raw, [f.k]: e.target.value })} aria-invalid={!!errors[f.k]} aria-describedby={`adj-${f.k}-msg`} data-testid={`input-adjust-${f.k}`} />
            <div id={`adj-${f.k}-msg`} className="mt-1" style={{ fontSize: "var(--ac-fs-xs)" }}>
              {errors[f.k] ? <span className="ac-bad font-semibold" data-testid={`error-adjust-${f.k}`}>{errors[f.k]}</span>
                : <span className="ac-muted">Engine: <span className="ac-num">{$(engineVal[f.k])}</span>{isChanged(f.k) && <b className="ac-accent"> · changed</b>}</span>}
            </div>
          </div>
        ))}
      </div>

      {result && (
        <div className="space-y-3" data-testid={`panel-adjust-result-${d.symbol}`}>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Stat guided testId="adj-shares" k="Practice shares" v={String(shares)} explain="Re-sized to your risk budget." />
            <Stat guided testId="adj-value" k="Position value" v={$(result.capital)} explain="Shares × entry." />
            <Stat guided testId="adj-rps" k="Risk per share" v={$(result.riskPerShare)} explain="Entry − stop." />
            <Stat guided testId="adj-risk" k="Planned dollar risk" v={$(result.totalRisk)} explain="If all shares exit at the stop." />
            <Stat guided testId="adj-acct" k="Account risk" v={acct != null ? `${acct.toFixed(2)}%` : "Not available"} explain="Dollar risk ÷ equity." />
            <Stat guided testId="adj-rr" k="Reward-to-risk" v={`T1 ${result.rrT1 != null ? `${result.rrT1.toFixed(2)}R` : "—"}\nT2 ${result.rrT2 != null ? `${result.rrT2.toFixed(2)}R` : "—"}`} explain="Separate scenarios. Don't add them." />
          </div>
          <ul className="space-y-0.5" style={{ fontSize: "var(--ac-fs-sm)" }}>
            {result.rrT1 != null && <li>At Target 1, this plan models <b className="ac-num">${result.rrT1.toFixed(2)}</b> of potential reward for each $1 of planned risk.</li>}
            {result.rrT2 != null && <li>At Target 2, this plan models <b className="ac-num">${result.rrT2.toFixed(2)}</b> of potential reward for each $1 of planned risk.</li>}
            <li><b>What changed:</b> {result.explain.whatChanged}</li>
            {result.messages.map((m) => <li key={m} className="ac-warn font-semibold">{m}</li>)}
            {result.originalMathInvalid && <li className="ac-warn font-semibold">Original plan math no longer applies.</li>}
            <li className="ac-muted">This plan {result.state === "VALID" ? "meets your rules" : "does not meet every rule"}. The engine's status stays <b>{STATUS_LABEL[d.setupStatus]}</b>.</li>
          </ul>
          <div className="rounded-xl px-3 py-2 font-semibold ac-warn" style={{ border: "1.5px dashed var(--ac-warn)", fontSize: "var(--ac-fs-xs)" }}>
            OVERNIGHT GAP RISK — STOP ORDERS CAN FILL BELOW STOP PRICE. A stop-limit may not fill. Slippage and fees are not included. PRACTICE ONLY — NOT A BROKER ORDER.
          </div>
        </div>
      )}
      {err && <div className="ac-bad font-semibold" role="alert" data-testid="text-adjust-error">{err}</div>}
      <div className="flex flex-wrap gap-2">
        <button className="ac-btn ac-btn-primary" disabled={busy || !result} onClick={save} data-testid="button-adjust-save"><Save className="h-4 w-4" aria-hidden /> {busy ? "Saving…" : "Save Changes"}</button>
        <button className="ac-btn" onClick={onDone} data-testid="button-adjust-cancel">Cancel</button>
        <button className="ac-btn" onClick={() => setRaw({ entry: engineVal.entry?.toFixed(2) ?? "", stop: engineVal.stop?.toFixed(2) ?? "", stopLimit: engineVal.stopLimit?.toFixed(2) ?? "", t1: engineVal.t1?.toFixed(2) ?? "", t2: engineVal.t2?.toFixed(2) ?? "" })} data-testid="button-adjust-load-engine">
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
