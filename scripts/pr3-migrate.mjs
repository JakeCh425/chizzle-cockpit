// PR 3 migration — Unified Swing Decision Engine (additive only).
//   node scripts/pr3-migrate.mjs            backup snapshot + CREATE TABLE IF NOT EXISTS
//   node scripts/pr3-migrate.mjs --rollback DROP the 3 PR 3 tables (nothing else references them)
// Backup: writes backups/pre-pr3-<ts>.json with every table's schema + row count,
// plus full rows of the small config tables. Existing tables are never altered.
import pg from "pg";
import fs from "node:fs";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL required"); process.exit(1); }
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const PR3_TABLES = ["swing_journal", "swing_decision_log", "swing_settings"];

if (process.argv.includes("--rollback")) {
  await c.query(`DROP TABLE IF EXISTS ${PR3_TABLES.join(", ")};`);
  console.log("Rolled back:", PR3_TABLES.join(", "));
  await c.end(); process.exit(0);
}

// 1. Backup snapshot
const cols = await c.query(`SELECT table_name, column_name, data_type, is_nullable, column_default
  FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position`);
const tables = [...new Set(cols.rows.map(r => r.table_name))];
const counts = {};
for (const t of tables) counts[t] = Number((await c.query(`SELECT count(*) FROM "${t}"`)).rows[0].count);
const config = {};
for (const t of ["settings", "mtf_settings", "mtf_universe", "ui_prefs", "watchlist"]) {
  if (tables.includes(t)) config[t] = (await c.query(`SELECT * FROM "${t}"`)).rows;
}
fs.mkdirSync("backups", { recursive: true });
const file = `backups/pre-pr3-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
fs.writeFileSync(file, JSON.stringify({ takenAt: new Date().toISOString(), tables, counts, columns: cols.rows, config }, null, 2));
console.log(`Backup: ${file} (${tables.length} tables)`);

// 2. Additive DDL
await c.query(`
CREATE TABLE IF NOT EXISTS swing_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO swing_settings (id, data) VALUES (1, '{}'::jsonb) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS swing_decision_log (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  exchange TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  bar_time TIMESTAMPTZ NOT NULL,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data_source TEXT, session TEXT, timezone TEXT,
  weekly_regime TEXT, daily_regime TEXT,
  setups_evaluated JSONB NOT NULL DEFAULT '[]'::jsonb,
  passed JSONB NOT NULL DEFAULT '[]'::jsonb,
  failed JSONB NOT NULL DEFAULT '[]'::jsonb,
  formation TEXT, confirm_4h TEXT, confirm_1h TEXT,
  original_trigger DOUBLE PRECISION, distance_from_trigger_pct DOUBLE PRECISION,
  structural_stop DOUBLE PRECISION, target1 DOUBLE PRECISION, target2 DOUBLE PRECISION,
  rr_at_signal DOUBLE PRECISION, rr_at_current DOUBLE PRECISION,
  volume_condition TEXT, extension_pct DOUBLE PRECISION, extension_atr DOUBLE PRECISION,
  data_mismatch TEXT,
  final_status TEXT NOT NULL,
  reason TEXT NOT NULL,
  decision JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS swing_decision_log_sym_time ON swing_decision_log (symbol, bar_time DESC);

CREATE TABLE IF NOT EXISTS swing_journal (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  action TEXT NOT NULL,
  symbol TEXT NOT NULL,
  setup_type TEXT, grade TEXT, timeframes TEXT,
  entry DOUBLE PRECISION, stop DOUBLE PRECISION,
  target1 DOUBLE PRECISION, target2 DOUBLE PRECISION, planned_risk DOUBLE PRECISION,
  outcome TEXT, screenshot_url TEXT, lesson TEXT, followed_plan BOOLEAN, notes TEXT,
  trade_id INTEGER,
  decision JSONB NOT NULL DEFAULT '{}'::jsonb
);`);

// 3. Verify existing tables untouched
const after = await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`);
const afterNames = after.rows.map(r => r.table_name);
const missing = tables.filter(t => !afterNames.includes(t));
const added = afterNames.filter(t => !tables.includes(t));
for (const t of tables) {
  const n = Number((await c.query(`SELECT count(*) FROM "${t}"`)).rows[0].count);
  if (n < counts[t]) console.warn(`WARN row count dropped: ${t} ${counts[t]} -> ${n}`);
}
console.log(JSON.stringify({ existingTablesPreserved: missing.length === 0, added }));
await c.end();
