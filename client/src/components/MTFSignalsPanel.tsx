// MTF Signals Panel
// -----------------------------------------------------------------------------
// UI surface for the Chizzle Wealth Engine multi-timeframe signal system.
// Reads /api/mtf/signals (cards) and /api/mtf/universe (tracked tickers).
//
// Cards display every field the spec requires: symbol/exchange, grade,
// status, weekly/daily regime with distances, 4H setup + bar-close time,
// 1H confirmation, entry/stop/targets with R:R, position sizing, data
// vendor + timestamps, and the DATA MISMATCH block.

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { RefreshCw, Plus, X, Settings, ChevronDown, ChevronUp } from "lucide-react";

interface MtfSignal {
  id: string;
  symbol: string;
  exchange: string;
  grade: "A4" | "A3" | "A2" | "WATCH" | "NO_TRADE";
  status: "FORMING" | "CONFIRMED" | "READY_TO_TRADE" | "EARLY_TRIGGER" | "EXPIRED" | "DATA_MISMATCH";
  setupType: string | null;
  tradeLabel: string;
  weeklyRegime: "GREEN" | "NEUTRAL" | "RED";
  weeklySma20: number | null;
  weeklyDistPct: number | null;
  weeklyReclaimForming: boolean;
  dailyRegime: "RECLAIMED" | "PULLBACK_VALID" | "NEUTRAL" | "RED";
  dailySma20: number | null;
  dailyDistPct: number | null;
  setupHigh: number | null;
  setupLow: number | null;
  setupBarCloseTime: string | null;
  setupExpiresAt: string | null;
  h1ConfirmedAt: string | null;
  h1CloseAboveTrigger: number | null;
  entryPrice: number | null;
  stopPrice: number | null;
  target1: number | null;
  target2: number | null;
  target1Rr: number | null;
  target2Rr: number | null;
  riskPerShare: number | null;
  suggestedShares: number | null;
  maxDollarRisk: number;
  dataVendor: string;
  sessionType: string;
  lastCompletedBarTime: string | null;
  currentPrice: number | null;
  quoteTimestamp: string | null;
  tvSourceClose: number | null;
  tvSourceTime: string | null;
  dataMismatchPct: number | null;
  diagnostics: any;
  updatedAt: string;
}

interface UniverseRow {
  id: string;
  symbol: string;
  exchange: string;
  enabled: boolean;
  sortOrder: number;
}

const GRADE_STYLE: Record<string, string> = {
  A4: "bg-signal-green/15 text-signal-green border-signal-green/50",
  A3: "bg-neon-blue/15 text-neon-blue border-neon-blue/50",
  A2: "bg-signal-amber/15 text-signal-amber border-signal-amber/50",
  WATCH: "bg-ink-panel text-slate-gray border-ink-line",
  NO_TRADE: "bg-signal-red/10 text-signal-red border-signal-red/40",
};

const STATUS_STYLE: Record<string, string> = {
  FORMING: "bg-slate-gray/10 text-slate-gray border-slate-gray/30",
  CONFIRMED: "bg-neon-blue/10 text-neon-blue border-neon-blue/40",
  READY_TO_TRADE: "bg-signal-green/15 text-signal-green border-signal-green/50",
  EARLY_TRIGGER: "bg-signal-amber/15 text-signal-amber border-signal-amber/50",
  EXPIRED: "bg-ink-panel text-slate-gray/60 border-ink-line",
  DATA_MISMATCH: "bg-signal-red/15 text-signal-red border-signal-red/50",
};

function fmtMoney(v: number | null | undefined, dp = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${v.toFixed(dp)}`;
}
function fmtPct(v: number | null | undefined, dp = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(dp)}%`;
}
function fmtTimeCT(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", hour12: false });
  } catch { return "—"; }
}

export default function MTFSignalsPanel() {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showUniverse, setShowUniverse] = useState(false);

  const signalsQ = useQuery<MtfSignal[]>({
    queryKey: ["/api/mtf/signals"],
    queryFn: async () => (await (await apiRequest("GET", "/api/mtf/signals")).json()) as MtfSignal[],
    refetchInterval: 30_000,
  });
  const universeQ = useQuery<UniverseRow[]>({
    queryKey: ["/api/mtf/universe"],
    queryFn: async () => (await (await apiRequest("GET", "/api/mtf/universe")).json()) as UniverseRow[],
  });

  const recompute = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/mtf/recompute", {})).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/mtf/signals"] }),
  });

  const signals = signalsQ.data ?? [];

  return (
    <div className="rounded-lg border border-ink-line bg-ink-panel/30" data-testid="mtf-signals-panel">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-ink-line">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-mono uppercase tracking-wider text-soft-white">MTF Swing Engine</span>
          <span className="text-[9px] font-mono uppercase tracking-wider px-1 py-0.5 rounded bg-signal-amber/10 text-signal-amber border border-signal-amber/30">
            Analysis Only
          </span>
          {signals.length > 0 && (
            <span className="text-[9px] font-mono uppercase tracking-wider text-slate-gray">
              {signals.length} card{signals.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => recompute.mutate()}
            disabled={recompute.isPending}
            className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border border-ink-line text-slate-gray hover:text-soft-white hover:bg-ink-panel disabled:opacity-40 flex items-center gap-1"
            data-testid="button-mtf-recompute"
          >
            <RefreshCw className={`w-3 h-3 ${recompute.isPending ? "animate-spin" : ""}`} />
            {recompute.isPending ? "Scanning" : "Refresh Regimes"}
          </button>
          <button
            onClick={() => setShowUniverse((v) => !v)}
            className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border border-ink-line text-slate-gray hover:text-soft-white hover:bg-ink-panel flex items-center gap-1"
            data-testid="button-mtf-universe"
          >
            <Settings className="w-3 h-3" />
            Universe ({universeQ.data?.length ?? 0})
          </button>
        </div>
      </div>

      {/* Universe editor */}
      {showUniverse && <UniverseEditor rows={universeQ.data ?? []} />}

      {/* Cards */}
      <div className="p-2 space-y-2 max-h-[720px] overflow-y-auto">
        {signalsQ.isLoading && (
          <div className="text-[11px] text-slate-gray font-mono px-2 py-4">Loading MTF signals…</div>
        )}
        {!signalsQ.isLoading && signals.length === 0 && (
          <div className="text-[11px] text-slate-gray font-mono px-2 py-4">
            No cards yet. Click "Refresh Regimes" to seed watch cards from the universe, or wait for a TradingView alert.
          </div>
        )}
        {signals.map((s) => (
          <SignalCard
            key={s.id}
            s={s}
            expanded={expandedIds.has(s.id)}
            onToggle={() => {
              setExpandedIds((prev) => {
                const next = new Set(prev);
                if (next.has(s.id)) next.delete(s.id); else next.add(s.id);
                return next;
              });
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ── One card row ─────────────────────────────────────────────────────────────
function SignalCard({ s, expanded, onToggle }: { s: MtfSignal; expanded: boolean; onToggle: () => void }) {
  const isMismatch = s.status === "DATA_MISMATCH" || (s.dataMismatchPct != null && s.dataMismatchPct > 0.15);
  return (
    <div
      className={`rounded border p-2 ${isMismatch ? "border-signal-red/50 bg-signal-red/5" : "border-ink-line bg-ink-black/40"}`}
      data-testid={`mtf-card-${s.symbol}`}
    >
      {/* Header row */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-2 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[13px] font-bold text-soft-white tabular-nums">{s.symbol}</span>
          <span className="text-[9px] font-mono text-slate-gray/70 tabular-nums">{s.exchange}</span>
          <span className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border ${GRADE_STYLE[s.grade]}`}>
            {s.grade}
          </span>
          <span className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border ${STATUS_STYLE[s.status]}`}>
            {s.status.replace(/_/g, " ")}
          </span>
          {isMismatch && (
            <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border bg-signal-red/15 text-signal-red border-signal-red/60">
              DATA MISMATCH — VERIFY
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-mono text-[12px] text-soft-white tabular-nums">{fmtMoney(s.currentPrice)}</span>
          {expanded ? <ChevronUp className="w-3 h-3 text-slate-gray" /> : <ChevronDown className="w-3 h-3 text-slate-gray" />}
        </div>
      </button>

      {/* Compact context row (always visible) */}
      <div className="mt-1.5 grid grid-cols-2 md:grid-cols-4 gap-1.5 text-[10px] font-mono">
        <RegimeChip label="Weekly" value={s.weeklyRegime} sub={s.weeklyDistPct != null ? `${fmtPct(s.weeklyDistPct)} · SMA20 ${fmtMoney(s.weeklySma20)}` : "—"} tone={s.weeklyRegime === "GREEN" ? "green" : s.weeklyRegime === "RED" ? "red" : "gray"} />
        <RegimeChip label="Daily" value={s.dailyRegime.replace("_", " ")} sub={s.dailyDistPct != null ? `${fmtPct(s.dailyDistPct)} · SMA20 ${fmtMoney(s.dailySma20)}` : "—"} tone={s.dailyRegime === "RECLAIMED" || s.dailyRegime === "PULLBACK_VALID" ? "green" : s.dailyRegime === "RED" ? "red" : "gray"} />
        <RegimeChip label="4H Setup" value={s.setupType?.replace(/_/g, " ") ?? "None"} sub={s.setupBarCloseTime ? fmtTimeCT(s.setupBarCloseTime) : "—"} tone={s.setupType ? "blue" : "gray"} />
        <RegimeChip label="1H Confirm" value={s.h1ConfirmedAt ? "Confirmed" : "Waiting"} sub={s.h1ConfirmedAt ? fmtTimeCT(s.h1ConfirmedAt) : (s.setupExpiresAt ? `Expires ${fmtTimeCT(s.setupExpiresAt)}` : "—")} tone={s.h1ConfirmedAt ? "green" : "gray"} />
      </div>

      {expanded && (
        <div className="mt-2 pt-2 border-t border-ink-line/60 space-y-2">
          {/* Trade Plan */}
          <div className="rounded border border-ink-line bg-ink-panel/30 p-2">
            <div className="text-[9px] font-mono uppercase tracking-wider text-slate-gray mb-1">Trade Plan</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] font-mono">
              <KV label="Entry Trigger" value={s.setupHigh != null ? fmtMoney(s.setupHigh) : "—"} />
              <KV label="Entry" value={fmtMoney(s.entryPrice)} />
              <KV label="Structural Stop" value={fmtMoney(s.stopPrice)} />
              <KV label="Risk/Share" value={fmtMoney(s.riskPerShare)} />
              <KV label="T1" value={s.target1 != null ? `${fmtMoney(s.target1)} · ${s.target1Rr?.toFixed(2)}R` : "—"} tone="green" />
              <KV label="T2" value={s.target2 != null ? `${fmtMoney(s.target2)} · ${s.target2Rr?.toFixed(2)}R` : "—"} tone="green" />
              <KV label="Suggested Shares" value={s.suggestedShares != null ? String(s.suggestedShares) : "—"} />
              <KV label="Max $ Risk" value={fmtMoney(s.maxDollarRisk)} />
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-[9px] font-mono text-slate-gray">
              <span className="uppercase tracking-wider px-1 py-0.5 rounded border border-ink-line">
                {s.tradeLabel.replace("_", " ")}
              </span>
              {s.tradeLabel === "SWING" && (
                <span className="text-signal-amber">OVERNIGHT GAP RISK — STOP ORDERS MAY FILL BELOW STOP PRICE.</span>
              )}
              {s.tradeLabel === "COUNTERTREND_PRACTICE" && (
                <span className="text-signal-amber">COUNTERTREND / PRACTICE — REDUCED RISK (25–50% normal).</span>
              )}
            </div>
            {s.suggestedShares != null && s.suggestedShares < 1 && (
              <div className="mt-1 text-[10px] font-mono text-signal-red">
                WATCH ONLY — STRUCTURAL STOP TOO WIDE FOR SELECTED RISK.
              </div>
            )}
          </div>

          {/* Diagnostics */}
          <div className="rounded border border-ink-line bg-ink-panel/30 p-2">
            <div className="text-[9px] font-mono uppercase tracking-wider text-slate-gray mb-1">Diagnostics</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 text-[10px] font-mono text-slate-gray">
              <div>Data vendor: <span className="text-soft-white">{s.dataVendor}</span></div>
              <div>Session: <span className="text-soft-white">{s.sessionType}</span></div>
              <div>Last bar close (CT): <span className="text-soft-white">{fmtTimeCT(s.lastCompletedBarTime)}</span></div>
              <div>Quote time (CT): <span className="text-soft-white">{fmtTimeCT(s.quoteTimestamp)}</span></div>
              <div>TV close: <span className="text-soft-white">{fmtMoney(s.tvSourceClose)}</span></div>
              <div>TV time (CT): <span className="text-soft-white">{fmtTimeCT(s.tvSourceTime)}</span></div>
              <div>Mismatch %: <span className={isMismatch ? "text-signal-red" : "text-soft-white"}>{s.dataMismatchPct != null ? `${s.dataMismatchPct.toFixed(3)}%` : "—"}</span></div>
              <div>Weekly reclaim: <span className="text-soft-white">{s.weeklyReclaimForming ? "Forming (not confirmed)" : "—"}</span></div>
            </div>
            {s.diagnostics && Object.keys(s.diagnostics).length > 0 && (
              <details className="mt-1.5">
                <summary className="text-[9px] font-mono uppercase tracking-wider text-slate-gray cursor-pointer">Raw diagnostics</summary>
                <pre className="mt-1 text-[9px] text-slate-gray/80 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(s.diagnostics, null, 2)}</pre>
              </details>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RegimeChip({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: "green" | "red" | "amber" | "blue" | "gray" }) {
  const dot =
    tone === "green" ? "bg-signal-green" :
    tone === "red"   ? "bg-signal-red" :
    tone === "amber" ? "bg-signal-amber" :
    tone === "blue"  ? "bg-neon-blue" : "bg-slate-gray/60";
  return (
    <div className="rounded border border-ink-line bg-ink-panel/40 p-1.5">
      <div className="flex items-center gap-1.5">
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${dot}`} />
        <span className="text-[9px] uppercase tracking-wider text-slate-gray">{label}</span>
      </div>
      <div className="text-[11px] text-soft-white tabular-nums truncate">{value}</div>
      <div className="text-[9px] text-slate-gray/80 truncate">{sub}</div>
    </div>
  );
}

function KV({ label, value, tone }: { label: string; value: string; tone?: "green" | "red" | "amber" }) {
  const cls = tone === "green" ? "text-signal-green" : tone === "red" ? "text-signal-red" : tone === "amber" ? "text-signal-amber" : "text-soft-white";
  return (
    <div className="rounded border border-ink-line bg-ink-black/40 p-1.5">
      <div className="text-[9px] uppercase tracking-wider text-slate-gray">{label}</div>
      <div className={`text-[11px] tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}

// ── Universe editor ──────────────────────────────────────────────────────────
function UniverseEditor({ rows }: { rows: UniverseRow[] }) {
  const [newSym, setNewSym] = useState("");
  const [newExch, setNewExch] = useState("NASDAQ");

  const add = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/mtf/universe", { symbol: newSym, exchange: newExch, sortOrder: 999 })).json(),
    onSuccess: () => {
      setNewSym("");
      queryClient.invalidateQueries({ queryKey: ["/api/mtf/universe"] });
    },
  });
  const toggle = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) =>
      (await apiRequest("PATCH", `/api/mtf/universe/${id}`, { enabled })).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/mtf/universe"] }),
  });
  const del = useMutation({
    mutationFn: async (id: string) => (await apiRequest("DELETE", `/api/mtf/universe/${id}`)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mtf/universe"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mtf/signals"] });
    },
  });

  return (
    <div className="border-b border-ink-line bg-ink-black/40 p-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <input
          value={newSym}
          onChange={(e) => setNewSym(e.target.value.toUpperCase())}
          placeholder="Symbol"
          className="w-24 px-2 py-1 rounded border border-ink-line bg-ink-panel text-soft-white text-[11px] font-mono uppercase"
          data-testid="input-mtf-new-symbol"
        />
        <input
          value={newExch}
          onChange={(e) => setNewExch(e.target.value.toUpperCase())}
          placeholder="Exchange"
          className="w-24 px-2 py-1 rounded border border-ink-line bg-ink-panel text-soft-white text-[11px] font-mono uppercase"
          data-testid="input-mtf-new-exchange"
        />
        <button
          onClick={() => newSym && add.mutate()}
          disabled={!newSym || add.isPending}
          className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border border-signal-green/50 text-signal-green hover:bg-signal-green/10 disabled:opacity-40 flex items-center gap-1"
          data-testid="button-mtf-add-symbol"
        >
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {rows.map((r) => (
          <div
            key={r.id}
            className={`flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border ${r.enabled ? "border-neon-blue/40 text-soft-white bg-neon-blue/5" : "border-ink-line text-slate-gray/60 bg-ink-panel/40"}`}
          >
            <button onClick={() => toggle.mutate({ id: r.id, enabled: !r.enabled })} title={r.enabled ? "Disable" : "Enable"}>
              <span className="tabular-nums">{r.exchange}:{r.symbol}</span>
            </button>
            <button onClick={() => del.mutate(r.id)} title="Remove" className="text-slate-gray hover:text-signal-red">
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
      <div className="text-[9px] font-mono text-slate-gray/70">
        Click a symbol to toggle enabled/disabled. X removes it. Disabled symbols still hold historical cards but stop receiving webhooks.
      </div>
    </div>
  );
}
