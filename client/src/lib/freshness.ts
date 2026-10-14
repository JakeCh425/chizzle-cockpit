// One freshness reading for every surface (card, Ready banner, Do Today, ticket, Priority Board).
// Same scan decision + the plan levels the card shows (My Adjusted Plan when selected) + the live quote.
// PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE. Never changes the engine status or any saved plan.
import { useQuery } from "@tanstack/react-query";
import type { SwingDecision, SwingSettings } from "@shared/swingDecision";
import { effectivePlan, type PlanVersion } from "@shared/practicePlan";
import { computeCardFreshness, type FreshnessResult } from "@shared/cardFreshness";
import { swingGet } from "@/lib/swing";
import { useLiveAllowed } from "@/lib/liveStatus";

export type FreshnessFn = (d: SwingDecision, ver?: PlanVersion | null) => FreshnessResult;

/** Pure: freshness of the levels the card displays. Planned values are copied, never mutated. */
export function freshnessFor(d: SwingDecision, ver: PlanVersion | null | undefined, s: { minRrT1?: number | null; expiryBars4h?: number | null } | undefined, liveAllowed: boolean | null): FreshnessResult {
  const p = effectivePlan(d, ver ?? null);
  const planned: SwingDecision = { ...d, entryPrice: p.entry, structuralStop: p.stop, target1: p.t1 };
  return computeCardFreshness(planned, d.currentPrice ?? NaN, d.extensionCheck?.atrDollar ?? NaN,
    { minRrT1: s?.minRrT1 ?? 2, expiryBars4h: (s?.expiryBars4h ?? 2) as 1 | 2 | 3 }, { liveAllowed });
}

export function useFreshness(): FreshnessFn {
  const settings = useQuery<SwingSettings>({ queryKey: ["/api/swing/settings"], queryFn: () => swingGet("/api/swing/settings"), staleTime: 60_000 });
  const liveAllowed = useLiveAllowed();
  return (d, ver) => freshnessFor(d, ver, settings.data, liveAllowed);
}

/** "⚡ No fresh setups right now. 1 older setup is waiting for a retest (XLE)." */
export function emptyStateText(older: { symbol: string; f: FreshnessResult }[]): string | null {
  if (!older.length) return null;
  const retest = older.filter((o) => o.f.state === "MISSED_ENTRY" || o.f.state === "AGING");
  const list = retest.length ? retest : older;
  const n = list.length, syms = list.map((o) => o.symbol).join(", ");
  return retest.length
    ? `⚡ No fresh setups right now. ${n} older setup${n === 1 ? " is" : "s are"} waiting for a retest (${syms}).`
    : `⚡ No fresh setups right now. ${n} older setup${n === 1 ? " is" : "s are"} not tradeable yet (${syms}).`;
}
