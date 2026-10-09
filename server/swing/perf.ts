// Part 3 — lightweight timing profile for the swing engine. In-memory only (no schema), gated behind the
// unified-engine routes. Every vendor call, queue wait and rules pass records a span; `/api/swing/perf`
// returns the recent spans plus per-symbol summaries so slow boots can be explained instead of guessed.
export interface PerfSpan {
  at: string;            // ISO start
  symbol: string | null;
  kind: "vendor" | "queue" | "rules" | "eval" | "scan" | "chart" | "boot";
  label: string;         // e.g. "yahoo:1h", "twelvedata:1h", "quote", "reference", "rules", "eval:total"
  ms: number;
  ok: boolean;
  note?: string;
}
const SPANS: PerfSpan[] = [];
const MAX = 600;
export function recordSpan(s: PerfSpan) {
  SPANS.push(s);
  if (SPANS.length > MAX) SPANS.splice(0, SPANS.length - MAX);
}
/** Time an async function and record it. Never swallows the error. */
export async function timed<T>(kind: PerfSpan["kind"], label: string, symbol: string | null, fn: () => Promise<T>, note?: (v: T) => string | undefined): Promise<T> {
  const t0 = Date.now(), at = new Date(t0).toISOString();
  try { const v = await fn(); recordSpan({ at, symbol, kind, label, ms: Date.now() - t0, ok: true, note: note?.(v) }); return v; }
  catch (e: any) { recordSpan({ at, symbol, kind, label, ms: Date.now() - t0, ok: false, note: e?.message?.slice(0, 120) }); throw e; }
}

export interface PerfSummary {
  since: string | null; spans: number;
  bySymbol: { symbol: string; evals: number; lastEvalMs: number | null; avgEvalMs: number | null; vendorMs: number; queueMs: number; rulesMs: number; failures: number }[];
  byLabel: { label: string; n: number; avgMs: number; p95Ms: number; maxMs: number; failures: number }[];
  scans: { at: string; ms: number; note?: string }[];
  boot: { at: string; label: string; ms: number; note?: string }[];
}
const p95 = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]; };
export function perfSummary(): PerfSummary {
  const sym = new Map<string, PerfSummary["bySymbol"][number] & { evalMs: number[] }>();
  const lab = new Map<string, { ms: number[]; failures: number }>();
  for (const s of SPANS) {
    const l = lab.get(s.label) ?? { ms: [], failures: 0 }; l.ms.push(s.ms); if (!s.ok) l.failures++; lab.set(s.label, l);
    if (!s.symbol) continue;
    const r = sym.get(s.symbol) ?? { symbol: s.symbol, evals: 0, lastEvalMs: null, avgEvalMs: null, vendorMs: 0, queueMs: 0, rulesMs: 0, failures: 0, evalMs: [] };
    if (s.kind === "eval") { r.evals++; r.lastEvalMs = s.ms; r.evalMs.push(s.ms); }
    if (s.kind === "vendor") r.vendorMs += s.ms;
    if (s.kind === "queue") r.queueMs += s.ms;
    if (s.kind === "rules") r.rulesMs += s.ms;
    if (!s.ok) r.failures++;
    sym.set(s.symbol, r);
  }
  return {
    since: SPANS[0]?.at ?? null, spans: SPANS.length,
    bySymbol: [...sym.values()].map(({ evalMs, ...r }) => ({ ...r, avgEvalMs: evalMs.length ? Math.round(evalMs.reduce((a, b) => a + b, 0) / evalMs.length) : null })),
    byLabel: [...lab.entries()].map(([label, v]) => ({ label, n: v.ms.length, avgMs: Math.round(v.ms.reduce((a, b) => a + b, 0) / v.ms.length), p95Ms: p95(v.ms), maxMs: Math.max(...v.ms), failures: v.failures })).sort((a, b) => b.avgMs - a.avgMs),
    scans: SPANS.filter((s) => s.kind === "scan").slice(-20).map((s) => ({ at: s.at, ms: s.ms, note: s.note })),
    boot: SPANS.filter((s) => s.kind === "boot").map((s) => ({ at: s.at, label: s.label, ms: s.ms, note: s.note })),
  };
}
export const recentSpans = (limit = 200) => SPANS.slice(-limit);
export const _resetPerf = () => { SPANS.length = 0; };

/** Run `items` through `fn` with at most `limit` in flight; results keep input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  });
  await Promise.all(workers);
  return out;
}
