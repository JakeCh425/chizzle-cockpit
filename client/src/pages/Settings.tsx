import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Panel, Chip } from "@/components/Panel";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Settings as SettingsType, RegimeState, RegimeInputsRow, Trade } from "@shared/schema";
import { CHIZZLE_WEIGHTS, WATCHLIST_WEIGHTS } from "@/lib/engine";
import { useToast } from "@/hooks/use-toast";
import { useFeedStatus, useFeedConnection } from "@/lib/priceFeed";

interface RegimePayload {
  state: RegimeState;
  latestInputs: RegimeInputsRow | null;
  effective: { code: "green" | "yellow" | "red"; source: "AUTO" | "MANUAL" };
}

function RiskSlider({
  label,
  color,
  value,
  onChange,
  active,
}: {
  label: string;
  color: "green" | "amber" | "red";
  value: string;
  onChange: (v: string) => void;
  active: boolean;
}) {
  const hueVar =
    color === "green" ? "--signal-green" : color === "amber" ? "--signal-amber" : "--signal-red";
  const textColor =
    color === "green" ? "text-signal-green" : color === "amber" ? "text-signal-amber" : "text-signal-red";
  const v = Number(value) || 0;
  return (
    <div
      className="border rounded-sm p-3 transition-colors"
      style={{
        borderColor: active ? `hsl(var(${hueVar}) / 0.6)` : "hsl(var(--ink-line) / 0.6)",
        background: active ? `hsl(var(${hueVar}) / 0.06)` : "transparent",
      }}
    >
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider text-slate-gray">{label}</span>
        {active && <span className="text-[9px] uppercase tracking-wider text-neon-blue">• ACTIVE</span>}
      </div>
      <div className="flex items-baseline gap-2 mb-2">
        <span className={`font-mono-num tabular-nums text-2xl font-semibold ${textColor}`}>{v.toFixed(1)}</span>
        <span className="text-[12px] text-slate-gray">% per trade</span>
      </div>
      <input
        type="range"
        min={1}
        max={10}
        step={0.1}
        value={v}
        onChange={(e) => onChange(e.target.value)}
        className="w-full cursor-pointer"
        style={{ accentColor: `hsl(var(${hueVar}))` }}
        data-testid={`slider-risk-${color}`}
      />
      <div className="flex justify-between text-[9px] text-slate-gray mt-1">
        <span>1%</span>
        <span>5%</span>
        <span>10%</span>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { toast } = useToast();
  const { data: settings } = useQuery<SettingsType>({ queryKey: ["/api/settings"] });
  const { data: regimePayload } = useQuery<RegimePayload>({ queryKey: ["/api/regime"] });

  const activeRegime: "GREEN" | "YELLOW" | "RED" =
    (regimePayload?.effective?.code?.toUpperCase() as any) || "YELLOW";

  const [equity, setEquity] = useState("");
  const [riskG, setRiskG] = useState("5");
  const [riskY, setRiskY] = useState("3");
  const [riskR, setRiskR] = useState("1");
  const [maxRisk, setMaxRisk] = useState("6");
  const [minRR, setMinRR] = useState("2");
  const [maxPosG, setMaxPosG] = useState("4");
  const [maxPosY, setMaxPosY] = useState("3");
  const [maxPosR, setMaxPosR] = useState("2");

  const activeRiskPct =
    activeRegime === "GREEN" ? Number(riskG) : activeRegime === "RED" ? Number(riskR) : Number(riskY);

  useEffect(() => {
    if (settings) {
      setEquity(String(settings.equity));
      setRiskG(String(settings.riskPctGreen));
      setRiskY(String(settings.riskPctYellow));
      setRiskR(String(settings.riskPctRed));
      setMaxRisk(String(settings.maxOpenRiskPct));
      setMinRR(String(settings.minRR));
      setMaxPosG(String(settings.maxPositionsGreen));
      setMaxPosY(String(settings.maxPositionsYellow));
      setMaxPosR(String(settings.maxPositionsRed));
    }
  }, [settings]);

  const save = async () => {
    await apiRequest("PATCH", "/api/settings", {
      equity: Number(equity),
      riskPctGreen: Number(riskG),
      riskPctYellow: Number(riskY),
      riskPctRed: Number(riskR),
      maxOpenRiskPct: Number(maxRisk),
      minRR: Number(minRR),
      maxPositionsGreen: Number(maxPosG),
      maxPositionsYellow: Number(maxPosY),
      maxPositionsRed: Number(maxPosR),
      watchlistTier: Number(equity) >= 2500 ? 2 : 1,
    });
    queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    toast({ title: "Settings saved" });
  };

  const confirmReset = async () => {
    if (!window.confirm("Wipe all trades, journal, LEAP positions, equity history, and reseed the watchlist?")) return;
    await apiRequest("POST", "/api/reset", {});
    queryClient.invalidateQueries();
    toast({ title: "Cockpit reset", description: "Fresh seed state restored." });
  };

  return (
    <div className="p-3 md:p-4 space-y-4 max-w-5xl">
      <div className="flex items-baseline gap-3 pb-1 border-b border-ink-line/60">
        <h1 className="font-display text-[15px] tracking-[0.2em] uppercase text-soft-white">Settings</h1>
        <span className="text-[10px] uppercase tracking-wider text-slate-gray">Account · Regime · Tickers</span>
      </div>
      <Panel title="Account">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Account Equity ($)">
            <input type="number" step="0.01" data-testid="input-equity" value={equity} onChange={e => setEquity(e.target.value)} className="form-input num" />
          </Field>
          <Field label="Watchlist Tier">
            <div className="mt-1">
              <Chip tone={Number(equity) >= 2500 ? "blue" : "neutral"}>Tier {Number(equity) >= 2500 ? "2 unlocked" : "1"}</Chip>
            </div>
          </Field>
        </div>
      </Panel>

      <RegimeEnginePanel />

      <Panel
        title="Risk Profile"
        hint={`Active: ${activeRegime} · ${activeRiskPct.toFixed(1)}% per trade`}
      >
        <div className="text-[11px] text-slate-gray mb-3">
          Risk per trade adjusts to current regime. Drag the sliders (1–10%) or type a value.
          Higher % = larger position size on each setup.
        </div>
        <div className="grid grid-cols-3 gap-4">
          <RiskSlider label="Green Regime" color="green" value={riskG} onChange={setRiskG} active={activeRegime === "GREEN"} />
          <RiskSlider label="Yellow Regime" color="amber" value={riskY} onChange={setRiskY} active={activeRegime === "YELLOW"} />
          <RiskSlider label="Red Regime" color="red" value={riskR} onChange={setRiskR} active={activeRegime === "RED"} />
        </div>
        <div className="grid grid-cols-3 gap-3 mt-4 pt-3 border-t border-ink-line/60">
          <Field label="Max Positions Green"><input type="number" value={maxPosG} onChange={e => setMaxPosG(e.target.value)} className="form-input num" /></Field>
          <Field label="Max Positions Yellow"><input type="number" value={maxPosY} onChange={e => setMaxPosY(e.target.value)} className="form-input num" /></Field>
          <Field label="Max Positions Red"><input type="number" value={maxPosR} onChange={e => setMaxPosR(e.target.value)} className="form-input num" /></Field>
          <Field label="Max Open Risk %"><input type="number" step="0.5" value={maxRisk} onChange={e => setMaxRisk(e.target.value)} className="form-input num" /></Field>
          <Field label="Min RR"><input type="number" step="0.1" value={minRR} onChange={e => setMinRR(e.target.value)} className="form-input num" /></Field>
        </div>
      </Panel>

      <PriceFeedPanel />

      <Panel title="Chizzle Score Weights" hint="Read-only — locked to v1.0 blueprint">
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(CHIZZLE_WEIGHTS).map(([k, v]) => (
            <div key={k} className="flex justify-between items-center px-2 py-1.5 border border-ink-line/60 rounded-sm">
              <span className="text-[11px] text-slate-gray uppercase tracking-wider">{k}</span>
              <span className="font-mono-num tabular-nums">{v}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Watchlist Score Weights" hint="Read-only">
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(WATCHLIST_WEIGHTS).map(([k, v]) => (
            <div key={k} className="flex justify-between items-center px-2 py-1.5 border border-ink-line/60 rounded-sm">
              <span className="text-[11px] text-slate-gray uppercase tracking-wider">{k}</span>
              <span className="font-mono-num tabular-nums">{v}</span>
            </div>
          ))}
        </div>
      </Panel>

      <ArchivedTradesPanel />

      <div className="flex justify-between items-center gap-3">
        <button
          onClick={confirmReset}
          data-testid="button-reset"
          className="px-4 py-2 border border-signal-red/60 bg-signal-red/10 text-signal-red text-[11px] uppercase tracking-wider rounded-sm hover:bg-signal-red/20"
        >
          Reset All Data
        </button>
        <button
          onClick={save}
          data-testid="button-save-settings"
          className="px-5 py-2 border border-neon-blue/60 bg-neon-blue/20 text-neon-blue text-[12px] uppercase tracking-wider font-display rounded-sm"
        >
          Save Settings
        </button>
      </div>

      <style>{`
        .form-input { background: hsl(var(--ink-black)); border: 1px solid hsl(var(--ink-line)); border-radius: 2px; padding: 6px 10px; font-size: 13px; color: hsl(var(--soft-white)); width: 100%; outline: none; margin-top: 4px; }
        .form-input:focus { border-color: hsl(var(--neon-blue) / 0.6); }
        .form-input.num { font-family: "JetBrains Mono", monospace; font-variant-numeric: tabular-nums; }
      `}</style>
    </div>
  );
}

function ArchivedTradesPanel() {
  const { toast } = useToast();
  const { data: archived } = useQuery<Trade[]>({ queryKey: ["/api/trades/archived"] });
  const restore = async (t: Trade) => {
    try {
      await apiRequest("POST", `/api/trades/${t.id}/restore`, {});
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trades/archived"] });
      toast({ title: "Restored", description: `${t.ticker} returned to main view.` });
    } catch (e: any) {
      toast({ title: "Restore failed", description: e?.message || String(e) });
    }
  };
  const deleteForever = async (t: Trade) => {
    if (!confirm(
      `Permanently delete ${t.ticker} from system?\n\nThis CANNOT be undone. The trade will be removed from history and analytics forever.`
    )) return;
    try {
      await apiRequest("DELETE", `/api/trades/${t.id}/forever`, undefined);
      queryClient.invalidateQueries({ queryKey: ["/api/trades/archived"] });
      toast({ title: "Deleted", description: `${t.ticker} permanently removed.` });
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message || String(e) });
    }
  };
  const deleteAll = async () => {
    const n = list.length;
    if (!confirm(
      `Permanently delete ALL ${n} archived trade${n === 1 ? "" : "s"} from system?\n\nThis CANNOT be undone. Every archived trade will be wiped from history and analytics forever.\n\nType OK in the next prompt to confirm.`
    )) return;
    const confirm2 = prompt(`Type DELETE to confirm permanent deletion of ${n} archived trade${n === 1 ? "" : "s"}:`);
    if (confirm2 !== "DELETE") {
      toast({ title: "Cancelled", description: "Nothing was deleted." });
      return;
    }
    try {
      const res: any = await apiRequest("DELETE", "/api/trades/archived", undefined);
      queryClient.invalidateQueries({ queryKey: ["/api/trades/archived"] });
      toast({ title: "All cleared", description: `${res?.deleted ?? n} archived trade${(res?.deleted ?? n) === 1 ? "" : "s"} permanently removed.` });
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message || String(e) });
    }
  };
  const list = archived || [];
  return (
    <Panel
      title="Archived Trades"
      hint={`${list.length} soft-deleted · auto-cleanup after 45 days`}
      action={
        list.length > 0 ? (
          <button
            onClick={deleteAll}
            data-testid="button-delete-all-archived"
            className="text-[10px] uppercase tracking-wider text-signal-red hover:text-signal-red/80 transition-colors flex items-center gap-1 px-2 py-1 border border-signal-red/40 hover:bg-signal-red/10 rounded-sm"
            title="Permanently delete all archived trades"
          >
            × Delete All
          </button>
        ) : null
      }
    >
      <div className="text-[11px] text-slate-gray mb-2">
        Soft-deleted trades are kept here for 45 days, then auto-removed from the system.
        Restore brings a trade back into history. Delete permanently removes it from analytics.
      </div>
      {list.length === 0 ? (
        <div className="text-[12px] text-slate-gray py-2">No archived trades.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-slate-gray">
                <th className="text-left px-2 py-1.5">Ticker</th>
                <th className="text-left px-2 py-1.5">Regime</th>
                <th className="text-left px-2 py-1.5">Status</th>
                <th className="text-right px-2 py-1.5">Entry</th>
                <th className="text-right px-2 py-1.5">Exit</th>
                <th className="text-left px-2 py-1.5">Opened</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {list.map(t => (
                <tr key={t.id} className="border-t border-ink-line/60">
                  <td className="px-2 py-1.5 font-mono-num">{t.ticker}</td>
                  <td className="px-2 py-1.5">
                    <Chip tone={t.regimeAtEntry === "GREEN" ? "green" : t.regimeAtEntry === "YELLOW" ? "amber" : "red"}>{t.regimeAtEntry}</Chip>
                  </td>
                  <td className="px-2 py-1.5">
                    <Chip tone={t.status === "OPEN" ? "blue" : t.status === "DISCARDED" ? "red" : t.status === "PENDING" ? "amber" : "neutral"}>{t.status}</Chip>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono-num tabular-nums">{t.entry.toFixed(2)}</td>
                  <td className="px-2 py-1.5 text-right font-mono-num tabular-nums">{t.exit?.toFixed(2) ?? "—"}</td>
                  <td className="px-2 py-1.5 text-[10px] text-slate-gray">{new Date(t.openedAt).toLocaleDateString()}</td>
                  <td className="px-2 py-1.5 text-right">
                    <div className="inline-flex items-center gap-1 justify-end">
                      <button
                        onClick={() => restore(t)}
                        data-testid={`button-restore-trade-${t.id}`}
                        className="px-2 py-1 border border-neon-blue/40 bg-neon-blue/10 text-neon-blue text-[10px] uppercase tracking-wider rounded-sm hover:bg-neon-blue/20"
                      >
                        Restore
                      </button>
                      <button
                        onClick={() => deleteForever(t)}
                        data-testid={`button-delete-trade-${t.id}`}
                        className="px-2 py-1 border border-signal-red/40 bg-signal-red/10 text-signal-red text-[10px] uppercase tracking-wider rounded-sm hover:bg-signal-red/20"
                        title="Permanently delete this trade"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function PriceFeedPanel() {
  const { data: status } = useFeedStatus();
  const { state } = useFeedConnection();
  const stateColor =
    state === "LIVE" ? "text-neon-blue"
    : state === "STALE" ? "text-signal-amber"
    : state === "CONNECTING" ? "text-slate-gray"
    : "text-signal-red";
  return (
    <Panel title="Price Feed" hint="Read-only — server-driven live quotes">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[12px]">
        <Stat label="Provider" value={status?.provider ?? "—"} />
        <Stat label="Tier" value={status?.tier ?? "—"} />
        <Stat label="Cadence" value={status?.cadenceSec ? `${status.cadenceSec}s` : "—"} />
        <Stat label="Session" value={status?.session ?? "—"} />
        <Stat label="Source" value={status?.useSimulator ? "SIMULATOR" : "FINNHUB"} />
        <Stat label="Errors / 1h" value={String(status?.errorsLastHour ?? 0)} />
        <Stat label="Connection" value={<span className={stateColor}>{state}</span>} />
        <Stat
          label="Last tick"
          value={status?.ageSec != null ? `${status.ageSec}s ago` : "—"}
        />
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-slate-gray">
              <th className="text-left px-2 py-1">Symbol</th>
              <th className="text-right px-2">Price</th>
              <th className="text-right px-2">Last poll</th>
            </tr>
          </thead>
          <tbody>
            {(status?.symbols || []).map(s => (
              <tr key={s.symbol} className="border-t border-ink-line/40">
                <td className="px-2 py-1 font-display tracking-wide">{s.symbol}</td>
                <td className="px-2 py-1 text-right font-mono-num tabular-nums">{s.price != null ? s.price.toFixed(2) : "—"}</td>
                <td className="px-2 py-1 text-right text-slate-gray font-mono-num tabular-nums">{s.ageSec != null ? `${s.ageSec}s` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center px-2 py-1.5 border border-ink-line/60 rounded-sm">
      <span className="text-[10px] text-slate-gray uppercase tracking-wider">{label}</span>
      <span className="font-mono-num tabular-nums text-[12px]">{value}</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-slate-gray">{label}</label>
      {children}
    </div>
  );
}

// ─── Regime Engine ──────────────────────────────────────────────────────────
function RegimeEnginePanel() {
  const { toast } = useToast();
  const { data: payload, isLoading } = useQuery<RegimePayload>({
    queryKey: ["/api/regime"],
    // Low-Credit Mode: manual refresh only — no polling.
  });
  const [busy, setBusy] = useState(false);

  const state = payload?.state;
  const latest = payload?.latestInputs ?? null;
  const source = payload?.effective?.source ?? "AUTO";
  const effectiveCode = payload?.effective?.code ?? "yellow";

  const codeTone: Record<string, "green" | "amber" | "red"> = { green: "green", yellow: "amber", red: "red" };

  const recompute = async () => {
    setBusy(true);
    try {
      await apiRequest("POST", "/api/regime/recompute", {});
      queryClient.invalidateQueries({ queryKey: ["/api/regime"] });
      queryClient.invalidateQueries({ queryKey: ["/api/regime/history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Regime recomputed", description: "Pulled fresh Yahoo data and reclassified." });
    } catch (e: any) {
      toast({ title: "Recompute failed", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const setOverride = async (enabled: boolean, regime?: "green" | "yellow" | "red") => {
    const label = regime ? regime.toUpperCase() : "";
    if (enabled && regime && !window.confirm(`Override regime to ${label}? All new entries will use ${label} risk rules until you disable override.`)) return;
    if (!enabled && !window.confirm("Disable manual override and return control to the auto-engine?")) return;
    try {
      await apiRequest("POST", "/api/regime/override", { enabled, regime });
      queryClient.invalidateQueries({ queryKey: ["/api/regime"] });
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: enabled ? `Manual override → ${label}` : "Override disabled", description: enabled ? "Auto-engine continues classifying in the background." : "Effective regime now follows the auto-engine." });
    } catch (e: any) {
      toast({ title: "Override failed", description: e?.message || String(e), variant: "destructive" });
    }
  };

  const sinceLabel = state?.currentRegimeSince
    ? new Date(state.currentRegimeSince).toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "—";
  const lastClassifiedLabel = state?.lastClassifiedAt
    ? new Date(state.lastClassifiedAt).toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "—";

  // Inputs table rows (label, value, threshold, ok)
  type Row = { label: string; value: React.ReactNode; threshold: string; ok: boolean | null };
  const rows: Row[] = latest ? [
    { label: "SPY price", value: latest.spyPrice.toFixed(2), threshold: "—", ok: null },
    { label: "SPY 50-SMA", value: latest.spySma50.toFixed(2), threshold: "—", ok: null },
    { label: "SPY > 50-SMA", value: latest.spyAbove50 ? "yes" : "no", threshold: "yes → green", ok: latest.spyAbove50 },
    { label: "SPY > 200-SMA", value: latest.spyAbove200 ? "yes" : "no", threshold: "yes → green", ok: latest.spyAbove200 },
    { label: "SPY 50-SMA rising", value: latest.spySma50Rising ? "yes" : "no", threshold: "yes → green", ok: latest.spySma50Rising },
    { label: "QQQ price", value: latest.qqqPrice.toFixed(2), threshold: "—", ok: null },
    { label: "QQQ 50-SMA", value: latest.qqqSma50.toFixed(2), threshold: "—", ok: null },
    { label: "QQQ > 50-SMA", value: latest.qqqAbove50 ? "yes" : "no", threshold: "yes → green", ok: latest.qqqAbove50 },
    { label: "VIX (VIXY proxy)", value: latest.vixLevel.toFixed(2), threshold: "< 20 → green · > 25 → red", ok: latest.vixLevel < 20 ? true : latest.vixLevel > 25 ? false : null },
    { label: "VIX 5-day slope", value: latest.vixSlope5d.toFixed(3), threshold: "falling preferred", ok: latest.vixSlope5d <= 0 },
    { label: "Breadth proxy", value: `${latest.breadthProxyPct.toFixed(0)}%`, threshold: "≥ 55% → green · < 45% → red", ok: latest.breadthProxyPct >= 55 ? true : latest.breadthProxyPct < 45 ? false : null },
    { label: "RSP > 50-SMA", value: latest.rspAbove50Sma ? "yes" : "no", threshold: "yes preferred", ok: latest.rspAbove50Sma },
    { label: "Distribution days (25)", value: String(latest.distributionDays), threshold: "≤ 4 → ok · ≥ 6 → red", ok: latest.distributionDays <= 4 ? true : latest.distributionDays >= 6 ? false : null },
    { label: "Follow-through day", value: latest.followThroughDay ? "yes" : "no", threshold: "recent yes → green-favored", ok: latest.followThroughDay ? true : null },
  ] : [];

  let ddDates: string[] = [];
  try { ddDates = JSON.parse(latest?.distributionDayDates || "[]"); } catch { /* noop */ }

  return (
    <Panel title="Regime Engine" hint={state?.stale ? "Auto-classified · STALE" : "Auto-classified"}>
      <div className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-[10px] uppercase tracking-wider text-slate-gray">Auto-engine</div>
          <Chip tone={codeTone[effectiveCode]} data-testid="text-regime-effective">
            {effectiveCode.toUpperCase()}
          </Chip>
          <span
            data-testid="pill-regime-source"
            className={`inline-flex items-center px-1.5 py-0.5 border text-[9px] tracking-widest uppercase font-display rounded-sm ${
              source === "MANUAL"
                ? "border-signal-amber/40 bg-signal-amber/10 text-signal-amber"
                : "border-neon-blue/40 bg-neon-blue/10 text-neon-blue"
            }`}
          >
            {source}
          </span>
          {state?.stale && (
            <span className="inline-flex items-center px-1.5 py-0.5 border border-signal-amber/40 bg-signal-amber/10 text-signal-amber text-[9px] tracking-widest uppercase font-display rounded-sm">
              STALE
            </span>
          )}
          <div className="text-[11px] text-slate-gray font-mono">since {sinceLabel}</div>
          <button
            onClick={recompute}
            disabled={busy}
            data-testid="button-regime-recompute"
            className="ml-auto px-3 py-1.5 border border-neon-blue/60 bg-neon-blue/10 text-neon-blue text-[11px] uppercase tracking-wider rounded-sm hover:bg-neon-blue/20 disabled:opacity-50"
          >
            {busy ? "Recomputing…" : "Recompute now"}
          </button>
        </div>

        <div className="text-[11px] text-slate-gray font-mono">Last classified · {lastClassifiedLabel}</div>
        {state?.lastError && (
          <div className="text-[10px] text-signal-amber">Last fetch error · {state.lastError}</div>
        )}
        {state?.pendingRegime && state.pendingRegime !== state.currentRegime && (
          <div data-testid="text-pending-regime" className="text-[11px] text-slate-gray font-mono">
            → pending {state.pendingRegime.toUpperCase()} · {state.pendingConsecutiveCount}/2 closes confirmed
          </div>
        )}

        <div className="pt-2 border-t border-ink-line">
          <div className="text-[10px] uppercase tracking-wider text-slate-gray mb-2">Manual override</div>
          <div className="flex gap-2 flex-wrap">
            {(["green", "yellow", "red"] as const).map(r => {
              const active = state?.manualOverride && state.manualOverrideRegime === r;
              const ru = r.toUpperCase();
              return (
                <button
                  key={r}
                  data-testid={`button-regime-${r}`}
                  onClick={() => setOverride(true, r)}
                  className={`px-3 py-1.5 border text-[11px] uppercase tracking-wider font-display rounded-sm
                    ${active
                      ? r === "green" ? "border-signal-green bg-signal-green/15 text-signal-green"
                      : r === "yellow" ? "border-signal-amber bg-signal-amber/15 text-signal-amber"
                      : "border-signal-red bg-signal-red/15 text-signal-red"
                      : "border-ink-line text-slate-gray hover:text-soft-white"}`}
                >
                  {ru}
                </button>
              );
            })}
            <button
              onClick={() => setOverride(false)}
              disabled={!state?.manualOverride}
              data-testid="button-regime-auto"
              className="px-3 py-1.5 border border-neon-blue/60 bg-neon-blue/10 text-neon-blue text-[11px] uppercase tracking-wider rounded-sm hover:bg-neon-blue/20 disabled:opacity-40"
            >
              Disable override · use AUTO
            </button>
          </div>
          <p className="mt-2 text-[10px] text-slate-gray">
            Override is binding for new entries only. Open positions keep their original stops. The auto-engine continues classifying in the background.
          </p>
        </div>

        <div className="pt-2 border-t border-ink-line">
          <div className="text-[10px] uppercase tracking-wider text-slate-gray mb-2">Inputs · latest classification</div>
          {isLoading ? (
            <div className="text-[12px] text-slate-gray py-2">Loading…</div>
          ) : !latest ? (
            <div className="text-[12px] text-slate-gray py-2">No regime inputs yet. Try "Recompute now" to fetch from Yahoo.</div>
          ) : (
            <div className="overflow-x-auto">
              <table data-testid="table-regime-inputs" className="w-full text-[12px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-slate-gray">
                    <th className="text-left px-2 py-1.5 font-medium">Input</th>
                    <th className="text-right px-2 py-1.5 font-medium">Value</th>
                    <th className="text-left px-2 py-1.5 font-medium">Threshold</th>
                    <th className="text-center px-2 py-1.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.label} className="border-t border-ink-line/60">
                      <td className="px-2 py-1.5">{row.label}</td>
                      <td className="px-2 py-1.5 text-right font-mono-num tabular-nums">{row.value}</td>
                      <td className="px-2 py-1.5 text-[10px] text-slate-gray uppercase tracking-wider">{row.threshold}</td>
                      <td className="px-2 py-1.5 text-center">
                        {row.ok === true ? <span className="text-signal-green">✓</span>
                          : row.ok === false ? <span className="text-signal-red">✗</span>
                          : <span className="text-slate-gray">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {ddDates.length > 0 && (
          <div className="pt-2 border-t border-ink-line">
            <div className="text-[10px] uppercase tracking-wider text-slate-gray mb-1.5">Distribution days · last 25 sessions</div>
            <div className="flex flex-wrap gap-1.5">
              {ddDates.map(d => (
                <span key={d} className="inline-flex items-center px-1.5 py-0.5 border border-signal-red/40 bg-signal-red/10 text-signal-red text-[10px] font-mono tabular-nums rounded-sm">
                  {d}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="pt-2 border-t border-ink-line text-[10px] text-slate-gray">
          VIX uses the VIXY ETF as a proxy (Finnhub free tier doesn’t cover ^VIX). Yahoo daily closes power SMAs, distribution days, follow-through, and breadth. Refresh: server start + 6:15 PM ET daily + every 15 min during US market hours.
        </div>
      </div>
    </Panel>
  );
}
