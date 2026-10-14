// Live ticker corner badge — pure model (display only). PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE.
import { ctParts } from "./marketContext";

export type MarketSession = "LIVE" | "PRE" | "POST" | "CLOSED";
export type BadgeTone = "up" | "down" | "flat";

/** US equities session in Central Time (weekdays): PRE 03:00–08:30, LIVE 08:30–15:00, POST 15:00–19:00. */
export function marketSession(nowMs: number): MarketSession {
  const p = ctParts(Math.floor(nowMs / 1000));
  const [y, m, d] = p.ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (dow === 0 || dow === 6) return "CLOSED";
  if (p.minutes >= 510 && p.minutes < 900) return "LIVE";
  if (p.minutes >= 180 && p.minutes < 510) return "PRE";
  if (p.minutes >= 900 && p.minutes < 1140) return "POST";
  return "CLOSED";
}

export interface BadgeInput { symbol: string; price: number | null; priorClose: number | null; now: number; dayState?: "LIVE" | "FIXED" | "NONE" | null }
export interface BadgeModel {
  symbol: string; price: number | null; chg: number | null; pct: number | null; tone: BadgeTone; session: MarketSession;
  priceText: string; chgText: string; sessionText: string;
}
export function badgeModel(i: BadgeInput): BadgeModel {
  const sym = i.symbol.toUpperCase();
  let session = marketSession(i.now);
  // Exchange holiday / early close: the clock says RTH but the day bar is already final.
  if (session === "LIVE" && i.dayState === "FIXED") session = "CLOSED";
  const chg = i.price != null && i.priorClose != null && i.priorClose > 0 ? Math.round((i.price - i.priorClose) * 100) / 100 : null;
  const pct = chg != null ? Math.round((chg / i.priorClose!) * 10000) / 100 : null;
  const tone: BadgeTone = chg == null || chg === 0 ? "flat" : chg > 0 ? "up" : "down";
  const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "");
  const chgText = chg == null ? "—" : `${sign(chg)}$${Math.abs(chg).toFixed(2)} (${sign(pct!)}${Math.abs(pct!).toFixed(2)}%)`;
  return { symbol: sym, price: i.price, chg, pct, tone, session, priceText: i.price != null ? `$${i.price.toFixed(2)}` : "—", chgText, sessionText: session };
}

/** Hover text: Day Range · Volume · Last bar · Source. */
export function badgeTooltip(o: { lod: number | null; hod: number | null; volume: number | null; lastBar: string | null; source: string | null }): string {
  const range = o.lod != null && o.hod != null ? `$${o.lod.toFixed(2)} – $${o.hod.toFixed(2)}` : "—";
  const vol = o.volume != null ? `${(o.volume / 1e6).toFixed(1)}M` : "—";
  return `Day Range: ${range} · Vol: ${vol} · Last Bar: ${o.lastBar ?? "—"} · Source: ${o.source ?? "—"}`;
}
