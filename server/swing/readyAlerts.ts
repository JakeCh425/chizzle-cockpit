// Ready-now notifications. Source of truth = the server-side decision from refreshSymbol():
// a fresh (bars fetched, data not stale) READY_TO_TRADE decision for a watchlist symbol whose
// idempotency key has no event yet creates ONE event in swing_alert_events (existing table,
// no schema change), then delivers in-app / Telegram / browser per the existing alert prefs.
// Telegram failures are recorded and retried with limited backoff; they never block the engine.
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "../storage";
import { swingAlertEvents } from "@shared/schema";
import type { SwingDecision } from "@shared/swingDecision";
import { activeVersion, effectivePlan } from "@shared/practicePlan";
import { READY_EVENT_TYPE, TELEGRAM_KIND_LABEL, classifyTelegram, nextRetryAt, readyKey, readyMessage, type TelegramKind } from "@shared/readyAlerts";
import { channelAllowed } from "@shared/priceAlerts";
import { SETUP_NAME } from "./lifecycle";
import { livePermission, onReadyDecision } from "./service";
import { alertsEnabled, contactForChannel, loadPrefs } from "./alerts";
import { selectedVersions } from "./plans";

const LIVE_URL = "https://chizzle-cockpit-duyn.onrender.com";

// ─── Telegram (plain text, timeout, checked response; the token never leaves the server) ──
export interface TelegramResult { ok: boolean; kind: TelegramKind; httpStatus: number | null; error: string | null; retryAfter: number | null }
export async function telegramSend(chatId: string | null | undefined, text: string): Promise<TelegramResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return { ok: false, kind: "CONFIG_MISSING", httpStatus: null, error: !token ? "TELEGRAM_BOT_TOKEN is not set on the server" : "No Telegram chat is configured", retryAfter: null };
  const scrub = (s: string) => s.split(token).join("[token]").slice(0, 200);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    const data: any = await res.json().catch(() => ({}));
    if (res.ok && data?.ok) return { ok: true, kind: "SENT", httpStatus: res.status, error: null, retryAfter: null };
    const desc = scrub(String(data?.description ?? res.statusText ?? "unknown"));
    const status = res.ok ? 400 : res.status;
    return { ok: false, kind: classifyTelegram(status, desc), httpStatus: status, error: `Telegram ${status}: ${desc}`, retryAfter: data?.parameters?.retry_after ?? null };
  } catch (e: any) {
    return { ok: false, kind: classifyTelegram(null, "", e?.name), httpStatus: null, error: scrub(`Telegram request failed: ${e?.name === "TimeoutError" ? "timed out after 10s" : e?.message ?? String(e)}`), retryAfter: null };
  }
}

export async function sendTestTelegram() {
  const c = await contactForChannel("telegram");
  const r = await telegramSend(c?.destination, "Chizzle Cockpit — test message. Telegram delivery works.\nPRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE");
  console.log(`[ready-alerts] test telegram: ${r.kind}${r.httpStatus ? ` (${r.httpStatus})` : ""}`);
  return { ok: r.ok, kind: r.kind, label: TELEGRAM_KIND_LABEL[r.kind], httpStatus: r.httpStatus, error: r.error, chat: c ? `chat …${c.destination.slice(-4)}` : null };
}

// ─── Dependencies (injectable for tests; production uses the real DB / prefs / Telegram) ──
const store = {
  findByKey: async (key: string) => (await db.select({ id: swingAlertEvents.id }).from(swingAlertEvents)
    .where(and(eq(swingAlertEvents.type, READY_EVENT_TYPE), eq(swingAlertEvents.condition, key))).limit(1))[0] ?? null,
  insert: async (v: typeof swingAlertEvents.$inferInsert) => (await db.insert(swingAlertEvents).values(v).returning())[0],
  setDelivery: async (id: number, delivery: any) => { await db.update(swingAlertEvents).set({ delivery }).where(eq(swingAlertEvents.id, id)); },
  recent: async (sinceMs: number) => db.select().from(swingAlertEvents)
    .where(and(eq(swingAlertEvents.type, READY_EVENT_TYPE), gte(swingAlertEvents.firedAt, new Date(sinceMs)))).orderBy(desc(swingAlertEvents.id)).limit(50),
};
const deps = {
  store, loadPrefs, contact: () => contactForChannel("telegram"), selectedVersions: () => selectedVersions(), livePermission,
  send: (chat: string | null | undefined, text: string) => telegramSend(chat, text), enabled: alertsEnabled,
};

// ─── Ready event creation ────────────────────────────────────────────────────
const seen = new Set<string>();               // keys already recorded (memory fast-path; the DB is authoritative)
const pending = new Map<string, Promise<void>>();

async function deliverTelegram(text: string, attempts: number) {
  const prefs = await deps.loadPrefs();
  const c = await deps.contact();
  const allowed = channelAllowed("telegram", prefs, c ? { id: c.id, enabled: c.enabled } : null);
  if (!allowed.ok) return { status: "skipped", error: allowed.why, attempts, attemptedAt: null as string | null };
  const r = await deps.send(c!.destination, text);
  const at = Date.now();
  const n = attempts + 1;
  if (!r.ok) console.warn(`[ready-alerts] telegram ${r.kind}${r.httpStatus ? ` ${r.httpStatus}` : ""} (attempt ${n})`);
  return r.ok
    ? { status: "sent", kind: r.kind, httpStatus: r.httpStatus, attempts: n, attemptedAt: new Date(at).toISOString() }
    : { status: "failed", kind: r.kind, label: TELEGRAM_KIND_LABEL[r.kind], httpStatus: r.httpStatus, error: r.error, attempts: n, attemptedAt: new Date(at).toISOString(), nextAt: nextRetryAt(r.kind, n, at, r.retryAfter) };
}

export async function recordReady(d: SwingDecision, qualifyingBar: string | null): Promise<void> {
  if (!deps.enabled() || d.setupStatus !== "READY_TO_TRADE") return;
  const key = readyKey(d, qualifyingBar);
  if (seen.has(key)) return;
  const run = pending.get(key);
  if (run) return run;
  const p = (async () => {
    if (await deps.store.findByKey(key)) { seen.add(key); return; }
    const prefs = await deps.loadPrefs();
    const sel = await deps.selectedVersions().catch(() => null);
    const v = sel ? activeVersion(d, sel) : null;
    const plan = effectivePlan(d, v);
    const live = deps.livePermission();
    const msg = readyMessage({
      symbol: d.symbol, setupName: d.setupType ? SETUP_NAME[d.setupType] ?? d.setupType : "Setup", timeframe: d.setupTimeframe,
      entry: plan.entry, stop: plan.stop, t1: plan.t1, live, qualifyingBar, planLabel: v ? `Your Plan v${v.version}` : "System plan", url: LIVE_URL,
    });
    const inApp = prefs.channels.in_app;
    // Insert first (the key reserves the event) so a crash mid-send can never cause a duplicate.
    const row = await deps.store.insert({
      alertId: null, symbol: d.symbol, type: READY_EVENT_TYPE, price: d.currentPrice, level: plan.entry, dataSource: d.dataSource, dataStatus: d.dataStatus,
      condition: key, planVersion: v?.version ?? 0, message: msg.inApp,
      delivery: { in_app: { status: inApp ? "delivered" : "skipped", error: inApp ? undefined : "In-app alerts are switched off" }, telegram: { status: "sending", attempts: 0 }, push: { status: prefs.channels.push ? "queued_browser" : "skipped" }, text: msg.text } as any,
      acknowledged: !inApp, acknowledgedAt: inApp ? null : new Date(),
    });
    seen.add(key);
    console.log(`[ready-alerts] READY event #${row.id} ${d.symbol} ${key}`);
    const tg = await deliverTelegram(msg.text, 0).catch((e) => ({ status: "failed", kind: "NETWORK", error: String(e?.message ?? e).slice(0, 160), attempts: 1, attemptedAt: new Date().toISOString(), nextAt: null }));
    await deps.store.setDelivery(row.id, { ...(row.delivery as any), telegram: tg });
  })().catch((e) => { console.error("[ready-alerts]", e?.message ?? e); }).finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}

/** Retry undelivered Telegram for confirmed Ready events (transient failures only, limited backoff). */
let retrying = false;
export async function retryReadyDeliveries(now = Date.now()) {
  if (retrying || !deps.enabled()) return { retried: 0 };
  retrying = true;
  try {
    const rows = await deps.store.recent(now - 24 * 3600_000);
    let retried = 0;
    for (const r of rows) {
      const del = (r.delivery ?? {}) as any, tg = del.telegram ?? {};
      // "sending" older than 2 min = the process died mid-send; treat as a failed attempt.
      const stuck = tg.status === "sending" && now - new Date(r.firedAt).getTime() > 120_000;
      const due = tg.status === "failed" && tg.nextAt && new Date(tg.nextAt).getTime() <= now;
      if (!stuck && !due) continue;
      const next = await deliverTelegram(del.text ?? r.message, tg.attempts ?? 0);
      await deps.store.setDelivery(r.id, { ...del, telegram: next });
      retried++;
    }
    return { retried };
  } finally { retrying = false; }
}

let timer: NodeJS.Timeout | null = null;
export function startReadyAlerts() {
  if (timer) return;
  onReadyDecision((d, bar) => { void recordReady(d, bar); });
  timer = setInterval(() => { void retryReadyDeliveries().catch((e) => console.error("[ready-alerts] retry", e?.message ?? e)); }, 60_000);
  timer.unref?.();
}

export const _test = { seen, pending, deps, reset: () => { seen.clear(); pending.clear(); } };
