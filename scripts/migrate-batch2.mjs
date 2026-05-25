#!/usr/bin/env node
// Idempotent migration for Batch 2+3 schema additions.
// Safe to run multiple times — ADD COLUMN swallowed if duplicate, CREATE TABLE IF NOT EXISTS.

import Database from "better-sqlite3";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "..", "data.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

const tradeCols = [
  ["t1_filled_at", "TEXT"],
  ["t2_filled", "INTEGER NOT NULL DEFAULT 0"],
  ["t2_filled_at", "TEXT"],
  ["trailing_stop", "REAL"],
  ["trailing_stop_updated_at", "TEXT"],
  ["high_water_mark", "REAL"],
  ["quality_at_entry", "TEXT"],
  ["risk_multiplier_at_entry", "REAL"],
  ["confidence_rating", "INTEGER"],
  ["emotion_tag", "TEXT"],
  ["reflection", "TEXT"],
];

let added = 0;
for (const [col, type] of tradeCols) {
  try {
    db.prepare(`ALTER TABLE trades ADD COLUMN ${col} ${type}`).run();
    added++;
    console.log(`  ✓ trades.${col}`);
  } catch (e) {
    if (!/duplicate column name/i.test(String(e))) throw e;
    console.log(`  · trades.${col} already exists`);
  }
}

db.prepare(`
  CREATE TABLE IF NOT EXISTS trade_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    price REAL,
    note TEXT,
    occurred_at TEXT NOT NULL
  )
`).run();
console.log("  ✓ trade_events table ready");

db.prepare(`CREATE INDEX IF NOT EXISTS idx_trade_events_trade ON trade_events(trade_id)`).run();
console.log("  ✓ trade_events index ready");

db.close();
console.log(`Migration done. ${added} new column(s) added.`);
