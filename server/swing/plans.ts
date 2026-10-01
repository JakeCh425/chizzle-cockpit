// Section R — practice plan versions. The system plan (SwingDecision) is never written
// here; each user edit is appended as a new version. Analysis / practice only.
import { and, desc, eq } from "drizzle-orm";
import { db, pool } from "../storage";
import { swingPlanVersions } from "@shared/schema";
import type { SwingDecision } from "@shared/swingDecision";
import { recalcPlan, setupIdOf, stopLimitOf, type PlanContext, type PlanInputs, type PlanVersion } from "@shared/practicePlan";
import { aggregate4H, tag1H } from "./bars";
import { atr, pivotHighs, pivotLows, type SwingBar } from "./candleMath";
import { evaluateSymbol, loadSettings } from "./service";

let ensured = false;
async function ensureTable() {
  if (ensured) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS swing_plan_versions (
    id SERIAL PRIMARY KEY, symbol TEXT NOT NULL, setup_id TEXT NOT NULL, version INTEGER NOT NULL,
    created_by TEXT NOT NULL DEFAULT 'USER_ADJUSTED', inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
    result JSONB NOT NULL DEFAULT '{}'::jsonb, context JSONB NOT NULL DEFAULT '{}'::jsonb,
    reason TEXT NOT NULL DEFAULT '', changed_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
    chart_state JSONB NOT NULL DEFAULT '{}'::jsonb, data_vendor TEXT,
    selected BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  ensured = true;
}

export { setupIdOf };

export interface SwingPoint { price: number; time: string }
export interface PlanContextResponse {
  setupId: string;
  context: PlanContext;
  swingLows1h: SwingPoint[];
  swingLows4h: SwingPoint[];
  maxDollarRisk: number;
  minRrT1: number;
}

const iso = (t: number) => new Date(t * 1000).toISOString();
function lows(bars: SwingBar[], below: number | null, n = 5): SwingPoint[] {
  const idx = pivotLows(bars, 2);
  return idx.map((i) => ({ price: Math.round(bars[i].l * 100) / 100, time: iso(bars[i].t) }))
    .filter((p) => below == null || p.price < below).slice(-n).reverse();
}

/** Pure: build the context the editor and the server both recalculate from. */
export function buildPlanContext(d: SwingDecision, bars1h: SwingBar[], nowSec: number, maxExtensionPct: number): Omit<PlanContextResponse, "maxDollarRisk" | "minRrT1"> {
  const h1 = tag1H(bars1h, nowSec, true).filter((b) => b.closed);
  const h4 = aggregate4H(bars1h, nowSec).filter((b) => b.closed);
  const ref = d.currentPrice ?? d.entryPrice ?? null;
  const highs = [...pivotHighs(h4, 2).map((i) => h4[i].h), ...pivotHighs(h1, 2).map((i) => h1[i].h)];
  if (d.resistanceZone) highs.push(d.resistanceZone.low);
  const resistances = [...new Set(highs.map((x) => Math.round(x * 100) / 100))].filter((x) => ref == null || x > ref * 0.97).sort((a, b) => a - b).slice(0, 16);
  const o = d.entryPrice != null && d.structuralStop != null ? {
    entry: d.entryPrice, stop: d.structuralStop, stopLimit: stopLimitOf(d.structuralStop),
    t1: d.target1, t2: d.target2, riskPerShare: d.riskPerShare, rrT1: d.rewardRiskT1, rrT2: d.rewardRiskT2,
  } : { entry: null, stop: null, stopLimit: null, t1: null, t2: null, riskPerShare: null, rrT1: null, rrT2: null };
  return {
    setupId: setupIdOf(d),
    context: {
      symbol: d.symbol, exchange: d.exchange, setupType: d.setupType, setupTimestamp: d.setupTimestamp, setupStatus: d.setupStatus,
      originalTrigger: d.originalTrigger, original: o, currentPrice: d.currentPrice, atr1h: atr(h1, 14),
      resistances, maxExtensionPct, dataStatus: d.dataStatus, dataSource: d.dataSource, quoteTimestamp: d.quoteTimestamp,
    },
    swingLows1h: lows(h1, ref),
    swingLows4h: lows(h4, ref),
  };
}

export async function planContext(symbol: string, exchange: string): Promise<PlanContextResponse> {
  const s = await loadSettings();
  const { res, bars1h } = await evaluateSymbol({ symbol, exchange }, { settings: s });
  const base = buildPlanContext(res.decision, bars1h, Math.floor(Date.now() / 1000), s.maxExtensionPct);
  return { ...base, maxDollarRisk: s.maxDollarRisk, minRrT1: s.minRrT1 };
}

const toVersion = (r: any): PlanVersion => ({
  id: r.id, symbol: r.symbol, setupId: r.setupId, version: r.version, createdBy: "USER_ADJUSTED",
  inputs: r.inputs, result: r.result, context: r.context, reason: r.reason, chartState: r.chartState,
  dataVendor: r.dataVendor, createdAt: new Date(r.createdAt).toISOString(), selected: r.selected,
});

export async function listVersions(symbol: string): Promise<PlanVersion[]> {
  await ensureTable();
  const rows = await db.select().from(swingPlanVersions).where(eq(swingPlanVersions.symbol, symbol.toUpperCase())).orderBy(desc(swingPlanVersions.version)).limit(50);
  return rows.map(toVersion);
}

/** Selected user version per symbol (only symbols that have one). */
export async function selectedVersions(): Promise<Record<string, PlanVersion>> {
  await ensureTable();
  const rows = await db.select().from(swingPlanVersions).where(eq(swingPlanVersions.selected, true));
  return Object.fromEntries(rows.map((r) => [r.symbol, toVersion(r)]));
}

export async function saveVersion(symbol: string, exchange: string, inputs: PlanInputs, reason: string, chartState: Record<string, unknown>): Promise<PlanVersion> {
  await ensureTable();
  const sym = symbol.toUpperCase();
  const ctx = await planContext(sym, exchange);
  // The server recomputes — never trusts client-side math.
  const result = recalcPlan(ctx.context, inputs);
  const prev = await db.select({ v: swingPlanVersions.version }).from(swingPlanVersions).where(eq(swingPlanVersions.symbol, sym)).orderBy(desc(swingPlanVersions.version)).limit(1);
  const version = (prev[0]?.v ?? 0) + 1;
  await db.update(swingPlanVersions).set({ selected: false }).where(and(eq(swingPlanVersions.symbol, sym), eq(swingPlanVersions.selected, true)));
  const row = (await db.insert(swingPlanVersions).values({
    symbol: sym, setupId: ctx.setupId, version, createdBy: "USER_ADJUSTED", inputs: inputs as any, result: result as any,
    context: ctx.context as any, reason, changedFields: result.changedFields as any, chartState: chartState as any,
    dataVendor: ctx.context.dataSource, selected: true,
  }).returning())[0];
  return toVersion(row);
}

/** Select a version for every module to use (0 = the system plan). */
export async function selectVersion(symbol: string, version: number): Promise<{ symbol: string; selected: number }> {
  await ensureTable();
  const sym = symbol.toUpperCase();
  if (version > 0) {
    const hit = await db.select({ id: swingPlanVersions.id }).from(swingPlanVersions).where(and(eq(swingPlanVersions.symbol, sym), eq(swingPlanVersions.version, version))).limit(1);
    if (!hit.length) throw Object.assign(new Error(`Plan v${version} not found for ${sym}`), { status: 404 });
  }
  await db.update(swingPlanVersions).set({ selected: false }).where(and(eq(swingPlanVersions.symbol, sym), eq(swingPlanVersions.selected, true)));
  if (version > 0) await db.update(swingPlanVersions).set({ selected: true }).where(and(eq(swingPlanVersions.symbol, sym), eq(swingPlanVersions.version, version)));
  return { symbol: sym, selected: version };
}
