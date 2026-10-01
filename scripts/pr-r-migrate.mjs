// Section R migration — practice plan versions (additive only).
//   node scripts/pr-r-migrate.mjs             backup snapshot + CREATE TABLE IF NOT EXISTS
//   node scripts/pr-r-migrate.mjs --rollback  DROP swing_plan_versions (nothing else references it)
// Existing tables are never altered.
import pg from "pg";
import fs from "node:fs";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL required"); process.exit(1); }
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
const TABLES = ["swing_plan_versions"];

if (process.argv.includes("--rollback")) {
  await c.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")};`);
  console.log("Rolled back:", TABLES.join(", "));
  await c.end(); process.exit(0);
}

const cols = await c.query(`SELECT table_name, column_name, data_type, is_nullable, column_default
  FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position`);
const tables = [...new Set(cols.rows.map(r => r.table_name))];
const counts = {};
for (const t of tables) counts[t] = Number((await c.query(`SELECT count(*) FROM "${t}"`)).rows[0].count);
const config = {};
for (const t of ["settings", "swing_settings", "ui_prefs", "watchlist"]) if (tables.includes(t)) config[t] = (await c.query(`SELECT * FROM "${t}"`)).rows;
fs.mkdirSync("backups", { recursive: true });
const file = `backups/pre-pr-r-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
fs.writeFileSync(file, JSON.stringify({ takenAt: new Date().toISOString(), tables, counts, columns: cols.rows, config }, null, 2));
console.log(`Backup: ${file} (${tables.length} tables)`);

await c.query(`
CREATE TABLE IF NOT EXISTS swing_plan_versions (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  setup_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'USER_ADJUSTED',
  inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT NOT NULL DEFAULT '',
  changed_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  chart_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  data_vendor TEXT,
  selected BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS swing_plan_versions_symbol_idx ON swing_plan_versions (symbol, setup_id);
`);
console.log("Created:", TABLES.join(", "));
await c.end();
