// Chart Ecosystem — Part 3: user drawings (shared types, validation, geometry). Pure, no I/O.
// Every point is anchored to PRICE + TIME (unix seconds), so a drawing shows on every timeframe.
// Horizontal lines and rectangle zones also become levels in the Shared Market Context, so tips and
// practice price alerts can use them. Analysis / practice only.
import { z } from "zod";
import type { ContextDrawing } from "./marketContext";

export const DRAWING_TYPES = ["HLINE", "TREND", "RAY", "RECT", "TEXT", "FIB"] as const;
export type DrawingType = typeof DRAWING_TYPES[number];
export const DRAWING_LABEL: Record<DrawingType, string> = { HLINE: "Horizontal line", TREND: "Trend line", RAY: "Ray", RECT: "Rectangle zone", TEXT: "Text note", FIB: "Fibonacci retracement" };
/** Points each type needs. */
export const POINTS_NEEDED: Record<DrawingType, number> = { HLINE: 1, TREND: 2, RAY: 2, RECT: 2, TEXT: 1, FIB: 2 };
export const DRAWING_TFS = ["15m", "30m", "1H", "4H", "D", "W"] as const;
export const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

export interface DrawingPoint { price: number; time: number }
export interface DrawingStyle { width: 1 | 2 | 3; dash: "solid" | "dashed" | "dotted" }
export interface ChartDrawing {
  id: number; symbol: string; type: DrawingType; points: DrawingPoint[];
  color: string; style: DrawingStyle; label: string;
  /** ["ALL"] = every timeframe, otherwise the listed ones. */
  tfVisibility: string[]; locked: boolean;
  createdAt?: string; updatedAt?: string;
}

const point = z.object({ price: z.number().finite().positive().max(1e7), time: z.number().int().min(0).max(4_102_444_800) });
export const drawingInput = z.object({
  symbol: z.string().trim().min(1).max(12).regex(/^[A-Za-z0-9.\-^]+$/).transform((s) => s.toUpperCase()),
  type: z.enum(DRAWING_TYPES),
  points: z.array(point).min(1).max(2),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#38bdf8"),
  style: z.object({ width: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1), dash: z.enum(["solid", "dashed", "dotted"]).default("solid") }).default({ width: 1, dash: "solid" }),
  label: z.string().max(80).default(""),
  tfVisibility: z.array(z.enum(["ALL", ...DRAWING_TFS])).min(1).max(7).default(["ALL"]),
  locked: z.boolean().default(false),
}).superRefine((d, ctx) => {
  if (d.points.length !== POINTS_NEEDED[d.type]) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${DRAWING_LABEL[d.type]} needs ${POINTS_NEEDED[d.type]} point(s)` });
  if (d.type === "TEXT" && !d.label.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A text note needs some text" });
});
export type DrawingInput = z.infer<typeof drawingInput>;
/** Partial update: same rules, every field optional (type is fixed once created). */
export const drawingPatch = z.object({
  points: z.array(point).min(1).max(2).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  style: z.object({ width: z.union([z.literal(1), z.literal(2), z.literal(3)]), dash: z.enum(["solid", "dashed", "dotted"]) }).optional(),
  label: z.string().max(80).optional(),
  tfVisibility: z.array(z.enum(["ALL", ...DRAWING_TFS])).min(1).max(7).optional(),
  locked: z.boolean().optional(),
});

export const visibleOn = (d: Pick<ChartDrawing, "tfVisibility">, tf: string) => d.tfVisibility.includes("ALL") || d.tfVisibility.includes(tf);

/** Fibonacci retracement levels from point A (start) to point B (end): 0 = B, 1 = A (TradingView convention). */
export function fibLevels(a: DrawingPoint, b: DrawingPoint): { ratio: number; price: number }[] {
  return FIB_RATIOS.map((r) => ({ ratio: r, price: Math.round((b.price - (b.price - a.price) * r) * 100) / 100 }));
}

/** Horizontal lines → one level; rectangle zones → low + high. Everything else is visual only. */
export function toContextDrawings(ds: ChartDrawing[]): ContextDrawing[] {
  const out: ContextDrawing[] = [];
  for (const d of ds) {
    if (d.type === "HLINE") out.push({ id: d.id, type: d.type, label: d.label, price: Math.round(d.points[0].price * 100) / 100, priceHigh: null });
    else if (d.type === "RECT" && d.points.length === 2) {
      const lo = Math.min(d.points[0].price, d.points[1].price), hi = Math.max(d.points[0].price, d.points[1].price);
      out.push({ id: d.id, type: d.type, label: d.label, price: Math.round(lo * 100) / 100, priceHigh: Math.round(hi * 100) / 100 });
    }
  }
  return out;
}

// ─── Geometry helpers (screen space; used by the chart layer + its tests) ────
export interface XY { x: number; y: number }
export function distToSegment(p: XY, a: XY, b: XY, ray = false): number {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
  if (L === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L;
  t = ray ? Math.max(0, t) : Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
/** Map a unix time onto a fractional bar index (interpolates between bars and extrapolates past the ends),
 *  so a drawing made on one timeframe lands in the right place on another. */
export function timeToLogical(times: number[], t: number): number | null {
  const n = times.length; if (!n) return null;
  if (n === 1) return 0;
  const step = (times[n - 1] - times[0]) / (n - 1) || 1;
  if (t <= times[0]) return (t - times[0]) / step;
  if (t >= times[n - 1]) return n - 1 + (t - times[n - 1]) / step;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (times[m] <= t) lo = m; else hi = m; }
  const span = times[hi] - times[lo];
  return lo + (span > 0 ? (t - times[lo]) / span : 0);
}
export function logicalToTime(times: number[], l: number): number | null {
  const n = times.length; if (!n) return null;
  if (n === 1) return times[0];
  const step = (times[n - 1] - times[0]) / (n - 1) || 1;
  if (l <= 0) return Math.round(times[0] + l * step);
  if (l >= n - 1) return Math.round(times[n - 1] + (l - (n - 1)) * step);
  const i = Math.floor(l), f = l - i;
  return Math.round(times[i] + (times[i + 1] - times[i]) * f);
}
