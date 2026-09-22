/**
 * Date helpers for Indian statutory compliance in Deno Edge Functions.
 */

export const MS_PER_DAY = 86_400_000;

export function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

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

export function diffDays(a: Date, b: Date): number {
  return Math.round((toDateOnly(b).getTime() - toDateOnly(a).getTime()) / MS_PER_DAY);
}

export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function formatDateISO(d: Date): string {
  return formatDate(d);
}

export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`Invalid date: ${s}`);
  return utcDate(y, m, d);
}

export function parseDmyDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return utcDate(year, month, day);
}

export function today(): Date {
  return toDateOnly(new Date());
}

export interface FinancialYear {
  startYear: number;
  endYear: number;
  key: string;
  label: string;
  start: Date;
  end: Date;
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

export function financialYearOf(date: Date): FinancialYear {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  return financialYearFromStartYear(m >= 4 ? y : y - 1);
}

export interface Period {
  key: string;
  label: string;
  start: Date;
  end: Date;
}

export function fyQuarters(fy: FinancialYear): Period[] {
  return [1, 2, 3, 4].map((q) => {
    const startMonthOffset = (q - 1) * 3;
    const start = addMonths(fy.start, startMonthOffset);
    const endMonthDate = addMonths(fy.start, startMonthOffset + 2);
    const end = endOfMonth(endMonthDate.getUTCFullYear(), endMonthDate.getUTCMonth() + 1);
    return { key: `${fy.key}-Q${q}`, label: `${fy.label} Q${q}`, start, end };
  });
}

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

export function financialYearsBetween(from: Date, to: Date): FinancialYear[] {
  const first = financialYearOf(from).startYear;
  const last = financialYearOf(to).startYear;
  const out: FinancialYear[] = [];
  for (let y = first; y <= last; y += 1) out.push(financialYearFromStartYear(y));
  return out;
}

export function firstFinancialYearEnd(incorporatedOn: Date): Date {
  const fy = financialYearOf(incorporatedOn);
  const month = incorporatedOn.getUTCMonth() + 1;
  return month <= 3 ? utcDate(fy.endYear + 1, 3, 31) : fy.end;
}
