// Ready-now notifications + live-permission labels (pure, shared by server and client).
// The engine's READY_TO_TRADE status stays the only source of practice readiness; live-risk
// permission (the market regime) is a separate field and only changes the WORDING shown.

export const READY_EVENT_TYPE = "READY_NOW";
/** 30-minute heads-up while a confirmed setup waits for its 1H close. In-app only; never a Ready signal. */
export const EARLY_EVENT_TYPE = "EARLY_30M";
export const earlyKey = (sym: string, setupType: string | null, setupTs: string | null, barEnd: string) => `EARLY|${sym}|${setupType ?? "-"}:${setupTs ?? "-"}|${barEnd}`;
export function earlyMessage(p: { symbol: string; close: number; trigger: number; barEnd: string; oneHourCloseAt: string }) {
  const t = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });
  return `HEADS-UP — ${p.symbol} closed a 30-minute bar at $${p.close.toFixed(2)}, above trigger $${p.trigger.toFixed(2)} (${t(p.barEnd)} CT). `
    + `Not a Ready signal: the 1H bar must still close above the trigger at ${t(p.oneHourCloseAt)} CT. PRICE ALERT ONLY — VERIFY DATA AND REVIEW THE PLAN BEFORE ACTING.`;
}

/** Live-risk permission, kept separate from practice readiness. */
export interface LivePermission { allowed: boolean; regime: string; source: string; reason: string }

/** Idempotency key: one notification per genuinely new Ready event (setup instance + qualifying 1H close). */
export const readyKey = (d: { symbol: string; setupTimeframe: string | null; setupType: string | null; setupTimestamp: string | null }, qualifyingBar: string | null) =>
  `READY|${d.symbol}|READY_TO_TRADE|${d.setupTimeframe ?? ""}|${d.setupType ?? ""}:${d.setupTimestamp ?? ""}|${qualifyingBar ?? ""}`;

/** Status wording. Never says "Ready to Trade" while live risk is blocked. */
export function readyStatusLabel(status: string, live: LivePermission | null | undefined): string {
  if (status === "READY_TO_TRADE") return live && !live.allowed ? "PRACTICE READY — LIVE ENTRY NOT PERMITTED" : "READY TO TRADE";
  if (status === "SETUP_CONFIRMED") return "SETUP CONFIRMED — AWAITING 1H CLOSE";
  return "";
}

// ─── Telegram delivery classification ────────────────────────────────────────
export type TelegramKind = "SENT" | "CONFIG_MISSING" | "UNAUTHORIZED" | "INVALID_CHAT" | "RATE_LIMITED" | "TIMEOUT" | "NETWORK" | "PROVIDER";
export const TELEGRAM_KIND_LABEL: Record<TelegramKind, string> = {
  SENT: "Sent successfully",
  CONFIG_MISSING: "Configuration missing",
  UNAUTHORIZED: "Unauthorized bot",
  INVALID_CHAT: "Invalid chat (or the bot can't message it)",
  RATE_LIMITED: "Rate limited",
  TIMEOUT: "Network/provider failure (timeout)",
  NETWORK: "Network/provider failure",
  PROVIDER: "Network/provider failure",
};
export function classifyTelegram(httpStatus: number | null, description: string, errName?: string): TelegramKind {
  if (httpStatus == null) return errName === "TimeoutError" || errName === "AbortError" ? "TIMEOUT" : "NETWORK";
  if (httpStatus >= 200 && httpStatus < 300) return "SENT";
  if (httpStatus === 401 || httpStatus === 404) return "UNAUTHORIZED"; // 404 = bad token path
  if (httpStatus === 429) return "RATE_LIMITED";
  if (httpStatus === 403) return "INVALID_CHAT";
  if (httpStatus === 400 && /chat|peer|user/i.test(description)) return "INVALID_CHAT";
  if (httpStatus >= 500) return "NETWORK";
  return "PROVIDER";
}
/** Limited retry with backoff: only transient failures, at most 4 attempts (1, 2, 4 min apart). */
export const MAX_READY_ATTEMPTS = 4;
/** Email (Resend) result → the same retry vocabulary: a missing key is config, 429 rate-limit, 5xx / fetch errors transient. */
export function classifyEmail(error: string | undefined): TelegramKind {
  if (!error) return "SENT";
  if (/RESEND_API_KEY not set/i.test(error)) return "CONFIG_MISSING";
  if (/Resend 429/.test(error)) return "RATE_LIMITED";
  if (/Resend 40[13]/.test(error)) return "UNAUTHORIZED";
  if (/Resend 5\d\d|fetch error/i.test(error)) return "NETWORK";
  return "PROVIDER";
}
export function nextRetryAt(kind: TelegramKind, attempts: number, atMs: number, retryAfterSec?: number | null): string | null {
  if (!(kind === "RATE_LIMITED" || kind === "TIMEOUT" || kind === "NETWORK")) return null;
  if (attempts >= MAX_READY_ATTEMPTS) return null;
  const wait = Math.max(60_000 * 2 ** (attempts - 1), (retryAfterSec ?? 0) * 1000);
  return new Date(atMs + wait).toISOString();
}

const $ = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(2)}`);
const ct = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " CT" : "—");

/** Plain text (no Markdown — underscores in status names break Telegram's parser). No "buy now"/"sell now". */
export function readyMessage(m: {
  symbol: string; setupName: string; timeframe: string | null; entry: number | null; stop: number | null; t1: number | null;
  live: LivePermission | null; qualifyingBar: string | null; planLabel: string; url?: string;
}) {
  const label = readyStatusLabel("READY_TO_TRADE", m.live);
  const rps = m.entry != null && m.stop != null ? m.entry - m.stop : null;
  const lines = [
    `${label}: ${m.symbol}`,
    `${m.setupName}${m.timeframe ? ` • ${m.timeframe}` : ""} — ${m.planLabel}`,
    `Entry ${$(m.entry)} • Stop ${$(m.stop)} • T1 ${$(m.t1)} • Risk/share ${$(rps)}`,
    `Qualifying 1H close: ${ct(m.qualifyingBar)}`,
    ...(m.live && !m.live.allowed ? [`Live risk blocked: ${m.live.reason}`] : []),
    "PRICE ALERT ONLY — VERIFY DATA AND REVIEW THE PLAN BEFORE ACTING.",
    "PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE",
    ...(m.url ? [m.url] : []),
  ];
  const subject = `${label}: ${m.symbol} ${m.setupName}${m.timeframe ? ` (${m.timeframe})` : ""}`;
  return { subject, lines, text: lines.join("\n"), inApp: `${label}: ${m.symbol} ${m.setupName}${m.timeframe ? ` (${m.timeframe})` : ""}. Entry ${$(m.entry)}, stop ${$(m.stop)}, T1 ${$(m.t1)}.` };
}

/** Cockpit visual priority (display only — engine statuses are unchanged). */
export function cockpitRank(d: { setupStatus: string; dataStatus: string }): number {
  if (d.setupStatus === "READY_TO_TRADE" && d.dataStatus !== "STALE" && d.dataStatus !== "ERROR") return 1;
  if (d.setupStatus === "SETUP_CONFIRMED" && d.dataStatus !== "STALE" && d.dataStatus !== "ERROR") return 2;
  switch (d.setupStatus) {
    case "WATCH_RETEST": return 3;                 // near trigger
    case "SETUP_FORMING": return 4;
    case "WATCH_STOP_TOO_WIDE": case "WATCH_RR_TOO_LOW": case "BLOCKED_DATA_MISMATCH": return 5; // watching
    case "WATCH_EXTENDED": return 6;
    case "SIGNAL_EXPIRED": case "INVALIDATED": return 8;
    case "READY_TO_TRADE": case "SETUP_CONFIRMED": return 5; // stale data → watching until verified
    default: return 7;                               // no trade
  }
}
export function sortForCockpit<T extends { setupStatus: string; dataStatus: string }>(rows: T[]): T[] {
  return rows.map((r, i) => ({ r, i, k: cockpitRank(r) })).sort((a, b) => a.k - b.k || a.i - b.i).map((x) => x.r);
}
