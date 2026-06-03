// AScoreLegend — tiny legend pill row for A-score meaning.
export default function AScoreLegend({ className = "" }: { className?: string }) {
  const items: { label: string; tone: string; tip: string }[] = [
    { label: "A2",  tone: "bg-signal-amber/15 text-signal-amber border-signal-amber/40",   tip: "Approaching SMA20 (≤1%)" },
    { label: "A3",  tone: "bg-signal-amber/25 text-signal-amber border-signal-amber/50",   tip: "Touching SMA20 (≤0.2%)" },
    { label: "A4",  tone: "bg-signal-green/15 text-signal-green border-signal-green/40",   tip: "Bounce cross above SMA20" },
    { label: "REJ", tone: "bg-signal-red/15 text-signal-red border-signal-red/40",         tip: "Cross below SMA20" },
  ];
  return (
    <div className={`flex items-center gap-1.5 ${className}`} data-testid="ascore-legend">
      {items.map(it => (
        <span
          key={it.label}
          title={it.tip}
          className={`px-1.5 py-0.5 text-[9px] font-mono-num uppercase tracking-wider border rounded-sm ${it.tone}`}
        >{it.label}</span>
      ))}
    </div>
  );
}
