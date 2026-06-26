// ─── Fidelity OTOCO Cheat Sheet ─────────────────────────────────────────────
// Inline reference panel for placing conditional orders in Fidelity Active
// Trader Pro. Designed to be opened next to a fired cockpit card so the user
// can copy entry / stop / target straight into Fidelity without context-switching
// to a doc. Collapsible by default to keep the cockpit clean.

import { useState } from "react";
import { ChevronDown, ChevronUp, BookOpen, Copy, Check } from "lucide-react";

interface CheatSheetProps {
  // Optionally seed the worked example with values from the most-active card.
  // When provided, the example block shows these instead of the SMH defaults.
  symbol?: string;
  entry?: number | null;
  stop?: number | null;
  target?: number | null;
  shares?: number;
}

function fmt(n: number | null | undefined, dp = 2) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(dp);
}

// Stop-limit buffer applied to the stop price to reduce slippage rejections.
// 0.15% is the safe default for most ETFs/stocks.
function stopLimitFrom(stop: number | null | undefined, buffer = 0.0015): string {
  if (stop == null || !Number.isFinite(stop)) return "—";
  return (stop * (1 - buffer)).toFixed(2);
}

export default function FidelityCheatSheet({
  symbol,
  entry,
  stop,
  target,
  shares,
}: CheatSheetProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // Use live card values if provided, else fall back to SMH walkthrough numbers.
  const sym = symbol || "SMH";
  const e = entry ?? 619.85;
  const s = stop ?? 606.23;
  const t = target ?? 647.09;
  const q = shares && shares > 0 ? shares : 2;
  const stopLim = stopLimitFrom(s);

  // Quick-copy helper for the user to paste numbers into Fidelity.
  // Falls back gracefully if clipboard API is blocked.
  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 1200);
    } catch {
      /* ignore */
    }
  }

  const CopyChip = ({ value, label }: { value: string; label: string }) => (
    <button
      type="button"
      onClick={() => copy(value, label)}
      className="ml-1.5 inline-flex items-center gap-1 rounded border border-ink-line/80 bg-ink-deep/70 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-slate-gray hover:text-neon-blue hover:border-neon-blue/60 transition-colors"
      data-testid={`button-copy-${label}`}
      title={`Copy ${value} to clipboard`}
    >
      {copied === label ? <Check className="w-2.5 h-2.5 text-signal-green" /> : <Copy className="w-2.5 h-2.5" />}
      {copied === label ? "copied" : "copy"}
    </button>
  );

  return (
    <div className="border border-ink-line/80 bg-ink-deep/30 rounded-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-ink-line/20 transition-colors"
        data-testid="button-toggle-fidelity-cheat"
      >
        <div className="flex items-center gap-2">
          <BookOpen className="w-3.5 h-3.5 text-neon-blue" />
          <span className="text-[11px] uppercase tracking-wider font-semibold text-soft-white">
            Fidelity Order Cheat Sheet
          </span>
          <span className="text-[10px] text-slate-gray italic">
            One-Triggers-OCO · the only order type you need
          </span>
        </div>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-slate-gray" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-gray" />}
      </button>

      {open && (
        <div className="px-3 py-3 border-t border-ink-line/60 space-y-3 text-[11px] text-soft-white/90">
          {/* Step-by-step workflow */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-gray mb-1.5">Workflow</div>
            <ol className="list-decimal list-inside space-y-0.5 text-soft-white/85">
              <li>Open <span className="text-neon-blue font-semibold">Active Trader Pro</span> (desktop only — mobile doesn't support OTOCO)</li>
              <li>Top menu → <span className="text-neon-blue">Trade & Orders → Conditional Trade</span></li>
              <li>Change trade type from <span className="font-mono text-slate-gray">Contingent</span> → <span className="text-neon-blue font-semibold">One-Triggers-OCO</span></li>
              <li>Fill 3 legs (below), Preview, Place Order</li>
              <li>Come back to cockpit → Trades → <span className="text-signal-green">ARM TRADE</span></li>
            </ol>
          </div>

          {/* Worked example with copy chips */}
          <div className="rounded-sm border border-ink-line/60 bg-ink-black/40 p-2">
            <div className="text-[10px] uppercase tracking-wider text-slate-gray mb-2">
              Example: {sym} from active cockpit card
            </div>

            {/* BUY leg */}
            <div className="mb-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-neon-blue mb-1">Leg 1 — Buy Limit (entry)</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono tabular-nums text-[10.5px] text-soft-white/85">
                <div>Symbol: <span className="text-soft-white">{sym}</span><CopyChip value={sym} label="sym" /></div>
                <div>Action: <span className="text-soft-white">Buy</span></div>
                <div>Quantity: <span className="text-soft-white">{q}</span><CopyChip value={String(q)} label="qty" /></div>
                <div>Order Type: <span className="text-soft-white">Limit</span></div>
                <div className="col-span-2">Limit Price: <span className="text-soft-white">${fmt(e)}</span><CopyChip value={fmt(e)} label="entry" /></div>
                <div className="col-span-2">Time in Force: <span className="text-soft-white">Day</span> (or GTC if pre-market)</div>
              </div>
            </div>

            {/* SELL LIMIT leg */}
            <div className="mb-2 pt-2 border-t border-ink-line/40">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-signal-green mb-1">Leg 2 — Sell Limit (T1 target)</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono tabular-nums text-[10.5px] text-soft-white/85">
                <div>Action: <span className="text-soft-white">Sell</span></div>
                <div>Quantity: <span className="text-soft-white">{q}</span></div>
                <div>Order Type: <span className="text-soft-white">Limit</span></div>
                <div>Time in Force: <span className="text-soft-white">GTC</span></div>
                <div className="col-span-2">Limit Price: <span className="text-soft-white">${fmt(t)}</span><CopyChip value={fmt(t)} label="t1" /></div>
              </div>
            </div>

            {/* STOP LIMIT leg */}
            <div className="pt-2 border-t border-ink-line/40">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-signal-red mb-1">Leg 3 — Stop LIMIT (not Stop Loss)</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono tabular-nums text-[10.5px] text-soft-white/85">
                <div>Action: <span className="text-soft-white">Sell</span></div>
                <div>Quantity: <span className="text-soft-white">{q}</span></div>
                <div>Order Type: <span className="text-soft-white">Stop Limit</span></div>
                <div>Time in Force: <span className="text-soft-white">GTC</span></div>
                <div>Stop Price: <span className="text-soft-white">${fmt(s)}</span><CopyChip value={fmt(s)} label="stop" /></div>
                <div>Limit Price: <span className="text-soft-white">${stopLim}</span><CopyChip value={stopLim} label="stopLim" /></div>
              </div>
              <div className="text-[9.5px] text-slate-gray italic mt-1">
                Limit = Stop × (1 − 0.15%) = caps slippage on fast moves. Use 0.10% for SPY/QQQ, 0.25% for earnings days.
              </div>
            </div>
          </div>

          {/* Stop Limit vs Stop Loss reminder */}
          <div className="rounded-sm border border-signal-amber/30 bg-signal-amber/5 p-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-signal-amber mb-1">Why Stop LIMIT, not Stop Loss?</div>
            <div className="text-[10px] text-soft-white/85 leading-snug">
              A plain Stop Loss becomes a <span className="text-signal-red">MARKET order</span> when triggered — in a fast move you can fill 2–5% below your stop.
              Stop Limit caps how far it slips. Trade-off: in a true flash crash a Stop Limit can fail to fill, but for ETFs like SMH/QQQ this almost never happens.
            </div>
          </div>

          {/* Common mistakes */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-gray mb-1">Don't do these</div>
            <ul className="list-disc list-inside space-y-0.5 text-soft-white/85 text-[10.5px]">
              <li><span className="text-signal-red">Day order on the bracket</span> — must be GTC or it expires at 4 PM</li>
              <li><span className="text-signal-red">Market order on entry</span> — slippage can blow your plan; always Limit</li>
              <li><span className="text-signal-red">Mismatched quantity</span> — bracket sell must match buy exactly</li>
              <li><span className="text-signal-red">Limit above stop on sells</span> — order is rejected; limit must be a hair BELOW stop</li>
            </ul>
          </div>

          {/* After T1 trail */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-gray mb-1">After T1 fills (ride the runner)</div>
            <div className="text-[10.5px] text-soft-white/85 leading-snug">
              Right-click remaining shares → Modify Order → change Stop to <span className="text-neon-blue font-semibold">Trailing Stop %</span>:
              <span className="text-soft-white"> 5%</span> for SMH/QQQ-style ETFs, <span className="text-soft-white">8%</span> for individual stocks.
              Locks in gains as price rises.
            </div>
          </div>

          {/* Mobile fallback */}
          <div className="rounded-sm border border-ink-line/60 bg-ink-black/30 p-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-gray mb-1">Mobile fallback (no OTOCO)</div>
            <div className="text-[10px] text-soft-white/80 leading-snug">
              Place Buy Limit. When fill confirms, manually place separate Sell Limit (T1, GTC) + Sell Stop Limit (stop, GTC).
              <span className="text-signal-amber"> Never close one without canceling the other</span> or you'll be naked.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
