// Data-status rules v2 — top-level banner + per-card "verify" block.
// Never hides a decision: non-LIVE data only adds labels and blocks Ready (server-side).
import { useState } from "react";
import { RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { SwingDecision, DataStatus } from "@shared/swingDecision";
import { dataVerifyLabel, REFERENCE_ONLY } from "@shared/swingDecision";
import { fmtCT, swingGet } from "@/lib/swing";
import { queryClient } from "@/lib/queryClient";

const BAD: DataStatus[] = ["DELAYED", "STALE", "ERROR", "MISMATCH"];
export const isUnverified = (s: string | undefined) => !!s && (BAD as string[]).includes(s);
const age = (s: number | null | undefined) => (s == null ? "—" : s < 120 ? `${s}s` : s < 7200 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);
const TONE: Record<string, string> = {
  DELAYED: "border-yellow-500/50 bg-yellow-500/5 text-yellow-600 dark:text-yellow-300",
  STALE: "border-orange-500/50 bg-orange-500/5 text-orange-600 dark:text-orange-300",
  ERROR: "border-rose-500/50 bg-rose-500/5 text-rose-600 dark:text-rose-300",
  MISMATCH: "border-fuchsia-500/50 bg-fuchsia-500/5 text-fuchsia-600 dark:text-fuchsia-300",
};

/** Force-refresh the given symbols (only the ones that need it), then re-pull every swing query. */
export async function refreshData(symbols: string[]) {
  await Promise.all(symbols.map((s) => swingGet(`/api/swing/decision/${encodeURIComponent(s)}?force=1`).catch(() => null)));
  await queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").startsWith("/api/swing") || q.queryKey[0] === "/api/flex-scan-cached" });
}

export function RefreshDataButton({ symbols, small }: { symbols: string[]; small?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={`inline-flex items-center gap-1 rounded border border-neon-blue/50 ${small ? "px-1.5 py-0" : "px-2 py-0.5"} text-[10.5px] text-neon-blue hover:bg-neon-blue/10 disabled:opacity-50`}
      disabled={busy || !symbols.length}
      onClick={async (e) => { e.stopPropagation(); setBusy(true); try { await refreshData(symbols); } finally { setBusy(false); } }}
      data-testid="button-refresh-data"
    >
      <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} /> {busy ? "Refreshing…" : "Refresh Data"}
    </button>
  );
}

/** Top-level banner summarizing data status across the scanned tickers. */
export function DataStatusBanner({ decisions }: { decisions: SwingDecision[] }) {
  if (!decisions.length) return null;
  const bad = decisions.filter((d) => isUnverified(d.dataStatus));
  if (!bad.length) {
    const unverified = decisions.filter((d) => !d.dataHealth?.referenceVerified).length;
    return (
      <div className="flex flex-wrap items-center gap-2 rounded border border-emerald-500/40 bg-emerald-500/5 px-2 py-1 text-[10.5px] font-mono text-emerald-600 dark:text-emerald-300" data-testid="banner-data-status">
        <CheckCircle2 className="h-3 w-3" />
        <span className="font-bold">DATA LIVE</span>
        <span className="text-slate-gray">all {decisions.length} tickers have quotes within the 20-min tolerance of the free feed{unverified ? ` · ${unverified} not cross-checked with a chart reference (does not block)` : ""}</span>
      </div>
    );
  }
  const counts = bad.reduce<Record<string, number>>((a, d) => ((a[d.dataStatus] = (a[d.dataStatus] ?? 0) + 1), a), {});
  const worst = (["ERROR", "MISMATCH", "STALE", "DELAYED"] as const).find((s) => counts[s]) ?? "DELAYED";
  return (
    <div className={`rounded border px-2 py-1.5 text-[10.5px] font-mono ${TONE[worst]}`} role="alert" data-testid="banner-data-status">
      <div className="flex flex-wrap items-center gap-2">
        <AlertTriangle className="h-3 w-3" />
        <span className="font-bold">DATA STATUS: {Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(" · ")}</span>
        <span className="text-slate-gray">Ready is blocked on these tickers until fresh data returns — cards and levels stay visible. Retrying automatically.</span>
        <span className="ml-auto"><RefreshDataButton symbols={bad.map((d) => d.symbol)} /></span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-slate-gray" data-testid="list-data-status">
        {bad.map((d) => (
          <span key={d.symbol}><span className="text-soft-white font-bold">{d.symbol}</span> {d.dataStatus} · quote {age(d.dataHealth?.quoteAgeSec)} old</span>
        ))}
      </div>
    </div>
  );
}

/** Verify block on a card when its data is not LIVE (and the provenance grid). */
export function DataVerifyBlock({ d }: { d: SwingDecision }) {
  const h = d.dataHealth;
  if (!isUnverified(d.dataStatus)) {
    return h && !h.referenceVerified ? (
      <div className="text-[9.5px] font-mono text-slate-gray" data-testid={`text-data-unverified-${d.symbol}`}>Data LIVE · quote {age(h.quoteAgeSec)} old · not cross-checked with a chart reference (does not block)</div>
    ) : null;
  }
  const rows: [string, string][] = [
    ["Last app quote", fmtCT(h?.quoteTimestamp ?? d.quoteTimestamp)],
    ["Last completed 1H", fmtCT(h?.lastCompleted1H ?? d.lastCompletedBar1H)],
    ["Last completed 4H", fmtCT(h?.lastCompleted4H ?? d.lastCompletedBar4H)],
    ["Vendor", h?.dataVendor ?? d.dataSource ?? "—"],
    ["Symbol / exchange", `${d.symbol} / ${d.exchange || "—"}`],
    ["Session", h?.marketSession ?? d.session],
    ["Chart reference", h?.referenceTime ? `${h.referenceSource} · ${fmtCT(h.referenceTime)}` : "not connected"],
    ["Mismatch", h?.mismatchAmount ?? d.dataMismatchReason ?? "none"],
  ];
  return (
    <div className={`rounded border px-2 py-1.5 space-y-1 ${TONE[d.dataStatus]}`} data-testid={`card-data-verify-${d.symbol}`}>
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono font-bold">
        <AlertTriangle className="h-3 w-3" /> {dataVerifyLabel(d.dataStatus)}
        <span className="ml-auto"><RefreshDataButton symbols={[d.symbol]} small /></span>
      </div>
      {h?.reason && <div className="text-[10.5px] text-soft-white/85">{h.reason} Quote age {age(h.quoteAgeSec)} · last 1H bar {age(h.completedBarAgeSec)} ago.</div>}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-0.5 text-[9.5px] font-mono">
        {rows.map(([k, v]) => <div key={k}><span className="text-slate-gray">{k}: </span><span className="text-soft-white/90">{v}</span></div>)}
      </div>
    </div>
  );
}

export const ReferenceOnlyTag = () => (
  <span className="px-1.5 rounded border border-yellow-500/50 text-[9.5px] font-mono text-yellow-600 dark:text-yellow-300" data-testid="tag-reference-only">{REFERENCE_ONLY}</span>
);
