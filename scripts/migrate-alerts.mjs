import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const SQL = `
CREATE TABLE IF NOT EXISTS alert_contacts (
  id SERIAL PRIMARY KEY,
  channel TEXT NOT NULL,
  destination TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT true,
  trigger_forming BOOLEAN NOT NULL DEFAULT true,
  trigger_confirmed BOOLEAN NOT NULL DEFAULT true,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_log (
  id SERIAL PRIMARY KEY,
  signal_key TEXT NOT NULL,
  ticker TEXT NOT NULL,
  phase TEXT NOT NULL,
  mode TEXT NOT NULL,
  channel TEXT NOT NULL,
  destination TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '{}',
  sent_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alert_log_signal_key ON alert_log(signal_key);
CREATE INDEX IF NOT EXISTS idx_alert_log_sent_at ON alert_log(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_contacts_enabled ON alert_contacts(enabled);
`;

try {
  const client = await pool.connect();
  await client.query(SQL);
  const contacts = await client.query("SELECT COUNT(*)::int AS c FROM alert_contacts");
  const log = await client.query("SELECT COUNT(*)::int AS c FROM alert_log");
  console.log("OK alert_contacts rows:", contacts.rows[0].c);
  console.log("OK alert_log rows:", log.rows[0].c);
  client.release();
  await pool.end();
} catch (e) {
  console.error("ERR", e);
  process.exit(1);
}
