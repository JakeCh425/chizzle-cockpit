import React from "react";

interface ZonePositionBarProps {
  low: number;
  high: number;
  current: number;
  stopLevel?: number | null;
  t1?: number | null;
  t2?: number | null;
  width?: number;
  height?: number;
  showLabels?: boolean;
}

/**
 * Horizontal bar visualizing where `current` price sits within an entry zone
 * defined by [low, high]. Optional markers for stop, T1, T2.
 * Pure-SVG; zero deps.
 */
export default function ZonePositionBar({
  low,
  high,
  current,
  stopLevel,
  t1,
  t2,
  width = 200,
  height = 28,
  showLabels = false,
}: ZonePositionBarProps) {
  if (!isFinite(low) || !isFinite(high) || low === high) {
    return (
      <svg width={width} height={height} role="img" aria-label="zone bar (invalid)">
        <rect x={0} y={height / 2 - 2} width={width} height={4} fill="#334155" rx={2} />
      </svg>
    );
  }

  // Build a span that comfortably contains all relevant levels.
  const candidates = [low, high, current];
  if (stopLevel != null && isFinite(stopLevel)) candidates.push(stopLevel);
  if (t1 != null && isFinite(t1)) candidates.push(t1);
  if (t2 != null && isFinite(t2)) candidates.push(t2);
  const spanLow = Math.min(...candidates);
  const spanHigh = Math.max(...candidates);
  const span = spanHigh - spanLow || 1;
  const padX = 8;
  const innerW = width - padX * 2;

  const xFor = (p: number) => padX + ((p - spanLow) / span) * innerW;

  const zoneX1 = xFor(low);
  const zoneX2 = xFor(high);
  const curX = xFor(current);

  const inZone = current >= Math.min(low, high) && current <= Math.max(low, high);
  const tickColor = inZone ? "#22c55e" : "#f59e0b";

  const barY = height / 2 - 3;
  const barH = 6;

  return (
    <svg width={width} height={height} role="img" aria-label="zone position bar">
      {/* baseline */}
      <rect x={padX} y={barY} width={innerW} height={barH} fill="#1e293b" rx={3} />
      {/* zone band */}
      <rect
        x={Math.min(zoneX1, zoneX2)}
        y={barY}
        width={Math.abs(zoneX2 - zoneX1)}
        height={barH}
        fill="#0ea5e9"
        opacity={0.55}
        rx={3}
      />
      {/* stop marker */}
      {stopLevel != null && isFinite(stopLevel) && (
        <line
          x1={xFor(stopLevel)}
          x2={xFor(stopLevel)}
          y1={barY - 4}
          y2={barY + barH + 4}
          stroke="#ef4444"
          strokeWidth={1.5}
        />
      )}
      {/* T1 marker */}
      {t1 != null && isFinite(t1) && (
        <line
          x1={xFor(t1)}
          x2={xFor(t1)}
          y1={barY - 4}
          y2={barY + barH + 4}
          stroke="#a3e635"
          strokeWidth={1.5}
          strokeDasharray="2 2"
        />
      )}
      {/* T2 marker */}
      {t2 != null && isFinite(t2) && (
        <line
          x1={xFor(t2)}
          x2={xFor(t2)}
          y1={barY - 4}
          y2={barY + barH + 4}
          stroke="#22c55e"
          strokeWidth={1.5}
          strokeDasharray="2 2"
        />
      )}
      {/* current price tick */}
      <polygon
        points={`${curX - 4},${barY - 3} ${curX + 4},${barY - 3} ${curX},${barY + 2}`}
        fill={tickColor}
      />
      <line
        x1={curX}
        x2={curX}
        y1={barY}
        y2={barY + barH}
        stroke={tickColor}
        strokeWidth={2}
      />
      {showLabels && (
        <>
          <text x={padX} y={height - 1} fill="#94a3b8" fontSize={8} textAnchor="start">
            {low.toFixed(2)}
          </text>
          <text x={width - padX} y={height - 1} fill="#94a3b8" fontSize={8} textAnchor="end">
            {high.toFixed(2)}
          </text>
        </>
      )}
    </svg>
  );
}
