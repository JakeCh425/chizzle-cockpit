// Part 4 migration — practice trades (ARM TRADE → MY TRADES). Additive only: two new tables, nothing existing altered.
//   node scripts/part4-migrate.mjs             backup snapshot + CREATE TABLE IF NOT EXISTS swing_trades, swing_trade_events
//   node scripts/part4-migrate.mjs --rollback  export both tables' rows to backups/, then DROP them (nothing else references them)
import pg from "pg";
import fs from "node:fs";
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL required"); process.exit(1); }
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
fs.mkdirSync("backups", { recursive: true });
if (process.argv.includes("--rollback")) {
  const dump = {};
  for (const t of ["swing_trades", "swing_trade_events"]) {
    const exists = (await c.query(`SELECT to_regclass('public.${t}') AS r`)).rows[0].r;
    dump[t] = exists ? (await c.query(`SELECT * FROM ${t} ORDER BY id`)).rows : null;
  }
  const file = `backups/swing-trades-${stamp()}.json`;
  fs.writeFileSync(file, JSON.stringify({ takenAt: new Date().toISOString(), ...dump }, null, 2));
  console.log(`Exported rows to ${file}`);
  await c.query(`DROP TABLE IF EXISTS swing_trade_events; DROP TABLE IF EXISTS swing_trades;`);
  console.log("Rolled back: swing_trade_events, swing_trades"); await c.end(); process.exit(0);
}
const cols = await c.query(`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position`);
const tables = [...new Set(cols.rows.map(r => r.table_name))];
const counts = {}; for (const t of tables) counts[t] = Number((await c.query(`SELECT count(*) FROM "${t}"`)).rows[0].count);
const config = {}; for (const t of ["swing_settings", "alert_contacts", "swing_alert_prefs"]) if (tables.includes(t)) config[t] = (await c.query(`SELECT * FROM "${t}"`)).rows;
const file = `backups/pre-part4-${stamp()}.json`;
fs.writeFileSync(file, JSON.stringify({ takenAt: new Date().toISOString(), tables, counts, columns: cols.rows, config }, null, 2));
console.log(`Backup: ${file} (${tables.length} tables)`);
await c.query(`
CREATE TABLE IF NOT EXISTS swing_trades (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL, exchange TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ARMED',
  setup_key TEXT, setup_type TEXT, timeframe TEXT,
  entry DOUBLE PRECISION NOT NULL, stop DOUBLE PRECISION NOT NULL, stop_limit DOUBLE PRECISION,
  t1 DOUBLE PRECISION NOT NULL, t2 DOUBLE PRECISION,
  shares DOUBLE PRECISION NOT NULL DEFAULT 0, risk_dollars DOUBLE PRECISION NOT NULL DEFAULT 0, rr_t1 DOUBLE PRECISION,
  notes TEXT NOT NULL DEFAULT '',
  original_levels JSONB NOT NULL DEFAULT '{}'::jsonb,
  decision_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  override_reason TEXT,
  fill_price DOUBLE PRECISION, filled_at TIMESTAMPTZ,
  exit_price DOUBLE PRECISION, exit_reason TEXT, closed_at TIMESTAMPTZ, pnl DOUBLE PRECISION, r_multiple DOUBLE PRECISION,
  armed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), cancelled_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS swing_trades_status_symbol_idx ON swing_trades (status, symbol);
CREATE TABLE IF NOT EXISTS swing_trade_events (
  id SERIAL PRIMARY KEY,
  trade_id INTEGER NOT NULL REFERENCES swing_trades(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  before JSONB, after JSONB, note TEXT NOT NULL DEFAULT '',
  at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS swing_trade_events_trade_idx ON swing_trade_events (trade_id, at);
`);
const after = await c.query(`SELECT table_name, count(*)::int AS cols FROM information_schema.columns WHERE table_name IN ('swing_trades','swing_trade_events') GROUP BY table_name`);
console.log("Created:", after.rows); await c.end();
