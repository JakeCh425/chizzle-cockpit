// Chart Ecosystem Part 3 migration — chart drawings. Additive only: one new table, nothing existing altered.
//   node scripts/chart-drawings-migrate.mjs             backup snapshot → CREATE TABLE IF NOT EXISTS chart_drawings
//   node scripts/chart-drawings-migrate.mjs --rollback  export chart_drawings rows to backups/, then DROP it (nothing references it)
import pg from "pg";
import fs from "node:fs";
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL required"); process.exit(1); }
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
fs.mkdirSync("backups", { recursive: true });
if (process.argv.includes("--rollback")) {
  const exists = (await c.query(`SELECT to_regclass('public.chart_drawings') AS r`)).rows[0].r;
  const rows = exists ? (await c.query(`SELECT * FROM chart_drawings ORDER BY id`)).rows : null;
  const file = `backups/chart-drawings-${stamp()}.json`;
  fs.writeFileSync(file, JSON.stringify({ takenAt: new Date().toISOString(), chart_drawings: rows }, null, 2));
  console.log(`Exported ${rows?.length ?? 0} rows to ${file}`);
  await c.query(`DROP TABLE IF EXISTS chart_drawings;`);
  console.log("Rolled back: chart_drawings dropped"); await c.end(); process.exit(0);
}
const cols = await c.query(`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position`);
const tables = [...new Set(cols.rows.map(r => r.table_name))];
const counts = {}; for (const t of tables) counts[t] = Number((await c.query(`SELECT count(*) FROM "${t}"`)).rows[0].count);
const config = {}; for (const t of ["swing_settings", "alert_contacts", "swing_alert_prefs", "ui_prefs", "swing_plan_versions", "swing_price_alerts", "swing_trades"]) if (tables.includes(t)) config[t] = (await c.query(`SELECT * FROM "${t}"`)).rows;
const file = `backups/pre-chart-drawings-${stamp()}.json`;
fs.writeFileSync(file, JSON.stringify({ takenAt: new Date().toISOString(), tables, counts, columns: cols.rows, config }, null, 2));
console.log(`Backup: ${file} (${tables.length} tables, user-owned tables copied in full)`);
await c.query(`
CREATE TABLE IF NOT EXISTS chart_drawings (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  type TEXT NOT NULL,
  points JSONB NOT NULL DEFAULT '[]'::jsonb,
  color TEXT NOT NULL DEFAULT '#38bdf8',
  style JSONB NOT NULL DEFAULT '{"width":1,"dash":"solid"}'::jsonb,
  label TEXT NOT NULL DEFAULT '',
  tf_visibility JSONB NOT NULL DEFAULT '["ALL"]'::jsonb,
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS chart_drawings_symbol_idx ON chart_drawings (symbol);
`);
const after = await c.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'chart_drawings' ORDER BY ordinal_position`);
console.log("Created chart_drawings:", after.rows.map(r => `${r.column_name}:${r.data_type}`).join(", ")); await c.end();
