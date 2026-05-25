import React from "react";

export interface OHLCBar {
  open: number;
  high: number;
  low: number;
  close: number;
  date?: string;
}

interface PriceLevel {
  price: number;
  color?: string;
  label?: string;
  dashed?: boolean;
}

interface CandlestickChartProps {
  bars: OHLCBar[];
  width?: number;
  height?: number;
  levels?: PriceLevel[];
  upColor?: string;
  downColor?: string;
  background?: string;
  padding?: number;
}

/**
 * Minimal pure-SVG OHLC candlestick chart. Zero deps.
 * Auto-scales to data plus any provided horizontal levels (zones / stops / targets).
 */
export default function CandlestickChart({
  bars,
  width = 320,
  height = 140,
  levels = [],
  upColor = "#22c55e",
  downColor = "#ef4444",
  background = "transparent",
  padding = 6,
}: CandlestickChartProps) {
  if (!bars || bars.length === 0) {
    return (
      <svg width={width} height={height} role="img" aria-label="empty candlestick chart">
        <rect x={0} y={0} width={width} height={height} fill={background} />
        <text x={width / 2} y={height / 2} fill="#64748b" fontSize={10} textAnchor="middle">
          no data
        </text>
      </svg>
    );
  }

  const allPrices: number[] = [];
  for (const b of bars) {
    allPrices.push(b.high, b.low);
  }
  for (const l of levels) {
    if (isFinite(l.price)) allPrices.push(l.price);
  }
  const min = Math.min(...allPrices);
  const max = Math.max(...allPrices);
  const range = max - min || 1;

  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  const slot = innerW / bars.length;
  const candleW = Math.max(1, slot * 0.7);

  const yFor = (p: number) => padding + innerH - ((p - min) / range) * innerH;

  return (
    <svg width={width} height={height} role="img" aria-label="candlestick chart">
      <rect x={0} y={0} width={width} height={height} fill={background} />
      {/* horizontal levels */}
      {levels.map((l, i) => {
        if (!isFinite(l.price)) return null;
        const y = yFor(l.price);
        return (
          <g key={`lvl-${i}`}>
            <line
              x1={padding}
              x2={width - padding}
              y1={y}
              y2={y}
              stroke={l.color || "#64748b"}
              strokeWidth={1}
              strokeDasharray={l.dashed === false ? undefined : "3 3"}
              opacity={0.8}
            />
            {l.label && (
              <text x={width - padding - 2} y={y - 2} fill={l.color || "#64748b"} fontSize={9} textAnchor="end">
                {l.label}
              </text>
            )}
          </g>
        );
      })}
      {/* candles */}
      {bars.map((b, i) => {
        const cx = padding + slot * i + slot / 2;
        const yHigh = yFor(b.high);
        const yLow = yFor(b.low);
        const yOpen = yFor(b.open);
        const yClose = yFor(b.close);
        const isUp = b.close >= b.open;
        const color = isUp ? upColor : downColor;
        const bodyY = Math.min(yOpen, yClose);
        const bodyH = Math.max(1, Math.abs(yClose - yOpen));
        return (
          <g key={`bar-${i}`}>
            <line x1={cx} x2={cx} y1={yHigh} y2={yLow} stroke={color} strokeWidth={1} />
            <rect
              x={cx - candleW / 2}
              y={bodyY}
              width={candleW}
              height={bodyH}
              fill={color}
              opacity={isUp ? 0.9 : 0.95}
            />
          </g>
        );
      })}
    </svg>
  );
}
