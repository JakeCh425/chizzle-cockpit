// AScoreLegend — tiny legend pill row explaining A-score tiers.
// Tooltips match the verbose wording used elsewhere in the cockpit.

interface LegendItem {
  label: string;
  tone: string;
  tip: string;
}

const ITEMS: LegendItem[] = [
  { label: "A2",  tone: "bg-signal-amber/15 text-signal-amber border-signal-amber/40",
    tip: "A2 — Approaching SMA20: price within 1% of the 20-day moving average. Watch for a touch or breakout." },
  { label: "A3",  tone: "bg-signal-amber/25 text-signal-amber border-signal-amber/50",
    tip: "A3 — Touching SMA20: price within 0.2% of the 20-day moving average. Decision point: bounce or break." },
  { label: "A4",  tone: "bg-signal-green/15 text-signal-green border-signal-green/40",
    tip: "A4 — Bounce: price crossed back above SMA20 from below. Trend-continuation setup." },
  { label: "REJ", tone: "bg-signal-red/15 text-signal-red border-signal-red/40",
    tip: "REJECTION — Price crossed below SMA20 from above. Trend weakening; reduce or exit." },
];

export default function AScoreLegend({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex items-center gap-1.5 ${className}`}
      data-testid="ascore-legend"
      role="list"
      aria-label="A-score legend"
    >
      {ITEMS.map(it => (
        <span
          key={it.label}
          role="listitem"
          title={it.tip}
          aria-label={it.tip}
          data-testid={`ascore-legend-${it.label}`}
          className={`px-1.5 py-0.5 text-[9px] font-mono-num uppercase tracking-wider border rounded-sm cursor-help ${it.tone}`}
        >{it.label}</span>
      ))}
    </div>
  );
}
