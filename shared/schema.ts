import { pgTable, text, integer, boolean, doublePrecision, serial, timestamp, uuid, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── settings (singleton id=1) ────────────────────────────────────────────────
export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  equity: doublePrecision("equity").notNull().default(1000),
  regime: text("regime").notNull().default("GREEN"), // GREEN | YELLOW | RED
  regimeOverride: boolean("regime_override").notNull().default(false),
  regimeChangedAt: text("regime_changed_at").notNull().default(""),
  watchlistTier: integer("watchlist_tier").notNull().default(1),
  // Risk per trade by regime (in %). Bumped defaults 2026-05: more aggressive
  // out-of-the-box sizing; tune via sliders in Settings.
  riskPctGreen: doublePrecision("risk_pct_green").notNull().default(5),
  riskPctYellow: doublePrecision("risk_pct_yellow").notNull().default(3),
  riskPctRed: doublePrecision("risk_pct_red").notNull().default(1),
  maxPositionsGreen: integer("max_positions_green").notNull().default(4),
  maxPositionsYellow: integer("max_positions_yellow").notNull().default(3),
  maxPositionsRed: integer("max_positions_red").notNull().default(2),
  maxOpenRiskPct: doublePrecision("max_open_risk_pct").notNull().default(6),
  minRR: doublePrecision("min_rr").notNull().default(2.0),
  // Phase 5 — Risk Governor (extends settings; single source of truth)
  maxDailyLossAmount: doublePrecision("max_daily_loss_amount").notNull().default(50),
  maxWeeklyLossAmount: doublePrecision("max_weekly_loss_amount").notNull().default(150),
  maxDrawdownPercent: doublePrecision("max_drawdown_percent").notNull().default(15),
  scaleUpMinTrades: integer("scale_up_min_trades").notNull().default(20),
  scaleUpMinExpectancy: doublePrecision("scale_up_min_expectancy").notNull().default(0.3),
  scaleDownDrawdownPercent: doublePrecision("scale_down_drawdown_percent").notNull().default(8),
});

// ─── tickers ──────────────────────────────────────────────────────────────────
export const tickers = pgTable("tickers", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull().unique(),
  tier: integer("tier").notNull().default(1),
  currentPrice: doublePrecision("current_price").notNull().default(0),
  manualOverride: doublePrecision("manual_override"), // nullable
  priorDayClose: doublePrecision("prior_day_close").notNull().default(0),
  sma20: doublePrecision("sma_20").notNull().default(0),
  sma50: doublePrecision("sma_50").notNull().default(0),
  sma200: doublePrecision("sma_200").notNull().default(0),
  atr14: doublePrecision("atr_14").notNull().default(0),
  earningsDate: text("earnings_date"), // ISO date or null
});

// ─── watchlist (one row per ticker on watchlist with setup info) ─────────────
export const watchlist = pgTable("watchlist", {
  id: serial("id").primaryKey(),
  tickerId: integer("ticker_id").notNull(),
  setupType: text("setup_type").notNull().default("TREND_PULLBACK"), // TREND_PULLBACK | BREAKOUT
  entryZoneLow: doublePrecision("entry_zone_low").notNull().default(0),
  entryZoneHigh: doublePrecision("entry_zone_high").notNull().default(0),
  stop: doublePrecision("stop").notNull().default(0),
  t1: doublePrecision("t1").notNull().default(0),
  t2: doublePrecision("t2").notNull().default(0),
  state: text("state").notNull().default("DORMANT"),
  scoreComponents: text("score_components").notNull().default("{}"), // json
  totalScore: doublePrecision("total_score").notNull().default(0),
  grade: text("grade").notNull().default("Ignore"), // A | B | Ignore
  // 2026-06: explicit user-controlled ordering for the mini-chart grid.
  position: integer("position").notNull().default(0),
  // 2026-06: soft-archive (deletions go here, can be restored from the Archived section).
  archived: boolean("archived").notNull().default(false),
  archivedAt: text("archived_at"),
});

// ─── trades ───────────────────────────────────────────────────────────────────
export const trades = pgTable("trades", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  setup: text("setup").notNull(),
  regimeAtEntry: text("regime_at_entry").notNull(),
  entry: doublePrecision("entry").notNull(),
  stop: doublePrecision("stop").notNull(),
  t1: doublePrecision("t1").notNull(),
  t2: doublePrecision("t2"),
  exit: doublePrecision("exit"),
  // Fractional shares supported (2 decimals). e.g. 12.34 shares of QQQ.
  shares: doublePrecision("shares").notNull(),
  riskDollars: doublePrecision("risk_dollars").notNull(),
  rr: doublePrecision("rr").notNull(),
  status: text("status").notNull().default("PENDING"), // PENDING | OPEN | CLOSED | DISCARDED
  archived: boolean("archived").notNull().default(false),
  confirmedAt: text("confirmed_at"),
  exitReason: text("exit_reason"),
  rMultiple: doublePrecision("r_multiple"),
  planFollowed: boolean("plan_followed"),
  lessonTag: text("lesson_tag"),
  thesis: text("thesis").notNull().default(""),
  emotionalState: integer("emotional_state").notNull().default(5),
  openedAt: text("opened_at").notNull(),
  closedAt: text("closed_at"),
  t1Filled: boolean("t1_filled").notNull().default(false),
  // Batch 2: full lifecycle tracking.
  t1FilledAt: text("t1_filled_at"),
  t2Filled: boolean("t2_filled").notNull().default(false),
  t2FilledAt: text("t2_filled_at"),
  trailingStop: doublePrecision("trailing_stop"),                 // current trailing stop level
  trailingStopUpdatedAt: text("trailing_stop_updated_at"),
  highWaterMark: doublePrecision("high_water_mark"),              // highest price seen since entry (for trailing)
  qualityAtEntry: text("quality_at_entry"),            // A | B | C  (snapshot from classifier)
  riskMultiplierAtEntry: doublePrecision("risk_multiplier_at_entry"), // 0/0.5/1.0
  // Batch 3: journal enhancement.
  confidenceRating: integer("confidence_rating"),      // 1-10
  emotionTag: text("emotion_tag"),                     // calm | excited | anxious | fomo | doubt
  reflection: text("reflection"),                      // post-close reflection text
});

// ─── Trade lifecycle events (audit log) ────────────────────────────
export const tradeEvents = pgTable("trade_events", {
  id: serial("id").primaryKey(),
  tradeId: integer("trade_id").notNull(),
  kind: text("kind").notNull(),         // ENTRY | T1_FILL | T2_FILL | TRAIL_UPDATE | STOP_HIT | MANUAL_EXIT | INVALIDATED
  price: doublePrecision("price"),                 // price at event (null for non-price events)
  note: text("note"),
  occurredAt: text("occurred_at").notNull(),
});

// ─── alerts ───────────────────────────────────────────────────────────────────
export const alerts = pgTable("alerts", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull().default(""),
  type: text("type").notNull(),
  severity: text("severity").notNull().default("info"), // info | action | critical
  message: text("message").notNull(),
  firedAt: text("fired_at").notNull(),
  acknowledged: boolean("acknowledged").notNull().default(false),
});

// ─── journal entries ──────────────────────────────────────────────────────────
export const journalEntries = pgTable("journal_entries", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(), // weekly | monthly
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  decisionsText: text("decisions_text").notNull().default(""),
  processChangeText: text("process_change_text").notNull().default(""),
  leakFlags: text("leak_flags").notNull().default("[]"), // json
});

// ─── LEAP positions ───────────────────────────────────────────────────────────
export const leapPositions = pgTable("leap_positions", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  contracts: integer("contracts").notNull(),
  strike: doublePrecision("strike").notNull(),
  expiry: text("expiry").notNull(),
  deltaAtEntry: doublePrecision("delta_at_entry").notNull(),
  premiumPaid: doublePrecision("premium_paid").notNull(),
  currentPremium: doublePrecision("current_premium").notNull(),
  currentDelta: doublePrecision("current_delta").notNull(),
  openedAt: text("opened_at").notNull(),
});

// ─── LEAP reserve (singleton) ─────────────────────────────────────────────────
export const leapReserve = pgTable("leap_reserve", {
  id: serial("id").primaryKey(),
  balance: doublePrecision("balance").notNull().default(0),
  realizedRollPnlYtd: doublePrecision("realized_roll_pnl_ytd").notNull().default(0),
});

// ─── equity history ──────────────────────────────────────────────────────────
export const equityHistory = pgTable("equity_history", {
  id: serial("id").primaryKey(),
  date: text("date").notNull(),
  equity: doublePrecision("equity").notNull(),
  drawdownPct: doublePrecision("drawdown_pct").notNull().default(0),
});

// ─── price ticks (real Finnhub history for sparklines) ───────────────────────
export const priceTicks = pgTable("price_ticks", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  price: doublePrecision("price").notNull(),
  ts: integer("ts").notNull(),
});

// ─── Regime state (singleton id=1) ───────────────────────────────────────────
export const regimeState = pgTable("regime_state", {
  id: serial("id").primaryKey(),
  currentRegime: text("current_regime").notNull().default("yellow"), // green | yellow | red
  currentRegimeSince: text("current_regime_since").notNull().default(""),
  pendingRegime: text("pending_regime"),
  pendingSince: text("pending_since"),
  pendingConsecutiveCount: integer("pending_consecutive_count").notNull().default(0),
  manualOverride: boolean("manual_override").notNull().default(false),
  manualOverrideRegime: text("manual_override_regime"),
  lastClassifiedAt: text("last_classified_at").notNull().default(""),
  lastError: text("last_error"),
  stale: boolean("stale").notNull().default(false),
});

// ─── Regime inputs history ───────────────────────────────────────────────────
export const regimeInputs = pgTable("regime_inputs", {
  id: serial("id").primaryKey(),
  computedAt: text("computed_at").notNull(),
  spyPrice: doublePrecision("spy_price").notNull().default(0),
  spySma20: doublePrecision("spy_sma20").notNull().default(0),
  spySma50: doublePrecision("spy_sma50").notNull().default(0),
  spySma200: doublePrecision("spy_sma200").notNull().default(0),
  spySma20Rising: boolean("spy_sma20_rising").notNull().default(false),
  spySma50Rising: boolean("spy_sma50_rising").notNull().default(false),
  spyAbove20: boolean("spy_above_20").notNull().default(false),
  spyAbove50: boolean("spy_above_50").notNull().default(false),
  spyAbove200: boolean("spy_above_200").notNull().default(false),
  qqqPrice: doublePrecision("qqq_price").notNull().default(0),
  qqqSma20: doublePrecision("qqq_sma20").notNull().default(0),
  qqqSma50: doublePrecision("qqq_sma50").notNull().default(0),
  qqqSma200: doublePrecision("qqq_sma200").notNull().default(0),
  qqqSma20Rising: boolean("qqq_sma20_rising").notNull().default(false),
  qqqSma50Rising: boolean("qqq_sma50_rising").notNull().default(false),
  qqqAbove20: boolean("qqq_above_20").notNull().default(false),
  qqqAbove50: boolean("qqq_above_50").notNull().default(false),
  qqqAbove200: boolean("qqq_above_200").notNull().default(false),
  vixLevel: doublePrecision("vix_level").notNull().default(0),
  vixSlope5d: doublePrecision("vix_slope_5d").notNull().default(0),
  breadthProxyPct: doublePrecision("breadth_proxy_pct").notNull().default(50),
  rspAbove50Sma: boolean("rsp_above_50sma").notNull().default(false),
  rspSpyRatioTrend: doublePrecision("rsp_spy_ratio_trend").notNull().default(1),
  distributionDays: integer("distribution_days").notNull().default(0),
  distributionDayDates: text("distribution_day_dates").notNull().default("[]"),
  followThroughDay: boolean("follow_through_day").notNull().default(false),
  rawRegime: text("raw_regime").notNull().default("yellow"),
});

// ─── Setup candidates (auto-detection) ──────────────────────────────────────
export const setupCandidates = pgTable("setup_candidates", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  setup: text("setup").notNull(), // 'trend_pullback' | 'breakout'
  state: text("state").notNull().default("dormant"),
  qualificationsPassed: integer("qualifications_passed").notNull().default(0),
  qualificationsTotal: integer("qualifications_total").notNull().default(6),
  qualificationDetails: text("qualification_details").notNull().default("[]"),
  entryZoneLow: doublePrecision("entry_zone_low"),
  entryZoneHigh: doublePrecision("entry_zone_high"),
  stop: doublePrecision("stop"),
  t1: doublePrecision("t1"),
  t2: doublePrecision("t2"),
  rrToT1: doublePrecision("rr_to_t1"),
  atr14: doublePrecision("atr14").notNull().default(0),
  swingHigh: doublePrecision("swing_high"),
  pullbackPct: doublePrecision("pullback_pct"),
  basePivot: doublePrecision("base_pivot"),
  baseDepth: doublePrecision("base_depth"),
  baseLength: integer("base_length"),
  triggerFired: boolean("trigger_fired").notNull().default(false),
  triggerNote: text("trigger_note"),
  disqualifiers: text("disqualifiers").notNull().default("[]"),
  lastComputedAt: text("last_computed_at").notNull().default(""),
  regimeEligible: boolean("regime_eligible").notNull().default(true),
  regimeBlockedReason: text("regime_blocked_reason"),
  relativeStrength: integer("relative_strength"),
  trendStrength: integer("trend_strength"),
  volumeScore: integer("volume_score"),
  cleanlinessScore: integer("cleanliness_score"),
  marketAlignment: boolean("market_alignment"),
  earningsRisk: boolean("earnings_risk"),
  quality: text("quality"), // 'A' | 'B' | 'C'
});

export const setupHistory = pgTable("setup_history", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  setup: text("setup").notNull(),
  prevState: text("prev_state").notNull().default(""),
  newState: text("new_state").notNull(),
  transitionedAt: text("transitioned_at").notNull(),
  details: text("details").notNull().default("{}"),
});

// ─── signal history ──────────────────────────────────────────────────────────
// Every confirmation candle event (Hammer / Engulfing) detected by the system
// is logged here for review, filtering, and replay. This is a logging table —
// NOT a buy/sell signal store. The detector writes; the UI reads.
export const signalHistory = pgTable("signal_history", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  patternType: text("pattern_type").notNull(), // "Hammer" | "Engulfing"
  timestamp: doublePrecision("timestamp").notNull(), // unix seconds (4H close time)
  setupCandleIndex: integer("setup_candle_index").notNull(),
  confirmationCandleIndex: integer("confirmation_candle_index").notNull(),
  setupCandleLow: doublePrecision("setup_candle_low").notNull(),
  confirmationCandleLow: doublePrecision("confirmation_candle_low").notNull(),
  confirmationClose: doublePrecision("confirmation_close").notNull(),
  retestZoneUpper: doublePrecision("retest_zone_upper").notNull(),
  retestZoneLower: doublePrecision("retest_zone_lower").notNull(),
  score: doublePrecision("score").notNull(),
  scoreBreakdown: text("score_breakdown").notNull().default("[]"), // json string[]
  volume: doublePrecision("volume").notNull().default(0),
  volumeVsAverage20: doublePrecision("volume_vs_average_20").notNull().default(0),
  markerType: text("marker_type").notNull().default("confirmation"),
  markerPosition: doublePrecision("marker_position").notNull().default(0),
  color: text("color").notNull().default("#00E5A8"),
  soundPlayed: boolean("sound_played").notNull().default(false),
  notificationSent: boolean("notification_sent").notNull().default(false),
  smaProximity: text("sma_proximity").notNull().default(""), // e.g. "+1.8% above SMA20"
  createdAt: text("created_at").notNull(),
});

// ─── Chizzle scores ──────────────────────────────────────────────────────────
export const chizzleScores = pgTable("chizzle_scores", {
  id: serial("id").primaryKey(),
  date: text("date").notNull(),
  components: text("components").notNull().default("{}"),
  total: doublePrecision("total").notNull().default(0),
  identityState: text("identity_state").notNull().default("WORKING"),
});

// ─── alert contacts (email + SMS destinations) ────────────────────────────────
export const alertContacts = pgTable("alert_contacts", {
  id: serial("id").primaryKey(),
  channel: text("channel").notNull(), // email | sms | telegram
  destination: text("destination").notNull(), // email addr or E.164 phone
  label: text("label").notNull().default(""),
  enabled: boolean("enabled").notNull().default(true),
  triggerForming: boolean("trigger_forming").notNull().default(true),
  triggerConfirmed: boolean("trigger_confirmed").notNull().default(true),
  // CSV of tickers this contact wants alerts for. Empty string = ALL tickers.
  // Example: "SMH" → only SMH alerts. "SMH,QQQ" → both.
  tickerFilter: text("ticker_filter").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

// ─── alert log (dedupe + delivery audit) ──────────────────────────────────────
export const alertLog = pgTable("alert_log", {
  id: serial("id").primaryKey(),
  signalKey: text("signal_key").notNull(), // ticker::mode::phase::candleTs
  ticker: text("ticker").notNull(),
  phase: text("phase").notNull(), // forming | confirmed
  mode: text("mode").notNull(), // conservative | aggressive
  channel: text("channel").notNull(), // email | sms
  destination: text("destination").notNull(),
  status: text("status").notNull(), // sent | failed | skipped_dedupe | stubbed
  errorMessage: text("error_message").notNull().default(""),
  payload: text("payload").notNull().default("{}"),
  sentAt: text("sent_at").notNull(),
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
export const insertSignalHistorySchema = createInsertSchema(signalHistory).omit({ id: true });
export const insertAlertContactSchema = createInsertSchema(alertContacts).omit({ id: true, createdAt: true });
export const insertAlertLogSchema = createInsertSchema(alertLog).omit({ id: true });

// ─── trade_plans (Phase 1 Trade Planner) ──────────────────────────────────────
// Independent of `trades`. Lets Jake stage entry/stop/target/risk before
// committing to an executed trade. Reuses Settings (equity + regime risk %) as
// the risk profile — no separate risk_profiles table.
// Phase 2 widened the status enum to support execution-derived lifecycle states.
export const TRADE_PLAN_STATUSES = ["planned", "open", "partial", "closed", "cancelled"] as const;
export type TradePlanStatus = (typeof TRADE_PLAN_STATUSES)[number];

export const EXECUTION_TYPES = ["entry", "add", "partial_exit", "exit"] as const;
export type ExecutionType = (typeof EXECUTION_TYPES)[number];

export const tradePlans = pgTable("trade_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticker: text("ticker").notNull(),
  setupType: text("setup_type").notNull(),
  direction: text("direction").notNull().default("long"), // long | short
  entryPrice: doublePrecision("entry_price").notNull(),
  stopPrice: doublePrecision("stop_price").notNull(),
  targetPrice: doublePrecision("target_price"),
  riskPercent: doublePrecision("risk_percent").notNull(),
  plannedShares: integer("planned_shares").notNull(),
  thesis: text("thesis").notNull().default(""),
  status: text("status").notNull().default("planned"), // planned | cancelled | executed
  createdAt: text("created_at").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(""),
});
export const insertTradePlanSchema = createInsertSchema(tradePlans)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    ticker: z.string().min(1).max(16).transform((s) => s.toUpperCase()),
    setupType: z.string().min(1),
    direction: z.enum(["long", "short"]).default("long"),
    entryPrice: z.number().positive(),
    stopPrice: z.number().positive(),
    targetPrice: z.number().positive().nullable().optional(),
    riskPercent: z.number().positive().max(100),
    plannedShares: z.number().int().min(0),
    thesis: z.string().default(""),
    status: z.enum(TRADE_PLAN_STATUSES).default("planned"),
  });

// ─── trade_executions (Phase 2: actual fills logged against a trade plan) ────
// One trade_plans row may have many executions. Executions are the source of
// truth for realized P&L. Status on trade_plans is derived from these rows.
export const tradeExecutions = pgTable("trade_executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tradePlanId: uuid("trade_plan_id").notNull().references(() => tradePlans.id, { onDelete: "cascade" }),
  executionType: text("execution_type").notNull(),
  shares: integer("shares").notNull(),
  price: doublePrecision("price").notNull(),
  fees: doublePrecision("fees").notNull().default(0),
  executedAt: timestamp("executed_at", { withTimezone: true }).notNull().defaultNow(),
  notes: text("notes").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertTradeExecutionSchema = createInsertSchema(tradeExecutions)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    tradePlanId: z.string().uuid(),
    executionType: z.enum(EXECUTION_TYPES),
    shares: z.number().int().positive(),
    price: z.number().positive(),
    fees: z.number().min(0).default(0),
    executedAt: z.coerce.date().default(() => new Date()),
    notes: z.string().max(2000).default(""),
  });

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
export type SignalHistory = typeof signalHistory.$inferSelect;
export type InsertSignalHistory = z.infer<typeof insertSignalHistorySchema>;
export type AlertContact = typeof alertContacts.$inferSelect;
export type InsertAlertContact = z.infer<typeof insertAlertContactSchema>;
export type AlertLogRow = typeof alertLog.$inferSelect;
export type InsertAlertLog = z.infer<typeof insertAlertLogSchema>;
export type TradePlan = typeof tradePlans.$inferSelect;
export type InsertTradePlan = z.infer<typeof insertTradePlanSchema>;
export type TradeExecution = typeof tradeExecutions.$inferSelect;
export type InsertTradeExecution = z.infer<typeof insertTradeExecutionSchema>;

// ───────────────────────── Phase 3: Reviews & Tags ───────────────────────────
// Review is 1:1 with a trade plan. Tags are global. Review↔Tag is many-to-many.

export const REVIEW_GRADES = ["A", "B", "C", "D", "F"] as const;
export type ReviewGrade = (typeof REVIEW_GRADES)[number];

export const TAG_CATEGORIES = ["setup", "market", "mistake", "psychology", "other"] as const;
export type TagCategory = (typeof TAG_CATEGORIES)[number];

export const EMOTIONAL_STATES = [
  "calm",
  "confident",
  "impatient",
  "fearful",
  "greedy",
  "frustrated",
  "focused",
  "distracted",
  "other",
] as const;
export type EmotionalState = (typeof EMOTIONAL_STATES)[number];

export const tradeReviews = pgTable("trade_reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  tradePlanId: uuid("trade_plan_id").notNull().unique().references(() => tradePlans.id, { onDelete: "cascade" }),
  confidenceBefore: integer("confidence_before"), // 1-10 or null
  gradeAfter: text("grade_after"), // 'A'|'B'|'C'|'D'|'F' or null
  followedPlan: boolean("followed_plan").notNull().default(false),
  emotionalState: text("emotional_state"), // free text, soft-validated against EMOTIONAL_STATES
  lessonLearned: text("lesson_learned").notNull().default(""),
  reviewNotes: text("review_notes").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertTradeReviewSchema = createInsertSchema(tradeReviews)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    tradePlanId: z.string().uuid(),
    confidenceBefore: z.number().int().min(1).max(10).nullable().optional(),
    gradeAfter: z.enum(REVIEW_GRADES).nullable().optional(),
    followedPlan: z.boolean().default(false),
    emotionalState: z.string().max(60).nullable().optional(),
    lessonLearned: z.string().max(4000).default(""),
    reviewNotes: z.string().max(8000).default(""),
  });

export const tradeTags = pgTable("trade_tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertTradeTagSchema = createInsertSchema(tradeTags)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    name: z.string().min(1).max(40).transform((s) => s.trim()),
    category: z.enum(TAG_CATEGORIES),
  });

export const tradeReviewTags = pgTable("trade_review_tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  tradeReviewId: uuid("trade_review_id").notNull().references(() => tradeReviews.id, { onDelete: "cascade" }),
  tradeTagId: uuid("trade_tag_id").notNull().references(() => tradeTags.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TradeReview = typeof tradeReviews.$inferSelect;
export type InsertTradeReview = z.infer<typeof insertTradeReviewSchema>;
export type TradeTag = typeof tradeTags.$inferSelect;
export type InsertTradeTag = z.infer<typeof insertTradeTagSchema>;
export type TradeReviewTag = typeof tradeReviewTags.$inferSelect;

// ─── Active Setups (Chizzle Pipeline persistence, 2026-08-11) ──────────────
// Confirmed swing setups that survive scans, refreshes, and deploys. Only
// removed on explicit archive. This is the source of truth for the Cockpit's
// ACTIVE SETUPS system.

export const ACTIVE_SETUP_STATUSES = [
  "planned",
  "active",
  "trimmed",
  "closed",
  "archived",
] as const;
export type ActiveSetupStatus = typeof ACTIVE_SETUP_STATUSES[number];

export const activeSetups = pgTable("active_setups", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticker: text("ticker").notNull(),
  sector: text("sector").default(""),
  theme: text("theme").default(""),
  thesis: text("thesis").notNull().default(""),
  entry: doublePrecision("entry").notNull(),
  stop: doublePrecision("stop").notNull(),
  targetT1: doublePrecision("target_t1").notNull(),
  targetT2: doublePrecision("target_t2"),
  riskPercent: doublePrecision("risk_percent").notNull().default(0.75),
  regime: text("regime").notNull().default("UNKNOWN"),
  structureVerdict: text("structure_verdict").notNull().default(""),
  rrRatio: doublePrecision("rr_ratio").notNull().default(0),
  status: text("status").notNull().default("planned"),
  pinned: boolean("pinned").notNull().default(false),
  notes: text("notes").default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const insertActiveSetupSchema = createInsertSchema(activeSetups)
  .omit({ id: true, createdAt: true, updatedAt: true, archivedAt: true })
  .extend({
    ticker: z.string().min(1).max(10).transform((s) => s.trim().toUpperCase()),
    thesis: z.string().max(2000).default(""),
    sector: z.string().max(60).optional().default(""),
    theme: z.string().max(60).optional().default(""),
    entry: z.number().positive(),
    stop: z.number().positive(),
    targetT1: z.number().positive(),
    targetT2: z.number().positive().optional().nullable(),
    riskPercent: z.number().min(0).max(10).default(0.75),
    regime: z.enum(["GREEN", "YELLOW", "RED", "UNKNOWN", "MIXED"]).default("UNKNOWN"),
    structureVerdict: z.string().max(200).default(""),
    rrRatio: z.number().min(0).default(0),
    status: z.enum(ACTIVE_SETUP_STATUSES).default("planned"),
    pinned: z.boolean().default(false),
    notes: z.string().max(4000).optional().default(""),
  });

export type ActiveSetup = typeof activeSetups.$inferSelect;
export type InsertActiveSetup = z.infer<typeof insertActiveSetupSchema>;
