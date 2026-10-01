// Section R4 — practice price alerts (pure, deterministic). Alerts are INFORMATIONAL ONLY:
// nothing here (or anywhere) creates, sends, modifies or cancels a broker order.

export const ALERT_SAFETY = "PRICE ALERT ONLY — VERIFY DATA AND REVIEW THE PLAN BEFORE ACTING.";

export const ALERT_TYPES = [
  "ENTRY_CROSS_UP", "PULLBACK_DOWN", "RETEST_ZONE", "CLOSE_1H_ABOVE", "SETUP_CONFIRMED_4H",
  "STOP_REFERENCE", "TARGET_1", "TARGET_2", "SETUP_EXPIRES", "DATA_ISSUE", "DATA_RECOVERED",
] as const;
export type AlertType = typeof ALERT_TYPES[number];
export const ALERT_TYPE_LABEL: Record<AlertType, string> = {
  ENTRY_CROSS_UP: "Entry trigger crossed upward",
  PULLBACK_DOWN: "Buy-limit / pullback price reached",
  RETEST_ZONE: "Price entered the retest zone",
  CLOSE_1H_ABOVE: "1H confirmation bar closed above trigger",
  SETUP_CONFIRMED_4H: "4H setup confirmed",
  STOP_REFERENCE: "Price reached the stop-reference level",
  TARGET_1: "Price reached Target 1",
  TARGET_2: "Price reached Target 2",
  SETUP_EXPIRES: "Setup expired",
  DATA_ISSUE: "Data became delayed / stale / error / mismatch",
  DATA_RECOVERED: "Fresh matching data returned",
};
/** Types that need a price level (RETEST_ZONE also needs levelHigh). */
export const LEVEL_TYPES: AlertType[] = ["ENTRY_CROSS_UP", "PULLBACK_DOWN", "RETEST_ZONE", "CLOSE_1H_ABOVE", "STOP_REFERENCE", "TARGET_1", "TARGET_2"];
export const needsLevel = (t: AlertType) => LEVEL_TYPES.includes(t);

export const CHANNELS = ["in_app", "email", "telegram", "push"] as const;
export type Channel = typeof CHANNELS[number];
export const CHANNEL_LABEL: Record<Channel, string> = { in_app: "In-app", email: "Email", telegram: "Telegram (phone)", push: "Browser push" };

export type Frequency = "ONCE" | "PER_BAR" | "REPEAT";
export type ExpiryMode = "END_OF_DAY" | "END_OF_WEEK" | "CUSTOM" | "SETUP_EXPIRES";

export interface PriceAlert {
  id: number;
  symbol: string;
  setupId: string | null;
  planVersion: number;           // 0 = system plan
  type: AlertType;
  level: number | null;
  levelHigh: number | null;      // retest zone top
  channels: Channel[];
  frequency: Frequency;
  repeatMinutes: number;         // REPEAT only
  expiryMode: ExpiryMode;
  expiresAt: string | null;      // ISO (END_OF_DAY/WEEK/CUSTOM resolved at create time)
  active: boolean;
  lastFiredAt: string | null;
  lastFiredBar: string | null;   // PER_BAR: last 1H bar that fired
  fireCount: number;
  lastState: string | null;      // condition memory ("above"/"below"/"in"/"out"/data status)
  note: string;
  createdAt: string;
}

export interface AlertPrefs {
  channels: Record<Channel, boolean>;  // master switches
  quietStart: string | null;           // "21:00" CT
  quietEnd: string | null;             // "07:00" CT
  marketHoursOnly: boolean;
  maxPerTickerPerDay: number;
  maxPerDay: number;
  dedupeMinutes: number;
  /** contact id → ISO when the user confirmed the code sent to it. */
  verified: Record<string, string>;
}
export const DEFAULT_ALERT_PREFS: AlertPrefs = {
  channels: { in_app: true, email: false, telegram: false, push: false },
  quietStart: null, quietEnd: null, marketHoursOnly: true,
  maxPerTickerPerDay: 6, maxPerDay: 20, dedupeMinutes: 30, verified: {},
};

/** What the evaluator observes for one symbol on one tick. */
export interface AlertSnapshot {
  price: number | null;
  priceTs: string | null;
  dataStatus: string;              // LIVE | DELAYED | STALE | ERROR | MISMATCH
  dataSource: string | null;
  setupId: string | null;
  setupStatus: string;
  last1H: { end: string; close: number } | null;
  marketOpen: boolean;
}

const BAD_DATA = ["DELAYED", "STALE", "ERROR", "MISMATCH"];
export const isBadData = (s: string, setupStatus?: string) => BAD_DATA.includes(s) || setupStatus === "BLOCKED_DATA_MISMATCH";

/**
 * Does the condition hold now, and is it a NEW occurrence vs `lastState`?
 * Crossing types fire on the transition (or on first observation already past the level).
 */
export function evalCondition(a: Pick<PriceAlert, "type" | "level" | "levelHigh" | "lastState" | "setupId">, s: AlertSnapshot): { hit: boolean; state: string | null; detail: string } {
  const px = s.price, L = a.level;
  const bad = isBadData(s.dataStatus, s.setupStatus);
  switch (a.type) {
    case "ENTRY_CROSS_UP": case "TARGET_1": case "TARGET_2": {
      if (px == null || L == null) return { hit: false, state: a.lastState, detail: "no price" };
      const st = px >= L ? "above" : "below";
      return { hit: st === "above" && a.lastState !== "above", state: st, detail: `price ${px.toFixed(2)} ${st === "above" ? "≥" : "<"} ${L.toFixed(2)}` };
    }
    case "PULLBACK_DOWN": case "STOP_REFERENCE": {
      if (px == null || L == null) return { hit: false, state: a.lastState, detail: "no price" };
      const st = px <= L ? "below" : "above";
      return { hit: st === "below" && a.lastState !== "below", state: st, detail: `price ${px.toFixed(2)} ${st === "below" ? "≤" : ">"} ${L.toFixed(2)}` };
    }
    case "RETEST_ZONE": {
      if (px == null || L == null) return { hit: false, state: a.lastState, detail: "no price" };
      const hi = a.levelHigh ?? L;
      const lo = Math.min(L, hi), top = Math.max(L, hi);
      const st = px >= lo && px <= top ? "in" : "out";
      return { hit: st === "in" && a.lastState !== "in", state: st, detail: `price ${px.toFixed(2)} ${st === "in" ? "inside" : "outside"} ${lo.toFixed(2)}–${top.toFixed(2)}` };
    }
    case "CLOSE_1H_ABOVE": {
      if (!s.last1H || L == null) return { hit: false, state: a.lastState, detail: "no closed 1H bar" };
      const st = `${s.last1H.end}:${s.last1H.close > L ? "above" : "below"}`;
      return { hit: s.last1H.close > L && a.lastState !== st, state: st, detail: `1H bar closed ${s.last1H.close.toFixed(2)} vs ${L.toFixed(2)}` };
    }
    case "SETUP_CONFIRMED_4H": {
      const ok = (s.setupStatus === "SETUP_CONFIRMED" || s.setupStatus === "READY_TO_TRADE") && (!a.setupId || s.setupId === a.setupId || a.setupId.endsWith(":NONE"));
      const st = ok ? "confirmed" : "pending";
      return { hit: ok && a.lastState !== "confirmed", state: st, detail: `setup ${s.setupStatus}` };
    }
    case "SETUP_EXPIRES": {
      const gone = s.setupStatus === "SIGNAL_EXPIRED" || (!!a.setupId && !!s.setupId && s.setupId !== a.setupId);
      const st = gone ? "expired" : "live";
      return { hit: gone && a.lastState !== "expired", state: st, detail: `setup ${s.setupStatus}` };
    }
    case "DATA_ISSUE": {
      const st = bad ? `bad:${s.dataStatus}` : "ok";
      return { hit: bad && !(a.lastState ?? "").startsWith("bad"), state: st, detail: `data ${s.dataStatus}` };
    }
    case "DATA_RECOVERED": {
      const st = bad ? "bad" : s.dataStatus === "LIVE" ? "live" : "other";
      return { hit: st === "live" && a.lastState === "bad", state: st, detail: `data ${s.dataStatus}` };
    }
  }
}

const hm = (iso: string, tz = "America/Chicago") => {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  return Number(p.find((x) => x.type === "hour")!.value) * 60 + Number(p.find((x) => x.type === "minute")!.value);
};
const ymdCT = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const toMin = (s: string | null) => { if (!s) return null; const m = /^(\d{1,2}):(\d{2})$/.exec(s); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

export function inQuietHours(nowIso: string, prefs: Pick<AlertPrefs, "quietStart" | "quietEnd">): boolean {
  const a = toMin(prefs.quietStart), b = toMin(prefs.quietEnd);
  if (a == null || b == null || a === b) return false;
  const m = hm(nowIso);
  return a < b ? m >= a && m < b : m >= a || m < b; // window may wrap midnight
}

export interface GateInput {
  nowIso: string;
  prefs: AlertPrefs;
  marketOpen: boolean;
  firedTodayForTicker: number;
  firedTodayTotal: number;
  /** Most recent firing of the same symbol+type+level (any alert) — duplicate suppression. */
  lastSimilarAt: string | null;
  bar1hEnd: string | null;
}
/** Should a hit actually be delivered? Order: expiry → active → frequency → market hours → quiet → caps → dedupe. */
export function gateAlert(a: PriceAlert, g: GateInput): { allow: boolean; reason: string; expire?: boolean } {
  const now = Date.parse(g.nowIso);
  if (a.expiresAt && now >= Date.parse(a.expiresAt)) return { allow: false, reason: "expired", expire: true };
  if (!a.active) return { allow: false, reason: "inactive" };
  if (a.frequency === "ONCE" && a.fireCount > 0) return { allow: false, reason: "already fired (once only)", expire: true };
  if (a.frequency === "PER_BAR" && g.bar1hEnd && a.lastFiredBar === g.bar1hEnd) return { allow: false, reason: "already fired this bar" };
  if (a.frequency === "REPEAT" && a.lastFiredAt && now - Date.parse(a.lastFiredAt) < Math.max(1, a.repeatMinutes) * 60_000) return { allow: false, reason: `repeat window ${a.repeatMinutes}m` };
  const dataType = a.type === "DATA_ISSUE" || a.type === "DATA_RECOVERED";
  if (g.prefs.marketHoursOnly && !g.marketOpen && !dataType) return { allow: false, reason: "market hours only" };
  if (inQuietHours(g.nowIso, g.prefs)) return { allow: false, reason: "quiet hours" };
  if (g.firedTodayForTicker >= g.prefs.maxPerTickerPerDay) return { allow: false, reason: `max ${g.prefs.maxPerTickerPerDay}/ticker/day` };
  if (g.firedTodayTotal >= g.prefs.maxPerDay) return { allow: false, reason: `max ${g.prefs.maxPerDay}/day` };
  if (g.lastSimilarAt && now - Date.parse(g.lastSimilarAt) < g.prefs.dedupeMinutes * 60_000) return { allow: false, reason: `duplicate within ${g.prefs.dedupeMinutes}m` };
  return { allow: true, reason: "ok" };
}

/** A channel may deliver only if switched on AND (for email/telegram) its destination was verified. */
export function channelAllowed(ch: Channel, prefs: AlertPrefs, contact: { id: number; enabled: boolean } | null): { ok: boolean; why: string } {
  if (!prefs.channels[ch]) return { ok: false, why: `${CHANNEL_LABEL[ch]} is switched off` };
  if (ch === "in_app" || ch === "push") return { ok: true, why: "" };
  if (!contact) return { ok: false, why: `no ${CHANNEL_LABEL[ch]} contact` };
  if (!prefs.verified[String(contact.id)]) return { ok: false, why: `${CHANNEL_LABEL[ch]} not verified — confirm the code first` };
  return { ok: true, why: "" };
}

/** Resolve an expiry mode to an ISO time: end of day = next 3:00 PM CT close (rolls to the next
 *  weekday when today's close has passed); end of week = the coming Friday 3:00 PM CT. */
export function resolveExpiry(mode: ExpiryMode, nowIso: string, custom: string | null): string | null {
  if (mode === "SETUP_EXPIRES") return null;
  if (mode === "CUSTOM") return custom;
  const now = Date.parse(nowIso);
  const closeOn = (ymd: string) => {
    const base = new Date(`${ymd}T15:00:00Z`);
    const off = hm(base.toISOString()) - 15 * 60; // CT minutes − UTC minutes at that instant
    return base.getTime() - off * 60_000;
  };
  const wdOf = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay(); // 0 Sun … 6 Sat
  let ymd = ymdCT(nowIso);
  const step = () => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); ymd = d.toISOString().slice(0, 10); };
  for (let i = 0; i < 14; i++) {
    const wd = wdOf(ymd);
    const ok = mode === "END_OF_DAY" ? wd >= 1 && wd <= 5 : wd === 5;
    if (ok && closeOn(ymd) > now) return new Date(closeOn(ymd)).toISOString();
    step();
  }
  return null;
}

export interface AlertMessageInput {
  symbol: string; type: AlertType; price: number | null; level: number | null; levelHigh: number | null;
  atIso: string; planLabel: string; entry: number | null; stop: number | null; t1: number | null; t2: number | null;
  statusLabel: string; dataStatus: string; marketOpen: boolean;
}
const $ = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `$${n.toFixed(2)}`);
const timeCT = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });

function reachedPhrase(m: AlertMessageInput): string {
  switch (m.type) {
    case "ENTRY_CROSS_UP": return `reached your practice entry level of ${$(m.level)}`;
    case "PULLBACK_DOWN": return `pulled back to your practice buy-limit level of ${$(m.level)}`;
    case "RETEST_ZONE": return `entered the retest zone ${$(m.level)}–${$(m.levelHigh)}`;
    case "CLOSE_1H_ABOVE": return `closed a 1H bar above ${$(m.level)}`;
    case "SETUP_CONFIRMED_4H": return "confirmed its 4H setup";
    case "STOP_REFERENCE": return `reached the stop-reference level of ${$(m.level)}`;
    case "TARGET_1": return `reached Target 1 at ${$(m.level)}`;
    case "TARGET_2": return `reached Target 2 at ${$(m.level)}`;
    case "SETUP_EXPIRES": return "had its setup expire";
    case "DATA_ISSUE": return `has data status ${m.dataStatus}`;
    case "DATA_RECOVERED": return "has fresh matching data again";
  }
}
/** Never "buy now" / "sell now" — informational wording only (spec R4). */
export function buildAlertMessages(m: AlertMessageInput) {
  const t = timeCT(m.atIso);
  const extra: string[] = [];
  if (isBadData(m.dataStatus) && m.type !== "DATA_ISSUE") extra.push(`Data status is ${m.dataStatus}. Verify with your broker/chart before acting.`);
  if (m.type === "DATA_ISSUE") extra.push(`Data status is ${m.dataStatus}. Verify with your broker/chart before acting.`);
  if (!m.marketOpen) extra.push("Market closed — level was observed in the latest available session data.");
  const inApp = [
    `${m.symbol} ${reachedPhrase(m)}${m.price != null ? ` (last ${$(m.price)})` : ""}.`,
    "Review current price, chart, stop, targets, and data status before deciding.",
    ...extra, ALERT_SAFETY,
  ].join(" ");
  const subject = `Chizzle Practice Alert: ${m.symbol} reached ${ALERT_TYPE_LABEL[m.type]}`;
  const where = m.type === "RETEST_ZONE" ? `${$(m.level)}–${$(m.levelHigh)}` : m.level != null ? $(m.level) : m.price != null ? $(m.price) : ALERT_TYPE_LABEL[m.type];
  const emailText = [
    `${m.symbol} reached ${where} at ${t} CT.`,
    `Plan: ${m.planLabel}.`,
    `Entry: ${$(m.entry)}`, `Stop reference: ${$(m.stop)}`, `T1: ${$(m.t1)}`, `T2: ${$(m.t2)}`,
    `Status: ${m.statusLabel} · data ${m.dataStatus}`,
    ...extra,
    "This is an informational practice alert only. Review live broker/chart data before making any independent decision.",
    ALERT_SAFETY,
  ];
  const sms = `Chizzle alert: ${m.symbol} reached ${where} at ${t} CT. Practice-only. Review live chart and plan before acting.${extra.length ? " " + extra[0] : ""}`;
  return { inApp, subject, emailText, sms };
}

/** Words an alert must never contain. */
export const FORBIDDEN_ALERT_WORDS = [/\bbuy now\b/i, /\bsell now\b/i, /\bplace (an? )?order\b/i, /\bexecute\b/i];
