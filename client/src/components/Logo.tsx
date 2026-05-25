// Chizzle Wealth Engine — geometric mark.
// A stylized "C" rendered as a candlestick / compass needle:
// three ascending bars forming a quarter-arc, anchored on a baseline tick.
export function Logo({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      aria-label="Chizzle Wealth Engine"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      role="img"
    >
      {/* Baseline */}
      <line x1="4" y1="27" x2="28" y2="27" stroke="currentColor" strokeWidth="1.25" />
      {/* Three ascending bars */}
      <rect x="7" y="20" width="3.5" height="7" stroke="currentColor" strokeWidth="1.25" />
      <rect x="14.25" y="14" width="3.5" height="13" stroke="currentColor" strokeWidth="1.25" />
      <rect x="21.5" y="6" width="3.5" height="21" stroke="currentColor" strokeWidth="1.25" />
      {/* Wick on tallest bar */}
      <line x1="23.25" y1="2" x2="23.25" y2="6" stroke="currentColor" strokeWidth="1.25" />
      {/* Top crosshair tick — compass needle accent */}
      <line x1="21" y1="2" x2="25.5" y2="2" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

export function LogoFavicon() {
  return Logo({ size: 32 });
}
