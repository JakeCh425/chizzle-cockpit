// Section R4 — practice price alerts: storage, evaluator loop, delivery, verification.
// INFORMATIONAL ONLY. No code path here (or anywhere in the app) creates or sends a broker order.
import crypto from "node:crypto";
import { and, desc, eq, gte } from "drizzle-orm";
import { db, pool, storage } from "../storage";
import { swingAlertEvents, swingAlertPrefs, swingPriceAlerts } from "@shared/schema";
import {
  ALERT_SAFETY, ALERT_TYPE_LABEL, CHANNELS, DEFAULT_ALERT_PREFS, buildAlertMessages, channelAllowed, evalCondition, gateAlert, resolveExpiry,
  type AlertPrefs, type AlertSnapshot, type AlertType, type Channel, type ExpiryMode, type Frequency, type PriceAlert,
} from "@shared/priceAlerts";
import { STATUS_LABEL } from "@shared/swingDecision";
import { activeVersion, effectivePlan, setupIdOf } from "@shared/practicePlan";
import { sendEmailResend, sendTelegram } from "../alert-dispatcher";
import { inRth, tag1H } from "./bars";
import { fetchQuote } from "./feed";
import { evaluateSymbol, loadSettings } from "./service";
import { selectedVersions } from "./plans";
import { isUnifiedSwingEnabled } from "../featureFlags";

const LIVE_URL = "https://chizzle-cockpit-duyn.onrender.com";
export const alertsEnabled = () => process.env.ENABLE_PRICE_ALERTS !== "false";

let ensured = false;
async function ensureTables() {
  if (ensured) return;
  const r = await pool.query(`SELECT to_regclass('public.swing_price_alerts') AS a, to_regclass('public.swing_alert_events') AS e, to_regclass('public.swing_alert_prefs') AS p`);
  const row = r.rows[0] ?? {};
  if (!row.a || !row.e || !row.p) throw new Error("Price alert tables are missing — run scripts/pr-rb-migrate.mjs");
  ensured = true;
}

// ─── Prefs ───────────────────────────────────────────────────────────────────
export async function loadPrefs(): Promise<AlertPrefs> {
  await ensureTables();
  const row = (await db.select().from(swingAlertPrefs).where(eq(swingAlertPrefs.id, 1)).limit(1))[0];
  const d = (row?.data ?? {}) as Partial<AlertPrefs>;
  return { ...DEFAULT_ALERT_PREFS, ...d, channels: { ...DEFAULT_ALERT_PREFS.channels, ...(d.channels ?? {}) }, verified: { ...(d.verified ?? {}) } };
}
export async function savePrefs(patch: Partial<AlertPrefs>): Promise<AlertPrefs> {
  const cur = await loadPrefs();
  const next: AlertPrefs = { ...cur, ...patch, channels: { ...cur.channels, ...(patch.channels ?? {}) }, verified: cur.verified }; // verified only via confirm
  await db.insert(swingAlertPrefs).values({ id: 1, data: next as any }).onConflictDoUpdate({ target: swingAlertPrefs.id, set: { data: next as any, updatedAt: new Date() } });
  return next;
}

// ─── Contacts + verification ─────────────────────────────────────────────────
const codes = new Map<number, { code: string; exp: number; tries: number }>();
async function contactFor(ch: Channel) {
  if (ch !== "email" && ch !== "telegram") return null;
  const all = await storage.listAlertContacts();
  return all.find((c) => c.channel === ch) ?? null;
}
export async function contactsWithStatus() {
  const prefs = await loadPrefs();
  const all = await storage.listAlertContacts();
  return all.filter((c) => c.channel === "email" || c.channel === "telegram").map((c) => ({
    id: c.id, channel: c.channel, label: c.label,
    destination: c.channel === "email" ? c.destination.replace(/^(.).*(@.*)$/, "$1•••$2") : `chat …${c.destination.slice(-4)}`,
    verifiedAt: prefs.verified[String(c.id)] ?? null,
  }));
}
export async function sendVerification(contactId: number) {
  const c = (await storage.listAlertContacts()).find((x) => x.id === contactId);
  if (!c || (c.channel !== "email" && c.channel !== "telegram")) throw Object.assign(new Error("Contact not found"), { status: 404 });
  const code = String(crypto.randomInt(100000, 1000000));
  codes.set(contactId, { code, exp: Date.now() + 15 * 60_000, tries: 0 });
  const text = `Chizzle Cockpit verification code: ${code}. Enter it in Alert Settings within 15 minutes to allow practice alerts here. ${ALERT_SAFETY}`;
  const r = c.channel === "email" ? await sendEmailResend(c.destination, "Chizzle Cockpit — verify alert email", `<p>${text}</p>`) : await sendTelegram(c.destination, text);
  if (!r.ok) throw Object.assign(new Error(r.error || "Could not send the code"), { status: 502 });
  return { ok: true, sentTo: c.channel };
}
export async function confirmVerification(contactId: number, code: string) {
  const v = codes.get(contactId);
  if (!v || Date.now() > v.exp) throw Object.assign(new Error("Code expired — send a new one"), { status: 400 });
  if (++v.tries > 5) { codes.delete(contactId); throw Object.assign(new Error("Too many attempts — send a new code"), { status: 429 }); }
  if (v.code !== code.trim()) throw Object.assign(new Error("Wrong code"), { status: 400 });
  codes.delete(contactId);
  const cur = await loadPrefs();
  const next = { ...cur, verified: { ...cur.verified, [String(contactId)]: new Date().toISOString() } };
  await db.insert(swingAlertPrefs).values({ id: 1, data: next as any }).onConflictDoUpdate({ target: swingAlertPrefs.id, set: { data: next as any, updatedAt: new Date() } });
  return { ok: true };
}

// ─── Alerts CRUD ─────────────────────────────────────────────────────────────
const toAlert = (r: any): PriceAlert => ({
  id: r.id, symbol: r.symbol, setupId: r.setupId, planVersion: r.planVersion, type: r.type, level: r.level, levelHigh: r.levelHigh,
  channels: r.channels, frequency: r.frequency, repeatMinutes: r.repeatMinutes, expiryMode: r.expiryMode,
  expiresAt: r.expiresAt ? new Date(r.expiresAt).toISOString() : null, active: r.active,
  lastFiredAt: r.lastFiredAt ? new Date(r.lastFiredAt).toISOString() : null, lastFiredBar: r.lastFiredBar,
  fireCount: r.fireCount, lastState: r.lastState, note: r.note, createdAt: new Date(r.createdAt).toISOString(),
});

export async function listAlerts(symbol?: string | null) {
  await ensureTables();
  const q = db.select().from(swingPriceAlerts);
  const rows = await (symbol ? q.where(eq(swingPriceAlerts.symbol, symbol.toUpperCase())) : q).orderBy(desc(swingPriceAlerts.id)).limit(200);
  return rows.map(toAlert);
}

export interface CreateAlertInput {
  symbol: string; exchange: string; type: AlertType; level?: number | null; levelHigh?: number | null; channels: Channel[];
  frequency: Frequency; repeatMinutes?: number; expiryMode: ExpiryMode; customExpiry?: string | null; note?: string;
}
export async function createAlert(b: CreateAlertInput): Promise<PriceAlert> {
  await ensureTables();
  const sym = b.symbol.toUpperCase();
  const { res } = await evaluateSymbol({ symbol: sym, exchange: b.exchange });
  const d = res.decision;
  const sel = await selectedVersions();
  const v = activeVersion(d, sel);
  const nowIso = new Date().toISOString();
  const row = (await db.insert(swingPriceAlerts).values({
    symbol: sym, setupId: setupIdOf(d), planVersion: v?.version ?? 0, type: b.type, level: b.level ?? null, levelHigh: b.levelHigh ?? null,
    channels: [...new Set(["in_app", ...b.channels])] as any, frequency: b.frequency, repeatMinutes: b.repeatMinutes ?? 30,
    expiryMode: b.expiryMode, expiresAt: (() => { const x = resolveExpiry(b.expiryMode, nowIso, b.customExpiry ?? null); return x ? new Date(x) : null; })(),
    note: b.note ?? "",
  }).returning())[0];
  return toAlert(row);
}
export async function setAlertActive(id: number, active: boolean) {
  await ensureTables();
  const r = await db.update(swingPriceAlerts).set({ active }).where(eq(swingPriceAlerts.id, id)).returning({ id: swingPriceAlerts.id });
  if (!r.length) throw Object.assign(new Error("Alert not found"), { status: 404 });
  return { ok: true, id, active };
}
export async function deleteAlert(id: number) {
  await ensureTables();
  await db.delete(swingPriceAlerts).where(eq(swingPriceAlerts.id, id));
  return { ok: true, id };
}
export async function listEvents(limit = 50, sinceId = 0) {
  await ensureTables();
  const rows = await db.select().from(swingAlertEvents).orderBy(desc(swingAlertEvents.id)).limit(Math.min(200, limit));
  return rows.filter((r) => r.id > sinceId).map((r) => ({ ...r, firedAt: new Date(r.firedAt).toISOString(), acknowledgedAt: r.acknowledgedAt ? new Date(r.acknowledgedAt).toISOString() : null }));
}
export async function ackEvent(id: number) {
  await ensureTables();
  await db.update(swingAlertEvents).set({ acknowledged: true, acknowledgedAt: new Date() }).where(eq(swingAlertEvents.id, id));
  return { ok: true, id };
}

// ─── Evaluator ───────────────────────────────────────────────────────────────
const startOfDayCT = () => {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const probe = new Date(`${ymd}T12:00:00Z`);
  const ctHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "2-digit", hourCycle: "h23" }).format(probe));
  return new Date(probe.getTime() - ctHour * 3600_000); // 00:00 CT
};
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

let running = false;
export async function tickAlerts(now = new Date()): Promise<{ checked: number; fired: number }> {
  if (running || !alertsEnabled() || !isUnifiedSwingEnabled()) return { checked: 0, fired: 0 };
  running = true;
  try {
    await ensureTables();
    const active = (await db.select().from(swingPriceAlerts).where(eq(swingPriceAlerts.active, true))).map(toAlert);
    if (!active.length) return { checked: 0, fired: 0 };
    const prefs = await loadPrefs();
    const s = await loadSettings();
    const sel = await selectedVersions();
    const today = await db.select({ symbol: swingAlertEvents.symbol }).from(swingAlertEvents).where(gte(swingAlertEvents.firedAt, startOfDayCT()));
    let total = today.length; const perTicker: Record<string, number> = {};
    for (const t of today) perTicker[t.symbol] = (perTicker[t.symbol] ?? 0) + 1;
    const nowSec = Math.floor(now.getTime() / 1000), nowIso = now.toISOString();
    const marketOpen = inRth(nowSec);
    let fired = 0;
    const bySym = new Map<string, PriceAlert[]>();
    for (const a of active) bySym.set(a.symbol, [...(bySym.get(a.symbol) ?? []), a]);

    for (const [sym, alerts] of bySym) {
      const item = s.watchlist?.find((x) => x.symbol === sym);
      let snap: AlertSnapshot, d: any = null;
      try {
        const ev = await evaluateSymbol({ symbol: sym, exchange: item?.exchange ?? "" }, { settings: s, allowStale: true });
        d = ev.res.decision;
        const q = await fetchQuote(sym).catch(() => null);
        const last = tag1H(ev.bars1h, nowSec, true).filter((b) => b.closed).pop() ?? null;
        snap = {
          price: q?.price ?? d.currentPrice, priceTs: q ? new Date(q.ts * 1000).toISOString() : d.quoteTimestamp,
          dataStatus: d.dataStatus, dataSource: q?.source ?? d.dataSource, setupId: setupIdOf(d), setupStatus: d.setupStatus,
          last1H: last ? { end: new Date((last.t + 3600) * 1000).toISOString(), close: last.c } : null, marketOpen,
        };
      } catch { continue; }

      for (const a of alerts) {
        // "When setup expires" alerts end when their setup is gone.
        if (a.expiryMode === "SETUP_EXPIRES" && a.type !== "SETUP_EXPIRES" && a.setupId && (snap.setupStatus === "SIGNAL_EXPIRED" || snap.setupId !== a.setupId)) {
          await db.update(swingPriceAlerts).set({ active: false }).where(eq(swingPriceAlerts.id, a.id)); continue;
        }
        const c = evalCondition(a, snap);
        if (!c.hit) { if (c.state !== a.lastState) await db.update(swingPriceAlerts).set({ lastState: c.state }).where(eq(swingPriceAlerts.id, a.id)); continue; }
        const similar = await db.select({ at: swingAlertEvents.firedAt }).from(swingAlertEvents)
          .where(and(eq(swingAlertEvents.symbol, sym), eq(swingAlertEvents.type, a.type))).orderBy(desc(swingAlertEvents.firedAt)).limit(1);
        const sameLevel = similar[0]?.at ? new Date(similar[0].at).toISOString() : null;
        const g = gateAlert(a, { nowIso, prefs, marketOpen, firedTodayForTicker: perTicker[sym] ?? 0, firedTodayTotal: total, lastSimilarAt: sameLevel, bar1hEnd: snap.last1H?.end ?? null });
        if (!g.allow) {
          // Blocked (quiet hours, caps, dedupe…): keep the old state so it can still fire once the block lifts.
          if (g.expire) await db.update(swingPriceAlerts).set({ active: false }).where(eq(swingPriceAlerts.id, a.id));
          continue;
        }
        const v = d ? activeVersion(d, sel) : null;
        const p = d ? effectivePlan(d, v) : null;
        const msg = buildAlertMessages({
          symbol: sym, type: a.type, price: snap.price, level: a.level, levelHigh: a.levelHigh, atIso: nowIso,
          planLabel: v ? `Practice Plan v${v.version} (user-adjusted)` : "System plan",
          entry: p?.entry ?? null, stop: p?.stop ?? null, t1: p?.t1 ?? null, t2: p?.t2 ?? null,
          statusLabel: d ? STATUS_LABEL[d.setupStatus as keyof typeof STATUS_LABEL] ?? d.setupStatus : "—", dataStatus: snap.dataStatus, marketOpen,
        });
        const delivery: Record<string, { status: string; error?: string }> = {};
        for (const ch of a.channels) {
          const contact = await contactFor(ch);
          const ok = channelAllowed(ch, prefs, contact ? { id: contact.id, enabled: contact.enabled } : null);
          if (!ok.ok) { delivery[ch] = { status: "skipped", error: ok.why }; continue; }
          if (ch === "in_app" || ch === "push") { delivery[ch] = { status: ch === "push" ? "queued_browser" : "delivered" }; continue; }
          const r = ch === "email"
            ? await sendEmailResend(contact!.destination, msg.subject, `${msg.emailText.map((l) => `<p style="margin:0 0 6px">${esc(l)}</p>`).join("")}<p><a href="${LIVE_URL}">Open Chizzle Cockpit</a></p>`)
            : await sendTelegram(contact!.destination, `${msg.sms}\n${LIVE_URL}`);
          delivery[ch] = r.ok ? { status: "sent" } : { status: "failed", error: r.error };
        }
        await db.insert(swingAlertEvents).values({
          alertId: a.id, symbol: sym, type: a.type, price: snap.price, level: a.level, dataSource: snap.dataSource, dataStatus: snap.dataStatus,
          condition: `${ALERT_TYPE_LABEL[a.type]} — ${c.detail}`, planVersion: v?.version ?? a.planVersion, message: msg.inApp, delivery: delivery as any,
        });
        await db.update(swingPriceAlerts).set({
          lastState: c.state, lastFiredAt: now, lastFiredBar: snap.last1H?.end ?? null, fireCount: a.fireCount + 1,
          ...(a.frequency === "ONCE" ? { active: false } : {}),
        }).where(eq(swingPriceAlerts.id, a.id));
        perTicker[sym] = (perTicker[sym] ?? 0) + 1; total += 1; fired += 1;
      }
    }
    return { checked: active.length, fired };
  } finally { running = false; }
}

let timer: NodeJS.Timeout | null = null;
export function startAlertLoop() {
  if (timer) return;
  timer = setInterval(() => { void tickAlerts().catch((e) => console.error("[alerts]", e?.message ?? e)); }, 60_000);
  timer.unref?.();
}
export { CHANNELS };
