import { describe, it, expect, beforeEach } from "vitest";
process.env.DATABASE_URL ||= "postgres://x:y@127.0.0.1:1/none";
import { classifyTelegram, nextRetryAt, readyKey, readyMessage, readyStatusLabel, sortForCockpit } from "@shared/readyAlerts";
import { DEFAULT_ALERT_PREFS } from "@shared/priceAlerts";

const QQQ = (over: Record<string, unknown> = {}) => ({
  symbol: "QQQ", setupStatus: "READY_TO_TRADE", dataStatus: "LIVE", setupType: "HIGHER_LOW_CONSOLIDATION", setupTimeframe: "1H",
  setupTimestamp: "2026-10-05T16:30:00.000Z", entryPrice: 754.46, structuralStop: 747.46, target1: 768.46, target2: 775.46,
  planTargets: { t1: 768.46, t2: 775.46, rrT1: 2, rrT2: 3 }, riskPerShare: 7, currentPrice: 755.5, dataSource: "yahoo", ...over,
}) as any;
const BLOCKED = { allowed: false, regime: "red", source: "AUTO", reason: "Capital Protection is active (red regime) — no new live risk." };
const ALLOWED = { allowed: true, regime: "green", source: "AUTO", reason: "" };

describe("status language (live permission is separate from practice readiness)", () => {
  it("never says Ready to Trade while live risk is blocked", () => {
    expect(readyStatusLabel("READY_TO_TRADE", BLOCKED)).toBe("PRACTICE READY — LIVE ENTRY NOT PERMITTED");
    expect(readyStatusLabel("READY_TO_TRADE", ALLOWED)).toBe("READY TO TRADE");
    expect(readyStatusLabel("SETUP_CONFIRMED", ALLOWED)).toBe("SETUP CONFIRMED — AWAITING 1H CLOSE");
  });
  it("message is plain text, alert-only, practice-only, no buy/sell now", () => {
    const m = readyMessage({ symbol: "QQQ", setupName: "Higher-Low Consolidation", timeframe: "1H", entry: 754.46, stop: 747.46, t1: 768.46, live: BLOCKED, qualifyingBar: "2026-10-05T18:30:00.000Z", planLabel: "System plan" });
    expect(m.text).toContain("PRACTICE READY — LIVE ENTRY NOT PERMITTED: QQQ");
    expect(m.text).toContain("Risk/share $7.00");
    expect(m.text).toContain("PRICE ALERT ONLY — VERIFY DATA AND REVIEW THE PLAN BEFORE ACTING.");
    expect(m.text).toContain("PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE");
    expect(m.text.toLowerCase()).not.toMatch(/buy now|sell now/);
  });
});

describe("cockpit sort order", () => {
  it("Ready > Confirmed > Near trigger > Forming > Watching > Extended > No trade > Expired; never alphabetical", () => {
    const rows = ["SIGNAL_EXPIRED", "NO_TRADE", "WATCH_EXTENDED", "WATCH_RR_TOO_LOW", "SETUP_FORMING", "WATCH_RETEST", "SETUP_CONFIRMED", "READY_TO_TRADE"]
      .map((s, i) => ({ symbol: String.fromCharCode(65 + i), setupStatus: s, dataStatus: "LIVE" }));
    expect(sortForCockpit(rows).map((r) => r.setupStatus)).toEqual(["READY_TO_TRADE", "SETUP_CONFIRMED", "WATCH_RETEST", "SETUP_FORMING", "WATCH_RR_TOO_LOW", "WATCH_EXTENDED", "NO_TRADE", "SIGNAL_EXPIRED"]);
  });
});

describe("telegram classification + backoff", () => {
  it("classifies provider responses", () => {
    expect(classifyTelegram(200, "")).toBe("SENT");
    expect(classifyTelegram(401, "Unauthorized")).toBe("UNAUTHORIZED");
    expect(classifyTelegram(400, "Bad Request: chat not found")).toBe("INVALID_CHAT");
    expect(classifyTelegram(403, "Forbidden: bot was blocked by the user")).toBe("INVALID_CHAT");
    expect(classifyTelegram(429, "Too Many Requests")).toBe("RATE_LIMITED");
    expect(classifyTelegram(null, "", "TimeoutError")).toBe("TIMEOUT");
    expect(classifyTelegram(null, "", "TypeError")).toBe("NETWORK");
  });
  it("retries only transient failures, at most 4 attempts", () => {
    expect(nextRetryAt("UNAUTHORIZED", 1, 0)).toBeNull();
    expect(nextRetryAt("INVALID_CHAT", 1, 0)).toBeNull();
    expect(nextRetryAt("NETWORK", 1, 0)).toBe(new Date(60_000).toISOString());
    expect(nextRetryAt("NETWORK", 2, 0)).toBe(new Date(120_000).toISOString());
    expect(nextRetryAt("RATE_LIMITED", 1, 0, 300)).toBe(new Date(300_000).toISOString());
    expect(nextRetryAt("NETWORK", 4, 0)).toBeNull();
  });
});

describe("ready pipeline (server-side transition → one event, idempotent)", async () => {
  const mod = await import("../../server/swing/readyAlerts");
  let rows: any[] = [], sends: string[] = [], sendResult: any, prefs: any, emails: any[] = [], emailResult: any = { ok: true };
  beforeEach(() => {
    rows = []; sends = []; emails = []; emailResult = { ok: true }; mod._test.reset();
    prefs = { ...DEFAULT_ALERT_PREFS, channels: { in_app: true, email: false, telegram: true, push: false }, verified: { "3": "2026-10-01T21:02:46.217Z" } };
    sendResult = { ok: true, kind: "SENT", httpStatus: 200, error: null, retryAfter: null };
    Object.assign(mod._test.deps, {
      enabled: () => true,
      loadPrefs: async () => prefs,
      contact: async () => ({ id: 3, channel: "telegram", destination: "123455612", enabled: false }),
      selectedVersions: async () => ({}),
      livePermission: () => BLOCKED,
      send: async (_c: string, text: string) => { sends.push(text); return sendResult; },
      emailContact: async () => ({ id: 1, channel: "email", destination: "me@example.com", enabled: false }),
      sendEmail: async (to: string, subject: string, html: string) => { emails.push({ to, subject, html }); return emailResult; },
      store: {
        findByKey: async (k: string) => rows.find((r) => r.condition === k) ?? null,
        insert: async (v: any) => { const r = { id: rows.length + 1, firedAt: new Date(), ...v }; rows.push(r); return r; },
        setDelivery: async (id: number, d: any) => { rows.find((r) => r.id === id).delivery = d; },
        recent: async () => [...rows].reverse(),
      },
    });
  });
  const BAR1 = "2026-10-05T18:30:00.000Z", BAR2 = "2026-10-06T15:30:00.000Z";

  it("1. Confirmed → Ready creates one in-app event and attempts Telegram once", async () => {
    await mod.recordReady(QQQ(), BAR1);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("READY_NOW");
    expect(rows[0].acknowledged).toBe(false);               // unread count = 1
    expect(rows[0].delivery.in_app.status).toBe("delivered");
    expect(rows[0].delivery.telegram.status).toBe("sent");
    expect(sends).toHaveLength(1);
    expect(sends[0]).toContain("PRACTICE READY — LIVE ENTRY NOT PERMITTED: QQQ");
  });
  it("2. auto-refresh while still Ready (same qualifying bar) → no duplicate, even concurrently", async () => {
    await Promise.all([mod.recordReady(QQQ(), BAR1), mod.recordReady(QQQ(), BAR1)]);
    await mod.recordReady(QQQ(), BAR1);
    mod._test.reset();                                     // simulates a server restart: the DB key still blocks it
    await mod.recordReady(QQQ(), BAR1);
    expect(rows).toHaveLength(1); expect(sends).toHaveLength(1);
  });
  it("3. invalidated and Ready again on a new qualifying bar → a new alert is allowed", async () => {
    await mod.recordReady(QQQ(), BAR1);
    await mod.recordReady(QQQ({ setupStatus: "SIGNAL_EXPIRED" }), BAR1);
    await mod.recordReady(QQQ({ setupTimestamp: "2026-10-06T14:30:00.000Z" }), BAR2);
    expect(rows).toHaveLength(2); expect(sends).toHaveLength(2);
  });
  it("4. Telegram misconfigured → in-app still recorded, failure stored, no crash, no retry for 401", async () => {
    sendResult = { ok: false, kind: "UNAUTHORIZED", httpStatus: 401, error: "Telegram 401: Unauthorized", retryAfter: null };
    await expect(mod.recordReady(QQQ(), BAR1)).resolves.toBeUndefined();
    expect(rows[0].delivery.in_app.status).toBe("delivered");
    expect(rows[0].delivery.telegram).toMatchObject({ status: "failed", kind: "UNAUTHORIZED", attempts: 1, nextAt: null });
    await mod.retryReadyDeliveries(Date.now() + 3600_000);
    expect(sends).toHaveLength(1);
  });
  it("4b. a throwing sender never escapes the pipeline", async () => {
    mod._test.deps.send = async () => { throw new Error("boom"); };
    await expect(mod.recordReady(QQQ(), BAR1)).resolves.toBeUndefined();
    expect(rows[0].delivery.telegram.status).toBe("failed");
  });
  it("5. a confirmed-but-undelivered alert retries with backoff, then stops", async () => {
    sendResult = { ok: false, kind: "NETWORK", httpStatus: null, error: "fetch failed", retryAfter: null };
    await mod.recordReady(QQQ(), BAR1);
    const t0 = Date.now();
    await mod.retryReadyDeliveries(t0 + 30_000);              // not due yet
    expect(sends).toHaveLength(1);
    for (let i = 1; i <= 6; i++) await mod.retryReadyDeliveries(t0 + i * 3600_000);
    expect(sends).toHaveLength(4);                             // MAX_READY_ATTEMPTS
    expect(rows[0].delivery.telegram.nextAt).toBeNull();
    sendResult = { ok: true, kind: "SENT", httpStatus: 200, error: null, retryAfter: null };
    rows[0].delivery.telegram = { ...rows[0].delivery.telegram, nextAt: new Date(t0).toISOString(), attempts: 2 };
    await mod.retryReadyDeliveries(t0 + 1000);
    expect(rows[0].delivery.telegram.status).toBe("sent");
  });
  it("5b. non-Ready decisions (e.g. stale snapshot statuses) never create an event", async () => {
    await mod.recordReady(QQQ({ setupStatus: "SETUP_CONFIRMED" }), BAR1);
    expect(rows).toHaveLength(0);
  });
  it("9. Telegram switch off → no Telegram send; in-app follows its own setting", async () => {
    prefs.channels.telegram = false;
    await mod.recordReady(QQQ(), BAR1);
    expect(sends).toHaveLength(0);
    expect(rows[0].delivery.telegram.status).toBe("skipped");
    expect(rows[0].delivery.in_app.status).toBe("delivered");
  });
  it("9b. in-app off → event kept for idempotency but not unread", async () => {
    prefs.channels.in_app = false;
    await mod.recordReady(QQQ(), BAR1);
    expect(rows[0].acknowledged).toBe(true);
    expect(rows[0].delivery.in_app.status).toBe("skipped");
  });
  it("email: Ready sends one email when email is on + verified; failures retry; heads-ups never email", async () => {
    prefs = { ...prefs, channels: { ...prefs.channels, email: true }, verified: { ...prefs.verified, "1": "2026-10-01T21:02:33.816Z" } };
    emailResult = { ok: false, error: "Resend 503: busy" };
    await mod.recordReady(QQQ(), BAR1);
    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toContain("PRACTICE READY — LIVE ENTRY NOT PERMITTED: QQQ");
    expect(emails[0].html).toContain("PRICE ALERT ONLY — VERIFY DATA AND REVIEW THE PLAN BEFORE ACTING.");
    expect(rows[0].delivery.email).toMatchObject({ status: "failed", kind: "NETWORK", attempts: 1 });
    emailResult = { ok: true };
    await mod.retryReadyDeliveries(Date.now() + 61_000);
    expect(emails).toHaveLength(2);
    expect(rows[0].delivery.email.status).toBe("sent");
    expect(rows[0].delivery.telegram.status).toBe("sent");       // telegram untouched by the email retry
    expect(sends).toHaveLength(1);
    await mod.recordEarly(QQQ({ setupStatus: "SETUP_CONFIRMED" }), { tf: "30m", barStart: "a", barEnd: "2026-10-07T15:00:00.000Z", close: 755.2, trigger: 754.1, oneHourCloseAt: "2026-10-07T15:30:00.000Z" });
    await mod.recordEarly(QQQ({ setupStatus: "SETUP_CONFIRMED" }), { tf: "30m", barStart: "a", barEnd: "2026-10-07T15:00:00.000Z", close: 755.2, trigger: 754.1, oneHourCloseAt: "2026-10-07T15:30:00.000Z" });
    const early = rows.filter((r) => r.type === "EARLY_30M");
    expect(early).toHaveLength(1);
    expect(early[0].delivery.telegram.status).toBe("skipped");
    expect(emails).toHaveLength(2); expect(sends).toHaveLength(1);
  });
  it("email off → skipped, no contact lookup needed", async () => {
    await mod.recordReady(QQQ(), BAR1);
    expect(emails).toHaveLength(0);
    expect(rows[0].delivery.email.status).toBe("skipped");
  });
  it("idempotency key includes setup instance + qualifying bar", () => {
    expect(readyKey(QQQ(), BAR1)).toBe("READY|QQQ|READY_TO_TRADE|1H|HIGHER_LOW_CONSOLIDATION:2026-10-05T16:30:00.000Z|2026-10-05T18:30:00.000Z");
    expect(readyKey(QQQ(), BAR2)).not.toBe(readyKey(QQQ(), BAR1));
  });
});
