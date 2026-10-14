// Chart Focus mode + clean-up rules (visual only). PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE.
// Nothing here changes a signal, score, level price or the database — it only decides what is drawn.

/** How long the extras stay after the mouse leaves the chart. */
export const FOCUS_FADE_MS = 1500;
/** Levels on the same side closer than this × ATR merge into one zone. */
export const MERGE_ATR_MULT = 0.5;
/** Fallback when ATR is unknown: 0.4% of price. */
export const MERGE_PCT_FALLBACK = 0.004;
/** Collapsed MACD / RSI strip height (px). */
export const PANE_MIN_H = 34;

export type MergeableLevel = { price: number; strength: number; touches: number };
export type MergedLevel<T extends MergeableLevel> = T & { low: number; high: number; members: number };

export function mergeTolerance(price: number, atr: number | null | undefined): number {
  return atr != null && isFinite(atr) && atr > 0 ? atr * MERGE_ATR_MULT : Math.abs(price) * MERGE_PCT_FALLBACK;
}

/** Merge same-side levels that sit within `tol` of their neighbour (chain linkage). The strongest member
 *  represents the zone (its price, source, why); touches add up; low/high span every member. */
export function mergeNearbyLevels<T extends MergeableLevel>(levels: T[], tol: number): MergedLevel<T>[] {
  const sorted = [...levels].filter((l) => isFinite(l.price)).sort((a, b) => a.price - b.price);
  const groups: T[][] = [];
  for (const l of sorted) {
    const g = groups[groups.length - 1];
    if (g && l.price - g[g.length - 1].price <= tol) g.push(l); else groups.push([l]);
  }
  return groups.map((g) => {
    const best = g.reduce((a, b) => (b.strength > a.strength || (b.strength === a.strength && b.touches > a.touches) ? b : a));
    return { ...best, low: g[0].price, high: g[g.length - 1].price, members: g.length, touches: g.reduce((s, x) => s + (x.touches || 0), 0) };
  });
}

/** Prior-day / today high-low lines only add information on intraday charts. */
export function dayLevelsApply(tf: string): boolean {
  return !(tf === "D" || tf === "Daily" || tf === "W" || tf === "Weekly" || tf === "1D" || tf === "1W");
}

export type FocusInput = { focus: boolean; revealed: boolean; pinLevels: boolean; highlight: boolean; lockedPlan: boolean; planOn: boolean };
export type FocusView = {
  /** Everything on: bands, all S/R, day levels, full-strength SMAs, legends. */
  full: boolean;
  /** Entry / stop / targets / plan versions / alerts. */
  plan: boolean;
  /** S/R lines to draw when not full: only the nearest each side. */
  nearestOnly: boolean;
  /** SMAs / Bollinger drawn faint. */
  dimIndicators: boolean;
};

/** One decision for every layer so the chart, gutter and legends always agree. ARMED / ACTIVE trades keep
 *  their plan levels visible even in Focus mode. Full mode keeps the original hover behaviour for the plan. */
export function focusView(i: FocusInput): FocusView {
  const full = !i.focus || i.revealed;
  const plan = i.planOn && (i.revealed || i.highlight || i.pinLevels || i.lockedPlan);
  return { full, plan, nearestOnly: !full, dimIndicators: !full };
}

/** Faint version of a hex colour for dimmed indicator lines. */
export function dimColor(hex: string, alpha = 0.32): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Gutter text for a (possibly merged) S/R level. */
export function srLabel(side: "R" | "S", l: { price: number; low: number; high: number; members: number }, dots: string, nearest: boolean): string {
  const name = nearest ? (side === "R" ? "Near res" : "Near sup") : side === "R" ? "Res" : "Sup";
  const px = l.members > 1 && l.high - l.low >= 0.005 ? `${l.low.toFixed(2)}–${l.high.toFixed(2)}` : `$${l.price.toFixed(2)}`;
  return `${name} ${px} ${dots}`.trim();
}
