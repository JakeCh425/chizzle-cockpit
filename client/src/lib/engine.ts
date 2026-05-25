// ============================================================================
//  CHIZZLE WEALTH ENGINE — Core Logic Library
//  Pure, deterministic, side-effect-free. Every formula matches the v1.0 blueprint.
// ============================================================================

export type Regime = "GREEN" | "YELLOW" | "RED";
export type Grade = "A" | "B" | "Ignore";
export type SetupType = "TREND_PULLBACK" | "BREAKOUT";
export type WatchlistState =
  | "DORMANT" | "BUILDING" | "APPROACHING" | "IN_ZONE" | "ARMED" | "LIVE" | "INVALIDATED";
export type IdentityState = "OPERATOR" | "DISCIPLINED" | "WORKING" | "OFF_PROCESS";

// ─── Risk Engine ────────────────────────────────────────────────────────────
export const RISK_PCT: Record<Regime, number> = { GREEN: 0.03, YELLOW: 0.02, RED: 0.01 };
export const MAX_POSITIONS: Record<Regime, number> = { GREEN: 4, YELLOW: 3, RED: 2 };
export const NOTIONAL_CAP_PCT: Record<Regime, number> = { GREEN: 0.5, YELLOW: 0.35, RED: 0.2 };
export const MAX_OPEN_RISK_PCT = 6;
export const MIN_RR = 2.0;

export function riskDollars(equity: number, regime: Regime, customPct?: Partial<Record<Regime, number>>): number {
  const pct = (customPct?.[regime] ?? RISK_PCT[regime] * 100) / 100;
  return equity * pct;
}

export function perShareRisk(entry: number, stop: number): number {
  return Math.max(0, entry - stop);
}

export function positionSize(riskDollarsValue: number, perShareRiskValue: number): number {
  if (perShareRiskValue <= 0) return 0;
  return Math.floor(riskDollarsValue / perShareRiskValue);
}

export function rrRatio(entry: number, stop: number, t1: number): number {
  const risk = entry - stop;
  if (risk <= 0) return 0;
  return (t1 - entry) / risk;
}

export function notional(shares: number, entry: number): number {
  return shares * entry;
}

export function openRiskPct(
  positions: { entry: number; stop: number; shares: number }[],
  equity: number,
): number {
  if (equity <= 0) return 0;
  const dollarRisk = positions.reduce((sum, p) => sum + Math.max(0, p.entry - p.stop) * p.shares, 0);
  return (dollarRisk / equity) * 100;
}

export function rMultiple(entry: number, stop: number, exit: number): number {
  const risk = entry - stop;
  if (risk <= 0) return 0;
  return (exit - entry) / risk;
}

// ─── P/L Engine ─────────────────────────────────────────────────────────────
export interface TradeLike {
  rMultiple?: number | null;
  status: string;
}
export function expectancy(trades: TradeLike[]): { value: number; winRate: number; avgWinR: number; avgLossR: number; n: number } {
  const closed = trades.filter(t => t.status === "CLOSED" && typeof t.rMultiple === "number");
  const n = closed.length;
  if (!n) return { value: 0, winRate: 0, avgWinR: 0, avgLossR: 0, n: 0 };
  const wins = closed.filter(t => (t.rMultiple as number) > 0);
  const losses = closed.filter(t => (t.rMultiple as number) <= 0);
  const winRate = wins.length / n;
  const avgWinR = wins.length ? wins.reduce((s, t) => s + (t.rMultiple as number), 0) / wins.length : 0;
  const avgLossR = losses.length ? losses.reduce((s, t) => s + (t.rMultiple as number), 0) / losses.length : 0;
  const value = winRate * avgWinR + (1 - winRate) * avgLossR;
  return { value, winRate, avgWinR, avgLossR, n };
}

export function drawdown(equityHistory: { equity: number }[]): { current: number; max: number } {
  if (!equityHistory.length) return { current: 0, max: 0 };
  let peak = equityHistory[0].equity;
  let maxDd = 0;
  let current = 0;
  for (const e of equityHistory) {
    if (e.equity > peak) peak = e.equity;
    const dd = peak > 0 ? ((e.equity - peak) / peak) * 100 : 0;
    if (dd < maxDd) maxDd = dd;
    current = dd;
  }
  return { current, max: maxDd };
}

// ─── Chizzle Score ──────────────────────────────────────────────────────────
export interface ChizzleComponents {
  planAdherence: number;       // 0–100
  riskDiscipline: number;
  patience: number;
  processJournaling: number;
  regimeRespect: number;
  emotionalState: number;
  sleepBody: number;
  reviewCadence: number;
}

export const CHIZZLE_WEIGHTS = {
  planAdherence: 25,
  riskDiscipline: 20,
  patience: 15,
  processJournaling: 10,
  regimeRespect: 10,
  emotionalState: 10,
  sleepBody: 5,
  reviewCadence: 5,
};

export function chizzleScore(c: ChizzleComponents): number {
  const total =
    c.planAdherence * CHIZZLE_WEIGHTS.planAdherence +
    c.riskDiscipline * CHIZZLE_WEIGHTS.riskDiscipline +
    c.patience * CHIZZLE_WEIGHTS.patience +
    c.processJournaling * CHIZZLE_WEIGHTS.processJournaling +
    c.regimeRespect * CHIZZLE_WEIGHTS.regimeRespect +
    c.emotionalState * CHIZZLE_WEIGHTS.emotionalState +
    c.sleepBody * CHIZZLE_WEIGHTS.sleepBody +
    c.reviewCadence * CHIZZLE_WEIGHTS.reviewCadence;
  return Math.round(total / 100); // weighted avg → 0–100
}

export function identityState(rollingScore: number): IdentityState {
  if (rollingScore >= 90) return "OPERATOR";
  if (rollingScore >= 75) return "DISCIPLINED";
  if (rollingScore >= 60) return "WORKING";
  return "OFF_PROCESS";
}

// ─── Watchlist Score ────────────────────────────────────────────────────────
export interface WatchlistComponents {
  trendQuality: number;       // 0–100
  relativeStrength: number;
  setupCleanliness: number;
  volumeBehavior: number;
  riskReward: number;
  catalystCalendar: number;
  liquidity: number;
}

export const WATCHLIST_WEIGHTS = {
  trendQuality: 25,
  relativeStrength: 20,
  setupCleanliness: 20,
  volumeBehavior: 15,
  riskReward: 10,
  catalystCalendar: 5,
  liquidity: 5,
};

export function watchlistScore(c: WatchlistComponents): { total: number; grade: Grade } {
  const total = Math.round(
    (c.trendQuality * WATCHLIST_WEIGHTS.trendQuality +
      c.relativeStrength * WATCHLIST_WEIGHTS.relativeStrength +
      c.setupCleanliness * WATCHLIST_WEIGHTS.setupCleanliness +
      c.volumeBehavior * WATCHLIST_WEIGHTS.volumeBehavior +
      c.riskReward * WATCHLIST_WEIGHTS.riskReward +
      c.catalystCalendar * WATCHLIST_WEIGHTS.catalystCalendar +
      c.liquidity * WATCHLIST_WEIGHTS.liquidity) / 100
  );
  const grade: Grade = total >= 80 ? "A" : total >= 65 ? "B" : "Ignore";
  return { total, grade };
}

// Heuristic watchlist scoring from observable ticker state
export function autoScoreWatchlist(input: {
  price: number; sma20: number; sma50: number; sma200: number; atr: number;
  zoneLow: number; zoneHigh: number; stop: number; t1: number;
  hasEarningsWithin5d?: boolean;
}): { components: WatchlistComponents; total: number; grade: Grade } {
  // Trend Quality: price > 20 > 50 > 200, 50 slope (proxy by 50>200)
  let trend = 0;
  if (input.price > input.sma20) trend += 25;
  if (input.sma20 > input.sma50) trend += 25;
  if (input.sma50 > input.sma200) trend += 25;
  if (input.price > input.sma200) trend += 25;
  // Relative strength: distance from 200SMA in ATRs
  const rsAtrs = (input.price - input.sma200) / Math.max(input.atr, 0.001);
  const rs = Math.max(0, Math.min(100, 30 + rsAtrs * 8));
  // Setup cleanliness: how close LP is to top of zone (without exceeding by >0.5ATR)
  const above = input.price - input.zoneHigh;
  let setup = 0;
  if (input.price < input.zoneLow) {
    setup = Math.max(0, 80 - ((input.zoneLow - input.price) / Math.max(input.atr, 0.001)) * 20);
  } else if (input.price <= input.zoneHigh) {
    setup = 100;
  } else {
    setup = Math.max(0, 80 - (above / Math.max(input.atr, 0.001)) * 25);
  }
  // Volume behavior — proxy 70 baseline
  const vol = 70;
  // RR available
  const rr = rrRatio(input.price, input.stop, input.t1);
  const rrScore = Math.max(0, Math.min(100, (rr / 3) * 100));
  // Catalyst
  const cat = input.hasEarningsWithin5d ? 0 : 100;
  // Liquidity — Tier 1 is always 100
  const liq = 100;

  const components: WatchlistComponents = {
    trendQuality: trend, relativeStrength: rs, setupCleanliness: setup,
    volumeBehavior: vol, riskReward: rrScore, catalystCalendar: cat, liquidity: liq,
  };
  const { total, grade } = watchlistScore(components);
  return { components, total, grade };
}

// ─── State classifier (per ticker) ──────────────────────────────────────────
export function classifyState(
  price: number,
  zoneLow: number,
  zoneHigh: number,
  stop: number,
  setupOk: boolean,
  triggerFired: boolean,
  hasOpenPosition: boolean,
): WatchlistState {
  if (hasOpenPosition) return "LIVE";
  if (price <= stop) return "INVALIDATED";
  if (triggerFired) return "ARMED";
  if (price >= zoneLow && price <= zoneHigh) return "IN_ZONE";
  const pctToZone = ((zoneLow - price) / price) * 100;
  if (pctToZone > 0 && pctToZone <= 2) return "APPROACHING";
  if (setupOk) return "BUILDING";
  return "DORMANT";
}

// ─── Regime classifier ──────────────────────────────────────────────────────
export interface RegimeInputs {
  spyAbove20: boolean;
  spyAbove50: boolean;
  spyAbove200: boolean;
  qqqAbove20: boolean;
  qqqAbove50: boolean;
  qqqAbove200: boolean;
  breadthPct: number;     // % S&P above 50 SMA
  vix: number;
  vixRising: boolean;
  distributionDays: number;
}

export function regimeClassify(i: RegimeInputs): Regime {
  // RED priority
  if (!i.spyAbove200 || !i.qqqAbove200) return "RED";
  if (i.breadthPct < 40) return "RED";
  if (i.vix > 25) return "RED";
  if (i.distributionDays >= 6) return "RED";

  // GREEN
  const greenTrend = i.spyAbove20 && i.spyAbove50 && i.qqqAbove20 && i.qqqAbove50;
  if (greenTrend && i.breadthPct > 55 && i.vix < 18 && !i.vixRising && i.distributionDays <= 3) {
    return "GREEN";
  }
  // default to YELLOW
  return "YELLOW";
}

// ─── Auto-regime classifier (mirror of server/regimeService.ts) ─────────────
export type RegimeCode = "green" | "yellow" | "red";

export interface AutoRegimeInputs {
  spy: {
    price: number; sma20: number; sma50: number; sma200: number;
    sma20_rising: boolean; sma50_rising: boolean;
    above_20: boolean; above_50: boolean; above_200: boolean;
  };
  qqq: {
    price: number; sma20: number; sma50: number; sma200: number;
    sma20_rising: boolean; sma50_rising: boolean;
    above_20: boolean; above_50: boolean; above_200: boolean;
  };
  breadthProxyPct: number;
  vixLevel: number;
  vixSlope5d: number;
  distributionDays: number;
}

// Mirrors server classifier exactly. Server is source of truth; this is for
// display-only computations like "what would the engine say with these inputs".
export function classifyRegimeAuto(i: AutoRegimeInputs): RegimeCode {
  if (!i.spy.above_200 || !i.qqq.above_200) return "red";
  if (i.breadthProxyPct < 40) return "red";
  if (i.vixLevel > 25) return "red";
  if (i.distributionDays >= 6) return "red";

  const trendOk = i.spy.above_20 && i.spy.above_50 && i.spy.sma20_rising && i.spy.sma50_rising
    && i.qqq.above_20 && i.qqq.above_50 && i.qqq.sma20_rising && i.qqq.sma50_rising;
  if (trendOk && i.breadthProxyPct > 55 && i.vixLevel < 18 && i.vixSlope5d <= 0 && i.distributionDays <= 3) {
    return "green";
  }
  return "yellow";
}

export function regimeCodeLabel(c: RegimeCode): "GREEN" | "YELLOW" | "RED" {
  return c.toUpperCase() as "GREEN" | "YELLOW" | "RED";
}

export function regimeLabel(r: Regime): string {
  switch (r) {
    case "GREEN": return "GREEN LIGHT — ARMED";
    case "YELLOW": return "STANDBY — SELECTIVE";
    case "RED": return "STAND DOWN — CAPITAL PROTECTION";
  }
}

// ─── Trade validation ───────────────────────────────────────────────────────
export interface TradeValidationResult {
  ok: boolean;
  reason?: string;
  rr: number;
  shares: number;
  riskDollarsValue: number;
  perShareRiskValue: number;
  notional: number;
  newOpenRiskPct: number;
}

export function validateTrade(args: {
  equity: number;
  regime: Regime;
  entry: number;
  stop: number;
  t1: number;
  existingPositions: { entry: number; stop: number; shares: number }[];
  rollingChizzle?: number;
  customRiskPct?: Partial<Record<Regime, number>>;
}): TradeValidationResult {
  const psr = perShareRisk(args.entry, args.stop);
  const rd = riskDollars(args.equity, args.regime, args.customRiskPct);
  const sh = positionSize(rd, psr);
  const rr = rrRatio(args.entry, args.stop, args.t1);
  const not = notional(sh, args.entry);
  const currentOpenRisk = openRiskPct(args.existingPositions, args.equity);
  const newTradeRiskPct = args.equity > 0 ? (psr * sh / args.equity) * 100 : 0;
  const newOpen = currentOpenRisk + newTradeRiskPct;

  if (psr <= 0) return { ok: false, reason: "Stop must be below entry.", rr, shares: sh, riskDollarsValue: rd, perShareRiskValue: psr, notional: not, newOpenRiskPct: newOpen };
  if (rr < MIN_RR) return { ok: false, reason: "Reward:Risk below 2.0 — trade rejected.", rr, shares: sh, riskDollarsValue: rd, perShareRiskValue: psr, notional: not, newOpenRiskPct: newOpen };
  if (newOpen > MAX_OPEN_RISK_PCT) return { ok: false, reason: "Open risk cap breached.", rr, shares: sh, riskDollarsValue: rd, perShareRiskValue: psr, notional: not, newOpenRiskPct: newOpen };
  if (sh < 1) return { ok: false, reason: "Position size rounds to 0 shares — UNDER-FUNDED.", rr, shares: sh, riskDollarsValue: rd, perShareRiskValue: psr, notional: not, newOpenRiskPct: newOpen };
  if (args.rollingChizzle != null && args.rollingChizzle < 60) {
    return { ok: false, reason: "OFF-PROCESS — 7-day Chizzle Score < 60. No new entries.", rr, shares: sh, riskDollarsValue: rd, perShareRiskValue: psr, notional: not, newOpenRiskPct: newOpen };
  }
  const cap = NOTIONAL_CAP_PCT[args.regime];
  if (not > args.equity * cap) {
    return { ok: false, reason: `Notional exceeds ${Math.round(cap * 100)}% cap for ${args.regime} regime.`, rr, shares: sh, riskDollarsValue: rd, perShareRiskValue: psr, notional: not, newOpenRiskPct: newOpen };
  }
  return { ok: true, rr, shares: sh, riskDollarsValue: rd, perShareRiskValue: psr, notional: not, newOpenRiskPct: newOpen };
}

// ─── Leak Detection ─────────────────────────────────────────────────────────
export interface LeakInput {
  trades: { openedAt: string; closedAt?: string | null; setup: string; regimeAtEntry: string; rMultiple?: number | null; entry: number; stop: number; entryAboveZoneAtr?: number; status: string; ticker: string }[];
  periodStartISO: string;
  periodEndISO: string;
}
export type LeakFlag = "CHASING" | "STOP_DRIFT" | "REVENGE_TRADE" | "OVER_TRADING" | "UNDER_SIZING" | "SETUP_BIAS" | "REGIME_BLINDNESS";

export function detectLeaks(input: LeakInput): LeakFlag[] {
  const flags = new Set<LeakFlag>();
  const start = new Date(input.periodStartISO);
  const end = new Date(input.periodEndISO);
  const inPeriod = input.trades.filter(t => {
    const d = new Date(t.openedAt);
    return d >= start && d <= end;
  });

  // Over-trading: > 6 entries in week
  if (inPeriod.length > 6) flags.add("OVER_TRADING");

  // Chasing — proxy: 2+ entries flagged as entryAboveZoneAtr > 0.5
  const chasers = inPeriod.filter(t => (t.entryAboveZoneAtr ?? 0) > 0.5).length;
  if (chasers >= 2) flags.add("CHASING");

  // Setup bias — >80% one setup
  if (inPeriod.length >= 3) {
    const setupA = inPeriod.filter(t => t.setup === "TREND_PULLBACK").length;
    const setupB = inPeriod.filter(t => t.setup === "BREAKOUT").length;
    const total = setupA + setupB;
    if (total > 0 && Math.max(setupA, setupB) / total > 0.8) flags.add("SETUP_BIAS");
  }

  // Regime blindness — RED entries > 20%
  const redEntries = inPeriod.filter(t => t.regimeAtEntry === "RED").length;
  if (inPeriod.length > 0 && redEntries / inPeriod.length > 0.2) flags.add("REGIME_BLINDNESS");

  // Revenge trade — entry within 30min of stop-out on same ticker
  for (let i = 0; i < input.trades.length; i++) {
    const a = input.trades[i];
    if (a.status !== "CLOSED" || !a.closedAt || (a.rMultiple ?? 0) >= 0) continue;
    for (let j = 0; j < input.trades.length; j++) {
      if (i === j) continue;
      const b = input.trades[j];
      if (b.ticker !== a.ticker) continue;
      const closedT = new Date(a.closedAt).getTime();
      const openedT = new Date(b.openedAt).getTime();
      if (openedT > closedT && openedT - closedT <= 30 * 60 * 1000) {
        flags.add("REVENGE_TRADE");
      }
    }
  }

  return Array.from(flags);
}

// ─── Formatters ─────────────────────────────────────────────────────────────
export function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n);
}

export function fmtPct(n: number, signed = true): string {
  const sign = signed && n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function fmtR(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}R`;
}

export function fmtNum(n: number, decimals = 2): string {
  return n.toFixed(decimals);
}

// ─── Setup state formatting (mirrors server setupService) ─────────────────────
export type SetupStateCode =
  | "dormant" | "building" | "approaching" | "in_zone" | "armed" | "live" | "invalidated";

export function formatSetupState(state: string): string {
  switch ((state || "").toLowerCase()) {
    case "dormant": return "DORMANT";
    case "building": return "BUILDING";
    case "approaching": return "APPROACHING";
    case "in_zone": return "IN ZONE";
    case "armed": return "ARMED";
    case "live": return "LIVE";
    case "invalidated": return "INVALIDATED";
    default: return (state || "").toUpperCase();
  }
}

export function setupStateColor(state: string): string {
  switch ((state || "").toLowerCase()) {
    case "armed": return "state-armed";
    case "in_zone": return "state-inzone";
    case "approaching": return "state-approaching";
    case "live": return "state-live";
    case "invalidated": return "state-invalidated";
    case "dormant": return "state-dormant";
    default: return "";
  }
}

// Priority ranking for sorting (higher = more important / nearer to action)
export function setupStatePriority(state: string): number {
  switch ((state || "").toLowerCase()) {
    case "armed": return 6;
    case "in_zone": return 5;
    case "approaching": return 4;
    case "building": return 3;
    case "live": return 2;
    case "invalidated": return 1;
    case "dormant": return 0;
    default: return -1;
  }
}

export function formatSetupKind(kind: string): string {
  return kind === "breakout" ? "Breakout" : "Trend-Pullback";
}

// ─── Regime gate helpers (mirrors server /api/regime/gates) ───────────────
// Lowercase regime keys to match the server's `getEffectiveRegime().code`.
export type RegimeKey = "green" | "yellow" | "red";

export function regimeRiskPct(regime: RegimeKey | Regime): number {
  const k = String(regime).toLowerCase() as RegimeKey;
  if (k === "green") return 0.03;
  if (k === "yellow") return 0.02;
  return 0.01;
}

export function regimeMaxPositions(regime: RegimeKey | Regime): number {
  const k = String(regime).toLowerCase() as RegimeKey;
  if (k === "green") return 4;
  if (k === "yellow") return 3;
  return 2;
}

export function regimeAllowedSetups(regime: RegimeKey | Regime): Array<"trend_pullback" | "breakout"> {
  const k = String(regime).toLowerCase() as RegimeKey;
  if (k === "green") return ["trend_pullback", "breakout"];
  if (k === "yellow") return ["trend_pullback"];
  return [];
}

export function isSetupBlocked(
  regime: RegimeKey | Regime,
  setup: "trend_pullback" | "breakout" | "TREND_PULLBACK" | "BREAKOUT",
): boolean {
  const k = String(regime).toLowerCase() as RegimeKey;
  const s = String(setup).toLowerCase();
  if (k === "red") return true;
  if (k === "yellow" && s === "breakout") return true;
  return false;
}

export function regimeStatusLine(regime: RegimeKey | Regime): string {
  const k = String(regime).toUpperCase() as Regime;
  return regimeLabel(k);
}

export function regimeAllowedSetupsLabel(regime: RegimeKey | Regime): string {
  const k = String(regime).toLowerCase() as RegimeKey;
  if (k === "green") return "Trend-Pullback + Breakout";
  if (k === "yellow") return "Trend-Pullback only";
  return "No new entries";
}

export function regimeAggressionBias(regime: RegimeKey | Regime): string {
  const k = String(regime).toLowerCase() as RegimeKey;
  if (k === "green") return "Add on strength";
  if (k === "yellow") return "Trim into strength";
  return "Defense";
}
