import { useState } from "react";
import { errMsg } from "@/lib/errors";
import { useQuery } from "@tanstack/react-query";
import { Panel, Chip } from "@/components/Panel";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Ticker, WatchlistItem, SetupCandidateRow } from "@shared/schema";
import { decideDiscipline, defaultQualityFallback, type RegimeCode, type Quality } from "@shared/discipline";
import { useLivePrices, useLiveQuotes } from "@/lib/useLivePrices";
import {
  fmtPct,
  formatSetupState,
  setupStateColor,
  formatSetupKind,
  rrRatio,
} from "@/lib/engine";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, RefreshCw, ChevronRight, ChevronDown, Check, X, Eye, EyeOff } from "lucide-react";

interface RegimeGates {
  effectiveRegime: "green" | "yellow" | "red";
  source: "AUTO" | "MANUAL";
  statusLine: string;
  allowedSetups: string[];
  blockedSetups: string[];
}

interface QualificationDetail {
  name: string;
  label?: string;
  passed: boolean;
  value: number | string | null;
  threshold: number | string | null;
  note?: string;
}

export default function Watchlist() {
  const { toast } = useToast();
  const { data: tickers } = useQuery<Ticker[]>({ queryKey: ["/api/tickers"] });
  const { data: watchlist } = useQuery<WatchlistItem[]>({ queryKey: ["/api/watchlist"] });
  const { data: setupsByTicker } = useQuery<Record<string, SetupCandidateRow[]>>({
    queryKey: ["/api/setups"],
  });
  const { data: regimeGates } = useQuery<RegimeGates>({
    queryKey: ["/api/regime/gates"],
  });
  const livePrices = useLivePrices(tickers);
  const liveQuotes = useLiveQuotes();

  const [newSymbol, setNewSymbol] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [showHidden, setShowHidden] = useState(false); // toggle to surface RED/YELLOW-suppressed setups
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [recomputing, setRecomputing] = useState(false);

  const recomputeAll = async () => {
    setRecomputing(true);
    try {
      const r = await apiRequest("POST", "/api/setups/recompute", {});
      await r.json();
      queryClient.invalidateQueries({ queryKey: ["/api/setups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/setups/transitions"] });
      toast({ title: "Setup scan complete", description: "All watchlist tickers rescanned." });
    } catch (e: unknown) {
      toast({ title: "Scan failed", description: errMsg(e) });
    } finally {
      setRecomputing(false);
    }
  };

  const addTicker = async () => {
    if (!newSymbol || !newPrice) {
      toast({ title: "Missing fields", description: "Symbol and price required." });
      return;
    }
    await apiRequest("POST", "/api/tickers", { symbol: newSymbol.toUpperCase(), price: Number(newPrice), tier: 2 });
    queryClient.invalidateQueries({ queryKey: ["/api/tickers"] });
    queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
    setNewSymbol(""); setNewPrice("");
  };

  const removeTicker = async (tickerId: number) => {
    await apiRequest("DELETE", `/api/tickers/${tickerId}`);
    queryClient.invalidateQueries({ queryKey: ["/api/tickers"] });
    queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
  };

  // Build rows: one row per ticker per setup (or single row if no candidate).
  // Apply discipline decision (hide / dim / visible) per regime_gate_spec.md.
  const regimeCode = (regimeGates?.effectiveRegime ?? "green") as RegimeCode;
  const rows: Array<{
    ticker: Ticker;
    wlItem?: WatchlistItem;
    candidate?: SetupCandidateRow;
    lp: number;
    livePx: number | null;
    discipline: ReturnType<typeof decideDiscipline>;
  }> = [];
  let hiddenCount = 0;
  for (const t of tickers || []) {
    const wlItem = watchlist?.find(w => w.tickerId === t.id);
    const lp = livePrices[t.symbol] ?? t.currentPrice;
    const livePx = liveQuotes[t.symbol]?.price ?? null;
    const cands = setupsByTicker?.[t.symbol] || [];
    if (cands.length === 0) {
      // No setup detected — always visible (the row is the ticker itself).
      rows.push({
        ticker: t, wlItem, lp, livePx,
        discipline: decideDiscipline(regimeCode, defaultQualityFallback()),
      });
    } else {
      for (const c of cands) {
        const quality = ((c as any).quality as Quality | null) || defaultQualityFallback();
        const d = decideDiscipline(regimeCode, quality);
        if (d.visibility === "hidden" && !showHidden) {
          hiddenCount++;
          continue;
        }
        rows.push({ ticker: t, wlItem, candidate: c, lp, livePx, discipline: d });
      }
    }
  }

  return (
    <div className="p-3 md:p-4 space-y-4">
      <div className="flex items-baseline gap-3 pb-1 border-b border-ink-line/60">
        <h1 className="font-display text-[15px] tracking-[0.2em] uppercase text-soft-white">Watchlist</h1>
        <span className="text-[10px] uppercase tracking-wider text-slate-gray">{tickers?.length ?? 0} tickers · {regimeCode.toUpperCase()} regime</span>
      </div>
      <Panel
        title="Watchlist · Auto Setup Detection"
        hint={`${tickers?.length ?? 0} tickers · ${rows.filter(r => r.candidate).length} setups visible${hiddenCount > 0 ? ` · ${hiddenCount} hidden by regime gate` : ""} · ${regimeCode.toUpperCase()} regime`}
        action={
          <div className="flex items-center gap-2">
            {hiddenCount > 0 && (
              <button
                onClick={() => setShowHidden(s => !s)}
                className="flex items-center gap-1.5 px-2.5 py-1 border border-amber-signal/40 text-amber-signal bg-amber-signal/10 text-[11px] uppercase tracking-wider rounded-sm hover:bg-amber-signal/20"
                title={showHidden ? "Hide regime-blocked setups" : "Show regime-blocked setups"}
              >
                {showHidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                {showHidden ? `Hide ${hiddenCount}` : `Show ${hiddenCount} hidden`}
              </button>
            )}
            <button
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ["/api/tickers"] });
                queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
                queryClient.invalidateQueries({ queryKey: ["/api/setups"] });
                queryClient.invalidateQueries({ queryKey: ["/api/regime"] });
                queryClient.invalidateQueries({ queryKey: ["/api/regime/gates"] });
                toast({ title: "Refreshed", description: "Watchlist data re-fetched." });
              }}
              data-testid="button-refresh"
              title="Re-fetch watchlist data (no backend recompute)"
              className="flex items-center gap-1.5 px-2.5 py-1 border border-soft-white/30 text-soft-white bg-transparent text-[11px] uppercase tracking-wider rounded-sm hover:bg-soft-white/10"
            >
              <RefreshCw className="w-3 h-3" />
              Refresh
            </button>
            <button
              onClick={recomputeAll}
              disabled={recomputing}
              data-testid="button-recompute"
              className="flex items-center gap-1.5 px-2.5 py-1 border border-neon-blue/40 text-neon-blue bg-neon-blue/10 text-[11px] uppercase tracking-wider rounded-sm hover:bg-neon-blue/20 disabled:opacity-40"
            >
              <RefreshCw className={`w-3 h-3 ${recomputing ? "animate-spin" : ""}`} />
              {recomputing ? "Scanning…" : "Recompute Setups"}
            </button>
          </div>
        }
      >
        <div className="overflow-x-auto -mx-3.5">
          <table className="w-full text-[12px] min-w-[1100px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-slate-gray">
                <th className="w-6 px-2"></th>
                <th className="text-left px-3 py-2">Ticker</th>
                <th className="text-left px-2">Setup</th>
                <th className="text-left px-2">State</th>
                <th className="text-right px-2">Quals</th>
                <th className="text-right px-2">LP</th>
                <th className="text-right px-2">Override</th>
                <th className="text-right px-2">Zone</th>
                <th className="text-right px-2">Stop</th>
                <th className="text-right px-2">T1</th>
                <th className="text-right px-2">T2</th>
                <th className="text-right px-2">RR→T1</th>
                <th className="text-right px-2">% Zone</th>
                <th className="text-left px-2">Disq</th>
                <th className="px-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ ticker, candidate, lp, livePx, discipline }) => {
                const key = `${ticker.symbol}:${candidate?.setup || "none"}`;
                const isExpanded = expanded[key];
                return (
                  <SetupRow
                    key={key}
                    rowKey={key}
                    t={ticker}
                    candidate={candidate}
                    lp={lp}
                    livePx={livePx}
                    regime={regimeGates?.effectiveRegime}
                    discipline={discipline}
                    expanded={!!isExpanded}
                    onToggle={() => setExpanded(prev => ({ ...prev, [key]: !prev[key] }))}
                    onRemove={() => removeTicker(ticker.id)}
                  />
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={15} className="px-3 py-6 text-center text-slate-gray text-[12px]">No watchlist tickers yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Add Ticker" hint="Tier 2 unlock at $2,500 equity">
        <div className="flex flex-col md:flex-row gap-2 items-end">
          <div className="flex-1 min-w-0">
            <label className="text-[10px] uppercase tracking-wider text-slate-gray">Symbol</label>
            <input
              type="text"
              data-testid="input-add-symbol"
              value={newSymbol}
              onChange={e => setNewSymbol(e.target.value.toUpperCase())}
              className="w-full mt-1 px-3 py-1.5 bg-ink-black border border-ink-line rounded-sm font-mono-num text-[13px] focus:border-neon-blue/60 outline-none"
              placeholder="NVDA"
            />
          </div>
          <div className="flex-1 min-w-0">
            <label className="text-[10px] uppercase tracking-wider text-slate-gray">Anchor Price</label>
            <input
              type="number"
              step="0.01"
              data-testid="input-add-price"
              value={newPrice}
              onChange={e => setNewPrice(e.target.value)}
              className="w-full mt-1 px-3 py-1.5 bg-ink-black border border-ink-line rounded-sm font-mono-num text-[13px] focus:border-neon-blue/60 outline-none"
              placeholder="0.00"
            />
          </div>
          <button
            onClick={addTicker}
            data-testid="button-add-ticker"
            className="flex items-center gap-1.5 px-3 py-1.5 border border-neon-blue/40 text-neon-blue bg-neon-blue/10 text-[11px] uppercase tracking-wider rounded-sm hover:bg-neon-blue/20"
          >
            <Plus className="w-3 h-3" /> Add
          </button>
        </div>
      </Panel>
    </div>
  );
}

function SetupRow({
  rowKey, t, candidate, lp, livePx, regime, discipline, expanded, onToggle, onRemove,
}: {
  rowKey: string;
  t: Ticker;
  candidate?: SetupCandidateRow;
  lp: number;
  livePx: number | null;
  regime?: "green" | "yellow" | "red";
  discipline?: ReturnType<typeof decideDiscipline>;
  expanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const [override, setOverride] = useState(t.manualOverride ?? "");
  const { toast } = useToast();

  const saveOverride = async () => {
    const val = override === "" ? null : Number(override);
    await apiRequest("PATCH", `/api/tickers/${t.id}`, { manualOverride: val });
    queryClient.invalidateQueries({ queryKey: ["/api/tickers"] });
    toast({ title: "Override saved", description: val == null ? "Reverted to simulated feed." : `${t.symbol} pinned to ${val.toFixed(2)}` });
  };

  const state = candidate?.state || "dormant";
  const stateClass = setupStateColor(state);
  // Regime gate: prefer server-persisted flag, fall back to derivation if absent.
  const regimeEligible = candidate?.regimeEligible !== false; // defaults true if undefined
  const regimeBlockedReason = (candidate as any)?.regimeBlockedReason as string | null | undefined;
  // Discipline pill: hidden/dimmed reason from regime_gate_spec.md
  const isDimmed = discipline?.visibility === "dimmed";
  const isHiddenButShown = discipline?.visibility === "hidden";
  const blockedPillLabel = isHiddenButShown
    ? `BLOCKED \u2014 ${regime?.toUpperCase()} REGIME`
    : isDimmed
      ? `DIMMED \u2014 ${discipline?.dimReason || "half size"}`
      : regime && !regimeEligible
        ? `BLOCKED \u2014 ${regime.toUpperCase()} REGIME`
        : null;
  const rowOpacityStyle = isDimmed ? { opacity: 0.55 } : isHiddenButShown ? { opacity: 0.35 } : undefined;
  const setupLabel = candidate ? formatSetupKind(candidate.setup) : "—";
  const zoneLow = candidate?.entryZoneLow;
  const zoneHigh = candidate?.entryZoneHigh;
  const zoneText = zoneLow != null && zoneHigh != null ? `${zoneLow.toFixed(2)}–${zoneHigh.toFixed(2)}` : "—";
  const stopText = candidate?.stop != null ? candidate.stop.toFixed(2) : "—";
  const t1Text = candidate?.t1 != null ? candidate.t1.toFixed(2) : "—";
  const t2Text = candidate?.t2 != null ? candidate.t2.toFixed(2) : "—";
  const rrText = candidate?.rrToT1 != null ? candidate.rrToT1.toFixed(2) : "—";
  const pctToZone = zoneLow != null ? ((zoneLow - lp) / lp) * 100 : 0;
  const disqs: string[] = candidate?.disqualifiers ? safeJson(candidate.disqualifiers, []) : [];
  const quals: QualificationDetail[] = candidate?.qualificationDetails
    ? safeJson(candidate.qualificationDetails, [])
    : [];

  return (
    <>
      <tr className={`border-t border-ink-line/60 ${stateClass} hover:bg-ink-line/30`} style={rowOpacityStyle}>
        <td className="px-2 py-2 text-center">
          {candidate ? (
            <button
              onClick={onToggle}
              data-testid={`button-expand-${t.symbol}-${candidate.setup}`}
              className="text-slate-gray hover:text-soft-white"
              aria-label="Expand qualification checklist"
            >
              {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
          ) : null}
        </td>
        <td className="px-3 py-2 font-mono-num">{t.symbol}</td>
        <td className="px-2 py-2 text-[10px] uppercase tracking-wider text-slate-gray">{setupLabel}</td>
        <td className={`px-2 py-2 text-[10px] uppercase tracking-wider ${candidate && !regimeEligible ? "opacity-60" : ""}`} data-testid={`state-${t.symbol}-${candidate?.setup || "none"}`}>
          <div className="flex flex-col gap-1">
            <span>{candidate ? formatSetupState(state) : "\u2014"}</span>
            {blockedPillLabel && (
              <span
                data-testid={`pill-blocked-${t.symbol}-${candidate?.setup || "none"}`}
                title={regimeBlockedReason || "Regime gate blocks this setup"}
                className="inline-flex items-center px-1.5 py-0.5 rounded-sm border border-[#F59E0B]/50 bg-[#F59E0B]/10 text-[#F59E0B] font-mono-num tracking-tight text-[9px] uppercase whitespace-nowrap"
              >
                {blockedPillLabel}
              </span>
            )}
          </div>
        </td>
        <td className="px-2 py-2 text-right font-mono-num tabular-nums">
          {candidate ? `${candidate.qualificationsPassed}/${candidate.qualificationsTotal}` : "—"}
        </td>
        <td className="px-2 py-2 text-right font-mono-num tabular-nums text-soft-white" data-testid={`text-lp-${t.symbol}`}>
          <div className="leading-tight">
            <div>{lp.toFixed(2)}</div>
            {t.manualOverride != null && livePx != null && Math.abs(livePx - lp) > 0.005 && (
              <div className="text-[10px] text-slate-gray" data-testid={`text-drift-${t.symbol}`} title="Live Finnhub price vs override">
                live {livePx.toFixed(2)} ({livePx > lp ? "+" : ""}{(livePx - lp).toFixed(2)})
              </div>
            )}
          </div>
        </td>
        <td className="px-2 py-2 text-right">
          <input
            type="number" step="0.01" placeholder="—"
            data-testid={`input-override-${t.symbol}`}
            value={override}
            onChange={e => setOverride(e.target.value)}
            onBlur={saveOverride}
            className="w-20 px-1.5 py-1 bg-ink-black border border-ink-line rounded-sm text-[11px] font-mono-num tabular-nums text-right outline-none focus:border-gold-lux/60"
          />
        </td>
        <td className="px-2 py-2 text-right font-mono-num tabular-nums text-slate-gray">{zoneText}</td>
        <td className="px-2 py-2 text-right font-mono-num tabular-nums text-signal-red/80">{stopText}</td>
        <td className="px-2 py-2 text-right font-mono-num tabular-nums text-signal-green/80">{t1Text}</td>
        <td className="px-2 py-2 text-right font-mono-num tabular-nums text-signal-green/60">{t2Text}</td>
        <td className="px-2 py-2 text-right font-mono-num tabular-nums">{rrText}</td>
        <td className="px-2 py-2 text-right font-mono-num tabular-nums">{candidate ? fmtPct(pctToZone) : "—"}</td>
        <td className="px-2 py-2 text-[10px] text-signal-red/80 max-w-[140px] truncate" title={disqs.join(", ")}>
          {disqs.length ? disqs.join(", ") : ""}
        </td>
        <td className="px-3 py-2 text-right">
          <button onClick={onRemove} data-testid={`button-remove-${t.symbol}`} className="text-signal-red/70 hover:text-signal-red p-1" title="Remove">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </td>
      </tr>
      {expanded && candidate && (
        <tr className="border-t border-ink-line/30 bg-ink-black/40">
          <td></td>
          <td colSpan={14} className="px-3 py-3" data-testid={`checklist-${t.symbol}-${candidate.setup}`}>
            <div
              className="text-[10px] uppercase tracking-wider mb-2"
              data-testid={`regime-gate-line-${t.symbol}-${candidate.setup}`}
            >
              <span className="text-slate-gray">Regime gate:</span>{" "}
              {regimeEligible ? (
                <span className="text-signal-green">ELIGIBLE</span>
              ) : (
                <span className="text-[#F59E0B]">BLOCKED ({regimeBlockedReason || "regime gate"})</span>
              )}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-slate-gray mb-2">
              Qualification Checklist · {setupLabel}
              {candidate.lastComputedAt && (
                <span className="text-slate-gray/60 ml-2 normal-case tracking-normal">
                  last scan: {new Date(candidate.lastComputedAt).toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
            </div>
            <ul className="space-y-1.5">
              {quals.length === 0 && (
                <li className="text-[12px] text-slate-gray">No qualification data — try Recompute.</li>
              )}
              {quals.map((q, i) => (
                <li key={i} className="flex items-start gap-2 text-[12px]">
                  <span className={`mt-0.5 inline-flex w-4 h-4 items-center justify-center rounded-sm border ${q.passed ? "bg-signal-green/20 border-signal-green/60 text-signal-green" : "bg-signal-red/10 border-signal-red/40 text-signal-red"}`}>
                    {q.passed ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                  </span>
                  <span className="flex-1">
                    <span className="text-soft-white">{q.label || q.name}</span>
                    {(q.value != null || q.threshold != null) && (
                      <span className="text-slate-gray ml-2 font-mono-num tabular-nums">
                        {q.value != null && <>value: <span className="text-soft-white">{formatQualValue(q.value)}</span></>}
                        {q.threshold != null && <> · threshold: <span className="text-soft-white">{formatQualValue(q.threshold)}</span></>}
                      </span>
                    )}
                    {q.note && <span className="text-slate-gray ml-2 italic">— {q.note}</span>}
                  </span>
                </li>
              ))}
            </ul>
            {disqs.length > 0 && (
              <div className="mt-3 pt-2 border-t border-ink-line/40">
                <div className="text-[10px] uppercase tracking-wider text-signal-red/80 mb-1">Disqualifiers</div>
                <div className="flex flex-wrap gap-1.5">
                  {disqs.map((d, i) => (
                    <Chip key={i} tone="red">{d.replace(/_/g, " ")}</Chip>
                  ))}
                </div>
              </div>
            )}
            {candidate.triggerFired && candidate.triggerNote && (
              <div className="mt-3 pt-2 border-t border-ink-line/40 text-[11px] text-signal-green">
                <span className="uppercase tracking-wider text-[10px] mr-2">Trigger:</span>
                {candidate.triggerNote}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function safeJson<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

function formatQualValue(v: number | string): string {
  if (typeof v === "number") {
    if (Number.isInteger(v)) return v.toString();
    return v.toFixed(2);
  }
  return String(v);
}
