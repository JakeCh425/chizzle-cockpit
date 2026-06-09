import {
  settings,
  tickers,
  watchlist,
  trades,
  alerts,
  journalEntries,
  leapPositions,
  leapReserve,
  equityHistory,
  chizzleScores,
  priceTicks,
  regimeState,
  regimeInputs,
  setupCandidates,
  setupHistory,
  tradeEvents,
  signalHistory,
} from "@shared/schema";
import type {
  Settings, InsertSettings,
  Ticker, InsertTicker,
  WatchlistItem, InsertWatchlistItem,
  Trade, InsertTrade,
  Alert, InsertAlert,
  JournalEntry, InsertJournalEntry,
  LeapPosition, InsertLeapPosition,
  LeapReserve, InsertLeapReserve,
  EquityHistory, InsertEquityHistory,
  ChizzleScore, InsertChizzleScore,
  PriceTick, InsertPriceTick,
  RegimeState, InsertRegimeState,
  RegimeInputsRow, InsertRegimeInputs,
  SetupCandidateRow, InsertSetupCandidate,
  SetupHistoryRow, InsertSetupHistory,
  TradeEvent, InsertTradeEvent,
  SignalHistory, InsertSignalHistory,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq, desc, and, sql } from "drizzle-orm";

if (!process.env.DATABASE_URL) {
  console.error("[storage] FATAL: DATABASE_URL environment variable is not set. Set it to your Neon Postgres connection string and restart.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ─── Run migrations inline (idempotent via IF NOT EXISTS) ─────────────────────
async function runMigrations() {
  await pool.query(`
CREATE TABLE IF NOT EXISTS settings (
  id SERIAL PRIMARY KEY,
  equity DOUBLE PRECISION NOT NULL DEFAULT 1000,
  regime TEXT NOT NULL DEFAULT 'GREEN',
  regime_override BOOLEAN NOT NULL DEFAULT false,
  regime_changed_at TEXT NOT NULL DEFAULT '',
  watchlist_tier INTEGER NOT NULL DEFAULT 1,
  risk_pct_green DOUBLE PRECISION NOT NULL DEFAULT 3,
  risk_pct_yellow DOUBLE PRECISION NOT NULL DEFAULT 2,
  risk_pct_red DOUBLE PRECISION NOT NULL DEFAULT 1,
  max_positions_green INTEGER NOT NULL DEFAULT 4,
  max_positions_yellow INTEGER NOT NULL DEFAULT 3,
  max_positions_red INTEGER NOT NULL DEFAULT 2,
  max_open_risk_pct DOUBLE PRECISION NOT NULL DEFAULT 6,
  min_rr DOUBLE PRECISION NOT NULL DEFAULT 2.0
);

CREATE TABLE IF NOT EXISTS tickers (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL UNIQUE,
  tier INTEGER NOT NULL DEFAULT 1,
  current_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  manual_override DOUBLE PRECISION,
  prior_day_close DOUBLE PRECISION NOT NULL DEFAULT 0,
  sma_20 DOUBLE PRECISION NOT NULL DEFAULT 0,
  sma_50 DOUBLE PRECISION NOT NULL DEFAULT 0,
  sma_200 DOUBLE PRECISION NOT NULL DEFAULT 0,
  atr_14 DOUBLE PRECISION NOT NULL DEFAULT 0,
  earnings_date TEXT
);

CREATE TABLE IF NOT EXISTS watchlist (
  id SERIAL PRIMARY KEY,
  ticker_id INTEGER NOT NULL,
  setup_type TEXT NOT NULL DEFAULT 'TREND_PULLBACK',
  entry_zone_low DOUBLE PRECISION NOT NULL DEFAULT 0,
  entry_zone_high DOUBLE PRECISION NOT NULL DEFAULT 0,
  stop DOUBLE PRECISION NOT NULL DEFAULT 0,
  t1 DOUBLE PRECISION NOT NULL DEFAULT 0,
  t2 DOUBLE PRECISION NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'DORMANT',
  score_components TEXT NOT NULL DEFAULT '{}',
  total_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  grade TEXT NOT NULL DEFAULT 'Ignore'
);

CREATE TABLE IF NOT EXISTS trades (
  id SERIAL PRIMARY KEY,
  ticker TEXT NOT NULL,
  setup TEXT NOT NULL,
  regime_at_entry TEXT NOT NULL,
  entry DOUBLE PRECISION NOT NULL,
  stop DOUBLE PRECISION NOT NULL,
  t1 DOUBLE PRECISION NOT NULL,
  t2 DOUBLE PRECISION,
  exit DOUBLE PRECISION,
  shares INTEGER NOT NULL,
  risk_dollars DOUBLE PRECISION NOT NULL,
  rr DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  archived BOOLEAN NOT NULL DEFAULT false,
  confirmed_at TEXT,
  exit_reason TEXT,
  r_multiple DOUBLE PRECISION,
  plan_followed BOOLEAN,
  lesson_tag TEXT,
  thesis TEXT NOT NULL DEFAULT '',
  emotional_state INTEGER NOT NULL DEFAULT 5,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  t1_filled BOOLEAN NOT NULL DEFAULT false,
  t1_filled_at TEXT,
  t2_filled BOOLEAN NOT NULL DEFAULT false,
  t2_filled_at TEXT,
  trailing_stop DOUBLE PRECISION,
  trailing_stop_updated_at TEXT,
  high_water_mark DOUBLE PRECISION,
  quality_at_entry TEXT,
  risk_multiplier_at_entry DOUBLE PRECISION,
  confidence_rating INTEGER,
  emotion_tag TEXT,
  reflection TEXT
);

CREATE TABLE IF NOT EXISTS trade_events (
  id SERIAL PRIMARY KEY,
  trade_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  price DOUBLE PRECISION,
  note TEXT,
  occurred_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  id SERIAL PRIMARY KEY,
  ticker TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  fired_at TEXT NOT NULL,
  acknowledged BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  decisions_text TEXT NOT NULL DEFAULT '',
  process_change_text TEXT NOT NULL DEFAULT '',
  leak_flags TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS leap_positions (
  id SERIAL PRIMARY KEY,
  ticker TEXT NOT NULL,
  contracts INTEGER NOT NULL,
  strike DOUBLE PRECISION NOT NULL,
  expiry TEXT NOT NULL,
  delta_at_entry DOUBLE PRECISION NOT NULL,
  premium_paid DOUBLE PRECISION NOT NULL,
  current_premium DOUBLE PRECISION NOT NULL,
  current_delta DOUBLE PRECISION NOT NULL,
  opened_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leap_reserve (
  id SERIAL PRIMARY KEY,
  balance DOUBLE PRECISION NOT NULL DEFAULT 0,
  realized_roll_pnl_ytd DOUBLE PRECISION NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS equity_history (
  id SERIAL PRIMARY KEY,
  date TEXT NOT NULL,
  equity DOUBLE PRECISION NOT NULL,
  drawdown_pct DOUBLE PRECISION NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chizzle_scores (
  id SERIAL PRIMARY KEY,
  date TEXT NOT NULL,
  components TEXT NOT NULL DEFAULT '{}',
  total DOUBLE PRECISION NOT NULL DEFAULT 0,
  identity_state TEXT NOT NULL DEFAULT 'WORKING'
);

CREATE TABLE IF NOT EXISTS price_ticks (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_price_ticks_symbol_ts ON price_ticks(symbol, ts DESC);

CREATE TABLE IF NOT EXISTS regime_state (
  id SERIAL PRIMARY KEY,
  current_regime TEXT NOT NULL DEFAULT 'yellow',
  current_regime_since TEXT NOT NULL DEFAULT '',
  pending_regime TEXT,
  pending_since TEXT,
  pending_consecutive_count INTEGER NOT NULL DEFAULT 0,
  manual_override BOOLEAN NOT NULL DEFAULT false,
  manual_override_regime TEXT,
  last_classified_at TEXT NOT NULL DEFAULT '',
  last_error TEXT,
  stale BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS regime_inputs (
  id SERIAL PRIMARY KEY,
  computed_at TEXT NOT NULL,
  spy_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  spy_sma20 DOUBLE PRECISION NOT NULL DEFAULT 0,
  spy_sma50 DOUBLE PRECISION NOT NULL DEFAULT 0,
  spy_sma200 DOUBLE PRECISION NOT NULL DEFAULT 0,
  spy_sma20_rising BOOLEAN NOT NULL DEFAULT false,
  spy_sma50_rising BOOLEAN NOT NULL DEFAULT false,
  spy_above_20 BOOLEAN NOT NULL DEFAULT false,
  spy_above_50 BOOLEAN NOT NULL DEFAULT false,
  spy_above_200 BOOLEAN NOT NULL DEFAULT false,
  qqq_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  qqq_sma20 DOUBLE PRECISION NOT NULL DEFAULT 0,
  qqq_sma50 DOUBLE PRECISION NOT NULL DEFAULT 0,
  qqq_sma200 DOUBLE PRECISION NOT NULL DEFAULT 0,
  qqq_sma20_rising BOOLEAN NOT NULL DEFAULT false,
  qqq_sma50_rising BOOLEAN NOT NULL DEFAULT false,
  qqq_above_20 BOOLEAN NOT NULL DEFAULT false,
  qqq_above_50 BOOLEAN NOT NULL DEFAULT false,
  qqq_above_200 BOOLEAN NOT NULL DEFAULT false,
  vix_level DOUBLE PRECISION NOT NULL DEFAULT 0,
  vix_slope_5d DOUBLE PRECISION NOT NULL DEFAULT 0,
  breadth_proxy_pct DOUBLE PRECISION NOT NULL DEFAULT 50,
  rsp_above_50sma BOOLEAN NOT NULL DEFAULT false,
  rsp_spy_ratio_trend DOUBLE PRECISION NOT NULL DEFAULT 1,
  distribution_days INTEGER NOT NULL DEFAULT 0,
  distribution_day_dates TEXT NOT NULL DEFAULT '[]',
  follow_through_day BOOLEAN NOT NULL DEFAULT false,
  raw_regime TEXT NOT NULL DEFAULT 'yellow'
);
CREATE INDEX IF NOT EXISTS idx_regime_inputs_computed_at ON regime_inputs(computed_at DESC);

CREATE TABLE IF NOT EXISTS setup_candidates (
  id SERIAL PRIMARY KEY,
  ticker TEXT NOT NULL,
  setup TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'dormant',
  qualifications_passed INTEGER NOT NULL DEFAULT 0,
  qualifications_total INTEGER NOT NULL DEFAULT 6,
  qualification_details TEXT NOT NULL DEFAULT '[]',
  entry_zone_low DOUBLE PRECISION,
  entry_zone_high DOUBLE PRECISION,
  stop DOUBLE PRECISION,
  t1 DOUBLE PRECISION,
  t2 DOUBLE PRECISION,
  rr_to_t1 DOUBLE PRECISION,
  atr14 DOUBLE PRECISION NOT NULL DEFAULT 0,
  swing_high DOUBLE PRECISION,
  pullback_pct DOUBLE PRECISION,
  base_pivot DOUBLE PRECISION,
  base_depth DOUBLE PRECISION,
  base_length INTEGER,
  trigger_fired BOOLEAN NOT NULL DEFAULT false,
  trigger_note TEXT,
  disqualifiers TEXT NOT NULL DEFAULT '[]',
  last_computed_at TEXT NOT NULL DEFAULT '',
  regime_eligible BOOLEAN NOT NULL DEFAULT true,
  regime_blocked_reason TEXT,
  relative_strength INTEGER,
  trend_strength INTEGER,
  volume_score INTEGER,
  cleanliness_score INTEGER,
  market_alignment BOOLEAN,
  earnings_risk BOOLEAN,
  quality TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_setup_candidates_ticker_setup ON setup_candidates(ticker, setup);

CREATE TABLE IF NOT EXISTS setup_history (
  id SERIAL PRIMARY KEY,
  ticker TEXT NOT NULL,
  setup TEXT NOT NULL,
  prev_state TEXT NOT NULL DEFAULT '',
  new_state TEXT NOT NULL,
  transitioned_at TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_setup_history_at ON setup_history(transitioned_at DESC);

CREATE TABLE IF NOT EXISTS signal_history (
  id SERIAL PRIMARY KEY,
  ticker TEXT NOT NULL,
  pattern_type TEXT NOT NULL,
  timestamp DOUBLE PRECISION NOT NULL,
  setup_candle_index INTEGER NOT NULL,
  confirmation_candle_index INTEGER NOT NULL,
  setup_candle_low DOUBLE PRECISION NOT NULL,
  confirmation_candle_low DOUBLE PRECISION NOT NULL,
  confirmation_close DOUBLE PRECISION NOT NULL,
  retest_zone_upper DOUBLE PRECISION NOT NULL,
  retest_zone_lower DOUBLE PRECISION NOT NULL,
  score DOUBLE PRECISION NOT NULL,
  score_breakdown TEXT NOT NULL DEFAULT '[]',
  volume DOUBLE PRECISION NOT NULL DEFAULT 0,
  volume_vs_average_20 DOUBLE PRECISION NOT NULL DEFAULT 0,
  marker_type TEXT NOT NULL DEFAULT 'confirmation',
  marker_position DOUBLE PRECISION NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#00E5A8',
  sound_played BOOLEAN NOT NULL DEFAULT false,
  notification_sent BOOLEAN NOT NULL DEFAULT false,
  sma_proximity TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signal_history_ts ON signal_history(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_signal_history_ticker ON signal_history(ticker);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_signal_history_dedup
  ON signal_history(ticker, pattern_type, timestamp);
`);

  // Idempotent column additions (Postgres supports ADD COLUMN IF NOT EXISTS natively)
  const alterStatements = [
    // setup_candidates extras
    "ALTER TABLE setup_candidates ADD COLUMN IF NOT EXISTS regime_eligible BOOLEAN NOT NULL DEFAULT true",
    "ALTER TABLE setup_candidates ADD COLUMN IF NOT EXISTS regime_blocked_reason TEXT",
    "ALTER TABLE setup_candidates ADD COLUMN IF NOT EXISTS relative_strength INTEGER",
    "ALTER TABLE setup_candidates ADD COLUMN IF NOT EXISTS trend_strength INTEGER",
    "ALTER TABLE setup_candidates ADD COLUMN IF NOT EXISTS volume_score INTEGER",
    "ALTER TABLE setup_candidates ADD COLUMN IF NOT EXISTS cleanliness_score INTEGER",
    "ALTER TABLE setup_candidates ADD COLUMN IF NOT EXISTS market_alignment BOOLEAN",
    "ALTER TABLE setup_candidates ADD COLUMN IF NOT EXISTS earnings_risk BOOLEAN",
    "ALTER TABLE setup_candidates ADD COLUMN IF NOT EXISTS quality TEXT",
    // trades extras
    "ALTER TABLE trades ADD COLUMN IF NOT EXISTS t1_filled BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE trades ADD COLUMN IF NOT EXISTS t1_filled_at TEXT",
    "ALTER TABLE trades ADD COLUMN IF NOT EXISTS t2_filled BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE trades ADD COLUMN IF NOT EXISTS t2_filled_at TEXT",
    "ALTER TABLE trades ADD COLUMN IF NOT EXISTS trailing_stop DOUBLE PRECISION",
    "ALTER TABLE trades ADD COLUMN IF NOT EXISTS trailing_stop_updated_at TEXT",
    "ALTER TABLE trades ADD COLUMN IF NOT EXISTS high_water_mark DOUBLE PRECISION",
    "ALTER TABLE trades ADD COLUMN IF NOT EXISTS quality_at_entry TEXT",
    "ALTER TABLE trades ADD COLUMN IF NOT EXISTS risk_multiplier_at_entry DOUBLE PRECISION",
    "ALTER TABLE trades ADD COLUMN IF NOT EXISTS confidence_rating INTEGER",
    "ALTER TABLE trades ADD COLUMN IF NOT EXISTS emotion_tag TEXT",
    "ALTER TABLE trades ADD COLUMN IF NOT EXISTS reflection TEXT",
    "ALTER TABLE trades ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE trades ADD COLUMN IF NOT EXISTS confirmed_at TEXT",
    // 2026-05: support fractional shares (was integer). DOUBLE PRECISION is
    // wider than INTEGER so this is a lossless upgrade for existing rows.
    "ALTER TABLE trades ALTER COLUMN shares TYPE DOUBLE PRECISION USING shares::double precision",
    // 2026-05: bump existing settings row to new defaults (5/3/1) ONLY if
    // it's still on the legacy defaults (3/2/1). Preserves user customization.
    "UPDATE settings SET risk_pct_green = 5, risk_pct_yellow = 3, risk_pct_red = 1 WHERE risk_pct_green = 3 AND risk_pct_yellow = 2 AND risk_pct_red = 1",
    // 2026-06: watchlist ordering for the mini-chart grid.
    "ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0",
    // 2026-06: archive flag so deleted watchlist rows can be restored
    // instead of being purged. Defaults to false; existing rows are active.
    "ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS archived_at TEXT",
    // 2026-06: kv_meta table for server-side singletons (seed markers, etc.)
    `CREATE TABLE IF NOT EXISTS kv_meta (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT ''
    )`,
  ];
  for (const stmt of alterStatements) {
    await pool.query(stmt);
  }
}

export const db = drizzle(pool);

// ─── kv_meta singleton helpers ────────────────────────────────────────────────
async function getMeta(k: string): Promise<string | null> {
  const rows = await pool.query<{ v: string }>("SELECT v FROM kv_meta WHERE k = $1 LIMIT 1", [k]);
  return rows.rows[0]?.v ?? null;
}
async function setMeta(k: string, v: string): Promise<void> {
  await pool.query(
    "INSERT INTO kv_meta (k, v, updated_at) VALUES ($1, $2, $3) " +
    "ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at",
    [k, v, new Date().toISOString()],
  );
}

// ─── seed ─────────────────────────────────────────────────────────────────────
async function seedIfEmpty() {
  const today = new Date().toISOString().slice(0, 10);

  // settings
  const settingsRows = await db.select().from(settings).limit(1);
  if (settingsRows.length === 0) {
    await db.insert(settings).values({
      equity: 1000,
      regime: "GREEN",
      regimeOverride: false,
      regimeChangedAt: new Date().toISOString(),
      watchlistTier: 1,
      // Bumped defaults 2026-05: more aggressive sizing out-of-the-box.
      // User can tune 1–10% via sliders in Settings.
      riskPctGreen: 5,
      riskPctYellow: 3,
      riskPctRed: 1,
      maxPositionsGreen: 4,
      maxPositionsYellow: 3,
      maxPositionsRed: 2,
      maxOpenRiskPct: 6,
      minRR: 2.0,
    });
  }

  // Tier 1 tickers with realistic May 2026 anchor prices.
  //
  // PERSISTENCE FIX (2026-06): we used to re-seed any missing default symbol on
  // every server restart. Render auto-deploys on every push, so deletions in the
  // watchlist editor would silently come back. Now we stamp a one-time marker
  // in kv_meta after the first ticker seed completes — subsequent boots NEVER
  // re-insert default tickers, so user deletions persist forever.
  const seedTickers: Array<{ symbol: string; price: number; sma20: number; sma50: number; sma200: number; atr: number }> = [
    { symbol: "SMH", price: 285.40, sma20: 278.20, sma50: 270.10, sma200: 245.30, atr: 6.80 },
    { symbol: "QQQ", price: 485.20, sma20: 478.50, sma50: 468.20, sma200: 440.10, atr: 5.40 },
    { symbol: "SPY", price: 565.10, sma20: 560.80, sma50: 552.40, sma200: 528.70, atr: 4.90 },
    { symbol: "IWM", price: 225.30, sma20: 222.10, sma50: 218.40, sma200: 207.60, atr: 3.20 },
    { symbol: "AAPL", price: 225.80, sma20: 222.40, sma50: 217.10, sma200: 205.30, atr: 3.10 },
    { symbol: "META", price: 640.50, sma20: 628.20, sma50: 612.30, sma200: 568.90, atr: 9.40 },
  ];

  const seedMarker = await getMeta("seed:tickers_done");
  // Back-fill marker for pre-fix deployments: if ANY of the default tickers is
  // present AND a watchlist row exists for it, treat seed as already complete.
  // Stamps the marker so the next branch can short-circuit cleanly.
  if (!seedMarker) {
    const anyExisting = await db.select().from(tickers).limit(1);
    const anyWatchlist = await db.select().from(watchlist).limit(1);
    if (anyExisting.length > 0 && anyWatchlist.length > 0) {
      await setMeta("seed:tickers_done", new Date().toISOString());
    }
  }
  const skipTickerSeed = (await getMeta("seed:tickers_done")) !== null;

  for (const t of seedTickers) {
    if (skipTickerSeed) break; // user already touched the watchlist — hands off.
    const existing = await db.select().from(tickers).where(eq(tickers.symbol, t.symbol)).limit(1);
    if (existing.length === 0) {
      const inserted = (await db.insert(tickers).values({
        symbol: t.symbol,
        tier: 1,
        currentPrice: t.price,
        manualOverride: null,
        priorDayClose: t.price * 0.998,
        sma20: t.sma20,
        sma50: t.sma50,
        sma200: t.sma200,
        atr14: t.atr,
        earningsDate: null,
      }).returning())[0];

      const anchor = t.sma20;
      const zoneLow = +(anchor - 0.25 * t.atr).toFixed(2);
      const zoneHigh = +(anchor + 0.5 * t.atr).toFixed(2);
      const stop = +(Math.min(zoneLow, t.sma50) - 0.25 * t.atr).toFixed(2);
      const tgt1 = +(t.price + 2 * (t.price - stop)).toFixed(2);
      const tgt2 = +(t.price + 3.5 * (t.price - stop)).toFixed(2);

      await db.insert(watchlist).values({
        tickerId: inserted.id,
        setupType: "TREND_PULLBACK",
        entryZoneLow: zoneLow,
        entryZoneHigh: zoneHigh,
        stop,
        t1: tgt1,
        t2: tgt2,
        state: "DORMANT",
        scoreComponents: "{}",
        totalScore: 0,
        grade: "Ignore",
      });
    }
  }
  // Stamp the marker once — future boots skip ticker seeding entirely.
  if (!skipTickerSeed) {
    await setMeta("seed:tickers_done", new Date().toISOString());
  }

  // LEAP reserve
  const reserveRows = await db.select().from(leapReserve).limit(1);
  if (reserveRows.length === 0) {
    await db.insert(leapReserve).values({ balance: 0, realizedRollPnlYtd: 0 });
  }

  // Initial equity history row
  const eqRows = await db.select().from(equityHistory).limit(1);
  if (eqRows.length === 0) {
    await db.insert(equityHistory).values({
      date: today,
      equity: 1000,
      drawdownPct: 0,
    });
  }
}

// Run migrations + seed at startup
export async function initStorage() {
  await runMigrations();
  try { await seedIfEmpty(); } catch (e) { console.error("seed failed", e); }
}

// ─── storage interface ────────────────────────────────────────────────────────
export const storage = {
  // settings
  async getSettings(): Promise<Settings> {
    const rows = await db.select().from(settings).limit(1);
    if (rows.length === 0) throw new Error("settings not seeded");
    return rows[0];
  },
  async updateSettings(patch: Partial<InsertSettings>): Promise<Settings> {
    const row = await this.getSettings();
    await db.update(settings).set(patch as any).where(eq(settings.id, row.id));
    return this.getSettings();
  },

  // tickers
  async listTickers(): Promise<Ticker[]> { return db.select().from(tickers); },
  async getTicker(id: number): Promise<Ticker | undefined> {
    const rows = await db.select().from(tickers).where(eq(tickers.id, id)).limit(1);
    return rows[0];
  },
  async getTickerBySymbol(symbol: string): Promise<Ticker | undefined> {
    const rows = await db.select().from(tickers).where(eq(tickers.symbol, symbol)).limit(1);
    return rows[0];
  },
  async updateTicker(id: number, patch: Partial<InsertTicker>): Promise<Ticker | undefined> {
    await db.update(tickers).set(patch as any).where(eq(tickers.id, id));
    return this.getTicker(id);
  },
  async bulkUpdatePrices(prices: Record<string, number>): Promise<void> {
    const all = await this.listTickers();
    for (const t of all) {
      if (prices[t.symbol] != null) {
        await db.update(tickers).set({ currentPrice: prices[t.symbol] }).where(eq(tickers.id, t.id));
      }
    }
  },

  // watchlist
  async listWatchlist(): Promise<WatchlistItem[]> {
    // Stable, deterministic ordering by user-controlled position, then id.
    // Excludes archived rows by default.
    return db.select().from(watchlist).where(eq(watchlist.archived, false)).orderBy(watchlist.position, watchlist.id);
  },
  async listArchivedWatchlist(): Promise<WatchlistItem[]> {
    return db.select().from(watchlist).where(eq(watchlist.archived, true)).orderBy(desc(watchlist.id));
  },
  async updateWatchlistItem(id: number, patch: Partial<InsertWatchlistItem>): Promise<WatchlistItem | undefined> {
    await db.update(watchlist).set(patch as any).where(eq(watchlist.id, id));
    const rows = await db.select().from(watchlist).where(eq(watchlist.id, id)).limit(1);
    return rows[0];
  },
  async createTickerWithWatchlist(symbol: string, price: number, tier = 2): Promise<{ ticker: Ticker; watchlist: WatchlistItem }> {
    const t = (await db.insert(tickers).values({
      symbol, tier, currentPrice: price, priorDayClose: price, sma20: price, sma50: price * 0.97, sma200: price * 0.92, atr14: price * 0.025,
    }).returning())[0];
    const w = (await db.insert(watchlist).values({
      tickerId: t.id, setupType: "TREND_PULLBACK",
      entryZoneLow: price * 0.97, entryZoneHigh: price * 1.005,
      stop: price * 0.94, t1: price * 1.10, t2: price * 1.18,
      state: "DORMANT", totalScore: 0, grade: "Ignore",
    }).returning())[0];
    return { ticker: t, watchlist: w };
  },
  async deleteWatchlistAndTicker(tickerId: number): Promise<void> {
    await db.delete(watchlist).where(eq(watchlist.tickerId, tickerId));
    await db.delete(tickers).where(eq(tickers.id, tickerId));
  },
  // Append a ticker to the end of the watchlist. If the ticker already exists
  // (by symbol), reuse it instead of creating a duplicate row.
  async addWatchlistBySymbol(symbol: string, price = 0): Promise<{ ticker: Ticker; watchlist: WatchlistItem }> {
    const sym = symbol.toUpperCase().trim();
    const existing = await db.select().from(tickers).where(eq(tickers.symbol, sym)).limit(1);
    let t: Ticker;
    if (existing.length > 0) {
      t = existing[0];
      const existingW = await db.select().from(watchlist).where(eq(watchlist.tickerId, t.id)).limit(1);
      if (existingW.length > 0) {
        // If it was archived, restore it instead of duplicating.
        if (existingW[0].archived) {
          await this.restoreWatchlistItem(existingW[0].id);
          const refreshed = await db.select().from(watchlist).where(eq(watchlist.id, existingW[0].id)).limit(1);
          return { ticker: t, watchlist: refreshed[0] };
        }
        return { ticker: t, watchlist: existingW[0] };
      }
    } else {
      // Reuse the existing factory which seeds default zones/SMAs.
      const created = await this.createTickerWithWatchlist(sym, price || 0, 2);
      t = created.ticker;
      // Stamp position so it appends to the end.
      const max = await pool.query<{ m: number | null }>(
        `SELECT MAX(position) AS m FROM watchlist`,
      );
      const nextPos = ((max.rows[0]?.m as any) ?? -1) + 1;
      await db.update(watchlist).set({ position: nextPos } as any).where(eq(watchlist.id, created.watchlist.id));
      const refreshed = await db.select().from(watchlist).where(eq(watchlist.id, created.watchlist.id)).limit(1);
      return { ticker: t, watchlist: refreshed[0] };
    }
    // Existing ticker, no watchlist row — create one.
    const max = await pool.query<{ m: number | null }>(
      `SELECT MAX(position) AS m FROM watchlist`,
    );
    const nextPos = ((max.rows[0]?.m as any) ?? -1) + 1;
    const w = (await db.insert(watchlist).values({
      tickerId: t.id, setupType: "TREND_PULLBACK",
      entryZoneLow: t.currentPrice * 0.97, entryZoneHigh: t.currentPrice * 1.005,
      stop: t.currentPrice * 0.94, t1: t.currentPrice * 1.10, t2: t.currentPrice * 1.18,
      state: "DORMANT", totalScore: 0, grade: "Ignore", position: nextPos,
    } as any).returning())[0];
    return { ticker: t, watchlist: w };
  },
  async removeWatchlistItem(id: number): Promise<void> {
    // Soft-archive instead of hard-delete. Keeps the row + ticker so:
    //  1. Per-deploy seed cannot resurrect it (the row already exists).
    //  2. User can restore it from the Archived section.
    //  3. Historical trades referencing the ticker stay valid.
    await db.update(watchlist)
      .set({ archived: true, archivedAt: new Date().toISOString() } as any)
      .where(eq(watchlist.id, id));
  },
  async restoreWatchlistItem(id: number): Promise<void> {
    // Restore to the end of the active list.
    const max = await pool.query<{ m: number | null }>(
      `SELECT MAX(position) AS m FROM watchlist WHERE archived = false`,
    );
    const nextPos = ((max.rows[0]?.m as any) ?? -1) + 1;
    await db.update(watchlist)
      .set({ archived: false, archivedAt: null, position: nextPos } as any)
      .where(eq(watchlist.id, id));
  },
  async purgeWatchlistItem(id: number): Promise<void> {
    // Hard-delete from the archived section. Cleans up the ticker row too
    // when no other watchlist row (active or archived) references it.
    const rows = await db.select().from(watchlist).where(eq(watchlist.id, id)).limit(1);
    if (rows.length === 0) return;
    const tickerId = rows[0].tickerId;
    await db.delete(watchlist).where(eq(watchlist.id, id));
    const others = await db.select().from(watchlist).where(eq(watchlist.tickerId, tickerId)).limit(1);
    if (others.length === 0) {
      await db.delete(tickers).where(eq(tickers.id, tickerId));
    }
  },
  async reorderWatchlist(orderedIds: number[]): Promise<void> {
    // Single transactional pass — lower contention than N round-trips.
    for (let i = 0; i < orderedIds.length; i++) {
      await db.update(watchlist).set({ position: i } as any).where(eq(watchlist.id, orderedIds[i]));
    }
  },

  // trades — main lists exclude archived rows.
  async listTrades(): Promise<Trade[]> {
    return db.select().from(trades).where(eq(trades.archived, false)).orderBy(desc(trades.openedAt));
  },
  async listOpenTrades(): Promise<Trade[]> {
    return db.select().from(trades).where(and(eq(trades.status, "OPEN"), eq(trades.archived, false)));
  },
  async listPendingTrades(): Promise<Trade[]> {
    return db.select().from(trades).where(and(eq(trades.status, "PENDING"), eq(trades.archived, false))).orderBy(desc(trades.openedAt));
  },
  async listArchivedTrades(): Promise<Trade[]> {
    return db.select().from(trades).where(eq(trades.archived, true)).orderBy(desc(trades.openedAt));
  },
  // Permanently remove a single trade (archived OR not). Used by the
  // "Delete" button on the Archived Trades panel.
  async deleteTradeForever(id: number): Promise<void> {
    await db.delete(trades).where(eq(trades.id, id));
  },
  // Permanently remove EVERY archived trade. Returns count deleted.
  async deleteAllArchivedTrades(): Promise<number> {
    const result = await db.delete(trades).where(eq(trades.archived, true)).returning();
    return result.length;
  },
  // Auto-cleanup: permanently delete archived trades whose closedAt (or
  // openedAt fallback) is older than `days` days. Returns count deleted.
  async pruneArchivedOlderThan(days: number): Promise<number> {
    const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
    const cutoffIso = new Date(cutoffMs).toISOString();
    // Postgres can compare ISO 8601 strings lexicographically (sortable).
    // Use COALESCE so trades without closedAt fall back to openedAt.
    const result = await pool.query(
      `DELETE FROM trades WHERE archived = true AND COALESCE(closed_at, opened_at) < $1 RETURNING id`,
      [cutoffIso],
    );
    return result.rowCount || 0;
  },
  async getTrade(id: number): Promise<Trade | undefined> {
    const rows = await db.select().from(trades).where(eq(trades.id, id)).limit(1);
    return rows[0];
  },
  async createTrade(t: InsertTrade): Promise<Trade> {
    return (await db.insert(trades).values(t as any).returning())[0];
  },
  async updateTrade(id: number, patch: Partial<InsertTrade>): Promise<Trade | undefined> {
    await db.update(trades).set(patch as any).where(eq(trades.id, id));
    return this.getTrade(id);
  },
  async setTradeArchived(id: number, archived: boolean): Promise<Trade | undefined> {
    await db.update(trades).set({ archived } as any).where(eq(trades.id, id));
    return this.getTrade(id);
  },

  // alerts
  async listAlerts(): Promise<Alert[]> { return db.select().from(alerts).orderBy(desc(alerts.firedAt)); },
  async createAlert(a: InsertAlert): Promise<Alert> {
    return (await db.insert(alerts).values(a as any).returning())[0];
  },
  async acknowledgeAlert(id: number): Promise<void> {
    await db.update(alerts).set({ acknowledged: true }).where(eq(alerts.id, id));
  },
  async deleteAlert(id: number): Promise<void> {
    await db.delete(alerts).where(eq(alerts.id, id));
  },
  async clearAllAlerts(): Promise<number> {
    const result = await db.delete(alerts).returning();
    return result.length;
  },

  // journal
  async listJournal(): Promise<JournalEntry[]> {
    return db.select().from(journalEntries).orderBy(desc(journalEntries.periodEnd));
  },
  async upsertJournal(j: InsertJournalEntry): Promise<JournalEntry> {
    return (await db.insert(journalEntries).values(j as any).returning())[0];
  },

  // LEAP
  async listLeapPositions(): Promise<LeapPosition[]> { return db.select().from(leapPositions); },
  async createLeapPosition(p: InsertLeapPosition): Promise<LeapPosition> {
    return (await db.insert(leapPositions).values(p as any).returning())[0];
  },
  async updateLeapPosition(id: number, patch: Partial<InsertLeapPosition>): Promise<LeapPosition | undefined> {
    await db.update(leapPositions).set(patch as any).where(eq(leapPositions.id, id));
    const rows = await db.select().from(leapPositions).where(eq(leapPositions.id, id)).limit(1);
    return rows[0];
  },
  async deleteLeapPosition(id: number): Promise<void> {
    await db.delete(leapPositions).where(eq(leapPositions.id, id));
  },

  // LEAP reserve
  async getLeapReserve(): Promise<LeapReserve> {
    const rows = await db.select().from(leapReserve).limit(1);
    if (rows.length === 0) throw new Error("leap reserve not seeded");
    return rows[0];
  },
  async updateLeapReserve(patch: Partial<InsertLeapReserve>): Promise<LeapReserve> {
    const r = await this.getLeapReserve();
    await db.update(leapReserve).set(patch as any).where(eq(leapReserve.id, r.id));
    return this.getLeapReserve();
  },

  // equity history
  async listEquityHistory(): Promise<EquityHistory[]> { return db.select().from(equityHistory); },
  async appendEquity(e: InsertEquityHistory): Promise<EquityHistory> {
    return (await db.insert(equityHistory).values(e as any).returning())[0];
  },

  // Chizzle scores
  async listChizzleScores(): Promise<ChizzleScore[]> {
    return db.select().from(chizzleScores).orderBy(desc(chizzleScores.date));
  },
  async upsertChizzleScore(s: InsertChizzleScore): Promise<ChizzleScore> {
    return (await db.insert(chizzleScores).values(s as any).returning())[0];
  },

  // price ticks
  async appendPriceTick(t: InsertPriceTick): Promise<PriceTick> {
    const inserted = (await db.insert(priceTicks).values(t as any).returning())[0];
    // Trim to last 1000 ticks per symbol
    try {
      await pool.query(
        `DELETE FROM price_ticks WHERE symbol = $1 AND id NOT IN (
          SELECT id FROM price_ticks WHERE symbol = $1 ORDER BY ts DESC LIMIT 1000
        )`,
        [t.symbol]
      );
    } catch (e) { /* ignore */ }
    return inserted;
  },
  async listPriceTicks(symbol: string, limit = 200): Promise<PriceTick[]> {
    const res = await pool.query(
      `SELECT id, symbol, price, ts FROM price_ticks WHERE symbol = $1 ORDER BY ts DESC LIMIT $2`,
      [symbol, limit]
    );
    return res.rows as PriceTick[];
  },
  async countPriceTicks(): Promise<number> {
    const res = await pool.query(`SELECT COUNT(*) as n FROM price_ticks`);
    return Number(res.rows[0].n);
  },

  // regime state (singleton)
  async getRegimeState(): Promise<RegimeState> {
    const rows = await db.select().from(regimeState).limit(1);
    if (rows.length > 0) return rows[0];
    await db.insert(regimeState).values({
      currentRegime: "yellow",
      currentRegimeSince: new Date().toISOString(),
      pendingRegime: null,
      pendingSince: null,
      pendingConsecutiveCount: 0,
      manualOverride: false,
      manualOverrideRegime: null,
      lastClassifiedAt: "",
      lastError: null,
      stale: false,
    });
    const rows2 = await db.select().from(regimeState).limit(1);
    return rows2[0];
  },
  async updateRegimeState(patch: Partial<InsertRegimeState>): Promise<RegimeState> {
    const cur = await this.getRegimeState();
    await db.update(regimeState).set(patch as any).where(eq(regimeState.id, cur.id));
    return this.getRegimeState();
  },
  async appendRegimeInputs(row: InsertRegimeInputs): Promise<RegimeInputsRow> {
    const inserted = (await db.insert(regimeInputs).values(row as any).returning())[0];
    // Trim to last 90 rows
    try {
      await pool.query(`
        DELETE FROM regime_inputs WHERE id NOT IN (
          SELECT id FROM regime_inputs ORDER BY computed_at DESC LIMIT 90
        )
      `);
    } catch (e) { /* ignore */ }
    return inserted;
  },
  async listRegimeInputs(limit = 30): Promise<RegimeInputsRow[]> {
    return db.select().from(regimeInputs).orderBy(desc(regimeInputs.computedAt)).limit(limit);
  },
  async latestRegimeInputs(): Promise<RegimeInputsRow | undefined> {
    const rows = await db.select().from(regimeInputs).orderBy(desc(regimeInputs.computedAt)).limit(1);
    return rows[0];
  },

  // ─── setup candidates ──────────────────────────────────────────────────
  async listSetupCandidates(): Promise<SetupCandidateRow[]> {
    return db.select().from(setupCandidates);
  },
  async getSetupCandidatesForTicker(ticker: string): Promise<SetupCandidateRow[]> {
    return db.select().from(setupCandidates).where(eq(setupCandidates.ticker, ticker));
  },
  async getSetupCandidate(ticker: string, setup: string): Promise<SetupCandidateRow | undefined> {
    const rows = await pool.query(
      `SELECT * FROM setup_candidates WHERE ticker = $1 AND setup = $2`,
      [ticker, setup]
    );
    return rows.rows[0] as any;
  },
  async upsertSetupCandidate(row: InsertSetupCandidate): Promise<SetupCandidateRow> {
    const existing = await this.getSetupCandidate(row.ticker, row.setup);
    if (existing) {
      await db.update(setupCandidates).set(row as any).where(eq(setupCandidates.id, (existing as any).id));
      return (await this.getSetupCandidate(row.ticker, row.setup))!;
    }
    return (await db.insert(setupCandidates).values(row as any).returning())[0];
  },
  async recordSetupTransition(row: InsertSetupHistory): Promise<SetupHistoryRow> {
    const inserted = (await db.insert(setupHistory).values(row as any).returning())[0];
    // Keep last 30 days only
    try {
      const cutoff = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
      await pool.query(`DELETE FROM setup_history WHERE transitioned_at < $1`, [cutoff]);
    } catch (e) { /* ignore */ }
    return inserted;
  },
  async getRecentSetupTransitions(limit = 20): Promise<SetupHistoryRow[]> {
    return db.select().from(setupHistory).orderBy(desc(setupHistory.transitionedAt)).limit(limit);
  },

  // ── trade lifecycle events (audit log) ─────────────────────────────
  async createTradeEvent(row: InsertTradeEvent): Promise<TradeEvent> {
    return (await db.insert(tradeEvents).values(row as any).returning())[0];
  },
  async listTradeEvents(tradeId: number): Promise<TradeEvent[]> {
    return db.select().from(tradeEvents).where(eq(tradeEvents.tradeId, tradeId)).orderBy(desc(tradeEvents.occurredAt));
  },

  // Mark T1 fill: set t1Filled=true, t1FilledAt=now, start trailing at breakeven.
  async applyT1Fill(tradeId: number, livePrice: number, newTrailingStop: number): Promise<Trade | undefined> {
    const now = new Date().toISOString();
    await db.update(trades)
      .set({
        t1Filled: true,
        t1FilledAt: now,
        trailingStop: newTrailingStop,
        trailingStopUpdatedAt: now,
        highWaterMark: livePrice,
      } as any)
      .where(eq(trades.id, tradeId));
    return this.getTrade(tradeId);
  },

  // Mark T2 fill: set t2Filled, t2FilledAt, exit, close trade.
  async applyT2Fill(tradeId: number, exitPrice: number, rMultiple: number): Promise<Trade | undefined> {
    const now = new Date().toISOString();
    await db.update(trades)
      .set({
        t2Filled: true,
        t2FilledAt: now,
        exit: exitPrice,
        exitReason: "T2 target hit",
        rMultiple,
        status: "CLOSED",
        closedAt: now,
      } as any)
      .where(eq(trades.id, tradeId));
    return this.getTrade(tradeId);
  },

  // Update trailing stop and/or high-water mark.
  async applyTrailUpdate(tradeId: number, newTrailingStop: number | undefined, newHighWaterMark: number | undefined): Promise<Trade | undefined> {
    const now = new Date().toISOString();
    const patch: any = {};
    if (newTrailingStop != null) {
      patch.trailingStop = newTrailingStop;
      patch.trailingStopUpdatedAt = now;
    }
    if (newHighWaterMark != null) {
      patch.highWaterMark = newHighWaterMark;
    }
    if (Object.keys(patch).length > 0) {
      await db.update(trades).set(patch).where(eq(trades.id, tradeId));
    }
    return this.getTrade(tradeId);
  },

  // Stop-out: close at given exit, persist exit reason + R.
  async applyStopHit(tradeId: number, exitPrice: number, exitReason: string, rMultiple: number): Promise<Trade | undefined> {
    const now = new Date().toISOString();
    await db.update(trades)
      .set({
        exit: exitPrice,
        exitReason,
        rMultiple,
        status: "CLOSED",
        closedAt: now,
      } as any)
      .where(eq(trades.id, tradeId));
    return this.getTrade(tradeId);
  },

  // Journal patch: emotion/confidence/reflection on an existing trade.
  async updateTradeJournal(tradeId: number, patch: { confidenceRating?: number; emotionTag?: string; reflection?: string }): Promise<Trade | undefined> {
    const clean: any = {};
    if (patch.confidenceRating != null) clean.confidenceRating = patch.confidenceRating;
    if (patch.emotionTag != null) clean.emotionTag = patch.emotionTag;
    if (patch.reflection != null) clean.reflection = patch.reflection;
    if (Object.keys(clean).length > 0) {
      await db.update(trades).set(clean).where(eq(trades.id, tradeId));
    }
    return this.getTrade(tradeId);
  },

  // signal history (Hammer / Engulfing confirmation log)
  async listSignalHistory(opts: { limit?: number; ticker?: string } = {}): Promise<SignalHistory[]> {
    const limit = Math.min(Math.max(opts.limit ?? 500, 1), 2000);
    let q = db.select().from(signalHistory).orderBy(desc(signalHistory.timestamp));
    if (opts.ticker) {
      q = db.select().from(signalHistory).where(eq(signalHistory.ticker, opts.ticker)).orderBy(desc(signalHistory.timestamp)) as any;
    }
    const rows = await (q as any).limit(limit);
    return rows as SignalHistory[];
  },
  async createSignalHistory(entry: InsertSignalHistory): Promise<SignalHistory | null> {
    // Dedup via the (ticker, pattern_type, timestamp) unique index.
    // ON CONFLICT DO NOTHING means the detector can re-emit without growing the table.
    const result = await pool.query(
      `INSERT INTO signal_history (
        ticker, pattern_type, timestamp,
        setup_candle_index, confirmation_candle_index,
        setup_candle_low, confirmation_candle_low, confirmation_close,
        retest_zone_upper, retest_zone_lower,
        score, score_breakdown,
        volume, volume_vs_average_20,
        marker_type, marker_position, color,
        sound_played, notification_sent, sma_proximity, created_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
      )
      ON CONFLICT (ticker, pattern_type, timestamp) DO NOTHING
      RETURNING *`,
      [
        entry.ticker, entry.patternType, entry.timestamp,
        entry.setupCandleIndex, entry.confirmationCandleIndex,
        entry.setupCandleLow, entry.confirmationCandleLow, entry.confirmationClose,
        entry.retestZoneUpper, entry.retestZoneLower,
        entry.score, entry.scoreBreakdown ?? "[]",
        entry.volume ?? 0, entry.volumeVsAverage20 ?? 0,
        entry.markerType ?? "confirmation", entry.markerPosition ?? 0, entry.color ?? "#00E5A8",
        entry.soundPlayed ?? false, entry.notificationSent ?? false,
        entry.smaProximity ?? "", entry.createdAt,
      ]
    );
    if (result.rowCount === 0) return null;
    const r = result.rows[0];
    return {
      id: r.id, ticker: r.ticker, patternType: r.pattern_type, timestamp: r.timestamp,
      setupCandleIndex: r.setup_candle_index, confirmationCandleIndex: r.confirmation_candle_index,
      setupCandleLow: r.setup_candle_low, confirmationCandleLow: r.confirmation_candle_low,
      confirmationClose: r.confirmation_close,
      retestZoneUpper: r.retest_zone_upper, retestZoneLower: r.retest_zone_lower,
      score: r.score, scoreBreakdown: r.score_breakdown,
      volume: r.volume, volumeVsAverage20: r.volume_vs_average_20,
      markerType: r.marker_type, markerPosition: r.marker_position, color: r.color,
      soundPlayed: r.sound_played, notificationSent: r.notification_sent,
      smaProximity: r.sma_proximity, createdAt: r.created_at,
    } as SignalHistory;
  },
  async clearSignalHistory(): Promise<number> {
    const result = await pool.query("DELETE FROM signal_history");
    return result.rowCount ?? 0;
  },

  // wipe (reset)
  async resetAll(): Promise<void> {
    await db.delete(trades);
    await db.delete(alerts);
    await db.delete(journalEntries);
    await db.delete(leapPositions);
    await db.delete(equityHistory);
    await db.delete(chizzleScores);
    await db.delete(watchlist);
    await db.delete(tickers);
    await db.delete(leapReserve);
    await db.delete(settings);
    await seedIfEmpty();
  },
};
