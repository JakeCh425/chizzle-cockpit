// PR 3c — Grades (spec §J) + signal/user mode matrix (spec §D, §E). Pure.
// Called only for a candidate that already passed the mechanical READY checks
// (confirmed setup, closed 1H or early trigger, not extended, valid stop, R:R pass, data OK).
// Decides whether the current mode allows it to be READY and at what grade.
import {
  FLEX_RISK_LABEL, type CardGrade, type DailyRegime, type SetupStatus, type SetupType, type SignalMode,
  type SwingSettings, type UserMode, type VolumeCondition, type WeeklyRegime,
} from "@shared/swingDecision";

export interface GradeInput {
  signalMode: SignalMode;
  userMode: UserMode;
  settings: Pick<SwingSettings, "allowCountertrend" | "requireVolume" | "requireWeeklyAlignment" | "requireDailyAlignment" | "allowEarlyTrigger"> & Partial<Pick<SwingSettings, "a2SetupScope">>;
  weekly: WeeklyRegime;
  daily: DailyRegime;
  dailyImproving: boolean;
  setupType: SetupType;
  earlyTrigger: boolean;     // price above trigger on a DEVELOPING 1H bar (no closed confirmation)
  volume: VolumeCondition;
}

export interface GradeResult {
  ok: boolean;
  grade: CardGrade;
  riskLabel: string;
  passed: string[];
  reasons: string[];         // why it cannot be READY in this mode (empty when ok)
}

export const RISK_LABEL: Record<"A4_CORE" | "A3_SWING", string> = {
  A4_CORE: "A4 CORE SWING — STANDARD PRACTICE RISK",
  A3_SWING: "A3 SWING — STANDARD PRACTICE RISK",
};

const aligned = (d: DailyRegime) => d === "RECLAIMED" || d === "PULLBACK_VALID";
const weeklyOk = (w: WeeklyRegime) => w === "GREEN" || w === "NEUTRAL";

/** Early Trigger is only ever available in Flexible signal mode or Learn user mode, when enabled.
 *  Practice and Disciplined use completed-candle confirmation only. */
export function earlyTriggerAllowed(g: Pick<GradeInput, "signalMode" | "userMode" | "settings">): boolean {
  if (!g.settings.allowEarlyTrigger) return false;
  if (g.userMode === "PRACTICE" || g.userMode === "DISCIPLINED") return false;
  return g.signalMode === "FLEXIBLE" || g.userMode === "LEARN";
}

/** §J A2 list — used only when a2SetupScope = SPEC_LIST. Default scope is ALL 8 setups. */
export const A2_SPEC_TYPES: SetupType[] = ["AGGRESSIVE_BOUNCE", "STRONG_BULL_BAR", "RECLAIM_MOMENTUM_CONTINUATION", "FIRST_PULLBACK_AFTER_BREAKOUT", "HIGHER_LOW_CONSOLIDATION"];

export function gradeReady(g: GradeInput): GradeResult {
  const passed: string[] = [], reasons: string[] = [];
  const reg = `Weekly ${g.weekly} / Daily ${g.daily}${g.dailyImproving ? " (improving)" : ""}`;
  const countertrend = g.weekly === "RED";
  const a4 = weeklyOk(g.weekly) && aligned(g.daily) && !g.earlyTrigger;
  const a3 = weeklyOk(g.weekly) && (aligned(g.daily) || (g.daily === "NEUTRAL" && g.dailyImproving)) && !g.earlyTrigger;
  const a2Mode = g.signalMode === "FLEXIBLE" || g.userMode === "LEARN";
  let grade: CardGrade = "WATCH";

  if (g.earlyTrigger && !earlyTriggerAllowed(g)) reasons.push("Early Trigger is off (or not allowed in this mode) — wait for a CLOSED 1H above the trigger");

  switch (g.signalMode) {
    case "STRICT": {
      if (!(g.weekly === "GREEN" || aligned(g.daily))) reasons.push(`Strict needs Weekly GREEN or Daily RECLAIMED/PULLBACK_VALID (${reg})`);
      if (countertrend) reasons.push("Strict never shows countertrend Ready cards (Weekly RED)");
      if (g.volume !== "PASS") reasons.push(`Strict requires elevated volume (volume ${g.volume})`);
      if (g.earlyTrigger) reasons.push("Strict requires a closed 1H confirmation");
      if (!a4) reasons.push(`Strict is A4-only: needs Weekly GREEN/NEUTRAL + Daily RECLAIMED/PULLBACK_VALID (${reg})`);
      if (!reasons.length) grade = "A4_CORE";
      break;
    }
    case "STANDARD": {
      if (g.earlyTrigger) { if (!reasons.length) reasons.push("Standard requires a closed 1H confirmation"); break; }
      if (a4) grade = "A4_CORE";
      else if (a3) grade = "A3_SWING";
      else if (countertrend || g.daily === "RED") {
        if (g.settings.allowCountertrend) grade = "A2_PRACTICE";
        else reasons.push(`countertrend (${reg}) — Standard allows only A2 countertrend cards, and "Allow countertrend" is off`);
      } else if (g.userMode === "LEARN") grade = "A2_PRACTICE";
      else reasons.push(`Standard needs Weekly GREEN/NEUTRAL + Daily RECLAIMED, PULLBACK_VALID or improving NEUTRAL (${reg})`);
      break;
    }
    case "FLEXIBLE": {
      if (countertrend && !g.settings.allowCountertrend) { reasons.push(`Weekly RED — countertrend practice cards are off ("Allow countertrend")`); break; }
      if (reasons.length) break; // early trigger not allowed
      grade = a4 ? "A4_CORE" : "A2_PRACTICE"; // never A4 unless A4 rules pass independently
      break;
    }
  }
  if (grade === "A2_PRACTICE" && (g.settings.a2SetupScope ?? "ALL") === "SPEC_LIST" && !A2_SPEC_TYPES.includes(g.setupType)) {
    reasons.push(`A2 is limited to the §J setup list and ${g.setupType} is not on it ("A2 setup scope")`); grade = "WATCH";
  }
  if (grade === "A2_PRACTICE" && !a2Mode && !(g.signalMode === "STANDARD" && g.settings.allowCountertrend)) {
    reasons.push("A2 practice cards need Flexible signal mode or Learn user mode"); grade = "WATCH";
  }

  // User alignment toggles (spec §D settings) apply on top of the mode.
  if (reasons.length === 0) {
    if (g.settings.requireWeeklyAlignment && g.weekly !== "GREEN") reasons.push(`"Require weekly alignment" is on and Weekly is ${g.weekly}`);
    if (g.settings.requireDailyAlignment && !aligned(g.daily)) reasons.push(`"Require daily alignment" is on and Daily is ${g.daily}`);
    if (g.settings.requireVolume && g.volume !== "PASS") reasons.push(`"Require volume" is on and volume is ${g.volume}`);
  }
  const ok = reasons.length === 0 && grade !== "WATCH";
  if (!ok) return { ok: false, grade: "WATCH", riskLabel: "WATCH — NOT A PRACTICE ENTRY", passed, reasons };

  passed.push(`${g.signalMode} mode gate passed (${reg})`);
  if (g.volume === "PASS") passed.push("volume elevated");
  else if (g.signalMode === "STANDARD") passed.push(`volume ${g.volume} (preferred, not required in Standard)`);
  const riskLabel = grade === "A2_PRACTICE" ? FLEX_RISK_LABEL + (g.earlyTrigger ? " · EARLY TRIGGER" : "") : RISK_LABEL[grade as "A4_CORE" | "A3_SWING"];
  return { ok, grade, riskLabel, passed, reasons };
}

/** Card visibility per user mode (spec §D). Hidden cards are still evaluated and logged. */
export function cardVisible(opts: {
  status: SetupStatus; userMode: UserMode; showFormingCards: boolean; showWatchCards: boolean;
  showLowQualityForming?: boolean; weekly: WeeklyRegime; daily: DailyRegime; dailyImproving: boolean;
}): { visible: boolean; why: string | null } {
  const s = opts.status;
  if (s === "SETUP_FORMING") {
    if (!opts.showFormingCards) return { visible: false, why: `"Show forming cards" is off` };
    const lowQuality = opts.weekly === "RED" || !(aligned(opts.daily) || (opts.daily === "NEUTRAL" && opts.dailyImproving));
    if (opts.userMode === "DISCIPLINED" && lowQuality && !opts.showLowQualityForming)
      return { visible: false, why: `Disciplined mode hides low-quality forming cards (Weekly ${opts.weekly} / Daily ${opts.daily})` };
  }
  if (s.startsWith("WATCH_") && !opts.showWatchCards) return { visible: false, why: `"Show watch cards" is off` };
  return { visible: true, why: null };
}
