import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Panel, Chip } from "@/components/Panel";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { LeapPosition, LeapReserve, Settings } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2 } from "lucide-react";

const TARGETS = [
  { ticker: "SMH", pct: 40 }, { ticker: "TSM", pct: 25 },
  { ticker: "AMD", pct: 20 }, { ticker: "AMAT", pct: 15 },
];

export default function LeapLadder() {
  const { toast } = useToast();
  const { data: positions } = useQuery<LeapPosition[]>({ queryKey: ["/api/leap"] });
  const { data: reserve } = useQuery<LeapReserve>({ queryKey: ["/api/leap-reserve"] });
  const { data: settings } = useQuery<Settings>({ queryKey: ["/api/settings"] });

  const equity = settings?.equity ?? 1000;
  const bookValue = (positions || []).reduce((s, p) => s + p.currentPremium * p.contracts * 100, 0);
  const bookPct = equity > 0 ? (bookValue / equity) * 100 : 0;
  const reserveBal = reserve?.balance ?? 0;
  const nextTrigger = 500;
  const pctToTrigger = Math.min(100, (reserveBal / nextTrigger) * 100);

  // Determine target ramp
  let targetPct = 0;
  if (equity >= 100000) targetPct = 35;
  else if (equity >= 25000) targetPct = 25;
  else if (equity >= 5000) targetPct = 10;

  const [adding, setAdding] = useState(false);

  return (
    <div className="p-3 md:p-4 space-y-4">
      <div className="flex items-baseline gap-3 pb-1 border-b border-ink-line/60">
        <h1 className="font-display text-[15px] tracking-[0.2em] uppercase text-soft-white">LEAP Ladder</h1>
        <span className="text-[10px] uppercase tracking-wider text-slate-gray">Long-term position book</span>
      </div>
      {/* Header stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Panel title="LEAP Book"><div className="font-mono-num text-[22px] tabular-nums">${bookValue.toFixed(2)}</div></Panel>
        <Panel title="% of Portfolio">
          <div className="font-mono-num text-[22px] tabular-nums">{bookPct.toFixed(2)}%</div>
          <div className="text-[10px] text-slate-gray uppercase tracking-wider mt-1">Target ramp · {targetPct}%</div>
        </Panel>
        <Panel title="Reserve" hint="25% of swing wins">
          <div className="font-mono-num text-[22px] tabular-nums text-gold-lux">${reserveBal.toFixed(2)}</div>
          <div className="mt-2 h-1.5 bg-ink-line overflow-hidden">
            <div className="h-full bg-gold-lux" style={{ width: `${pctToTrigger}%` }} />
          </div>
          <div className="text-[10px] text-slate-gray mt-1 font-mono tabular-nums">${reserveBal.toFixed(2)} / $500 next contract</div>
        </Panel>
        <Panel title="Realized Roll P/L YTD"><div className="font-mono-num text-[22px] tabular-nums">${(reserve?.realizedRollPnlYtd ?? 0).toFixed(2)}</div></Panel>
      </div>

      <Panel
        title="Ladder Positions"
        hint={`${positions?.length ?? 0} contracts · roll when DTE ≤ 270 or delta ≥ 0.90`}
        action={
          <button onClick={() => setAdding(true)} data-testid="button-add-leap" className="flex items-center gap-1.5 px-2.5 py-1 border border-neon-blue/40 text-neon-blue bg-neon-blue/10 text-[11px] uppercase tracking-wider rounded-sm">
            <Plus className="w-3 h-3" /> Add LEAP
          </button>
        }
      >
        <PositionsTable positions={positions || []} />
      </Panel>

      <Panel title="Allocation Targets">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {TARGETS.map(t => {
            const current = (positions || []).filter(p => p.ticker === t.ticker).reduce((s, p) => s + p.currentPremium * p.contracts * 100, 0);
            const currentPct = bookValue > 0 ? (current / bookValue) * 100 : 0;
            return (
              <div key={t.ticker} className="border border-ink-line p-3 rounded-sm">
                <div className="flex justify-between items-baseline">
                  <span className="font-mono-num text-[13px]">{t.ticker}</span>
                  <span className="text-[10px] text-slate-gray uppercase tracking-wider">target {t.pct}%</span>
                </div>
                <div className="mt-2 font-mono-num text-[15px] tabular-nums">{currentPct.toFixed(1)}%</div>
                <div className="mt-1 h-1 bg-ink-line">
                  <div className="h-full bg-neon-blue" style={{ width: `${Math.min(100, currentPct)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      {adding && <AddLeapModal onClose={() => setAdding(false)} />}
    </div>
  );
}

function PositionsTable({ positions }: { positions: LeapPosition[] }) {
  if (!positions.length) {
    return <div className="text-[12px] text-slate-gray py-4">No LEAP positions yet. Reserve accrues 25% of every realized winning swing trade.</div>;
  }
  return (
    <div className="overflow-x-auto -m-3.5">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-slate-gray">
            <th className="text-left px-3">Ticker</th><th className="text-right px-2">Contracts</th>
            <th className="text-right px-2">Strike</th><th className="text-left px-2">Expiry</th>
            <th className="text-right px-2">DTE</th>
            <th className="text-right px-2">Δ Entry</th><th className="text-right px-2">Δ Now</th>
            <th className="text-right px-2">Premium Paid</th><th className="text-right px-2">Premium Now</th>
            <th className="text-right px-2">P/L $</th><th className="text-right px-2">P/L %</th>
            <th className="text-left px-2">Roll</th>
            <th className="px-3"></th>
          </tr>
        </thead>
        <tbody>
          {positions.map(p => {
            const dte = Math.floor((new Date(p.expiry).getTime() - Date.now()) / 86400000);
            const pnl$ = (p.currentPremium - p.premiumPaid) * p.contracts * 100;
            const pnlPct = p.premiumPaid > 0 ? ((p.currentPremium - p.premiumPaid) / p.premiumPaid) * 100 : 0;
            const rollFlag = dte <= 270 || p.currentDelta >= 0.90;
            return (
              <tr key={p.id} className="border-t border-ink-line/60">
                <td className="px-3 py-2 font-mono-num">{p.ticker}</td>
                <td className="px-2 py-2 text-right font-mono-num tabular-nums">{p.contracts}</td>
                <td className="px-2 py-2 text-right font-mono-num tabular-nums">{p.strike.toFixed(2)}</td>
                <td className="px-2 py-2 font-mono text-slate-gray text-[11px]">{p.expiry}</td>
                <td className={`px-2 py-2 text-right font-mono-num tabular-nums ${dte < 180 ? "text-signal-red" : dte < 270 ? "text-signal-amber" : ""}`}>{dte}</td>
                <td className="px-2 py-2 text-right font-mono-num tabular-nums text-slate-gray">{p.deltaAtEntry.toFixed(2)}</td>
                <td className="px-2 py-2 text-right font-mono-num tabular-nums">{p.currentDelta.toFixed(2)}</td>
                <td className="px-2 py-2 text-right font-mono-num tabular-nums text-slate-gray">{p.premiumPaid.toFixed(2)}</td>
                <td className="px-2 py-2 text-right font-mono-num tabular-nums">{p.currentPremium.toFixed(2)}</td>
                <td className={`px-2 py-2 text-right font-mono-num tabular-nums ${pnl$ >= 0 ? "text-signal-green" : "text-signal-red"}`}>{pnl$ >= 0 ? "+" : ""}{pnl$.toFixed(2)}</td>
                <td className={`px-2 py-2 text-right font-mono-num tabular-nums ${pnlPct >= 0 ? "text-signal-green" : "text-signal-red"}`}>{pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%</td>
                <td className="px-2 py-2">{rollFlag ? <Chip tone="amber">ROLL</Chip> : <Chip>HOLD</Chip>}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={async () => {
                      await apiRequest("DELETE", `/api/leap/${p.id}`);
                      queryClient.invalidateQueries({ queryKey: ["/api/leap"] });
                    }}
                    className="text-signal-red/70 hover:text-signal-red p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AddLeapModal({ onClose }: { onClose: () => void }) {
  const [ticker, setTicker] = useState("SMH");
  const [contracts, setContracts] = useState("1");
  const [strike, setStrike] = useState("");
  const [expiry, setExpiry] = useState(new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10));
  const [delta, setDelta] = useState("0.75");
  const [premium, setPremium] = useState("");
  const { toast } = useToast();

  const submit = async () => {
    if (!strike || !premium) { toast({ title: "Strike and premium required" }); return; }
    await apiRequest("POST", "/api/leap", {
      ticker, contracts: Number(contracts), strike: Number(strike),
      expiry, deltaAtEntry: Number(delta), premiumPaid: Number(premium),
      currentPremium: Number(premium), currentDelta: Number(delta),
      openedAt: new Date().toISOString(),
    });
    queryClient.invalidateQueries({ queryKey: ["/api/leap"] });
    toast({ title: "LEAP position added" });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-ink-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-ink-panel border border-ink-line rounded-sm w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
        <h3 className="font-display text-[13px] uppercase tracking-widest mb-4">Add LEAP</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-gray">Ticker</label>
            <select value={ticker} onChange={e => setTicker(e.target.value)} className="w-full mt-1 px-3 py-1.5 bg-ink-black border border-ink-line rounded-sm">
              {TARGETS.map(t => <option key={t.ticker}>{t.ticker}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-gray">Contracts</label>
            <input type="number" min="1" value={contracts} onChange={e => setContracts(e.target.value)} className="w-full mt-1 px-3 py-1.5 bg-ink-black border border-ink-line rounded-sm font-mono-num tabular-nums" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-gray">Strike</label>
            <input type="number" step="0.5" value={strike} onChange={e => setStrike(e.target.value)} className="w-full mt-1 px-3 py-1.5 bg-ink-black border border-ink-line rounded-sm font-mono-num tabular-nums" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-gray">Expiry</label>
            <input type="date" value={expiry} onChange={e => setExpiry(e.target.value)} className="w-full mt-1 px-3 py-1.5 bg-ink-black border border-ink-line rounded-sm font-mono tabular-nums" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-gray">Delta @ Entry</label>
            <input type="number" step="0.01" min="0" max="1" value={delta} onChange={e => setDelta(e.target.value)} className="w-full mt-1 px-3 py-1.5 bg-ink-black border border-ink-line rounded-sm font-mono-num tabular-nums" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-gray">Premium ($)</label>
            <input type="number" step="0.01" value={premium} onChange={e => setPremium(e.target.value)} className="w-full mt-1 px-3 py-1.5 bg-ink-black border border-ink-line rounded-sm font-mono-num tabular-nums" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-3 py-1.5 border border-ink-line text-[11px] uppercase tracking-wider rounded-sm">Cancel</button>
          <button onClick={submit} className="px-3 py-1.5 border border-neon-blue/60 bg-neon-blue/20 text-neon-blue text-[11px] uppercase tracking-wider rounded-sm">Add</button>
        </div>
      </div>
    </div>
  );
}
