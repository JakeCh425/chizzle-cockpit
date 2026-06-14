// Phase 1 — reusable inline calculator. Renders shares, $ at risk, R:R.
// Pure read of `calcPositionSize` — does not mutate parent state.
import { calcPositionSize, calcRR } from "@/lib/positionSize";

interface Props {
  accountSize: number;
  riskPercent: number;
  entryPrice: number;
  stopPrice: number;
  targetPrice?: number | null;
  direction?: "long" | "short";
  className?: string;
}

export function PositionSizeCalculator({
  accountSize,
  riskPercent,
  entryPrice,
  stopPrice,
  targetPrice,
  direction = "long",
  className,
}: Props) {
  const result = calcPositionSize({ accountSize, riskPercent, entryPrice, stopPrice, direction });
  const rr = calcRR(entryPrice, stopPrice, targetPrice ?? null);

  if (!result.ok) {
    return (
      <div
        className={"border rounded-sm p-3 " + (className ?? "")}
        style={{ borderColor: "hsl(var(--signal-red) / 0.4)", background: "hsl(var(--signal-red) / 0.05)" }}
        data-testid="calc-result-invalid"
      >
        <div className="text-[10px] uppercase tracking-wider text-signal-red mb-1">Cannot size</div>
        <div className="text-[12px] text-soft-white" data-testid="calc-error-msg">{result.message}</div>
      </div>
    );
  }

  return (
    <div
      className={"border border-ink-line rounded-sm p-3 grid grid-cols-4 gap-3 " + (className ?? "")}
      data-testid="calc-result-ok"
    >
      <Stat label="Shares" value={result.shares.toLocaleString()} accent="neon-blue" testid="calc-shares" />
      <Stat label="Risk $" value={`$${result.riskDollars.toFixed(2)}`} testid="calc-risk-dollars" />
      <Stat label="Per-share" value={`$${result.perShareRisk.toFixed(2)}`} testid="calc-per-share" />
      <Stat
        label="R:R"
        value={rr == null ? "—" : `${rr.toFixed(2)}R`}
        accent={rr != null && rr >= 2 ? "signal-green" : undefined}
        testid="calc-rr"
      />
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  testid,
}: {
  label: string;
  value: string;
  accent?: "neon-blue" | "signal-green";
  testid: string;
}) {
  const textCls =
    accent === "neon-blue"
      ? "text-neon-blue"
      : accent === "signal-green"
      ? "text-signal-green"
      : "text-soft-white";
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-slate-gray mb-1">{label}</div>
      <div className={`font-mono-num tabular-nums text-[15px] font-semibold ${textCls}`} data-testid={testid}>
        {value}
      </div>
    </div>
  );
}
