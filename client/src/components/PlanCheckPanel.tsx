// ─── Plan Check Panel ──────────────────────────────────────────────────
// POSTs to /api/plan-check with raw INPUT data → renders the validated plan
// side-by-side with schema errors + rule violations. Two modes:
//   1) Manual entry (default) — fill the INPUT block
//   2) Pull from Active Setup — one-click load of the current top setup
// This complements TradeCheckPanel: TradeCheckPanel validates the pipeline
// signals; PlanCheckPanel validates the entire executable plan against v2.

import { useState, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ShieldCheck, AlertTriangle, XCircle, CheckCircle2, Download, Zap, RefreshCw,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type {
  ChizzleWealthEnginePlanCheck,
  PlanCheckInput,
  PlanCheckResponse,
} from "@shared/planCheckTypes";

// ─── Local form state (mirrors PlanCheckInput but strings for form ux) ─
interface FormState {
  symbol: string;
  sector: "semi" | "growth" | "other";
  price: string;
  sma20: string;
  sma50: string;
  sma50_slope: "up" | "flat" | "down";
  support_price: string;
  support_source: string;
  resistance_1: string;
  resistance_2: string;
  volume_ratio: string;
  relative_strength_spy: string;
  relative_strength_qqq: string;
  relative_strength_smh: string;
  spy_state: "GREEN" | "YELLOW" | "RED";
  qqq_state: "GREEN" | "YELLOW" | "RED";
  smh_state: "GREEN" | "YELLOW" | "RED" | "N/A";
  earnings_date: string;
  earnings_none: boolean;
  account_size: string;
  open_risk_pct: string;
  fractional_shares: boolean;
}

const DEFAULT_FORM: FormState = {
  symbol: "",
  sector: "other",
  price: "",
  sma20: "",
  sma50: "",
  sma50_slope: "up",
  support_price: "",
  support_source: "swing low",
  resistance_1: "",
  resistance_2: "",
  volume_ratio: "1.0",
  relative_strength_spy: "0",
  relative_strength_qqq: "",
  relative_strength_smh: "",
  spy_state: "GREEN",
  qqq_state: "GREEN",
  smh_state: "N/A",
  earnings_date: "",
  earnings_none: true,
  account_size: "50000",
  open_risk_pct: "0",
  fractional_shares: false,
};

// Convert form → API contract
function toInput(f: FormState): PlanCheckInput {
  const num = (s: string): number => Number(s);
  const numOpt = (s: string): number | undefined => (s === "" ? undefined : Number(s));
  return {
    symbol: f.symbol.toUpperCase(),
    sector: f.sector,
    price: num(f.price),
    sma20: num(f.sma20),
    sma50: num(f.sma50),
    sma50_slope: f.sma50_slope,
    support: { price: num(f.support_price), source: f.support_source },
    resistance_1: num(f.resistance_1),
    resistance_2: numOpt(f.resistance_2),
    volume_ratio: num(f.volume_ratio),
    relative_strength_spy: num(f.relative_strength_spy),
    relative_strength_qqq: numOpt(f.relative_strength_qqq),
    relative_strength_smh: numOpt(f.relative_strength_smh),
    spy_state: f.spy_state,
    qqq_state: f.qqq_state,
    smh_state: f.smh_state,
    earnings_date: f.earnings_none ? "none within 10 sessions" : f.earnings_date,
    account_size: num(f.account_size),
    open_risk_pct: num(f.open_risk_pct),
    fractional_shares: f.fractional_shares,
  };
}

function fmt$(n: number | null | undefined): string {
  return n == null ? "—" : `$${n.toFixed(2)}`;
}
function fmtInt(n: number | null | undefined): string {
  return n == null ? "—" : n.toLocaleString();
}

export default function PlanCheckPanel() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [showJson, setShowJson] = useState(false);

  // Pull top active setup (if any) for one-click prefill
  const activeQ = useQuery<any[]>({
    queryKey: ["/api/active-setups"],
    refetchInterval: 30_000,
  });

  const checkMut = useMutation<PlanCheckResponse, Error, PlanCheckInput>({
    mutationFn: async (input) => {
      const r = await apiRequest("POST", "/api/plan-check", { input });
      // 200 (ok), 422 (rule violation), 400 (bad body) — all return the same shape
      const data = await r.json();
      return data;
    },
  });

  const setField = useCallback(<K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((p) => ({ ...p, [k]: v }));
  }, []);

  const submit = () => checkMut.mutate(toInput(form));

  const loadFromActive = () => {
    const top = activeQ.data?.[0];
    if (!top) return;
    setForm({
      ...DEFAULT_FORM,
      symbol: top.ticker ?? "",
      price: String(top.entry ?? ""),
      sma20: String(top.entry ?? ""),
      sma50: String(top.stop ?? top.entry ?? ""),
      support_price: String(top.stop ?? ""),
      support_source: "active setup stop",
      resistance_1: String(top.t1 ?? ""),
      resistance_2: String(top.t2 ?? ""),
      account_size: "50000",
    });
  };

  const result = checkMut.data;
  const plan = result?.plan;
  const decisionMeta = plan ? decisionStyle(plan.decision) : null;

  return (
    <div className="bg-ink-black rounded-lg border border-ink-line p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-neon-blue" />
          <div className="text-xs font-bold text-soft-white tracking-wider">PLAN CHECK · v2</div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={loadFromActive}
            disabled={!activeQ.data?.length}
            className="text-[10px] px-2 py-1 rounded border border-ink-line text-slate-gray hover:text-neon-blue hover:border-neon-blue disabled:opacity-40 flex items-center gap-1"
            data-testid="button-load-active"
          >
            <Download className="h-3 w-3" />
            Load from Active
          </button>
          <button
            onClick={() => setForm(DEFAULT_FORM)}
            className="text-[10px] px-2 py-1 rounded border border-ink-line text-slate-gray hover:text-signal-amber hover:border-signal-amber flex items-center gap-1"
            data-testid="button-reset-form"
          >
            <RefreshCw className="h-3 w-3" />
            Reset
          </button>
        </div>
      </div>

      {/* Two-column layout: form + result */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* ── LEFT: Input form ── */}
        <div className="space-y-2 text-[11px]">
          <SectionTitle>Symbol & Trend</SectionTitle>
          <div className="grid grid-cols-2 gap-2">
            <FormText   label="Symbol"       value={form.symbol}    onChange={(v) => setField("symbol", v.toUpperCase())} testId="input-symbol" placeholder="NVDA" />
            <FormSelect label="Sector"       value={form.sector}    onChange={(v) => setField("sector", v as any)} options={["semi", "growth", "other"]} testId="input-sector" />
            <FormNum    label="Price"        value={form.price}     onChange={(v) => setField("price", v)} testId="input-price" />
            <FormNum    label="20D SMA"      value={form.sma20}     onChange={(v) => setField("sma20", v)} testId="input-sma20" />
            <FormNum    label="50D SMA"      value={form.sma50}     onChange={(v) => setField("sma50", v)} testId="input-sma50" />
            <FormSelect label="50D slope"    value={form.sma50_slope} onChange={(v) => setField("sma50_slope", v as any)} options={["up", "flat", "down"]} testId="input-slope" />
          </div>

          <SectionTitle>Levels</SectionTitle>
          <div className="grid grid-cols-2 gap-2">
            <FormNum  label="Support $"     value={form.support_price}  onChange={(v) => setField("support_price", v)} testId="input-support" />
            <FormText label="Support source" value={form.support_source} onChange={(v) => setField("support_source", v)} testId="input-support-source" />
            <FormNum  label="Resistance 1"  value={form.resistance_1}   onChange={(v) => setField("resistance_1", v)} testId="input-r1" />
            <FormNum  label="Resistance 2"  value={form.resistance_2}   onChange={(v) => setField("resistance_2", v)} testId="input-r2" placeholder="optional" />
            <FormNum  label="Volume ratio"  value={form.volume_ratio}   onChange={(v) => setField("volume_ratio", v)} testId="input-vol" step="0.1" />
            <FormNum  label="RS vs SPY"     value={form.relative_strength_spy} onChange={(v) => setField("relative_strength_spy", v)} testId="input-rs-spy" step="0.1" />
          </div>

          <SectionTitle>Regime</SectionTitle>
          <div className="grid grid-cols-3 gap-2">
            <FormSelect label="SPY" value={form.spy_state} onChange={(v) => setField("spy_state", v as any)} options={["GREEN", "YELLOW", "RED"]} testId="input-spy" />
            <FormSelect label="QQQ" value={form.qqq_state} onChange={(v) => setField("qqq_state", v as any)} options={["GREEN", "YELLOW", "RED"]} testId="input-qqq" />
            <FormSelect label="SMH" value={form.smh_state} onChange={(v) => setField("smh_state", v as any)} options={["GREEN", "YELLOW", "RED", "N/A"]} testId="input-smh" />
          </div>

          <SectionTitle>Account & Earnings</SectionTitle>
          <div className="grid grid-cols-2 gap-2">
            <FormNum   label="Account $"     value={form.account_size}   onChange={(v) => setField("account_size", v)} testId="input-account" />
            <FormNum   label="Open risk %"   value={form.open_risk_pct}  onChange={(v) => setField("open_risk_pct", v)} testId="input-open-risk" step="0.1" />
            <label className="flex items-center gap-1 text-slate-gray cursor-pointer col-span-1">
              <input type="checkbox" checked={form.earnings_none} onChange={(e) => setField("earnings_none", e.target.checked)} className="accent-signal-green" data-testid="input-earnings-none" />
              No earnings ≤10 sessions
            </label>
            <label className="flex items-center gap-1 text-slate-gray cursor-pointer col-span-1">
              <input type="checkbox" checked={form.fractional_shares} onChange={(e) => setField("fractional_shares", e.target.checked)} className="accent-neon-blue" data-testid="input-fractional" />
              Fractional shares
            </label>
          </div>

          <button
            onClick={submit}
            disabled={checkMut.isPending || !form.symbol || !form.price}
            className="w-full mt-2 py-1.5 rounded bg-neon-blue text-ink-black font-bold text-xs hover:brightness-110 disabled:opacity-40 flex items-center justify-center gap-1"
            data-testid="button-run-check"
          >
            {checkMut.isPending ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            {checkMut.isPending ? "Checking…" : "Run Plan Check"}
          </button>
        </div>

        {/* ── RIGHT: Result ── */}
        <div className="space-y-2 text-[11px]" data-testid="plan-check-result">
          {!result && !checkMut.isPending && (
            <div className="h-full flex items-center justify-center border border-dashed border-ink-line rounded p-6 text-center text-slate-gray text-xs">
              Fill inputs and click <span className="text-neon-blue font-bold mx-1">Run Plan Check</span> to validate against Chizzle Wealth Engine v2 rules.
            </div>
          )}
          {checkMut.isError && (
            <ErrorBox title="Request failed" message={String(checkMut.error?.message ?? "network error")} />
          )}
          {result && plan && (
            <div className="space-y-2">
              {/* Decision banner */}
              <div className={`rounded border-2 ${decisionMeta!.border} ${decisionMeta!.bg} p-2 flex items-start gap-2`} data-testid="decision-banner">
                {decisionMeta!.icon}
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-bold ${decisionMeta!.text} font-mono`}>
                    {plan.decision}
                  </div>
                  <div className="text-[10px] text-slate-gray font-mono">
                    {plan.symbol} · {plan.type} · Score {plan.score} ({plan.grade}) · Regime {plan.regime}
                  </div>
                </div>
              </div>

              {/* Rule violations (server-side numeric check) */}
              {result.rule_violations.length > 0 && (
                <div className="rounded border border-signal-amber bg-signal-amber/5 p-2">
                  <div className="text-[10px] font-bold text-signal-amber flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> RULE VIOLATIONS
                  </div>
                  <ul className="list-disc list-inside text-[10px] text-signal-amber mt-1 space-y-0.5">
                    {result.rule_violations.map((v, i) => <li key={i}>{v}</li>)}
                  </ul>
                </div>
              )}

              {/* Schema errors (structural) */}
              {result.errors.length > 0 && (
                <div className="rounded border border-signal-red bg-signal-red/5 p-2">
                  <div className="text-[10px] font-bold text-signal-red flex items-center gap-1">
                    <XCircle className="h-3 w-3" /> SCHEMA ERRORS
                  </div>
                  <ul className="list-disc list-inside text-[10px] text-signal-red mt-1 space-y-0.5">
                    {result.errors.map((e, i) => <li key={i}><span className="font-mono">{e.path}</span> — {e.message}</li>)}
                  </ul>
                </div>
              )}

              {/* Plan detail */}
              {plan.decision !== "NO TRADE" && plan.decision !== "WATCHLIST" && (
                <div className="grid grid-cols-2 gap-2">
                  <PlanBox label="ENTRY" value={fmt$(plan.entry.price)} sub={plan.entry.trigger} />
                  <PlanBox label="STOP"  value={fmt$(plan.stop.price)}  sub={plan.stop.reason} tone="red" />
                  <PlanBox label={`T1 (${plan.t1.r_multiple?.toFixed(2) ?? "—"}R)`} value={fmt$(plan.t1.price)} sub={plan.t1.reason} tone="green" />
                  <PlanBox label={`T2 (${plan.t2.r_multiple?.toFixed(2) ?? "—"}R)`} value={fmt$(plan.t2.price)} sub={plan.t2.reason} tone="green" />
                </div>
              )}

              {/* Risk row */}
              {plan.risk.pct != null && (
                <div className="rounded border border-ink-line p-2 grid grid-cols-4 gap-1 text-center">
                  <RiskCell label="Risk %" value={`${plan.risk.pct.toFixed(2)}%`} />
                  <RiskCell label="$ Risk" value={fmt$(plan.risk.dollar_risk)} />
                  <RiskCell label="Shares" value={fmtInt(plan.risk.shares)} />
                  <RiskCell label="Position" value={fmt$(plan.risk.position_value)} />
                </div>
              )}

              {/* Why bullets */}
              {plan.why.length > 0 && (
                <div className="rounded border border-ink-line p-2">
                  <div className="text-[10px] font-bold text-neon-blue mb-1">WHY</div>
                  <ul className="list-disc list-inside text-[11px] text-soft-white space-y-0.5">
                    {plan.why.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              )}

              {/* Management + invalidate */}
              {plan.decision !== "NO TRADE" && (
                <div className="grid grid-cols-1 gap-2">
                  <div className="rounded border border-ink-line p-2">
                    <div className="text-[10px] font-bold text-neon-blue mb-1">MANAGEMENT</div>
                    <div className="text-[10px] text-slate-gray space-y-0.5">
                      <div><span className="text-signal-green">+1R</span>: {plan.management.plus_1r}</div>
                      <div><span className="text-signal-amber">T1</span>: {plan.management.at_t1}</div>
                      <div><span className="text-signal-red">Fail</span>: {plan.management.failure}</div>
                    </div>
                  </div>
                  {plan.invalidate_if.length > 0 && (
                    <div className="rounded border border-signal-red/50 p-2">
                      <div className="text-[10px] font-bold text-signal-red mb-1">INVALIDATE IF</div>
                      <ul className="list-disc list-inside text-[10px] text-signal-red space-y-0.5">
                        {plan.invalidate_if.map((c, i) => <li key={i}>{c}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Probability boilerplate */}
              <div className="text-[10px] italic text-slate-gray text-center pt-1 border-t border-ink-line">
                {plan.probability}
              </div>

              {/* JSON toggle */}
              <button
                onClick={() => setShowJson((v) => !v)}
                className="text-[10px] text-slate-gray hover:text-neon-blue"
                data-testid="button-toggle-json"
              >
                {showJson ? "Hide" : "Show"} raw JSON
              </button>
              {showJson && (
                <pre className="text-[9px] text-slate-gray bg-ink-panel rounded p-2 overflow-auto max-h-64">
                  {JSON.stringify(plan, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-[9px] font-bold text-slate-gray tracking-wider uppercase mt-1">{children}</div>;
}

function FormText({ label, value, onChange, testId, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; testId: string; placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[9px] text-slate-gray">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="bg-ink-black border border-ink-line rounded px-1.5 py-1 font-mono text-[11px] text-soft-white"
        data-testid={testId}
      />
    </label>
  );
}

function FormNum({ label, value, onChange, testId, placeholder, step }: {
  label: string; value: string; onChange: (v: string) => void; testId: string; placeholder?: string; step?: string;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[9px] text-slate-gray">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        step={step ?? "0.01"}
        placeholder={placeholder}
        className="bg-ink-black border border-ink-line rounded px-1.5 py-1 font-mono text-[11px] text-soft-white"
        data-testid={testId}
      />
    </label>
  );
}

function FormSelect({ label, value, onChange, options, testId }: {
  label: string; value: string; onChange: (v: string) => void; options: string[]; testId: string;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[9px] text-slate-gray">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-ink-black border border-ink-line rounded px-1.5 py-1 font-mono text-[11px] text-soft-white"
        data-testid={testId}
      >
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function ErrorBox({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded border border-signal-red bg-signal-red/5 p-2">
      <div className="text-[10px] font-bold text-signal-red">{title}</div>
      <div className="text-[10px] text-signal-red mt-0.5 font-mono">{message}</div>
    </div>
  );
}

function PlanBox({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "green" | "red" | "amber" }) {
  const toneClass = tone === "green" ? "text-signal-green" : tone === "red" ? "text-signal-red" : tone === "amber" ? "text-signal-amber" : "text-soft-white";
  return (
    <div className="rounded border border-ink-line p-2">
      <div className="text-[9px] text-slate-gray font-bold">{label}</div>
      <div className={`font-mono text-sm ${toneClass}`}>{value}</div>
      <div className="text-[9px] text-slate-gray truncate" title={sub}>{sub}</div>
    </div>
  );
}

function RiskCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] text-slate-gray">{label}</div>
      <div className="font-mono text-[11px] text-soft-white font-bold">{value}</div>
    </div>
  );
}

function decisionStyle(d: ChizzleWealthEnginePlanCheck["decision"]) {
  if (d === "APPROVED TREND") return {
    border: "border-signal-green", bg: "bg-signal-green/10", text: "text-signal-green",
    icon: <CheckCircle2 className="h-5 w-5 text-signal-green flex-shrink-0" />,
  };
  if (d === "APPROVED COUNTERTREND - REDUCED SIZE") return {
    border: "border-signal-amber", bg: "bg-signal-amber/10", text: "text-signal-amber",
    icon: <ShieldCheck className="h-5 w-5 text-signal-amber flex-shrink-0" />,
  };
  if (d === "WATCHLIST") return {
    border: "border-neon-blue", bg: "bg-neon-blue/10", text: "text-neon-blue",
    icon: <AlertTriangle className="h-5 w-5 text-neon-blue flex-shrink-0" />,
  };
  return {
    border: "border-signal-red", bg: "bg-signal-red/10", text: "text-signal-red",
    icon: <XCircle className="h-5 w-5 text-signal-red flex-shrink-0" />,
  };
}
