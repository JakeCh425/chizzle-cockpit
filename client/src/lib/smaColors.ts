// Single source of truth for moving-average colors across the Cockpit.
//
// Spec (Phase 6): the SAME colors must appear in chart lines, chart legend,
// Technical Snapshot, Trade Plan Workspace, hover tooltips, AI Reflection,
// and scanner explanations. Any panel that references an SMA line should
// import from here — never hardcode.
//
// This module is display-only. It does NOT change scanner calculations,
// setup qualification, or trading rules.

export const SMA_COLORS = {
  /** Electric cyan — short-term swing trend / dynamic support. */
  sma20: "#22d3ee",
  /** Amber/gold — intermediate trend. */
  sma50: "#fbbf24",
  /** Violet/magenta — primary/long-term trend. */
  sma200: "#c084fc",
} as const;

/** Tailwind text classes matching SMA_COLORS. Use when a Tailwind class is
 * required (chip borders, legend dots, inline text). Keep in sync with the
 * hex values above. */
export const SMA_TEXT_CLASSES = {
  sma20: "text-cyan-400",
  sma50: "text-amber-400",
  sma200: "text-violet-400",
} as const;

export const SMA_BORDER_CLASSES = {
  sma20: "border-cyan-400",
  sma50: "border-amber-400",
  sma200: "border-violet-400",
} as const;

export const SMA_BG_CLASSES = {
  sma20: "bg-cyan-400",
  sma50: "bg-amber-400",
  sma200: "bg-violet-400",
} as const;

/** Short educational label per SMA — shown in the hover popover. */
export const SMA_EDU: Record<keyof typeof SMA_COLORS, string> = {
  sma20:
    "Short-term swing trend and dynamic support. Constructive when price holds above; becoming extended when far above.",
  sma50:
    "Intermediate trend. Rising slope with price above is a healthy medium-term structure; a rolling slope warns of momentum loss.",
  sma200:
    "Long-term trend. Price above with rising slope is a bullish primary trend. This level is usually too distant to serve as a practical swing stop.",
};

export const SMA_LABEL: Record<keyof typeof SMA_COLORS, string> = {
  sma20: "SMA 20",
  sma50: "SMA 50",
  sma200: "SMA 200",
};

export type SmaKey = keyof typeof SMA_COLORS;
