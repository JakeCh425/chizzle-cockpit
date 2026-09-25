// PR 3e — consistency strips (§A/§K): when the Unified Swing Engine is on, the
// existing Do Today / Trade Plan / AI Coach panels show the SAME SwingDecision
// status on top, so no module can contradict it. Renders nothing when the flag is off.
import { PRACTICE_BANNER, STATUS_LABEL, type ScanSelection } from "@shared/swingDecision";
import { STATUS_TONE, useSwingDecision, useSwingEnabled } from "@/lib/swing";
import { useScan } from "./SwingWorkspace";

/** Status line for one symbol, read from the shared decision. */
export function SwingStatusStrip({ symbol, context }: { symbol: string; context: string }) {
  const on = useSwingEnabled();
  const q = useSwingDecision(symbol, "LAST5", on);
  if (!on) return null;
  const d = q.data?.decision;
  if (!d) {
    return (
      <div className="rounded border border-ink-line px-2 py-1 text-[10.5px] text-slate-gray font-mono mb-2" data-testid={`swing-strip-${context}`}>
        Unified Swing Engine: {q.isLoading ? "evaluating…" : `${symbol} is not on the unified watchlist — add it there to get one shared status.`}
      </div>
    );
  }
  return (
    <div className={`rounded border px-2 py-1.5 mb-2 text-[11px] ${STATUS_TONE[d.setupStatus] ?? "border-ink-line"}`} data-testid={`swing-strip-${context}`} role="status">
      <div className="font-mono font-bold">Unified decision · {d.symbol}: {STATUS_LABEL[d.setupStatus]}</div>
      <div className="text-soft-white/90">{q.data!.verdict.headline} — {d.nextAction}</div>
      <div className="text-[9.5px] font-mono text-slate-gray mt-0.5">This shared decision is the authority; readouts below are supporting context only. {PRACTICE_BANNER}</div>
    </div>
  );
}

/** §K Do Today lines for the default learning universe (+ custom), from the same scan the workspace uses. */
export function SwingDoToday() {
  const on = useSwingEnabled();
  const req = { selection: "DEFAULT_PLUS_CUSTOM" as ScanSelection, symbols: [], force: 0 };
  const scan = useScan(req, on);
  if (!on) return null;
  const rows = scan.data?.rows ?? [];
  return (
    <div className="rounded-lg border border-ink-line bg-ink-panel px-3 py-2" data-testid="swing-do-today">
      <div className="text-[10px] font-mono uppercase tracking-wide text-slate-gray mb-1">Do today · Unified Swing Engine</div>
      {scan.isLoading && <div className="text-xs text-slate-gray">Evaluating SMH, QQQ, SPY…</div>}
      {scan.data?.emptyReason && <div className="text-xs text-signal-amber">{scan.data.emptyReason}</div>}
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.item.symbol} className="text-[12px] text-soft-white flex gap-2 items-baseline" data-testid={`do-today-${r.item.symbol}`}>
            <span className={`px-1 rounded border text-[10px] font-mono ${STATUS_TONE[r.decision.setupStatus] ?? ""}`}>{r.item.symbol}</span>
            <span>{r.decision.nextAction}</span>
          </li>
        ))}
      </ul>
      <div className="text-[9.5px] font-mono text-slate-gray mt-1">{PRACTICE_BANNER}</div>
    </div>
  );
}

/** Top-level mount for the §Q workspace — nothing renders (and no swing requests fire) when the flag is off. */
export function UnifiedSwingMount({ children }: { children: (enabled: boolean) => React.ReactNode }) {
  const on = useSwingEnabled();
  return <>{on ? children(true) : null}</>;
}
