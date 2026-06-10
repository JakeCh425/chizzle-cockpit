/**
 * Alert dispatcher — sends hammer/confirmation alerts via Resend (email) and Twilio (SMS).
 *
 * Required env vars (all optional — missing keys = stubbed delivery, logged to alert_log
 * with status="stubbed" so the user still sees what *would* have been sent):
 *   - RESEND_API_KEY
 *   - RESEND_FROM_EMAIL  (default: "onboarding@resend.dev")
 *   - TWILIO_ACCOUNT_SID
 *   - TWILIO_AUTH_TOKEN
 *   - TWILIO_FROM_NUMBER  (E.164, e.g. "+18165551234")
 *
 * Public API:
 *   - dispatchHammerAlert(payload)   // call from any scan loop
 *   - sendTestAlert(channel, dest)   // manual test endpoint
 */
import { storage } from "./storage";

const LIVE_URL = "https://chizzle-cockpit-duyn.onrender.com";

export type AlertPhase = "forming" | "confirmed";
export type AlertMode = "conservative" | "aggressive";

export interface HammerAlertPayload {
  ticker: string;
  phase: AlertPhase;
  mode: AlertMode;
  candleTimestamp: string; // ISO; used in signalKey for dedupe
  timeframe: string; // "daily" | "4h" | etc
  price: number;
  entry?: number;
  stop?: number;
  rr2?: number;
  rr3?: number;
  rr4?: number;
  rr5?: number;
  setupNote?: string;
}

function buildSignalKey(p: HammerAlertPayload): string {
  return `${p.ticker.toUpperCase()}::${p.mode}::${p.phase}::${p.candleTimestamp}`;
}

function fmtPrice(n: number | undefined): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return `$${n.toFixed(2)}`;
}

function buildSubject(p: HammerAlertPayload): string {
  const modeLabel = p.mode === "aggressive" ? "Aggressive" : "Standard";
  const phaseLabel = p.phase === "confirmed" ? "Confirmed" : "Forming";
  return `[Chizzle] ${p.ticker} ${modeLabel} Hammer ${phaseLabel} (${p.timeframe})`;
}

function buildEmailHtml(p: HammerAlertPayload): string {
  const phaseLabel = p.phase === "confirmed" ? "Confirmed" : "Forming";
  const modeLabel = p.mode === "aggressive" ? "Aggressive" : "Standard";
  return `<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#0b0d12; color:#e6e9ef; margin:0; padding:24px;">
  <div style="max-width:520px; margin:0 auto; background:#13161d; border:1px solid #1f242e; border-radius:12px; padding:24px;">
    <div style="font-size:11px; letter-spacing:0.15em; text-transform:uppercase; color:#8a93a3; margin-bottom:8px;">Chizzle Wealth Engine</div>
    <h1 style="margin:0 0 4px; font-size:22px; color:#e6e9ef;">${p.ticker} · ${modeLabel} Hammer</h1>
    <div style="font-size:14px; color:#00d9a3; margin-bottom:20px;">${phaseLabel} on ${p.timeframe.toUpperCase()}</div>
    <table style="width:100%; border-collapse:collapse; font-size:13px; color:#c9cfdb;">
      <tr><td style="padding:6px 0; color:#8a93a3;">Price</td><td style="text-align:right;">${fmtPrice(p.price)}</td></tr>
      ${p.entry !== undefined ? `<tr><td style="padding:6px 0; color:#8a93a3;">Entry</td><td style="text-align:right;">${fmtPrice(p.entry)}</td></tr>` : ""}
      ${p.stop !== undefined ? `<tr><td style="padding:6px 0; color:#8a93a3;">Stop</td><td style="text-align:right; color:#ff5c5c;">${fmtPrice(p.stop)}</td></tr>` : ""}
      ${p.rr2 !== undefined ? `<tr><td style="padding:6px 0; color:#8a93a3;">1:2 R</td><td style="text-align:right;">${fmtPrice(p.rr2)}</td></tr>` : ""}
      ${p.rr3 !== undefined ? `<tr><td style="padding:6px 0; color:#8a93a3;">1:3 R</td><td style="text-align:right;">${fmtPrice(p.rr3)}</td></tr>` : ""}
      ${p.rr4 !== undefined ? `<tr><td style="padding:6px 0; color:#8a93a3;">1:4 R</td><td style="text-align:right;">${fmtPrice(p.rr4)}</td></tr>` : ""}
      ${p.rr5 !== undefined ? `<tr><td style="padding:6px 0; color:#8a93a3;">1:5 R</td><td style="text-align:right;">${fmtPrice(p.rr5)}</td></tr>` : ""}
    </table>
    ${p.setupNote ? `<div style="margin-top:16px; padding:12px; background:#0e1117; border-left:3px solid #00d9a3; font-size:12px; color:#a8b0bf;">${p.setupNote}</div>` : ""}
    <a href="${LIVE_URL}" style="display:inline-block; margin-top:20px; padding:10px 16px; background:#00d9a3; color:#0b0d12; text-decoration:none; border-radius:6px; font-weight:600; font-size:13px;">Open Cockpit</a>
    <div style="margin-top:20px; font-size:11px; color:#5a6172;">${new Date(p.candleTimestamp).toLocaleString("en-US", { timeZone: "America/Chicago" })} CT</div>
  </div>
</body></html>`;
}

function buildSmsText(p: HammerAlertPayload): string {
  const phaseLabel = p.phase === "confirmed" ? "CONFIRMED" : "Forming";
  const modeLabel = p.mode === "aggressive" ? "Aggro" : "Std";
  const parts = [
    `[Chizzle] ${p.ticker} ${modeLabel} Hammer ${phaseLabel} (${p.timeframe.toUpperCase()})`,
    `Px ${fmtPrice(p.price)}`,
  ];
  if (p.entry !== undefined) parts.push(`E ${fmtPrice(p.entry)}`);
  if (p.stop !== undefined) parts.push(`S ${fmtPrice(p.stop)}`);
  if (p.rr2 !== undefined) parts.push(`2R ${fmtPrice(p.rr2)}`);
  if (p.rr3 !== undefined) parts.push(`3R ${fmtPrice(p.rr3)}`);
  parts.push(LIVE_URL);
  return parts.join(" · ");
}

// ─── Resend (email) ────────────────────────────────────────────────────────────
async function sendEmailResend(to: string, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY not set" };
  const from = process.env.RESEND_FROM_EMAIL || "Chizzle Cockpit <onboarding@resend.dev>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `Resend ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: `Resend fetch error: ${e?.message || String(e)}` };
  }
}

// ─── Twilio (SMS) ──────────────────────────────────────────────────────────────
async function sendSmsTwilio(to: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) return { ok: false, error: "Twilio env vars not fully set" };
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
    const auth = Buffer.from(`${sid}:${token}`).toString("base64");
    const params = new URLSearchParams({ To: to, From: from, Body: body });
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${auth}`,
      },
      body: params.toString(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `Twilio ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: `Twilio fetch error: ${e?.message || String(e)}` };
  }
}

// ─── Public dispatcher ─────────────────────────────────────────────────────────

/**
 * Dispatch a hammer/confirmation alert to all enabled contacts.
 * Deduplicates per (signalKey, channel, destination) using alert_log.
 * Safe to call from inside any scan loop (does not throw).
 */
export async function dispatchHammerAlert(payload: HammerAlertPayload): Promise<void> {
  try {
    const signalKey = buildSignalKey(payload);
    const contacts = await storage.listEnabledAlertContacts();
    if (contacts.length === 0) return;

    const subject = buildSubject(payload);
    const html = buildEmailHtml(payload);
    const sms = buildSmsText(payload);
    const payloadJson = JSON.stringify(payload);

    for (const c of contacts) {
      // honor per-contact phase triggers
      if (payload.phase === "forming" && !c.triggerForming) continue;
      if (payload.phase === "confirmed" && !c.triggerConfirmed) continue;

      // dedupe
      const already = await storage.hasAlertBeenSent(signalKey, c.channel, c.destination);
      if (already) {
        await storage.appendAlertLog({
          signalKey,
          ticker: payload.ticker,
          phase: payload.phase,
          mode: payload.mode,
          channel: c.channel,
          destination: c.destination,
          status: "skipped_dedupe",
          errorMessage: "",
          payload: payloadJson,
          sentAt: new Date().toISOString(),
        });
        continue;
      }

      let status: "sent" | "failed" | "stubbed" = "sent";
      let errorMessage = "";

      if (c.channel === "email") {
        const hasKey = !!process.env.RESEND_API_KEY;
        if (!hasKey) {
          status = "stubbed";
          errorMessage = "RESEND_API_KEY not configured";
        } else {
          const r = await sendEmailResend(c.destination, subject, html);
          if (!r.ok) { status = "failed"; errorMessage = r.error || "unknown"; }
        }
      } else if (c.channel === "sms") {
        const hasKey = !!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN && !!process.env.TWILIO_FROM_NUMBER;
        if (!hasKey) {
          status = "stubbed";
          errorMessage = "Twilio env vars not configured";
        } else {
          const r = await sendSmsTwilio(c.destination, sms);
          if (!r.ok) { status = "failed"; errorMessage = r.error || "unknown"; }
        }
      } else {
        status = "failed";
        errorMessage = `unknown channel: ${c.channel}`;
      }

      await storage.appendAlertLog({
        signalKey,
        ticker: payload.ticker,
        phase: payload.phase,
        mode: payload.mode,
        channel: c.channel,
        destination: c.destination,
        status,
        errorMessage,
        payload: payloadJson,
        sentAt: new Date().toISOString(),
      });
    }
  } catch (e: any) {
    // never let alert plumbing crash the scan loop
    console.error("[alert-dispatcher] error:", e?.message || e);
  }
}

/** Manual test — fires a sample alert to a single destination. */
export async function sendTestAlert(channel: "email" | "sms", destination: string): Promise<{ ok: boolean; error?: string; status: string }> {
  const sample: HammerAlertPayload = {
    ticker: "SMH",
    phase: "confirmed",
    mode: "conservative",
    candleTimestamp: new Date().toISOString(),
    timeframe: "daily",
    price: 245.32,
    entry: 246.10,
    stop: 242.50,
    rr2: 253.30,
    rr3: 257.10,
    rr4: 260.90,
    setupNote: "Test alert — Chizzle Cockpit wiring check.",
  };
  try {
    if (channel === "email") {
      if (!process.env.RESEND_API_KEY) return { ok: false, error: "RESEND_API_KEY not set", status: "stubbed" };
      const r = await sendEmailResend(destination, buildSubject(sample) + " (TEST)", buildEmailHtml(sample));
      return { ok: r.ok, error: r.error, status: r.ok ? "sent" : "failed" };
    } else {
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const token = process.env.TWILIO_AUTH_TOKEN;
      const from = process.env.TWILIO_FROM_NUMBER;
      if (!sid || !token || !from) return { ok: false, error: "Twilio env vars not fully set", status: "stubbed" };
      const r = await sendSmsTwilio(destination, "[TEST] " + buildSmsText(sample));
      return { ok: r.ok, error: r.error, status: r.ok ? "sent" : "failed" };
    }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e), status: "failed" };
  }
}
