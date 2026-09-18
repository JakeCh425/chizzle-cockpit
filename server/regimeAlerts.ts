// ─────────────────────────────────────────────────────────────────────────────
// Regime early-warning + bounce alert engine.
//
// Runs every 15 min during NYSE hours. For each ticker in the tracked
// universe (SMH/QQQ/SPY + tickers referenced by open Active Setups), computes
// the current FLEX scan card and compares it to the last snapshot. Fires
// alerts on:
//
//   • REGIME_FLIP           — card.state transitions (RED→YELLOW→GREEN or reverse)
//   • RECLAIM_20SMA         — price closes above 20-SMA today, was below yesterday
//   • RECLAIM_50SMA         — price closes above 50-SMA today, was below yesterday
//   • SLOPE50_INFLECT       — 50-SMA slope crossed from < 0 → >= 0 (or vice versa)
//   • HL_CONFIRMED          — confirmed_higher_low flipped from false → true
//   • BOUNCE_OFF_LOW        — price is ≥ 3% above the 3-day low with rel-vol ≥ 1.0
//
// Delivery reuses the same dispatcher pipeline as hammer/confirmation
// alerts (Resend email + Telegram push). Per-signal cooldown prevents spam.
//
// No new deps. Zero-op if there's no eligible universe or no configured
// contacts.
// ─────────────────────────────────────────────────────────────────────────────
import { storage } from "./storage";
import { runFlexScan } from "./flexScanner";
import { dispatchHammerAlert } from "./alert-dispatcher";
import type { FlexDeskCard } from "@shared/flexScanTypes";

type RegimeSignalKind =
  | "REGIME_FLIP"
  | "RECLAIM_20SMA"
  | "RECLAIM_50SMA"
  | "SLOPE50_INFLECT"
  | "HL_CONFIRMED"
  | "BOUNCE_OFF_LOW"
  | "BOUNCE_RECLAIM";

// Per-(ticker+signal) cooldown to prevent alert spam. A regime flip is rare,
// a bounce fires at most once a day.
const COOLDOWN_MS: Record<RegimeSignalKind, number> = {
  REGIME_FLIP:      6 * 60 * 60 * 1000,  // 6h
  RECLAIM_20SMA:    12 * 60 * 60 * 1000, // 12h
  RECLAIM_50SMA:    12 * 60 * 60 * 1000, // 12h
  SLOPE50_INFLECT:  24 * 60 * 60 * 1000, // 24h
  HL_CONFIRMED:     24 * 60 * 60 * 1000, // 24h
  BOUNCE_OFF_LOW:   4 * 60 * 60 * 1000,  // 4h
  BOUNCE_RECLAIM:   4 * 60 * 60 * 1000,  // 4h
};
const lastFiredAt = new Map<string, number>();

const LABEL: Record<RegimeSignalKind, string> = {
  REGIME_FLIP:     "Regime flip",
  RECLAIM_20SMA:   "Reclaimed 20-SMA",
  RECLAIM_50SMA:   "Reclaimed 50-SMA",
  SLOPE50_INFLECT: "50-SMA slope inflection",
  HL_CONFIRMED:    "Higher-low confirmed",
  BOUNCE_OFF_LOW:  "Bounce off 3-day low",
  BOUNCE_RECLAIM:  "Bounce reclaim trigger",
};

// Snapshot of the fields we compare across ticks. Kept in memory only —
// state that survives a restart isn't important here since the cooldown
// window will absorb duplicate fires on boot.
interface Snapshot {
  state: FlexDeskCard["state"];
  price: number;
  sma20: number;
  sma50: number;
  slope50: number;
  confirmedHL: boolean;
}
const lastSnapshot = new Map<string, Snapshot>();

// ─── NYSE regular-hours gate ─────────────────────────────────────────────
// Mirrors the client's useAutoRescan.isMarketOpenEt helper so the engine
// only fires when the market is actually open and prices are moving.
function isMarketOpenEt(now: Date = new Date()): boolean {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const weekday = parts.find(p => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find(p => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find(p => p.type === "minute")?.value ?? "0");
  if (weekday === "Sat" || weekday === "Sun") return false;
  const mins = hour * 60 + minute;
  return mins >= (9 * 60 + 30) && mins < (16 * 60);
}

// ─── Universe: SMH/QQQ/SPY + tickers referenced by open Active Setups ────
async function buildUniverse(): Promise<string[]> {
  const base = ["SMH", "QQQ", "SPY"];
  const extras = new Set<string>();
  try {
    const setups = await storage.listSetupCandidates?.();
    if (Array.isArray(setups)) {
      for (const s of setups) {
        const t = (s as any).ticker;
        if (typeof t === "string" && t.trim().length > 0) {
          extras.add(t.toUpperCase());
        }
      }
    }
  } catch {
    // Non-fatal — storage layer may not expose listSetupCandidates yet.
  }
  return Array.from(new Set([...base, ...extras]));
}

// Convert one FlexDeskCard + comparison to Snapshot into a list of signals
// that should fire on this tick.
function diffSignals(card: FlexDeskCard, prev: Snapshot | undefined): RegimeSignalKind[] {
  const m = card.metrics;
  if (!m) return [];
  const out: RegimeSignalKind[] = [];

  // 1. Regime flip — coarse state transition. Fires on any change *between*
  //    the four card states (STANDARD_READY / FLEX_READY / FLEX_WATCH / STANDBY).
  if (prev && prev.state !== card.state) {
    out.push("REGIME_FLIP");
  }

  // 2. SMA reclaim — price is at/above SMA today and was strictly below on
  //    the previous snapshot's close. Only fires on the up-crossing.
  if (prev && m.price != null && m.sma20 != null) {
    if (prev.price < prev.sma20 && m.price >= m.sma20) out.push("RECLAIM_20SMA");
  }
  if (prev && m.price != null && m.sma50 != null) {
    if (prev.price < prev.sma50 && m.price >= m.sma50) out.push("RECLAIM_50SMA");
  }

  // 3. 50-SMA slope inflection — flip from negative to non-negative.
  if (prev && m.sma50_slope_pct != null) {
    if (prev.slope50 < 0 && m.sma50_slope_pct >= 0) out.push("SLOPE50_INFLECT");
  }

  // 4. Higher-low confirmed — flip from false → true.
  if (prev && m.confirmed_higher_low === true && prev.confirmedHL === false) {
    out.push("HL_CONFIRMED");
  }

  // 5. Bounce off 3-day low — current bar's off_low_pct crossed the 3%
  //    threshold with rel-vol ≥ 1.0. Fires once per cooldown so it doesn't
  //    keep pinging as long as we stay above the low.
  if (m.off_low_pct != null && m.off_low_pct >= 3 && (m.relative_volume ?? 0) >= 1) {
    out.push("BOUNCE_OFF_LOW");
  }

  // 6. Bounce reclaim trigger armed — the specific user-defined FLEX_READY
  //    setup. Fires only when the scanner promotes the card to FLEX_READY
  //    with setup="Bounce reclaim" (higher bar than plain BOUNCE_OFF_LOW).
  if (m.bounce_reclaim_trigger === true && card.setup === "Bounce reclaim") {
    out.push("BOUNCE_RECLAIM");
  }

  return out;
}

// Format a payload for the shared dispatchHammerAlert pipeline. We reuse the
// existing HammerAlertPayload shape (dispatcher already handles email +
// Telegram + dedupe + per-contact ticker filter). `patternName` becomes the
// subject label, so we set it to the regime signal name.
function toDispatchPayload(
  card: FlexDeskCard,
  kind: RegimeSignalKind,
  now: string,
) {
  const m = card.metrics!;
  const setupNoteParts: string[] = [];
  if (kind === "REGIME_FLIP") {
    setupNoteParts.push(`State: ${card.state}. Action: ${card.action}. ${card.smh_market_context}`);
  } else if (kind === "BOUNCE_OFF_LOW") {
    setupNoteParts.push(
      `+${(m.off_low_pct ?? 0).toFixed(2)}% off 3-day low $${(m.three_day_low ?? 0).toFixed(2)} · rel-vol ${(m.relative_volume ?? 0).toFixed(2)}x. ${card.action}.`,
    );
  } else if (kind === "BOUNCE_RECLAIM") {
    setupNoteParts.push(
      `BOUNCE RECLAIM armed: +${(m.off_low_pct ?? 0).toFixed(2)}% off 3-day low, rel-vol ${(m.relative_volume ?? 0).toFixed(2)}x, within ${Math.abs(m.dist_from_sma20_pct ?? 0).toFixed(2)}% of 20-SMA. Half-size entry, stop below last swing low. ${card.action}.`,
    );
  } else if (kind === "RECLAIM_20SMA") {
    setupNoteParts.push(`Price $${(m.price ?? 0).toFixed(2)} closed above 20-SMA $${(m.sma20 ?? 0).toFixed(2)}. ${card.action}.`);
  } else if (kind === "RECLAIM_50SMA") {
    setupNoteParts.push(`Price $${(m.price ?? 0).toFixed(2)} closed above 50-SMA $${(m.sma50 ?? 0).toFixed(2)}. ${card.action}.`);
  } else if (kind === "SLOPE50_INFLECT") {
    setupNoteParts.push(`50-SMA slope crossed positive (${(m.sma50_slope_pct ?? 0).toFixed(2)}%). Trend repair in progress. ${card.action}.`);
  } else if (kind === "HL_CONFIRMED") {
    setupNoteParts.push(`Confirmed higher-low printed. Structure improving. ${card.action}.`);
  }
  return {
    ticker: card.ticker,
    phase: "confirmed" as const,
    mode: "conservative" as const,
    // The dispatcher's signalKey uses candleTimestamp for dedupe. We swap in
    // the tick timestamp so each new alert has a unique key; the in-memory
    // cooldown map above prevents spam within the cooldown window.
    candleTimestamp: now,
    timeframe: "regime",
    price: card.metrics?.price ?? 0,
    entry: card.entry_zone.low ?? undefined,
    stop: card.stop.price ?? undefined,
    rr2: card.target_1.price ?? undefined,
    rr3: card.target_2?.price ?? undefined,
    setupNote: setupNoteParts.join(" "),
    patternName: LABEL[kind],
  };
}

async function evaluateOne(ticker: string, allCards: FlexDeskCard[]) {
  const card = allCards.find((c) => c.ticker === ticker);
  if (!card || !card.metrics) return;

  const prev = lastSnapshot.get(ticker);
  const signals = diffSignals(card, prev);

  // Update snapshot BEFORE firing so a failure mid-fire doesn't cause
  // re-fires on the next tick.
  lastSnapshot.set(ticker, {
    state: card.state,
    price: card.metrics.price ?? 0,
    sma20: card.metrics.sma20 ?? 0,
    sma50: card.metrics.sma50 ?? 0,
    slope50: card.metrics.sma50_slope_pct ?? 0,
    confirmedHL: card.metrics.confirmed_higher_low === true,
  });

  if (signals.length === 0) return;

  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  for (const kind of signals) {
    const key = `${ticker}:${kind}`;
    const last = lastFiredAt.get(key) ?? 0;
    if (now - last < COOLDOWN_MS[kind]) continue;
    lastFiredAt.set(key, now);

    // 1. Persist an in-app alert so the Alerts Feed picks it up immediately.
    try {
      const m = card.metrics!;
      const msg = `${ticker} · ${LABEL[kind]} · px $${(m.price ?? 0).toFixed(2)} · ${card.state} · ${card.action}`;
      await storage.createAlert({
        ticker,
        type: `REGIME_${kind}`,
        severity: kind === "REGIME_FLIP" || kind === "RECLAIM_50SMA" || kind === "BOUNCE_RECLAIM" ? "critical" : "action",
        message: msg,
        firedAt: nowIso,
        acknowledged: false,
      } as any);
    } catch (err) {
      console.warn(`[regime-alerts] createAlert failed for ${ticker}/${kind}:`, (err as any)?.message || err);
    }

    // 2. Fan out to email + Telegram (dispatcher handles contact filtering
    //    and dedupe). Non-blocking best-effort.
    try {
      await dispatchHammerAlert(toDispatchPayload(card, kind, nowIso));
    } catch (err) {
      console.warn(`[regime-alerts] dispatch failed for ${ticker}/${kind}:`, (err as any)?.message || err);
    }
  }
}

let scanning = false;
async function scanOnce() {
  if (scanning) return;
  if (!isMarketOpenEt()) return; // market closed — quiet
  scanning = true;
  try {
    const universe = await buildUniverse();
    if (universe.length === 0) return;
    // Single scan covers every ticker in one call — cheaper than one scan per ticker.
    const result = await runFlexScan({ universe });
    for (const ticker of universe) {
      try { await evaluateOne(ticker, result.cards); }
      catch (err) {
        console.warn(`[regime-alerts] ${ticker} eval failed:`, (err as any)?.message || err);
      }
    }
  } catch (err) {
    console.warn("[regime-alerts] scanOnce failed:", (err as any)?.message || err);
  } finally {
    scanning = false;
  }
}

let started = false;
export function startRegimeAlertEngine() {
  if (started) return;
  started = true;
  // First scan 60s after boot (well after warmup), then every 15 minutes.
  setTimeout(scanOnce, 60_000);
  setInterval(scanOnce, 15 * 60 * 1000);
  console.log("[regime-alerts] engine started (15-min cadence, market hours only)");
}

// Manual trigger for the QA endpoint.
export async function triggerRegimeScan() {
  await scanOnce();
}

export const _internal = { scanOnce, evaluateOne, diffSignals, buildUniverse, isMarketOpenEt };
