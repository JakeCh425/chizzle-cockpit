// Practice journal — one write path shared by the Trading Card, the Why panel
// and (Part 4) the My Trades lifecycle. PRACTICE ONLY: this records analysis,
// it never places or references a broker order.
//
// Root-cause notes (Part 1 fix):
//  • The insert used to depend on a fresh `decisionFor()` call. When the vendor
//    feed was slow or rate-limited (Yahoo 429) the whole POST failed or hung,
//    so the card silently showed nothing. The decision is now best-effort with
//    a time budget; the client's snapshot (what the card actually displayed,
//    including "My Adjusted Plan" levels) is the fallback.
//  • The Trading Card never invalidated the journal query, so even a
//    successful save never appeared in the list. (Fixed client-side.)
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db } from "../storage";
import { swingJournal, type SwingJournalRow } from "@shared/schema";
import type { SwingDecision } from "@shared/swingDecision";

export const JOURNAL_ACTIONS = ["PRACTICE_TRADE", "WATCH", "OBSERVED", "MISSED", "DO_NOT_TAKE", "NOTE", "ARMED", "FILLED", "CLOSED", "CANCELLED"] as const;
export type JournalAction = (typeof JOURNAL_ACTIONS)[number];

const num = z.number().finite().nullable().optional();
export const journalBodySchema = z.object({
  action: z.enum(JOURNAL_ACTIONS),
  symbol: z.string().min(1).max(16),
  notes: z.string().max(4000).optional(),
  lesson: z.string().max(4000).optional(),
  /** Levels the user actually saw on the card (engine plan or My Adjusted Plan). Win over the fresh decision. */
  levels: z.object({ entry: num, stop: num, target1: num, target2: num, shares: z.number().int().nonnegative().nullable().optional(), label: z.string().max(80).optional() }).optional(),
  /** The decision the card rendered — used when the engine cannot be re-evaluated in time. */
  snapshot: z.record(z.any()).optional(),
  tradeId: z.number().int().positive().optional(),
});
export type JournalBody = z.infer<typeof journalBodySchema>;

/** Build the row to insert. Pure — unit tested. */
export function journalRowFrom(b: JournalBody, d: Partial<SwingDecision> | null, source: "engine" | "snapshot" | "none") {
  const sym = b.symbol.toUpperCase().split(":").pop()!;
  const lv = b.levels ?? {};
  const entry = lv.entry ?? d?.entryPrice ?? null;
  const stop = lv.stop ?? d?.structuralStop ?? null;
  const shares = lv.shares ?? d?.suggestedShares ?? null;
  const riskPerShare = entry != null && stop != null ? Math.abs(entry - stop) : d?.riskPerShare ?? null;
  const decision = { ...(d ?? {}), chart: undefined, journalMeta: { decisionSource: source, planLabel: lv.label ?? (b.levels ? "My Adjusted Plan" : "Engine Plan"), practiceOnly: true } };
  return {
    action: b.action, symbol: d?.symbol ?? sym, setupType: d?.setupType ?? null, grade: d?.cardGrade ?? null,
    timeframes: d ? [d.setupTimeframe, "1H"].filter(Boolean).join("/") : null,
    entry, stop, target1: lv.target1 ?? d?.target1 ?? null, target2: lv.target2 ?? d?.target2 ?? null,
    plannedRisk: riskPerShare != null && shares ? riskPerShare * shares : null,
    notes: b.notes ?? null, lesson: b.lesson ?? null, tradeId: b.tradeId ?? null, decision: decision as any,
  };
}

type Deps = {
  decision: (symbol: string) => Promise<SwingDecision>; budgetMs?: number;
  insert?: (row: ReturnType<typeof journalRowFrom>) => Promise<SwingJournalRow>;
  /** Most recent entry for the symbol — used to swallow accidental double-submits. */
  latest?: (symbol: string) => Promise<SwingJournalRow | undefined>;
};
export const DEDUPE_WINDOW_MS = 10_000;
/** Same symbol + action + levels + notes within 10 s is a double-click, not a second decision. */
export function isDuplicate(prev: SwingJournalRow | undefined, row: ReturnType<typeof journalRowFrom>, now = Date.now()): boolean {
  if (!prev) return false;
  if (now - new Date(prev.createdAt).getTime() > DEDUPE_WINDOW_MS) return false;
  return prev.symbol === row.symbol && prev.action === row.action && prev.entry === row.entry && prev.stop === row.stop && prev.target1 === row.target1 && (prev.notes ?? null) === row.notes && (prev.tradeId ?? null) === row.tradeId;
}

/** Resolve the decision best-effort within a time budget; fall back to the client snapshot. Never throws for vendor reasons. */
export async function createJournalEntry(raw: unknown, deps: Deps): Promise<{ ok: true; entry: SwingJournalRow; decisionSource: "engine" | "snapshot" | "none"; deduped?: true }> {
  const b = journalBodySchema.parse(raw ?? {});
  const budget = deps.budgetMs ?? 6000;
  let d: Partial<SwingDecision> | null = null, source: "engine" | "snapshot" | "none" = "none";
  try {
    const got = await Promise.race([deps.decision(b.symbol), new Promise<null>((r) => setTimeout(() => r(null), budget).unref?.())]);
    if (got) { d = got; source = "engine"; }
  } catch (e: any) { console.warn("[swing/journal] decision unavailable, using snapshot:", e?.message ?? e); }
  if (!d && b.snapshot && Object.keys(b.snapshot).length) { d = b.snapshot as Partial<SwingDecision>; source = "snapshot"; }
  const row = journalRowFrom(b, d, source);
  const latest = deps.latest ?? (async (sym) => (await listJournal(sym, 1))[0]);
  const prev = await latest(row.symbol).catch(() => undefined);
  if (isDuplicate(prev, row)) return { ok: true, entry: prev!, decisionSource: source, deduped: true };
  const insert = deps.insert ?? (async (r) => (await db.insert(swingJournal).values(r).returning())[0]);
  return { ok: true, entry: await insert(row), decisionSource: source };
}

export async function listJournal(symbol?: string, limit = 200): Promise<SwingJournalRow[]> {
  const q = db.select().from(swingJournal);
  return (symbol ? q.where(eq(swingJournal.symbol, symbol.toUpperCase())) : q).orderBy(desc(swingJournal.createdAt)).limit(limit);
}
