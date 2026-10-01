// Section R4 migration — practice price alerts (additive only).
//   node scripts/pr-rb-migrate.mjs             backup snapshot + CREATE TABLE IF NOT EXISTS
//   node scripts/pr-rb-migrate.mjs --rollback  DROP the 3 alert tables (nothing else references them)
import pg from "pg";
import fs from "node:fs";
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL required"); process.exit(1); }
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
const TABLES = ["swing_alert_events", "swing_price_alerts", "swing_alert_prefs"];
if (process.argv.includes("--rollback")) {
  await c.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")};`);
  console.log("Rolled back:", TABLES.join(", ")); await c.end(); process.exit(0);
}
const cols = await c.query(`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position`);
const tables = [...new Set(cols.rows.map(r => r.table_name))];
const counts = {}; for (const t of tables) counts[t] = Number((await c.query(`SELECT count(*) FROM "${t}"`)).rows[0].count);
const config = {}; for (const t of ["swing_settings", "alert_contacts", "swing_plan_versions"]) if (tables.includes(t)) config[t] = (await c.query(`SELECT * FROM "${t}"`)).rows;
fs.mkdirSync("backups", { recursive: true });
const file = `backups/pre-pr-rb-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
fs.writeFileSync(file, JSON.stringify({ takenAt: new Date().toISOString(), tables, counts, columns: cols.rows, config }, null, 2));
console.log(`Backup: ${file} (${tables.length} tables)`);
await c.query(`
CREATE TABLE IF NOT EXISTS swing_price_alerts (
  id SERIAL PRIMARY KEY, symbol TEXT NOT NULL, setup_id TEXT, plan_version INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL, level DOUBLE PRECISION, level_high DOUBLE PRECISION,
  channels JSONB NOT NULL DEFAULT '["in_app"]'::jsonb, frequency TEXT NOT NULL DEFAULT 'ONCE',
  repeat_minutes INTEGER NOT NULL DEFAULT 30, expiry_mode TEXT NOT NULL DEFAULT 'END_OF_DAY',
  expires_at TIMESTAMPTZ, active BOOLEAN NOT NULL DEFAULT TRUE, last_fired_at TIMESTAMPTZ, last_fired_bar TEXT,
  fire_count INTEGER NOT NULL DEFAULT 0, last_state TEXT, note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS swing_price_alerts_active_idx ON swing_price_alerts (active, symbol);
CREATE TABLE IF NOT EXISTS swing_alert_events (
  id SERIAL PRIMARY KEY, alert_id INTEGER, symbol TEXT NOT NULL, type TEXT NOT NULL,
  fired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), price DOUBLE PRECISION, level DOUBLE PRECISION,
  data_source TEXT, data_status TEXT, condition TEXT NOT NULL DEFAULT '', plan_version INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '', delivery JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged BOOLEAN NOT NULL DEFAULT FALSE, acknowledged_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS swing_alert_events_fired_idx ON swing_alert_events (fired_at DESC);
CREATE TABLE IF NOT EXISTS swing_alert_prefs (
  id INTEGER PRIMARY KEY DEFAULT 1, data JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO swing_alert_prefs (id, data) VALUES (1, '{}'::jsonb) ON CONFLICT (id) DO NOTHING;
`);
console.log("Created:", TABLES.join(", ")); await c.end();
