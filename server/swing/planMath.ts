// PR 3c — Trade plan math (spec §I). Pure. Suggested shares are informational only — never an order.
//   entry  = trigger × (1 + entryBufferPct/100)      (a closed 1H above trigger + small buffer)
//   stop   = structureLow − stopBufferAtr × ATR       (structural, never a random fixed %)
//   risk   = entry − stop
//   T1     = nearest logical resistance above entry, OR entry + minRr × risk when none exists
//   T2     = next resistance beyond T1, OR entry + 3.0 × risk
//   T1 R:R < minRr           → RR_TOO_LOW  (report the next resistance)
//   floor(maxRisk/risk) < 1  → STOP_TOO_WIDE (0 shares)

export const T2_R_MULTIPLE = 3.0;

export interface PlanInput {
  trigger: number;
  structureLow: number;
  atr: number | null;
  resistances: number[];     // any order; filtered to those above entry
  minRr: number;
  maxDollarRisk: number;
  entryBufferPct: number;
  stopBufferAtr: number;
}

export type PlanVerdict = "OK" | "RR_TOO_LOW" | "STOP_TOO_WIDE" | "INVALID";

export interface Plan {
  verdict: PlanVerdict;
  entry: number;
  stop: number;
  stopBuffer: number;
  riskPerShare: number;
  t1: number;
  t2: number;
  t1Source: "resistance" | "r-multiple";
  t2Source: "resistance" | "r-multiple";
  rrT1: number;
  rrT2: number;
  shares: number;
  nextResistance: number | null;
  notes: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function buildPlan(p: PlanInput): Plan {
  const entry = r2(p.trigger * (1 + p.entryBufferPct / 100));
  const stopBuffer = r2((p.atr ?? 0) * p.stopBufferAtr);
  const stop = r2(p.structureLow - stopBuffer);
  const risk = r2(entry - stop);
  const notes: string[] = [];
  if (!(risk > 0)) {
    return { verdict: "INVALID", entry, stop, stopBuffer, riskPerShare: risk, t1: entry, t2: entry, t1Source: "r-multiple", t2Source: "r-multiple",
      rrT1: 0, rrT2: 0, shares: 0, nextResistance: null, notes: [`structural stop ${stop} is not below entry ${entry}`] };
  }
  const res = Array.from(new Set(p.resistances.filter((x) => Number.isFinite(x) && x > entry * 1.001).map(r2))).sort((a, b) => a - b);
  let t1: number, t1Source: Plan["t1Source"];
  if (res.length) { t1 = res[0]; t1Source = "resistance"; }
  else { t1 = r2(entry + p.minRr * risk); t1Source = "r-multiple"; notes.push(`no resistance above entry — T1 = entry + ${p.minRr}R`); }
  const beyond = res.filter((x) => x > t1);
  let t2: number, t2Source: Plan["t2Source"];
  if (beyond.length) { t2 = beyond[0]; t2Source = "resistance"; }
  else { t2 = r2(Math.max(entry + T2_R_MULTIPLE * risk, t1 + risk * 0.5)); t2Source = "r-multiple"; }
  const rrT1 = r2((t1 - entry) / risk);
  const rrT2 = r2((t2 - entry) / risk);
  const shares = Math.floor(p.maxDollarRisk / risk);
  let verdict: PlanVerdict = "OK";
  if (shares < 1) {
    verdict = "STOP_TOO_WIDE";
    notes.push(`risk/share $${risk.toFixed(2)} exceeds max dollar risk $${p.maxDollarRisk} → 0 shares`);
  } else if (rrT1 + 1e-9 < p.minRr) {
    verdict = "RR_TOO_LOW";
    notes.push(`T1 R:R ${rrT1.toFixed(2)} < minimum ${p.minRr} (resistance ${t1} caps the move)`);
  }
  return { verdict, entry, stop, stopBuffer, riskPerShare: risk, t1, t2, t1Source, t2Source, rrT1, rrT2, shares: verdict === "STOP_TOO_WIDE" ? 0 : shares,
    nextResistance: res[0] ?? null, notes };
}

/** What would fix a too-wide stop: the risk/share needed for 1 share, and the dollar risk needed at current structure. */
export function stopTooWideAdvice(plan: Plan, maxDollarRisk: number): string {
  return `Risk/share $${plan.riskPerShare.toFixed(2)} vs max $${maxDollarRisk}. Improves if a tighter structure forms (higher low ≥ ${r2(plan.entry - maxDollarRisk)}) or max dollar risk is raised to ≥ $${Math.ceil(plan.riskPerShare)}.`;
}
