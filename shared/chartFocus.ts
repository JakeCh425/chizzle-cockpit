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

// ─── Day levels (HOD/LOD, PDH/PDL): bounded rays, chip text, gutter de-collision ─────────────
export const INTRADAY_TFS = ["15m", "30m", "1H", "4H"] as const;
export const isIntradayTf = (tf: string) => (INTRADAY_TFS as readonly string[]).includes(tf);
/** Daily / Weekly brackets cover only the last few candles toward the price scale (3–5 allowed). */
export const BRACKET_BARS = 4;
export const GUTTER_MIN_GAP = 18;
export const DAY_TOUCH_ATR = 0.25;

export type DayRay = { fromIdx: number; toIdx: number; bounded: "SESSION" | "BRACKET" };
/** Where a day-level line may be drawn. Intraday: the active session only. Daily/Weekly: a short
 *  right-anchored bracket over the last BRACKET_BARS candles — never a full-width historical line. */
export function dayRaySpan(tf: string, times: number[], sessionDate: string | null, ymdOf: (t: number) => string): DayRay | null {
  const n = times.length;
  if (!n) return null;
  if (!isIntradayTf(tf)) return { fromIdx: Math.max(0, n - BRACKET_BARS), toIdx: n - 1, bounded: "BRACKET" };
  let i = sessionDate ? times.findIndex((t) => ymdOf(t) === sessionDate) : -1;
  if (i < 0) i = n - 1; // session not on screen yet → a stub at the last bar, never back into prior days
  return { fromIdx: i, toIdx: n - 1, bounded: "SESSION" };
}

export type DayChipKind = "hodlod" | "pdhpdl" | "pre";
const $2 = (n: number) => `$${n.toFixed(2)}`;
/** Toolbar chip text: muted name when off, the actual prices when on, "loading…" while the context loads. */
export function dayChipText(kind: DayChipKind, on: boolean, day: { hod: number | null; lod: number | null; pdh: number | null; pdl: number | null; premarket?: { high: number; low: number } | null } | null, loading: boolean): string {
  const name = kind === "hodlod" ? "HOD/LOD" : kind === "pdhpdl" ? "PDH/PDL" : "Pre-market";
  if (!on) return `-- ${name}`;
  if (!day) return loading ? `${name} loading…` : `${name} —`;
  if (kind === "hodlod") return day.hod != null && day.lod != null ? `HOD ${$2(day.hod)} · LOD ${$2(day.lod)}` : `${name} —`;
  if (kind === "pdhpdl") return day.pdh != null && day.pdl != null ? `PDH ${$2(day.pdh)} · PDL ${$2(day.pdl)}` : `${name} —`;
  return day.premarket ? `PM high ${$2(day.premarket.high)} · PM low ${$2(day.premarket.low)}` : "no pre-market bars";
}

/** True when `price` sits within 0.25 ATR of any of `others`. */
export function touchesAny(price: number, others: number[], atr: number | null | undefined): boolean {
  const tol = (atr != null && atr > 0 ? atr : Math.abs(price) * 0.004) * DAY_TOUCH_ATR;
  return others.some((o) => Math.abs(o - price) <= tol);
}
/** S/R band opacity while a day range is active: background bands that don't touch a day level drop to 20 %. */
export function srBandAlpha(base: number, o: { dayFocus: boolean; touching: boolean }): number {
  return o.dayFocus && !o.touching ? base * 0.2 : base;
}

export type GutterItem = { price: number; y: number; kind: "plan" | "day" | "sr" | "user"; dayHigh?: boolean };
/** Stack gutter labels with ≥ GUTTER_MIN_GAP px between them. When a day level sits within 0.25 ATR of
 *  another label, the day high goes above it and the day low below it (clean, predictable offset).
 *  Returns label centre positions in the input order. */
export function layoutGutter(items: GutterItem[], o: { H: number; atr?: number | null; minGap?: number; bottomPad?: number }): number[] {
  const gap = o.minGap ?? GUTTER_MIN_GAP, lo = gap / 2 + 2, hi = o.H - (o.bottomPad ?? 26) - gap / 2;
  const idx = items.map((_, i) => i);
  const near = (a: GutterItem, b: GutterItem) => touchesAny(a.price, [b.price], o.atr);
  idx.sort((i, j) => {
    const a = items[i], b = items[j];
    if ((a.kind === "day") !== (b.kind === "day") && near(a, b)) {
      const d = a.kind === "day" ? a : b, aIsDay = a.kind === "day";
      return d.dayHigh ? (aIsDay ? -1 : 1) : (aIsDay ? 1 : -1);
    }
    return a.y - b.y;
  });
  const pos = idx.map((i) => Math.min(Math.max(items[i].y, lo), hi));
  for (let k = 1; k < pos.length; k++) if (pos[k] - pos[k - 1] < gap) pos[k] = pos[k - 1] + gap;
  const over = pos.length ? pos[pos.length - 1] - hi : 0;
  if (over > 0) for (let k = pos.length - 1; k >= 0; k--) { pos[k] -= over; if (k && pos[k] - pos[k - 1] >= gap) break; }
  for (let k = pos.length - 2; k >= 0; k--) if (pos[k + 1] - pos[k] < gap) pos[k] = pos[k + 1] - gap;
  const out: number[] = new Array(items.length);
  idx.forEach((i, k) => { out[i] = pos[k]; });
  return out;
}
