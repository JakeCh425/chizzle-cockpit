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
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc } from "drizzle-orm";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

// Run migrations inline — keep template self-contained
sqlite.exec(`
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equity REAL NOT NULL DEFAULT 1000,
  regime TEXT NOT NULL DEFAULT 'GREEN',
  regime_override INTEGER NOT NULL DEFAULT 0,
  regime_changed_at TEXT NOT NULL DEFAULT '',
  watchlist_tier INTEGER NOT NULL DEFAULT 1,
  risk_pct_green REAL NOT NULL DEFAULT 3,
  risk_pct_yellow REAL NOT NULL DEFAULT 2,
  risk_pct_red REAL NOT NULL DEFAULT 1,
  max_positions_green INTEGER NOT NULL DEFAULT 4,
  max_positions_yellow INTEGER NOT NULL DEFAULT 3,
  max_positions_red INTEGER NOT NULL DEFAULT 2,
  max_open_risk_pct REAL NOT NULL DEFAULT 6,
  min_rr REAL NOT NULL DEFAULT 2.0
);

CREATE TABLE IF NOT EXISTS tickers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL UNIQUE,
  tier INTEGER NOT NULL DEFAULT 1,
  current_price REAL NOT NULL DEFAULT 0,
  manual_override REAL,
  prior_day_close REAL NOT NULL DEFAULT 0,
  sma_20 REAL NOT NULL DEFAULT 0,
  sma_50 REAL NOT NULL DEFAULT 0,
  sma_200 REAL NOT NULL DEFAULT 0,
  atr_14 REAL NOT NULL DEFAULT 0,
  earnings_date TEXT
);

CREATE TABLE IF NOT EXISTS watchlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker_id INTEGER NOT NULL,
  setup_type TEXT NOT NULL DEFAULT 'TREND_PULLBACK',
  entry_zone_low REAL NOT NULL DEFAULT 0,
  entry_zone_high REAL NOT NULL DEFAULT 0,
  stop REAL NOT NULL DEFAULT 0,
  t1 REAL NOT NULL DEFAULT 0,
  t2 REAL NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'DORMANT',
  score_components TEXT NOT NULL DEFAULT '{}',
  total_score REAL NOT NULL DEFAULT 0,
  grade TEXT NOT NULL DEFAULT 'Ignore'
);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  setup TEXT NOT NULL,
  regime_at_entry TEXT NOT NULL,
  entry REAL NOT NULL,
  stop REAL NOT NULL,
  t1 REAL NOT NULL,
  t2 REAL,
  exit REAL,
  shares INTEGER NOT NULL,
  risk_dollars REAL NOT NULL,
  rr REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  exit_reason TEXT,
  r_multiple REAL,
  plan_followed INTEGER,
  lesson_tag TEXT,
  thesis TEXT NOT NULL DEFAULT '',
  emotional_state INTEGER NOT NULL DEFAULT 5,
  opened_at TEXT NOT NULL,
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS trade_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  price REAL,
  note TEXT,
  occurred_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  fired_at TEXT NOT NULL,
  acknowledged INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  decisions_text TEXT NOT NULL DEFAULT '',
  process_change_text TEXT NOT NULL DEFAULT '',
  leak_flags TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS leap_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  contracts INTEGER NOT NULL,
  strike REAL NOT NULL,
  expiry TEXT NOT NULL,
  delta_at_entry REAL NOT NULL,
  premium_paid REAL NOT NULL,
  current_premium REAL NOT NULL,
  current_delta REAL NOT NULL,
  opened_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leap_reserve (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  balance REAL NOT NULL DEFAULT 0,
  realized_roll_pnl_ytd REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS equity_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  equity REAL NOT NULL,
  drawdown_pct REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chizzle_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  components TEXT NOT NULL DEFAULT '{}',
  total REAL NOT NULL DEFAULT 0,
  identity_state TEXT NOT NULL DEFAULT 'WORKING'
);

CREATE TABLE IF NOT EXISTS price_ticks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  price REAL NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_price_ticks_symbol_ts ON price_ticks(symbol, ts DESC);

CREATE TABLE IF NOT EXISTS regime_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  current_regime TEXT NOT NULL DEFAULT 'yellow',
  current_regime_since TEXT NOT NULL DEFAULT '',
  pending_regime TEXT,
  pending_since TEXT,
  pending_consecutive_count INTEGER NOT NULL DEFAULT 0,
  manual_override INTEGER NOT NULL DEFAULT 0,
  manual_override_regime TEXT,
  last_classified_at TEXT NOT NULL DEFAULT '',
  last_error TEXT,
  stale INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS regime_inputs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  computed_at TEXT NOT NULL,
  spy_price REAL NOT NULL DEFAULT 0,
  spy_sma20 REAL NOT NULL DEFAULT 0,
  spy_sma50 REAL NOT NULL DEFAULT 0,
  spy_sma200 REAL NOT NULL DEFAULT 0,
  spy_sma20_rising INTEGER NOT NULL DEFAULT 0,
  spy_sma50_rising INTEGER NOT NULL DEFAULT 0,
  spy_above_20 INTEGER NOT NULL DEFAULT 0,
  spy_above_50 INTEGER NOT NULL DEFAULT 0,
  spy_above_200 INTEGER NOT NULL DEFAULT 0,
  qqq_price REAL NOT NULL DEFAULT 0,
  qqq_sma20 REAL NOT NULL DEFAULT 0,
  qqq_sma50 REAL NOT NULL DEFAULT 0,
  qqq_sma200 REAL NOT NULL DEFAULT 0,
  qqq_sma20_rising INTEGER NOT NULL DEFAULT 0,
  qqq_sma50_rising INTEGER NOT NULL DEFAULT 0,
  qqq_above_20 INTEGER NOT NULL DEFAULT 0,
  qqq_above_50 INTEGER NOT NULL DEFAULT 0,
  qqq_above_200 INTEGER NOT NULL DEFAULT 0,
  vix_level REAL NOT NULL DEFAULT 0,
  vix_slope_5d REAL NOT NULL DEFAULT 0,
  breadth_proxy_pct REAL NOT NULL DEFAULT 50,
  rsp_above_50sma INTEGER NOT NULL DEFAULT 0,
  rsp_spy_ratio_trend REAL NOT NULL DEFAULT 1,
  distribution_days INTEGER NOT NULL DEFAULT 0,
  distribution_day_dates TEXT NOT NULL DEFAULT '[]',
  follow_through_day INTEGER NOT NULL DEFAULT 0,
  raw_regime TEXT NOT NULL DEFAULT 'yellow'
);
CREATE INDEX IF NOT EXISTS idx_regime_inputs_computed_at ON regime_inputs(computed_at DESC);

CREATE TABLE IF NOT EXISTS setup_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  setup TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'dormant',
  qualifications_passed INTEGER NOT NULL DEFAULT 0,
  qualifications_total INTEGER NOT NULL DEFAULT 6,
  qualification_details TEXT NOT NULL DEFAULT '[]',
  entry_zone_low REAL,
  entry_zone_high REAL,
  stop REAL,
  t1 REAL,
  t2 REAL,
  rr_to_t1 REAL,
  atr14 REAL NOT NULL DEFAULT 0,
  swing_high REAL,
  pullback_pct REAL,
  base_pivot REAL,
  base_depth REAL,
  base_length INTEGER,
  trigger_fired INTEGER NOT NULL DEFAULT 0,
  trigger_note TEXT,
  disqualifiers TEXT NOT NULL DEFAULT '[]',
  last_computed_at TEXT NOT NULL DEFAULT '',
  regime_eligible INTEGER NOT NULL DEFAULT 1,
  regime_blocked_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_setup_candidates_ticker_setup ON setup_candidates(ticker, setup);

CREATE TABLE IF NOT EXISTS setup_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  setup TEXT NOT NULL,
  prev_state TEXT NOT NULL DEFAULT '',
  new_state TEXT NOT NULL,
  transitioned_at TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_setup_history_at ON setup_history(transitioned_at DESC);
`);

// ─── ALTER TABLE fallbacks for existing DBs ──────────────────────────────────
// SQLite's CREATE TABLE IF NOT EXISTS won't add new columns to an existing
// table. Wrap each ALTER in try/catch so it's a no-op when the column already
// exists.
function safeAlter(sql: string): void {
  try {
    sqlite.exec(sql);
  } catch (e: any) {
    if (!/duplicate column name/i.test(String(e?.message ?? ""))) {
      // Surface unexpected errors but never crash boot.
      console.warn("[storage] safeAlter:", sql, e?.message);
    }
  }
}
safeAlter("ALTER TABLE setup_candidates ADD COLUMN regime_eligible INTEGER NOT NULL DEFAULT 1");
safeAlter("ALTER TABLE setup_candidates ADD COLUMN regime_blocked_reason TEXT");

// ── trades: lifecycle + classifier fields (added across Batches 2 & 3) ──────
safeAlter("ALTER TABLE trades ADD COLUMN t1_filled INTEGER NOT NULL DEFAULT 0");
safeAlter("ALTER TABLE trades ADD COLUMN t1_filled_at TEXT");
safeAlter("ALTER TABLE trades ADD COLUMN t2_filled INTEGER NOT NULL DEFAULT 0");
safeAlter("ALTER TABLE trades ADD COLUMN t2_filled_at TEXT");
safeAlter("ALTER TABLE trades ADD COLUMN trailing_stop REAL");
safeAlter("ALTER TABLE trades ADD COLUMN trailing_stop_updated_at TEXT");
safeAlter("ALTER TABLE trades ADD COLUMN high_water_mark REAL");
safeAlter("ALTER TABLE trades ADD COLUMN quality_at_entry TEXT");
safeAlter("ALTER TABLE trades ADD COLUMN risk_multiplier_at_entry REAL");
safeAlter("ALTER TABLE trades ADD COLUMN confidence_rating INTEGER");
safeAlter("ALTER TABLE trades ADD COLUMN emotion_tag TEXT");
safeAlter("ALTER TABLE trades ADD COLUMN reflection TEXT");

export const db = drizzle(sqlite);

// ─── seed ─────────────────────────────────────────────────────────────────────
function seedIfEmpty() {
  const today = new Date().toISOString().slice(0, 10);

  // settings
  const settingsRow = db.select().from(settings).get();
  if (!settingsRow) {
    db.insert(settings).values({
      equity: 1000,
      regime: "GREEN",
      regimeOverride: false,
      regimeChangedAt: new Date().toISOString(),
      watchlistTier: 1,
      riskPctGreen: 3,
      riskPctYellow: 2,
      riskPctRed: 1,
      maxPositionsGreen: 4,
      maxPositionsYellow: 3,
      maxPositionsRed: 2,
      maxOpenRiskPct: 6,
      minRR: 2.0,
    }).run();
  }

  // Tier 1 tickers with realistic May 2026 anchor prices
  const seedTickers: Array<{ symbol: string; price: number; sma20: number; sma50: number; sma200: number; atr: number }> = [
    { symbol: "SMH", price: 285.40, sma20: 278.20, sma50: 270.10, sma200: 245.30, atr: 6.80 },
    { symbol: "QQQ", price: 485.20, sma20: 478.50, sma50: 468.20, sma200: 440.10, atr: 5.40 },
    { symbol: "SPY", price: 565.10, sma20: 560.80, sma50: 552.40, sma200: 528.70, atr: 4.90 },
    { symbol: "IWM", price: 225.30, sma20: 222.10, sma50: 218.40, sma200: 207.60, atr: 3.20 },
    { symbol: "AAPL", price: 225.80, sma20: 222.40, sma50: 217.10, sma200: 205.30, atr: 3.10 },
    { symbol: "META", price: 640.50, sma20: 628.20, sma50: 612.30, sma200: 568.90, atr: 9.40 },
  ];

  for (const t of seedTickers) {
    const existing = db.select().from(tickers).where(eq(tickers.symbol, t.symbol)).get();
    if (!existing) {
      const inserted = db.insert(tickers).values({
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
      }).returning().get();

      // Build entry zone from a simple recent-pullback heuristic:
      //   zone_low  = max(10ema≈sma20, sma20) - 0.25*ATR
      //   zone_high = max(10ema≈sma20, sma20) + 0.50*ATR
      const anchor = t.sma20;
      const zoneLow = +(anchor - 0.25 * t.atr).toFixed(2);
      const zoneHigh = +(anchor + 0.5 * t.atr).toFixed(2);
      const stop = +(Math.min(zoneLow, t.sma50) - 0.25 * t.atr).toFixed(2);
      const tgt1 = +(t.price + 2 * (t.price - stop)).toFixed(2); // require ≥ 2R
      const tgt2 = +(t.price + 3.5 * (t.price - stop)).toFixed(2);

      db.insert(watchlist).values({
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
      }).run();
    }
  }

  // LEAP reserve
  const reserveRow = db.select().from(leapReserve).get();
  if (!reserveRow) {
    db.insert(leapReserve).values({ balance: 0, realizedRollPnlYtd: 0 }).run();
  }

  // Initial equity history row
  const eqRow = db.select().from(equityHistory).get();
  if (!eqRow) {
    db.insert(equityHistory).values({
      date: today,
      equity: 1000,
      drawdownPct: 0,
    }).run();
  }
}

try { seedIfEmpty(); } catch (e) { console.error("seed failed", e); }

// ─── storage interface ────────────────────────────────────────────────────────
export const storage = {
  // settings
  getSettings(): Settings {
    const row = db.select().from(settings).get();
    if (!row) throw new Error("settings not seeded");
    return row;
  },
  updateSettings(patch: Partial<InsertSettings>): Settings {
    const row = this.getSettings();
    db.update(settings).set(patch as any).where(eq(settings.id, row.id)).run();
    return this.getSettings();
  },

  // tickers
  listTickers(): Ticker[] { return db.select().from(tickers).all(); },
  getTicker(id: number): Ticker | undefined { return db.select().from(tickers).where(eq(tickers.id, id)).get(); },
  getTickerBySymbol(symbol: string): Ticker | undefined { return db.select().from(tickers).where(eq(tickers.symbol, symbol)).get(); },
  updateTicker(id: number, patch: Partial<InsertTicker>): Ticker | undefined {
    db.update(tickers).set(patch as any).where(eq(tickers.id, id)).run();
    return this.getTicker(id);
  },
  bulkUpdatePrices(prices: Record<string, number>) {
    const all = this.listTickers();
    for (const t of all) {
      if (prices[t.symbol] != null) {
        db.update(tickers).set({ currentPrice: prices[t.symbol] }).where(eq(tickers.id, t.id)).run();
      }
    }
  },

  // watchlist
  listWatchlist(): WatchlistItem[] { return db.select().from(watchlist).all(); },
  updateWatchlistItem(id: number, patch: Partial<InsertWatchlistItem>): WatchlistItem | undefined {
    db.update(watchlist).set(patch as any).where(eq(watchlist.id, id)).run();
    return db.select().from(watchlist).where(eq(watchlist.id, id)).get();
  },
  createTickerWithWatchlist(symbol: string, price: number, tier = 2): { ticker: Ticker; watchlist: WatchlistItem } {
    const t = db.insert(tickers).values({
      symbol, tier, currentPrice: price, priorDayClose: price, sma20: price, sma50: price * 0.97, sma200: price * 0.92, atr14: price * 0.025,
    }).returning().get();
    const w = db.insert(watchlist).values({
      tickerId: t.id, setupType: "TREND_PULLBACK",
      entryZoneLow: price * 0.97, entryZoneHigh: price * 1.005,
      stop: price * 0.94, t1: price * 1.10, t2: price * 1.18,
      state: "DORMANT", totalScore: 0, grade: "Ignore",
    }).returning().get();
    return { ticker: t, watchlist: w };
  },
  deleteWatchlistAndTicker(tickerId: number) {
    db.delete(watchlist).where(eq(watchlist.tickerId, tickerId)).run();
    db.delete(tickers).where(eq(tickers.id, tickerId)).run();
  },

  // trades
  listTrades(): Trade[] { return db.select().from(trades).orderBy(desc(trades.openedAt)).all(); },
  listOpenTrades(): Trade[] { return db.select().from(trades).where(eq(trades.status, "OPEN")).all(); },
  createTrade(t: InsertTrade): Trade {
    return db.insert(trades).values(t as any).returning().get();
  },
  updateTrade(id: number, patch: Partial<InsertTrade>): Trade | undefined {
    db.update(trades).set(patch as any).where(eq(trades.id, id)).run();
    return db.select().from(trades).where(eq(trades.id, id)).get();
  },

  // alerts
  listAlerts(): Alert[] { return db.select().from(alerts).orderBy(desc(alerts.firedAt)).all(); },
  createAlert(a: InsertAlert): Alert { return db.insert(alerts).values(a as any).returning().get(); },
  acknowledgeAlert(id: number) { db.update(alerts).set({ acknowledged: true }).where(eq(alerts.id, id)).run(); },

  // journal
  listJournal(): JournalEntry[] { return db.select().from(journalEntries).orderBy(desc(journalEntries.periodEnd)).all(); },
  upsertJournal(j: InsertJournalEntry): JournalEntry { return db.insert(journalEntries).values(j as any).returning().get(); },

  // LEAP
  listLeapPositions(): LeapPosition[] { return db.select().from(leapPositions).all(); },
  createLeapPosition(p: InsertLeapPosition): LeapPosition { return db.insert(leapPositions).values(p as any).returning().get(); },
  updateLeapPosition(id: number, patch: Partial<InsertLeapPosition>): LeapPosition | undefined {
    db.update(leapPositions).set(patch as any).where(eq(leapPositions.id, id)).run();
    return db.select().from(leapPositions).where(eq(leapPositions.id, id)).get();
  },
  deleteLeapPosition(id: number) { db.delete(leapPositions).where(eq(leapPositions.id, id)).run(); },

  // LEAP reserve
  getLeapReserve(): LeapReserve {
    const r = db.select().from(leapReserve).get();
    if (!r) throw new Error("leap reserve not seeded");
    return r;
  },
  updateLeapReserve(patch: Partial<InsertLeapReserve>): LeapReserve {
    const r = this.getLeapReserve();
    db.update(leapReserve).set(patch as any).where(eq(leapReserve.id, r.id)).run();
    return this.getLeapReserve();
  },

  // equity history
  listEquityHistory(): EquityHistory[] { return db.select().from(equityHistory).all(); },
  appendEquity(e: InsertEquityHistory): EquityHistory { return db.insert(equityHistory).values(e as any).returning().get(); },

  // Chizzle scores
  listChizzleScores(): ChizzleScore[] { return db.select().from(chizzleScores).orderBy(desc(chizzleScores.date)).all(); },
  upsertChizzleScore(s: InsertChizzleScore): ChizzleScore { return db.insert(chizzleScores).values(s as any).returning().get(); },

  // price ticks
  appendPriceTick(t: InsertPriceTick): PriceTick {
    const inserted = db.insert(priceTicks).values(t as any).returning().get();
    // Trim to last 1000 ticks per symbol
    try {
      sqlite.prepare(`
        DELETE FROM price_ticks WHERE symbol = ? AND id NOT IN (
          SELECT id FROM price_ticks WHERE symbol = ? ORDER BY ts DESC LIMIT 1000
        )
      `).run(t.symbol, t.symbol);
    } catch (e) { /* ignore */ }
    return inserted;
  },
  listPriceTicks(symbol: string, limit = 200): PriceTick[] {
    return sqlite
      .prepare(`SELECT id, symbol, price, ts FROM price_ticks WHERE symbol = ? ORDER BY ts DESC LIMIT ?`)
      .all(symbol, limit) as PriceTick[];
  },
  countPriceTicks(): number {
    const row = sqlite.prepare(`SELECT COUNT(*) as n FROM price_ticks`).get() as { n: number };
    return row.n;
  },

  // regime state (singleton)
  getRegimeState(): RegimeState {
    const row = db.select().from(regimeState).get();
    if (row) return row;
    db.insert(regimeState).values({
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
    }).run();
    return db.select().from(regimeState).get()!;
  },
  updateRegimeState(patch: Partial<InsertRegimeState>): RegimeState {
    const cur = this.getRegimeState();
    db.update(regimeState).set(patch as any).where(eq(regimeState.id, cur.id)).run();
    return this.getRegimeState();
  },
  appendRegimeInputs(row: InsertRegimeInputs): RegimeInputsRow {
    const inserted = db.insert(regimeInputs).values(row as any).returning().get();
    // Trim to last 90 rows
    try {
      sqlite.prepare(`
        DELETE FROM regime_inputs WHERE id NOT IN (
          SELECT id FROM regime_inputs ORDER BY computed_at DESC LIMIT 90
        )
      `).run();
    } catch (e) { /* ignore */ }
    return inserted;
  },
  listRegimeInputs(limit = 30): RegimeInputsRow[] {
    return db.select().from(regimeInputs).orderBy(desc(regimeInputs.computedAt)).limit(limit).all();
  },
  latestRegimeInputs(): RegimeInputsRow | undefined {
    return db.select().from(regimeInputs).orderBy(desc(regimeInputs.computedAt)).limit(1).get();
  },

  // ─── setup candidates ──────────────────────────────────────────────────
  listSetupCandidates(): SetupCandidateRow[] {
    return db.select().from(setupCandidates).all();
  },
  getSetupCandidatesForTicker(ticker: string): SetupCandidateRow[] {
    return db.select().from(setupCandidates).where(eq(setupCandidates.ticker, ticker)).all();
  },
  getSetupCandidate(ticker: string, setup: string): SetupCandidateRow | undefined {
    return sqlite
      .prepare(`SELECT * FROM setup_candidates WHERE ticker = ? AND setup = ?`)
      .get(ticker, setup) as any;
  },
  upsertSetupCandidate(row: InsertSetupCandidate): SetupCandidateRow {
    const existing = this.getSetupCandidate(row.ticker, row.setup);
    if (existing) {
      db.update(setupCandidates).set(row as any).where(eq(setupCandidates.id, (existing as any).id)).run();
      return this.getSetupCandidate(row.ticker, row.setup)!;
    }
    return db.insert(setupCandidates).values(row as any).returning().get();
  },
  recordSetupTransition(row: InsertSetupHistory): SetupHistoryRow {
    const inserted = db.insert(setupHistory).values(row as any).returning().get();
    // Keep last 30 days only
    try {
      const cutoff = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
      sqlite.prepare(`DELETE FROM setup_history WHERE transitioned_at < ?`).run(cutoff);
    } catch (e) { /* ignore */ }
    return inserted;
  },
  getRecentSetupTransitions(limit = 20): SetupHistoryRow[] {
    return db.select().from(setupHistory).orderBy(desc(setupHistory.transitionedAt)).limit(limit).all();
  },

  // ── trade lifecycle events (audit log) ─────────────────────────────
  createTradeEvent(row: InsertTradeEvent): TradeEvent {
    return db.insert(tradeEvents).values(row as any).returning().get();
  },
  listTradeEvents(tradeId: number): TradeEvent[] {
    return db.select().from(tradeEvents).where(eq(tradeEvents.tradeId, tradeId)).orderBy(desc(tradeEvents.occurredAt)).all();
  },
  // Mark T1 fill: set t1Filled=true, t1FilledAt=now, start trailing at breakeven.
  applyT1Fill(tradeId: number, livePrice: number, newTrailingStop: number): Trade | undefined {
    const now = new Date().toISOString();
    db.update(trades)
      .set({
        t1Filled: true,
        t1FilledAt: now,
        trailingStop: newTrailingStop,
        trailingStopUpdatedAt: now,
        highWaterMark: livePrice,
      } as any)
      .where(eq(trades.id, tradeId))
      .run();
    return db.select().from(trades).where(eq(trades.id, tradeId)).get();
  },
  // Mark T2 fill: set t2Filled, t2FilledAt, exit, close trade.
  applyT2Fill(tradeId: number, exitPrice: number, rMultiple: number): Trade | undefined {
    const now = new Date().toISOString();
    db.update(trades)
      .set({
        t2Filled: true,
        t2FilledAt: now,
        exit: exitPrice,
        exitReason: "T2 target hit",
        rMultiple,
        status: "CLOSED",
        closedAt: now,
      } as any)
      .where(eq(trades.id, tradeId))
      .run();
    return db.select().from(trades).where(eq(trades.id, tradeId)).get();
  },
  // Update trailing stop and/or high-water mark.
  applyTrailUpdate(tradeId: number, newTrailingStop: number | undefined, newHighWaterMark: number | undefined): Trade | undefined {
    const now = new Date().toISOString();
    const patch: any = {};
    if (newTrailingStop != null) {
      patch.trailingStop = newTrailingStop;
      patch.trailingStopUpdatedAt = now;
    }
    if (newHighWaterMark != null) {
      patch.highWaterMark = newHighWaterMark;
    }
    if (Object.keys(patch).length === 0) {
      return db.select().from(trades).where(eq(trades.id, tradeId)).get();
    }
    db.update(trades).set(patch).where(eq(trades.id, tradeId)).run();
    return db.select().from(trades).where(eq(trades.id, tradeId)).get();
  },
  // Stop-out: close at given exit, persist exit reason + R.
  applyStopHit(tradeId: number, exitPrice: number, exitReason: string, rMultiple: number): Trade | undefined {
    const now = new Date().toISOString();
    db.update(trades)
      .set({
        exit: exitPrice,
        exitReason,
        rMultiple,
        status: "CLOSED",
        closedAt: now,
      } as any)
      .where(eq(trades.id, tradeId))
      .run();
    return db.select().from(trades).where(eq(trades.id, tradeId)).get();
  },
  // Journal patch: emotion/confidence/reflection on an existing trade.
  updateTradeJournal(tradeId: number, patch: { confidenceRating?: number; emotionTag?: string; reflection?: string }): Trade | undefined {
    const clean: any = {};
    if (patch.confidenceRating != null) clean.confidenceRating = patch.confidenceRating;
    if (patch.emotionTag != null) clean.emotionTag = patch.emotionTag;
    if (patch.reflection != null) clean.reflection = patch.reflection;
    if (Object.keys(clean).length === 0) {
      return db.select().from(trades).where(eq(trades.id, tradeId)).get();
    }
    db.update(trades).set(clean).where(eq(trades.id, tradeId)).run();
    return db.select().from(trades).where(eq(trades.id, tradeId)).get();
  },

  // wipe (reset)
  resetAll() {
    db.delete(trades).run();
    db.delete(alerts).run();
    db.delete(journalEntries).run();
    db.delete(leapPositions).run();
    db.delete(equityHistory).run();
    db.delete(chizzleScores).run();
    db.delete(watchlist).run();
    db.delete(tickers).run();
    db.delete(leapReserve).run();
    db.delete(settings).run();
    seedIfEmpty();
  },
};
