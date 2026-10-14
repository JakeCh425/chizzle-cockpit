// Chart Ecosystem — Parts 2 & 3 (client): day-level chips, indicator settings + "Indicators +" menu,
// and the drawing layer (a custom lightweight-charts series primitive — the chart library is unchanged).
// Every number on screen still comes from the Shared Market Context when it matches the bars on screen;
// 15m/30m (no context timeframe) fall back to the SAME shared formulas, labelled "local".
// Analysis / practice only — nothing here places, routes or suggests an order.
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { IChartApi, ISeriesApi, ISeriesPrimitive, Logical, SeriesAttachedParameter, Time } from "lightweight-charts";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { swingGet, swingSend } from "@/lib/swing";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { openAlertDialog } from "@/lib/alerts";
import { DEFAULT_INDICATORS, type IndicatorParams } from "@shared/marketContext";
import {
  DRAWING_LABEL, POINTS_NEEDED, distToSegment, fibLevels, logicalToTime, timeToLogical, visibleOn,
  type ChartDrawing, type DrawingPoint, type DrawingType,
} from "@shared/chartDrawings";
import {
  MousePointer2, Minus, TrendingUp, ArrowUpRight, Square, Type, Percent, Undo2, Redo2, Trash2, Lock, Unlock, Eye, EyeOff, Bell, X, RotateCcw,
} from "lucide-react";

// ─── Part 2: day-level chips ────────────────────────────────────────────────
export type DayOv = { hodlod: boolean; pdhpdl: boolean; pre: boolean };
export const DAY_DEFAULT: DayOv = { hodlod: true, pdhpdl: true, pre: false };
export const DAY_COLORS = { HOD: "#f59e0b", LOD: "#f59e0b", PDH: "#7dd3fc", PDL: "#7dd3fc", PMH: "#94a3b8", PML: "#94a3b8" } as const;
export function useDayOverlays() {
  const [v, set] = usePersistentState<DayOv>("swing-chart-daylevels", DAY_DEFAULT);
  const ov = { ...DAY_DEFAULT, ...v };
  return [ov, (p: Partial<DayOv>) => set({ ...ov, ...p })] as const;
}

// ─── Part 3: indicator settings (per timeframe; localStorage + /api/ui-prefs) ──
export interface IndSettings {
  macd: { on: boolean; fast: number; slow: number; signal: number; cMacd: string; cSignal: string; cUp: string; cDown: string };
  bb: { n: number; k: number; color: string };
  rsi: { on: boolean; n: number; color: string };
  vwap: { on: boolean; color: string };
  atr: { on: boolean; n: number };
  sr: { on: boolean; style: "clear" | "minimal"; count: number };
}
export const IND_DEFAULT: IndSettings = {
  macd: { on: false, fast: 12, slow: 26, signal: 9, cMacd: "#38bdf8", cSignal: "#f97316", cUp: "#22c55e", cDown: "#ef4444" },
  bb: { n: 20, k: 2, color: "#64748b" },
  rsi: { on: false, n: 14, color: "#c084fc" },
  vwap: { on: false, color: "#eab308" },
  atr: { on: true, n: 14 },
  sr: { on: true, style: "clear", count: 3 },
};
const mergeInd = (s: Partial<IndSettings> | undefined): IndSettings => {
  const o: any = { ...IND_DEFAULT };
  for (const k of Object.keys(IND_DEFAULT) as (keyof IndSettings)[]) o[k] = { ...IND_DEFAULT[k], ...((s as any)?.[k] ?? {}) };
  return o;
};
/** Params for the context request — undefined while everything is default (so the URL never changes). */
export function paramsFor(s: IndSettings): IndicatorParams | undefined {
  const d = DEFAULT_INDICATORS;
  const p: IndicatorParams = { ...d, bb: { n: s.bb.n, k: s.bb.k }, macd: { fast: s.macd.fast, slow: s.macd.slow, signal: s.macd.signal }, rsi: s.rsi.n, atr: s.atr.n };
  const same = p.bb.n === d.bb.n && p.bb.k === d.bb.k && p.macd.fast === d.macd.fast && p.macd.slow === d.macd.slow && p.macd.signal === d.macd.signal && p.rsi === d.rsi && p.atr === d.atr;
  return same ? undefined : p;
}
type UiPrefs = { id: number; data: Record<string, any> };
export function useIndicatorSettings(tf: string) {
  const [local, setLocal] = usePersistentState<Record<string, Partial<IndSettings>>>("chart-indicators", {});
  const prefs = useQuery<UiPrefs>({ queryKey: ["/api/ui-prefs"], queryFn: async () => (await (await apiRequest("GET", "/api/ui-prefs")).json()) as UiPrefs, staleTime: 60_000 });
  const server = prefs.data?.data?.chartIndicators?.[tf] as Partial<IndSettings> | undefined;
  // Server copy wins once loaded (synced across devices); localStorage keeps it instant on reload.
  const s = useMemo(() => mergeInd(local[tf] ?? server), [JSON.stringify(local[tf] ?? null), JSON.stringify(server ?? null)]);
  const sync = useMutation({
    mutationFn: async (v: IndSettings) => (await apiRequest("PATCH", "/api/ui-prefs", { data: { chartIndicators: { [tf]: v } } })).json(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["/api/ui-prefs"] }),
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const set = (next: IndSettings) => {
    setLocal((m) => ({ ...m, [tf]: next }));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => sync.mutate(next), 600);
  };
  return [s, set] as const;
}

const num = (v: string, lo: number, hi: number, def: number, step = 1) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? (step < 1 ? Math.round(n * 100) / 100 : Math.round(n)) : def; };

export function IndicatorsMenu({ s, set, bbOn, onBb, intraday, onClose }: { s: IndSettings; set: (v: IndSettings) => void; bbOn: boolean; onBb: (v: boolean) => void; intraday: boolean; onClose: () => void }) {
  const row = "flex flex-wrap items-center gap-1.5 py-1.5 border-b border-[#1e293b] last:border-0";
  const inp = "w-12 rounded border border-[#1e293b] bg-[#050a13] px-1 py-0.5 text-[11px] font-mono text-[#f1f5f9]";
  const col = "h-5 w-6 rounded border border-[#1e293b] bg-transparent p-0";
  const tog = (on: boolean, f: () => void, id: string, label: string) => (
    <button className={`px-1.5 py-0.5 rounded border text-[10.5px] font-mono ${on ? "border-neon-blue text-[#f1f5f9] bg-neon-blue/10" : "border-[#1e293b] text-[#94a3b8]"}`} onClick={f} aria-pressed={on} data-testid={`toggle-ind-${id}`}>{on ? "On" : "Off"} · {label}</button>
  );
  const reset = (k: keyof IndSettings) => <button className="ml-auto text-[10px] text-[#94a3b8] hover:text-[#f1f5f9] inline-flex items-center gap-0.5" onClick={() => set({ ...s, [k]: { ...IND_DEFAULT[k], ...("on" in s[k] ? { on: (s[k] as any).on } : {}) } })} data-testid={`button-reset-${k}`}><RotateCcw className="h-3 w-3" aria-hidden /> Reset</button>;
  const L = ({ t }: { t: string }) => <span className="text-[10px] text-[#94a3b8] font-mono">{t}</span>;
  return (
    <div className="absolute z-30 mt-1 w-[360px] max-w-[92vw] rounded border border-[#1e293b] bg-[#0b1220] p-2 shadow-xl text-[11px]" role="dialog" aria-label="Indicators" data-testid="menu-indicators">
      <div className="flex items-center justify-between pb-1 border-b border-[#1e293b]">
        <span className="font-mono font-bold text-[#f1f5f9]">Indicators · saved for this timeframe</span>
        <button onClick={onClose} aria-label="Close indicators" data-testid="button-close-indicators"><X className="h-3.5 w-3.5 text-[#94a3b8]" /></button>
      </div>
      <div className={row} data-testid="ind-row-macd">
        {tog(s.macd.on, () => set({ ...s, macd: { ...s.macd, on: !s.macd.on } }), "macd", "MACD")}
        <L t="fast" /><input className={inp} type="number" value={s.macd.fast} onChange={(e) => set({ ...s, macd: { ...s.macd, fast: num(e.target.value, 2, 100, s.macd.fast) } })} aria-label="MACD fast" data-testid="input-macd-fast" />
        <L t="slow" /><input className={inp} type="number" value={s.macd.slow} onChange={(e) => set({ ...s, macd: { ...s.macd, slow: num(e.target.value, 3, 200, s.macd.slow) } })} aria-label="MACD slow" data-testid="input-macd-slow" />
        <L t="sig" /><input className={inp} type="number" value={s.macd.signal} onChange={(e) => set({ ...s, macd: { ...s.macd, signal: num(e.target.value, 2, 100, s.macd.signal) } })} aria-label="MACD signal" data-testid="input-macd-signal" />
        <input className={col} type="color" value={s.macd.cMacd} onChange={(e) => set({ ...s, macd: { ...s.macd, cMacd: e.target.value } })} aria-label="MACD line color" />
        <input className={col} type="color" value={s.macd.cSignal} onChange={(e) => set({ ...s, macd: { ...s.macd, cSignal: e.target.value } })} aria-label="Signal line color" />
        {reset("macd")}
      </div>
      <div className={row} data-testid="ind-row-bb">
        {tog(bbOn, () => onBb(!bbOn), "bb", "Bollinger")}
        <L t="n" /><input className={inp} type="number" value={s.bb.n} onChange={(e) => set({ ...s, bb: { ...s.bb, n: num(e.target.value, 2, 200, s.bb.n) } })} aria-label="Bollinger period" data-testid="input-bb-n" />
        <L t="σ" /><input className={inp} type="number" step="0.1" value={s.bb.k} onChange={(e) => set({ ...s, bb: { ...s.bb, k: num(e.target.value, 0.5, 5, s.bb.k, 0.1) } })} aria-label="Bollinger deviations" data-testid="input-bb-k" />
        <input className={col} type="color" value={s.bb.color} onChange={(e) => set({ ...s, bb: { ...s.bb, color: e.target.value } })} aria-label="Bollinger color" />
        {reset("bb")}
      </div>
      <div className={row} data-testid="ind-row-rsi">
        {tog(s.rsi.on, () => set({ ...s, rsi: { ...s.rsi, on: !s.rsi.on } }), "rsi", "RSI")}
        <L t="n" /><input className={inp} type="number" value={s.rsi.n} onChange={(e) => set({ ...s, rsi: { ...s.rsi, n: num(e.target.value, 2, 100, s.rsi.n) } })} aria-label="RSI period" data-testid="input-rsi-n" />
        <input className={col} type="color" value={s.rsi.color} onChange={(e) => set({ ...s, rsi: { ...s.rsi, color: e.target.value } })} aria-label="RSI color" />
        <span className="text-[10px] text-[#94a3b8]">70 / 30 guides</span>
        {reset("rsi")}
      </div>
      <div className={row} data-testid="ind-row-vwap">
        {tog(s.vwap.on, () => set({ ...s, vwap: { ...s.vwap, on: !s.vwap.on } }), "vwap", "VWAP")}
        <input className={col} type="color" value={s.vwap.color} onChange={(e) => set({ ...s, vwap: { ...s.vwap, color: e.target.value } })} aria-label="VWAP color" />
        <span className="text-[10px] text-[#94a3b8]">{intraday ? "Session VWAP, resets each day" : "Intraday timeframes only"}</span>
        {reset("vwap")}
      </div>
      <div className={row} data-testid="ind-row-atr">
        {tog(s.atr.on, () => set({ ...s, atr: { ...s.atr, on: !s.atr.on } }), "atr", "ATR readout")}
        <L t="n" /><input className={inp} type="number" value={s.atr.n} onChange={(e) => set({ ...s, atr: { ...s.atr, n: num(e.target.value, 2, 100, s.atr.n) } })} aria-label="ATR period" data-testid="input-atr-n" />
        {reset("atr")}
      </div>
      <div className={row} data-testid="ind-row-sr">
        {tog(s.sr.on, () => set({ ...s, sr: { ...s.sr, on: !s.sr.on } }), "sr", "Auto S/R")}
        <L t="style" /><select className={inp + " !w-auto"} value={s.sr.style} onChange={(e) => set({ ...s, sr: { ...s.sr, style: e.target.value === "minimal" ? "minimal" : "clear" } })} aria-label="Support and resistance style" data-testid="select-sr-style">
          <option value="clear">Clear bands</option><option value="minimal">Minimal lines</option>
        </select>
        <L t="per side" /><select className={inp + " !w-auto"} value={s.sr.count} onChange={(e) => set({ ...s, sr: { ...s.sr, count: num(e.target.value, 1, 3, s.sr.count) } })} aria-label="Levels per side" data-testid="select-sr-count">
          {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {reset("sr")}
        <span className="basis-full text-[10px] text-[#94a3b8]">Nearest levels above / below from pivots, PDH/PDL and your lines. Darker band = stronger level (more touches, more recent).</span>
      </div>
      <p className="pt-1 text-[10px] text-[#94a3b8]">Visual analysis only. Changing a period never changes the engine's decision.</p>
    </div>
  );
}

// ─── Part 3: drawings API + undo/redo ───────────────────────────────────────
type DrawResp = { enabled: boolean; ready: boolean; drawings: ChartDrawing[] };
type NewDrawing = Omit<ChartDrawing, "id" | "createdAt" | "updatedAt">;
type Op = { kind: "create"; d: ChartDrawing } | { kind: "delete"; d: ChartDrawing } | { kind: "update"; id: number; before: Partial<ChartDrawing>; after: Partial<ChartDrawing> };
const patchOf = (d: Partial<ChartDrawing>) => { const { points, color, style, label, tfVisibility, locked } = d; return Object.fromEntries(Object.entries({ points, color, style, label, tfVisibility, locked }).filter(([, v]) => v !== undefined)); };

export function useDrawings(symbol: string | undefined, enabled: boolean) {
  const sym = (symbol ?? "").toUpperCase();
  const q = useQuery<DrawResp>({
    queryKey: ["/api/swing/drawings", sym], enabled: !!sym && enabled, staleTime: 30_000, retry: 0,
    queryFn: async () => { try { return await swingGet<DrawResp>(`/api/swing/drawings/${sym}`); } catch { return { enabled: false, ready: false, drawings: [] }; } },
  });
  const undo = useRef<Op[]>([]), redo = useRef<Op[]>([]);
  const [, bump] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ["/api/swing/drawings", sym] }); void queryClient.invalidateQueries({ queryKey: ["/api/swing/context", sym] }); bump((x) => x + 1); };
  const remap = (from: number, to: number) => { for (const st of [undo.current, redo.current]) for (const o of st) { if (o.kind === "update" && o.id === from) o.id = to; else if (o.kind !== "update" && o.d.id === from) o.d = { ...o.d, id: to }; } };
  const run = async <T,>(f: () => Promise<T>) => { try { setErr(null); return await f(); } catch (e: any) { setErr(e?.message ?? "Drawing could not be saved"); return null; } finally { refresh(); } };
  const apiCreate = (d: NewDrawing) => swingSend<{ drawing: ChartDrawing }>("POST", "/api/swing/drawings", { ...d, symbol: sym }).then((r) => r.drawing);
  const apiUpdate = (id: number, p: Partial<ChartDrawing>) => swingSend<{ drawing: ChartDrawing }>("PUT", `/api/swing/drawings/${id}`, patchOf(p)).then((r) => r.drawing);
  const apiDelete = (id: number) => swingSend("DELETE", `/api/swing/drawings/${id}`);
  // Optimistic local cache so a drag feels instant.
  const setLocal = (f: (ds: ChartDrawing[]) => ChartDrawing[]) => queryClient.setQueryData<DrawResp>(["/api/swing/drawings", sym], (r) => r ? { ...r, drawings: f(r.drawings) } : r);
  return {
    list: q.data?.drawings ?? [], enabled: q.data?.enabled ?? false, ready: q.data?.ready ?? false, loading: q.isLoading, err,
    canUndo: undo.current.length > 0, canRedo: redo.current.length > 0,
    create: (d: NewDrawing) => run(async () => { const c = await apiCreate(d); undo.current.push({ kind: "create", d: c }); redo.current = []; return c; }),
    update: (id: number, before: Partial<ChartDrawing>, after: Partial<ChartDrawing>) => run(async () => {
      setLocal((ds) => ds.map((x) => (x.id === id ? { ...x, ...after } : x)));
      const u = await apiUpdate(id, after); undo.current.push({ kind: "update", id, before, after }); redo.current = []; return u;
    }),
    remove: (d: ChartDrawing) => run(async () => { setLocal((ds) => ds.filter((x) => x.id !== d.id)); await apiDelete(d.id); undo.current.push({ kind: "delete", d }); redo.current = []; return true; }),
    undo: () => run(async () => {
      const o = undo.current.pop(); if (!o) return;
      if (o.kind === "create") await apiDelete(o.d.id);
      else if (o.kind === "delete") { const c = await apiCreate(o.d); remap(o.d.id, c.id); o.d = c; }
      else await apiUpdate(o.id, o.before);
      redo.current.push(o);
    }),
    redo: () => run(async () => {
      const o = redo.current.pop(); if (!o) return;
      if (o.kind === "create") { const c = await apiCreate(o.d); remap(o.d.id, c.id); o.d = c; }
      else if (o.kind === "delete") await apiDelete(o.d.id);
      else await apiUpdate(o.id, o.after);
      undo.current.push(o);
    }),
  };
}

// ─── Part 3: drawing layer (series primitive) ───────────────────────────────
export type Tool = "select" | DrawingType;
const dash = (st: ChartDrawing["style"] | undefined) => (st?.dash === "dashed" ? [6, 4] : st?.dash === "dotted" ? [2, 3] : []);
const hexA = (hex: string, a: number) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };

export class DrawingPrimitive implements ISeriesPrimitive<Time> {
  chart: IChartApi | null = null; series: ISeriesApi<any> | null = null; req: (() => void) | null = null;
  drawings: ChartDrawing[] = []; preview: { type: DrawingType; points: DrawingPoint[]; color: string } | null = null;
  selected: number | null = null; hidden = false; times: number[] = [];
  attached(p: SeriesAttachedParameter<Time>) { this.chart = p.chart as IChartApi; this.series = p.series as ISeriesApi<any>; this.req = p.requestUpdate; }
  detached() { this.chart = null; this.series = null; this.req = null; }
  update() { try { this.req?.(); } catch { /* chart disposed */ } }
  xOf(t: number) { const l = timeToLogical(this.times, t); return l == null || !this.chart ? null : this.chart.timeScale().logicalToCoordinate(l as Logical); }
  yOf(p: number) { return this.series?.priceToCoordinate(p) ?? null; }
  pointAt(x: number, y: number): DrawingPoint | null {
    if (!this.chart || !this.series) return null;
    const l = this.chart.timeScale().coordinateToLogical(x), price = this.series.coordinateToPrice(y);
    const time = l == null ? null : logicalToTime(this.times, l as number);
    return time == null || price == null ? null : { price: Math.round(Number(price) * 100) / 100, time };
  }
  updateAllViews() {}
  paneViews() {
    return [{ zOrder: () => "top" as const, renderer: () => ({ draw: (target: any) => target.useMediaCoordinateSpace(({ context, mediaSize }: any) => this.drawAll(context, mediaSize.width, mediaSize.height)) }) }];
  }
  private drawOne(ctx: CanvasRenderingContext2D, W: number, d: { id?: number; type: DrawingType; points: DrawingPoint[]; color: string; style?: ChartDrawing["style"]; label?: string }, sel: boolean) {
    const pts = d.points.map((p) => ({ x: this.xOf(p.time), y: this.yOf(p.price), p })).filter((q) => q.x != null && q.y != null) as { x: number; y: number; p: DrawingPoint }[];
    if (pts.length < Math.min(d.points.length, POINTS_NEEDED[d.type])) { if (d.type !== "HLINE") return; }
    ctx.save(); ctx.strokeStyle = d.color; ctx.fillStyle = d.color; ctx.lineWidth = (d.style?.width ?? 1) + (sel ? 1 : 0); ctx.setLineDash(dash(d.style));
    ctx.font = "600 10px ui-monospace, monospace";
    const label = (txt: string, x: number, y: number) => { if (!txt) return; const w = ctx.measureText(txt).width + 8; ctx.save(); ctx.setLineDash([]); ctx.fillStyle = "#050a13"; ctx.fillRect(x, y - 13, w, 14); ctx.fillStyle = d.color; ctx.fillText(txt, x + 4, y - 3); ctx.restore(); };
    const [a, b] = pts;
    switch (d.type) {
      case "HLINE": { const y = this.yOf(d.points[0].price); if (y == null) break; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); label(`${d.label ? d.label + " " : ""}${d.points[0].price.toFixed(2)}`, 6, y); break; }
      case "TREND": if (a && b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); if (d.label) label(d.label, b.x + 4, b.y); } break;
      case "RAY": if (a && b) { const dx = b.x - a.x, dy = b.y - a.y, k = dx !== 0 ? Math.max(1, (W - a.x) / dx) : 1; const ex = dx >= 0 ? a.x + dx * k : b.x, ey = dx >= 0 ? a.y + dy * k : b.y; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(ex, ey); ctx.stroke(); if (d.label) label(d.label, b.x + 4, b.y); } break;
      case "RECT": if (a && b) { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y); ctx.fillStyle = hexA(d.color, 0.14); ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h); label(d.label || `${Math.min(a.p.price, b.p.price).toFixed(2)}–${Math.max(a.p.price, b.p.price).toFixed(2)}`, x + 2, y); } break;
      case "TEXT": if (a) { ctx.setLineDash([]); const t = d.label || "Note"; const w = ctx.measureText(t).width + 10; ctx.fillStyle = hexA(d.color, 0.2); ctx.fillRect(a.x, a.y - 16, w, 18); ctx.strokeRect(a.x, a.y - 16, w, 18); ctx.fillStyle = "#f1f5f9"; ctx.fillText(t, a.x + 5, a.y - 4); } break;
      case "FIB": if (a && b) {
        const x1 = Math.min(a.x, b.x), x2 = Math.max(W - 60, Math.max(a.x, b.x));
        ctx.setLineDash([]); ctx.lineWidth = 1;
        for (const f of fibLevels(a.p, b.p)) { const y = this.yOf(f.price); if (y == null) continue; ctx.globalAlpha = f.ratio === 0 || f.ratio === 1 ? 1 : 0.75; ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke(); ctx.globalAlpha = 1; label(`${f.ratio} (${f.price.toFixed(2)})`, x1 + 2, y); }
        ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      } break;
    }
    if (sel) { ctx.setLineDash([]); ctx.fillStyle = "#f1f5f9"; for (const q of pts) ctx.fillRect(q.x - 4, q.y - 4, 8, 8); }
    ctx.restore();
  }
  drawAll(ctx: CanvasRenderingContext2D, W: number, _H: number) {
    if (!this.hidden) for (const d of this.drawings) this.drawOne(ctx, W, d, d.id === this.selected);
    if (this.preview) this.drawOne(ctx, W, { ...this.preview, style: { width: 1, dash: "dashed" } }, false);
  }
  /** Hit test in pane pixels → drawing id + handle index (if a point handle was grabbed). */
  hit(x: number, y: number): { id: number; handle: number | null } | null {
    if (this.hidden) return null;
    const P = { x, y }, TOL = 6;
    for (const d of [...this.drawings].reverse()) {
      const pts = d.points.map((p) => ({ x: this.xOf(p.time), y: this.yOf(p.price) }));
      const ok = pts.every((q) => q.x != null && q.y != null) ? (pts as { x: number; y: number }[]) : null;
      if (ok) for (let i = 0; i < ok.length; i++) if (Math.hypot(ok[i].x - x, ok[i].y - y) <= TOL + 2 && d.type !== "HLINE") return { id: d.id, handle: i };
      switch (d.type) {
        case "HLINE": { const yy = this.yOf(d.points[0].price); if (yy != null && Math.abs(yy - y) <= TOL) return { id: d.id, handle: null }; break; }
        case "TREND": if (ok && distToSegment(P, ok[0], ok[1]) <= TOL) return { id: d.id, handle: null }; break;
        case "RAY": if (ok && distToSegment(P, ok[0], ok[1], true) <= TOL) return { id: d.id, handle: null }; break;
        case "RECT": if (ok) { const x1 = Math.min(ok[0].x, ok[1].x) - TOL, x2 = Math.max(ok[0].x, ok[1].x) + TOL, y1 = Math.min(ok[0].y, ok[1].y) - TOL, y2 = Math.max(ok[0].y, ok[1].y) + TOL; if (x >= x1 && x <= x2 && y >= y1 && y <= y2) return { id: d.id, handle: null }; } break;
        case "TEXT": if (ok && x >= ok[0].x - 2 && x <= ok[0].x + 140 && y >= ok[0].y - 18 && y <= ok[0].y + 4) return { id: d.id, handle: null }; break;
        case "FIB": if (ok) { const x1 = Math.min(ok[0].x, ok[1].x); for (const f of fibLevels(d.points[0], d.points[1])) { const yy = this.yOf(f.price); if (yy != null && Math.abs(yy - y) <= TOL && x >= x1 - TOL) return { id: d.id, handle: null }; } } break;
      }
    }
    return null;
  }
}

const TOOLS: { id: Tool; label: string; Icon: typeof Minus }[] = [
  { id: "select", label: "Select / move", Icon: MousePointer2 }, { id: "HLINE", label: DRAWING_LABEL.HLINE, Icon: Minus },
  { id: "TREND", label: DRAWING_LABEL.TREND, Icon: TrendingUp }, { id: "RAY", label: DRAWING_LABEL.RAY, Icon: ArrowUpRight },
  { id: "RECT", label: DRAWING_LABEL.RECT, Icon: Square }, { id: "TEXT", label: DRAWING_LABEL.TEXT, Icon: Type }, { id: "FIB", label: DRAWING_LABEL.FIB, Icon: Percent },
];
export const TOOLBAR_W = 34;
export function DrawingToolbar({ tool, setTool, api, selected, hidden, setHidden, onDelete, onLock }: {
  tool: Tool; setTool: (t: Tool) => void; api: ReturnType<typeof useDrawings>; selected: ChartDrawing | null; hidden: boolean; setHidden: (v: boolean) => void; onDelete: () => void; onLock: () => void;
}) {
  const b = (on: boolean, dis = false) => `w-7 h-7 rounded flex items-center justify-center border ${on ? "border-neon-blue bg-neon-blue/15 text-[#f1f5f9]" : "border-transparent text-[#94a3b8] hover:text-[#f1f5f9] hover:border-[#1e293b]"} ${dis ? "opacity-35 pointer-events-none" : ""}`;
  return (
    <div className="absolute inset-y-0 left-0 z-20 flex flex-col items-center gap-0.5 py-1 border-r border-[#1e293b] bg-[#050a13]" style={{ width: TOOLBAR_W }} role="toolbar" aria-label="Drawing tools" aria-orientation="vertical" data-testid="toolbar-drawings">
      {TOOLS.map((t) => <button key={t.id} className={b(tool === t.id, !api.ready && t.id !== "select")} onClick={() => setTool(t.id)} title={t.label} aria-label={t.label} aria-pressed={tool === t.id} data-testid={`tool-${t.id}`}><t.Icon className="h-3.5 w-3.5" aria-hidden /></button>)}
      <span className="w-5 h-px bg-ink-line my-0.5" />
      <button className={b(false, !api.canUndo)} onClick={() => api.undo()} title="Undo" aria-label="Undo" data-testid="tool-undo"><Undo2 className="h-3.5 w-3.5" aria-hidden /></button>
      <button className={b(false, !api.canRedo)} onClick={() => api.redo()} title="Redo" aria-label="Redo" data-testid="tool-redo"><Redo2 className="h-3.5 w-3.5" aria-hidden /></button>
      <button className={b(false, !selected || !!selected.locked)} onClick={onDelete} title="Delete selected" aria-label="Delete selected drawing" data-testid="tool-delete"><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
      <button className={b(!!selected?.locked, !selected)} onClick={onLock} title={selected?.locked ? "Unlock selected" : "Lock selected"} aria-label="Lock or unlock selected drawing" data-testid="tool-lock">{selected?.locked ? <Lock className="h-3.5 w-3.5" aria-hidden /> : <Unlock className="h-3.5 w-3.5" aria-hidden />}</button>
      <button className={b(hidden)} onClick={() => setHidden(!hidden)} title={hidden ? "Show all drawings" : "Hide all drawings"} aria-label="Hide or show all drawings" aria-pressed={hidden} data-testid="tool-hide">{hidden ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}</button>
    </div>
  );
}

/** Edit panel for the selected drawing (colour, label, timeframe visibility, alert at this line). */
export function DrawingEditor({ d, tf, price, api, onClose, right = 6 }: { d: ChartDrawing; tf: string; price: number | null; api: ReturnType<typeof useDrawings>; onClose: () => void; right?: number }) {
  const [label, setLabel] = useState(d.label);
  useEffect(() => setLabel(d.label), [d.id, d.label]);
  const upd = (after: Partial<ChartDrawing>) => { const before = Object.fromEntries(Object.keys(after).map((k) => [k, (d as any)[k]])); void api.update(d.id, before, after); };
  const thisOnly = !d.tfVisibility.includes("ALL");
  const alertable = d.type === "HLINE" || d.type === "RECT";
  const alert = () => {
    if (d.type === "RECT") {
      const lo = Math.min(d.points[0].price, d.points[1].price), hi = Math.max(d.points[0].price, d.points[1].price);
      openAlertDialog({ symbol: d.symbol, type: "RETEST_ZONE", level: lo, levelHigh: hi, context: `Your drawn zone ${lo.toFixed(2)}–${hi.toFixed(2)}${d.label ? ` (${d.label})` : ""}` });
    } else {
      const lv = d.points[0].price, up = price == null || lv >= price;
      openAlertDialog({ symbol: d.symbol, type: up ? "ENTRY_CROSS_UP" : "PULLBACK_DOWN", level: lv, levelHigh: null, context: `Your drawn line ${lv.toFixed(2)}${d.label ? ` (${d.label})` : ""}` });
    }
  };
  return (
    <div style={{ right }} className="absolute z-30 top-1.5 w-[250px] rounded border border-[#1e293b] bg-[#0b1220]/95 p-2 text-[11px] shadow-xl space-y-1.5" data-testid="panel-drawing-editor" data-drawing-id={d.id}>
      <div className="flex items-center gap-1.5">
        <span className="font-mono font-bold text-[#f1f5f9]">{DRAWING_LABEL[d.type]}</span>
        {d.locked && <span className="text-[10px] text-signal-amber inline-flex items-center gap-0.5"><Lock className="h-3 w-3" aria-hidden /> locked</span>}
        <button className="ml-auto" onClick={onClose} aria-label="Close drawing editor" data-testid="button-close-drawing"><X className="h-3.5 w-3.5 text-[#94a3b8]" /></button>
      </div>
      <div className="flex items-center gap-1.5">
        <input type="color" value={d.color} disabled={d.locked} onChange={(e) => upd({ color: e.target.value })} className="h-6 w-7 rounded border border-[#1e293b] bg-transparent p-0" aria-label="Drawing color" data-testid="input-drawing-color" />
        <input className="flex-1 rounded border border-[#1e293b] bg-[#050a13] px-1.5 py-0.5 text-[11px] text-[#f1f5f9]" value={label} maxLength={80} disabled={d.locked} placeholder="Label"
          onChange={(e) => setLabel(e.target.value)} onBlur={() => label !== d.label && upd({ label })} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} aria-label="Drawing label" data-testid="input-drawing-label" />
      </div>
      <div className="flex items-center gap-1.5">
        <select className="rounded border border-[#1e293b] bg-[#050a13] px-1 py-0.5 text-[11px] text-[#f1f5f9]" disabled={d.locked} value={d.style?.dash ?? "solid"} onChange={(e) => upd({ style: { width: d.style?.width ?? 1, dash: e.target.value as any } })} aria-label="Line style" data-testid="select-drawing-dash">
          <option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option>
        </select>
        <select className="rounded border border-[#1e293b] bg-[#050a13] px-1 py-0.5 text-[11px] text-[#f1f5f9]" disabled={d.locked} value={thisOnly ? "this" : "all"} onChange={(e) => upd({ tfVisibility: e.target.value === "all" ? ["ALL"] : [tf] })} aria-label="Timeframe visibility" data-testid="select-drawing-tf">
          <option value="all">All timeframes</option><option value="this">{`Only ${tf}`}</option>
        </select>
      </div>
      {alertable && (
        <button className="w-full inline-flex items-center justify-center gap-1 rounded border border-sky-400/60 px-2 py-1 text-sky-300 hover:bg-sky-400/10" onClick={alert} data-testid="button-drawing-alert">
          <Bell className="h-3.5 w-3.5" aria-hidden /> Alert me at this line
        </button>
      )}
      {alertable && <p className="text-[10px] text-[#94a3b8] leading-snug">This line is a level in the shared context: tips and practice price alerts can use it. Price alert only — not an order.</p>}
    </div>
  );
}

export { visibleOn, POINTS_NEEDED };
