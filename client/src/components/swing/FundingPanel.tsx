// Funding, whole-share position sizing and calculated R targets — inside the Trading Card.
// PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE. This panel never places, sends or arms an order, never moves the stop,
// and never changes setup status, Ready/live permission, the setup score, or a saved/armed plan.
// Account data: this app has NO broker/account connection, so every balance here is MANUAL and never "verified".
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, RefreshCw, RotateCcw, Save, Wallet } from "lucide-react";
import type { SwingDecision, SwingSettings } from "@shared/swingDecision";
import { effectivePlan, setupIdOf, type PlanVersion } from "@shared/practicePlan";
import { DEFAULT_FUNDING, fundingStatus, parseNum, r2, rTargets, sizePosition, type FundingProfile, type SizingResult } from "@shared/positionSizing";
import { queryClient } from "@/lib/queryClient";
import { fmtCT, swingGet } from "@/lib/swing";
import { openTradeFor, useSwingTrades } from "@/lib/swingTrades";
import { readPersisted, usePersistentState } from "@/hooks/use-persistent-state";
import { useRiskContext } from "./ArmTrade";
import { saveSwingSettings, invalidateSwing } from "./PlanRefresh";
import { Section } from "./TradingCard";
import { apiRequest } from "@/lib/queryClient";
import { debounce } from "@/lib/debounce";
import type { SwingSettings } from "@shared/swingDecision";

/**
 * Robust trade configuration save utility with a strict 5000ms timeout limit
 * Prevents hanging API calls from leaving UI in an infinite "Saving..." state.
 */
export async function saveTradeConfig(
  payload: Partial<SwingSettings>,
  timeoutMs = 5000
): Promise<void> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`Save request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  try {
    await apiRequest("PUT", "/api/swing/settings", payload, controller.signal, timeoutMs);
    await invalidateSwing();
  } catch (err: any) {
    if (controller.signal.aborted || err?.name === "AbortError") {
      throw new Error(`Save trade config timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

const $ = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const pct = (n: number | null | undefined, dp = 2) => (n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(dp)}%`);
const xs = { fontSize: "var(--ac-fs-xs)" } as const, sm = { fontSize: "var(--ac-fs-sm)" } as const;
export const STOP_LOSS_DISCLAIMER = "Planned stop-based loss is an estimate, not a guaranteed maximum. Gaps and execution differences can produce larger losses.";
const BINDING_LABEL: Record<string, string> = { RISK: "Risk limit", AVAILABLE_CASH: "Available cash", REQUESTED_ALLOCATION: "Requested allocation", CASH_AND_RISK: "Cash and risk (tie)" };

// ─── One account snapshot for every card ──────────────────────────────────
/** Equity, risk limit and funding every card and panel uses — so the % of account always shares one denominator. */
export function useAccountSnapshot() {
  const risk = useRiskContext();
  const sw = useQuery<SwingSettings>({ queryKey: ["/api/swing/settings"], queryFn: () => swingGet("/api/swing/settings") });
  const hist = useQuery<{ date: string; equity: number }[]>({ queryKey: ["/api/equity-history"] });
  return useMemo(() => {
    const f: FundingProfile = { ...DEFAULT_FUNDING, ...(sw.data?.funding ?? {}) };
    const profileEquity = risk?.equity ?? null;
    const manual = f.equityMode === "MANUAL";
    const equity = manual ? f.manualEquity : profileEquity;
    const riskPctLimit = risk?.maxRiskPerTradePercent ?? null;
    const riskPct = f.riskPct ?? riskPctLimit;
    const h = (hist.data ?? []).filter((x) => Number(x.equity) > 0);
    const histLatest = h.length ? { equity: Number(h[h.length - 1].equity), date: h[h.length - 1].date } : null;
    return { funding: f, equity, profileEquity, manual, riskPct, riskPctLimit, histLatest, loading: !risk || sw.isLoading };
  }, [risk, sw.data, sw.isLoading, hist.data]);
}
export const refreshAccount = () => Promise.all(["/api/settings", "/api/regime", "/api/swing/settings", "/api/equity-history", "/api/swing/trades"]
  .map((k) => queryClient.invalidateQueries({ queryKey: [k] })));

// ─── Per-card sizing (persisted by setup instance; inline card + dialog stay in sync) ─
interface CardSizingState { allocation: string; entry: string | null; stop: string | null; how: "MANUAL" | "QUOTE" | null; quoteAt: string | null }
const BLANK: CardSizingState = { allocation: "", entry: null, stop: null, how: null, quoteAt: null };
export function useCardSizing(d: SwingDecision, ver: PlanVersion | null) {
  const acct = useAccountSnapshot();
  const symKey = `ac-sizing:${d.symbol}`;
  const legacy = readPersisted<CardSizingState>(`ac-sizing:${setupIdOf(d)}`, BLANK);
  const initial = legacy && (legacy.entry != null || legacy.stop != null || legacy.allocation) ? legacy : BLANK;
  const [st, setSt] = usePersistentState<CardSizingState>(symKey, initial);
  const p = effectivePlan(d, ver);
  const hasEntry = st.entry != null && String(st.entry).trim() !== "";
  const hasStop = st.stop != null && String(st.stop).trim() !== "";
  const override = hasEntry || hasStop;
  const parsedE = hasEntry ? parseNum(st.entry) : null;
  const parsedS = hasStop ? parseNum(st.stop) : null;
  const E = parsedE != null && Number.isFinite(parsedE) ? parsedE : p.entry;
  const S = parsedS != null && Number.isFinite(parsedS) ? parsedS : p.stop;
  const riskPerShare = E != null && S != null ? r2(Math.abs(E - S)) : null;
  const activeT1 = E != null && riskPerShare != null ? r2(E + 2 * riskPerShare) : p.t1;
  const activeT2 = E != null && riskPerShare != null ? r2(E + 3 * riskPerShare) : p.t2;
  const f = acct.funding;
  const sizing = sizePosition({ equity: acct.equity, riskPct: acct.riskPct, riskPctLimit: acct.riskPctLimit, cash: f.cash,
    reservedOpen: f.reservedOpen, reservedPending: f.reservedPending, cashIncludesReservations: f.cashIncludesReservations,
    allocation: parseNum(st.allocation), entry: E, stop: S, feePerTrade: f.feePerTrade, bufferPct: f.bufferPct });
  const reset = () => setSt({ allocation: st.allocation, entry: null, stop: null, how: null, quoteAt: null });
  return { acct, st, setSt, plan: p, override, E, S, riskPerShare, activeT1, activeT2, sizing, reset };
}

// ─── Small inputs ─────────────────────────────────────────────────────────
function Field({ label, value, onChange, testId, hint, err, prefix = "$", width = "9.5rem", placeholder }: { label: string; value: string; onChange: (v: string) => void; testId: string; hint?: React.ReactNode; err?: string | null; prefix?: string; width?: string; placeholder?: string }) {
  return (
    <label className="flex flex-col gap-1.5" style={sm}>
      <span className="text-base font-medium text-slate-200">{label}</span>
      <span className="inline-flex items-center gap-1.5">
        {prefix && <span className="text-slate-400 font-mono text-sm">{prefix}</span>}
        <input
          className="bg-[#0F172A] text-white border border-slate-700 rounded-md px-3 py-2 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 font-mono text-lg font-bold shadow-inner"
          style={{ width }}
          inputMode="decimal"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!err}
          data-testid={testId}
        />
      </span>
      {err ? <span className="text-red-400 font-medium text-xs" style={xs} role="alert">{err}</span> : hint ? <span className="text-slate-400 text-[11px]" style={xs}>{hint}</span> : null}
    </label>
  );
}
function Chip({ state }: { state: "MANUAL" | "STALE" | "UNAVAILABLE" | "LIVE" }) {
  const tone = state === "STALE" ? "var(--ac-warn, #f59e0b)" : state === "UNAVAILABLE" ? "var(--ac-bad)" : "var(--ac-muted)";
  return <span className="rounded-full px-2 py-0.5 font-bold ac-num whitespace-nowrap" style={{ ...xs, color: tone, border: `1.5px solid ${tone}` }} data-testid={`chip-funding-${state.toLowerCase()}`}>{state}</span>;
}
function Out({ k, v, sub, testId, strong }: { k: string; v: string; sub?: string; testId: string; strong?: boolean }) {
  return (
    <div className="ac-tile rounded-xl px-3 py-2" data-testid={testId}>
      <div className="ac-muted" style={xs}>{k}</div>
      <div className={`ac-num ${strong ? "font-extrabold" : "font-bold"}`} style={{ fontSize: strong ? "calc(var(--ac-fs) * 1.6)" : "calc(var(--ac-fs) * 1.1)" }}>{v}</div>
      {sub && <div className="ac-muted" style={xs}>{sub}</div>}
    </div>
  );
}
const grid = (min: number) => ({ display: "grid", gap: "0.6rem", gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))` });
const box = { border: "1px solid var(--ac-border)" } as const;

// ─── Account & funding (shared by every card) ─────────────────────────────
type Draft = Record<"manualEquity" | "cash" | "riskPct" | "reservedOpen" | "reservedPending" | "feePerTrade" | "bufferPct", string> & { equityMode: FundingProfile["equityMode"]; cashIncludesReservations: boolean };
const s2 = (n: number | null | undefined) => (n == null ? "" : String(n));
const draftOf = (f: FundingProfile): Draft => ({ equityMode: f.equityMode, manualEquity: s2(f.manualEquity), cash: s2(f.cash), riskPct: s2(f.riskPct),
  reservedOpen: s2(f.reservedOpen || null), reservedPending: s2(f.reservedPending || null), feePerTrade: s2(f.feePerTrade || null), bufferPct: s2(f.bufferPct || null), cashIncludesReservations: f.cashIncludesReservations });

function FundingInputs({
  acct,
  symbol,
  tradeId,
  ticker,
}: {
  acct: ReturnType<typeof useAccountSnapshot>;
  symbol: string;
  tradeId?: string;
  ticker?: string;
}) {
  const activeTicker = ticker ?? symbol;
  const f = acct.funding;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [cashAmount, setCashAmount] = useState<string>(s2(f.cash));
  const [isSaving, setIsSaving] = useState(false);
  const busy = isSaving;
  const [savedFlash, setSavedFlash] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const trades = useSwingTrades();

  // Reset stale local state whenever the active tradeId or ticker/symbol changes
  useEffect(() => {
    setDraft(null);
    setCashAmount(s2(f.cash));
    setMsg(null);
  }, [activeTicker, tradeId, f.cash]);

  const v = draft ?? { ...draftOf(f), cash: cashAmount };
  const set = (k: keyof Draft) => (val: any) => {
    setMsg(null);
    if (k === "cash") {
      setCashAmount(val);
    }
    setDraft({ ...v, [k]: val });
  };
  const num = (k: keyof Draft, opt = true) => { const n = parseNum(v[k] as string); return n == null ? (opt ? 0 : null) : n; };
  const errOf = (k: keyof Draft, opt = true): string | null => { const n = parseNum(v[k] as string); if (n == null) return opt ? null : null; if (!Number.isFinite(n)) return "Enter a number."; if (n < 0) return "Can't be negative."; return null; };
  const riskErr = (() => { const n = parseNum(v.riskPct); if (n == null) return null; if (!Number.isFinite(n) || n <= 0) return "Enter a % above 0."; if (acct.riskPctLimit != null && n > acct.riskPctLimit) return `Above your Risk Profile limit (${acct.riskPctLimit}%).`; return null; })();
  const eqErr = v.equityMode === "MANUAL" ? (() => { const n = parseNum(v.manualEquity); return n == null ? "Enter equity." : !Number.isFinite(n) || n <= 0 ? "Enter an amount above 0." : null; })() : null;
  const bufErr = (() => { const n = parseNum(v.bufferPct); return n != null && (!Number.isFinite(n) || n < 0 || n > 25) ? "0–25%." : null; })();
  const anyErr = riskErr || eqErr || bufErr || (["cash", "reservedOpen", "reservedPending", "feePerTrade"] as const).some((k) => errOf(k));
  const dirty = draft != null && JSON.stringify(draft) !== JSON.stringify(draftOf(f));

  // Asynchronous Save with strict 5000ms timeout & mandatory finally cleanup
  const handleSave = async (customPayload?: FundingProfile) => {
    if (anyErr) return;
    const now = new Date().toISOString();
    const cash = parseNum(v.cash), me = v.equityMode === "MANUAL" ? parseNum(v.manualEquity) : f.manualEquity;
    const next: FundingProfile = customPayload ?? {
      equityMode: v.equityMode,
      manualEquity: me ?? null,
      equityUpdatedAt: me !== f.manualEquity ? now : f.equityUpdatedAt,
      cash: cash ?? null,
      cashUpdatedAt: cash !== f.cash ? (cash == null ? null : now) : f.cashUpdatedAt,
      riskPct: parseNum(v.riskPct),
      reservedOpen: num("reservedOpen")!,
      reservedPending: num("reservedPending")!,
      cashIncludesReservations: v.cashIncludesReservations,
      feePerTrade: num("feePerTrade")!,
      bufferPct: num("bufferPct")!,
    };

    setIsSaving(true);
    try {
      await saveTradeConfig({ funding: next }, 5000);
      setDraft(null);
      setSavedFlash(true);
      setMsg("Saved — every card now sizes with these values.");
      setTimeout(() => setSavedFlash(false), 3500);
    } catch (error: any) {
      console.error("Save failed:", error);
      setMsg(`Not saved: ${error?.message ?? "Save failed"}`);
    } finally {
      setIsSaving(false); // MUST execute regardless of success or failure
    }
  };

  const save = handleSave;

  // Debounce utility (500ms delay) to prevent flooding the database with dozens of requests per second
  const debouncedAutoSave = useMemo(
    () =>
      debounce((profile: FundingProfile) => {
        void handleSave(profile);
      }, 500),
    []
  );

  useEffect(() => {
    return () => {
      debouncedAutoSave.cancel();
    };
  }, [debouncedAutoSave]);
  // Practice records in My Trades (cost = shares × fill or entry). Offered, never applied automatically.
  const fromTrades = () => {
    const ts = trades.data?.trades ?? [];
    const open = ts.filter((t) => t.status === "ACTIVE").reduce((a, t) => a + t.shares * (t.fillPrice ?? t.entry), 0);
    const pend = ts.filter((t) => t.status === "ARMED").reduce((a, t) => a + t.shares * t.entry, 0);
    setDraft({ ...v, reservedOpen: String(r2(open)), reservedPending: String(r2(pend)) });
    setMsg(`Filled from My Trades: open ${$(open)}, armed ${$(pend)} (practice records). Review, then Save.`);
  };
  const eqStatus = v.equityMode === "MANUAL" ? fundingStatus(f.equityUpdatedAt) : null;
  const cashStatus = fundingStatus(f.cashUpdatedAt);
  const histGap = acct.histLatest && acct.profileEquity != null && Math.abs(acct.histLatest.equity - acct.profileEquity) >= 0.01 ? acct.histLatest : null;

  return (
    <div className="rounded-xl p-3 space-y-2.5" style={box} data-testid={`funding-inputs-${symbol}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-bold inline-flex items-center gap-1.5"><Wallet className="h-4 w-4" aria-hidden /> Account & funding</span>
        <span className="ac-muted" style={xs}>Applies to every card</span>
        <button className="ac-btn !py-0.5 ml-auto" style={xs} onClick={(e) => { e.stopPropagation(); setDraft(null); setMsg("Reloaded saved values."); void refreshAccount(); }} data-testid={`button-funding-refresh-${symbol}`}><RefreshCw className="h-3.5 w-3.5" aria-hidden /> Reload saved values</button>
      </div>
      <div className="rounded-lg px-2.5 py-1.5" style={{ ...xs, border: "1.5px dashed var(--ac-border)" }} data-testid={`text-account-connection-${symbol}`}>
        <b>Account connection: none.</b> This app has no broker or account link, so balances can't be retrieved or verified. Account ID: — (not connected) · Source: values you enter · Cash-only sizing; margin buying power is never used.
      </div>

      <div style={grid(220)}>
        <div className="space-y-1">
          <div className="flex items-center gap-2" style={sm}><span className="text-base font-medium text-slate-200">Account equity</span>{v.equityMode === "MANUAL" ? <Chip state={eqStatus!.state === "UNAVAILABLE" ? "MANUAL" : eqStatus!.state} /> : <Chip state="MANUAL" />}</div>
          <select
            className="bg-[#0F172A] text-white border border-slate-700 rounded-md px-3 py-2 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 font-mono text-base font-medium cursor-pointer !w-auto shadow-inner"
            style={sm}
            value={v.equityMode}
            onChange={(e) => set("equityMode")(e.target.value)}
            data-testid={`select-equity-mode-${symbol}`}
          >
            <option value="RISK_PROFILE">Risk Profile — {$(acct.profileEquity)}</option>
            <option value="MANUAL">Manual sizing equity</option>
          </select>
          {v.equityMode === "MANUAL"
            ? <Field label="Sizing equity" value={v.manualEquity} onChange={set("manualEquity")} testId={`input-equity-${symbol}`} err={eqErr} hint={f.equityUpdatedAt ? `Entered ${fmtCT(f.equityUpdatedAt)} (${eqStatus?.ageText})` : "Not saved yet"} />
            : <div className="ac-muted" style={xs}>Manually entered in Settings → Risk Profile (no timestamp is saved there). Used for % risk sizing.</div>}
          {histGap && <div style={xs} className="ac-muted" data-testid={`text-equity-history-gap-${symbol}`}><AlertTriangle className="inline h-3.5 w-3.5" aria-hidden /> Equity history's latest point is {$(histGap.equity)} ({histGap.date}); sizing uses the value selected above.</div>}
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-2" style={sm}><span className="text-base font-medium text-slate-200">Available trading cash</span><Chip state={cashStatus.state} /></div>
          <Field label="Cash for this trade" value={cashAmount} onChange={(val) => { setCashAmount(val); set("cash")(val); }} testId={`input-cash-${symbol}`} err={errOf("cash")}
            hint={f.cashUpdatedAt ? `Entered ${fmtCT(f.cashUpdatedAt)} (${cashStatus.ageText})${cashStatus.state === "STALE" ? " — older than 1 day, re-check your balance" : ""}` : "Enter the cash you could use (not margin)."} />
        </div>
        <div className="space-y-1">
          <Field label="Max risk per trade" prefix="" value={v.riskPct} onChange={set("riskPct")} testId={`input-riskpct-${symbol}`} err={riskErr} width="5rem" placeholder={acct.riskPctLimit != null ? String(acct.riskPctLimit) : ""}
            hint={<>% of equity · blank = Risk Profile {acct.riskPctLimit != null ? `${acct.riskPctLimit}%` : "—"} (current regime limit; can't be raised here)</>} />
          <div style={sm} data-testid={`text-risk-budget-${symbol}`}>Risk budget <b className="ac-num">{acct.equity != null && acct.riskPct != null ? $(r2(acct.equity * acct.riskPct / 100)) : "—"}</b> <span className="ac-muted" style={xs}>(saved values)</span></div>
        </div>
      </div>

      <details className="rounded-lg px-2.5 py-1.5" style={box} data-testid={`details-reservations-${symbol}`}>
        <summary className="cursor-pointer font-semibold" style={sm}>Reservations, fees & buffer (optional) · open {$(f.reservedOpen)} · pending {$(f.reservedPending)} · fee {$(f.feePerTrade)} · buffer {pct(f.bufferPct, 1)}</summary>
        <div className="pt-2 space-y-2">
          <div className="flex flex-wrap gap-4">
            <Field label="Existing positions (cash committed)" value={v.reservedOpen} onChange={set("reservedOpen")} testId={`input-res-open-${symbol}`} err={errOf("reservedOpen")} />
            <Field label="Pending orders (cash reserved)" value={v.reservedPending} onChange={set("reservedPending")} testId={`input-res-pending-${symbol}`} err={errOf("reservedPending")} />
            <Field label="Estimated fee per trade" value={v.feePerTrade} onChange={set("feePerTrade")} testId={`input-fee-${symbol}`} err={errOf("feePerTrade")} width="6rem" />
            <Field label="Execution buffer (estimate)" prefix="" value={v.bufferPct} onChange={set("bufferPct")} testId={`input-buffer-${symbol}`} err={bufErr} width="5rem" hint="% added to entry for the cash check" />
          </div>
          <label className="inline-flex items-center gap-2 cursor-pointer" style={sm}>
            <input type="checkbox" className="h-4 w-4 rounded bg-[#0F172A] border-slate-700 text-cyan-500 focus:ring-1 focus:ring-cyan-500 cursor-pointer" checked={v.cashIncludesReservations} onChange={(e) => set("cashIncludesReservations")(e.target.checked)} data-testid={`check-cash-includes-${symbol}`} />
            My cash figure already reflects these reservations (don't subtract them twice)
          </label>
          <button className="ac-btn !py-0.5" style={xs} onClick={(e) => { e.stopPropagation(); fromTrades(); }} data-testid={`button-res-from-trades-${symbol}`}>Fill from My Trades practice records</button>
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-2.5 pt-1">
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg bg-cyan-400 hover:bg-cyan-300 active:bg-cyan-500 text-slate-950 font-bold px-4 py-2 text-xs shadow-md hover:shadow-cyan-500/20 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-cyan-400"
          style={sm}
          disabled={!dirty || !!anyErr || isSaving}
          onClick={(e) => {
            e.stopPropagation();
            void handleSave();
          }}
          data-testid={`button-funding-save-${symbol}`}
        >
          <Save className="h-4 w-4 stroke-[2.5]" aria-hidden />
          {isSaving ? "Saving…" : "Save funding"}
        </button>
        {savedFlash && (
          <span
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-emerald-300 bg-emerald-950/80 border border-emerald-500/60 rounded-lg shadow-sm"
            role="status"
            data-testid={`badge-funding-saved-${symbol}`}
          >
            <Check className="h-3.5 w-3.5 stroke-[2.5]" aria-hidden /> Saved!
          </span>
        )}
        {dirty && (
          <button
            type="button"
            className="ac-btn !py-1 text-xs"
            onClick={(e) => { e.stopPropagation(); setDraft(null); setMsg(null); }}
            data-testid={`button-funding-discard-${symbol}`}
          >
            Discard changes
          </button>
        )}
        {dirty && <span className="ac-muted" style={xs}>Unsaved — sizing below uses the saved values until you save.</span>}
        {msg && !savedFlash && <span style={xs} data-testid={`text-funding-msg-${symbol}`}>{msg}</span>}
      </div>
    </div>
  );
}

// ─── The panel ────────────────────────────────────────────────────────────
export function FundingPanel({ d, ver, scope, sz }: { d: SwingDecision; ver: PlanVersion | null; scope: string; sz: ReturnType<typeof useCardSizing> }) {
  const { acct, st, setSt, plan: p, override, E, S, sizing, reset } = sz;
  const [extended, setExtended] = usePersistentState<boolean>("ac-sizing-extended", false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [appliedFlash, setAppliedFlash] = useState(false);
  const trades = useSwingTrades();
  const locked = openTradeFor(trades.data?.trades, d.symbol);
  const fill = locked?.fillPrice != null ? { px: locked.fillPrice, at: locked.filledAt } : null;
  const targets = sizing.ok ? rTargets(E!, S!, sizing.shares, extended) : [];
  const sym = d.symbol;
  const allocErr = (() => { const n = parseNum(st.allocation); return n == null ? null : !Number.isFinite(n) ? "Enter a number." : n < 0 ? "Can't be negative." : null; })();
  const fc = acct.funding.cash;
  const overCash = (() => { const n = parseNum(st.allocation); return n != null && fc != null && Number.isFinite(n) && n > (sizing.cashAfterReservations ?? fc) ? `More than available cash${sizing.cashAfterReservations != null && sizing.cashAfterReservations !== fc ? " after reservations" : ""} — sizing uses ${$(sizing.cashAfterReservations ?? fc)}.` : null; })();
  const quote = d.currentPrice;
  const useQuote = () => { if (quote == null) return; setSt({ ...st, entry: quote.toFixed(2), stop: st.stop, how: "QUOTE", quoteAt: d.quoteTimestamp }); };

  useEffect(() => {
    const handleExpand = () => setDetailsOpen(true);
    window.addEventListener(`chizzle:expand-override-${sym}`, handleExpand);
    return () => window.removeEventListener(`chizzle:expand-override-${sym}`, handleExpand);
  }, [sym]);

  const handleApplyCustom = () => {
    const en = parseNum(st.entry), sn = parseNum(st.stop);
    setSt({
      ...st,
      entry: en != null && Number.isFinite(en) ? en.toFixed(2) : st.entry,
      stop: sn != null && Number.isFinite(sn) ? sn.toFixed(2) : st.stop,
      how: "MANUAL",
    });
    setAppliedFlash(true);
    setTimeout(() => setAppliedFlash(false), 3000);
  };

  const stopMethod = p.source === "USER" ? `From My Adjusted Plan v${p.version}.` : `Engine stop — structure low${d.stopBuffer != null ? ` − ${$(d.stopBuffer)} ATR buffer` : ""} (chart/setup-derived).`;
  const savedShares = ver ? ver.result.shares : null;
  const summary = sizing.ok ? `${sizing.shares} sh · cost ${$(sizing.positionCost)} · loss at stop ${$(sizing.plannedLoss)} (${pct(sizing.riskPctOfEquity)}) · ${BINDING_LABEL[sizing.binding!]}` : `Needs input — ${sizing.issues[0]?.text ?? ""}`;

  return (
    <Section id={`${scope}:funding`} title="Funding, Position Size & R Targets" testId={`sec-funding-${sym}`} summary={summary}>
      <div className="space-y-3" style={sm}>
        <div className="font-bold" style={{ ...xs, color: "var(--ac-warn, #f59e0b)" }}>PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE · This panel does not place, send or arm an order and does not change Ready or live permission.</div>
        {locked && <div className="rounded-lg px-2.5 py-1.5" style={{ ...xs, border: "1.5px solid var(--ac-accent)" }} data-testid={`notice-funding-locked-${sym}`}>
          {locked.status} practice trade #{locked.id} records {locked.shares} shares @ {$(locked.entry)}, stop {$(locked.stop)}. Sizing here is analysis only — changing inputs does not change the armed/active record.</div>}
        {savedShares != null && sizing.ok && savedShares !== sizing.shares && <div className="ac-muted" style={xs} data-testid={`notice-funding-saved-${sym}`}>
          Your saved plan v{ver!.version} lists {savedShares} shares (risk-only sizing). This panel's {sizing.shares} also applies the cash/allocation limit; the saved plan is unchanged unless you edit it.</div>}

        <FundingInputs acct={acct} symbol={sym} ticker={d.symbol} tradeId={locked?.id ? String(locked.id) : undefined} />

        <div className="rounded-xl p-3 space-y-2" style={box} data-testid={`funding-trade-${sym}`}>
          <div className="font-bold">This trade</div>
          <div style={grid(200)}>
            <Field label="Requested trade allocation" value={st.allocation} onChange={(v) => setSt({ ...st, allocation: v })} testId={`input-allocation-${sym}`} err={allocErr}
              hint={overCash ?? "Dollars you choose to allocate (saved for this setup on this device)."} />
            <div className="space-y-0.5">
              <div className="font-semibold">Planned entry</div>
              <div className="ac-num" data-testid={`text-planned-entry-${sym}`}><b>{$(p.entry)}</b> <span className="ac-muted" style={xs}>{p.source === "USER" ? `My Adjusted Plan v${p.version}` : "Engine Plan"}</span></div>
              <div className="ac-muted ac-num" style={xs} data-testid={`text-latest-quote-${sym}`}>Latest quote {$(quote)} · {d.quoteTimestamp ? fmtCT(d.quoteTimestamp) : "no timestamp"} · {d.dataStatus}</div>
              <div className="ac-muted ac-num" style={xs} data-testid={`text-fill-${sym}`}>Practice fill: {fill ? `${$(fill.px)} · ${fill.at ? fmtCT(fill.at) : ""}` : "none recorded"}</div>
            </div>
            <div className="space-y-0.5">
              <div className="font-semibold">Planned stop</div>
              <div className="ac-num" data-testid={`text-planned-stop-${sym}`}><b>{$(p.stop)}</b></div>
              <div className="ac-muted" style={xs}>{stopMethod} Never moved to fit an allocation or improve a ratio.</div>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <button className="ac-btn !py-1" style={sm} disabled={quote == null} onClick={useQuote} data-testid={`button-recalc-quote-${sym}`}><RefreshCw className="h-3.5 w-3.5" aria-hidden /> Recalculate using latest quote</button>
            <details
              open={override || detailsOpen}
              onToggle={(e) => setDetailsOpen(e.currentTarget.open)}
              className="rounded-lg px-2.5 py-1.5 transition-colors"
              style={box}
              data-testid={`details-override-${sym}`}
            >
              <summary className="cursor-pointer font-semibold" style={sm}>Manual entry/stop override (practice analysis)</summary>
              <div className="space-y-2.5 pt-2">
                <div className="flex flex-wrap gap-3">
                  <Field label="Entry override" value={st.entry ?? ""} onChange={(v) => setSt({ ...st, entry: v === "" ? null : v, how: "MANUAL" })} testId={`input-ov-entry-${sym}`} width="7rem" placeholder={p.entry != null ? String(p.entry) : ""} />
                  <Field label="Stop override" value={st.stop ?? ""} onChange={(v) => setSt({ ...st, stop: v === "" ? null : v, how: "MANUAL" })} testId={`input-ov-stop-${sym}`} width="7rem" placeholder={p.stop != null ? String(p.stop) : ""} />
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-400 hover:bg-cyan-300 active:bg-cyan-500 text-slate-950 font-bold px-3.5 py-1.5 text-xs shadow-md hover:shadow-cyan-500/20 transition-all cursor-pointer"
                    onClick={handleApplyCustom}
                    data-testid={`button-apply-custom-${sym}`}
                  >
                    <Check className="h-3.5 w-3.5 stroke-[2.5]" aria-hidden />
                    Apply Custom Plan
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 hover:bg-slate-700 hover:border-slate-500 active:bg-slate-900 text-slate-100 px-3.5 py-1.5 text-xs font-semibold shadow-sm transition-colors cursor-pointer"
                    onClick={reset}
                    data-testid={`button-reset-override-accordion-${sym}`}
                    title="Reset to Original Engine Plan"
                  >
                    <RotateCcw className="h-3.5 w-3.5 text-cyan-400" aria-hidden />
                    Use plan levels
                  </button>
                  {appliedFlash && (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-400 bg-emerald-950/70 border border-emerald-500/50 px-2.5 py-1 rounded-md">
                      <Check className="h-3.5 w-3.5" /> Custom plan levels active!
                    </span>
                  )}
                </div>
              </div>
            </details>
          </div>
          {override && (
            <div className="flex flex-wrap items-center gap-2.5 rounded-lg p-2.5 bg-cyan-950/40 border border-cyan-400/50 shadow-sm" data-testid={`badge-manual-override-${sym}`}>
              <span className="font-bold text-cyan-300 text-xs uppercase tracking-wider">Custom Practice Plan Active</span>
              <span className="ac-num text-soft-white text-xs">Sizing with entry <b>{$(E)}</b>{st.how === "QUOTE" ? ` (latest quote${st.quoteAt ? ` at ${fmtCT(st.quoteAt)}` : ""})` : ""} · stop <b>{$(S)}</b> · risk/sh <b>{$(sz.riskPerShare)}</b></span>
              <span className="ac-muted ac-num text-xs">Original plan: entry {$(p.entry)} · stop {$(p.stop)} — preserved</span>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 ml-auto rounded-lg border border-slate-600 bg-slate-800 hover:bg-slate-700 hover:border-slate-500 active:bg-slate-900 text-slate-100 px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors cursor-pointer"
                onClick={reset}
                data-testid={`button-reset-override-${sym}`}
                title="Reset overrides to engine plan levels"
              >
                <RotateCcw className="h-3.5 w-3.5 text-cyan-400" aria-hidden />
                Use plan levels
              </button>
            </div>
          )}
        </div>

        <SizingOutput sizing={sizing} sym={sym} acct={acct} />

        <div className="rounded-xl p-3 space-y-2" style={box} data-testid={`funding-targets-${sym}`}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-bold">Calculated R targets</span>
            <span className="ac-muted" style={xs}>R = entry − stop{sizing.riskPerShare != null ? ` = ${$(sizing.riskPerShare)}` : ""}</span>
            <label className="inline-flex items-center gap-2 cursor-pointer ml-auto" style={sm}>
              <input type="checkbox" className="h-4 w-4 rounded bg-[#0F172A] border-slate-700 text-cyan-500 focus:ring-1 focus:ring-cyan-500 cursor-pointer" checked={extended} onChange={(e) => setExtended(e.target.checked)} data-testid={`check-extended-targets-${sym}`} />
              Show extended targets: 4R / 5R / 6R
            </label>
          </div>
          {targets.length ? (
            <div className="overflow-x-auto">
              <table className="w-full ac-num font-mono tabular-nums" style={sm} data-testid={`table-r-targets-${sym}`}>
                <thead className="ac-muted text-left" style={xs}><tr><th className="py-1 pr-3">R multiple</th><th className="pr-3">Target price</th><th className="pr-3">Move from entry</th><th className="pr-3">Gross profit · {sizing.shares} sh</th></tr></thead>
                <tbody>{targets.map((t) => (
                  <tr key={t.r} className="border-t" style={{ borderColor: "var(--ac-border)" }} data-testid={`row-r-target-${sym}-${t.r}`}>
                    <td className="py-1 pr-3 font-bold font-mono tabular-nums">{t.r}R</td><td className="pr-3 font-mono tabular-nums">{$(t.price)}</td><td className="pr-3 font-mono tabular-nums">+{t.pctMove.toFixed(2)}%</td><td className="pr-3 font-mono tabular-nums">{$(t.grossProfit)}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          ) : <div className="ac-muted">Shown once entry and stop are valid.</div>}
          <div className="ac-muted" style={xs}>
            Calculated from entry and stop — not predictions, expected returns, or confirmed chart resistance. Gross, before fees. Each row assumes the whole position exits at that price; rows are separate scenarios, not cumulative. Partial exits aren't tracked by this app.
            {" "}Card plan targets (Trade Levels): T1 {$(p.t1)} · T2 {$(p.t2)}. Showing extended targets changes nothing else — not sizing, stop, score, or entry eligibility.
          </div>
        </div>
      </div>
    </Section>
  );
}

function SizingOutput({ sizing: s, sym, acct }: { sizing: SizingResult; sym: string; acct: ReturnType<typeof useAccountSnapshot> }) {
  if (!s.ok) return (
    <div className="rounded-xl p-3 space-y-1" style={{ border: "1.5px solid var(--ac-bad)" }} role="alert" data-testid={`funding-blocked-${sym}`}>
      <div className="font-bold ac-bad">Sizing blocked — fix these first</div>
      <ul className="list-disc pl-5">{s.issues.map((i) => <li key={i.text}>{i.text}</li>)}</ul>
      <div className="ac-muted" style={{ fontSize: "var(--ac-fs-xs)" }}>No shares, cost or targets are calculated until every input is valid.</div>
    </div>
  );
  return (
    <div className="space-y-2" data-testid={`funding-result-${sym}`}>
      <div style={grid(195)}>
        <Out strong k="Final whole shares" v={String(s.shares)} sub={`Binding: ${BINDING_LABEL[s.binding!]}`} testId={`out-shares-${sym}`} />
        <Out k="Position cost" v={$(s.positionCost)} sub={s.estFees ? `+ est. fees ${$(s.estFees)}` : "shares × entry"} testId={`out-cost-${sym}`} />
        <Out k="Unused requested allocation" v={$(s.unusedAllocation)} testId={`out-unused-${sym}`} />
        <Out k="Est. cash remaining" v={$(s.cashRemaining)} sub={`of ${$(s.cashAfterReservations)} available`} testId={`out-cash-left-${sym}`} />
        <Out k="Planned loss at stop" v={$(s.plannedLoss)} sub={`${s.shares} × ${$(s.riskPerShare)} risk/share`} testId={`out-loss-${sym}`} />
        <Out k="Planned risk · % of equity" v={pct(s.riskPctOfEquity)} sub={`of ${$(acct.equity)} · budget ${$(s.riskBudget)}`} testId={`out-risk-pct-${sym}`} />
        <Out k="Position value · % of equity" v={pct(s.positionPctOfEquity)} sub="allocation size, not risk" testId={`out-pos-pct-${sym}`} />
      </div>
      <div className="ac-num" style={{ fontSize: "var(--ac-fs-xs)" }} data-testid={`text-binding-${sym}`}>
        Cash-limited {s.cashShares} · Risk-limited {s.riskShares} → <b>{s.shares}</b>. {s.bindingText}
      </div>
      {s.zeroReason && <div className="ac-bad font-semibold" role="alert" data-testid={`text-zero-reason-${sym}`}>{s.zeroReason}</div>}
      <div className="font-semibold" style={{ fontSize: "var(--ac-fs-xs)", color: "var(--ac-warn, #f59e0b)" }} data-testid={`text-stop-disclaimer-${sym}`}>
        {STOP_LOSS_DISCLAIMER} OVERNIGHT GAP RISK — STOP ORDERS CAN FILL BELOW STOP PRICE.
      </div>
    </div>
  );
}
