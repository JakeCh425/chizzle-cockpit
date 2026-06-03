// A-Score · Regime · Decision Matrix cheat sheet — embedded help content.
export const A_SCORE_REGIME_CHEAT_SHEET = `# CHIZZLE WEALTH ENGINE — CHEAT SHEET
**A‑SCORE · REGIME · DECISION MATRIX · DAILY CHECKLIST**

---

## SECTION 1 — A‑SCORE (SMA20 Interaction Model)

| Tier | State | Trigger | Read | Action |
|------|-------|---------|------|--------|
| **A0** | Clear | Price far from SMA20 | No setup · trend extended/drifting | **Standby** |
| **A1** | Loading | Data warming · intraday incomplete | Not a signal yet | **Wait for full data** |
| **A2** | Approaching | Price within **≤1%** of SMA20 | Controlled pullback · vol contracting · setup forming | **Prepare / Monitor** |
| **A3** | Touching | Price within **≤0.2%** of SMA20 | Sitting on SMA20 · balanced · setup live | **Watch intraday for confirmation** |
| **A4** | Bounce | **Close above SMA20** from below | Buyers defended the mean · continuation likely | **Entry window** (if trend + regime align) |
| **REJ** | Rejection | **Close below SMA20** from above | Sellers overwhelmed buyers · trend weakening | **Avoid longs / Risk‑off** |

### Visual Legend
\`\`\`
A0  ░░░░░  far · clear · standby
A1  ▒▒▒▒▒  loading · wait
A2  ▓▓▓▓░  ≤1%   · approaching
A3  ▓▓▓▓▓  ≤0.2% · touching · LIVE
A4  ████▲  bounce · ENTRY WINDOW
REJ ████▼  rejection · NO LONGS
\`\`\`

---

## SECTION 2 — REGIME (Trend · Vol · Breadth · Distribution)

### Trend Regime
- **Bullish** — Price above SMA50 **and** SMA200
- **Neutral** — Mixed alignment
- **Bearish** — Price below SMA50 **and** SMA200

### Volatility Regime
- **Risk‑On** — VIX **< 18**
- **Caution** — VIX **18–22**
- **Risk‑Off** — VIX **> 22**

### Breadth Regime (% above SMA20 / SMA50)
- **Healthy** — **> 60%**
- **Weak** — **40–60%**
- **Diverging** — **< 40%**

### Distribution Days (rolling 25 sessions)
- **0–2** — Normal
- **3–4** — Caution
- **5+** — Risk‑Off

### Composite Badge

| Badge | Meaning | Posture |
|-------|---------|---------|
| **GREEN** | Risk‑On | Full sizing · all setups eligible |
| **YELLOW** | Caution | Reduced sizing · A‑grade only |
| **RED** | Risk‑Off | No new longs · defend stops |

---

## SECTION 3 — DECISION MATRIX (Regime × A‑Score)

| # | Signal | Regime | Confidence | Action |
|---|--------|--------|-----------|--------|
| 1 | **A4** | GREEN | Highest | **Entry window** — trend + mean reversion aligned |
| 2 | **A3** | GREEN | High | **Monitor** — wait for 5M/30M bounce confirmation |
| 3 | **A4** | YELLOW | Reduced | **Smaller sizing** — selective entries only |
| 4 | **A3** | YELLOW | Mixed | **Patience** — require confirmation before entry |
| 5 | **A4** | RED | Counter‑trend | **Avoid or reduce risk** — high‑vol environment |
| 6 | **REJ** | Any | Invalid | **No long entries** — setup broken |

---

## SECTION 4 — QUICK‑GLANCE CHECKLIST

### ☐ Daily
- A‑score **A3** or **A4**?
- SMA20 **rising**?
- Trend regime **bullish**?

### ☐ Intraday
- 30M **higher low** forming?
- 5M **bounce candle** clean?
- Volume **stable** (not collapsing)?

### ☐ Regime
- Composite badge **green** or **yellow**?
- VIX **< 22**?
- Breadth **supportive** (> 40%)?

> **All aligned → Setup valid.**
> **Any RED or REJ → Stand down.**
`;
