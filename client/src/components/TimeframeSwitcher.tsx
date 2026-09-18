// ─── TimeframeSwitcher ──────────────────────────────────────────────────
// Compact TradingView-style timeframe picker for the Cockpit chart.
// Renders the quick strip (30m / 1H / 4H / 1D) plus a More dropdown for
// the extra intervals (currently just 5m; more can be added as server
// support lands). The active choice is highlighted with a cyan border.
//
// Purely controlled — parent owns the state and does the localStorage
// persistence via `writeSavedTimeframe`.

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  TIMEFRAMES,
  QUICK_TIMEFRAMES,
  MORE_TIMEFRAMES,
  type Timeframe,
} from "@/lib/timeframes";

interface Props {
  value: Timeframe;
  onChange: (tf: Timeframe) => void;
}

export default function TimeframeSwitcher({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click. Uses mousedown so it beats the button's onClick.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Group MORE_TIMEFRAMES by their meta.group so the dropdown reads like
  // TradingView (MINUTES / HOURS / DAYS section headers).
  const grouped = MORE_TIMEFRAMES.reduce<Record<string, Timeframe[]>>((acc, tf) => {
    const g = TIMEFRAMES[tf].group;
    (acc[g] = acc[g] || []).push(tf);
    return acc;
  }, {});
  const groupOrder: Array<"MINUTES" | "HOURS" | "DAYS"> = ["MINUTES", "HOURS", "DAYS"];

  const activeInMore = MORE_TIMEFRAMES.includes(value);

  return (
    <div ref={rootRef} className="relative flex items-center" data-testid="timeframe-switcher">
      {/* Quick strip — one segmented control so buttons visually chain */}
      <div className="flex items-center rounded border border-ink-line overflow-hidden">
        {QUICK_TIMEFRAMES.map((tf, i) => {
          const active = tf === value;
          return (
            <button
              key={tf}
              onClick={() => onChange(tf)}
              data-testid={`tf-quick-${tf}`}
              className={`px-2 py-1 text-[10px] font-mono uppercase tracking-wider transition-colors ${
                active
                  ? "bg-neon-blue/15 text-neon-blue"
                  : "text-slate-gray hover:text-soft-white"
              } ${i > 0 ? "border-l border-ink-line" : ""}`}
              title={TIMEFRAMES[tf].spoken}
            >
              {TIMEFRAMES[tf].label}
            </button>
          );
        })}

        {/* More dropdown trigger — sits on the same segmented row */}
        <button
          onClick={() => setOpen((v) => !v)}
          data-testid="tf-more-trigger"
          className={`px-1.5 py-1 border-l border-ink-line flex items-center gap-0.5 text-[10px] font-mono uppercase tracking-wider ${
            activeInMore || open
              ? "bg-neon-blue/15 text-neon-blue"
              : "text-slate-gray hover:text-soft-white"
          }`}
          title="More timeframes"
        >
          {activeInMore ? TIMEFRAMES[value].label : "More"}
          <ChevronDown className="w-2.5 h-2.5" />
        </button>
      </div>

      {/* Grouped dropdown menu */}
      {open && (
        <div
          className="absolute top-full right-0 mt-1 z-50 min-w-[140px] rounded border border-ink-line bg-ink-black shadow-xl"
          data-testid="tf-more-menu"
        >
          {groupOrder.map((groupKey) => {
            const items = grouped[groupKey];
            if (!items || items.length === 0) return null;
            return (
              <div key={groupKey} className="py-1">
                <div className="px-2 pb-0.5 text-[9px] font-mono uppercase tracking-wider text-slate-gray/70">
                  {groupKey}
                </div>
                {items.map((tf) => {
                  const active = tf === value;
                  return (
                    <button
                      key={tf}
                      onClick={() => { onChange(tf); setOpen(false); }}
                      data-testid={`tf-more-${tf}`}
                      className={`w-full text-left px-2 py-1 text-[11px] font-mono uppercase tracking-wider ${
                        active
                          ? "text-neon-blue bg-neon-blue/10"
                          : "text-soft-white hover:bg-ink-panel"
                      }`}
                    >
                      {TIMEFRAMES[tf].label}
                      <span className="ml-1 text-[9px] text-slate-gray/70 normal-case tracking-normal">
                        {TIMEFRAMES[tf].spoken.replace(/^on the /, "").replace(/ chart$/, "")}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
