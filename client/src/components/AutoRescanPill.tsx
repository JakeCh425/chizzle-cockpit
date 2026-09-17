// ─── AutoRescanPill ────────────────────────────────────────────────────
// Compact status pill for the market-hours auto-rescan timer. Shows:
//   AUTO 5min · next 14:02 CT      when running
//   AUTO — market closed            when outside NYSE hours
//   AUTO OFF                        when the operator paused it
// Click the pill to cycle through {5min, 10min, 15min, off}.

import { Clock, PauseCircle } from "lucide-react";
import type { AutoRescanState } from "@/hooks/useAutoRescan";

const CADENCES = [5 * 60_000, 10 * 60_000, 15 * 60_000];

function fmtTimeCt(d: Date): string {
  return d.toLocaleTimeString("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

interface Props {
  state: AutoRescanState;
  onManualRescan?: () => void;
}

export default function AutoRescanPill({ state, onManualRescan }: Props) {
  const { enabled, setEnabled, intervalMs, setIntervalMs, lastRunAt, nextRunAt, marketOpen } = state;

  const cadenceLabel = `${Math.round(intervalMs / 60_000)}m`;

  const cycleCadence = () => {
    if (!enabled) {
      setEnabled(true);
      setIntervalMs(CADENCES[0]);
      return;
    }
    const idx = CADENCES.indexOf(intervalMs);
    if (idx === -1 || idx === CADENCES.length - 1) {
      setEnabled(false);
      return;
    }
    setIntervalMs(CADENCES[idx + 1]);
  };

  const statusText = (() => {
    if (!enabled) return "AUTO OFF";
    if (!marketOpen) return `AUTO ${cadenceLabel} · market closed`;
    if (nextRunAt) return `AUTO ${cadenceLabel} · next ${fmtTimeCt(nextRunAt)} CT`;
    if (lastRunAt) return `AUTO ${cadenceLabel} · last ${fmtTimeCt(lastRunAt)} CT`;
    return `AUTO ${cadenceLabel} · starting…`;
  })();

  const tone = !enabled
    ? "border-ink-line text-slate-gray"
    : !marketOpen
      ? "border-signal-amber/60 text-signal-amber"
      : "border-signal-green/60 text-signal-green";

  return (
    <button
      onClick={cycleCadence}
      className={`text-[11px] font-mono px-2 py-1 rounded border ${tone} hover:bg-ink-panel flex items-center gap-1 whitespace-nowrap`}
      title={
        enabled
          ? `Click to change cadence (5m → 10m → 15m → off). Currently ${cadenceLabel}. ${marketOpen ? "Market is open." : "Market is closed — will resume automatically at 09:30 ET."}`
          : "Auto-rescan is off. Click to turn on at 5-minute cadence."
      }
      data-testid="auto-rescan-pill"
    >
      {enabled ? <Clock className="h-3 w-3" /> : <PauseCircle className="h-3 w-3" />}
      <span>{statusText}</span>
    </button>
  );
}
