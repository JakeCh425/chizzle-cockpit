// Chart Ecosystem — Part 3: chart drawings store (table chart_drawings, created by the approved additive
// migration scripts/chart-drawings-migrate.mjs — this module never creates or alters tables itself).
// User-owned data: never overwritten by the engine; every write is an explicit user action.
import { pool } from "../storage";
import { drawingInput, drawingPatch, type ChartDrawing } from "@shared/chartDrawings";

let present: boolean | null = null, checkedAt = 0;
/** True once the migration has run. Re-checked every 60 s so a later migration is picked up without restart. */
export async function drawingsTablePresent(): Promise<boolean> {
  if (present && Date.now() - checkedAt < 3_600_000) return true;
  if (present === false && Date.now() - checkedAt < 60_000) return false;
  try { present = !!(await pool.query(`SELECT to_regclass('public.chart_drawings') AS r`)).rows[0]?.r; }
  catch { present = false; }
  checkedAt = Date.now(); return present;
}
export class DrawingError extends Error { constructor(public status: number, msg: string) { super(msg); } }
const need = async () => { if (!(await drawingsTablePresent())) throw new DrawingError(503, "Chart drawings are not set up yet (run scripts/chart-drawings-migrate.mjs)."); };

const rowOf = (r: any): ChartDrawing => ({
  id: r.id, symbol: r.symbol, type: r.type, points: r.points ?? [], color: r.color, style: r.style ?? { width: 1, dash: "solid" },
  label: r.label ?? "", tfVisibility: r.tf_visibility ?? ["ALL"], locked: !!r.locked,
  createdAt: r.created_at ? new Date(r.created_at).toISOString() : undefined, updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : undefined,
});

export async function listDrawings(symbol: string): Promise<ChartDrawing[]> {
  if (!(await drawingsTablePresent())) return [];
  const r = await pool.query(`SELECT * FROM chart_drawings WHERE symbol = $1 ORDER BY id`, [symbol.toUpperCase()]);
  return r.rows.map(rowOf);
}
export async function createDrawing(body: unknown): Promise<ChartDrawing> {
  await need();
  const d = drawingInput.parse(body);
  const r = await pool.query(
    `INSERT INTO chart_drawings (symbol, type, points, color, style, label, tf_visibility, locked) VALUES ($1,$2,$3::jsonb,$4,$5::jsonb,$6,$7::jsonb,$8) RETURNING *`,
    [d.symbol, d.type, JSON.stringify(d.points), d.color, JSON.stringify(d.style), d.label, JSON.stringify(d.tfVisibility), d.locked]);
  return rowOf(r.rows[0]);
}
export async function updateDrawing(id: number, body: unknown): Promise<ChartDrawing> {
  await need();
  const p = drawingPatch.parse(body);
  const cur = (await pool.query(`SELECT * FROM chart_drawings WHERE id = $1`, [id])).rows[0];
  if (!cur) throw new DrawingError(404, "Drawing not found");
  // A locked drawing only accepts an unlock (or a lock-state change); geometry edits are refused.
  if (cur.locked && p.locked !== false && (p.points || p.color || p.style || p.label != null || p.tfVisibility)) throw new DrawingError(409, "Drawing is locked — unlock it first");
  const merged = drawingInput.parse({ symbol: cur.symbol, type: cur.type, points: p.points ?? cur.points, color: p.color ?? cur.color, style: p.style ?? cur.style,
    label: p.label ?? cur.label, tfVisibility: p.tfVisibility ?? cur.tf_visibility, locked: p.locked ?? cur.locked });
  const r = await pool.query(
    `UPDATE chart_drawings SET points=$2::jsonb, color=$3, style=$4::jsonb, label=$5, tf_visibility=$6::jsonb, locked=$7, updated_at=NOW() WHERE id=$1 RETURNING *`,
    [id, JSON.stringify(merged.points), merged.color, JSON.stringify(merged.style), merged.label, JSON.stringify(merged.tfVisibility), merged.locked]);
  return rowOf(r.rows[0]);
}
export async function deleteDrawing(id: number): Promise<{ ok: true; deleted: ChartDrawing }> {
  await need();
  const cur = (await pool.query(`SELECT * FROM chart_drawings WHERE id = $1`, [id])).rows[0];
  if (!cur) throw new DrawingError(404, "Drawing not found");
  if (cur.locked) throw new DrawingError(409, "Drawing is locked — unlock it first");
  await pool.query(`DELETE FROM chart_drawings WHERE id = $1`, [id]);
  return { ok: true, deleted: rowOf(cur) };
}
