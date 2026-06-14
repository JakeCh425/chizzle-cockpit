// Phase 5 — inline list of risk violations rendered above the trade-planner
// save button (and reusable in execution flows). Soft warnings: never blocks
// submission, but explains which rule is violated and by how much.

import type { RiskViolation } from "@shared/risk";

interface Props {
  violations: RiskViolation[];
  /** Optional context label used in the heading (e.g. "Planner check"). */
  context?: string;
}

export function RiskWarningBanner({ violations, context }: Props) {
  if (violations.length === 0) return null;
  const hasWarn = violations.some((v) => v.severity === "warn");
  const tone = hasWarn ? "red" : "blue";
  const borderColor =
    tone === "red"
      ? "hsl(var(--signal-red) / 0.5)"
      : "hsl(var(--neon-blue) / 0.4)";
  const background =
    tone === "red"
      ? "hsl(var(--signal-red) / 0.06)"
      : "hsl(var(--neon-blue) / 0.06)";
  const textColor =
    tone === "red" ? "hsl(var(--signal-red))" : "hsl(var(--neon-blue))";
  return (
    <div
      className="text-[11px] p-2 border rounded-sm space-y-1"
      style={{ borderColor, background, color: textColor }}
      data-testid="risk-warning-banner"
    >
      <div className="text-[10px] uppercase tracking-wider opacity-80">
        {context ? `${context} · ` : ""}
        {hasWarn ? "Risk warning" : "Risk note"}
      </div>
      <ul className="list-disc pl-4 space-y-0.5">
        {violations.map((v, i) => (
          <li key={`${v.rule}-${i}`} data-testid={`risk-violation-${v.rule}`}>
            {v.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
