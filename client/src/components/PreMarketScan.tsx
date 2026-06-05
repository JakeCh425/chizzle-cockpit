import { useState } from "react";
import { errMsg } from "@/lib/errors";
import { Panel, Chip } from "@/components/Panel";
import { Sunrise, RefreshCw, ExternalLink } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type Mover = {
  ticker: string;
  latestDate?: string;
  latestClose?: number;
  priorClose?: number;
  pct?: number;
  error?: string;
};

type ActiveSetup = {
  ticker: string;
  state: string;
  quality: string | null;
  entryZoneLow: number | null;
  entryZoneHigh: number | null;
  triggerFired: boolean;
};

type ScanResult = {
  scannedAt: string;
  regime: {
    code: "green" | "yellow" | "red" | string;
    source?: string;
    currentRegime?: string;
    manualOverride?: boolean;
  };
  movers: Mover[];
  activeSetups: ActiveSetup[];
  dashboardUrl: string;
};

function regimeTone(code: string): "green" | "amber" | "red" | "neutral" {
  const c = String(code || "").toLowerCase();
  if (c === "green") return "green";
  if (c === "yellow") return "amber";
  if (c === "red") return "red";
  return "neutral";
}

function fmtPct(pct: number | undefined): string {
  if (pct === undefined || !Number.isFinite(pct)) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function fmtPrice(p: number | undefined | null): string {
  if (p == null || !Number.isFinite(p)) return "—";
  return `$${p.toFixed(2)}`;
}

export default function PreMarketScan() {
  const { toast } = useToast();
  const [result, setResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);

  const runScan = async () => {
    if (loading) return;
    setLoading(true);
    try {
      // Kick off SMA20 sweep in background so alerts feed catches up
      apiRequest("POST", "/api/alerts/scan-sma20", undefined).catch(() => {});
      const r = await fetch("/api/premarket-scan");
      if (!r.ok) throw new Error(`scan failed: ${r.status}`);
      const data: ScanResult = await r.json();
      setResult(data);
      // Refresh related caches so the rest of the cockpit reflects fresh data
      const keys = [
        "/api/regime",
        "/api/setups",
        "/api/alerts",
        "/api/chizzle-scores",
      ];
      for (const k of keys) queryClient.invalidateQueries({ queryKey: [k] });
      toast({ title: "Pre-market scan complete", description: `${data.movers.filter(m => !m.error).length}/6 tickers · regime ${String(data.regime.code).toUpperCase()}` });
    } catch (e: unknown) {
      toast({ title: "Pre-market scan failed", description: errMsg(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Top 3 movers by absolute %, only those with valid pct
  const topMovers = (result?.movers || [])
    .filter(m => !m.error && Number.isFinite(m.pct))
    .sort((a, b) => Math.abs(b.pct!) - Math.abs(a.pct!))
    .slice(0, 3);

  const regimeCode = result?.regime.code ? String(result.regime.code).toUpperCase() : null;
  const tone = regimeTone(result?.regime.code || "");

  return (
    <Panel
      title="Pre-Market Scan"
      hint={result ? `Last scan ${new Date(result.scannedAt).toLocaleTimeString()}` : "One-tap briefing · SMH · QQQ · SPY · IWM · AAPL · META"}
      action={
        <button
          onClick={runScan}
          disabled={loading}
          data-testid="button-premarket-scan"
          title="Run pre-market briefing scan"
          className="flex items-center gap-1.5 px-3 py-1 border border-neon-blue/60 text-neon-blue bg-neon-blue/10 text-[11px] uppercase tracking-wider rounded-sm hover:bg-neon-blue/20 disabled:opacity-40"
        >
          {loading
            ? <RefreshCw className="w-3 h-3 animate-spin" />
            : <Sunrise className="w-3 h-3" />}
          {loading ? "Scanning" : (result ? "Re-scan" : "Scan now")}
        </button>
      }
    >
      {!result && !loading && (
        <div className="text-[11px] text-slate-gray py-3">
          Click <span className="text-neon-blue">Scan now</span> to fetch overnight moves, regime status, and any active setups in entry zone before the open.
        </div>
      )}

      {result && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Regime block */}
          <div className="bg-ink-panel/60 border border-ink-line/60 rounded-sm p-3" data-testid="premarket-regime">
            <div className="text-[10px] uppercase tracking-wider text-slate-gray mb-1.5">Regime</div>
            <div className="flex items-center gap-2">
              {regimeCode && (
                <Chip tone={tone} className="text-[12px] px-2 py-0.5 tracking-widest font-display">
                  {regimeCode}
                </Chip>
              )}
              {result.regime.manualOverride && (
                <span className="text-[9px] uppercase tracking-wider text-signal-amber" title="Manual override active">override</span>
              )}
            </div>
            <div className="text-[10px] text-slate-gray mt-2">
              Source: {result.regime.source || "—"}
            </div>
          </div>

          {/* Top 3 movers */}
          <div className="bg-ink-panel/60 border border-ink-line/60 rounded-sm p-3" data-testid="premarket-movers">
            <div className="text-[10px] uppercase tracking-wider text-slate-gray mb-1.5">Top 3 Movers · vs prior close</div>
            {topMovers.length === 0 && (
              <div className="text-[11px] text-slate-gray">No mover data available.</div>
            )}
            <ul className="space-y-1">
              {topMovers.map(m => {
                const pos = (m.pct ?? 0) > 0;
                const colorCls = pos ? "text-signal-green" : "text-signal-red";
                return (
                  <li key={m.ticker} className="flex items-center justify-between text-[12px]" data-testid={`premarket-mover-${m.ticker}`}>
                    <span className="font-mono text-soft-white">{m.ticker}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-slate-gray text-[10px]">{fmtPrice(m.latestClose)}</span>
                      <span className={`font-mono ${colorCls}`}>{fmtPct(m.pct)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Active setups */}
          <div className="bg-ink-panel/60 border border-ink-line/60 rounded-sm p-3" data-testid="premarket-setups">
            <div className="text-[10px] uppercase tracking-wider text-slate-gray mb-1.5">Active Setups · in entry zone</div>
            {result.activeSetups.length === 0 ? (
              <div className="text-[11px] text-slate-gray">No setups in active entry zone.</div>
            ) : (
              <ul className="space-y-1">
                {result.activeSetups.slice(0, 5).map((s, i) => (
                  <li
                    key={`${s.ticker}-${i}`}
                    className="flex items-center justify-between text-[12px]"
                    data-testid={`premarket-setup-${s.ticker}`}
                  >
                    <span className="font-mono text-soft-white">{s.ticker}</span>
                    <span className="flex items-center gap-2 text-[10px]">
                      {s.quality && (
                        <span className={`px-1 py-px border rounded-sm ${
                          s.quality === "A" ? "border-signal-green/60 text-signal-green"
                          : s.quality === "B" ? "border-neon-blue/60 text-neon-blue"
                          : "border-slate-gray/60 text-slate-gray"
                        }`}>
                          {s.quality}
                        </span>
                      )}
                      <span className="text-slate-gray uppercase tracking-wider">{String(s.state || "").toLowerCase()}</span>
                      {s.triggerFired && <span className="text-signal-amber">●</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {result && (
        <div className="mt-3 flex items-center justify-between text-[10px] text-slate-gray">
          <span>Scanned {new Date(result.scannedAt).toLocaleString()}</span>
          <a
            href={result.dashboardUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-neon-blue hover:underline"
            data-testid="link-premarket-dashboard"
          >
            Open live dashboard <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}
    </Panel>
  );
}
