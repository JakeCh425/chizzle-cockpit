import { cn } from "@/lib/utils";

interface PanelProps {
  title?: string;
  hint?: string;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}

export function Panel({ title, hint, className, bodyClassName, children, action }: PanelProps) {
  return (
    <section className={cn(
      "bg-ink-panel border border-ink-line rounded-sm flex flex-col",
      className,
    )}>
      {title && (
        <header className="px-3.5 py-2.5 border-b border-ink-line flex items-center justify-between gap-3 flex-shrink-0">
          <div className="flex items-baseline gap-3 min-w-0">
            <h2 className="font-display text-[11px] tracking-[0.18em] uppercase text-soft-white truncate">
              {title}
            </h2>
            {hint && <span className="text-[10px] text-slate-gray font-mono tabular-nums truncate">{hint}</span>}
          </div>
          {action}
        </header>
      )}
      <div className={cn("p-3.5 flex-1 min-h-0", bodyClassName)}>{children}</div>
    </section>
  );
}

export function StatRow({ label, value, valueClassName }: { label: string; value: React.ReactNode; valueClassName?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-ink-line/60 last:border-b-0">
      <span className="text-[10px] uppercase tracking-wider text-slate-gray">{label}</span>
      <span className={cn("font-mono-num text-[13px] tabular-nums text-soft-white", valueClassName)}>{value}</span>
    </div>
  );
}

export function Chip({ children, tone = "neutral", className }: { children: React.ReactNode; tone?: "neutral" | "green" | "amber" | "red" | "blue" | "gold"; className?: string }) {
  const tones: Record<string, string> = {
    neutral: "text-slate-gray border-ink-line bg-ink-line/40",
    green: "text-signal-green border-signal-green/40 bg-signal-green/10",
    amber: "text-signal-amber border-signal-amber/40 bg-signal-amber/10",
    red: "text-signal-red border-signal-red/40 bg-signal-red/10",
    blue: "text-neon-blue border-neon-blue/40 bg-neon-blue/10",
    gold: "text-gold-lux border-gold-lux/40 bg-gold-lux/10",
  };
  return (
    <span className={cn("inline-flex items-center px-1.5 py-0.5 border rounded-sm text-[10px] uppercase tracking-wider font-display", tones[tone], className)}>
      {children}
    </span>
  );
}
