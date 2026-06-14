// Phase 5 — compact risk status strip. Shown at the top of pages that
// benefit from at-a-glance governor state (Cockpit, Planner).
//
// Pulls /api/settings, /api/regime, /api/analytics/trades, /api/risk/open-positions
// and assembles a RiskStatus via the shared utilities. All data is
// React-Query cached so multiple mount points don't re-fetch.

import { useQuery } from "@tanstack/react-query";
import type { Settings } from "@shared/schema";
import type { OpenPositionRisk } from "@shared/risk";
import {
  buildRiskStatus,
  fmtPct,
  fmtR,
  fmtUsd,
  type ClosedTradeForExpectancy,
  type ClosedTradeMin,
} from "@/lib/risk";

interface UnifiedTradeRow {
  closedAt: string | null;
  netPnl: number | null;
  rMultiple: number | null;
}

interface RegimePayload {
  effective: { code: "green" | "yellow" | "red"; source: string };
}

export function RiskStatusBar() {
  const { data: settings } = useQuery<Settings>({ queryKey: ["/api/settings"] });
  const { data: regimePayload } = useQuery<RegimePayload>({ queryKey: ["/api/regime"] });
  const { data: closedTrades } = useQuery<UnifiedTradeRow[]>({
    queryKey: ["/api/analytics/trades", null, null],
    queryFn: async () => {
      const r = await fetch("/api/analytics/trades");
      if (!r.ok) throw new Error("failed to load closed trades");
      return r.json();
    },
  });
  const { data: openPositions } = useQuery<OpenPositionRisk[]>({
    queryKey: ["/api/risk/open-positions"],
  });

  if (!settings || !regimePayload) {
    return (
      <div
        className="grid grid-cols-2 md:grid-cols-5 gap-2 p-2 border border-ink-line/60 rounded-sm"
        data-testid="risk-status-bar-loading"
      >
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 bg-ink-line/20 animate-pulse rounded-sm" />
        ))}
      </div>
    );
  }

  const activeRegime = (regimePayload.effective.code.toUpperCase() as
    | "GREEN"
    | "YELLOW"
    | "RED");

  const closedMin: ClosedTradeMin[] = (closedTrades ?? []).map((t) => ({
    closedAt: t.closedAt,
    netPnl: t.netPnl,
  }));
  const closedR: ClosedTradeForExpectancy[] = (closedTrades ?? []).map((t) => ({
    closedAt: t.closedAt,
    rMultiple: t.rMultiple,
  }));

  const status = buildRiskStatus({
    settings,
    activeRegime,
    closedTrades: closedMin,
    closedTradesWithR: closedR,
    openPositions: openPositions ?? [],
  });

  const dailyHit = status.dailyPnl <= -status.rules.maxDailyLossAmount;
  const weeklyHit = status.weeklyPnl <= -status.rules.maxWeeklyLossAmount;
  const ddHit =
    !status.drawdownFallback &&
    status.drawdownPercent >= status.rules.maxDrawdownPercent;
  const openRiskHit = status.openRiskPercent > status.rules.maxOpenRiskPercent;

  return (
    <div
      className="grid grid-cols-2 md:grid-cols-5 gap-2 p-2 border border-ink-line/60 rounded-sm bg-ink-black/40"
      data-testid="risk-status-bar"
    >
      <Cell
        label="Daily P&L"
        value={fmtUsd(status.dailyPnl)}
        sub={`limit −${fmtUsd(status.rules.maxDailyLossAmount)}`}
        tone={dailyHit ? "red" : status.dailyPnl >= 0 ? "green" : "neutral"}
        testid="risk-daily"
      />
      <Cell
        label="Weekly P&L"
        value={fmtUsd(status.weeklyPnl)}
        sub={`limit −${fmtUsd(status.rules.maxWeeklyLossAmount)}`}
        tone={weeklyHit ? "red" : status.weeklyPnl >= 0 ? "green" : "neutral"}
        testid="risk-weekly"
      />
      <Cell
        label="Drawdown"
        value={
          status.drawdownFallback ? "—" : fmtPct(status.drawdownPercent)
        }
        sub={
          status.drawdownFallback
            ? "no positive peak yet"
            : `cap ${fmtPct(status.rules.maxDrawdownPercent)}`
        }
        tone={ddHit ? "red" : "neutral"}
        testid="risk-drawdown"
      />
      <Cell
        label="Open Risk"
        value={fmtPct(status.openRiskPercent, 2)}
        sub={`${fmtUsd(status.openRiskDollars)} · cap ${fmtPct(status.rules.maxOpenRiskPercent)} · ${status.openPositionsCount} pos`}
        tone={openRiskHit ? "red" : "blue"}
        testid="risk-open"
      />
      <Cell
        label="Scale Guidance"
        value={
          status.scaleGuidance.state === "scale_up"
            ? "Scale Up"
            : status.scaleGuidance.state === "scale_down"
              ? "Scale Down"
              : "Hold"
        }
        sub={`${fmtR(status.scaleGuidance.expectancyR)} · n=${status.scaleGuidance.sampleSize}`}
        tone={
          status.scaleGuidance.state === "scale_up"
            ? "green"
            : status.scaleGuidance.state === "scale_down"
              ? "red"
              : "neutral"
        }
        testid="risk-scale"
      />
    </div>
  );
}

function Cell({
  label,
  value,
  sub,
  tone,
  testid,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "red" | "green" | "blue" | "neutral";
  testid: string;
}) {
  const colorClass =
    tone === "red"
      ? "text-signal-red"
      : tone === "green"
        ? "text-signal-green"
        : tone === "blue"
          ? "text-neon-blue"
          : "text-soft-white";
  const borderColor =
    tone === "red"
      ? "hsl(var(--signal-red) / 0.5)"
      : tone === "green"
        ? "hsl(var(--signal-green) / 0.4)"
        : tone === "blue"
          ? "hsl(var(--neon-blue) / 0.4)"
          : "hsl(var(--ink-line) / 0.6)";
  return (
    <div
      className="p-2 border rounded-sm"
      style={{ borderColor }}
      data-testid={testid}
    >
      <div className="text-[9px] uppercase tracking-wider text-slate-gray">
        {label}
      </div>
      <div
        className={`font-mono-num tabular-nums text-[14px] font-semibold ${colorClass}`}
      >
        {value}
      </div>
      <div className="text-[9px] text-slate-gray/80 mt-0.5">{sub}</div>
    </div>
  );
}
