// Trade Summary — one detailed, plain-English write-up per card that merges the
// Unified Swing Engine decision (the authority) with the AI Trade Coach's
// trend/regime read (supporting context). Deterministic: no LLM calls, no
// credits, same input → same summary.
//
// Rules:
//  • The unified status always wins. Coach lines that would contradict it
//    (sizing up, "full size", fresh-long language while not READY) are dropped.
//  • Never places orders. When a card prints READY, the summary tells the user
//    to open their own broker and enter the order themselves if they choose.
//  • Every summary carries the practice banner + overnight gap-risk warning.

import {
  FORBIDDEN_PHRASES, GAP_RISK_WARNING, PRACTICE_BANNER, STATUS_LABEL,
  type SwingDecision,
} from "./swingDecision";

export interface CoachInput { headline: string; bullets: string[] }
export interface SummarySection { title: string; lines: string[] }
export interface TradeSummary {
  symbol: string;
  status: SwingDecision["setupStatus"];
  headline: string;
  printed: boolean;           // true only when the card is READY_TO_TRADE
  brokerStep: string[] | null; // shown only when printed
  sections: SummarySection[];
  warnings: string[];
  text: string;               // copy-ready plain text
}

const $ = (n: number | null | undefined) => (n == null || !isFinite(n) ? "—" : `$${n.toFixed(2)}`);
const pct = (n: number | null | undefined) => (n == null || !isFinite(n) ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`);
const setupName = (t: string | null) => (t ? t.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : "No setup type");

/** Coach phrases that only make sense when a plan is actually live. */
const SIZING_WORDS = /(full pilot size|size up|scaling in|scale in|full size|consider scaling)/i;

export function harmonizeCoach(status: SwingDecision["setupStatus"], coach: CoachInput | null | undefined): CoachInput | null {
  if (!coach) return null;
  const banned = FORBIDDEN_PHRASES[status] ?? [];
  const ok = (line: string) =>
    !banned.some((p) => line.toLowerCase().includes(p.toLowerCase())) &&
    (status === "READY_TO_TRADE" || !SIZING_WORDS.test(line));
  const bullets = coach.bullets.filter(ok);
  const headline = ok(coach.headline) ? coach.headline : `${coach.headline.split(" — ")[0]} — see unified status`;
  return { headline, bullets };
}

export function buildTradeSummary(d: SwingDecision, coachRaw?: CoachInput | null): TradeSummary {
  const label = STATUS_LABEL[d.setupStatus];
  const printed = d.setupStatus === "READY_TO_TRADE";
  const coach = harmonizeCoach(d.setupStatus, coachRaw);
  const entry = d.entryPrice ?? d.originalTrigger;
  const LIVE: SwingDecision["setupStatus"][] = ["READY_TO_TRADE", "SETUP_CONFIRMED", "SETUP_FORMING", "WATCH_RETEST", "WATCH_STOP_TOO_WIDE", "WATCH_RR_TOO_LOW"];
  // Expired / no-setup cards never show stale plan geometry.
  const hasPlan = LIVE.includes(d.setupStatus) && entry != null && d.structuralStop != null && d.structuralStop < entry;

  const headline = printed
    ? `${d.symbol} printed a ${setupName(d.setupType).toLowerCase()} — practice plan is ready (grade ${d.cardGrade.replace(/_/g, " ")}).`
    : `${d.symbol}: ${label}. ${d.nextAction}`;

  const sections: SummarySection[] = [];

  sections.push({
    title: "Bottom line",
    lines: [
      `Unified status: ${label} · grade ${d.cardGrade.replace(/_/g, " ")} · ${d.userMode.toLowerCase()} mode, ${d.signalMode.toLowerCase()} signals.`,
      `Next step: ${d.nextAction}`,
    ],
  });

  const setupLines = [
    `Setup: ${setupName(d.setupType)}${d.setupTimeframe ? ` on the ${d.setupTimeframe}` : ""}${d.setupTimestamp ? ` (printed ${new Date(d.setupTimestamp).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} CT)` : ""}.`,
    ...d.whyThisPrinted.filter((x) => !/^also evaluated/i.test(x)).slice(0, 4).map((x) => `Why it printed: ${x}`),
  ];
  sections.push({ title: "The setup", lines: setupLines });

  sections.push({
    title: "Market context",
    lines: [
      `Weekly regime ${d.weeklyRegime}${d.weeklyReclaimForming ? " (reclaim forming this week)" : ""} · daily ${d.dailyRegime.replace(/_/g, " ").toLowerCase()}.`,
      `Price ${$(d.currentPrice)} · volume ${d.volumeCondition.toLowerCase()} · ${d.isExtended ? `extended ${pct(d.extensionPercentAboveTrigger)} above trigger${d.extensionAtr != null ? ` (${d.extensionAtr.toFixed(2)} ATR)` : ""} — do not chase` : "not extended"}.`,
      ...(d.supportZone ? [`Support ${$(d.supportZone.low)}–${$(d.supportZone.high)}${d.resistanceZone ? ` · resistance ${$(d.resistanceZone.low)}–${$(d.resistanceZone.high)}` : ""}.`] : []),
    ],
  });

  if (hasPlan) {
    sections.push({
      title: printed ? "The practice plan" : "Plan levels (reference until confirmed)",
      lines: [
        `Entry ${$(entry)}${d.originalTrigger != null && d.entryPrice != null && d.originalTrigger !== d.entryPrice ? ` (trigger ${$(d.originalTrigger)})` : ""} · stop ${$(d.structuralStop)}${d.stopBuffer != null ? ` (incl. ${$(d.stopBuffer)} buffer)` : ""} · risk ${$(d.riskPerShare)}/share.`,
        `Target 1 ${$(d.target1)} (${d.rewardRiskT1 ?? "—"}R${d.target1Source ? `, ${d.target1Source}` : ""}) · Target 2 ${$(d.target2)} (${d.rewardRiskT2 ?? "—"}R${d.target2Source ? `, ${d.target2Source}` : ""}).`,
        ...(d.suggestedShares != null ? [`Sizing reference: ${d.suggestedShares} shares keeps risk inside your $${d.maxDollarRisk} max (informational only).`] : []),
        "Management reference: at T1 trim about half and move the stop to breakeven; let the rest work toward T2 or trail the 20-SMA.",
      ],
    });
  }

  const gaps = printed ? d.passedRules.slice(0, 6).map((x) => `✓ ${x}`) : (d.whyNotReady.length ? d.whyNotReady : d.missingConditions).slice(0, 5);
  if (gaps.length) sections.push({ title: printed ? "Checks that passed" : "What still has to happen", lines: gaps });

  if (d.invalidation.length) sections.push({ title: "What invalidates it", lines: d.invalidation.slice(0, 4) });

  if (coach) {
    sections.push({
      title: "AI coach read (supporting context)",
      lines: [coach.headline, ...coach.bullets.slice(0, 4), "If the coach and the unified status ever differ, the unified status wins."],
    });
  }

  const brokerStep = printed && hasPlan ? [
    `This card has printed. If you decide to act, open your broker and enter the order yourself — this app never places orders.`,
    `Re-check the live price first: only consider it near ${$(entry)}; if price has run well past the trigger, skip it rather than chase.`,
    `Reference bracket: buy near ${$(entry)}, protective stop ${$(d.structuralStop)}, profit target ${$(d.target1)} (T1)${d.target2 != null ? `, runner toward ${$(d.target2)} (T2)` : ""}.`,
    `After you place it, save it here as a Practice Trade Plan so the outcome lands in your journal.`,
  ] : null;

  const warnings = [PRACTICE_BANNER, GAP_RISK_WARNING, ...(d.riskLabel ? [d.riskLabel] : [])];

  const text = [
    `${d.symbol} — TRADE SUMMARY`,
    headline,
    ...(brokerStep ? ["", "BROKER STEP", ...brokerStep.map((x) => `- ${x}`)] : []),
    ...sections.flatMap((s) => ["", s.title.toUpperCase(), ...s.lines.map((x) => `- ${x}`)]),
    "",
    ...warnings,
  ].join("\n");

  return { symbol: d.symbol, status: d.setupStatus, headline, printed, brokerStep, sections, warnings, text };
}
