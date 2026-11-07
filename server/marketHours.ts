// ─── Central US Equity Regular Market Hours (RTH) & Holiday Engine ────────────
// Target Timezone: America/New_York (US Eastern Time)
// Regular Trading Hours: Monday through Friday strictly between 9:30 AM and 4:00 PM EST.
// Returns false on weekends, market holidays, pre-market, and after-hours/overnight.

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
function nthWeekdayOfMonth(
  year: number,
  month1Indexed: number,
  dayOfWeek: number,
  n: number
): number {
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
function lastWeekdayOfMonth(
  year: number,
  month1Indexed: number,
  dayOfWeek: number
): number {
  const d = new Date(Date.UTC(year, month1Indexed, 0));
  while (d.getUTCDay() !== dayOfWeek) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return d.getUTCDate();
}

/**
 * Returns observed holiday month and day for fixed holidays:
 * - Falls on Saturday -> observed on preceding Friday
 * - Falls on Sunday -> observed on following Monday
 */
function getObservedFixedHoliday(
  year: number,
  month1Indexed: number,
  day: number
): { year: number; month: number; day: number } {
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
 * Checks whether the given date (in US Eastern calendar date) is an official US Equity Market Holiday:
 * 1. New Year's Day (Jan 1 observed)
 * 2. Martin Luther King Jr. Day (3rd Mon in Jan)
 * 3. Washington's Birthday / Presidents' Day (3rd Mon in Feb)
 * 4. Good Friday (Friday before Easter Sunday)
 * 5. Memorial Day (Last Mon in May)
 * 6. Juneteenth National Independence Day (June 19 observed)
 * 7. Independence Day (July 4 observed)
 * 8. Labor Day (1st Mon in Sep)
 * 9. Thanksgiving Day (4th Thu in Nov)
 * 10. Christmas Day (Dec 25 observed)
 */
export function isUSMarketHoliday(year: number, month: number, day: number): boolean {
  // 1. New Year's Day
  const newYear = getObservedFixedHoliday(year, 1, 1);
  if (newYear.month === month && newYear.day === day) return true;
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
 * Extracts wall-clock Eastern Time parts for a given Date / timestamp.
 */
export function getEtTimeParts(now: Date | number = Date.now()): EtTimeParts {
  const d = typeof now === "number" ? new Date(now) : now;
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
  }).formatToParts(d);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday");
  const isWeekend = weekday === "Sat" || weekday === "Sun";

  const year = parseInt(get("year"), 10) || d.getFullYear();
  const month = parseInt(get("month"), 10) || d.getMonth() + 1;
  const day = parseInt(get("day"), 10) || d.getDate();
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
 * Central Gatekeeper:
 * Checks whether US Equity Markets (NYSE / NASDAQ) are currently in Regular Trading Hours (RTH).
 * - Target timezone: America/New_York (US Eastern Time).
 * - Trading window: Monday through Friday, strictly between 9:30 AM EST and 4:00 PM EST.
 *   (34,200 seconds to 57,600 seconds)
 * - Returns false on Saturdays, Sundays, market holidays, pre-market (< 9:30 AM),
 *   and after-hours / overnight (>= 4:00 PM EST, e.g. 5:18 PM CT).
 */
export function isRegularMarketHours(now: Date | number = Date.now()): boolean {
  const et = getEtTimeParts(now);
  if (et.isWeekend || et.isHoliday) {
    return false;
  }
  // 9:30:00 AM = 9 * 3600 + 30 * 60 = 34,200 seconds
  // 4:00:00 PM = 16 * 3600 = 57,600 seconds
  return et.totalSeconds >= 34200 && et.totalSeconds < 57600;
}

