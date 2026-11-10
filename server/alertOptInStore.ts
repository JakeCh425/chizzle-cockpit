// ─── Alert Opt-In State & Institutional Payload Formatter ───────────────────
// Strict Opt-In Gate: Drop/suppress alerts for any ticker where alerts_enabled is false.
// Allows users to explicitly select which tickers receive Telegram/Email notifications.

const optInCache = new Map<string, boolean>();

/**
 * Directly sets in-memory cache for a ticker (useful for unit tests or fast sync).
 */
export function setTickerAlertOptIn(symbol: string, enabled: boolean): void {
  optInCache.set(symbol.trim().toUpperCase(), Boolean(enabled));
}

/**
 * Returns current cached state for a ticker, defaulting to false.
 */
export function getTickerAlertOptInCached(symbol: string): boolean {
  return optInCache.get(symbol.trim().toUpperCase()) ?? false;
}

/**
 * Clears the in-memory cache.
 */
export function clearAlertOptInCache(): void {
  optInCache.clear();
}

/**
 * Queries whether alerts are enabled for a given ticker symbol.
 * Checks in-memory cache first, then PostgreSQL watchlist table, falling back gracefully to false.
 */
export async function isTickerAlertOptedIn(symbol: string): Promise<boolean> {
  const sym = (symbol || "").trim().toUpperCase();
  if (!sym) return false;

  if (optInCache.has(sym)) {
    return optInCache.get(sym)!;
  }

  if (process.env.DATABASE_URL) {
    try {
      const { storage } = await import("./storage");
      const enabled = await storage.getWatchlistAlertsEnabled(sym);
      optInCache.set(sym, enabled);
      return enabled;
    } catch (err) {
      // If database is not reachable (e.g. during standalone testing), fallback to cached value
      return optInCache.get(sym) ?? false;
    }
  }

  return optInCache.get(sym) ?? false;
}

/**
 * Toggles or sets alerts_enabled for a given ticker symbol.
 * Updates both the database and the in-memory cache.
 */
export async function toggleTickerAlertOptIn(
  symbol: string,
  explicit?: boolean
): Promise<{ symbol: string; alertsEnabled: boolean }> {
  const sym = (symbol || "").trim().toUpperCase();
  if (!sym) {
    throw new Error("Invalid ticker symbol");
  }

  if (process.env.DATABASE_URL) {
    try {
      const { storage } = await import("./storage");
      const res = await storage.toggleWatchlistAlerts(sym, explicit);
      optInCache.set(sym, res.alertsEnabled);
      return res;
    } catch (err) {
      // Fallback for offline/test environments
    }
  }

  const current = optInCache.get(sym) ?? false;
  const nextVal = explicit !== undefined ? Boolean(explicit) : !current;
  optInCache.set(sym, nextVal);
  return { symbol: sym, alertsEnabled: nextVal };
}

/**
 * Institutional prop-desk alert headline payload:
 * Format: [ 🟢 1H CONFIRMED ] $XLE is ready. Entry: $62.12 | Stop: $61.19 | T1: $63.52.
 */
export function formatInstitutionalConfirmedAlert(p: {
  ticker: string;
  entryPrice: number;
  stopLoss: number;
  target1?: number;
}): string {
  const sym = (p.ticker || "NVDA").trim().toUpperCase();
  const entry = Number(p.entryPrice || 0).toFixed(2);
  const stop = Number(p.stopLoss || 0).toFixed(2);
  const risk = Math.max(0.01, Math.abs(Number(p.entryPrice || 0) - Number(p.stopLoss || 0)));
  const t1 = Number((p.target1 ?? (Number(p.entryPrice || 0) + 1.5 * risk))).toFixed(2);

  return `[ 🟢 1H CONFIRMED ] $${sym} is ready. Entry: $${entry} | Stop: $${stop} | T1: $${t1}.`;
}
