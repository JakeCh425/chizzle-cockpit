// Part 4 — practice trades (ARM TRADE → MY TRADES). Pure types + math shared by server and client.
// PRACTICE ONLY — a trade row is a plan and its recorded outcome. Nothing here places or sends an order.
import { z } from "zod";

export const TRADE_STATUSES = ["ARMED", "ACTIVE", "CLOSED", "CANCELLED"] as const;
export type TradeStatus = typeof TRADE_STATUSES[number];
export const EXIT_REASONS = ["STOP", "T1", "T2", "MANUAL"] as const;
export type ExitReason = typeof EXIT_REASONS[number];
export const TRADE_EVENT_KINDS = ["ARMED", "EDITED", "FILLED", "CLOSED", "CANCELLED"] as const;
export type TradeEventKind = typeof TRADE_EVENT_KINDS[number];

/** The levels a user can edit. Planned R is ALWAYS entry − stop (Stop Loss), never the stop-limit price. */
export interface TradeLevels { entry: number; stop: number; stopLimit: number | null; t1: number; t2: number | null; shares: number }
export interface TradeMath {
  riskPerShare: number | null; riskDollars: number | null; rrT1: number | null; rrT2: number | null;
  rewardT1Dollars: number | null; rewardT2Dollars: number | null; positionDollars: number | null;
  problems: string[];        // hard problems (levels make no sense) — the form blocks confirm on these
}
const r2 = (n: number) => Math.round(n * 100) / 100;
const fin = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export function tradeMath(l: Partial<TradeLevels>): TradeMath {
  const problems: string[] = [];
  const entry = fin(l.entry) ? l.entry : null, stop = fin(l.stop) ? l.stop : null, t1 = fin(l.t1) ? l.t1 : null, t2 = fin(l.t2) ? l.t2 : null;
  const shares = fin(l.shares) && l.shares >= 0 ? l.shares : 0;
  if (entry == null || entry <= 0) problems.push("Entry price is required.");
  if (stop == null || stop <= 0) problems.push("Stop loss is required.");
  if (entry != null && stop != null && stop >= entry) problems.push("Stop loss must be below the entry (long practice plan).");
  if (t1 == null || t1 <= 0) problems.push("Target 1 is required.");
  if (entry != null && t1 != null && t1 <= entry) problems.push("Target 1 must be above the entry.");
  if (t2 != null && t1 != null && t2 <= t1) problems.push("Target 2 must be above Target 1.");
  if (fin(l.stopLimit) && stop != null && l.stopLimit >= stop) problems.push("Stop limit must be below the stop loss trigger.");
  if (l.shares != null && (!fin(l.shares) || l.shares < 0)) problems.push("Shares must be zero or more.");
  const riskPerShare = entry != null && stop != null && stop < entry ? r2(entry - stop) : null;
  const rrT1 = riskPerShare && t1 != null && t1 > entry! ? r2((t1 - entry!) / riskPerShare) : null;
  const rrT2 = riskPerShare && t2 != null && t2 > entry! ? r2((t2 - entry!) / riskPerShare) : null;
  return {
    riskPerShare, riskDollars: riskPerShare != null ? r2(riskPerShare * shares) : null, rrT1, rrT2,
    rewardT1Dollars: rrT1 != null && t1 != null ? r2((t1 - entry!) * shares) : null,
    rewardT2Dollars: rrT2 != null && t2 != null ? r2((t2 - entry!) * shares) : null,
    positionDollars: entry != null ? r2(entry * shares) : null, problems,
  };
}

/** Shares that keep $ risk at or under `maxDollarRisk` (floor; 0 when the stop is too wide). */
export function sharesForRisk(entry: number, stop: number, maxDollarRisk: number): number {
  const r = entry - stop; return r > 0 ? Math.max(0, Math.floor(maxDollarRisk / r)) : 0;
}

// ─── Soft risk warnings (never block; the user reads them and decides) ──────────
export interface RiskContext {
  equity: number; maxDailyLossAmount: number; maxWeeklyLossAmount: number; maxDrawdownPercent: number; maxOpenRiskPercent: number; maxRiskPerTradePercent?: number;
  openRiskDollars: number; dailyPnl: number; weeklyPnl: number; drawdownPercent: number; openPracticeTrades?: number;
}
export interface SoftWarning { id: string; severity: "warn" | "high"; text: string }
export const DRAWDOWN_HEADS_UP_PCT = 12; // warn before the 15% max is reached
export function softWarnings(m: TradeMath, ctx: RiskContext): SoftWarning[] {
  const out: SoftWarning[] = []; const $ = (n: number) => `$${Math.abs(n).toFixed(2)}`;
  const risk = m.riskDollars ?? 0;
  if (ctx.equity > 0 && risk > 0) {
    const projected = ctx.openRiskDollars + risk, pct = (projected / ctx.equity) * 100;
    if (pct > ctx.maxOpenRiskPercent) out.push({ id: "OPEN_RISK", severity: "high", text: `Open risk would be ${pct.toFixed(1)}% of equity (${$(projected)}), above your ${ctx.maxOpenRiskPercent}% cap.` });
    if (ctx.maxRiskPerTradePercent && (risk / ctx.equity) * 100 > ctx.maxRiskPerTradePercent) out.push({ id: "PER_TRADE", severity: "warn", text: `This plan risks ${((risk / ctx.equity) * 100).toFixed(2)}% of equity — above your ${ctx.maxRiskPerTradePercent}% per-trade guide.` });
  }
  if (risk > 0 && ctx.dailyPnl - risk <= -ctx.maxDailyLossAmount) out.push({ id: "DAILY", severity: ctx.dailyPnl <= -ctx.maxDailyLossAmount ? "high" : "warn", text: ctx.dailyPnl <= -ctx.maxDailyLossAmount ? `Daily loss limit already hit (${$(ctx.dailyPnl)} of ${$(ctx.maxDailyLossAmount)}).` : `If this stop is hit, today's loss would reach ${$(ctx.dailyPnl - risk)} — past your ${$(ctx.maxDailyLossAmount)} daily limit.` });
  if (risk > 0 && ctx.weeklyPnl - risk <= -ctx.maxWeeklyLossAmount) out.push({ id: "WEEKLY", severity: ctx.weeklyPnl <= -ctx.maxWeeklyLossAmount ? "high" : "warn", text: ctx.weeklyPnl <= -ctx.maxWeeklyLossAmount ? `Weekly loss limit already hit (${$(ctx.weeklyPnl)} of ${$(ctx.maxWeeklyLossAmount)}).` : `If this stop is hit, this week's loss would reach ${$(ctx.weeklyPnl - risk)} — past your ${$(ctx.maxWeeklyLossAmount)} weekly limit.` });
  const dd = Math.abs(ctx.drawdownPercent);
  if (dd >= ctx.maxDrawdownPercent) out.push({ id: "DRAWDOWN", severity: "high", text: `Drawdown is ${dd.toFixed(1)}% — at or past your ${ctx.maxDrawdownPercent}% max.` });
  else if (dd > DRAWDOWN_HEADS_UP_PCT) out.push({ id: "DRAWDOWN_HEADS_UP", severity: "warn", text: `Drawdown is ${dd.toFixed(1)}% — approaching your ${ctx.maxDrawdownPercent}% max. Consider smaller size.` });
  if (m.rrT1 != null && m.rrT1 < 1.5) out.push({ id: "LOW_RR", severity: "warn", text: `Reward:risk to T1 is ${m.rrT1}R — below 1.5R.` });
  return out;
}

// ─── Outcome math ───────────────────────────────────────────────────────────────
/** Realized P&L and R for a close. R uses the fill price (or planned entry) against the planned stop — never the stop limit. */
export function closeMath(t: { entry: number; stop: number; shares: number; fillPrice: number | null }, exitPrice: number): { pnl: number; rMultiple: number | null } {
  const basis = t.fillPrice ?? t.entry; const riskPerShare = basis - t.stop;
  const pnl = r2((exitPrice - basis) * t.shares);
  return { pnl, rMultiple: riskPerShare > 0 ? r2((exitPrice - basis) / riskPerShare) : null };
}
/** Unrealized R for an ACTIVE trade at `price`. */
export function unrealizedR(t: { entry: number; stop: number; fillPrice: number | null }, price: number | null): number | null {
  if (price == null) return null; const basis = t.fillPrice ?? t.entry, r = basis - t.stop;
  return r > 0 ? r2((price - basis) / r) : null;
}

export const TRANSITIONS: Record<TradeStatus, TradeStatus[]> = { ARMED: ["ACTIVE", "CANCELLED"], ACTIVE: ["CLOSED"], CLOSED: [], CANCELLED: [] };
export const canTransition = (from: TradeStatus, to: TradeStatus) => TRANSITIONS[from].includes(to);
export const isOpenStatus = (s: string) => s === "ARMED" || s === "ACTIVE";

// ─── API payload schemas (zod) ──────────────────────────────────────────────────
const price = z.number().finite().positive();
export const levelsSchema = z.object({
  entry: price, stop: price, stopLimit: price.nullable().optional(), t1: price, t2: price.nullable().optional(),
  shares: z.number().finite().min(0),
});
export const armTradeSchema = levelsSchema.extend({
  symbol: z.string().min(1).max(12), exchange: z.string().max(16).optional().default(""),
  setupKey: z.string().max(200).nullable().optional(), setupType: z.string().max(80).nullable().optional(), timeframe: z.string().max(8).nullable().optional(),
  notes: z.string().max(4000).optional().default(""),
  /** Engine levels at arm time (pre-fill) — stored verbatim as `originalLevels`, never changed afterwards. */
  originalLevels: levelsSchema.partial().optional(),
  decisionSnapshot: z.record(z.any()).optional(),
  overrideReason: z.string().max(400).nullable().optional(),
  acknowledgedWarnings: z.array(z.string()).optional(),
});
export type ArmTradeInput = z.infer<typeof armTradeSchema>;
export const patchTradeSchema = levelsSchema.partial().extend({ notes: z.string().max(4000).optional(), reason: z.string().max(400).optional() });
export type PatchTradeInput = z.infer<typeof patchTradeSchema>;
export const fillTradeSchema = z.object({ fillPrice: price, filledAt: z.string().datetime().optional(), note: z.string().max(400).optional() });
export const closeTradeSchema = z.object({ exitPrice: price, exitReason: z.enum(EXIT_REASONS), closedAt: z.string().datetime().optional(), note: z.string().max(400).optional() });
export const cancelTradeSchema = z.object({ note: z.string().max(400).optional() });

/** Wire shape of a practice trade (dates as ISO strings). */
export interface SwingTrade {
  id: number; symbol: string; exchange: string; status: TradeStatus;
  setupKey: string | null; setupType: string | null; timeframe: string | null;
  entry: number; stop: number; stopLimit: number | null; t1: number; t2: number | null; shares: number; riskDollars: number; rrT1: number | null;
  notes: string; originalLevels: Partial<TradeLevels>; decisionSnapshot: Record<string, unknown>; overrideReason: string | null;
  fillPrice: number | null; filledAt: string | null; exitPrice: number | null; exitReason: ExitReason | null; closedAt: string | null; pnl: number | null; rMultiple: number | null;
  armedAt: string; updatedAt: string; cancelledAt: string | null;
}
export interface SwingTradeEvent { id: number; tradeId: number; kind: TradeEventKind; before: Record<string, unknown> | null; after: Record<string, unknown> | null; note: string; at: string }
export interface SwingTradesSummary { openRiskDollars: number; armed: number; active: number; dailyPnl: number; weeklyPnl: number; closedToday: number }
/** Which levels differ from the engine's original (shown as "edited" chips). */
export function editedFields(t: Pick<SwingTrade, "entry" | "stop" | "stopLimit" | "t1" | "t2" | "shares" | "originalLevels">): (keyof TradeLevels)[] {
  const o = t.originalLevels ?? {}; const out: (keyof TradeLevels)[] = [];
  for (const k of ["entry", "stop", "stopLimit", "t1", "t2", "shares"] as const) { const a = (t as any)[k], b = (o as any)[k]; if (b != null && a != null && Math.abs(a - b) > 1e-9) out.push(k); }
  return out;
}
export const PRACTICE_TRADE_NOTE = "PRACTICE ONLY — this records a practice plan and its outcome. It does not place, send or manage any broker order.";

// ─── Part 5 — locked cards: the engine never overwrites a trade's levels; it only reports what it now says. ──────
export interface EngineNowSays { changed: ("entry" | "stop" | "t1" | "t2")[]; engine: { entry: number | null; stop: number | null; t1: number | null; t2: number | null }; text: string | null }
/** Compare the locked trade levels to the engine's current plan. `text` is the info-chip wording, null when nothing differs. */
export function engineNowSays(t: Pick<SwingTrade, "entry" | "stop" | "t1" | "t2">, engine: { entry: number | null; stop: number | null; t1: number | null; t2: number | null } | null): EngineNowSays {
  const e = engine ?? { entry: null, stop: null, t1: null, t2: null };
  const changed = (["entry", "stop", "t1", "t2"] as const).filter((k) => e[k] != null && t[k] != null && Math.abs((e[k] as number) - (t[k] as number)) > 0.005);
  const lbl: Record<string, string> = { entry: "entry", stop: "stop", t1: "T1", t2: "T2" };
  const text = changed.length ? `Engine now says ${changed.map((k) => `${lbl[k]} $${(e[k] as number).toFixed(2)}`).join(" · ")} — your locked levels are unchanged.` : null;
  return { changed, engine: e, text };
}
/** Collapsed-row warning for a locked trade: price past the stop or through T1 must stay visible even when collapsed. */
export function lockedPriceWarning(t: Pick<SwingTrade, "status" | "entry" | "stop" | "t1" | "fillPrice">, price: number | null): string | null {
  if (price == null) return null;
  if (price <= t.stop) return `Price ${price.toFixed(2)} is at or below your stop ${t.stop.toFixed(2)} — review the trade.`;
  if (price >= t.t1) return `Price ${price.toFixed(2)} is at or above your T1 ${t.t1.toFixed(2)} — review the plan.`;
  return null;
}
