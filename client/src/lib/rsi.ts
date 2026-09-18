// ─── RSI (Wilder) ──────────────────────────────────────────────────────────
// Standard 14-period RSI with Wilder smoothing. Pure function, zero deps.
// Returns an array aligned with the input closes; leading entries where the
// average gain/loss window isn't full yet are null.

export function rsi(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;

  // Seed with the simple average of the first `period` gains/losses.
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum += -diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  const compute = () => {
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  };
  out[period] = compute();

  // Wilder smoothing for subsequent bars.
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = compute();
  }
  return out;
}

/** Plain-English zone for an RSI reading. */
export function rsiZone(v: number | null): {
  label: string;
  tone: "green" | "amber" | "red" | "blue" | "gray";
  meaning: string;
} {
  if (v == null || !Number.isFinite(v)) {
    return { label: "Unknown", tone: "gray", meaning: "Not enough bars yet to compute RSI." };
  }
  if (v < 30) {
    return {
      label: "Oversold",
      tone: "amber",
      meaning: "Oversold zone — watch for a rebound, but don't buy weakness blindly.",
    };
  }
  if (v < 45) {
    return {
      label: "Weak",
      tone: "red",
      meaning: "Momentum is weak — trend rejects most new longs here.",
    };
  }
  if (v <= 55) {
    return {
      label: "Neutral",
      tone: "gray",
      meaning: "Neutral / mixed momentum — no clear directional edge.",
    };
  }
  if (v <= 70) {
    return {
      label: "Bullish",
      tone: "green",
      meaning: "Healthy bullish momentum — trend followers can participate.",
    };
  }
  return {
    label: "Extended",
    tone: "amber",
    meaning: "Extended — do not chase; wait for a pullback or consolidation.",
  };
}
