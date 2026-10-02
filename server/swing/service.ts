// PR 3d — Unified Swing Engine service: settings, per-symbol evaluation with a
// closed-1H cache, scans, chart bars, decision log, and the hourly auto-recompute.
// Only reachable when ENABLE_UNIFIED_SWING_ENGINE is on (or the ?unified=1 QA override).
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";
import { db, storage } from "../storage";
import { getEffectiveRegime } from "../regimeService";
import { mtfWebhookEvents, swingDecisionLog, swingSettings } from "@shared/schema";
import {
  DEFAULT_SWING_SETTINGS, STATUS_PRIORITY, SETUP_STATUSES, USER_MODES, SIGNAL_MODES,
  type ScanSelection, type SetupHistoryEntry, type SetupStatus, type SwingDecision, type SwingSettings, type WatchItem,
} from "@shared/swingDecision";
import { dataRulesV2, evaluate, type EvalResult, type ReferenceQuote } from "./lifecycle";
import { buildOverlay, type HistoryScope } from "./markers";
import { fetch1H, fetchDaily, fetchIntraday, fetchQuote, secondVendorReference } from "./feed";
import { aggregate4H, aggregateWeekly, chicago, chicagoTs, tag1H } from "./bars";
import type { SwingBar } from "./candleMath";
import { normalizeList, riskNote, selectUniverse } from "./universe";
import { isUnifiedSwingEnabled } from "../featureFlags";
import { planChangeOf, targetDefaultError } from "@shared/practicePlan";

const nowSec = () => Math.floor(Date.now() / 1000);

// ─── Settings ────────────────────────────────────────────────────────────────
export const settingsPatchSchema = z.object({
  userMode: z.enum(USER_MODES).optional(),
  signalMode: z.enum(SIGNAL_MODES).optional(),
  showFormingCards: z.boolean().optional(), showWatchCards: z.boolean().optional(), showLowQualityForming: z.boolean().optional(),
  allowCountertrend: z.boolean().optional(), requireVolume: z.boolean().optional(),
  requireWeeklyAlignment: z.boolean().optional(), requireDailyAlignment: z.boolean().optional(),
  allowEarlyTrigger: z.boolean().optional(), allowFirstPullback: z.boolean().optional(),
  minRrT1: z.number().min(0.5).max(10).optional(),
  linkRiskToProfile: z.boolean().optional(),
  expiryBars4h: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  maxDollarRisk: z.number().min(1).max(100000).optional(),
  maxExtensionPct: z.number().min(0.25).max(5).optional(),
  maxExtensionAtr: z.number().min(0.25).max(5).optional(),
  extensionAtrAnchor: z.enum(["TRIGGER", "DAILY_SMA20"]).optional(),
  retestZoneAtr: z.number().min(0).max(3).optional(),
  retestBelowAtr: z.number().min(0).max(2).optional(),
  a2SetupScope: z.enum(["ALL", "SPEC_LIST"]).optional(),
  intradayLearningMode: z.boolean().optional(),
  maxCustomTickers: z.number().int().min(1).max(50).optional(),
  entryBufferPct: z.number().min(0).max(1).optional(),
  stopBufferAtr: z.number().min(0).max(2).optional(),
  autoRefresh1H: z.boolean().optional(),
  targetDefault: z.object({ method: z.enum(["FIXED_R", "ENGINE", "STRUCTURE"]), t1R: z.number().positive().max(20), t2R: z.number().positive().max(20) })
    .refine((t) => !targetDefaultError(t), (t) => ({ message: targetDefaultError(t) ?? "Invalid target default" })).optional(),
  planAutoRefreshMin: z.union([z.literal(0), z.literal(15), z.literal(30), z.literal(60)]).optional(),
}).strict();

let settingsCache: { v: SwingSettings; at: number } | null = null;
export async function loadSettings(): Promise<SwingSettings> {
  if (settingsCache && Date.now() - settingsCache.at < 15_000) return settingsCache.v;
  let data: Partial<SwingSettings> = {};
  try { const row = (await db.select().from(swingSettings).where(eq(swingSettings.id, 1)).limit(1))[0]; data = (row?.data as any) ?? {}; } catch { /* table missing → defaults */ }
  const v: SwingSettings = { ...DEFAULT_SWING_SETTINGS, ...data, rthOnly: true, timezone: "America/Chicago" };
  v.riskLinkInfo = null;
  if (v.linkRiskToProfile !== false) {
    // Risk link: one source of truth — Settings → Risk Profile drives the swing engine.
    try {
      const main: any = await storage.getSettings();
      const code = String(getEffectiveRegime().code || main?.regime || "yellow").toLowerCase();
      const pct = Number(code === "green" ? main.riskPctGreen : code === "red" ? main.riskPctRed : main.riskPctYellow);
      const equity = Number(main.equity);
      if (equity > 0 && pct > 0) {
        const dollars = Math.max(1, Math.round(equity * pct) / 100);
        v.maxDollarRisk = dollars;
        const minRR = Number(main.minRR);
        if (minRR > 0) v.minRrT1 = minRR;
        v.riskLinkInfo = { equity, regime: code.toUpperCase(), riskPct: pct, dollars, minRR: v.minRrT1 };
      }
    } catch { /* fall back to stored swing values */ }
  }
  v.watchlist = normalizeList(v.watchlist);
  v.universe = v.watchlist.filter((x) => !x.hidden).map((x) => `${x.exchange}:${x.symbol}`);
  settingsCache = { v, at: Date.now() };
  return v;
}
/** Clear cached swing settings + evaluations (called when Risk Profile or regime changes). */
export function invalidateSwingCaches() { settingsCache = null; for (const c of evalCache.values()) c.reeval = true; }

export async function saveSettings(patch: Partial<SwingSettings>): Promise<SwingSettings> {
  const cur = await loadSettings();
  // Keep the user's own stored $ risk / R:R — linked values are derived at read time, never persisted.
  let stored: Partial<SwingSettings> = {};
  try { const row = (await db.select().from(swingSettings).where(eq(swingSettings.id, 1)).limit(1))[0]; stored = (row?.data as any) ?? {}; } catch { /* defaults */ }
  const next: any = { ...cur, maxDollarRisk: stored.maxDollarRisk ?? DEFAULT_SWING_SETTINGS.maxDollarRisk, minRrT1: stored.minRrT1 ?? DEFAULT_SWING_SETTINGS.minRrT1, ...patch };
  delete next.riskLinkInfo;
  next.watchlist = normalizeList(next.watchlist);
  next.universe = next.watchlist.filter((x: WatchItem) => !x.hidden).map((x: WatchItem) => `${x.exchange}:${x.symbol}`);
  await db.insert(swingSettings).values({ id: 1, data: next as any, updatedAt: new Date() })
    .onConflictDoUpdate({ target: swingSettings.id, set: { data: next as any, updatedAt: new Date() } });
  settingsCache = null; for (const c of evalCache.values()) c.reeval = true;
  return loadSettings();
}

// ─── Evaluation (cached per closed RTH hour) ─────────────────────────────────
interface Cached {
  key: string; res: EvalResult; bars1h: SwingBar[]; daily: SwingBar[]; at: number;
  exchange: string; source: string | null; reference: ReferenceQuote | null;
  /** Settings/regime changed — re-run the rules on the cached bars (no network). */
  reeval?: boolean;
}
const evalCache = new Map<string, Cached>();
/** One network refresh per symbol at a time — concurrent callers share it. */
const inflight = new Map<string, Promise<Cached>>();
const hourPart = (key: string) => key.split("|")[1]?.split(":").slice(0, 2).join(":") ?? "";
/** Cache key changes when a new 1H bar closes (or every 10 min outside that, so quotes stay fresh). */
export function barKey(now: number): string {
  const c = chicago(now);
  const hourSlot = c.minutes >= 510 ? Math.floor((c.minutes - 510) / 60) : -1;
  return `${c.ymd}:${hourSlot}:${Math.floor(now / 600)}`;
}

async function tvReference(sym: string, now: number): Promise<ReferenceQuote | null> {
  try {
    const rows = await db.select().from(mtfWebhookEvents)
      .where(and(eq(mtfWebhookEvents.symbol, sym), eq(mtfWebhookEvents.interval, "60"), eq(mtfWebhookEvents.accepted, true), gte(mtfWebhookEvents.barCloseTime, new Date((now - 2 * 3600) * 1000))))
      .orderBy(desc(mtfWebhookEvents.barCloseTime)).limit(1);
    const r = rows[0];
    if (!r || !(r.close > 0)) return null;
    return { symbol: sym, close: r.close, barEnd: Math.floor(new Date(r.barCloseTime as any).getTime() / 1000), source: "tradingview", session: "RTH" };
  } catch { return null; }
}

function runRules(sym: string, exchange: string, h1: SwingBar[], d1: SwingBar[], q: { price: number; ts: number } | null,
  reference: ReferenceQuote | null, s: SwingSettings, now: number, source: string | null): EvalResult {
  const res = evaluate({ symbol: sym, exchange, bars1h: h1, daily: d1, quote: q, reference, settings: s, now, dataSource: source });
  if (!h1.length || !d1.length) {
    res.decision.dataStatus = "ERROR";
    res.decision.whyNotReady = [`Data unavailable for ${sym} (${!h1.length ? "1H bars" : "daily bars"}) — the card stays visible and re-checks on the next closed 1H bar.`, ...res.decision.whyNotReady];
  }
  res.decision.chart = buildOverlay(res, { scope: "ALL" });
  return res;
}

// ─── Data recovery (v2): bounded-backoff retries + an in-memory event log (no schema change) ─
export interface DataEvent { at: string; symbol: string; kind: "FETCH_FAILED" | "STATUS_CHANGE" | "RETRY_SCHEDULED" | "RECOVERED"; detail: string }
const dataEvents: DataEvent[] = [];
function logDataEvent(symbol: string, kind: DataEvent["kind"], detail: string) {
  dataEvents.unshift({ at: new Date().toISOString(), symbol, kind, detail });
  if (dataEvents.length > 300) dataEvents.length = 300;
  if (kind !== "RETRY_SCHEDULED") console.warn(`[swing-data] ${symbol} ${kind}: ${detail}`);
}
export const readDataEvents = (symbol?: string | null, limit = 100) =>
  dataEvents.filter((e) => !symbol || e.symbol === symbol.toUpperCase()).slice(0, Math.min(300, limit));
const RETRY_BASE_MS = 15_000, RETRY_MAX_MS = 5 * 60_000, RETRY_MAX_ATTEMPTS = 4; // 15s → 30s → 60s → 120s, then wait for the normal refresh (protects vendor credits)
const retries = new Map<string, { attempt: number; timer: NodeJS.Timeout | null; last: number }>();
function scheduleRetry(sym: string, exchange: string, why: string) {
  let r = retries.get(sym) ?? { attempt: 0, timer: null, last: 0 };
  if (!r.timer && Date.now() - r.last > 30 * 60_000) r = { attempt: 0, timer: null, last: 0 }; // new episode
  r.last = Date.now();
  if (r.timer || r.attempt >= RETRY_MAX_ATTEMPTS) return; // one pending retry per symbol; bounded
  const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** r.attempt);
  r.attempt += 1;
  logDataEvent(sym, "RETRY_SCHEDULED", `attempt ${r.attempt}/${RETRY_MAX_ATTEMPTS} in ${Math.round(delay / 1000)}s — ${why}`);
  r.timer = setTimeout(async () => {
    r.timer = null;
    try { const s = await loadSettings(); await refreshSymbol(sym, exchange, s, `${sym}|${barKey(nowSec())}`); } catch { /* next attempt is scheduled by refreshSymbol */ }
  }, delay);
  r.timer.unref?.();
  retries.set(sym, r);
}
function afterRefresh(sym: string, exchange: string, prevStatus: string | undefined, out: Cached, failed: string[]) {
  const st = out.res.decision.dataStatus;
  if (failed.length) logDataEvent(sym, "FETCH_FAILED", `${failed.join(", ")} request(s) failed${out.bars1h.length ? " — kept the last good bars" : ""}`);
  if (prevStatus && prevStatus !== st) logDataEvent(sym, st === "LIVE" ? "RECOVERED" : "STATUS_CHANGE", `${prevStatus} → ${st}: ${out.res.decision.dataHealth?.reason ?? ""}`);
  if (!dataRulesV2()) return;
  if (failed.length || st === "STALE" || st === "ERROR") scheduleRetry(sym, exchange, failed.length ? `${failed.join(", ")} failed` : `data ${st}`);
  else if (st === "LIVE") { const r = retries.get(sym); if (r?.timer) clearTimeout(r.timer); retries.delete(sym); }
}

async function refreshSymbol(sym: string, exchange: string, s: SwingSettings, key: string): Promise<Cached> {
  const running = inflight.get(sym);
  if (running) return running;
  const p = (async () => {
    const now = nowSec();
    const [h1, d1, q] = await Promise.all([fetch1H(sym), fetchDaily(sym), fetchQuote(sym)]);
    const lastClosed = tag1H(h1.bars, now, true).filter((b) => b.closed).pop() ?? null;
    const reference = (await tvReference(sym, now)) ?? (h1.source ? await secondVendorReference(sym, h1.source, now, lastClosed?.end ?? null) : null);
    const prev = evalCache.get(sym);
    // A failed vendor call keeps the last good bars instead of blanking the chart.
    const bars1h = h1.bars.length ? h1.bars : prev?.bars1h ?? [];
    const daily = d1.bars.length ? d1.bars : prev?.daily ?? [];
    const source = h1.bars.length ? h1.source : prev?.source ?? null;
    const res = runRules(sym, exchange, bars1h, daily, q ? { price: q.price, ts: q.ts } : null, reference, s, now, source);
    const failed = [!h1.bars.length && "1H bars", !d1.bars.length && "daily bars", !q && "quote"].filter(Boolean) as string[];
    // Plan analysis is "successful" only when fresh bars arrived; a quote alone never refreshes (or confirms) the plan.
    res.decision.planRefresh = planChangeOf(prev?.res.decision, res.decision, new Date(now * 1000).toISOString(), !!h1.bars.length && !!d1.bars.length, failed);
    const out: Cached = { key, res, bars1h, daily, at: Date.now(), exchange, source, reference };
    const cur = evalCache.get(sym);
    if (!cur || cur.at <= out.at) evalCache.set(sym, out); // an older response never overwrites a newer snapshot
    afterRefresh(sym, exchange, prev?.res.decision.dataStatus, out, failed);
    void writeLog(res).catch(() => {});
    return out;
  })().finally(() => inflight.delete(sym));
  inflight.set(sym, p);
  return p;
}

export async function evaluateSymbol(item: Pick<WatchItem, "symbol" | "exchange">, opts: { force?: boolean; settings?: SwingSettings; allowStale?: boolean } = {}): Promise<{ res: EvalResult; bars1h: SwingBar[]; daily: SwingBar[] }> {
  const s = opts.settings ?? await loadSettings();
  const now = nowSec(), sym = item.symbol.toUpperCase();
  const key = `${sym}|${barKey(now)}`;
  const hit = evalCache.get(sym);
  if (!opts.force && hit) {
    const sameHour = hourPart(hit.key) === hourPart(key);
    if (hit.reeval && (sameHour || opts.allowStale)) {
      // Settings or regime changed: re-apply rules to cached bars instantly.
      const q = await fetchQuote(sym).catch(() => null);
      const before = hit.res.decision;
      hit.res = runRules(sym, hit.exchange, hit.bars1h, hit.daily, q ? { price: q.price, ts: q.ts } : null, hit.reference, s, now, hit.source);
      // Settings changed (e.g. target default): same bars, so the analysis time stays the bars' analysis time.
      const pi = planChangeOf(before, hit.res.decision, new Date(now * 1000).toISOString(), true, []);
      hit.res.decision.planRefresh = { ...pi, analysisAt: before.planRefresh?.analysisAt ?? pi.analysisAt };
      hit.reeval = false;
    }
    if (hit.key === key) return hit;
    // Same closed hour, only the 10-min quote slot moved (or chart view): serve now, refresh in background.
    if (sameHour || opts.allowStale) { void refreshSymbol(sym, item.exchange, s, key).catch(() => {}); return hit; }
  }
  return refreshSymbol(sym, item.exchange, s, key);
}

/** Bars the swing engine already fetched (no network) — lets legacy charts skip slow vendor chains. */
export function cachedSwingBars(symbol: string): { daily: SwingBar[]; bars1h: SwingBar[] } | null {
  const c = evalCache.get(symbol.toUpperCase());
  return c && (c.daily.length || c.bars1h.length) ? { daily: c.daily, bars1h: c.bars1h } : null;
}

/** Decision with its chart overlay filtered to the requested history scope, plus older setups from the log. */
export async function decisionFor(symbol: string, exchange: string, scope: HistoryScope = "LAST5", force = false): Promise<SwingDecision> {
  const { res } = await evaluateSymbol({ symbol, exchange }, { force });
  const d: SwingDecision = { ...res.decision, chart: buildOverlay(res, { scope }) };
  if (scope !== "CURRENT") {
    const older = await historyFromLog(symbol, d.chart!.history.map((h) => h.id));
    d.chart!.history.push(...(scope === "LAST5" ? older.slice(0, Math.max(0, 5 - d.chart!.history.length)) : older));
  }
  return d;
}

// ─── Decision log (§N) — one row per symbol × closed 1H bar; 30-day retention ─
async function writeLog(res: EvalResult) {
  const d = res.decision, L = res.log;
  if (!d.lastCompletedBar1H) return;
  const barTime = new Date(d.lastCompletedBar1H);
  const exists = await db.select({ id: swingDecisionLog.id }).from(swingDecisionLog)
    .where(and(eq(swingDecisionLog.symbol, d.symbol), eq(swingDecisionLog.timeframe, "1H"), eq(swingDecisionLog.barTime, barTime))).limit(1);
  if (exists.length) return;
  await db.insert(swingDecisionLog).values({
    symbol: d.symbol, exchange: d.exchange, timeframe: "1H", barTime, dataSource: d.dataSource, session: d.session, timezone: d.timezone,
    weeklyRegime: d.weeklyRegime, dailyRegime: d.dailyRegime, setupsEvaluated: L.setupsEvaluated as any,
    passed: d.passedRules as any, failed: d.failedRules as any,
    formation: L.fourHourResult, confirm4h: L.fourHourResult, confirm1h: L.oneHourResult,
    originalTrigger: d.originalTrigger, distanceFromTriggerPct: L.distanceFromTriggerPct, structuralStop: d.structuralStop,
    target1: d.target1, target2: d.target2, rrAtSignal: L.rrAtSignal, rrAtCurrent: L.rrAtCurrent, volumeCondition: d.volumeCondition,
    extensionPct: d.extensionPercentAboveTrigger, extensionAtr: d.extensionAtr, dataMismatch: d.dataMismatchReason,
    finalStatus: d.setupStatus, reason: L.reason, decision: { ...d, chart: { history: d.chart?.history ?? [] } } as any,
  });
  if (Math.random() < 0.05) await db.delete(swingDecisionLog).where(lt(swingDecisionLog.evaluatedAt, new Date(Date.now() - 30 * 86400_000)));
}

async function historyFromLog(symbol: string, have: string[]): Promise<SetupHistoryEntry[]> {
  try {
    const rows = await db.select({ decision: swingDecisionLog.decision }).from(swingDecisionLog)
      .where(and(eq(swingDecisionLog.symbol, symbol.toUpperCase()), gte(swingDecisionLog.evaluatedAt, new Date(Date.now() - 30 * 86400_000))))
      .orderBy(desc(swingDecisionLog.barTime)).limit(200);
    const seen = new Set(have), out: SetupHistoryEntry[] = [];
    for (const r of rows) for (const h of ((r.decision as any)?.chart?.history ?? []) as SetupHistoryEntry[]) {
      if (seen.has(h.id)) continue; seen.add(h.id); out.push({ ...h, current: false });
    }
    return out;
  } catch { return []; }
}

export async function readLog(symbol: string | null, limit = 50) {
  const q = db.select().from(swingDecisionLog);
  const rows = await (symbol ? q.where(eq(swingDecisionLog.symbol, symbol.toUpperCase())) : q).orderBy(desc(swingDecisionLog.barTime)).limit(Math.min(500, limit));
  return rows.map(({ decision, ...r }) => r);
}

// ─── Scan (§Q2) — every selected ticker gets an outcome, never an empty list ─
export interface ScanRow { item: WatchItem; riskNote: string; decision: SwingDecision }
export async function scan(sel: ScanSelection, symbols: string[] = [], statusFilter: SetupStatus[] = [], force = false) {
  const s = await loadSettings();
  const items = selectUniverse(s.watchlist!, sel, symbols);
  const rows: ScanRow[] = [];
  for (const item of items) { // sequential: shares vendor rate limits with the rest of the app
    try {
      const { res } = await evaluateSymbol(item, { settings: s, force });
      rows.push({ item, riskNote: riskNote(item.assetType), decision: { ...res.decision, chart: buildOverlay(res, { scope: "CURRENT" }) } });
    } catch (e: any) {
      rows.push({ item, riskNote: riskNote(item.assetType), decision: errorDecision(item, s, e?.message || "Data unavailable") });
    }
  }
  rows.sort((a, z) => STATUS_PRIORITY[a.decision.setupStatus] - STATUS_PRIORITY[z.decision.setupStatus] || a.item.order - z.item.order);
  const shown = statusFilter.length ? rows.filter((r) => statusFilter.includes(r.decision.setupStatus)) : rows;
  const emptyReason = !items.length ? `No tickers match “${sel}”. Add tickers or reset to the default learning universe.`
    : !shown.length ? `${rows.length} ticker(s) scanned; none match the status filter (${statusFilter.join(", ")}). Clear the filter to see all outcomes.` : null;
  return { selection: sel, scanned: rows.length, rows: shown, emptyReason, evaluatedAt: new Date().toISOString() };
}

function errorDecision(item: WatchItem, s: SwingSettings, why: string): SwingDecision {
  const res = evaluate({ symbol: item.symbol, exchange: item.exchange, bars1h: [], daily: [], settings: s, now: nowSec(), dataSource: null });
  res.decision.dataStatus = "ERROR";
  res.decision.whyNotReady = [`Data unavailable for ${item.symbol}: ${why}`, ...res.decision.whyNotReady];
  return res.decision;
}

// ─── Chart bars (§Q3) ────────────────────────────────────────────────────────
export const CHART_TFS = ["15m", "30m", "1H", "4H", "D", "W"] as const;
export type ChartTf = typeof CHART_TFS[number];
export const CHART_RANGES = ["5D", "1M", "3M", "6M", "YTD", "1Y", "ALL"] as const;
export type ChartRange = typeof CHART_RANGES[number];

export function rangeStart(r: ChartRange, now: number): number {
  const day = 86400;
  switch (r) {
    case "5D": return now - 7 * day; case "1M": return now - 31 * day; case "3M": return now - 92 * day;
    case "6M": return now - 183 * day; case "1Y": return now - 366 * day; case "ALL": return 0;
    case "YTD": return chicagoTs(`${chicago(now).ymd.slice(0, 4)}-01-01`, 0);
  }
}

export async function chartBars(symbol: string, exchange: string, tf: ChartTf, range: ChartRange, extended = false) {
  const now = nowSec(), sym = symbol.toUpperCase();
  const s = await loadSettings();
  let bars: (SwingBar & { closed?: boolean })[] = [], source: string | null = null, error: string | undefined;
  const signalTf = tf === "1H" || tf === "4H" || tf === "D" || tf === "W" || !!s.intradayLearningMode;
  if (tf === "15m" || tf === "30m") {
    const r = await fetchIntraday(sym, tf); source = r.source; error = r.error;
    bars = extended ? r.bars : r.bars.filter((b) => { const m = chicago(b.t).minutes; return m >= 510 && m < 900; });
  } else if (tf === "1H" || tf === "4H") {
    const { bars1h } = await evaluateSymbol({ symbol: sym, exchange }, { settings: s, allowStale: true });
    const r = bars1h.length ? { bars: bars1h, source: evalCache.get(sym)?.res.decision.dataSource ?? null } : await fetch1H(sym);
    source = r.source;
    bars = tf === "1H" ? tag1H(r.bars, now, !extended).map((b) => ({ ...b })) : aggregate4H(r.bars, now).map((b) => ({ ...b }));
  } else {
    const { daily } = await evaluateSymbol({ symbol: sym, exchange }, { settings: s, allowStale: true });
    source = "yahoo";
    bars = tf === "D" ? daily : aggregateWeekly(daily, now).map((b) => ({ ...b }));
  }
  const from = rangeStart(range, now);
  const out = bars.filter((b) => b.t >= from).map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v ?? 0, closed: b.closed ?? true }));
  const lastClosed = [...out].reverse().find((b) => b.closed) ?? null;
  const dec = evalCache.get(sym)?.res.decision;
  return {
    symbol: sym, exchange, timeframe: tf, range, session: extended ? "EXTENDED" : "RTH", source, error: out.length ? undefined : (error ?? "Data unavailable"),
    visualOnly: !signalTf, visualOnlyNote: !signalTf ? "15m / 30m are visual only — they never confirm a setup unless Intraday Learning Mode is on." : null,
    quoteTimestamp: dec?.quoteTimestamp ?? null, dataStatus: dec?.dataStatus ?? (out.length ? "DELAYED" : "ERROR"),
    lastCompletedBar: lastClosed ? new Date(lastClosed.t * 1000).toISOString() : null, bars: out,
  };
}

// ─── Plan analysis runs: one lock shared by manual, hourly and opt-in interval refreshes ─
export type RefreshTrigger = "MANUAL" | "HOURLY_CLOSE" | "INTERVAL";
interface RefreshState { running: Promise<RefreshStatus> | null; trigger: RefreshTrigger | null; startedAt: string | null; lastRunAt: number; lastOkAt: string | null; lastAttemptAt: string | null; lastError: string | null; lastTrigger: RefreshTrigger | null; failedSymbols: string[]; runs: number }
const rs: RefreshState = { running: null, trigger: null, startedAt: null, lastRunAt: 0, lastOkAt: null, lastAttemptAt: null, lastError: null, lastTrigger: null, failedSymbols: [], runs: 0 };
export interface RefreshStatus {
  running: boolean; trigger: RefreshTrigger | null; lastTrigger: RefreshTrigger | null;
  lastOkAt: string | null; lastAttemptAt: string | null; lastError: string | null; failedSymbols: string[];
  intervalMin: 0 | 15 | 30 | 60; hourly: boolean; nextAt: string | null; nextKind: RefreshTrigger | null; marketOpen: boolean; runs: number;
}
const RUN_TIMEOUT_MS = 150_000;
const RTH_OPEN = 510, RTH_CLOSE = 900; // CT minutes (08:30–15:00)
const inSession = (t: number) => { const c = chicago(t); return c.weekday >= 1 && c.weekday <= 5 && c.minutes >= RTH_OPEN + 2 && c.minutes <= RTH_CLOSE + 5; };
/** Next scheduled run (interval during regular hours, or the 1H-close recompute), scanning forward by minute. */
function nextScheduled(s: SwingSettings, nowS: number): { at: number; kind: RefreshTrigger } | null {
  const iv = s.planAutoRefreshMin ?? 0, hourly = s.autoRefresh1H !== false;
  if (!iv && !hourly) return null;
  const start = Math.ceil(nowS / 60) * 60;
  for (let t = start; t < start + 5 * 86400; t += 60) {
    const c = chicago(t);
    if (!(c.weekday >= 1 && c.weekday <= 5)) continue;
    if (hourly) { const b = closeBoundaryNear(c.minutes); if (b != null && c.minutes - b === 2) return { at: t, kind: "HOURLY_CLOSE" }; }
    if (iv && inSession(t) && t >= rs.lastRunAt + iv * 60) return { at: t, kind: "INTERVAL" };
  }
  return null;
}
export async function refreshStatus(): Promise<RefreshStatus> {
  const s = await loadSettings(); const now = nowSec(); const n = nextScheduled(s, now);
  return {
    running: !!rs.running, trigger: rs.trigger, lastTrigger: rs.lastTrigger,
    // Latest successful analysis from any path (scheduled, manual, or a closed-bar refresh on read).
    lastOkAt: [rs.lastOkAt, ...[...evalCache.values()].map((c) => c.res.decision.planRefresh?.analysisAt ?? null)].filter(Boolean).sort().pop() ?? null, lastAttemptAt: rs.lastAttemptAt, lastError: rs.lastError,
    failedSymbols: rs.failedSymbols, intervalMin: (s.planAutoRefreshMin ?? 0) as RefreshStatus["intervalMin"], hourly: s.autoRefresh1H !== false,
    nextAt: n ? new Date(n.at * 1000).toISOString() : null, nextKind: n?.kind ?? null, marketOpen: inSession(now), runs: rs.runs,
  };
}
/** Full plan recalculation for the watchlist. Overlapping callers join the run already in progress (no duplicate requests). */
export function runPlanAnalysis(trigger: RefreshTrigger): Promise<RefreshStatus> {
  if (rs.running) return rs.running;
  // Provider-friendly: a manual click within 30s of the last run just reports that run.
  if (trigger === "MANUAL" && nowSec() - rs.lastRunAt < 30) return refreshStatus();
  rs.trigger = trigger; rs.startedAt = new Date().toISOString(); rs.lastRunAt = nowSec();
  rs.running = (async () => {
    try {
      // Bounded: a slow / rate-limited vendor can't hold the lock forever. Per-symbol fetches already de-duplicate,
      // so a timed-out run's requests finish in the background and simply land in the cache.
      let to: NodeJS.Timeout | undefined;
      const out = await Promise.race([
        scan("DEFAULT_PLUS_CUSTOM", [], [], true),
        new Promise<never>((_, rej) => { to = setTimeout(() => rej(new Error(`Analysis timed out after ${RUN_TIMEOUT_MS / 1000}s (data provider slow or rate-limited) — showing the last successful snapshot.`)), RUN_TIMEOUT_MS); }),
      ]).finally(() => clearTimeout(to));
      const bad = out.rows.filter((r) => r.decision.planRefresh ? !r.decision.planRefresh.ok : r.decision.dataStatus === "ERROR").map((r) => r.item.symbol);
      rs.failedSymbols = bad; rs.lastAttemptAt = new Date().toISOString(); rs.lastTrigger = trigger; rs.runs += 1;
      if (bad.length < out.rows.length) rs.lastOkAt = rs.lastAttemptAt;
      rs.lastError = bad.length ? `Analysis failed for ${bad.join(", ")} — showing the last successful snapshot.` : null;
    } catch (e: any) {
      rs.lastAttemptAt = new Date().toISOString(); rs.lastTrigger = trigger; rs.lastError = e?.message || "Analysis failed"; rs.runs += 1;
      console.warn(`[swing] ${trigger} plan analysis failed:`, rs.lastError);
    }
  })().then(() => { rs.running = null; rs.trigger = null; return refreshStatus(); });
  return rs.running;
}

// ─── Auto-recompute on each closed RTH hour (approved) + opt-in interval — one timer ─
let timer: NodeJS.Timeout | null = null, lastSlot = "";
export function startSwingScheduler() {
  if (timer) return;
  // Warm the cache right after boot so the first chart open is fast.
  setTimeout(() => { if (isUnifiedSwingEnabled()) void scan("DEFAULT_PLUS_CUSTOM", [], [], false).catch(() => {}); }, 3000);
  timer = setInterval(async () => {
    if (!isUnifiedSwingEnabled()) return;
    const now = nowSec(), c = chicago(now);
    if (!(c.weekday >= 1 && c.weekday <= 5)) return;
    try {
      const s = await loadSettings();
      // Fire 2–7 min after each closed RTH 1H bar (09:30 … 14:30, 15:00 CT) to allow vendor latency.
      const b = closeBoundaryNear(c.minutes);
      if (b != null && `${c.ymd}:${b}` !== lastSlot) {
        lastSlot = `${c.ymd}:${b}`;
        if (s.autoRefresh1H !== false) { await runPlanAnalysis("HOURLY_CLOSE"); return; }
      }
      // Opt-in interval refresh during regular hours. Any run (manual / hourly) resets the clock, so nothing doubles up.
      const iv = s.planAutoRefreshMin ?? 0;
      if (iv > 0 && inSession(now) && now - rs.lastRunAt >= iv * 60) await runPlanAnalysis("INTERVAL");
    } catch (e: any) { console.warn("[swing] auto-recompute failed:", e?.message || e); }
  }, 60_000);
  timer.unref?.();
}

/** 1H close boundaries (CT minutes). Returns the boundary if `min` is 2–7 minutes after one. */
export function closeBoundaryNear(min: number): number | null {
  for (let b = 570; b <= 900; b += (b === 870 ? 30 : 60)) if (min - b >= 2 && min - b <= 7) return b;
  return null;
}

export const _test = { evalCache, barKey, rs, nextScheduled, inSession };
export { SETUP_STATUSES };
