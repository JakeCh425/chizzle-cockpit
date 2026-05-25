# Regime Gate Logic — Chizzle Wealth Engine

User-provided spec, captured 2026-05-14 3:04 PM CDT. To be wired into `server/setupService.ts`, `server/routes.ts` (POST /api/trades), and the Watchlist + Cockpit + Trades + Settings pages when explicitly requested. Not currently active — saved for later build.

## Pseudocode

```python
# === REGIME GATE LOGIC ===

if regime == "GREEN":
    # Allow everything
    setup.visible = True
    setup.dimmed = False
    risk_multiplier = 1.0
    alerts_allowed = True

elif regime == "YELLOW":
    # Only A-quality setups
    if setup.quality != "A":
        setup.visible = False
    else:
        setup.visible = True

    # Breakouts are dimmed but still visible
    if setup.type == "BREAKOUT":
        setup.dimmed = True
    else:
        setup.dimmed = False

    risk_multiplier = 0.5
    alerts_allowed = (setup.quality == "A")

elif regime == "RED":
    # Hide all setups
    setup.visible = False
    setup.dimmed = False

    risk_multiplier = 0.0
    alerts_allowed = False

    show_banner("CASH ONLY — RED REGIME")
```

## Notes on translating to the cockpit

- `setup.quality` maps to the existing Watchlist & Scoring Engine grade: `A` (80–100) / `B` (65–79) / `Ignore` (<65). YELLOW filter is grade === 'A' only.
- `setup.type` maps to the existing setup detector: `trend_pullback` or `breakout`.
- `setup.visible` controls render in the Cockpit Watchlist panel + Watchlist page. Hidden setups still persist in `setup_candidates` for audit; just not shown.
- `setup.dimmed` = 60% opacity + tooltip explaining why.
- `risk_multiplier` multiplies the regime's base risk %:
  - GREEN: 3% × 1.0 = 3%
  - YELLOW: 2% × 0.5 = 1% (note: this is more conservative than the blueprint's flat 2% YELLOW — user has chosen to override toward more defense)
  - RED: 1% × 0.0 = 0% (cash only)
- `alerts_allowed` gates whether state-transition rows are written to the `alerts` table. RED = total alert silence. YELLOW = A-grade only.
- `show_banner("CASH ONLY — RED REGIME")` — full-page banner across Cockpit + Watchlist + Trades when regime is RED. Trades form fully disabled.

## Differences from blueprint Section 1.4

| Field | Blueprint Section 1.4 | This user spec |
|---|---|---|
| YELLOW risk | 2% flat | 2% × 0.5 = 1% effective |
| YELLOW setups allowed | Trend-Pullback only | A-grade only (any setup type), breakouts dimmed |
| RED setups allowed | Cash / index hedge / micro-size | Cash only, all hidden, alerts silenced |

User's spec is more conservative on YELLOW and RED. When wiring, use this spec as the authoritative source, not the original blueprint.

## Setup Visibility Logic

User-provided spec, captured 2026-05-14 3:06 PM CDT. Runs **after** the regime gate. Belt-and-suspenders defense — the gate decides eligibility, this layer decides rendering.

```python
# === SETUP VISIBILITY LOGIC ===
# Applies AFTER the regime gate filters

if not setup.visible:
    # Regime gate already hid it
    render = False

else:
    # Base visibility rules
    render = True

    # Dim breakouts in YELLOW regime
    if regime == "YELLOW" and setup.type == "BREAKOUT":
        setup.dimmed = True
    else:
        setup.dimmed = False

    # Hide B/C setups in YELLOW regime
    if regime == "YELLOW" and setup.quality != "A":
        render = False

    # Hide all setups in RED regime (safety check)
    if regime == "RED":
        render = False

# Final output
setup.render = render
```

### Notes
- Visibility logic is **redundant defense** — if the gate sets `setup.visible = False`, render stays False without checking anything else.
- Re-checks the YELLOW A-grade filter and RED hide-all rule as a safety net in case gate state is stale or out of sync.
- The breakout-dimming rule is re-applied here so it's consistent regardless of how the gate computed `setup.dimmed`.
- `setup.render` is the final boolean the frontend uses to decide whether to mount the row.

### Implementation note
In the cockpit, this would live as a thin client-side helper in `client/src/lib/engine.ts` (e.g., `shouldRenderSetup(setup, regime)`) called inside each setup-rendering component. Server still computes `regimeEligible` and stores it; client visibility layer adds the second pass.

## Risk Engine Logic

User-provided spec, captured 2026-05-14 3:07 PM CDT. Determines position size multiplier based on regime + setup quality. Runs at trade-entry time inside `POST /api/trades` and in the Trades form preview.

```python
# === RISK ENGINE LOGIC ===
# Determines position size multiplier based on regime + setup quality

if regime == "GREEN":
    # Full risk allowed
    risk_multiplier = 1.0

elif regime == "YELLOW":
    # Half risk, A-setups only
    if setup.quality == "A":
        risk_multiplier = 0.5
    else:
        risk_multiplier = 0.0  # B/C setups not allowed

elif regime == "RED":
    # No risk allowed
    risk_multiplier = 0.0

# Final position size (example: base_risk = 2% of equity)
position_size = base_risk * risk_multiplier
```

### Resolved risk percentages (assuming blueprint base risk %)

| Regime | Setup Quality | base_risk | risk_multiplier | Effective risk |
|---|---|---|---|---|
| GREEN | A | 3% | 1.0 | **3%** |
| GREEN | B | 3% | 1.0 | **3%** |
| YELLOW | A | 2% | 0.5 | **1%** |
| YELLOW | B | 2% | 0.0 | **0% (rejected)** |
| YELLOW | Ignore | 2% | 0.0 | **0% (rejected)** |
| RED | any | 1% | 0.0 | **0% (rejected)** |

### Notes
- Effective YELLOW A-grade risk is **1%** — same as RED baseline in the original blueprint. This is intentionally conservative.
- A `risk_multiplier` of 0.0 must reject the trade entirely (not just sub-size). Server enforces with HTTP 400.
- `base_risk` reads from the current regime's risk % (3 / 2 / 1) before the multiplier is applied.
- This logic is the authoritative risk calculator going forward. The existing `engine.ts` `riskDollars()` function will need to multiply by this new `risk_multiplier`.

### Implementation note
When wiring, the canonical computation becomes:

```
risk_dollars = equity × base_risk(regime) × risk_multiplier(regime, setup.quality)
shares = floor(risk_dollars / per_share_risk)
```

If `risk_multiplier == 0`, short-circuit before share calculation and reject with reason from the regime gate.

## Alert Engine Logic

User-provided spec, captured 2026-05-14 3:08 PM CDT. Determines whether an alert should fire for a given setup. Runs inside the setup detector before any alert row is written to the `alerts` table.

```python
# === ALERT ENGINE LOGIC ===
# Determines whether an alert should fire for a given setup

# Default: no alert
alert_allowed = False

if regime == "GREEN":
    # All valid setups may trigger alerts
    if setup.valid:
        alert_allowed = True

elif regime == "YELLOW":
    # Only A-grade setups may trigger alerts
    if setup.valid and setup.quality == "A":
        alert_allowed = True
    else:
        alert_allowed = False

elif regime == "RED":
    # No alerts in RED regime
    alert_allowed = False

# Final decision
setup.alert_allowed = alert_allowed
```

### Alert eligibility matrix

| Regime | Setup valid? | Quality | Alerts fire? |
|---|---|---|---|
| GREEN | yes | A / B | **yes** |
| GREEN | no | any | no |
| YELLOW | yes | A | **yes** |
| YELLOW | yes | B / Ignore | no |
| YELLOW | no | any | no |
| RED | any | any | **no (silent)** |

### Notes
- `setup.valid` means the candidate has passed all qualification checks (state is `IN ZONE`, `APPROACHING`, or `ARMED` — not `DORMANT`, `BUILDING`, or `INVALIDATED`).
- RED is a total alert silence rule. Even critical state transitions on previously-tracked setups go unannounced. This matches the user's RED "cash only / no alerts" stance from the earlier regime gate spec.
- This rule is **independent** of `regimeEligible` — a setup can be regime-blocked from arming but still fire alerts (in GREEN) so the user knows what's happening on the tape. In YELLOW and RED the alert rule tightens further.
- Suppression rules from the original blueprint Section 5.2 still apply on top of this (max 1 trigger alert per ticker per session, stop-hit and regime-shift alerts never suppressed). RED override wins — if regime is RED, no alerts of any kind from this engine.
- Stop-hit alerts on **already-open** trades are NOT gated by this logic. Open trades still get stop-hit / T1-hit / earnings-window alerts regardless of regime. This engine only gates **new-setup alerts** (approaching / in-zone / armed / invalidated).

### Implementation note
When wiring, the alert-write call inside `setupService.ts` state-transition handler becomes:

```
if (alertAllowed(regime, setup)) {
  storage.insertAlert({ ... })
}
```

Where `alertAllowed()` is the pure function above, exposed from `lib/engine.ts` and re-imported server-side via the shared module.

## Stop-Hit Alert Logic

User-provided spec, captured 2026-05-14 3:09 PM CDT. Stop-hit alerts **bypass the regime gate and alert engine**. They ALWAYS fire when an open position breaches its stop, regardless of regime state.

```python
# === STOP-HIT ALERT LOGIC ===
# Stop alerts bypass the regime gate and alert engine.
# They ALWAYS fire if a position is open and the stop is breached.

if position.is_open:
    if price <= position.stop_price:
        stop_hit_alert = True
    else:
        stop_hit_alert = False
else:
    stop_hit_alert = False

# Final decision
position.stop_hit_alert = stop_hit_alert
```

### Notes
- This is the **non-negotiable safety alert**. Open positions must always be monitored regardless of GREEN / YELLOW / RED state.
- The check is `price <= stop_price` for LONG positions. When wiring shorts (future), add `price >= stop_price` for shorts.
- Runs every price tick on open positions — either on the SSE stream tick (when live polling is enabled) or on manual price refresh in Low-Credit Mode.
- Severity: **critical** (signal.red, sound: low alert per blueprint Section 5.2). Never suppressed.
- Triggers automatic actions per blueprint Section 3.4:
  1. Position closed at stop price (broker-side hard stop should already have triggered — this is the system's confirmation alert)
  2. Trade logged with `exit_reason = "stop"` and `r_multiple` computed
  3. Chizzle Score deduction does NOT apply for a clean stop-out (that's plan adherence, not violation)
  4. Post-trade journal entry queued (amber dot in Journal Queue panel)

### Alert payload
```
{
  ticker: position.ticker,
  type: "stop_hit",
  severity: "critical",
  message: "{ticker} STOP HIT at {price} — position closed",
  fired_at: now(),
  acknowledged: false
}
```

### Implementation note
This logic lives in `priceService.ts` or a new `positionMonitor.ts` that subscribes to price ticks. On every tick:
```
for position in storage.getOpenPositions():
  if priceBreachedStop(position, latestPrice):
    storage.insertAlert({ type: 'stop_hit', severity: 'critical', ... })
    storage.closeTradeAtStop(position, latestPrice)
```
This call path is **independent** of the regime/alert engines — a direct write, no eligibility checks.

### Companion alerts that also bypass regime gating
Per blueprint Section 5.2 ("Stop-hit and regime-shift alerts are **never** suppressed"), these should follow the same always-on pattern:
- `stop_hit` (this spec)
- `t1_hit` — user needs to know to book partial + move stop to breakeven
- `regime_shift` — user needs to know discipline parameters just changed
- `earnings_window` — user needs to know to trim or skip a held position

All four should bypass the regime/alert engines and write directly to the alerts table.

## Regime-Shift Alert Logic

User-provided spec, captured 2026-05-14 3:11 PM CDT. Fires when the effective regime changes from its previous value. **Bypasses the alert engine** — always allowed, never suppressed.

```python
# === REGIME-SHIFT ALERT LOGIC ===
# Fires when the regime changes from its previous value.
# This bypasses the alert engine and is always allowed.

if previous_regime != regime:
    regime_shift_alert = True
    regime_shift_message = f"Regime changed: {previous_regime} → {regime}"
else:
    regime_shift_alert = False

# Final output
alerts.regime_shift = {
    "allowed": regime_shift_alert,
    "message": regime_shift_message if regime_shift_alert else None
}
```

### When this fires
- After the 2-consecutive-close confirmation rule (blueprint Section 1.5) promotes a pending regime to current. The shift alert fires on **promotion**, not on a pending-state change.
- When the user toggles manual override on or off (effective regime changed even if auto regime didn't).
- When manual override is on and the user changes the override target (e.g., MANUAL GREEN → MANUAL RED).

### Alert payload
```
{
  ticker: null,            // portfolio-level, not ticker-specific
  type: "regime_shift",
  severity: "critical",    // user must see this
  message: "Regime changed: YELLOW → RED",
  fired_at: now(),
  acknowledged: false,
  metadata: {
    previous_regime: "yellow",
    new_regime: "red",
    source: "AUTO" | "MANUAL",
    trigger: "two_close_confirmation" | "manual_override_enabled" | "manual_override_disabled" | "manual_override_changed"
  }
}
```

### UI behavior on regime shift
When a regime_shift alert fires, the cockpit should also:
1. Update the header regime chip color/text immediately.
2. Update the Risk Panel (new risk %, new max positions, new allowed setups).
3. Re-run setup visibility on all rendered candidates (re-apply gate + visibility logic).
4. Show a brief toast: `"Regime: YELLOW → RED. Risk reduced to 1%. New entries blocked."`
5. If shift is INTO RED while positions are open, show a banner: `"RED REGIME ACTIVE — {n} open position(s). Review stops."`

### Companion: regime promotion vs pending
- `regime_shift` fires only on **promotion** (current changes).
- `regime_pending` is a separate, lower-severity info alert that fires when the pending regime first appears (`pending_count = 1`). This gives the user a heads-up that a shift is brewing without spamming on every recompute.
- `regime_pending` IS gated by the regime alert engine (info-tier, optional).
- `regime_shift` is NOT gated — always fires.

### Notes
- This is one of the four always-on bypass alerts (stop_hit, t1_hit, regime_shift, earnings_window) per blueprint Section 5.2.
- Severity is `critical` because regime is the single biggest driver of all downstream discipline rules — the user must always know when it changes.
- `previous_regime` is read from the persisted `regime_state.current_regime` BEFORE the new value is written. Logic order: read old → write new → compare → fire alert if different.
- Manual override toggles count as effective-regime changes. If user has manual YELLOW override on top of auto GREEN, the effective regime is YELLOW. Disabling the override moves effective to GREEN — fires regime_shift YELLOW → GREEN.

### Implementation note
```
function onRegimeRecompute(newRaw, newPending, newCurrent) {
  const oldEffective = storage.getEffectiveRegime()
  // ... apply 2-close confirmation, persist state ...
  const newEffective = storage.getEffectiveRegime()
  if (oldEffective.code !== newEffective.code) {
    storage.insertAlert({
      type: 'regime_shift',
      severity: 'critical',
      message: `Regime changed: ${oldEffective.code.toUpperCase()} → ${newEffective.code.toUpperCase()}`,
      metadata: { previous_regime: oldEffective.code, new_regime: newEffective.code, source: newEffective.source, trigger: '...' }
    })
  }
}
```

## Earnings-Window Logic

User-provided spec, captured 2026-05-14 3:12 PM CDT. Blocks new setups when earnings are too close. **Always-on bypass lane** — not suppressed by regime.

```python
# === EARNINGS-WINDOW LOGIC ===
# Blocks new setups if earnings are too close.
# This lives in the ALWAYS-ON BYPASS LANE (never suppressed by regime).

# Inputs:
# - earnings_date (datetime or None)
# - today (datetime)
# - earnings_buffer_days (e.g., 3)

if earnings_date is None:
    earnings_block = False
else:
    days_to_earnings = (earnings_date - today).days
    earnings_block = (days_to_earnings <= earnings_buffer_days)

# Final decision:
earnings_window = {
    "blocked": earnings_block,
    "reason": "Earnings within buffer window" if earnings_block else None
}
```

### Notes
- User spec uses `earnings_buffer_days = 3`. Blueprint Section 2.3 specifies 5 trading days. **User spec wins** — use 3 calendar days as the active value unless user later changes it.
- Existing setup detector already implements a 5-trading-day earnings disqualifier via Finnhub `/calendar/earnings`. When wiring this spec, replace the 5-day rule with the 3-day rule from this logic.
- `earnings_buffer_days` should be configurable from Settings (slider 0–10 days) so the user can tune defensively without code changes.
- Earnings data source: Finnhub `/calendar/earnings?from={today}&to={today+buffer}&symbol={ticker}`. Already authenticated via existing credential proxy. Cache once per day.
- This check is **independent of regime** — even in GREEN with an A-grade setup, earnings within buffer blocks the entry.

### Where this fires in the discipline pipeline
Earnings-window runs **alongside** the regime gate, not after it. Both must pass:
```
final_eligible = regime_gate.visible AND NOT earnings_window.blocked
```
If either blocks, the setup is non-eligible. The reason shown to the user is whichever block triggered first (regime takes priority since it's broader).

### Interaction with open positions
For **open positions** (not new setups), earnings-window fires a different alert: `earnings_window_warning`. This is one of the four always-on bypass alerts (stop_hit, t1_hit, regime_shift, earnings_window).

Logic:
```python
if position.is_open and earnings_date is not None:
    days_to_earnings = (earnings_date - today).days
    if days_to_earnings <= earnings_buffer_days:
        # Fire warning every morning until earnings or position closes
        alert.fire("earnings_window", severity="action",
                   message=f"{ticker} earnings in {days_to_earnings}d — trim or skip")
```
This warning fires daily (not on every tick) and bypasses the regime alert engine.

### Alert payloads

**New-setup block (no alert, just disqualifier on the candidate):**
```
setup_candidate.disqualifiers.append("earnings_window")
setup_candidate.state = "DORMANT"
setup_candidate.regime_blocked_reason = "Earnings in {n} days"
```

**Open-position warning (alert fires daily):**
```
{
  ticker: position.ticker,
  type: "earnings_window",
  severity: "action",
  message: "{ticker} earnings in {n}d — trim or skip per blueprint Section 2.3",
  fired_at: now(),
  acknowledged: false,
  metadata: {
    earnings_date: earnings_date.iso(),
    days_to_earnings: n,
    position_id: position.id
  }
}
```

### UI behavior
- **Watchlist:** earnings-blocked setups show a `EARNINGS Xd` chip in amber next to their state badge. Expand-row shows earnings date.
- **Trades form:** if the selected ticker has earnings within buffer, show inline banner: `"{ticker} earnings in {n}d — entry blocked per buffer rule."` Submit disabled.
- **Cockpit Alerts feed:** open-position earnings warnings render in amber (action tier) with the days-to-earnings number prominent.
- **Cockpit header:** if any open position has earnings within buffer, show a small amber pill `⚠ EARNINGS RISK` next to the regime chip.

### Implementation note
Earnings calendar fetcher (`server/earningsService.ts` or inline in `setupService.ts`):
```
function isInEarningsWindow(ticker, bufferDays = 3) {
  const cal = await fetchEarningsCalendar(ticker, today, today + bufferDays)
  if (cal.length === 0) return { blocked: false }
  const next = cal[0]
  const days = daysBetween(today, next.date)
  return { blocked: days <= bufferDays, daysToEarnings: days, date: next.date }
}
```
Cache result for the trading day. Re-fetch at 6:15pm ET when daily data refreshes.

## When to wire
Only when user says "wire the regime gate" or equivalent. Until then, this file is reference only.

---

## T1-Hit Logic (bypass lane — always allowed, even in RED)

```python
# === T1-HIT LOGIC ===
# Fires when price reaches the first target (T1).
# This bypasses the regime gate and alert engine.
# Always allowed, even in RED.

# Inputs:
# - position.is_open
# - position.t1_price (may be None)
# - price (current)
# - t1_filled (boolean stored on the position)

if position.is_open and position.t1_price is not None:
    if not position.t1_filled and price >= position.t1_price:
        t1_hit = True
        t1_message = f"T1 hit on {position.ticker} at {price}"
        position.t1_filled = True
    else:
        t1_hit = False
else:
    t1_hit = False

# Final output
alerts.t1_hit = {
    "allowed": t1_hit,
    "message": t1_message if t1_hit else None
}
```

**Notes:**
- Bypass lane — fires regardless of regime (GREEN/YELLOW/RED).
- One-shot: `t1_filled` flag prevents re-firing on subsequent ticks above T1.
- Requires `t1_filled` boolean column on the `trades` table (add via Drizzle migration when wiring).
- Pairs with Stop-Hit Logic for the full exit-side bypass set.

---

## Setup Quality Classification (A / B / C)

Assigns an objective grade to each detected setup. Feeds the Regime Gate, Risk Engine, and Alert Engine (YELLOW = A-grade only).

```python
# === SETUP QUALITY CLASSIFICATION (A/B/C) ===
# Assigns a quality grade to each setup based on objective criteria.

# Inputs:
# - setup.type ∈ {BREAKOUT, TREND_PULLBACK}
# - setup.relative_strength (0–100)
# - setup.trend_strength (0–100)
# - setup.volume_score (0–100)
# - setup.cleanliness_score (0–100)
# - setup.market_alignment (boolean)
# - setup.earnings_risk (boolean)

# Default
setup.quality = "C"

# A-GRADE CRITERIA
if (
    setup.relative_strength >= 70 and
    setup.trend_strength >= 70 and
    setup.volume_score >= 60 and
    setup.cleanliness_score >= 70 and
    setup.market_alignment and
    not setup.earnings_risk
):
    setup.quality = "A"

# B-GRADE CRITERIA
elif (
    setup.relative_strength >= 50 and
    setup.trend_strength >= 50 and
    setup.volume_score >= 40 and
    setup.cleanliness_score >= 50 and
    not setup.earnings_risk
):
    setup.quality = "B"

# C-GRADE (fallback)
else:
    setup.quality = "C"
```

**Notes:**
- A-grade requires hard veto on `earnings_risk` AND `market_alignment` true.
- B-grade still vetoes on `earnings_risk` but does not require market alignment.
- C-grade is the fallback bucket — anything failing both A and B.
- New input fields needed on `setup_candidates` table when wiring: `relative_strength`, `trend_strength`, `volume_score`, `cleanliness_score`, `market_alignment`, `earnings_risk`, `quality`.
- Pairs with Regime Gate: YELLOW shows A only · GREEN shows A/B/C · RED hides all.
- Pairs with Risk Engine: YELLOW × A = 0.5x · YELLOW × B/C = 0.0x.

---

## Breakout Detection Logic

Confirms a breakout candle: price clears recent high by a buffer, closes above the level (no wick-only), and volume expands.

```python
# === BREAKOUT DETECTION LOGIC ===
# Determines whether a breakout setup exists on the current candle.

# Inputs:
# - price.high
# - price.close
# - price.volume
# - recent_high (highest high over N days, e.g., 20)
# - volume_avg (average volume over N days)
# - breakout_buffer_pct (e.g., 0.1% to avoid micro-breakouts)
# - min_volume_ratio (e.g., 1.3× average volume)

breakout = False
breakout_reason = None

# 1. Price must exceed recent high by a buffer
if price.high >= recent_high * (1 + breakout_buffer_pct):
    
    # 2. Close must be above the breakout level (no wick-only breakouts)
    if price.close >= recent_high:
        
        # 3. Volume confirmation
        if price.volume >= volume_avg * min_volume_ratio:
            breakout = True
            breakout_reason = "High-volume breakout above recent high"
        else:
            breakout = False
            breakout_reason = "Price broke out but volume insufficient"
    else:
        breakout = False
        breakout_reason = "Wick-only breakout (close below breakout level)"
else:
    breakout = False
    breakout_reason = "Price did not exceed recent high"

# Final output
setup.breakout_detected = breakout
setup.breakout_reason = breakout_reason
```

**Notes:**
- Three-gate confirmation: buffer-clear → close-above → volume expansion. All three required for `breakout_detected = True`.
- Defaults to apply when wiring: `N=20` lookback, `breakout_buffer_pct=0.001` (0.1%), `min_volume_ratio=1.3`.
- `breakout_reason` is stored for the Journal/Audit trail even when False — keeps the rejection cause visible.
- Replaces/refines the current `setupService.ts` Breakout detector — when wiring, port these exact thresholds into the existing state machine (DORMANT → BUILDING → APPROACHING → IN_ZONE → ARMED → LIVE).
- Feeds Setup Quality Classification next: a True breakout still has to clear A/B/C grading before reaching the Regime Gate.

---

## Migration: Setup Quality + T1-Hit Columns

User-supplied Drizzle migration (original Postgres form, single-table). Actual execution targets SQLite and splits across `setup_candidates` (quality fields) and `trades` (t1_filled).

### Original (user-supplied, Postgres)

```javascript
import { sql } from "drizzle-orm";
import { pgTable, varchar, integer, boolean } from "drizzle-orm/pg-core";

export const up = async (db) => {
  await db.execute(sql`
    ALTER TABLE setups
      ADD COLUMN relative_strength INTEGER,
      ADD COLUMN trend_strength INTEGER,
      ADD COLUMN volume_score INTEGER,
      ADD COLUMN cleanliness_score INTEGER,
      ADD COLUMN market_alignment BOOLEAN,
      ADD COLUMN earnings_risk BOOLEAN,
      ADD COLUMN quality VARCHAR(1),
      ADD COLUMN t1_filled BOOLEAN DEFAULT FALSE;
  `);
};

export const down = async (db) => {
  await db.execute(sql`
    ALTER TABLE setups
      DROP COLUMN relative_strength,
      DROP COLUMN trend_strength,
      DROP COLUMN volume_score,
      DROP COLUMN cleanliness_score,
      DROP COLUMN market_alignment,
      DROP COLUMN earnings_risk,
      DROP COLUMN quality,
      DROP COLUMN t1_filled;
  `);
};
```

### Executed (SQLite, corrected table mapping)

```sql
ALTER TABLE setup_candidates ADD COLUMN relative_strength INTEGER;
ALTER TABLE setup_candidates ADD COLUMN trend_strength INTEGER;
ALTER TABLE setup_candidates ADD COLUMN volume_score INTEGER;
ALTER TABLE setup_candidates ADD COLUMN cleanliness_score INTEGER;
ALTER TABLE setup_candidates ADD COLUMN market_alignment INTEGER;  -- 0/1
ALTER TABLE setup_candidates ADD COLUMN earnings_risk INTEGER;     -- 0/1
ALTER TABLE setup_candidates ADD COLUMN quality TEXT;              -- 'A' | 'B' | 'C'
ALTER TABLE trades ADD COLUMN t1_filled INTEGER DEFAULT 0;         -- 0/1
```

**Notes:**
- All columns nullable; existing rows get NULL for quality fields and 0 for `t1_filled`.
- Booleans stored as INTEGER 0/1 per SQLite convention.
- `shared/schema.ts` updated in parallel so Drizzle/TypeScript sees the new fields.
- No backfill — quality scoring runs only on new setups once the classifier is wired.

---

## Position Sizing Formula

Final share count after Regime Engine and Setup Quality have decided the risk multiplier.

```python
# === POSITION SIZING FORMULA ===
# Computes allowed position size and share count based on regime and setup quality.

# Base risk: dynamic % of equity
base_risk = account_equity × risk_pct        # risk_pct ∈ {0.01, 0.02, 0.03}

# Regime-adjusted position size
position_size = base_risk × risk_multiplier  # multiplier ∈ {1.0, 0.5, 0.0}

# Stop distance in dollars per share
stop_distance = entry_price – stop_price     # must be > 0

# Final share count
shares = floor(position_size / stop_distance)
```

**Inputs / sources:**
- `account_equity` — current equity from `equity_history` (latest row).
- `risk_pct` — user-selected discipline tier: 1% / 2% / 3% (defaulted from `settings`).
- `risk_multiplier` — output of the Risk Engine:
  - GREEN × any = 1.0
  - YELLOW × A = 0.5
  - YELLOW × B/C = 0.0
  - RED × any = 0.0
- `entry_price` — midpoint of `setup_candidates.entry_zone_low`/`entry_zone_high`, or user-entered price on the manual trade form.
- `stop_price` — `setup_candidates.stop`, or user override.

**Guards:**
- `stop_distance` must be > 0 — reject the trade if entry ≤ stop.
- `position_size = 0` → `shares = 0` → trade blocked (RED regime or YELLOW × non-A).
- `floor()` always rounds down — never over-size.
- Optional max-share cap (not in formula) when `shares × entry_price` would exceed available cash.

**Where this lives when wired:**
- Pure function, called by the manual "Place Trade" form on the cockpit.
- Returns `{ shares, base_risk, position_size, stop_distance, blocked_reason? }` for display.
- Persisted on the `trades` row as `risk_dollars` (= `shares × stop_distance`).

---

## Entry Trigger Logic

Flips a setup from ARMED → LIVE. Requires THREE conditions: candle signal + structure signal + close above reaction high. All three or no entry.

```python
# === ENTRY TRIGGER LOGIC ===
# Determines the exact moment a setup becomes actionable.
# Requires BOTH a candle signal AND a structure signal.
# Entry is ONLY allowed on a break + close above the reaction high.

entry_trigger = False
entry_reason = None

# 1. Candle Signal (must have one)
valid_candle_signal = (
    setup.candle_signal in {
        "bullish_engulfing",
        "hammer",
        "inside_bar_break_up"
    }
)

# 2. Structure Signal (must have one)
valid_structure_signal = (
    setup.structure_signal in {
        "micro_higher_low",
        "trendline_break",
        "volume_expansion"
    }
)

# 3. Reaction High Break (the actual trigger)
reaction_high = setup.reaction_high   # stored when setup is detected

if valid_candle_signal and valid_structure_signal:
    if price.close > reaction_high:
        entry_trigger = True
        entry_reason = (
            f"Entry confirmed: candle={setup.candle_signal}, "
            f"structure={setup.structure_signal}, "
            f"break of reaction high at {reaction_high}"
        )
    else:
        entry_trigger = False
        entry_reason = "Signals valid but reaction high not broken"
else:
    entry_trigger = False
    entry_reason = "Missing required candle or structure signal"

# Final output
setup.entry_trigger = entry_trigger
setup.entry_reason = entry_reason
```

**Notes:**
- Three-gate trigger: candle signal AND structure signal AND close above reaction_high. All required.
- Allowed candle signals: `bullish_engulfing`, `hammer`, `inside_bar_break_up`.
- Allowed structure signals: `micro_higher_low`, `trendline_break`, `volume_expansion`.
- `reaction_high` is captured when the setup first enters BUILDING/APPROACHING state — must be persisted on `setup_candidates` so it survives across ticks.
- "Close above" means the candle CLOSE, not the high — wick breaks do not count (mirrors the Breakout Detection rule).
- `entry_reason` is stored on both pass and fail so the Journal/Audit log shows why a trigger didn't fire.
- **Where this lives:** runs after Setup Quality is graded, before Position Sizing. Only graded setups (A/B/C) that pass the Regime Gate and Risk Engine even reach the trigger check.
- **New columns needed on `setup_candidates` when wiring:** `candle_signal` (TEXT), `structure_signal` (TEXT), `reaction_high` (REAL), `entry_trigger` (INTEGER 0/1), `entry_reason` (TEXT).
- State machine effect: trigger TRUE moves setup ARMED → LIVE and is the cue for the manual "Place Trade" form to pre-fill.

---

## T2 / Trailing Stop Logic

Manages the runner portion after T1 fills. Trails the stop using the tighter of structure (last higher low) and ATR (close − 2×ATR14). Exits on close below.

```python
# === T2 / TRAILING STOP LOGIC ===
# Manages the remaining position after T1 is hit.
# Logic: once T1 is filled, trail the stop under higher lows or ATR-based levels.

t2_exit = False
t2_reason = None

# 1. Only activate trailing logic after T1 is hit
if trade.t1_filled:

    # 2. Compute trailing stop level
    # Option A: Structure-based trailing (preferred)
    trailing_stop = max(
        trade.trailing_stop_prev,
        price.higher_low_level  # last confirmed higher low
    )

    # Option B: ATR-based trailing (fallback)
    atr_stop = price.close - (2 * price.atr_14)

    # Choose the tighter of the two (more conservative)
    trailing_stop = max(trailing_stop, atr_stop)

    # 3. Trigger exit if price closes below trailing stop
    if price.close <= trailing_stop:
        t2_exit = True
        t2_reason = f"T2 exit: price closed below trailing stop at {trailing_stop}"
    else:
        t2_exit = False
        t2_reason = "T1 hit; trailing stop intact"

else:
    t2_exit = False
    t2_reason = "T1 not hit; T2 logic inactive"

# Final output
trade.t2_exit = t2_exit
trade.t2_reason = t2_reason
trade.trailing_stop = trailing_stop if trade.t1_filled else None
```

**Notes:**
- Gated by `trade.t1_filled` — does nothing until T1-Hit Logic sets that flag. Pairs directly with T1-Hit.
- Two-source trail, tighter wins:
  - **Structure trail:** the highest `higher_low_level` seen since T1, ratcheted via `max(trailing_stop_prev, higher_low_level)` — never moves down.
  - **ATR trail:** `close − 2 × ATR14` as the fallback floor when structure hasn't formed a new higher low yet.
  - `max(structure, atr)` picks whichever is **higher** (tighter / more protective).
- Exit triggers on **close below**, not intraday touch — matches the rest of the system's "close confirms" rule.
- **Bypass lane:** like Stop-Hit / T1-Hit, T2 exits fire regardless of regime (GREEN / YELLOW / RED) — open positions are always managed.
- **Higher-low detection:** `price.higher_low_level` must come from a swing-detection helper (3-bar fractal or similar). Stored per-trade so the trail can ratchet across ticks.
- **New columns needed on `trades` when wiring:**
  - `trailing_stop` REAL — current trail level
  - `trailing_stop_prev` REAL — previous trail (for ratchet logic)
  - `t2_exit` INTEGER 0/1
  - `t2_reason` TEXT
  - `atr_14` REAL — cached for the ATR fallback
- **Lifecycle:** Stop-Hit (full exit) ← entry to T1 → T1-Hit (partial exit, flag set) → T2/Trailing (manages runner) → T2 exit (close runner). One trade row, four possible exit states.

---

## Chizzle Score Logic (Setup Ranking)

Composite 0–100 score used to **rank** setups by strength. Purely prioritization — does NOT gate trades or alter discipline.

```python
# === CHIZZLE SCORE LOGIC ===
# Produces a composite score (0–100) used to rank setups by strength.
# This score does NOT affect discipline; it is purely for prioritization.

chizzle_score = 0
chizzle_reason = []

# 1. Normalize each component to a 0–20 scale
rs_component          = clamp(setup.relative_strength, 0, 20)
trend_component       = clamp(setup.trend_strength, 0, 20)
volume_component      = clamp(setup.volume_score, 0, 20)
clean_component       = clamp(setup.cleanliness_score, 0, 20)

# 2. Market alignment bonus (0 or +10)
market_bonus = 10 if setup.market_alignment else 0

# 3. Earnings risk penalty (0 or -10)
earnings_penalty = -10 if setup.earnings_risk else 0

# 4. Quality grade multiplier
# A = 1.2x, B = 1.0x, C = 0.8x
grade_multiplier = {
    "A": 1.2,
    "B": 1.0,
    "C": 0.8
}.get(setup.quality, 1.0)

# 5. Raw score before multiplier
raw_score = (
    rs_component +
    trend_component +
    volume_component +
    clean_component +
    market_bonus +
    earnings_penalty
)

# 6. Apply multiplier and clamp to 0–100
chizzle_score = clamp(int(raw_score * grade_multiplier), 0, 100)

# 7. Reason string
chizzle_reason = (
    f"RS={rs_component}, Trend={trend_component}, Vol={volume_component}, "
    f"Clean={clean_component}, MarketBonus={market_bonus}, "
    f"EarningsPenalty={earnings_penalty}, GradeMult={grade_multiplier}"
)

# Final output
setup.chizzle_score = chizzle_score
setup.chizzle_reason = chizzle_reason
```

**Important — naming clarification:**
- This is the **Setup Chizzle Score** — a per-setup ranking score (0–100).
- It is **distinct** from the existing `chizzle_scores` table in the schema, which tracks **discipline/execution** scoring on closed trades.
- Two different concepts, same brand name. When wiring, the setup score lives on `setup_candidates`, not the `chizzle_scores` table.

**Component math (max possible):**
- 4 × 20 (RS + Trend + Volume + Clean) = 80
- + 10 market_bonus
- − 10 earnings_penalty (or 0)
- Max raw = 90 (alignment, no earnings risk)
- × 1.2 A-grade multiplier = **108** → clamped to **100**
- Min raw = −10 (everything zero + earnings risk) × 0.8 = −8 → clamped to **0**

**Notes:**
- `clamp(x, lo, hi)` = `max(lo, min(hi, x))` — assumes a helper exists when wiring.
- All four 0–20 components reuse the same 0–100 inputs from Setup Quality Classification, just clamped narrower. If the upstream score is 70, the component is 20 (saturates at 20).
- Score does **not** gate anything — Regime Gate, Risk Engine, and Entry Trigger remain the only discipline checks. This is purely "which setup to look at first."
- Sort order on the cockpit Watchlist page: `chizzle_score DESC`, then `quality ASC` (A above B above C), then ticker.
- **New columns needed on `setup_candidates` when wiring:** `chizzle_score` (INTEGER), `chizzle_reason` (TEXT).
- Recomputed every time `setup_candidates` is updated — pure function of existing fields, no new data needed.

---

## Journal Triggers (Auto-Write Events)

Defines the events that auto-create immutable journal rows. Captures full state snapshot at the moment each event fires.

```python
# === JOURNAL TRIGGERS ===
# Defines which events automatically write a journal row.
# Journal entries are immutable snapshots of state at the moment of the event.

journal_entries = []

def write_journal(event_type, trade, extra=None):
    journal_entries.append({
        "timestamp": now(),
        "event": event_type,
        "ticker": trade.ticker,
        "entry_price": trade.entry_price,
        "stop_price": trade.stop_price,
        "t1_price": trade.t1_price,
        "t2_price": trade.t2_price,
        "exit_price": trade.exit_price,
        "regime": trade.regime_at_entry,
        "quality": trade.quality,
        "chizzle_score": trade.chizzle_score,
        "risk_multiplier": trade.risk_multiplier,
        "shares": trade.shares,
        "pnl": trade.realized_pnl,
        "notes": extra
    })

# 1. Setup detected
if setup.detected:
    write_journal("setup_detected", trade, extra=setup.entry_reason)

# 2. Entry triggered
if trade.entry_filled:
    write_journal("entry_filled", trade, extra=trade.entry_reason)

# 3. Stop-Hit
if trade.stop_hit:
    write_journal("stop_hit", trade, extra="Hard stop triggered")

# 4. T1-Hit
if trade.t1_filled and not trade.journaled_t1:
    write_journal("t1_hit", trade, extra="First target hit")
    trade.journaled_t1 = True

# 5. T2 Exit
if trade.t2_exit:
    write_journal("t2_exit", trade, extra=trade.t2_reason)

# 6. Regime Shift (while in trade)
if trade.in_position and regime_state != trade.regime_at_entry:
    write_journal("regime_shift", trade, extra=f"Shifted to {regime_state}")

# 7. Earnings Window Violation
if trade.in_position and earnings_window_active:
    write_journal("earnings_window", trade, extra="Inside earnings window")
```

**Event catalog (7 auto-trigger types):**

| Event | Fires when | One-shot? |
|---|---|---|
| `setup_detected` | Setup state machine reaches ARMED | Per-setup, once |
| `entry_filled` | Manual "Place Trade" submission completes | Per-trade, once |
| `stop_hit` | Stop-Hit Logic fires (price ≤ stop) | Per-trade, once |
| `t1_hit` | T1-Hit Logic fires, gated by `journaled_t1` flag | Per-trade, once |
| `t2_exit` | T2/Trailing Stop Logic fires close below trail | Per-trade, once |
| `regime_shift` | Active regime changes mid-position | Per-shift, once |
| `earnings_window` | Open position enters 3-day earnings buffer | Per-window, once |

**Notes:**
- **Immutability:** journal rows are append-only. No edits, no deletes. The state snapshot at write time is the historical record.
- **One-shot guards:** `t1_hit` uses an explicit `journaled_t1` flag on the trade row to prevent re-firing every tick after T1 fills. Same pattern needed when wiring the others — `journaled_stop`, `journaled_t2`, `journaled_regime_shift`, `journaled_earnings`.
- **Schema mapping:** writes go to the existing `journal_entries` table. New columns needed when wiring:
  - `event` TEXT — one of the 7 catalog values
  - `entry_price`, `stop_price`, `t1_price`, `t2_price`, `exit_price` REAL
  - `regime`, `quality`, `risk_multiplier`, `chizzle_score`, `shares`, `pnl` (most likely already on the trade row — denormalized into journal for immutability)
  - `notes` TEXT — the `extra` param
  - Plus journaled-flag columns on `trades`: `journaled_stop`, `journaled_t1`, `journaled_t2`, `journaled_regime_shift`, `journaled_earnings` (all INTEGER 0/1).
- **Why snapshot, not reference:** the journal is the audit trail. If a trade row is later edited (e.g. you annotate the trade), the journal still shows what was true at the event moment.
- **Sequence on cockpit:** journal page renders events in reverse chronological order, grouped by trade. Each event row is read-only.
- **Manual journal entries** (user-written reflections) remain available — they coexist with auto-entries via an `is_auto` flag or by `event` being NULL/`manual`.

---

## Trend-Pullback Detection Logic

Identifies controlled pullbacks inside an established uptrend. Companion detector to Breakout Detection — together they cover both setup types in the engine.

```python
# === TREND–PULLBACK DETECTION ===
# Identifies controlled pullbacks inside an established uptrend.
# A valid pullback must show: trend strength, shallow retracement, and a clean higher low.

pullback_detected = False
pullback_reason = None

# 1. Confirm uptrend (must be true)
in_uptrend = (
    price.higher_highs and
    price.higher_lows and
    trend_strength >= 60     # from 0–100 trend score
)

if not in_uptrend:
    pullback_detected = False
    pullback_reason = "Not in confirmed uptrend"
else:

    # 2. Identify retracement leg
    retracement_pct = (swing_high - price.low) / swing_high

    shallow_retracement = retracement_pct <= 0.382   # Fibonacci shallow pullback
    moderate_retracement = retracement_pct <= 0.50    # acceptable but weaker

    # 3. Volume contraction during pullback
    volume_contracting = price.volume < volume_ma_20

    # 4. Higher low confirmation
    higher_low_confirmed = price.low > previous_swing_low

    # 5. Reaction high for entry trigger
    reaction_high = last_minor_swing_high

    # 6. Final decision
    if shallow_retracement and volume_contracting and higher_low_confirmed:
        pullback_detected = True
        pullback_reason = (
            f"Valid pullback: retracement={retracement_pct:.2f}, "
            f"volume contracting, HL confirmed, reaction_high={reaction_high}"
        )
    elif moderate_retracement and volume_contracting and higher_low_confirmed:
        pullback_detected = True
        pullback_reason = (
            f"Moderate pullback: retracement={retracement_pct:.2f}, "
            f"volume contracting, HL confirmed"
        )
    else:
        pullback_detected = False
        pullback_reason = "Pullback failed structural or volume criteria"

# Final output
setup.pullback_detected = pullback_detected
setup.pullback_reason = pullback_reason
setup.reaction_high = reaction_high if pullback_detected else None
```

**Hard gate (must pass first):**
- Confirmed uptrend: higher highs AND higher lows AND `trend_strength >= 60`. No uptrend → no pullback, no further checks.

**Three structural conditions (all required):**
1. **Retracement depth** — shallow (≤ 0.382 Fib) preferred, moderate (≤ 0.50) acceptable. Anything deeper → fail.
2. **Volume contracting** — current volume below 20-period MA. Heavy-volume pullbacks reject (distribution risk).
3. **Higher low confirmed** — current low > previous swing low. Breaks the HL structure → fail.

**Reaction high capture:**
- `reaction_high = last_minor_swing_high` stored on the setup when detection passes.
- This is the **same `reaction_high`** consumed by Entry Trigger Logic. Pullback Detection produces it; Entry Trigger consumes it on close-above.

**Notes:**
- Shallow vs moderate: both pass `pullback_detected = True`, but the reason string preserves the distinction. Quality scoring downstream can weight shallow higher in `cleanliness_score`.
- This is the third "close confirms" rule in the system: Breakout (close above level), Entry Trigger (close above reaction high), and Pullback (close-based volume/HL checks).
- **Swing detection inputs needed when wiring:** `swing_high` (most recent major swing high), `previous_swing_low`, `last_minor_swing_high`, and the `higher_highs`/`higher_lows` flags. A 3-bar fractal helper or ZigZag indicator covers all of them.
- **New columns needed on `setup_candidates`:** `pullback_detected` INTEGER 0/1, `pullback_reason` TEXT, `retracement_pct` REAL. (`reaction_high` is already specced from the Entry Trigger block.)
- **State machine integration:** mirrors the Breakout detector path. DORMANT → BUILDING (uptrend confirmed) → APPROACHING (entering retracement zone) → IN_ZONE (retracement valid + volume contracting) → ARMED (higher low confirmed, reaction_high captured) → LIVE (Entry Trigger fires).
- **Replaces/refines** the current `setupService.ts` Trend-Pullback detector — port these exact thresholds when wiring.
