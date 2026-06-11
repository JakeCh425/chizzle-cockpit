// How to Read the Mini-Charts — embedded help content.
// Kept as a TS string so we don't add a markdown bundler/loader dependency.
export const MINI_CHARTS_CHEAT_SHEET = `# HOW TO READ THE MINI‑CHARTS
**RADAR · NOT ANALYSIS**

---

## SECTION 1 — PURPOSE

Mini‑charts are **signal detectors**, not full charts. Use them to:

- Track **SMA20 interaction** (A‑score system)
- Read **trend context** (SMA50 / SMA200)
- Time **intraday entries** (5M / 30M / 1H)
- Get **quick visual confirmation**
- **Scan the watchlist fast**

> **Mini‑charts = radar, not analysis.**

---

## SECTION 2 — ELEMENT KEY

| Element | Meaning |
|---------|---------|
| **Price Line** | Short-term price structure · spot pullbacks, bounces, rejections |
| **SMA20** (blue) | **Primary signal line** · drives A2/A3/A4/REJ |
| **SMA50** (amber) / **SMA200** (red) | Trend context · rising = supportive, falling = caution |
| **A‑Score Badge** | A2 approach · A3 touch · A4 bounce · REJ rejection |
| **5M / 30M / 1H / 1D toggles** | 1D context · 1H trend · 30M structure · 5M timing |
| **TV / FV buttons** | Open TradingView / Finviz for deeper analysis |

---

## SECTION 3 — STEP-BY-STEP READ

1. **A‑score badge first**
   - A0 / A1 → ignore
   - A2 → early warning
   - A3 → setup live
   - A4 → entry-ready
   - REJ → invalid
2. **Price vs SMA20**
   - Above → trend intact
   - Touching → decision point
   - Below → weakening
3. **SMA20 slope**
   - Rising → supportive
   - Flat → neutral
   - Falling → caution
4. **SMA50 / SMA200 alignment**
   - Above both → strongest trend
   - Between → mixed
   - Below → avoid
5. **Intraday structure**
   - 30M: higher low forming?
   - 5M: bounce candle clean?
6. **Confirm on 1D**
   - Daily pullback controlled?
   - Bounce forming?

---

## SECTION 4 — ENTRY LOGIC

### Entry Window = A3 → A4 transition

- **A3** — price touches SMA20
- **A4** — price closes back above SMA20
- **Confirm** with 30M higher low
- **Time** with 5M bounce candle

### Avoid when

- A‑score = **REJ**
- SMA20 **falling**
- Composite regime = **RED**
- Price **below SMA50 / SMA200**

---

## SECTION 4B — WHICH TIMEFRAME FOR WHICH SIGNAL

Quick lookup. The mini‑chart toggle (5M / 30M / 1H / 4H / 1D) should match
the job you're doing right now.

| Signal | Primary TF | Confirm / Time on | Why |
|---|---|---|---|
| **A0 / A1** | — | — | Clear or loading. Nothing to do. |
| **A2** (approaching) | **1D** | **1H** | Daily defines the pullback; 1H shows if it's controlled. |
| **A3** (touching SMA20) | **1D** | **30M + 5M** | 1D is the setup; 30M = higher low; 5M = entry candle. |
| **A4** (bounce cross) | **1D** | **5M** | Daily confirms; 5M times the actual entry. |
| **REJ** (cross below) | **1D** | **5M to exit** | Invalidation on 1D; if long, exit on 5M. |
| **Bull Hammer (confirmed)** | **1D** | **1H** | Daily is the swing signal; 1H confirms momentum. |
| **Hammer Forming** | **1D + 1H** | wait for 1D close | Don't act on intra‑day hammers — wait for the close. |
| **Strong Bull Bar** | **1D** | **1H** | Cluster‑of‑lows setup confirms on the daily bar close. |
| **Bull Bar (1H)** | **1H** | **5M** | 1H bull bar is the trigger; 5M for fill. |

### Decision flow (use top‑to‑bottom)

1. **Setup exists?** Check **1D** — A3/A4 or hammer/bull bar pattern?
2. **Trend supportive?** **1D** — above SMA50 / SMA200, SMA20 rising?
3. **Structure intact?** **30M** or **1H** — higher low forming?
4. **Pull the trigger?** **5M** — clean bounce candle, volume stable?

> Rule of thumb: **the bigger the signal, the bigger the timeframe.** Use 5M
> only to *time* entries, never to *find* them.

---

## SECTION 5 — QUICK‑GLANCE CHECKLIST

### ☐ Daily
- A‑score **A3** or **A4**?
- SMA20 **rising**?
- Trend regime **supportive**?

### ☐ Intraday
- 30M **higher low**?
- 5M **bounce candle** clean?
- Volume **stable**?

### ☐ Trend
- Above **SMA50 / SMA200**?

> **All aligned → Setup valid.**
> **Any miss → Wait.**
`;
