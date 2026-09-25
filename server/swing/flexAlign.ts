// PR 3f — Flex Scanner ↔ Unified Swing Engine alignment.
// When ENABLE_UNIFIED_SWING_ENGINE is ON, every /api/flex-scan card is rewritten so
// its state / action / levels / blocks come from the SAME SwingDecision the unified
// workspace shows. The original flex-rule output is kept verbatim under `card.legacy`
// (shown as a collapsible "Legacy checks" panel), so nothing is lost.
// When the flag is OFF this module is never called — flex output is byte-for-byte unchanged.
import type { FlexDeskCard, FlexScanResult, FlexSetup, FlexState, FlexAction, FlexRiskGrade, RiskPermission, VehiclePermission } from "@shared/flexScanTypes";
import { STATUS_LABEL, type SetupStatus, type SwingDecision, type SetupType } from "@shared/swingDecision";
import { evaluateSymbol, loadSettings, barKey, _test } from "./service";

const READY: SetupStatus[] = ["READY_TO_TRADE"];
const WATCH: SetupStatus[] = ["SETUP_CONFIRMED", "SETUP_FORMING", "WATCH_RETEST", "WATCH_EXTENDED", "WATCH_STOP_TOO_WIDE", "WATCH_RR_TOO_LOW", "BLOCKED_DATA_MISMATCH"];
const ACTIVE: SetupStatus[] = ["READY_TO_TRADE", "SETUP_CONFIRMED", "SETUP_FORMING", "WATCH_RETEST", "WATCH_EXTENDED"];

const SETUP_MAP: Record<SetupType, FlexSetup> = {
  BREAKOUT_RETEST: "Trend continuation",
  FIRST_PULLBACK_AFTER_BREAKOUT: "Trend continuation",
  RECLAIM_MOMENTUM_CONTINUATION: "Trend continuation",
  HIGHER_LOW_CONSOLIDATION: "Higher-low recovery",
  AGGRESSIVE_BOUNCE: "Bounce reclaim",
  HAMMER: "Developing recovery",
  BULLISH_ENGULFING: "Developing recovery",
  STRONG_BULL_BAR: "Developing recovery",
};

export interface UnifiedTag {
  status: SetupStatus; label: string; grade: string; setupType: SetupType | null;
  nextAction: string; whyNotReady: string[]; weeklyRegime: string; dailyRegime: string;
  dataStatus: string; lastCompletedBar1H: string | null; pending?: boolean;
}
export interface LegacyTag {
  state: FlexState; action: FlexAction; risk_grade: FlexRiskGrade; permission: VehiclePermission;
  hard_blocks: string[]; trigger: string; setup: FlexSetup; readiness_score: number;
  fakeout_check: FlexDeskCard["fakeout_check"];
}

const clampScore = (s: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(s)));

export function alignCard(card: FlexDeskCard, d: SwingDecision): FlexDeskCard {
  const st = d.setupStatus;
  const legacy: LegacyTag = {
    state: card.state, action: card.action, risk_grade: card.risk_grade, permission: card.permission,
    hard_blocks: card.hard_blocks ?? [], trigger: card.trigger, setup: card.setup,
    readiness_score: card.readiness_score, fakeout_check: card.fakeout_check,
  };
  const strong = d.cardGrade === "A4_CORE" || d.cardGrade === "A3_SWING";
  const state: FlexState = READY.includes(st) ? (strong ? "STANDARD_READY" : "FLEX_READY") : WATCH.includes(st) ? "FLEX_WATCH" : "STANDBY";
  const action: FlexAction = state === "STANDBY" ? "STAND DOWN" : state === "FLEX_WATCH" ? "SET ALERT" : "ENTER ONLY ON TRIGGER";
  const risk_grade: FlexRiskGrade = state === "STANDARD_READY" ? "STANDARD SMALL" : state === "FLEX_READY" ? "FLEX HALF SIZE" : "NO TRADE";
  const risk_permission: RiskPermission = state === "STANDARD_READY" ? "ALLOWED" : state === "FLEX_READY" ? "REDUCED" : state === "FLEX_WATCH" ? "WATCH" : "BLOCKED";
  const permission: VehiclePermission = ACTIVE.includes(st) && card.permission === "NO_LONG" ? "FLEX_ONLY" : card.permission;
  const score = READY.includes(st) ? clampScore(Math.max(card.readiness_score, 70), 70, 100)
    : WATCH.includes(st) ? clampScore(card.readiness_score, 20, 69) : clampScore(Math.min(card.readiness_score, 40), 0, 40);

  const entry = d.originalTrigger ?? d.entryPrice;
  // Levels only for live setups — expired / no-setup cards must not show stale plan geometry.
  const hasLevels = ACTIVE.concat(["WATCH_STOP_TOO_WIDE", "WATCH_RR_TOO_LOW"] as SetupStatus[]).includes(st)
    && entry != null && d.structuralStop != null && d.structuralStop < entry;
  const zLo = hasLevels ? Math.min(entry!, d.entryPrice ?? entry!) : null, zHi = hasLevels ? Math.max(entry!, d.entryPrice ?? entry!) : null;
  const reasons = (d.whyNotReady.length ? d.whyNotReady : d.missingConditions).slice(0, 3);
  const distance = state === "STANDARD_READY" || state === "FLEX_READY" ? [] : [
    { name: "Unified status", current: STATUS_LABEL[st], needed: "Ready to Trade", next_action: d.nextAction },
    ...d.missingConditions.slice(0, 3).map((m) => ({ name: "Needed", current: m, needed: "met on a closed candle", next_action: "Wait for a closed candle that satisfies it" })),
  ];

  const unified: UnifiedTag = {
    status: st, label: STATUS_LABEL[st], grade: d.cardGrade, setupType: d.setupType, nextAction: d.nextAction,
    whyNotReady: d.whyNotReady.slice(0, 4), weeklyRegime: d.weeklyRegime, dailyRegime: d.dailyRegime,
    dataStatus: d.dataStatus, lastCompletedBar1H: d.lastCompletedBar1H,
  };

  return {
    ...card,
    state, action, risk_grade, risk_permission, permission,
    readiness_score: score,
    setup: d.setupType ? SETUP_MAP[d.setupType] : "No trade",
    trigger: d.nextAction,
    // Unified contract: "Hard Block" is never shown for any status — blocking reasons move to distance_to_ready / why.
    hard_blocks: [],
    distance_to_ready: distance,
    entry_zone: hasLevels ? { low: zLo, high: zHi, note: "Unified engine trigger — enter only after a closed 1H confirmation" } : { low: null, high: null, note: "No plan levels from the unified engine" },
    stop: hasLevels ? { price: d.structuralStop, reason: "Structural stop from the unified engine. OVERNIGHT GAP RISK — STOP ORDERS CAN FILL BELOW STOP PRICE." } : { price: null, reason: "No structural stop yet" },
    target_1: { price: hasLevels ? d.target1 : null, r_multiple: hasLevels ? d.rewardRiskT1 : null },
    target_2: hasLevels && d.target2 != null ? { price: d.target2, r_multiple: d.rewardRiskT2 } : null,
    fakeout_check: READY.includes(st)
      ? { result: "PASS", reasons: d.passedRules.slice(0, 3) }
      : { result: "FAIL", reasons: reasons.length ? reasons : ["Not ready on the unified engine"] },
    ...({ unified, legacy } as any),
  };
}

function pendingCard(card: FlexDeskCard): FlexDeskCard {
  // Evaluation still running — keep the card visible but never let the legacy
  // verdict claim READY or HARD BLOCK while the authority hasn't answered.
  const legacy: LegacyTag = { state: card.state, action: card.action, risk_grade: card.risk_grade, permission: card.permission,
    hard_blocks: card.hard_blocks ?? [], trigger: card.trigger, setup: card.setup, readiness_score: card.readiness_score, fakeout_check: card.fakeout_check };
  const unified: UnifiedTag = { status: "NO_SETUP", label: "Checking…", grade: "WATCH", setupType: null,
    nextAction: "Unified engine is evaluating this ticker — refresh in a moment.", whyNotReady: [], weeklyRegime: "—", dailyRegime: "—",
    dataStatus: "PENDING", lastCompletedBar1H: null, pending: true };
  return { ...card, state: card.state === "STANDBY" ? "STANDBY" : "FLEX_WATCH", action: card.state === "STANDBY" ? "STAND DOWN" : "SET ALERT",
    risk_grade: "NO TRADE", hard_blocks: [], trigger: unified.nextAction, ...({ unified, legacy } as any) };
}

// In-flight evaluations are shared so parallel flex-scan callers don't double-fetch.
const inflight = new Map<string, Promise<SwingDecision | null>>();
function decide(sym: string, exchange: string): Promise<SwingDecision | null> {
  const k = sym.toUpperCase();
  const cur = inflight.get(k);
  if (cur) return cur;
  const p = evaluateSymbol({ symbol: k, exchange }).then((r) => r.res.decision).catch((e) => { console.warn(`[flex-align] ${k} evaluate failed:`, e?.message || e); return null; }).finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}

const BUDGET_MS = Number(process.env.SWING_ALIGN_BUDGET_MS ?? 5000);
const CONCURRENCY = 3;

export async function alignFlexResult(result: FlexScanResult): Promise<FlexScanResult> {
  const s = await loadSettings().catch(() => null);
  const exch = new Map((s?.watchlist ?? []).map((w) => [w.symbol, w.exchange] as const));
  const cards = result.cards ?? [];
  const out: (FlexDeskCard | null)[] = cards.map(() => null);
  const deadline = Date.now() + BUDGET_MS;

  // Pinned vehicles (SMH / QQQ / SPY) first so the always-visible row aligns within budget.
  const order = cards.map((c, i) => i).sort((a, b) => Number(!!cards[b].pinned) - Number(!!cards[a].pinned));
  let next = 0;
  const worker = async () => {
    while (next < order.length) {
      const i = order[next++];
      const c = cards[i];
      const left = deadline - Date.now();
      if (left <= 0) { void decide(c.ticker, exch.get(c.ticker) ?? ""); continue; } // warm cache for the next refresh
      // Serve the last known decision instantly (stale-while-revalidate) so the scanner never stalls.
      const hit = _test.evalCache.get(c.ticker.toUpperCase()) as any;
      if (hit) {
        if (!String(hit.key).endsWith(barKey(Math.floor(Date.now() / 1000)))) void decide(c.ticker, exch.get(c.ticker) ?? "");
        out[i] = alignCard(c, hit.res.decision); continue;
      }
      const d = await Promise.race([decide(c.ticker, exch.get(c.ticker) ?? ""), new Promise<null>((r) => setTimeout(() => r(null), left))]);
      out[i] = d ? alignCard(c, d) : null;
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const aligned = cards.map((c, i) => out[i] ?? pendingCard(c));

  const ready = aligned.filter((c) => c.state === "STANDARD_READY" || c.state === "FLEX_READY");
  const watch = aligned.filter((c) => c.state === "FLEX_WATCH");
  const dayType = ready.length ? "PRACTICE_SWING_DAY" : result.day_type === "PRACTICE_SWING_DAY" ? "STANDBY_DAY" : result.day_type;
  const checking = aligned.filter((c) => (c as any).unified?.pending).length;
  const names = (l: FlexDeskCard[]) => l.slice(0, 3).map((c) => c.ticker).join(", ");
  const swing = ready.length
    ? `Practice plan available on ${names(ready)} — review entry, stop, targets and risk before deciding.`
    : watch.length
      ? `No practice trade yet — watch ${names(watch)} for a closed 1H confirmation.`
      : "No qualifying setup on the unified engine — stand down on swings.";
  const smh = result.smh_context?.state ?? "—";
  return {
    ...result,
    day_type: dayType,
    cards: aligned,
    account_instructions: { ...result.account_instructions, swing },
    one_sentence_summary: `SMH ${smh} · ${ready.length} ready, ${watch.length} watch (unified engine)${checking ? `, ${checking} still checking` : ""} — ${ready.length ? "practice plan available" : watch.length ? "wait for confirmation" : "stand down for capital protection"}.`,
    ...({ unified_aligned: true, legacy_summary: result.one_sentence_summary, legacy_day_type: result.day_type } as any),
  };
}
