// Practice journal client helper — ONE write path for the Trading Card, the Why panel and My Trades.
// PRACTICE ONLY: records analysis; nothing here talks to a broker.
import { queryClient } from "@/lib/queryClient";
import { swingSend } from "@/lib/swing";
import type { SwingDecision } from "@shared/swingDecision";
import type { EffectivePlan } from "@shared/practicePlan";

export const JOURNAL_KEY = ["/api/swing/journal"] as const;

export interface JournalEntry {
  id: number; createdAt: string; action: string; symbol: string; setupType: string | null; grade: string | null; timeframes: string | null;
  entry: number | null; stop: number | null; target1: number | null; target2: number | null; plannedRisk: number | null;
  notes: string | null; lesson: string | null; tradeId: number | null; decision: any;
}

export interface JournalPayload {
  action: string; symbol: string; notes?: string; lesson?: string; tradeId?: number;
  levels?: { entry?: number | null; stop?: number | null; target1?: number | null; target2?: number | null; shares?: number | null; label?: string };
  snapshot?: Record<string, unknown>;
}

/** Strip the heavy chart overlay before sending the card's decision as a fallback snapshot. */
export function snapshotOf(d: SwingDecision): Record<string, unknown> {
  const { chart: _chart, ...rest } = d as any;
  return rest;
}

export function levelsOf(p: EffectivePlan) {
  return { entry: p.entry, stop: p.stop, target1: p.t1, target2: p.t2, shares: p.shares, label: p.source === "USER" ? `My Adjusted Plan v${p.version}` : "Engine Plan" };
}

/** POST one entry and refresh every journal list (per-symbol and global). Throws on HTTP error. */
export async function addJournalEntry(body: JournalPayload): Promise<{ ok: true; entry: JournalEntry; decisionSource: string }> {
  const r = await swingSend<{ ok: true; entry: JournalEntry; decisionSource: string }>("POST", "/api/swing/journal", body);
  await queryClient.invalidateQueries({ queryKey: [...JOURNAL_KEY] }); // prefix match → ["/api/swing/journal", SYM] too
  return r;
}
