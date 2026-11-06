// ─── Transactional Email Utility (Resend / SendGrid / SMTP Compatible) ───

export interface PreEntryEmailPayload {
  userEmail?: string;
  email?: string;
  emailAddress?: string;
  ticker: string;
  price?: number | string;
  entryPrice?: number | string;
  stopLoss?: number | string;
  target1?: number | string;
  target2?: number | string;
  shares?: number;
  calculatedShares?: number;
  context?: string;
  plan?: string | any;
  message?: string;
  setupId?: string;
  alertType?: string;
}

export function formatPriceString(val: number | string | undefined): string {
  if (val === undefined || val === null) return "$0.00";
  if (typeof val === "string" && val.startsWith("$")) return val;
  const num = Number(val);
  return isNaN(num) ? String(val) : `$${num.toFixed(2)}`;
}

/**
 * Formats the pre-entry alert email subject line:
 * Subject Line: 🚨 CHIZZLE ALERT: {Ticker} is approaching {Price}
 */
export function formatPreEntryEmailSubject(ticker: string, price: number | string): string {
  const cleanTicker = (ticker || "NVDA").trim().toUpperCase();
  const formattedPrice = formatPriceString(price);
  return `🚨 CHIZZLE ALERT: ${cleanTicker} is approaching ${formattedPrice}`;
}

/**
 * Formats high-contrast HTML for quick readability on mobile matching the lock-screen preview exactly:
 * Subject Line: 🚨 CHIZZLE ALERT: {Ticker} is approaching {Price}
 * Body:
 *   Context: {Price within 0.25% of SMA or 3 mins to 1H Close}<br/>
 *   Fidelity Plan: Limit BUY at ${Entry}. Scale 50% at ${T1}.
 */
export function formatPreEntryEmailHtml(params: {
  ticker: string;
  price: number | string;
  context?: string;
  plan?: string | any;
  entryPrice?: number | string;
  target1?: number | string;
  stopLoss?: number | string;
  shares?: number;
  calculatedShares?: number;
  message?: string;
}): { html: string; text: string; subject: string } {
  const cleanTicker = (params.ticker || "NVDA").trim().toUpperCase();
  const formattedPrice = formatPriceString(params.price ?? params.entryPrice);
  const subject = formatPreEntryEmailSubject(cleanTicker, formattedPrice);
  const context = params.context || "Price within 0.25% of SMA";

  const entryStr = formatPriceString(params.entryPrice ?? params.price);
  const t1Str = formatPriceString(params.target1 ?? (Number(params.entryPrice ?? params.price) * 1.03));
  const shares =
    params.shares ??
    params.calculatedShares ??
    (typeof params.plan === "object" ? params.plan?.shares ?? params.plan?.calculatedShares : undefined);

  let planText = "";
  if (typeof params.plan === "string" && params.plan.trim() && !params.plan.includes("[object Object]")) {
    planText = params.plan;
  } else if (shares && shares > 0) {
    const order1 = Math.floor(shares / 2);
    const order2 = shares - order1;
    const stopStr = params.stopLoss ? formatPriceString(params.stopLoss) : "";
    planText = `BUY ${shares} Shares Limit at ${entryStr}. Order 1 SELL ${order1} Shares @ ${t1Str} (1.5R)${stopStr ? ` | Order 2 STOP ${order2} Shares @ ${stopStr}` : ""}.`;
  } else {
    planText = `Limit BUY at ${entryStr}. Scale 50% at ${t1Str}.`;
  }

  const text = [
    subject,
    `Context: ${context}`,
    `Fidelity Plan: ${planText}`,
    params.message && params.message !== planText ? `\n--- Execution Details ---\n${params.message}` : "",
  ].filter(Boolean).join("\n");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 20px; background-color: #0B0E14; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #FFFFFF;">
  <div style="max-width: 520px; margin: 0 auto; background-color: #111827; border: 1px solid #10B981; border-radius: 12px; padding: 24px; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
    <div style="font-size: 11px; font-weight: 800; color: #10B981; text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 6px;">
      🚨 CHIZZLE PRE-ENTRY ALERT
    </div>
    <h1 style="font-size: 20px; font-weight: 800; color: #FFFFFF; margin: 0 0 16px 0; border-bottom: 1px solid #1F2937; pb: 12px;">
      ${cleanTicker} is approaching ${formattedPrice}
    </h1>
    <div style="background-color: #030712; border: 1px solid #374151; border-radius: 8px; padding: 16px; margin-bottom: 18px; font-size: 13.5px; line-height: 1.6; color: #E5E7EB; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">
      <p style="margin: 0 0 8px 0;"><strong>Context:</strong> ${context}</p>
      <p style="margin: 0 0 8px 0;"><strong>Fidelity Plan:</strong> ${planText}</p>
      ${shares && shares > 0 ? `<p style="margin: 0; color: #10B981; font-weight: bold;">🎯 Order Size: ${shares} Shares</p>` : ""}
    </div>
    ${params.message ? `<div style="background-color: #0d1117; border: 1px solid #30363d; border-radius: 8px; padding: 12px; margin-bottom: 16px; font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; color: #c9d1d9; white-space: pre-wrap;">${params.message}</div>` : ""}
    <div style="font-size: 11px; color: #9CA3AF; text-align: left; line-height: 1.4;">
      ⚡ <em>Open your Fidelity app now to prepare for execution. Deduplicated: fires 1x per setup.</em>
    </div>
  </div>
</body>
</html>`;

  return { html, text, subject };
}

const serverFiredAlerts = new Set<string>();

/**
 * Resets the in-memory execution lock (used in unit tests / explicit reset).
 */
export function clearEmailAlertDeduplicationCache(): void {
  serverFiredAlerts.clear();
}

/**
 * Server-side email utility:
 * async function sendPreEntryEmail(userEmail, ticker, price, context, plan)
 * Supports both positional arguments and single object payload.
 */
export async function sendPreEntryEmail(
  userEmailOrPayload: string | PreEntryEmailPayload,
  tickerArg?: string,
  priceArg?: number | string,
  contextArg?: string,
  planArg?: string
): Promise<{
  ok: boolean;
  status: "sent" | "stubbed" | "failed";
  error?: string;
  subject: string;
  html: string;
  message: string;
}> {
  let userEmail = "";
  let ticker = "NVDA";
  let price: number | string = 0;
  let context = "Price within 0.25% of SMA";
  let plan: string | any = "";
  let target1: number | string | undefined = undefined;
  let stopLoss: number | string | undefined = undefined;
  let shares: number | undefined = undefined;
  let customMessage: string | undefined = undefined;

  if (typeof userEmailOrPayload === "object" && userEmailOrPayload !== null) {
    userEmail = (userEmailOrPayload.userEmail || userEmailOrPayload.emailAddress || userEmailOrPayload.email || "").trim();
    ticker = userEmailOrPayload.ticker || "NVDA";
    price = userEmailOrPayload.price ?? userEmailOrPayload.entryPrice ?? 0;
    context = userEmailOrPayload.context || "Price within 0.25% of SMA";
    target1 = userEmailOrPayload.target1 ?? (typeof userEmailOrPayload.plan === "object" ? userEmailOrPayload.plan?.target1 : undefined);
    stopLoss = userEmailOrPayload.stopLoss ?? (typeof userEmailOrPayload.plan === "object" ? userEmailOrPayload.plan?.stopLoss : undefined);
    shares = userEmailOrPayload.calculatedShares ?? userEmailOrPayload.shares ?? (typeof userEmailOrPayload.plan === "object" ? userEmailOrPayload.plan?.shares ?? userEmailOrPayload.plan?.calculatedShares : undefined);
    plan = userEmailOrPayload.plan || "";
    customMessage = userEmailOrPayload.message;
  } else {
    userEmail = String(userEmailOrPayload || "").trim();
    ticker = tickerArg || "NVDA";
    price = priceArg ?? 0;
    context = contextArg || "Price within 0.25% of SMA";
    plan = planArg || "";
  }

  const { html, text, subject } = formatPreEntryEmailHtml({
    ticker,
    price,
    context,
    plan,
    entryPrice: price,
    target1,
    stopLoss,
    shares,
    calculatedShares: shares,
    message: customMessage,
  });

  if (!userEmail) {
    return {
      ok: false,
      status: "failed",
      error: "User email address is required",
      subject,
      html,
      message: text,
    };
  }

  // Strict execution lock (debounce/cache) per active setup
  const cleanTicker = (ticker || "NVDA").trim().toUpperCase();
  const formattedPrice = formatPriceString(price);
  const alertType = (userEmailOrPayload as any)?.alertType || "PRE_ENTRY";
  const setupId = (userEmailOrPayload as any)?.setupId || formattedPrice;
  const alertKey = `${cleanTicker}-${setupId}-${alertType}`;

  if (serverFiredAlerts.has(alertKey)) {
    return {
      ok: true,
      status: "stubbed",
      error: `Duplicate alert suppressed by deduplication lock for key ${alertKey}`,
      subject,
      html,
      message: text,
    };
  }
  serverFiredAlerts.add(alertKey);

  // Check transactional provider (Resend or SendGrid)
  const resendApiKey = process.env.RESEND_API_KEY;
  const sendgridApiKey = process.env.SENDGRID_API_KEY;

  if (resendApiKey) {
    const from = process.env.RESEND_FROM_EMAIL || "Chizzle Pre-Entry Alerts <onboarding@resend.dev>";
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resendApiKey}`,
        },
        body: JSON.stringify({
          from,
          to: [userEmail],
          subject,
          text,
          html,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        return {
          ok: false,
          status: "failed",
          error: `Resend ${res.status}: ${errText.slice(0, 200)}`,
          subject,
          html,
          message: text,
        };
      }

      return {
        ok: true,
        status: "sent",
        subject,
        html,
        message: text,
      };
    } catch (e: any) {
      return {
        ok: false,
        status: "failed",
        error: e?.message || String(e),
        subject,
        html,
        message: text,
      };
    }
  }

  if (sendgridApiKey) {
    const from = process.env.SENDGRID_FROM_EMAIL || "alerts@chizzlecockpit.com";
    try {
      const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sendgridApiKey}`,
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: userEmail }] }],
          from: { email: from },
          subject,
          content: [
            { type: "text/plain", value: text },
            { type: "text/html", value: html },
          ],
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        return {
          ok: false,
          status: "failed",
          error: `SendGrid ${res.status}: ${errText.slice(0, 200)}`,
          subject,
          html,
          message: text,
        };
      }

      return {
        ok: true,
        status: "sent",
        subject,
        html,
        message: text,
      };
    } catch (e: any) {
      return {
        ok: false,
        status: "failed",
        error: e?.message || String(e),
        subject,
        html,
        message: text,
      };
    }
  }

  // Gracefully stubbed when provider key is not yet added to .env
  return {
    ok: true,
    status: "stubbed",
    error: "RESEND_API_KEY / SENDGRID_API_KEY not configured (stubbed)",
    subject,
    html,
    message: text,
  };
}

