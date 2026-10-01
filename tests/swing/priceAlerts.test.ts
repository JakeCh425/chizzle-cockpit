import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ALERT_SAFETY, DEFAULT_ALERT_PREFS, FORBIDDEN_ALERT_WORDS, buildAlertMessages, channelAllowed, evalCondition, gateAlert, inQuietHours, resolveExpiry,
  type AlertSnapshot, type PriceAlert,
} from "@shared/priceAlerts";

const snap = (o: Partial<AlertSnapshot> = {}): AlertSnapshot => ({
  price: 615, priceTs: null, dataStatus: "LIVE", dataSource: "yahoo", setupId: "SMH:X:1H:T", setupStatus: "SETUP_FORMING",
  last1H: null, marketOpen: true, ...o,
});
const alert = (o: Partial<PriceAlert> = {}): PriceAlert => ({
  id: 1, symbol: "SMH", setupId: "SMH:X:1H:T", planVersion: 1, type: "ENTRY_CROSS_UP", level: 614.74, levelHigh: null,
  channels: ["in_app"], frequency: "ONCE", repeatMinutes: 30, expiryMode: "END_OF_DAY", expiresAt: null, active: true,
  lastFiredAt: null, lastFiredBar: null, fireCount: 0, lastState: "below", note: "", createdAt: "2026-10-01T15:00:00Z", ...o,
});
// 10:00 CT on a Thursday (CDT = UTC−5)
const NOW = "2026-10-01T15:00:00.000Z";
const gate = (a: PriceAlert, o: Partial<Parameters<typeof gateAlert>[1]> = {}) =>
  gateAlert(a, { nowIso: NOW, prefs: DEFAULT_ALERT_PREFS, marketOpen: true, firedTodayForTicker: 0, firedTodayTotal: 0, lastSimilarAt: null, bar1hEnd: null, ...o });

describe("R4 alert conditions", () => {
  it("entry cross-up fires on the transition only", () => {
    expect(evalCondition(alert(), snap({ price: 615 })).hit).toBe(true);
    expect(evalCondition(alert({ lastState: "above" }), snap({ price: 616 })).hit).toBe(false);
    expect(evalCondition(alert(), snap({ price: 614 })).hit).toBe(false);
  });
  it("pullback / stop-reference fire when price drops to the level", () => {
    expect(evalCondition(alert({ type: "PULLBACK_DOWN", level: 612, lastState: "above" }), snap({ price: 611.9 })).hit).toBe(true);
    expect(evalCondition(alert({ type: "STOP_REFERENCE", level: 606.86, lastState: "above" }), snap({ price: 607 })).hit).toBe(false);
  });
  it("retest zone fires on entering the zone (either level order)", () => {
    expect(evalCondition(alert({ type: "RETEST_ZONE", level: 620, levelHigh: 610, lastState: "out" }), snap({ price: 615 })).hit).toBe(true);
    expect(evalCondition(alert({ type: "RETEST_ZONE", level: 610, levelHigh: 620, lastState: "in" }), snap({ price: 615 })).hit).toBe(false);
  });
  it("1H close above uses the closed bar, once per bar", () => {
    const a = alert({ type: "CLOSE_1H_ABOVE", level: 618.6, lastState: null });
    const s = snap({ last1H: { end: "2026-10-01T16:30:00Z", close: 619 } });
    const r = evalCondition(a, s);
    expect(r.hit).toBe(true);
    expect(evalCondition({ ...a, lastState: r.state }, s).hit).toBe(false);
  });
  it("4H confirmation, setup expiry and data alerts", () => {
    expect(evalCondition(alert({ type: "SETUP_CONFIRMED_4H", lastState: "pending" }), snap({ setupStatus: "SETUP_CONFIRMED" })).hit).toBe(true);
    expect(evalCondition(alert({ type: "SETUP_EXPIRES", lastState: "live" }), snap({ setupStatus: "SIGNAL_EXPIRED" })).hit).toBe(true);
    expect(evalCondition(alert({ type: "DATA_ISSUE", lastState: "ok" }), snap({ dataStatus: "STALE" })).hit).toBe(true);
    expect(evalCondition(alert({ type: "DATA_ISSUE", lastState: "ok" }), snap({ setupStatus: "BLOCKED_DATA_MISMATCH" })).hit).toBe(true);
    expect(evalCondition(alert({ type: "DATA_RECOVERED", lastState: "bad" }), snap({ dataStatus: "LIVE" })).hit).toBe(true);
    expect(evalCondition(alert({ type: "DATA_RECOVERED", lastState: "live" }), snap({ dataStatus: "LIVE" })).hit).toBe(false);
  });
});

describe("R4 delivery rules", () => {
  it("once-only, per-bar and repeat frequencies", () => {
    expect(gate(alert({ fireCount: 1 })).allow).toBe(false);
    expect(gate(alert({ frequency: "PER_BAR", lastFiredBar: "B1", fireCount: 1 }), { bar1hEnd: "B1" }).allow).toBe(false);
    expect(gate(alert({ frequency: "PER_BAR", lastFiredBar: "B1", fireCount: 1 }), { bar1hEnd: "B2" }).allow).toBe(true);
    expect(gate(alert({ frequency: "REPEAT", repeatMinutes: 30, lastFiredAt: "2026-10-01T14:45:00Z", fireCount: 1 })).allow).toBe(false);
  });
  it("expiry deactivates", () => {
    const g = gate(alert({ expiresAt: "2026-10-01T14:00:00Z" }));
    expect(g.allow).toBe(false); expect(g.expire).toBe(true);
  });
  it("market-hours-only blocks price alerts but not data alerts", () => {
    expect(gate(alert(), { marketOpen: false }).reason).toBe("market hours only");
    expect(gate(alert({ type: "DATA_ISSUE" }), { marketOpen: false }).allow).toBe(true);
  });
  it("quiet hours (including windows that wrap midnight)", () => {
    expect(inQuietHours(NOW, { quietStart: "09:30", quietEnd: "10:30" })).toBe(true);
    expect(inQuietHours(NOW, { quietStart: "21:00", quietEnd: "07:00" })).toBe(false);
    expect(inQuietHours("2026-10-01T03:00:00Z", { quietStart: "21:00", quietEnd: "07:00" })).toBe(true); // 22:00 CT
    expect(gate(alert(), { prefs: { ...DEFAULT_ALERT_PREFS, quietStart: "09:30", quietEnd: "10:30" } }).reason).toBe("quiet hours");
  });
  it("caps and duplicate suppression", () => {
    expect(gate(alert(), { firedTodayForTicker: 6 }).allow).toBe(false);
    expect(gate(alert(), { firedTodayTotal: 20 }).allow).toBe(false);
    expect(gate(alert(), { lastSimilarAt: "2026-10-01T14:50:00Z" }).reason).toMatch(/duplicate/);
    expect(gate(alert(), { lastSimilarAt: "2026-10-01T14:00:00Z" }).allow).toBe(true);
  });
  it("email/telegram require switch-on + verification; in-app always", () => {
    const prefs = { ...DEFAULT_ALERT_PREFS, channels: { ...DEFAULT_ALERT_PREFS.channels, email: true } };
    expect(channelAllowed("in_app", prefs, null).ok).toBe(true);
    expect(channelAllowed("email", DEFAULT_ALERT_PREFS, { id: 1, enabled: true }).ok).toBe(false);
    expect(channelAllowed("email", prefs, { id: 1, enabled: true }).why).toMatch(/not verified/);
    expect(channelAllowed("email", { ...prefs, verified: { "1": NOW } }, { id: 1, enabled: true }).ok).toBe(true);
    expect(channelAllowed("telegram", prefs, null).ok).toBe(false);
  });
  it("expiry resolves to 3:00 PM CT today / Friday", () => {
    expect(resolveExpiry("END_OF_DAY", NOW, null)).toBe("2026-10-01T20:00:00.000Z");
    expect(resolveExpiry("END_OF_WEEK", NOW, null)).toBe("2026-10-02T20:00:00.000Z");
    expect(resolveExpiry("SETUP_EXPIRES", NOW, null)).toBeNull();
    // after today's close → next weekday; Friday after close → next Friday
    expect(resolveExpiry("END_OF_DAY", "2026-10-01T21:00:00Z", null)).toBe("2026-10-02T20:00:00.000Z");
    expect(resolveExpiry("END_OF_DAY", "2026-10-02T21:00:00Z", null)).toBe("2026-10-05T20:00:00.000Z");
    expect(resolveExpiry("END_OF_WEEK", "2026-10-02T21:00:00Z", null)).toBe("2026-10-09T20:00:00.000Z");
  });
});

describe("R4 alert wording", () => {
  const base = { symbol: "SMH", type: "ENTRY_CROSS_UP" as const, price: 614.9, level: 614.74, levelHigh: null, atIso: NOW, planLabel: "Practice Plan v1 (user-adjusted)", entry: 614.74, stop: 606.86, t1: 622.28, t2: 627.42, statusLabel: "READY", dataStatus: "LIVE", marketOpen: true };
  it("uses the spec wording, safety line, subject and SMS template", () => {
    const m = buildAlertMessages(base);
    expect(m.inApp).toContain("SMH reached your practice entry level of $614.74");
    expect(m.inApp).toContain("Review current price, chart, stop, targets, and data status before deciding.");
    expect(m.inApp).toContain(ALERT_SAFETY);
    expect(m.subject).toBe("Chizzle Practice Alert: SMH reached Entry trigger crossed upward");
    expect(m.sms).toMatch(/^Chizzle alert: SMH reached \$614\.74 at 10:00 AM CT\. Practice-only\. Review live chart and plan before acting\./);
    expect(m.emailText.join(" ")).toContain("This is an informational practice alert only.");
  });
  it("adds data-status and market-closed notes", () => {
    const m = buildAlertMessages({ ...base, dataStatus: "STALE", marketOpen: false });
    expect(m.inApp).toContain("Data status is STALE. Verify with your broker/chart before acting.");
    expect(m.inApp).toContain("Market closed — level was observed in the latest available session data.");
  });
  it("never says buy now / sell now / place order", () => {
    for (const type of ["ENTRY_CROSS_UP", "PULLBACK_DOWN", "RETEST_ZONE", "CLOSE_1H_ABOVE", "SETUP_CONFIRMED_4H", "STOP_REFERENCE", "TARGET_1", "TARGET_2", "SETUP_EXPIRES", "DATA_ISSUE", "DATA_RECOVERED"] as const) {
      const m = buildAlertMessages({ ...base, type, levelHigh: 620 });
      const all = [m.inApp, m.subject, m.sms, ...m.emailText].join(" ");
      for (const re of FORBIDDEN_ALERT_WORDS) expect(all).not.toMatch(re);
    }
  });
  it("alert code never touches a broker", () => {
    const src = ["server/swing/alerts.ts", "shared/priceAlerts.ts", "client/src/components/swing/PriceAlerts.tsx", "client/src/lib/alerts.ts"]
      .map((f) => fs.readFileSync(path.resolve(__dirname, "../..", f), "utf8")).join("\n");
    expect(src).not.toMatch(/alpaca|ibkr|interactive ?brokers|tradier|schwab|placeOrder|submitOrder|\/orders\b/i);
  });
});
