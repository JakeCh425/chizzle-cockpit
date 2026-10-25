// ============================================================================
//  US Equity Market Hours & Holiday Calendar Engine
//  NYSE / NASDAQ Regular Trading Hours: Monday–Friday 09:30–16:00 US Eastern Time
// ============================================================================

export type MarketSessionType = "REGULAR" | "PRE" | "POST" | "WEEKEND" | "HOLIDAY" | "CLOSED";

export interface MarketStatusInfo {
  isOpen: boolean;
  session: MarketSessionType;
  label: string;
  statusBadgeText: string;
  dotColor: string;
  tone: string;
  reason?: string;
}

/**
 * Calculates Easter Sunday for a given year using the Anonymous Gregorian algorithm.
 * Returns month (1-indexed: 3 = March, 4 = April) and day.
 */
export function getEasterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/**
 * Finds the day of the month for the N-th occurrence of a weekday in a given month.
 * month: 1-indexed (1 = Jan, 12 = Dec).
 * dayOfWeek: 0 = Sun, 1 = Mon, ... 6 = Sat.
 */
function nthWeekdayOfMonth(year: number, month1Indexed: number, dayOfWeek: number, n: number): number {
  const d = new Date(Date.UTC(year, month1Indexed - 1, 1));
  let count = 0;
  while (d.getUTCMonth() === month1Indexed - 1) {
    if (d.getUTCDay() === dayOfWeek) {
      count++;
      if (count === n) return d.getUTCDate();
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return -1;
}

/**
 * Finds the day of the month for the last occurrence of a weekday in a given month.
 * month: 1-indexed (1 = Jan, 12 = Dec).
 * dayOfWeek: 0 = Sun, 1 = Mon, ... 6 = Sat.
 */
function lastWeekdayOfMonth(year: number, month1Indexed: number, dayOfWeek: number): number {
  const d = new Date(Date.UTC(year, month1Indexed, 0));
  while (d.getUTCDay() !== dayOfWeek) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return d.getUTCDate();
}

/**
 * Returns observed holiday month and day for fixed holidays:
 * If a holiday falls on Saturday, it is observed on the preceding Friday.
 * If a holiday falls on Sunday, it is observed on the following Monday.
 */
function getObservedFixedHoliday(year: number, month1Indexed: number, day: number): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(year, month1Indexed - 1, day));
  const dow = d.getUTCDay();
  if (dow === 0) {
    // Sunday -> Monday
    return { year, month: month1Indexed, day: day + 1 };
  }
  if (dow === 6) {
    // Saturday -> Friday before
    if (month1Indexed === 1 && day === 1) {
      return { year: year - 1, month: 12, day: 31 };
    }
    return { year, month: month1Indexed, day: day - 1 };
  }
  return { year, month: month1Indexed, day };
}

/**
 * Checks whether the given date (in US Eastern calendar date) is an official US Equity Market Holiday.
 * Covers: New Year's Day, MLK Day, Washington's Birthday/Presidents' Day, Good Friday,
 * Memorial Day, Juneteenth, Independence Day, Labor Day, Thanksgiving Day, Christmas Day.
 */
export function isUSMarketHoliday(year: number, month: number, day: number): boolean {
  // 1. New Year's Day (Jan 1 observed)
  const newYear = getObservedFixedHoliday(year, 1, 1);
  if (newYear.month === month && newYear.day === day) return true;
  // If next year's Jan 1 is on a Saturday, Dec 31 of current year is the observed holiday
  if (month === 12 && day === 31) {
    const nextNY = getObservedFixedHoliday(year + 1, 1, 1);
    if (nextNY.year === year && nextNY.month === 12 && nextNY.day === 31) return true;
  }

  // 2. Martin Luther King Jr. Day (3rd Monday in January)
  if (month === 1 && day === nthWeekdayOfMonth(year, 1, 1, 3)) return true;

  // 3. Washington's Birthday / Presidents' Day (3rd Monday in February)
  if (month === 2 && day === nthWeekdayOfMonth(year, 2, 1, 3)) return true;

  // 4. Good Friday (Friday before Easter Sunday)
  const easter = getEasterSunday(year);
  const easterDate = new Date(Date.UTC(year, easter.month - 1, easter.day));
  easterDate.setUTCDate(easterDate.getUTCDate() - 2);
  if (month === easterDate.getUTCMonth() + 1 && day === easterDate.getUTCDate()) return true;

  // 5. Memorial Day (Last Monday in May)
  if (month === 5 && day === lastWeekdayOfMonth(year, 5, 1)) return true;

  // 6. Juneteenth National Independence Day (June 19 observed)
  const juneteenth = getObservedFixedHoliday(year, 6, 19);
  if (juneteenth.month === month && juneteenth.day === day) return true;

  // 7. Independence Day (July 4 observed)
  const july4 = getObservedFixedHoliday(year, 7, 4);
  if (july4.month === month && july4.day === day) return true;

  // 8. Labor Day (1st Monday in September)
  if (month === 9 && day === nthWeekdayOfMonth(year, 9, 1, 1)) return true;

  // 9. Thanksgiving Day (4th Thursday in November)
  if (month === 11 && day === nthWeekdayOfMonth(year, 11, 4, 4)) return true;

  // 10. Christmas Day (December 25 observed)
  const xmas = getObservedFixedHoliday(year, 12, 25);
  if (xmas.month === month && xmas.day === day) return true;

  return false;
}

export interface EtTimeParts {
  year: number;
  month: number;
  day: number;
  weekday: string;
  hour: number;
  minute: number;
  second: number;
  totalSeconds: number;
  isWeekend: boolean;
  isHoliday: boolean;
}

/**
 * Extracts wall-clock Eastern Time parts for a given Date.
 */
export function getEtTimeParts(now: Date = new Date()): EtTimeParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday");
  const isWeekend = weekday === "Sat" || weekday === "Sun";

  const year = parseInt(get("year"), 10) || now.getFullYear();
  const month = parseInt(get("month"), 10) || (now.getMonth() + 1);
  const day = parseInt(get("day"), 10) || now.getDate();
  const hour = parseInt(get("hour"), 10) || 0;
  const minute = parseInt(get("minute"), 10) || 0;
  const second = parseInt(get("second"), 10) || 0;

  const isHoliday = isUSMarketHoliday(year, month, day);
  const totalSeconds = hour * 3600 + minute * 60 + second;

  return {
    year,
    month,
    day,
    weekday,
    hour,
    minute,
    second,
    totalSeconds,
    isWeekend,
    isHoliday,
  };
}

/**
 * Main Utility Function:
 * Checks whether US Equity Markets (NYSE / NASDAQ) are currently open for Regular Trading Hours.
 * Regular Hours: Monday through Friday, 9:30 AM to 4:00 PM US Eastern Time.
 * Returns false on weekends, market holidays, pre-market, and after-hours/overnight.
 */
export function isMarketOpen(now: Date = new Date()): boolean {
  const et = getEtTimeParts(now);
  if (et.isWeekend || et.isHoliday) {
    return false;
  }
  // 9:30 AM = 9 * 3600 + 30 * 60 = 34,200 seconds
  // 4:00 PM = 16 * 3600 = 57,600 seconds
  return et.totalSeconds >= 34200 && et.totalSeconds < 57600;
}

/**
 * Returns comprehensive market session classification and UI telemetry metadata.
 */
export function getMarketStatus(now: Date = new Date()): MarketStatusInfo {
  const et = getEtTimeParts(now);

  if (et.isWeekend) {
    return {
      isOpen: false,
      session: "WEEKEND",
      label: "WEEKEND: MARKET CLOSED",
      statusBadgeText: "STATIC: LAST CLOSE",
      dotColor: "bg-slate-400",
      tone: "text-slate-300 border-slate-700/60 bg-slate-900/80 shadow-[0_0_8px_rgba(148,163,184,0.15)]",
      reason: "Weekend (Saturday/Sunday)",
    };
  }

  if (et.isHoliday) {
    return {
      isOpen: false,
      session: "HOLIDAY",
      label: "HOLIDAY: MARKET CLOSED",
      statusBadgeText: "STATIC: LAST CLOSE",
      dotColor: "bg-slate-400",
      tone: "text-slate-300 border-slate-700/60 bg-slate-900/80 shadow-[0_0_8px_rgba(148,163,184,0.15)]",
      reason: "US Market Holiday",
    };
  }

  // Regular Trading Hours: 9:30 AM to 4:00 PM ET
  if (et.totalSeconds >= 34200 && et.totalSeconds < 57600) {
    return {
      isOpen: true,
      session: "REGULAR",
      label: "MARKET OPEN",
      statusBadgeText: "LIVE",
      dotColor: "bg-emerald-400",
      tone: "text-emerald-300 border-emerald-400/50 bg-emerald-950/60 shadow-[0_0_12px_rgba(52,211,153,0.2)]",
    };
  }

  // Pre-Market: 4:00 AM to 9:30 AM ET
  if (et.totalSeconds >= 14400 && et.totalSeconds < 34200) {
    return {
      isOpen: false,
      session: "PRE",
      label: "PRE-MARKET",
      statusBadgeText: "STATIC: LAST CLOSE",
      dotColor: "bg-blue-400",
      tone: "text-blue-300 border-blue-500/40 bg-blue-950/40 shadow-[0_0_8px_rgba(96,165,250,0.15)]",
      reason: "Pre-Market Session (Regular Hours Open at 9:30 AM ET)",
    };
  }

  // After-Hours / Post-Market: 4:00 PM to 8:00 PM ET
  if (et.totalSeconds >= 57600 && et.totalSeconds < 72000) {
    return {
      isOpen: false,
      session: "POST",
      label: "AFTER-HOURS",
      statusBadgeText: "STATIC: LAST CLOSE",
      dotColor: "bg-blue-400",
      tone: "text-blue-300 border-blue-500/40 bg-blue-950/40 shadow-[0_0_8px_rgba(96,165,250,0.15)]",
      reason: "After-Hours Session (Regular Hours Closed at 4:00 PM ET)",
    };
  }

  // Overnight Closed
  return {
    isOpen: false,
    session: "CLOSED",
    label: "OFFLINE: MARKET CLOSED",
    statusBadgeText: "STATIC: LAST CLOSE",
    dotColor: "bg-slate-400",
    tone: "text-slate-300 border-slate-700/60 bg-slate-900/80 shadow-[0_0_8px_rgba(148,163,184,0.15)]",
    reason: "Overnight Closed",
  };
}
