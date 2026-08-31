/**
 * Date helpers for Indian statutory compliance.
 *
 * Every date the engine produces is a *calendar date*, not an instant: due dates
 * are legal dates, not timestamps. We represent them as UTC-midnight `Date`s,
 * which is exactly how Prisma maps a Postgres `date` column. That keeps the
 * server's own timezone out of the arithmetic entirely.
 */

export const MS_PER_DAY = 86_400_000;

/** Build a UTC-midnight date. `month` is 1-based (1 = January). */
export function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

/** Strip the time component, keeping the UTC calendar date. */
export function toDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * MS_PER_DAY);
}

export function addMonths(d: Date, months: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const day = d.getUTCDate();
  const lastDay = daysInMonth(y + Math.floor(m / 12), (((m % 12) + 12) % 12) + 1);
  return new Date(Date.UTC(y, m, Math.min(day, lastDay)));
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function endOfMonth(year: number, month: number): Date {
  return utcDate(year, month, daysInMonth(year, month));
}

/** Whole days from `a` to `b`. Negative when `b` is in the past. */
export function diffDays(a: Date, b: Date): number {
  return Math.round((toDateOnly(b).getTime() - toDateOnly(a).getTime()) / MS_PER_DAY);
}

/** `2025-08-29` */
export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`Invalid date: ${s}`);
  return utcDate(y, m, d);
}

/** Today, as a UTC-midnight calendar date. */
export function today(): Date {
  return toDateOnly(new Date());
}

// ------------------------------------------------------------------ Indian FY

/** The Indian financial year runs 1 April → 31 March. */
export interface FinancialYear {
  /** 2025 for FY2025-26 */
  startYear: number;
  endYear: number;
  /** "FY2025-26" — also used as the period idempotency key */
  key: string;
  label: string;
  start: Date;
  end: Date;
  /** Assessment Year label, e.g. "AY2026-27" */
  assessmentYear: string;
}

export function financialYearFromStartYear(startYear: number): FinancialYear {
  const endYear = startYear + 1;
  const shortEnd = String(endYear).slice(-2);
  return {
    startYear,
    endYear,
    key: `FY${startYear}-${shortEnd}`,
    label: `FY ${startYear}-${shortEnd}`,
    start: utcDate(startYear, 4, 1),
    end: utcDate(endYear, 3, 31),
    assessmentYear: `AY${endYear}-${String(endYear + 1).slice(-2)}`,
  };
}

/** The FY that contains `date`. */
export function financialYearOf(date: Date): FinancialYear {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1; // 1-based
  return financialYearFromStartYear(m >= 4 ? y : y - 1);
}

export interface Period {
  key: string;
  label: string;
  start: Date;
  end: Date;
}

/** Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec, Q4 Jan–Mar. */
export function fyQuarters(fy: FinancialYear): Period[] {
  return [1, 2, 3, 4].map((q) => {
    const startMonthOffset = (q - 1) * 3; // 0,3,6,9 from April
    const start = addMonths(fy.start, startMonthOffset);
    const endMonthDate = addMonths(fy.start, startMonthOffset + 2);
    const end = endOfMonth(endMonthDate.getUTCFullYear(), endMonthDate.getUTCMonth() + 1);
    return { key: `${fy.key}-Q${q}`, label: `${fy.label} Q${q}`, start, end };
  });
}

/** H1 Apr–Sep, H2 Oct–Mar. */
export function fyHalves(fy: FinancialYear): Period[] {
  return [1, 2].map((h) => {
    const start = addMonths(fy.start, (h - 1) * 6);
    const endMonthDate = addMonths(fy.start, (h - 1) * 6 + 5);
    const end = endOfMonth(endMonthDate.getUTCFullYear(), endMonthDate.getUTCMonth() + 1);
    return { key: `${fy.key}-H${h}`, label: `${fy.label} H${h}`, start, end };
  });
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

export function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? String(month);
}

/** The 12 calendar months of a financial year, April first. */
export function fyMonths(fy: FinancialYear): Period[] {
  return Array.from({ length: 12 }, (_, i) => {
    const start = addMonths(fy.start, i);
    const year = start.getUTCFullYear();
    const month = start.getUTCMonth() + 1;
    return {
      key: `${year}-${String(month).padStart(2, '0')}`,
      label: `${monthName(month)} ${year}`,
      start,
      end: endOfMonth(year, month),
    };
  });
}

/** Financial years overlapping [from, to], inclusive. */
export function financialYearsBetween(from: Date, to: Date): FinancialYear[] {
  const first = financialYearOf(from).startYear;
  const last = financialYearOf(to).startYear;
  const out: FinancialYear[] = [];
  for (let y = first; y <= last; y += 1) out.push(financialYearFromStartYear(y));
  return out;
}

/**
 * The end of a company's *first* financial year.
 *
 * Section 2(41) of the Companies Act lets a company incorporated between
 * 1 January and 31 March close its first accounts on 31 March of the
 * *following* year, so a first financial year can run up to fifteen months.
 * A company incorporated in February 2026 therefore has no FY2025-26 accounts
 * at all — its first are made up to 31 March 2027.
 *
 * This is why it is not enough to filter obligations by the incorporation date:
 * an annual filing for a period that overlaps incorporation can still be one
 * the company never has to make.
 */
export function firstFinancialYearEnd(incorporatedOn: Date): Date {
  const fy = financialYearOf(incorporatedOn);
  const month = incorporatedOn.getUTCMonth() + 1;
  return month <= 3 ? utcDate(fy.endYear + 1, 3, 31) : fy.end;
}
