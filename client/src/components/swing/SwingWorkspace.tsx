// PR 3e — §Q Unified Swing Workspace (watchlist, scanner, chart, "Can I practice
// this setup?", "Why did this form?", history, settings). Mounted only when
// ENABLE_UNIFIED_SWING_ENGINE is on (or ?unified=1). Every block reads the same
// SwingDecision. Analysis / practice only — there is no broker button anywhere.
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Archive, Eye, EyeOff, Pin, PinOff, RefreshCw, RotateCcw, StickyNote, Trash2, Plus } from "lucide-react";
import CollapsibleSection from "@/components/CollapsibleSection";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  DEFAULT_UNIVERSE_LABEL, GAP_RISK_WARNING, PRACTICE_BANNER, READY_WARNING, FORMING_WARNING, STATUS_LABEL,
  type ChartMarker, type ScanSelection, type SwingDecision, type SwingSettings, type WatchCategory, type PracticeVerdict,
} from "@shared/swingDecision";
import {
  DATA_TONE, STATUS_TONE, fmt$, fmtCT, swingGet, swingSend, useSwingDecision,
  type ScanResp, type WatchlistResp, type WatchRow,
} from "@/lib/swing";
import SwingChart, { type Tf } from "./SwingChart";
import TradeSummaryPanel, { BrokerStep } from "./TradeSummaryPanel";
import { buildTradeSummary } from "@shared/tradeSummary";

const CAT_LABEL: Record<WatchCategory, string> = {
  DEFAULT_LEARNING: "Default Learning", ETFS: "ETFs", SEMICONDUCTOR: "Semiconductor", BROAD_MARKET: "Broad Market",
  GROWTH_TECH: "Growth / Tech", CUSTOM: "Custom", ARCHIVED: "Archived",
};
const PRESETS: { v: ScanSelection; label: string }[] = [
  { v: "DEFAULT", label: "Default" }, { v: "DEFAULT_PLUS_CUSTOM", label: "Default + Custom" }, { v: "ETFS", label: "ETFs" },
  { v: "STOCKS", label: "Stocks" }, { v: "SEMICONDUCTOR", label: "Semiconductor" }, { v: "BROAD_MARKET", label: "Broad Market" },
  { v: "CUSTOM_SELECTION", label: "Custom Selection" },
];
const btn = "px-2 py-1 rounded border border-ink-line text-[11px] text-slate-gray hover:text-soft-white hover:border-neon-blue inline-flex items-center gap-1 disabled:opacity-40";
const iconBtn = "p-1 rounded text-slate-gray hover:text-soft-white hover:bg-white/5 disabled:opacity-30";

function invalidateSwing() {
  queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").startsWith("/api/swing") });
}

export function StatusPill({ s }: { s: SwingDecision["setupStatus"] }) {
  return <span className={`px-1.5 py-0.5 rounded border text-[10.5px] font-mono whitespace-nowrap ${STATUS_TONE[s] ?? ""}`} data-testid="status-setup">{STATUS_LABEL[s]}</span>;
}
function DataPill({ s }: { s: string }) {
  return <span className={`px-1 rounded border text-[9.5px] font-mono ${DATA_TONE[s] ?? "text-slate-gray border-ink-line"}`} data-testid="status-data">{s}</span>;
}

// ─── Watchlist (§Q1) ─────────────────────────────────────────────────────────
function WatchlistPanel({ active, onFocus, selected, onToggleSelect, dataStatus, statusBy }: {
  active: string; onFocus: (s: string) => void; selected: Set<string>; onToggleSelect: (s: string) => void;
  dataStatus: Record<string, string>; statusBy: Record<string, SwingDecision["setupStatus"]>;
}) {
  const { toast } = useToast();
  const wl = useQuery<WatchlistResp>({ queryKey: ["/api/swing/watchlist"], queryFn: () => swingGet("/api/swing/watchlist") });
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [choices, setChoices] = useState<{ symbol: string; exchange: string; name?: string }[]>([]);
  const [cat, setCat] = useState<WatchCategory | "ALL">("ALL");
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");

  const add = useMutation({
    mutationFn: (symbol: string) => swingSend<any>("POST", "/api/swing/watchlist", { symbol }),
    onSuccess: (r) => { setQ(""); setErr(null); setChoices([]); invalidateSwing(); toast({ title: `${r.added?.symbol ?? "Ticker"} added`, description: "Scan it to see its setup status." }); },
    onError: (e: any) => { setErr(e?.body?.error ?? e.message); setChoices(e?.body?.choices ?? []); },
  });
  const patch = useMutation({
    mutationFn: ({ s, p }: { s: string; p: Record<string, unknown> }) => swingSend<any>("PATCH", `/api/swing/watchlist/${encodeURIComponent(s)}`, p),
    onSuccess: () => invalidateSwing(),
    onError: (e: any) => toast({ title: "Not changed", description: e?.body?.error ?? e.message, variant: "destructive" }),
  });
  const del = useMutation({
    mutationFn: (s: string) => swingSend<any>("DELETE", `/api/swing/watchlist/${encodeURIComponent(s)}`),
    onSuccess: () => invalidateSwing(),
    onError: (e: any) => toast({ title: "Not removed", description: e?.body?.error ?? e.message, variant: "destructive" }),
  });
  const restore = useMutation({
    mutationFn: () => swingSend<any>("POST", "/api/swing/watchlist/restore-defaults"),
    onSuccess: () => { invalidateSwing(); toast({ title: "Default learning universe restored", description: "SMH, QQQ and SPY are visible again." }); },
  });

  const items = wl.data?.items ?? [];
  const customCount = items.filter((x) => !x.isDefault).length;
  const shown = items
    .filter((x) => (cat === "ALL" ? !x.categories.includes("ARCHIVED") : x.categories.includes(cat)))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order);
  const move = (x: WatchRow, dir: -1 | 1) => patch.mutate({ s: x.symbol, p: { moveTo: Math.max(0, x.order + dir) } });

  return (
    <div className="space-y-2" data-testid="panel-watchlist">
      <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); if (q.trim()) add.mutate(q.trim().toUpperCase()); }}>
        <input value={q} onChange={(e) => { setQ(e.target.value); setErr(null); }} placeholder="Add ticker or exchange-qualified symbol"
          className="flex-1 min-w-0 bg-ink-deep border border-ink-line rounded px-2 py-1 text-xs text-soft-white placeholder:text-slate-gray/70" data-testid="input-add-ticker" aria-label="Add ticker" />
        <button type="submit" className={btn} disabled={add.isPending || !q.trim() || customCount >= (wl.data?.maxCustomTickers ?? 12)} data-testid="button-add-ticker">
          <Plus className="h-3 w-3" /> {add.isPending ? "Checking…" : "Add"}
        </button>
      </form>
      {err && <div className="text-[11px] text-rose-300" role="alert" data-testid="text-add-error">{err}</div>}
      {choices.length > 0 && (
        <div className="flex flex-wrap gap-1" data-testid="list-exchange-choices">
          {choices.map((c) => (
            <button key={c.exchange + c.symbol} className={btn} onClick={() => add.mutate(`${c.exchange}:${c.symbol}`)} data-testid={`button-choose-${c.exchange}`}>{c.exchange}:{c.symbol}{c.name ? ` — ${c.name}` : ""}</button>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 text-[10.5px] text-slate-gray font-mono">
        <span>{customCount}/{wl.data?.maxCustomTickers ?? 12} custom</span>
        <select value={cat} onChange={(e) => setCat(e.target.value as any)} className="bg-ink-deep border border-ink-line rounded px-1 py-0.5 text-[11px] text-soft-white" data-testid="select-category" aria-label="Category filter">
          <option value="ALL">All active</option>
          {(wl.data?.categories ?? []).map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
        </select>
        <button className={btn} onClick={() => restore.mutate()} disabled={restore.isPending} data-testid="button-restore-defaults"><RotateCcw className="h-3 w-3" /> Restore Defaults</button>
      </div>
      {wl.isLoading && <div className="text-xs text-slate-gray">Loading watchlist…</div>}
      <ul className="divide-y divide-ink-line border border-ink-line rounded" data-testid="list-watchlist">
        {shown.map((x) => (
          <li key={x.symbol} className={`px-2 py-1.5 ${x.symbol === active ? "bg-neon-blue/5" : ""} ${x.hidden ? "opacity-50" : ""}`} data-testid={`row-watch-${x.symbol}`}>
            <div className="flex items-center gap-1.5">
              <input type="checkbox" checked={selected.has(x.symbol)} onChange={() => onToggleSelect(x.symbol)} aria-label={`Select ${x.symbol} for scan`} data-testid={`checkbox-select-${x.symbol}`} />
              <button className="font-mono text-xs font-bold text-soft-white hover:text-neon-blue" onClick={() => onFocus(x.symbol)} data-testid={`button-focus-${x.symbol}`} title="Focus chart">{x.symbol}</button>
              <button className="text-[9.5px] px-1 rounded border border-ink-line text-slate-gray hover:text-soft-white" title="Toggle ETF / Stock"
                onClick={() => patch.mutate({ s: x.symbol, p: { assetType: x.assetType === "ETF" ? "STOCK" : "ETF" } })} data-testid={`button-assettype-${x.symbol}`}>{x.assetType}</button>
              {dataStatus[x.symbol] && <DataPill s={dataStatus[x.symbol]} />}
              {statusBy[x.symbol] && <span className="hidden sm:inline"><StatusPill s={statusBy[x.symbol]} /></span>}
              <span className="ml-auto flex items-center">
                <button className={iconBtn} onClick={() => patch.mutate({ s: x.symbol, p: { pinned: !x.pinned } })} aria-label={x.pinned ? "Unpin" : "Pin"} data-testid={`button-pin-${x.symbol}`}>{x.pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}</button>
                <button className={iconBtn} onClick={() => move(x, -1)} aria-label="Move up" data-testid={`button-up-${x.symbol}`}><ArrowUp className="h-3 w-3" /></button>
                <button className={iconBtn} onClick={() => move(x, 1)} aria-label="Move down" data-testid={`button-down-${x.symbol}`}><ArrowDown className="h-3 w-3" /></button>
                <button className={iconBtn} onClick={() => { setNoteFor(noteFor === x.symbol ? null : x.symbol); setNoteText(x.notes ?? ""); }} aria-label="Notes" data-testid={`button-notes-${x.symbol}`}><StickyNote className="h-3 w-3" /></button>
                <button className={iconBtn} onClick={() => patch.mutate({ s: x.symbol, p: { hidden: !x.hidden } })} aria-label={x.hidden ? "Show" : "Hide"} data-testid={`button-hide-${x.symbol}`}>{x.hidden ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}</button>
                {!x.isDefault && <>
                  <button className={iconBtn} onClick={() => patch.mutate({ s: x.symbol, p: { archived: !x.categories.includes("ARCHIVED") } })} aria-label="Archive" data-testid={`button-archive-${x.symbol}`}><Archive className="h-3 w-3" /></button>
                  <button className={iconBtn} onClick={() => { if (confirm(`Remove ${x.symbol} from the watchlist?`)) del.mutate(x.symbol); }} aria-label="Remove" data-testid={`button-remove-${x.symbol}`}><Trash2 className="h-3 w-3" /></button>
                </>}
              </span>
            </div>
            <div className="text-[10px] text-slate-gray mt-0.5 truncate" title={x.riskNote}>
              {x.isDefault && <span className="text-neon-blue font-mono mr-1">{DEFAULT_UNIVERSE_LABEL}</span>}
              {x.categories.filter((c) => c !== "DEFAULT_LEARNING").map((c) => CAT_LABEL[c]).join(" · ")}
            </div>
            <div className={`text-[10px] mt-0.5 ${x.assetType === "STOCK" ? "text-signal-amber" : "text-slate-gray"}`}>{x.riskNote}</div>
            {x.notes && noteFor !== x.symbol && <div className="text-[10.5px] text-soft-white/80 mt-0.5">“{x.notes}”</div>}
            {noteFor === x.symbol && (
              <div className="flex gap-1 mt-1">
                <input value={noteText} onChange={(e) => setNoteText(e.target.value)} className="flex-1 bg-ink-deep border border-ink-line rounded px-1.5 py-0.5 text-[11px] text-soft-white" data-testid={`input-note-${x.symbol}`} />
                <button className={btn} onClick={() => { patch.mutate({ s: x.symbol, p: { notes: noteText } }); setNoteFor(null); }} data-testid={`button-save-note-${x.symbol}`}>Save</button>
              </div>
            )}
          </li>
        ))}
        {!wl.isLoading && !shown.length && <li className="px-2 py-2 text-[11px] text-slate-gray">No tickers in this category.</li>}
      </ul>
    </div>
  );
}

// ─── Scanner (§Q2) ───────────────────────────────────────────────────────────
function ScannerPanel({ req, setReq, selected, onFocus, active }: {
  req: { selection: ScanSelection; symbols: string[]; force: number }; setReq: (r: { selection: ScanSelection; symbols: string[]; force: number }) => void;
  selected: Set<string>; onFocus: (s: string) => void; active: string;
}) {
  const scan = useScan(req);
  const rows = scan.data?.rows ?? [];
  return (
    <div className="space-y-2" data-testid="panel-scanner">
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <button key={p.v} className={`${btn} ${req.selection === p.v ? "border-neon-blue text-soft-white" : ""}`}
            onClick={() => setReq({ selection: p.v, symbols: p.v === "CUSTOM_SELECTION" ? Array.from(selected) : [], force: 0 })} aria-pressed={req.selection === p.v} data-testid={`button-preset-${p.v}`}>{p.label}</button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        <button className={btn} disabled={!selected.size} onClick={() => setReq({ selection: "CUSTOM_SELECTION", symbols: Array.from(selected), force: Date.now() })} data-testid="button-scan-selected">
          <RefreshCw className="h-3 w-3" /> Scan selected tickers{selected.size ? ` (${selected.size})` : ""}
        </button>
        <button className={btn} onClick={() => setReq({ selection: "DEFAULT_PLUS_CUSTOM", symbols: [], force: Date.now() })} data-testid="button-scan-all"><RefreshCw className="h-3 w-3" /> Scan all active tickers</button>
        <button className={btn} onClick={() => setReq({ selection: "DEFAULT", symbols: [], force: Date.now() })} data-testid="button-scan-reset"><RotateCcw className="h-3 w-3" /> Reset to default learning universe</button>
      </div>
      {scan.isFetching && <div className="text-[11px] text-slate-gray" data-testid="text-scan-loading">Scanning {req.selection === "CUSTOM_SELECTION" ? req.symbols.join(", ") : PRESETS.find((p) => p.v === req.selection)?.label}… (evaluates on closed RTH bars)</div>}
      {scan.error && <div className="text-[11px] text-rose-300" role="alert">Scan failed: {(scan.error as Error).message}. Previous results stay visible.</div>}
      {scan.data?.emptyReason && <div className="text-[11px] text-signal-amber" data-testid="text-scan-empty-reason">{scan.data.emptyReason}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]" data-testid="table-scan">
          <thead><tr className="text-left text-slate-gray font-mono uppercase text-[9.5px]">
            <th className="py-1 pr-2">Ticker</th><th className="pr-2">Status</th><th className="pr-2">Can I practice?</th><th className="pr-2">Trigger</th><th className="pr-2">Stop</th><th className="pr-2">T1</th><th>Reason</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.item.symbol} className={`border-t border-ink-line align-top cursor-pointer hover:bg-white/5 ${r.item.symbol === active ? "bg-neon-blue/5" : ""}`} onClick={() => onFocus(r.item.symbol)} data-testid={`row-scan-${r.item.symbol}`}>
                <td className="py-1 pr-2 font-mono font-bold text-soft-white whitespace-nowrap">{r.item.symbol} <DataPill s={r.decision.dataStatus} /></td>
                <td className="pr-2"><StatusPill s={r.decision.setupStatus} /></td>
                <td className="pr-2 text-soft-white">{r.verdict.headline}</td>
                <td className="pr-2 font-mono">{fmt$(r.decision.originalTrigger)}</td>
                <td className="pr-2 font-mono">{fmt$(r.decision.structuralStop)}</td>
                <td className="pr-2 font-mono">{fmt$(r.decision.target1)}</td>
                <td className="text-slate-gray">{r.decision.nextAction}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {scan.data && <div className="text-[10px] text-slate-gray font-mono">Scanned {scan.data.scanned} · {fmtCT(scan.data.evaluatedAt)} · no ticker is ever removed for having no current trade.</div>}
    </div>
  );
}

export function useScan(req: { selection: ScanSelection; symbols: string[]; force: number }, enabled = true) {
  return useQuery<ScanResp>({
    queryKey: ["/api/swing/scan", req.selection, req.symbols.join(","), req.force],
    queryFn: () => swingGet<ScanResp>(`/api/swing/scan?selection=${req.selection}${req.symbols.length ? `&symbols=${req.symbols.join(",")}` : ""}${req.force ? "&force=1" : ""}`),
    enabled, staleTime: 5 * 60_000, placeholderData: (prev) => prev, retry: false,
  });
}

// ─── "Can I practice this setup?" (§Q6) ──────────────────────────────────────
export function PracticeCard({ d, v }: { d: SwingDecision; v: PracticeVerdict }) {
  const tone = v.code === "A_READY" ? "border-emerald-500/60" : v.code === "B_NOT_YET" ? "border-yellow-500/60" : v.code === "C_WAIT_EXTENDED" ? "border-orange-500/60" : v.code === "D_PASS_RISK" ? "border-rose-500/60" : "border-ink-line";
  const rows: [string, string][] = [
    ["Current status", STATUS_LABEL[d.setupStatus]], ["Entry trigger", fmt$(d.originalTrigger ?? d.entryPrice)], ["Stop", fmt$(d.structuralStop)],
    ["Target 1", fmt$(d.target1)], ["Target 2", fmt$(d.target2)], ["R:R (T1 / T2)", `${d.rewardRiskT1 ?? "—"}R / ${d.rewardRiskT2 ?? "—"}R`],
  ];
  return (
    <div className={`rounded border ${tone} bg-ink-deep p-3 space-y-2`} data-testid="card-practice">
      <div className="text-[10px] font-mono uppercase tracking-wide text-slate-gray">Can I practice this setup?</div>
      <div className="text-sm font-bold text-soft-white" data-testid="text-verdict-headline">{v.headline}</div>
      <ul className="list-disc pl-4 text-[11.5px] text-soft-white/90 space-y-0.5">{v.lines.map((x, i) => <li key={i}>{x}</li>)}</ul>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        {rows.map(([k, val]) => (
          <div key={k} className="rounded border border-ink-line px-2 py-1"><div className="text-[9.5px] uppercase text-slate-gray font-mono">{k}</div><div className="text-[12px] font-mono text-soft-white">{val}</div></div>
        ))}
      </div>
      <div className="text-[11.5px]"><span className="text-slate-gray font-mono uppercase text-[10px]">Next action · </span><span className="text-soft-white" data-testid="text-next-action">{d.nextAction}</span></div>
      <div className="text-[11px] text-slate-gray"><span className="font-mono uppercase text-[10px]">Why / why not · </span>{(d.setupStatus === "READY_TO_TRADE" ? d.passedRules : d.whyNotReady.length ? d.whyNotReady : d.missingConditions).slice(0, 4).join(" · ") || "—"}</div>
      {d.suggestedShares != null && <div className="text-[10.5px] text-slate-gray">Sizing reference (informational, never an order): {d.suggestedShares} sh at {fmt$(d.riskPerShare)} risk/share within ${d.maxDollarRisk} max risk.</div>}
      {d.setupStatus === "SETUP_FORMING" && <div className="text-[10.5px] font-mono text-yellow-300">{FORMING_WARNING}</div>}
      {d.setupStatus === "READY_TO_TRADE" && <div className="text-[10.5px] font-mono text-emerald-300">{READY_WARNING}</div>}
      {d.setupStatus === "READY_TO_TRADE" && <BrokerStep s={buildTradeSummary(d)} compact />}
      <div className="text-[10.5px] font-mono text-rose-300" data-testid="text-gap-risk">{GAP_RISK_WARNING}</div>
      <div className="text-[10px] font-mono text-slate-gray" data-testid="text-practice-banner">{PRACTICE_BANNER}</div>
    </div>
  );
}

// ─── "Why did this form?" (§Q5) ──────────────────────────────────────────────
const STATUS_EXPLAIN = (d: SwingDecision): string => {
  switch (d.setupStatus) {
    case "SETUP_FORMING": return `Need a closed 1H bar above ${fmt$(d.originalTrigger)}.`;
    case "SETUP_CONFIRMED": return "4H setup is valid; waiting for entry confirmation.";
    case "READY_TO_TRADE": return "All selected requirements passed.";
    case "WATCH_EXTENDED": case "WATCH_RETEST": return "Original entry occurred earlier; do not chase.";
    case "WATCH_STOP_TOO_WIDE": return "Structure is valid but risk per share is too large for settings.";
    case "WATCH_RR_TOO_LOW": return "Nearest target does not meet your selected minimum.";
    case "SIGNAL_EXPIRED": return "Confirmation did not occur in time.";
    case "BLOCKED_DATA_MISMATCH": return d.dataMismatchReason ?? "Data sources disagree — READY is blocked until they match.";
    default: return "No confirmed reclaim, pullback, or breakout-retest right now.";
  }
};
const CHECKS = ["I understand the setup type", "I see the entry trigger on the chart", "I see the invalidation/stop on the chart", "I understand Target 1 and Target 2",
  "I accept the selected reward/risk", "I understand this is practice only", "I will wait for closed confirmation"];
const ACTIONS: { a: string; label: string; needsNote?: boolean }[] = [
  { a: "PRACTICE_TRADE", label: "Save as Practice Trade Plan" }, { a: "WATCH", label: "Watch for Confirmation" }, { a: "OBSERVED", label: "Mark Observed Only" },
  { a: "MISSED", label: "Mark Missed" }, { a: "DO_NOT_TAKE", label: "Do Not Take — Journal Why", needsNote: true }, { a: "NOTE", label: "Add Notes", needsNote: true },
];

function WhyPanel({ d, marker }: { d: SwingDecision; marker: ChartMarker | null }) {
  const { toast } = useToast();
  const [checks, setChecks] = useState<boolean[]>(CHECKS.map(() => false));
  const [notes, setNotes] = useState("");
  const noteRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setChecks(CHECKS.map(() => false)); }, [d.symbol, d.setupStatus]);
  const journal = useQuery<any[]>({ queryKey: ["/api/swing/journal", d.symbol], queryFn: () => swingGet(`/api/swing/journal?symbol=${d.symbol}`) });
  const save = useMutation({
    mutationFn: (a: string) => swingSend<any>("POST", "/api/swing/journal", { action: a, symbol: d.symbol, notes: notes || undefined }),
    onSuccess: (_r, a) => { setNotes(""); queryClient.invalidateQueries({ queryKey: ["/api/swing/journal", d.symbol] }); toast({ title: "Saved to practice journal", description: `${d.symbol} — ${ACTIONS.find((x) => x.a === a)?.label}` }); },
    onError: (e: any) => toast({ title: "Not saved", description: e?.body?.error ?? e.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => swingSend<any>("DELETE", `/api/swing/journal/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/swing/journal", d.symbol] }),
  });
  const title = `${d.symbol} — ${(marker?.setupType ?? d.setupType ?? "NO SETUP").replace(/_/g, " ")} — ${STATUS_LABEL[marker?.status ?? d.setupStatus]}`;
  const run = (x: typeof ACTIONS[number]) => {
    if (x.needsNote && !notes.trim()) { noteRef.current?.focus(); toast({ title: "Add a note first", description: "Write why in the notes box, then press the button again." }); return; }
    save.mutate(x.a);
  };
  return (
    <div className="space-y-3 text-[11.5px]" data-testid="panel-why">
      <div className="text-sm font-bold text-soft-white font-mono" data-testid="text-why-title">{title}</div>
      {marker && !marker.current && <div className="text-[10.5px] text-signal-amber">Historical marker — kept for learning; the current decision is shown in the practice card.</div>}
      <section>
        <h4 className="text-[10px] uppercase font-mono text-slate-gray mb-0.5">1. What happened</h4>
        <p className="text-soft-white/90">{d.learningExplanation}</p>
        {marker && <ul className="list-disc pl-4 text-slate-gray mt-1">{marker.tooltip.map((x, i) => <li key={i}>{x}</li>)}</ul>}
        {!marker && d.whyThisPrinted.length > 0 && <ul className="list-disc pl-4 text-slate-gray mt-1">{d.whyThisPrinted.map((x, i) => <li key={i}>{x}</li>)}</ul>}
      </section>
      <section>
        <h4 className="text-[10px] uppercase font-mono text-slate-gray mb-0.5">2. Why the setup formed</h4>
        <ul className="space-y-0.5">
          {d.passedRules.map((x, i) => <li key={"p" + i} className="text-emerald-300">✓ <span className="text-soft-white/90">{x}</span></li>)}
          {d.failedRules.map((x, i) => <li key={"f" + i} className="text-rose-300">✗ <span className="text-soft-white/90">{x}</span></li>)}
          {d.missingConditions.map((x, i) => <li key={"m" + i} className="text-yellow-300">○ <span className="text-soft-white/90">{x}</span></li>)}
          {!d.passedRules.length && !d.failedRules.length && !d.missingConditions.length && <li className="text-slate-gray">No rules evaluated yet.</li>}
        </ul>
      </section>
      <section>
        <h4 className="text-[10px] uppercase font-mono text-slate-gray mb-0.5">3. Why it is or is not tradeable now</h4>
        <p className="text-soft-white/90" data-testid="text-why-status">{STATUS_EXPLAIN(d)}</p>
        {d.invalidation.length > 0 && <p className="text-slate-gray mt-0.5">Invalidates if: {d.invalidation.join(" · ")}</p>}
      </section>
      <section>
        <h4 className="text-[10px] uppercase font-mono text-slate-gray mb-0.5">4. Practice decision checklist</h4>
        <div className="grid sm:grid-cols-2 gap-0.5">
          {CHECKS.map((c, i) => (
            <label key={c} className="flex items-center gap-1.5 text-soft-white/90">
              <input type="checkbox" checked={checks[i]} onChange={() => setChecks(checks.map((v, j) => (j === i ? !v : v)))} data-testid={`checkbox-check-${i}`} /> {c}
            </label>
          ))}
        </div>
        <div className="text-[10px] text-slate-gray mt-0.5">{checks.filter(Boolean).length}/{CHECKS.length} checked</div>
      </section>
      <section className="space-y-1.5">
        <h4 className="text-[10px] uppercase font-mono text-slate-gray">5. Decision</h4>
        <textarea ref={noteRef} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notes / why (saved with the decision snapshot)"
          className="w-full bg-ink-deep border border-ink-line rounded px-2 py-1 text-[11.5px] text-soft-white" data-testid="input-journal-notes" />
        <div className="flex flex-wrap gap-1">
          {ACTIONS.map((x) => <button key={x.a} className={btn} disabled={save.isPending} onClick={() => run(x)} data-testid={`button-journal-${x.a}`}>{x.label}</button>)}
        </div>
        <div className="text-[10px] font-mono text-slate-gray">{PRACTICE_BANNER} · No orders are ever sent from this app.</div>
      </section>
      {(journal.data?.length ?? 0) > 0 && (
        <section>
          <h4 className="text-[10px] uppercase font-mono text-slate-gray mb-0.5">Practice journal — {d.symbol}</h4>
          <ul className="divide-y divide-ink-line border border-ink-line rounded" data-testid="list-journal">
            {journal.data!.slice(0, 8).map((j) => (
              <li key={j.id} className="px-2 py-1 flex gap-2 items-start">
                <span className="font-mono text-[10px] text-neon-blue whitespace-nowrap">{j.action}</span>
                <span className="text-[10.5px] text-slate-gray whitespace-nowrap">{fmtCT(j.createdAt)}</span>
                <span className="text-[10.5px] text-soft-white/80 flex-1">{j.setupType ?? "—"} · entry {fmt$(j.entry)} · stop {fmt$(j.stop)}{j.notes ? ` · “${j.notes}”` : ""}</span>
                <button className={iconBtn} onClick={() => remove.mutate(j.id)} aria-label="Delete journal entry" data-testid={`button-delete-journal-${j.id}`}><Trash2 className="h-3 w-3" /></button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ─── Setup history (Extension never erases history) ──────────────────────────
function HistoryTable({ d }: { d: SwingDecision }) {
  const h = d.chart?.history ?? [];
  if (!h.length) return <div className="text-[11px] text-slate-gray">No setups recorded in this history scope yet.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]" data-testid="table-history">
        <thead><tr className="text-left text-slate-gray font-mono uppercase text-[9.5px]"><th className="py-1 pr-2">When</th><th className="pr-2">TF</th><th className="pr-2">Setup</th><th className="pr-2">Status</th><th className="pr-2">Trigger</th><th className="pr-2">Stop</th><th className="pr-2">T1 / T2</th><th className="pr-2">R</th><th>Reason</th></tr></thead>
        <tbody>
          {h.map((x) => (
            <tr key={x.id} className="border-t border-ink-line align-top" data-testid={`row-history-${x.id}`}>
              <td className="py-1 pr-2 whitespace-nowrap">{fmtCT(x.setupTimestamp)}{x.current && <span className="ml-1 text-neon-blue font-mono">current</span>}</td>
              <td className="pr-2 font-mono">{x.timeframe}</td>
              <td className="pr-2">{x.setupType.replace(/_/g, " ")}</td>
              <td className="pr-2"><StatusPill s={x.status} /></td>
              <td className="pr-2 font-mono">{fmt$(x.trigger)}</td>
              <td className="pr-2 font-mono">{fmt$(x.stop)}</td>
              <td className="pr-2 font-mono whitespace-nowrap">{fmt$(x.t1)} / {fmt$(x.t2)}</td>
              <td className="pr-2 font-mono">{x.rrT1 ?? "—"}</td>
              <td className="text-slate-gray">{x.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Settings (flexible options) ─────────────────────────────────────────────
const TOGGLES: [keyof SwingSettings, string][] = [
  ["showFormingCards", "Show forming cards"], ["showWatchCards", "Show watch cards"], ["showLowQualityForming", "Show low-quality forming (Disciplined)"],
  ["allowCountertrend", "Allow countertrend"], ["requireVolume", "Require volume"], ["requireWeeklyAlignment", "Require weekly alignment"],
  ["requireDailyAlignment", "Require daily alignment"], ["allowEarlyTrigger", "Allow early trigger (higher risk)"], ["allowFirstPullback", "Allow first pullback"],
  ["intradayLearningMode", "Intraday Learning Mode (15m/30m may inform)"], ["autoRefresh1H", "Auto-recompute each closed RTH hour"],
];
function SettingsPanel() {
  const { toast } = useToast();
  const s = useQuery<SwingSettings>({ queryKey: ["/api/swing/settings"], queryFn: () => swingGet("/api/swing/settings") });
  const put = useMutation({
    mutationFn: (p: Partial<SwingSettings>) => swingSend<SwingSettings>("PUT", "/api/swing/settings", p),
    onSuccess: () => { invalidateSwing(); toast({ title: "Swing settings saved", description: "Decisions re-evaluate with the new settings." }); },
    onError: (e: any) => toast({ title: "Not saved", description: e?.body?.error ?? e.message, variant: "destructive" }),
  });
  const v = s.data;
  if (!v) return <div className="text-xs text-slate-gray">Loading settings…</div>;
  const sel = (k: keyof SwingSettings, opts: (string | number)[], label: string, num = false) => (
    <label className="flex flex-col gap-0.5 text-[10.5px] text-slate-gray">{label}
      <select value={String(v[k])} onChange={(e) => put.mutate({ [k]: num ? Number(e.target.value) : e.target.value } as any)} className="bg-ink-deep border border-ink-line rounded px-1 py-0.5 text-[11px] text-soft-white" data-testid={`select-${String(k)}`}>
        {opts.map((o) => <option key={o} value={String(o)}>{String(o)}</option>)}
      </select>
    </label>
  );
  const numIn = (k: keyof SwingSettings, label: string, step: number, min: number, max: number) => (
    <label className="flex flex-col gap-0.5 text-[10.5px] text-slate-gray">{label}
      <input type="number" step={step} min={min} max={max} defaultValue={Number(v[k])} key={`${String(k)}-${v[k]}`}
        onBlur={(e) => { const n = Number(e.target.value); if (isFinite(n) && n !== v[k] && n >= min && n <= max) put.mutate({ [k]: n } as any); }}
        className="bg-ink-deep border border-ink-line rounded px-1 py-0.5 text-[11px] text-soft-white w-full" data-testid={`input-${String(k)}`} />
    </label>
  );
  return (
    <div className="space-y-2" data-testid="panel-swing-settings">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {sel("userMode", ["LEARN", "DISCIPLINED"], "User mode")}
        {sel("signalMode", ["STRICT", "STANDARD", "FLEXIBLE"], "Signal mode")}
        {sel("minRrT1", [1.5, 2, 2.5], "Min R:R to T1", true)}
        {sel("expiryBars4h", [1, 2, 3], "Confirmation window (4H bars)", true)}
        {numIn("maxDollarRisk", "Max $ risk (practice)", 5, 1, 100000)}
        {numIn("maxExtensionPct", "Max extension %", 0.25, 0.25, 5)}
        {numIn("maxExtensionAtr", "Max extension ATR", 0.25, 0.25, 5)}
        {sel("extensionAtrAnchor", ["TRIGGER", "DAILY_SMA20"], "Extension measured from")}
        {numIn("retestZoneAtr", "Retest zone ATR", 0.05, 0, 3)}
        {numIn("retestBelowAtr", "Retest below trigger ATR", 0.05, 0, 2)}
        {sel("a2SetupScope", ["ALL", "SPEC_LIST"], "A2 practice setups")}
      </div>
      <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-1">
        {TOGGLES.map(([k, label]) => (
          <label key={String(k)} className="flex items-center gap-1.5 text-[11px] text-soft-white/90">
            <input type="checkbox" checked={!!v[k]} onChange={() => put.mutate({ [k]: !v[k] } as any)} data-testid={`toggle-${String(k)}`} /> {label}
          </label>
        ))}
      </div>
      <div className="text-[10px] text-slate-gray">Flexible defaults widen matches while keeping closed-candle confirmation. Every level is still analysis / practice only.</div>
    </div>
  );
}

// ─── Workspace ───────────────────────────────────────────────────────────────
export default function SwingWorkspace() {
  const [active, setActive] = useState("SMH");
  const [tf, setTf] = useState<Tf>("4H");
  const [scope, setScope] = useState<"CURRENT" | "LAST5" | "ALL">("LAST5");
  const [marker, setMarker] = useState<ChartMarker | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [req, setReq] = useState<{ selection: ScanSelection; symbols: string[]; force: number }>({ selection: "DEFAULT_PLUS_CUSTOM", symbols: [], force: 0 });
  const whyRef = useRef<HTMLDivElement>(null);

  const scan = useScan(req);
  const dec = useSwingDecision(active, scope);
  const settings = useQuery<SwingSettings>({ queryKey: ["/api/swing/settings"], queryFn: () => swingGet("/api/swing/settings") });
  const d = dec.data?.decision;
  const v = dec.data?.verdict;

  const { dataStatus, statusBy } = useMemo(() => {
    const ds: Record<string, string> = {}, st: Record<string, SwingDecision["setupStatus"]> = {};
    for (const r of scan.data?.rows ?? []) { ds[r.item.symbol] = r.decision.dataStatus; st[r.item.symbol] = r.decision.setupStatus; }
    return { dataStatus: ds, statusBy: st };
  }, [scan.data]);

  const focus = (s: string) => { setActive(s); setMarker(null); };
  const onMarker = (m: ChartMarker) => { setMarker(m); setTimeout(() => whyRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50); };
  const toggleSel = (s: string) => setSelected((prev) => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });

  return (
    <div className="space-y-3" data-testid="swing-workspace">
      <div className="flex flex-wrap items-center gap-2 rounded border border-signal-amber/40 bg-signal-amber/5 px-2 py-1 text-[10.5px] font-mono text-signal-amber" role="note" data-testid="banner-practice">
        <span className="font-bold">{PRACTICE_BANNER}</span><span className="text-slate-gray">·</span><span>{GAP_RISK_WARNING}</span>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(280px,340px)_1fr]">
        <div className="space-y-3 min-w-0">
          <CollapsibleSection id="swing-watchlist" title="Watchlist" hint={DEFAULT_UNIVERSE_LABEL}>
            <WatchlistPanel active={active} onFocus={focus} selected={selected} onToggleSelect={toggleSel} dataStatus={dataStatus} statusBy={statusBy} />
          </CollapsibleSection>
          <CollapsibleSection id="swing-scanner" title="Swing Scanner" hint={`${scan.data?.scanned ?? 0} scanned`}>
            <ScannerPanel req={req} setReq={setReq} selected={selected} onFocus={focus} active={active} />
          </CollapsibleSection>
        </div>
        <div className="space-y-3 min-w-0">
          <CollapsibleSection id="swing-chart" title="Multi-Timeframe Learning Chart" hint={active}>
            {dec.error && <div className="text-[11px] text-rose-300 mb-1" role="alert">{(dec.error as Error).message.replace(/^\d{3}: /, "")}</div>}
            <SwingChart decision={d} tf={tf} onTf={setTf} scope={scope} onScope={setScope} intradayLearningMode={settings.data?.intradayLearningMode} onMarker={onMarker} selectedMarkerId={marker?.id} />
          </CollapsibleSection>
          <CollapsibleSection id="swing-practice" title="Can I Practice This Setup?" hint={d ? STATUS_LABEL[d.setupStatus] : undefined}>
            {d && v ? <PracticeCard d={d} v={v} /> : <div className="text-xs text-slate-gray">{dec.isLoading ? "Evaluating the shared decision…" : "No decision yet."}</div>}
          </CollapsibleSection>
          <CollapsibleSection id="swing-summary" title="Trade Summary · AI Coach" hint={d ? `${d.symbol} · ${STATUS_LABEL[d.setupStatus]}` : undefined}>
            <TradeSummaryPanel d={d} />
          </CollapsibleSection>
          <div ref={whyRef}>
            <CollapsibleSection id="swing-why" title="Why Did This Form?" hint={marker ? marker.label : "click a marker or card"}>
              {d ? <WhyPanel d={d} marker={marker} /> : <div className="text-xs text-slate-gray">Waiting for the decision…</div>}
            </CollapsibleSection>
          </div>
          <CollapsibleSection id="swing-history" title="Setup History" hint={scope === "CURRENT" ? "current" : scope === "LAST5" ? "last 5" : "all"} defaultCollapsed>
            {d ? <HistoryTable d={d} /> : null}
          </CollapsibleSection>
          <CollapsibleSection id="swing-settings" title="Swing Engine Settings" defaultCollapsed>
            <SettingsPanel />
          </CollapsibleSection>
        </div>
      </div>
    </div>
  );
}
