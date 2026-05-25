import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── settings (singleton id=1) ────────────────────────────────────────────────
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  equity: real("equity").notNull().default(1000),
  regime: text("regime").notNull().default("GREEN"), // GREEN | YELLOW | RED
  regimeOverride: integer("regime_override", { mode: "boolean" }).notNull().default(false),
  regimeChangedAt: text("regime_changed_at").notNull().default(""),
  watchlistTier: integer("watchlist_tier").notNull().default(1),
  riskPctGreen: real("risk_pct_green").notNull().default(3),
  riskPctYellow: real("risk_pct_yellow").notNull().default(2),
  riskPctRed: real("risk_pct_red").notNull().default(1),
  maxPositionsGreen: integer("max_positions_green").notNull().default(4),
  maxPositionsYellow: integer("max_positions_yellow").notNull().default(3),
  maxPositionsRed: integer("max_positions_red").notNull().default(2),
  maxOpenRiskPct: real("max_open_risk_pct").notNull().default(6),
  minRR: real("min_rr").notNull().default(2.0),
});

// ─── tickers ──────────────────────────────────────────────────────────────────
export const tickers = sqliteTable("tickers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  symbol: text("symbol").notNull().unique(),
  tier: integer("tier").notNull().default(1),
  currentPrice: real("current_price").notNull().default(0),
  manualOverride: real("manual_override"), // nullable
  priorDayClose: real("prior_day_close").notNull().default(0),
  sma20: real("sma_20").notNull().default(0),
  sma50: real("sma_50").notNull().default(0),
  sma200: real("sma_200").notNull().default(0),
  atr14: real("atr_14").notNull().default(0),
  earningsDate: text("earnings_date"), // ISO date or null
});

// ─── watchlist (one row per ticker on watchlist with setup info) ─────────────
export const watchlist = sqliteTable("watchlist", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tickerId: integer("ticker_id").notNull(),
  setupType: text("setup_type").notNull().default("TREND_PULLBACK"), // TREND_PULLBACK | BREAKOUT
  entryZoneLow: real("entry_zone_low").notNull().default(0),
  entryZoneHigh: real("entry_zone_high").notNull().default(0),
  stop: real("stop").notNull().default(0),
  t1: real("t1").notNull().default(0),
  t2: real("t2").notNull().default(0),
  state: text("state").notNull().default("DORMANT"),
  scoreComponents: text("score_components").notNull().default("{}"), // json
  totalScore: real("total_score").notNull().default(0),
  grade: text("grade").notNull().default("Ignore"), // A | B | Ignore
});

// ─── trades ───────────────────────────────────────────────────────────────────
export const trades = sqliteTable("trades", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),
  setup: text("setup").notNull(),
  regimeAtEntry: text("regime_at_entry").notNull(),
  entry: real("entry").notNull(),
  stop: real("stop").notNull(),
  t1: real("t1").notNull(),
  t2: real("t2"),
  exit: real("exit"),
  shares: integer("shares").notNull(),
  riskDollars: real("risk_dollars").notNull(),
  rr: real("rr").notNull(),
  status: text("status").notNull().default("OPEN"), // OPEN | CLOSED
  exitReason: text("exit_reason"),
  rMultiple: real("r_multiple"),
  planFollowed: integer("plan_followed", { mode: "boolean" }),
  lessonTag: text("lesson_tag"),
  thesis: text("thesis").notNull().default(""),
  emotionalState: integer("emotional_state").notNull().default(5),
  openedAt: text("opened_at").notNull(),
  closedAt: text("closed_at"),
  t1Filled: integer("t1_filled", { mode: "boolean" }).notNull().default(false),
  // Batch 2: full lifecycle tracking.
  t1FilledAt: text("t1_filled_at"),
  t2Filled: integer("t2_filled", { mode: "boolean" }).notNull().default(false),
  t2FilledAt: text("t2_filled_at"),
  trailingStop: real("trailing_stop"),                 // current trailing stop level
  trailingStopUpdatedAt: text("trailing_stop_updated_at"),
  highWaterMark: real("high_water_mark"),              // highest price seen since entry (for trailing)
  qualityAtEntry: text("quality_at_entry"),            // A | B | C  (snapshot from classifier)
  riskMultiplierAtEntry: real("risk_multiplier_at_entry"), // 0/0.5/1.0
  // Batch 3: journal enhancement.
  confidenceRating: integer("confidence_rating"),      // 1-10
  emotionTag: text("emotion_tag"),                     // calm | excited | anxious | fomo | doubt
  reflection: text("reflection"),                      // post-close reflection text
});

// ─── Trade lifecycle events (audit log) ────────────────────────────
export const tradeEvents = sqliteTable("trade_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tradeId: integer("trade_id").notNull(),
  kind: text("kind").notNull(),         // ENTRY | T1_FILL | T2_FILL | TRAIL_UPDATE | STOP_HIT | MANUAL_EXIT | INVALIDATED
  price: real("price"),                 // price at event (null for non-price events)
  note: text("note"),
  occurredAt: text("occurred_at").notNull(),
});

// ─── alerts ───────────────────────────────────────────────────────────────────
export const alerts = sqliteTable("alerts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull().default(""),
  type: text("type").notNull(),
  severity: text("severity").notNull().default("info"), // info | action | critical
  message: text("message").notNull(),
  firedAt: text("fired_at").notNull(),
  acknowledged: integer("acknowledged", { mode: "boolean" }).notNull().default(false),
});

// ─── journal entries ──────────────────────────────────────────────────────────
export const journalEntries = sqliteTable("journal_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(), // weekly | monthly
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  decisionsText: text("decisions_text").notNull().default(""),
  processChangeText: text("process_change_text").notNull().default(""),
  leakFlags: text("leak_flags").notNull().default("[]"), // json
});

// ─── LEAP positions ───────────────────────────────────────────────────────────
export const leapPositions = sqliteTable("leap_positions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),
  contracts: integer("contracts").notNull(),
  strike: real("strike").notNull(),
  expiry: text("expiry").notNull(),
  deltaAtEntry: real("delta_at_entry").notNull(),
  premiumPaid: real("premium_paid").notNull(),
  currentPremium: real("current_premium").notNull(),
  currentDelta: real("current_delta").notNull(),
  openedAt: text("opened_at").notNull(),
});

// ─── LEAP reserve (singleton) ─────────────────────────────────────────────────
export const leapReserve = sqliteTable("leap_reserve", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  balance: real("balance").notNull().default(0),
  realizedRollPnlYtd: real("realized_roll_pnl_ytd").notNull().default(0),
});

// ─── equity history ──────────────────────────────────────────────────────────
export const equityHistory = sqliteTable("equity_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),
  equity: real("equity").notNull(),
  drawdownPct: real("drawdown_pct").notNull().default(0),
});

// ─── price ticks (real Finnhub history for sparklines) ───────────────────────
export const priceTicks = sqliteTable("price_ticks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  symbol: text("symbol").notNull(),
  price: real("price").notNull(),
  ts: integer("ts").notNull(),
});

// ─── Regime state (singleton id=1) ───────────────────────────────────────────
export const regimeState = sqliteTable("regime_state", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  currentRegime: text("current_regime").notNull().default("yellow"), // green | yellow | red
  currentRegimeSince: text("current_regime_since").notNull().default(""),
  pendingRegime: text("pending_regime"),
  pendingSince: text("pending_since"),
  pendingConsecutiveCount: integer("pending_consecutive_count").notNull().default(0),
  manualOverride: integer("manual_override", { mode: "boolean" }).notNull().default(false),
  manualOverrideRegime: text("manual_override_regime"),
  lastClassifiedAt: text("last_classified_at").notNull().default(""),
  lastError: text("last_error"),
  stale: integer("stale", { mode: "boolean" }).notNull().default(false),
});

// ─── Regime inputs history ───────────────────────────────────────────────────
export const regimeInputs = sqliteTable("regime_inputs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  computedAt: text("computed_at").notNull(),
  spyPrice: real("spy_price").notNull().default(0),
  spySma20: real("spy_sma20").notNull().default(0),
  spySma50: real("spy_sma50").notNull().default(0),
  spySma200: real("spy_sma200").notNull().default(0),
  spySma20Rising: integer("spy_sma20_rising", { mode: "boolean" }).notNull().default(false),
  spySma50Rising: integer("spy_sma50_rising", { mode: "boolean" }).notNull().default(false),
  spyAbove20: integer("spy_above_20", { mode: "boolean" }).notNull().default(false),
  spyAbove50: integer("spy_above_50", { mode: "boolean" }).notNull().default(false),
  spyAbove200: integer("spy_above_200", { mode: "boolean" }).notNull().default(false),
  qqqPrice: real("qqq_price").notNull().default(0),
  qqqSma20: real("qqq_sma20").notNull().default(0),
  qqqSma50: real("qqq_sma50").notNull().default(0),
  qqqSma200: real("qqq_sma200").notNull().default(0),
  qqqSma20Rising: integer("qqq_sma20_rising", { mode: "boolean" }).notNull().default(false),
  qqqSma50Rising: integer("qqq_sma50_rising", { mode: "boolean" }).notNull().default(false),
  qqqAbove20: integer("qqq_above_20", { mode: "boolean" }).notNull().default(false),
  qqqAbove50: integer("qqq_above_50", { mode: "boolean" }).notNull().default(false),
  qqqAbove200: integer("qqq_above_200", { mode: "boolean" }).notNull().default(false),
  vixLevel: real("vix_level").notNull().default(0),
  vixSlope5d: real("vix_slope_5d").notNull().default(0),
  breadthProxyPct: real("breadth_proxy_pct").notNull().default(50),
  rspAbove50Sma: integer("rsp_above_50sma", { mode: "boolean" }).notNull().default(false),
  rspSpyRatioTrend: real("rsp_spy_ratio_trend").notNull().default(1),
  distributionDays: integer("distribution_days").notNull().default(0),
  distributionDayDates: text("distribution_day_dates").notNull().default("[]"),
  followThroughDay: integer("follow_through_day", { mode: "boolean" }).notNull().default(false),
  rawRegime: text("raw_regime").notNull().default("yellow"),
});

// ─── Setup candidates (auto-detection) ──────────────────────────────────────
export const setupCandidates = sqliteTable("setup_candidates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),
  setup: text("setup").notNull(), // 'trend_pullback' | 'breakout'
  state: text("state").notNull().default("dormant"),
  qualificationsPassed: integer("qualifications_passed").notNull().default(0),
  qualificationsTotal: integer("qualifications_total").notNull().default(6),
  qualificationDetails: text("qualification_details").notNull().default("[]"),
  entryZoneLow: real("entry_zone_low"),
  entryZoneHigh: real("entry_zone_high"),
  stop: real("stop"),
  t1: real("t1"),
  t2: real("t2"),
  rrToT1: real("rr_to_t1"),
  atr14: real("atr14").notNull().default(0),
  swingHigh: real("swing_high"),
  pullbackPct: real("pullback_pct"),
  basePivot: real("base_pivot"),
  baseDepth: real("base_depth"),
  baseLength: integer("base_length"),
  triggerFired: integer("trigger_fired", { mode: "boolean" }).notNull().default(false),
  triggerNote: text("trigger_note"),
  disqualifiers: text("disqualifiers").notNull().default("[]"),
  lastComputedAt: text("last_computed_at").notNull().default(""),
  regimeEligible: integer("regime_eligible", { mode: "boolean" }).notNull().default(true),
  regimeBlockedReason: text("regime_blocked_reason"),
  relativeStrength: integer("relative_strength"),
  trendStrength: integer("trend_strength"),
  volumeScore: integer("volume_score"),
  cleanlinessScore: integer("cleanliness_score"),
  marketAlignment: integer("market_alignment", { mode: "boolean" }),
  earningsRisk: integer("earnings_risk", { mode: "boolean" }),
  quality: text("quality"), // 'A' | 'B' | 'C'
});

export const setupHistory = sqliteTable("setup_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),
  setup: text("setup").notNull(),
  prevState: text("prev_state").notNull().default(""),
  newState: text("new_state").notNull(),
  transitionedAt: text("transitioned_at").notNull(),
  details: text("details").notNull().default("{}"),
});

// ─── Chizzle scores ──────────────────────────────────────────────────────────
export const chizzleScores = sqliteTable("chizzle_scores", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),
  components: text("components").notNull().default("{}"),
  total: real("total").notNull().default(0),
  identityState: text("identity_state").notNull().default("WORKING"),
});

// ─── insert schemas + types ──────────────────────────────────────────────────
export const insertSettingsSchema = createInsertSchema(settings).omit({ id: true });
export const insertTickerSchema = createInsertSchema(tickers).omit({ id: true });
export const insertWatchlistSchema = createInsertSchema(watchlist).omit({ id: true });
export const insertTradeSchema = createInsertSchema(trades).omit({ id: true });
export const insertAlertSchema = createInsertSchema(alerts).omit({ id: true });
export const insertJournalEntrySchema = createInsertSchema(journalEntries).omit({ id: true });
export const insertLeapPositionSchema = createInsertSchema(leapPositions).omit({ id: true });
export const insertLeapReserveSchema = createInsertSchema(leapReserve).omit({ id: true });
export const insertEquityHistorySchema = createInsertSchema(equityHistory).omit({ id: true });
export const insertChizzleScoreSchema = createInsertSchema(chizzleScores).omit({ id: true });
export const insertPriceTickSchema = createInsertSchema(priceTicks).omit({ id: true });
export const insertRegimeStateSchema = createInsertSchema(regimeState).omit({ id: true });
export const insertRegimeInputsSchema = createInsertSchema(regimeInputs).omit({ id: true });
export const insertSetupCandidateSchema = createInsertSchema(setupCandidates).omit({ id: true });
export const insertSetupHistorySchema = createInsertSchema(setupHistory).omit({ id: true });
export const insertTradeEventSchema = createInsertSchema(tradeEvents).omit({ id: true });

export type Settings = typeof settings.$inferSelect;
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Ticker = typeof tickers.$inferSelect;
export type InsertTicker = z.infer<typeof insertTickerSchema>;
export type WatchlistItem = typeof watchlist.$inferSelect;
export type InsertWatchlistItem = z.infer<typeof insertWatchlistSchema>;
export type Trade = typeof trades.$inferSelect;
export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type Alert = typeof alerts.$inferSelect;
export type InsertAlert = z.infer<typeof insertAlertSchema>;
export type JournalEntry = typeof journalEntries.$inferSelect;
export type InsertJournalEntry = z.infer<typeof insertJournalEntrySchema>;
export type LeapPosition = typeof leapPositions.$inferSelect;
export type InsertLeapPosition = z.infer<typeof insertLeapPositionSchema>;
export type LeapReserve = typeof leapReserve.$inferSelect;
export type InsertLeapReserve = z.infer<typeof insertLeapReserveSchema>;
export type EquityHistory = typeof equityHistory.$inferSelect;
export type InsertEquityHistory = z.infer<typeof insertEquityHistorySchema>;
export type ChizzleScore = typeof chizzleScores.$inferSelect;
export type InsertChizzleScore = z.infer<typeof insertChizzleScoreSchema>;
export type PriceTick = typeof priceTicks.$inferSelect;
export type InsertPriceTick = z.infer<typeof insertPriceTickSchema>;
export type RegimeState = typeof regimeState.$inferSelect;
export type InsertRegimeState = z.infer<typeof insertRegimeStateSchema>;
export type RegimeInputsRow = typeof regimeInputs.$inferSelect;
export type InsertRegimeInputs = z.infer<typeof insertRegimeInputsSchema>;
export type SetupCandidateRow = typeof setupCandidates.$inferSelect;
export type InsertSetupCandidate = z.infer<typeof insertSetupCandidateSchema>;
export type SetupHistoryRow = typeof setupHistory.$inferSelect;
export type InsertSetupHistory = z.infer<typeof insertSetupHistorySchema>;
export type TradeEvent = typeof tradeEvents.$inferSelect;
export type InsertTradeEvent = z.infer<typeof insertTradeEventSchema>;
