// Part 4 — practice trades: ARM TRADE → MY TRADES. One source of truth (swing_trades) for the card AND the My Trades
// page; every change appends a swing_trade_events row; arming / filling / closing / cancelling also writes a journal
// entry through the Part 1 path. PRACTICE ONLY — nothing here talks to a broker.
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, pool } from "../storage";
import { swingTradeEvents, swingTrades, type SwingTradeEventRow, type SwingTradeRow } from "@shared/schema";
import {
  armTradeSchema, cancelTradeSchema, closeMath, closeTradeSchema, fillTradeSchema, isOpenStatus, patchTradeSchema, tradeMath,
  type ArmTradeInput, type SwingTrade, type SwingTradeEvent, type SwingTradesSummary, type TradeEventKind, type TradeStatus,
} from "@shared/swingTrades";
import { createJournalEntry } from "./journal";
import type { SwingDecision } from "@shared/swingDecision";
import { chicago } from "./bars";

/** Persistence seam: drizzle/Neon in production, in-memory in tests. */
export interface TradeStore {
  ensure(): Promise<void>;
  insert(values: Partial<SwingTradeRow>): Promise<SwingTradeRow>;
  update(id: number, values: Partial<SwingTradeRow>): Promise<SwingTradeRow | undefined>;
  get(id: number): Promise<SwingTradeRow | undefined>;
  list(opts: { status?: TradeStatus[]; symbol?: string; limit?: number }): Promise<SwingTradeRow[]>;
  insertEvent(values: Partial<SwingTradeEventRow>): Promise<void>;
  listEvents(tradeId: number): Promise<SwingTradeEventRow[]>;
}
let ensured = false;
const dbStore: TradeStore = {
  async ensure() {
    if (ensured) return;
    const r = await pool.query(`SELECT to_regclass('public.swing_trades') AS t, to_regclass('public.swing_trade_events') AS e`);
    const row = r.rows[0] ?? {};
    if (!row.t || !row.e) throw new Error("Practice trade tables are missing — run scripts/part4-migrate.mjs");
    ensured = true;
  },
  async insert(values) { return (await db.insert(swingTrades).values(values as any).returning())[0]; },
  async update(id, values) { return (await db.update(swingTrades).set(values as any).where(eq(swingTrades.id, id)).returning())[0]; },
  async get(id) { return (await db.select().from(swingTrades).where(eq(swingTrades.id, id)).limit(1))[0]; },
  async list(opts) {
    const conds = [];
    if (opts.status?.length) conds.push(inArray(swingTrades.status, opts.status));
    if (opts.symbol) conds.push(eq(swingTrades.symbol, opts.symbol.toUpperCase()));
    return db.select().from(swingTrades).where(conds.length ? and(...conds) : undefined).orderBy(desc(swingTrades.armedAt)).limit(opts.limit ?? 500);
  },
  async insertEvent(values) { await db.insert(swingTradeEvents).values(values as any); },
  async listEvents(tradeId) { return db.select().from(swingTradeEvents).where(eq(swingTradeEvents.tradeId, tradeId)).orderBy(desc(swingTradeEvents.at)); },
};
export const _resetEnsured = () => { ensured = false; };

export class TradeError extends Error { constructor(public status: number, msg: string) { super(msg); } }

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
export function toWire(r: SwingTradeRow): SwingTrade {
  return {
    id: r.id, symbol: r.symbol, exchange: r.exchange, status: r.status as TradeStatus,
    setupKey: r.setupKey, setupType: r.setupType, timeframe: r.timeframe,
    entry: r.entry, stop: r.stop, stopLimit: r.stopLimit, t1: r.t1, t2: r.t2, shares: r.shares, riskDollars: r.riskDollars, rrT1: r.rrT1,
    notes: r.notes, originalLevels: (r.originalLevels ?? {}) as any, decisionSnapshot: (r.decisionSnapshot ?? {}) as any, overrideReason: r.overrideReason,
    fillPrice: r.fillPrice, filledAt: iso(r.filledAt), exitPrice: r.exitPrice, exitReason: r.exitReason as any, closedAt: iso(r.closedAt), pnl: r.pnl, rMultiple: r.rMultiple,
    armedAt: iso(r.armedAt)!, updatedAt: iso(r.updatedAt)!, cancelledAt: iso(r.cancelledAt),
  };
}
const eventWire = (e: SwingTradeEventRow): SwingTradeEvent => ({ id: e.id, tradeId: e.tradeId, kind: e.kind as TradeEventKind, before: e.before as any, after: e.after as any, note: e.note, at: iso(e.at)! });

/** The fields the edit history tracks (before/after). */
const LEVEL_KEYS = ["entry", "stop", "stopLimit", "t1", "t2", "shares", "riskDollars", "rrT1", "notes", "status", "fillPrice", "exitPrice", "exitReason", "pnl", "rMultiple"] as const;
const pick = (t: SwingTrade | null) => (t ? Object.fromEntries(LEVEL_KEYS.map((k) => [k, (t as any)[k]])) : null);

type Deps = { decision?: (symbol: string) => Promise<SwingDecision>; now?: () => Date; store?: TradeStore };
let deps: Deps = {};
export function configureTrades(d: Deps) { deps = { ...deps, ...d }; }
const store = () => deps.store ?? dbStore;

/** Journal through the Part 1 path. Never throws — a journal hiccup must not undo a trade change. */
async function journal(action: "ARMED" | "FILLED" | "CLOSED" | "CANCELLED", t: SwingTrade, notes: string) {
  try {
    await createJournalEntry({
      action, symbol: t.symbol, notes, tradeId: t.id,
      levels: { entry: t.entry, stop: t.stop, target1: t.t1, target2: t.t2 ?? t.t1, shares: Math.round(t.shares), label: `Practice trade #${t.id}` },
      snapshot: t.decisionSnapshot,
    // The trade's own decision snapshot (what the user saw when arming) is the record — not a fresh engine read.
    }, { decision: async () => { throw new Error("trade snapshot is authoritative"); }, budgetMs: 1 });
  } catch (e: any) { console.warn(`[swing-trades] journal ${action} #${t.id} failed:`, e?.message); }
}

async function addEvent(tradeId: number, kind: TradeEventKind, before: SwingTrade | null, after: SwingTrade, note = "") {
  await store().insertEvent({ tradeId, kind, before: pick(before), after: pick(after), note, at: deps.now?.() ?? new Date() });
}

export async function listTrades(opts: { status?: TradeStatus[]; symbol?: string; limit?: number } = {}): Promise<SwingTrade[]> {
  await store().ensure();
  return (await store().list(opts)).map(toWire);
}
export async function getTrade(id: number): Promise<SwingTrade> {
  await store().ensure();
  const row = await store().get(id);
  if (!row) throw new TradeError(404, `Practice trade #${id} not found`);
  return toWire(row);
}
export async function listEvents(tradeId: number): Promise<SwingTradeEvent[]> {
  await store().ensure();
  return (await store().listEvents(tradeId)).map(eventWire);
}
/** Symbols with an ARMED/ACTIVE practice trade — Part 3 load-order hook and Part 5 card locking. */
export async function openTradeSymbols(): Promise<string[]> {
  try { return [...new Set((await listTrades({ status: ["ARMED", "ACTIVE"] })).map((t) => t.symbol))]; } catch { return []; }
}

export async function armTrade(raw: unknown): Promise<SwingTrade> {
  await store().ensure();
  const b: ArmTradeInput = armTradeSchema.parse(raw ?? {});
  const m = tradeMath(b);
  if (m.problems.length) throw new TradeError(400, m.problems.join(" "));
  const sym = b.symbol.toUpperCase();
  const dup = await store().list({ symbol: sym, status: ["ARMED", "ACTIVE"], limit: 1 });
  if (dup.length) throw new TradeError(409, `${sym} already has an open practice trade (#${dup[0].id}). Edit or close it from My Trades first.`);
  const snap = { ...(b.decisionSnapshot ?? {}), acknowledgedWarnings: b.acknowledgedWarnings ?? [], armedFrom: "card" };
  const now = deps.now?.() ?? new Date();
  const row = await store().insert({
    symbol: sym, exchange: b.exchange ?? "", status: "ARMED", setupKey: b.setupKey ?? null, setupType: b.setupType ?? null, timeframe: b.timeframe ?? null,
    entry: b.entry, stop: b.stop, stopLimit: b.stopLimit ?? null, t1: b.t1, t2: b.t2 ?? null, shares: b.shares, riskDollars: m.riskDollars ?? 0, rrT1: m.rrT1,
    notes: b.notes ?? "", originalLevels: b.originalLevels ?? { entry: b.entry, stop: b.stop, stopLimit: b.stopLimit ?? null, t1: b.t1, t2: b.t2 ?? null, shares: b.shares },
    decisionSnapshot: snap, overrideReason: b.overrideReason ?? null, armedAt: now, updatedAt: now,
  });
  const t = toWire(row);
  await addEvent(t.id, "ARMED", null, t, b.overrideReason ? `Armed with override: ${b.overrideReason}` : "Armed from the trading card");
  await journal("ARMED", t, `Armed practice trade #${t.id}: entry $${t.entry}, stop $${t.stop}, T1 $${t.t1}${t.t2 != null ? `, T2 $${t.t2}` : ""}, ${t.shares} sh, risk $${t.riskDollars}${b.overrideReason ? ` · override: ${b.overrideReason}` : ""}${b.notes ? ` · ${b.notes}` : ""}`);
  return t;
}

export async function editTrade(id: number, raw: unknown): Promise<SwingTrade> {
  const before = await getTrade(id);
  if (!isOpenStatus(before.status)) throw new TradeError(409, `Practice trade #${id} is ${before.status} — closed trades keep their record.`);
  const p = patchTradeSchema.parse(raw ?? {});
  const merged = { entry: p.entry ?? before.entry, stop: p.stop ?? before.stop, stopLimit: p.stopLimit === undefined ? before.stopLimit : p.stopLimit, t1: p.t1 ?? before.t1, t2: p.t2 === undefined ? before.t2 : p.t2, shares: p.shares ?? before.shares };
  if (before.status === "ACTIVE" && p.entry != null && Math.abs(p.entry - before.entry) > 1e-9) throw new TradeError(400, "An ACTIVE trade's entry is its fill — edit the stop or targets instead.");
  const m = tradeMath(merged);
  if (m.problems.length) throw new TradeError(400, m.problems.join(" "));
  const now = deps.now?.() ?? new Date();
  const after = toWire((await store().update(id, { ...merged, riskDollars: m.riskDollars ?? 0, rrT1: m.rrT1, notes: p.notes ?? before.notes, updatedAt: now }))!);
  const changed = (["entry", "stop", "stopLimit", "t1", "t2", "shares", "notes"] as const).filter((k) => (before as any)[k] !== (after as any)[k]);
  await addEvent(id, "EDITED", before, after, (p.reason ? `${p.reason} · ` : "") + (changed.length ? `changed ${changed.join(", ")}` : "no level change"));
  return after;
}

export async function fillTrade(id: number, raw: unknown): Promise<SwingTrade> {
  const before = await getTrade(id);
  if (before.status !== "ARMED") throw new TradeError(409, `Only an ARMED trade can be marked filled (#${id} is ${before.status}).`);
  const b = fillTradeSchema.parse(raw ?? {});
  const now = deps.now?.() ?? new Date();
  const after = toWire((await store().update(id, { status: "ACTIVE", fillPrice: b.fillPrice, filledAt: b.filledAt ? new Date(b.filledAt) : now, updatedAt: now }))!);
  await addEvent(id, "FILLED", before, after, b.note ?? `Recorded fill at $${b.fillPrice}`);
  await journal("FILLED", after, `Practice trade #${id} recorded as filled at $${b.fillPrice} (planned entry $${after.entry}).${b.note ? ` ${b.note}` : ""}`);
  return after;
}

export async function closeTrade(id: number, raw: unknown): Promise<SwingTrade> {
  const before = await getTrade(id);
  if (before.status !== "ACTIVE") throw new TradeError(409, `Only an ACTIVE trade can be closed (#${id} is ${before.status}). Cancel an ARMED plan instead.`);
  const b = closeTradeSchema.parse(raw ?? {});
  const { pnl, rMultiple } = closeMath(before, b.exitPrice);
  const now = deps.now?.() ?? new Date();
  const after = toWire((await store().update(id, { status: "CLOSED", exitPrice: b.exitPrice, exitReason: b.exitReason, closedAt: b.closedAt ? new Date(b.closedAt) : now, pnl, rMultiple, updatedAt: now }))!);
  await addEvent(id, "CLOSED", before, after, b.note ?? `Closed (${b.exitReason}) at $${b.exitPrice}`);
  await journal("CLOSED", after, `Practice trade #${id} closed via ${b.exitReason} at $${b.exitPrice}: P&L $${pnl.toFixed(2)}${rMultiple != null ? `, ${rMultiple}R` : ""}.${b.note ? ` ${b.note}` : ""}`);
  return after;
}

export async function cancelTrade(id: number, raw: unknown): Promise<SwingTrade> {
  const before = await getTrade(id);
  if (before.status !== "ARMED") throw new TradeError(409, `Only an ARMED trade can be cancelled (#${id} is ${before.status}).`);
  const b = cancelTradeSchema.parse(raw ?? {});
  const now = deps.now?.() ?? new Date();
  const after = toWire((await store().update(id, { status: "CANCELLED", cancelledAt: now, updatedAt: now }))!);
  await addEvent(id, "CANCELLED", before, after, b.note ?? "Cancelled before fill");
  await journal("CANCELLED", after, `Practice trade #${id} cancelled before fill.${b.note ? ` ${b.note}` : ""}`);
  return after;
}

/** Header sync: open risk from ARMED + ACTIVE; realized daily / weekly P&L from CLOSED (Chicago calendar). */
export async function tradesSummary(now = deps.now?.() ?? new Date()): Promise<SwingTradesSummary> {
  const open = await listTrades({ status: ["ARMED", "ACTIVE"] });
  const openRiskDollars = Math.round(open.reduce((a, t) => a + (t.status === "ACTIVE" && t.fillPrice != null ? Math.max(0, t.fillPrice - t.stop) * t.shares : t.riskDollars), 0) * 100) / 100;
  const sec = Math.floor(now.getTime() / 1000), c = chicago(sec);
  const dow = new Date(c.ymd + "T12:00:00Z").getUTCDay(); // 0 = Sunday
  const monday = new Date(new Date(c.ymd + "T12:00:00Z").getTime() - ((dow + 6) % 7) * 86400_000).toISOString().slice(0, 10);
  const closed = (await store().list({ status: ["CLOSED"] })).filter((r) => r.closedAt && new Date(r.closedAt).getTime() >= now.getTime() - 9 * 86400_000);
  let dailyPnl = 0, weeklyPnl = 0, closedToday = 0;
  for (const r of closed) {
    const ymd = chicago(Math.floor(new Date(r.closedAt!).getTime() / 1000)).ymd;
    if (ymd === c.ymd) { dailyPnl += r.pnl ?? 0; closedToday++; }
    if (ymd >= monday) weeklyPnl += r.pnl ?? 0;
  }
  return { openRiskDollars, armed: open.filter((t) => t.status === "ARMED").length, active: open.filter((t) => t.status === "ACTIVE").length, dailyPnl: Math.round(dailyPnl * 100) / 100, weeklyPnl: Math.round(weeklyPnl * 100) / 100, closedToday };
}

/** Rows for the legacy risk feed (/api/risk/open-positions) so the header's Open Risk includes ACTIVE practice trades. */
export async function openPositionRisks() {
  const open = await listTrades({ status: ["ACTIVE"] });
  return open.map((t) => ({ id: `swing:${t.id}`, ticker: t.symbol, direction: "long" as const, avgFillPrice: t.fillPrice ?? t.entry, stopPrice: t.stop, openShares: t.shares, riskDollars: Math.round(Math.max(0, (t.fillPrice ?? t.entry) - t.stop) * t.shares * 100) / 100, source: "swing" as const }));
}
/** Rows for /api/analytics/trades so Daily / Weekly P&L and expectancy include CLOSED practice trades. */
export async function closedUnifiedRows(from?: string, to?: string) {
  const closed = await listTrades({ status: ["CLOSED"] });
  return closed.filter((t) => t.closedAt && (!from || t.closedAt >= from) && (!to || t.closedAt.slice(0, 10) <= to)).map((t) => ({
    id: `swing:${t.id}`, source: "swing" as const, ticker: t.symbol, setupType: t.setupType ?? "swing", setupTypeRaw: t.setupType ?? "swing", direction: "long" as const, status: "closed" as const,
    openedAt: t.filledAt ?? t.armedAt, closedAt: t.closedAt!, netPnl: t.pnl ?? 0, plannedRiskDollars: t.riskDollars, rMultiple: t.rMultiple, followedPlan: null, tags: ["practice"],
    holdDays: Math.max(0, Math.round((new Date(t.closedAt!).getTime() - new Date(t.filledAt ?? t.armedAt).getTime()) / 86400_000)),
  }));
}
