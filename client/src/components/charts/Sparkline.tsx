import React from "react";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
  showDot?: boolean;
}

/**
 * Pure-SVG sparkline. Zero dependencies.
 * Renders an auto-scaled polyline over the supplied numeric series.
 * If fill is supplied, also renders an area under the line.
 */
export default function Sparkline({
  data,
  width = 120,
  height = 32,
  stroke = "#22d3ee",
  fill,
  strokeWidth = 1.5,
  showDot = true,
}: SparklineProps) {
  if (!data || data.length === 0) {
    return (
      <svg width={width} height={height} role="img" aria-label="empty sparkline">
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="#334155"
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      </svg>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = data.length > 1 ? width / (data.length - 1) : 0;
  const pad = 2;
  const innerH = height - pad * 2;

  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = pad + innerH - ((v - min) / range) * innerH;
    return [x, y] as const;
  });

  const lineD = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const areaD =
    fill && points.length > 0
      ? `${lineD} L${points[points.length - 1][0].toFixed(2)},${height} L0,${height} Z`
      : null;

  const last = points[points.length - 1];
  const isUp = data[data.length - 1] >= data[0];
  const finalStroke = stroke === "auto" ? (isUp ? "#22c55e" : "#ef4444") : stroke;

  return (
    <svg width={width} height={height} role="img" aria-label="sparkline">
      {areaD && <path d={areaD} fill={fill} opacity={0.25} />}
      <path d={lineD} fill="none" stroke={finalStroke} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
      {showDot && last && (
        <circle cx={last[0]} cy={last[1]} r={2} fill={finalStroke} />
      )}
    </svg>
  );
}
