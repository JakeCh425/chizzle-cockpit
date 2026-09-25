// PR 3d — §Q4 chart overlay. Built ONLY from the evaluated SwingDecision objects
// (primary + candidates) so the chart can never disagree with the cards.
// Pure: no I/O, no wall clock.
import type {
  ChartLevel, ChartMarker, ChartOverlay, ChartZone, MarkerKind, SetupHistoryEntry, SwingDecision,
} from "@shared/swingDecision";
import { SETUP_NAME, fmtCT, type Candidate, type EvalResult } from "./lifecycle";

export type HistoryScope = "CURRENT" | "LAST5" | "ALL";
const fx = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(2)}`);
const iso2s = (x: string | null) => (x ? Math.floor(Date.parse(x) / 1000) : 0);

export const MARKER_COPY = {
  FORMING: "Not tradeable yet — wait for closed confirmation.",
  STOP: "Practice only. A stop order may fill below this price.",
  RETEST: "Do not chase. Watch for a closed 1H bullish confirmation in this zone.",
  EXTENDED: "Trend may be strong, but current entry is too far from a valid stop. Wait for a structured pullback.",
  INVALIDATED: "Setup failed; do not move stop lower to keep trade alive.",
  ENTRY: "Practice entry trigger — not a buy instruction.",
} as const;

function setupId(d: SwingDecision): string {
  return `${d.symbol}:${d.setupType}:${d.setupTimeframe}:${d.setupTimestamp}:${d.originalTrigger}`;
}

function triggerType(c: Candidate): string {
  const t = c.detection.type;
  if (c.earlyTrigger) return "Early trigger (developing bar) — higher risk";
  if (t === "BREAKOUT_RETEST") return "Retest hold, then 1H close above breakout";
  if (t === "RECLAIM_MOMENTUM_CONTINUATION") return "1H close above reclaim / momentum high";
  if (t === "FIRST_PULLBACK_AFTER_BREAKOUT") return "1H close above pullback high";
  if (t === "HIGHER_LOW_CONSOLIDATION") return "1H close above consolidation high";
  return "Closed 1H above setup-bar high";
}

function isPrimary(c: Candidate, primary: SwingDecision): boolean {
  return c.decision === primary || (primary.setupType != null && setupId(c.decision) === setupId(primary));
}

/** Markers for a single candidate (closed bars only, except FORMING). */
function candidateMarkers(c: Candidate, current: boolean, latest: { t: number; end: number; price: number | null }): ChartMarker[] {
  const d = c.decision, det = c.detection, id = setupId(d), name = SETUP_NAME[det.type];
  const base = { setupType: det.type, status: d.setupStatus, timeframe: det.timeframe, current };
  const out: ChartMarker[] = [];
  const barT = det.barTime ?? 0, barEnd = det.barEnd ?? barT;
  if (det.stage === "FORMING") {
    out.push({ ...base, id: `${id}:FORMING`, kind: "FORMING", time: barT, barEnd, price: det.structureLow ?? d.originalTrigger ?? 0,
      label: `FORMING: ${name}`, tooltip: [
        `${name} is forming on the developing ${det.timeframe} bar.`,
        ...det.passed.slice(0, 4).map((x) => `✓ ${x}`), ...det.missing.slice(0, 4).map((x) => `✗ missing: ${x}`),
        `Level: ${fx(d.reclaimLevel ?? d.originalTrigger)}`, MARKER_COPY.FORMING] });
    return out;
  }
  out.push({ ...base, id: `${id}:CONFIRMED`, kind: "CONFIRMED", time: barT, barEnd, price: det.structureLow ?? 0,
    label: `CONFIRMED: ${name}`, tooltip: [
      `${name} confirmed on the ${det.timeframe} bar that closed ${fmtCT(barEnd)}.`, d.learningExplanation,
      `Trigger: ${fx(d.originalTrigger)} · Invalidation: ${fx(d.structuralStop)}`, ...det.passed.slice(0, 3).map((x) => `✓ ${x}`)] });
  const conf = c.events.confirm1h;
  if (d.setupStatus === "READY_TO_TRADE" && (conf || c.earlyTrigger)) {
    const t = conf?.t ?? latest.t, e = conf?.end ?? latest.end;
    out.push({ ...base, timeframe: "1H", id: `${id}:READY`, kind: "READY", time: t, barEnd: e, price: d.entryPrice ?? 0,
      label: "READY — PRACTICE PLAN", tooltip: [
        `Why READY: closed 1H ${conf ? `${fx(conf.c)} ` : ""}above trigger ${fx(d.originalTrigger)}.`,
        `Entry ${fx(d.entryPrice)} · Stop ${fx(d.structuralStop)} · T1 ${fx(d.target1)} · T2 ${fx(d.target2)}`,
        `Grade ${d.cardGrade} · ${d.riskLabel}`, ...d.passedRules.slice(-3).map((x) => `✓ ${x}`)] });
  }
  if ((d.setupStatus === "WATCH_EXTENDED" || d.setupStatus === "WATCH_RETEST") && current) {
    out.push({ ...base, timeframe: "1H", id: `${id}:EXTENDED`, kind: "EXTENDED", time: latest.t, barEnd: latest.end,
      price: latest.price ?? d.currentPrice ?? 0, label: "EXTENDED — AWAIT RETEST", tooltip: [
        `${d.extensionPercentAboveTrigger ?? "—"}% / ${d.extensionAtr ?? "—"} ATR above trigger ${fx(d.originalTrigger)}.`,
        MARKER_COPY.EXTENDED, d.retestLevel ? `Retest zone ${fx(d.retestLevel.low)}–${fx(d.retestLevel.high)}` : ""].filter(Boolean) });
  }
  if (c.events.invalidated) {
    const v = c.events.invalidated;
    out.push({ ...base, timeframe: "1H", id: `${id}:INVALIDATED`, kind: "INVALIDATED", time: v.t, barEnd: v.end, price: v.c,
      label: "SETUP INVALIDATED", tooltip: [`Closed 1H ${fx(v.c)} below structure at ${fmtCT(v.end)}.`, MARKER_COPY.INVALIDATED] });
  } else if (c.events.expiredAt) {
    const e = c.events.expiredAt;
    out.push({ ...base, timeframe: "1H", id: `${id}:EXPIRED`, kind: "EXPIRED", time: e - 3600, barEnd: e, price: d.originalTrigger ?? 0,
      label: "SIGNAL EXPIRED", tooltip: [`No closed 1H above ${fx(d.originalTrigger)} by ${fmtCT(e)}.`, "Wait for a new setup."] });
  }
  return out;
}

function levelsFor(c: Candidate, current: boolean): ChartLevel[] {
  const d = c.decision, id = setupId(d);
  if (d.entryPrice == null || d.structuralStop == null || d.target1 == null) return [];
  if (d.setupStatus === "SIGNAL_EXPIRED" || d.setupStatus === "NO_TRADE") return [];
  const triggered = !!c.events.confirm1h || c.earlyTrigger;
  const r1 = d.rewardRiskT1 != null ? `${d.rewardRiskT1.toFixed(1)}R` : "—R";
  const r2 = d.rewardRiskT2 != null ? `${d.rewardRiskT2.toFixed(1)}R` : "—R";
  const src = (x?: string) => (x === "resistance" ? "prior resistance" : "R-multiple of risk");
  const out: ChartLevel[] = [
    { id: `${id}:ENTRY`, kind: "ENTRY", price: d.entryPrice, label: `ENTRY TRIGGER: ${fx(d.entryPrice)}`, style: triggered ? "solid" : "dashed",
      tooltip: [`Trigger type: ${triggerType(c)}`, triggered ? "Triggered on a closed bar." : "Not triggered yet.", MARKER_COPY.ENTRY], setupId: id, current },
    { id: `${id}:STOP`, kind: "STOP", price: d.structuralStop, label: `INVALIDATION / STOP: ${fx(d.structuralStop)}`, style: "solid",
      tooltip: [`Below setup structure; buffer ${fx(d.stopBuffer)}`, `Risk/share ${fx(d.riskPerShare)}`, MARKER_COPY.STOP], setupId: id, current },
    { id: `${id}:T1`, kind: "T1", price: d.target1, label: `T1: ${fx(d.target1)} — ${r1}`, style: "solid",
      tooltip: [`Target source: ${src(d.target1Source)}`], setupId: id, current },
  ];
  if (d.target2 != null) out.push({ id: `${id}:T2`, kind: "T2", price: d.target2, label: `T2: ${fx(d.target2)} — ${r2}`, style: "solid",
    tooltip: [`Target source: ${src(d.target2Source)}`], setupId: id, current });
  return out;
}

/** Merge markers of the same kind on the same bar (e.g. strong bull bar + aggressive bounce on one 4H bar). */
export function clusterMarkers(ms: ChartMarker[]): ChartMarker[] {
  const by = new Map<string, ChartMarker>();
  for (const m of ms) {
    const k = `${m.kind}:${m.time}:${m.timeframe}`;
    const prev = by.get(k);
    if (!prev) { by.set(k, { ...m, tooltip: [...m.tooltip] }); continue; }
    const n = (prev.label.match(/\+(\d+)$/)?.[1] ?? "0");
    prev.label = prev.label.replace(/ \+\d+$/, "") + ` +${Number(n) + 1}`;
    prev.tooltip.push("—", ...m.tooltip);
    prev.current = prev.current || m.current;
  }
  return [...by.values()].sort((a, z) => a.time - z.time);
}

export function historyEntry(c: Candidate, current: boolean): SetupHistoryEntry {
  const d = c.decision;
  return { id: setupId(d), setupType: c.detection.type, status: d.setupStatus, timeframe: c.detection.timeframe,
    setupTimestamp: d.setupTimestamp, trigger: d.originalTrigger, stop: d.structuralStop, t1: d.target1, t2: d.target2,
    rrT1: d.rewardRiskT1, grade: d.cardGrade, reason: d.whyNotReady[0] ?? d.nextAction, current };
}

export function buildOverlay(res: EvalResult, opts: { scope?: HistoryScope; latest?: { t: number; end: number; price: number | null } } = {}): ChartOverlay {
  const scope = opts.scope ?? "LAST5";
  const primary = res.decision;
  const latest = opts.latest ?? { t: iso2s(primary.lastCompletedBar1H) - 3600, end: iso2s(primary.lastCompletedBar1H), price: primary.currentPrice };
  // Dedupe identical setups, newest first.
  const seen = new Set<string>();
  const cands = res.candidates.filter((c) => { const k = setupId(c.decision); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, z) => iso2s(z.decision.setupTimestamp) - iso2s(a.decision.setupTimestamp));
  const cur = cands.find((c) => isPrimary(c, primary)) ?? null;
  const inScope = scope === "CURRENT" ? (cur ? [cur] : []) : scope === "LAST5" ? cands.slice(0, 5) : cands;
  if (cur && !inScope.includes(cur)) inScope.unshift(cur);
  const markers = clusterMarkers(inScope.flatMap((c) => candidateMarkers(c, c === cur, latest)));
  const levels = cur ? levelsFor(cur, true) : [];
  const zones: ChartZone[] = [];
  if (primary.retestLevel && (primary.setupStatus === "WATCH_EXTENDED" || primary.setupStatus === "WATCH_RETEST"))
    zones.push({ id: "retest", kind: "RETEST", ...primary.retestLevel, label: `RETEST ZONE ${fx(primary.retestLevel.low)}–${fx(primary.retestLevel.high)}`, tooltip: [MARKER_COPY.RETEST], current: true });
  if (primary.supportZone) zones.push({ id: "support", kind: "SUPPORT", ...primary.supportZone, label: `SUPPORT ${fx(primary.supportZone.low)}–${fx(primary.supportZone.high)}`, tooltip: ["Support from the setup structure."], current: true });
  if (primary.resistanceZone) zones.push({ id: "resistance", kind: "RESISTANCE", ...primary.resistanceZone, label: `RESISTANCE ${fx(primary.resistanceZone.low)}–${fx(primary.resistanceZone.high)}`, tooltip: ["Overhead supply — first target area."], current: true });
  return { markers, levels, zones, history: cands.map((c) => historyEntry(c, c === cur)) };
}

export const MARKER_KINDS: MarkerKind[] = ["FORMING", "CONFIRMED", "READY", "EXTENDED", "INVALIDATED", "EXPIRED"];
