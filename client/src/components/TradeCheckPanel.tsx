// ─── Chizzle Trade Check Panel ──────────────────────────────────────────────
// Manual trade-vetting panel that runs the tiered Chizzle evaluator
// (Standard → Flex → Practice → No-Trade). Lives on the Cockpit page under
// the Fidelity cheat sheet so the workflow is:
//
//   1. Active Setups Strip suggests a setup (or you spot one yourself)
//   2. Plug numbers into Trade Check → confirm STATUS
//   3. If APPROVED, place the order via Fidelity OTOCO using the cheat sheet
//   4. Log in Trades page
//
// Collapsed by default to keep the cockpit clean.

import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  ChevronDown, ChevronUp, ShieldCheck, AlertCircle, BookOpenCheck,
  XCircle, Loader2, Sparkles, Target,
} from "lucide-react";

type TradeStatus =
  | "STANDARD_SWING_APPROVED"
  | "FLEX_SWING_APPROVED"
  | "PRACTICE_CARD"
  | "NO_TRADE";

interface TradeCheckResult {
  status: TradeStatus;
  setup_type: string;
  regime: string;
  entry: number;
  stop: number;
  t1: number;
  t2: number | null;
  risk_reward: { t1: number; t2: number | null };
  technical_score: number;
  fundamental_score: number;
  one_sentence_reason: string;
  card_summary_5_lines: string[] | null;
  diagnostics: {
    sma20: number;
    distance_from_sma20_pct: number;
    current_price: number;
    near_resistance: boolean;
    nearest_resistance: number | null;
    structure: string;
    standard_failures: string[];
    flex_failures: string[];
    technical_breakdown: Record<string, number>;
    fundamental_breakdown: Record<string, number>;
  };
}

// Status styling — each verdict gets its own color + icon so the eye can
// pattern-match instantly. Bloomberg-style neon accents.
const STATUS_STYLES: Record<TradeStatus, { color: string; bg: string; border: string; label: string; Icon: typeof ShieldCheck }> = {
  STANDARD_SWING_APPROVED: {
    color: "text-signal-green",
    bg: "bg-signal-green/15",
    border: "border-signal-green/60",
    label: "STANDARD APPROVED",
    Icon: ShieldCheck,
  },
  FLEX_SWING_APPROVED: {
    color: "text-neon-blue",
    bg: "bg-neon-blue/15",
    border: "border-neon-blue/60",
    label: "FLEX APPROVED",
    Icon: Sparkles,
  },
  PRACTICE_CARD: {
    color: "text-signal-amber",
    bg: "bg-signal-amber/15",
    border: "border-signal-amber/60",
    label: "PRACTICE CARD",
    Icon: BookOpenCheck,
  },
  NO_TRADE: {
    color: "text-signal-red",
    bg: "bg-signal-red/15",
    border: "border-signal-red/60",
    label: "NO TRADE",
    Icon: XCircle,
  },
};

function num(s: string): number | null {
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Compact bar that renders a 0–5 score as 5 segmented blocks.
function ScoreBar({ value, max = 5, color }: { value: number; max?: number; color: string }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <div
          key={i}
          className={`w-1.5 h-3 rounded-sm ${i < value ? color : "bg-ink-line/40"}`}
        />
      ))}
      <span className="ml-1.5 text-[10px] font-mono tabular-nums text-slate-gray">{value}/{max}</span>
    </div>
  );
}

export default function TradeCheckPanel() {
  const [open, setOpen] = useState(false);
  const [ticker, setTicker] = useState("SMH");
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [t1, setT1] = useState("");
  const [t2, setT2] = useState("");
  const [result, setResult] = useState<TradeCheckResult | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Listen for prefill-plan events fired by ProximityWatchPanel READY tiles.
  useEffect(() => {
    function onPrefill(e: Event) {
      const detail = (e as CustomEvent).detail as {
        ticker: string; entry: number; stop: number; t1: number; t2: number | null;
      };
      if (!detail) return;
      setTicker(detail.ticker);
      setEntry(String(detail.entry));
      setStop(String(detail.stop));
      setT1(String(detail.t1));
      setT2(detail.t2 != null ? String(detail.t2) : "");
      setResult(null);
      setValidationError(null);
      setOpen(true);
    }
    window.addEventListener("chizzle:prefill-plan", onPrefill);
    return () => window.removeEventListener("chizzle:prefill-plan", onPrefill);
  }, []);

  const checkMutation = useMutation({
    mutationFn: async (payload: { ticker: string; entry: number; stop: number; t1: number; t2: number | null }) => {
      const r = await apiRequest("POST", "/api/trade-check", payload);
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error || "trade-check failed");
      }
      return (await r.json()) as TradeCheckResult;
    },
    onSuccess: (data) => {
      setResult(data);
      setValidationError(null);
    },
    onError: (err: Error) => {
      setValidationError(err.message);
      setResult(null);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const e_ = num(entry);
    const s_ = num(stop);
    const t1_ = num(t1);
    const t2_ = t2.trim() === "" ? null : num(t2);
    if (e_ == null || s_ == null || t1_ == null) {
      setValidationError("Entry, Stop, and T1 are required and must be positive numbers");
      return;
    }
    if (s_ >= e_) { setValidationError("Stop must be below entry"); return; }
    if (t1_ <= e_) { setValidationError("T1 must be above entry"); return; }
    if (t2.trim() !== "" && t2_ == null) { setValidationError("T2 must be a positive number or empty"); return; }
    setValidationError(null);
    checkMutation.mutate({ ticker: ticker.trim().toUpperCase(), entry: e_, stop: s_, t1: t1_, t2: t2_ });
  }

  function clearForm() {
    setEntry(""); setStop(""); setT1(""); setT2("");
    setResult(null);
    setValidationError(null);
  }

  const styles = result ? STATUS_STYLES[result.status] : null;

  return (
    <div className="border border-ink-line/80 bg-ink-deep/30 rounded-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-ink-line/20 transition-colors"
        data-testid="button-toggle-trade-check"
      >
        <div className="flex items-center gap-2">
          <Target className="w-3.5 h-3.5 text-neon-blue" />
          <span className="text-[11px] uppercase tracking-wider font-semibold text-soft-white">
            Trade Check · Chizzle Evaluator
          </span>
          <span className="text-[10px] text-slate-gray italic">
            Standard → Flex → Practice → No-Trade
          </span>
        </div>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-slate-gray" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-gray" />}
      </button>

      {open && (
        <div className="px-3 py-3 border-t border-ink-line/60 space-y-3">
          {/* Input form */}
          <form onSubmit={handleSubmit} className="space-y-2">
            <div className="grid grid-cols-5 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[9px] uppercase tracking-wider text-slate-gray">Ticker</span>
                <input
                  type="text"
                  value={ticker}
                  onChange={(e) => setTicker(e.target.value.toUpperCase())}
                  className="rounded-sm bg-ink-black border border-ink-line px-2 py-1 font-mono text-[12px] text-soft-white focus:border-neon-blue focus:outline-none"
                  data-testid="input-trade-ticker"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[9px] uppercase tracking-wider text-slate-gray">Entry</span>
                <input
                  type="number"
                  step="0.01"
                  value={entry}
                  onChange={(e) => setEntry(e.target.value)}
                  placeholder="648.00"
                  className="rounded-sm bg-ink-black border border-ink-line px-2 py-1 font-mono text-[12px] text-soft-white focus:border-neon-blue focus:outline-none"
                  data-testid="input-trade-entry"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[9px] uppercase tracking-wider text-slate-gray">Stop</span>
                <input
                  type="number"
                  step="0.01"
                  value={stop}
                  onChange={(e) => setStop(e.target.value)}
                  placeholder="636.50"
                  className="rounded-sm bg-ink-black border border-ink-line px-2 py-1 font-mono text-[12px] text-soft-white focus:border-signal-red focus:outline-none"
                  data-testid="input-trade-stop"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[9px] uppercase tracking-wider text-slate-gray">T1</span>
                <input
                  type="number"
                  step="0.01"
                  value={t1}
                  onChange={(e) => setT1(e.target.value)}
                  placeholder="668.00"
                  className="rounded-sm bg-ink-black border border-ink-line px-2 py-1 font-mono text-[12px] text-soft-white focus:border-signal-green focus:outline-none"
                  data-testid="input-trade-t1"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[9px] uppercase tracking-wider text-slate-gray">T2 (opt)</span>
                <input
                  type="number"
                  step="0.01"
                  value={t2}
                  onChange={(e) => setT2(e.target.value)}
                  placeholder="685.00"
                  className="rounded-sm bg-ink-black border border-ink-line px-2 py-1 font-mono text-[12px] text-soft-white focus:border-signal-green focus:outline-none"
                  data-testid="input-trade-t2"
                />
              </label>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] text-slate-gray italic">
                Pulls live 20-SMA, regime, structure, theme strength, R:R, resistance — auto-classifies.
              </div>
              <div className="flex items-center gap-2">
                {result && (
                  <button
                    type="button"
                    onClick={clearForm}
                    className="rounded-sm border border-ink-line text-slate-gray hover:text-soft-white hover:border-soft-white/40 px-2 py-1 text-[10px] uppercase tracking-wider"
                    data-testid="button-clear-trade-check"
                  >
                    Clear
                  </button>
                )}
                <button
                  type="submit"
                  disabled={checkMutation.isPending}
                  className="rounded-sm bg-neon-blue/20 border border-neon-blue/60 text-neon-blue hover:bg-neon-blue/30 px-3 py-1 text-[10px] uppercase tracking-wider font-semibold disabled:opacity-50 flex items-center gap-1.5"
                  data-testid="button-run-trade-check"
                >
                  {checkMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Target className="w-3 h-3" />}
                  Evaluate
                </button>
              </div>
            </div>

            {validationError && (
              <div className="flex items-center gap-1.5 text-[10px] text-signal-red">
                <AlertCircle className="w-3 h-3" />
                {validationError}
              </div>
            )}
          </form>

          {/* Result */}
          {result && styles && (
            <div className={`rounded-sm border ${styles.border} ${styles.bg} p-3 space-y-2.5`}>
              {/* Verdict header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <styles.Icon className={`w-4 h-4 ${styles.color}`} />
                  <span className={`text-[12px] font-bold tracking-wider ${styles.color}`}>{styles.label}</span>
                  <span className="text-[10px] text-slate-gray uppercase tracking-wider">· {result.setup_type}</span>
                </div>
                <span className="text-[10px] font-mono text-slate-gray">regime {result.regime}</span>
              </div>

              {/* Reason */}
              <div className="text-[11px] text-soft-white/90 leading-snug">
                {result.one_sentence_reason}
              </div>

              {/* Numbers grid */}
              <div className="grid grid-cols-4 gap-x-3 gap-y-1 font-mono text-[10.5px] tabular-nums pt-1.5 border-t border-ink-line/40">
                <div><span className="text-slate-gray uppercase tracking-wider text-[9px]">Entry</span><br/><span className="text-soft-white">${result.entry.toFixed(2)}</span></div>
                <div><span className="text-slate-gray uppercase tracking-wider text-[9px]">Stop</span><br/><span className="text-signal-red">${result.stop.toFixed(2)}</span></div>
                <div><span className="text-slate-gray uppercase tracking-wider text-[9px]">T1</span><br/><span className="text-signal-green">${result.t1.toFixed(2)}</span> <span className="text-slate-gray">({result.risk_reward.t1}:1)</span></div>
                <div><span className="text-slate-gray uppercase tracking-wider text-[9px]">T2</span><br/>{result.t2 != null ? <><span className="text-signal-green">${result.t2.toFixed(2)}</span> <span className="text-slate-gray">({result.risk_reward.t2}:1)</span></> : <span className="text-slate-gray">—</span>}</div>
              </div>

              {/* Scores */}
              <div className="grid grid-cols-2 gap-3 pt-1.5 border-t border-ink-line/40">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] uppercase tracking-wider text-slate-gray">Technical</span>
                  <ScoreBar value={result.technical_score} color="bg-neon-blue" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] uppercase tracking-wider text-slate-gray">Fundamental</span>
                  <ScoreBar value={result.fundamental_score} color="bg-signal-green" />
                </div>
              </div>

              {/* Card summary (only if approved) */}
              {result.card_summary_5_lines && (
                <div className="pt-2 border-t border-ink-line/40">
                  <div className="text-[9px] uppercase tracking-wider text-slate-gray mb-1">Card-ready summary</div>
                  <div className="space-y-0.5 font-mono text-[10.5px] text-soft-white/90">
                    {result.card_summary_5_lines.map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Diagnostics */}
              <details className="pt-2 border-t border-ink-line/40 group">
                <summary className="text-[9px] uppercase tracking-wider text-slate-gray cursor-pointer hover:text-soft-white">
                  Show diagnostics
                </summary>
                <div className="mt-2 space-y-1.5 text-[10px] text-soft-white/85">
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono">
                    <div>20-SMA: <span className="text-soft-white">${result.diagnostics.sma20.toFixed(2)}</span></div>
                    <div>Distance: <span className={Math.abs(result.diagnostics.distance_from_sma20_pct) > 3.5 ? "text-signal-red" : Math.abs(result.diagnostics.distance_from_sma20_pct) > 1 ? "text-signal-amber" : "text-signal-green"}>{result.diagnostics.distance_from_sma20_pct.toFixed(2)}%</span></div>
                    <div>Current px: <span className="text-soft-white">${result.diagnostics.current_price.toFixed(2)}</span></div>
                    <div>Structure: <span className="text-soft-white">{result.diagnostics.structure}</span></div>
                    {result.diagnostics.nearest_resistance != null && (
                      <div className="col-span-2">Resistance: <span className={result.diagnostics.near_resistance ? "text-signal-red" : "text-soft-white"}>${result.diagnostics.nearest_resistance.toFixed(2)}</span>{result.diagnostics.near_resistance && " — entry too close (<1.5% away)"}</div>
                    )}
                  </div>
                  {result.diagnostics.standard_failures.length > 0 && (
                    <div>
                      <div className="text-[9px] uppercase tracking-wider text-signal-amber">Standard test failed because:</div>
                      <ul className="list-disc list-inside text-[10px] text-soft-white/80">
                        {result.diagnostics.standard_failures.map((f, i) => <li key={i}>{f}</li>)}
                      </ul>
                    </div>
                  )}
                  {result.diagnostics.flex_failures.length > 0 && (
                    <div>
                      <div className="text-[9px] uppercase tracking-wider text-signal-red">Flex test failed because:</div>
                      <ul className="list-disc list-inside text-[10px] text-soft-white/80">
                        {result.diagnostics.flex_failures.map((f, i) => <li key={i}>{f}</li>)}
                      </ul>
                    </div>
                  )}
                  <div className="pt-1 grid grid-cols-2 gap-x-3 font-mono">
                    <div>
                      <div className="text-[9px] uppercase tracking-wider text-slate-gray">Tech breakdown</div>
                      {Object.entries(result.diagnostics.technical_breakdown).map(([k, v]) => (
                        <div key={k} className="text-[10px]">{k}: <span className="text-soft-white">{v}/5</span></div>
                      ))}
                    </div>
                    <div>
                      <div className="text-[9px] uppercase tracking-wider text-slate-gray">Fund breakdown</div>
                      {Object.entries(result.diagnostics.fundamental_breakdown).map(([k, v]) => (
                        <div key={k} className="text-[10px]">{k}: <span className="text-soft-white">{v}/5</span></div>
                      ))}
                    </div>
                  </div>
                </div>
              </details>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
