/**
 * Schedule builders.
 *
 * Every rule in the catalog declares its dates through one of these, so the
 * awkward parts of Indian statutory timing — financial years that straddle two
 * calendar years, due dates that fall in the *next* year, quarters with
 * non-uniform lags — are solved once here instead of in forty rule files.
 */
import {
  addMonths,
  daysInMonth,
  firstFinancialYearEnd,
  fyHalves,
  fyMonths,
  fyQuarters,
  monthName,
  utcDate,
  type FinancialYear,
  type Period,
} from '../lib/dates';
import type { ComplianceContext, Occurrence } from './types';

export type OccurrenceFn = (fy: FinancialYear, ctx: ComplianceContext) => Occurrence[];

/** A date *inside* the financial year (April–March). */
export function dateInFy(fy: FinancialYear, month: number, day: number): Date {
  const year = month >= 4 ? fy.startYear : fy.endYear;
  return utcDate(year, month, Math.min(day, daysInMonth(year, month)));
}

/** A date *after* the financial year closes — where most annual filings land. */
export function dateAfterFy(fy: FinancialYear, month: number, day: number): Date {
  const year = month >= 4 ? fy.endYear : fy.endYear + 1;
  return utcDate(year, month, Math.min(day, daysInMonth(year, month)));
}

/** Same calendar day, `months` later, clamped to the shorter month. */
export function shiftMonths(d: Date, months: number, day?: number): Date {
  const base = addMonths(utcDate(d.getUTCFullYear(), d.getUTCMonth() + 1, 1), months);
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth() + 1;
  const target = day ?? d.getUTCDate();
  return utcDate(year, month, Math.min(target, daysInMonth(year, month)));
}

export function addDaysTo(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

// ------------------------------------------------------------------ builders

/** One filing per financial year, on a fixed statutory date. */
export function annual(opts: {
  month: number;
  day: number;
  /** `after` = due once the FY has closed (the common case); `within` = falls inside the FY. */
  anchor?: 'after' | 'within';
}): OccurrenceFn {
  const anchor = opts.anchor ?? 'after';
  return (fy) => [
    {
      periodKey: fy.key,
      periodLabel: fy.label,
      periodStart: fy.start,
      periodEnd: fy.end,
      dueDate: anchor === 'after' ? dateAfterFy(fy, opts.month, opts.day) : dateInFy(fy, opts.month, opts.day),
    },
  ];
}

/**
 * Annual filing pegged to the AGM date (AOC-4, MGT-7, ADT-1). When the company
 * has not recorded an AGM date we fall back to the statutory outer limit, which
 * assumes the AGM happens on the last permitted day.
 */
export function annualFromAgm(opts: {
  offsetDays: number;
  /** Outer-limit due date used when no AGM date is on record. */
  fallback: { month: number; day: number };
}): OccurrenceFn {
  return (fy, ctx) => {
    const agm = ctx.company.agmDate;
    // An AGM date is only usable for this FY if it falls after the FY closed.
    const usable = agm && agm.getTime() > fy.end.getTime() && agm.getTime() <= addMonths(fy.end, 12).getTime();

    // The first AGM gets nine months rather than six (s.96 proviso), so the
    // outer limit these filings hang off moves with it.
    const incorporatedOn = ctx.company.incorporationDate;
    const isFirstFy =
      incorporatedOn !== null && fy.end.getTime() === firstFinancialYearEnd(incorporatedOn).getTime();
    const outerLimit = isFirstFy
      ? addDaysTo(addMonths(fy.end, 9), opts.offsetDays)
      : dateAfterFy(fy, opts.fallback.month, opts.fallback.day);

    return [
      {
        periodKey: fy.key,
        periodLabel: fy.label,
        periodStart: fy.start,
        periodEnd: fy.end,
        dueDate: usable ? addDaysTo(agm!, opts.offsetDays) : outerLimit,
        metadata: {
          agmDate: usable ? agm!.toISOString().slice(0, 10) : null,
          assumedOuterLimit: !usable,
          ...(isFirstFy ? { firstFinancialYear: true } : {}),
        },
      },
    ];
  };
}

/** Twelve filings per FY. `lagMonths` is how far after the period the filing is due. */
export function monthly(opts: { day: number; lagMonths?: number }): OccurrenceFn {
  const lag = opts.lagMonths ?? 1;
  return (fy) =>
    fyMonths(fy).map((p) => ({
      periodKey: p.key,
      periodLabel: p.label,
      periodStart: p.start,
      periodEnd: p.end,
      dueDate: shiftMonths(p.start, lag, opts.day),
    }));
}

/** Four filings per FY. `due` receives the quarter and its 0-based index. */
export function quarterly(opts: { due: (period: Period, fy: FinancialYear, index: number) => Date }): OccurrenceFn {
  return (fy) =>
    fyQuarters(fy).map((p, i) => ({
      periodKey: p.key,
      periodLabel: p.label,
      periodStart: p.start,
      periodEnd: p.end,
      dueDate: opts.due(p, fy, i),
      metadata: { quarter: i + 1 },
    }));
}

/** Two filings per FY (H1 Apr–Sep, H2 Oct–Mar). */
export function halfYearly(opts: { due: (period: Period, fy: FinancialYear, index: number) => Date }): OccurrenceFn {
  return (fy) =>
    fyHalves(fy).map((p, i) => ({
      periodKey: p.key,
      periodLabel: p.label,
      periodStart: p.start,
      periodEnd: p.end,
      dueDate: opts.due(p, fy, i),
      metadata: { half: i + 1 },
    }));
}

/** Explicit dates within the FY — advance tax instalments, for example. */
export function fixedDatesInFy(
  entries: Array<{ key: string; label: string; month: number; day: number; metadata?: Record<string, unknown> }>,
): OccurrenceFn {
  return (fy) =>
    entries.map((e) => {
      const dueDate = dateInFy(fy, e.month, e.day);
      return {
        periodKey: `${fy.key}-${e.key}`,
        // The period is the financial year; the instalment is the title, so the
        // two do not repeat each other in the UI.
        periodLabel: fy.label,
        periodStart: fy.start,
        periodEnd: fy.end,
        dueDate,
        metadata: e.metadata,
        title: e.label,
      };
    });
}

/**
 * A once-in-a-lifetime filing measured from incorporation (INC-20A, first AGM).
 * Only emitted in the financial year the deadline actually falls in.
 */
export function oneTimeFromIncorporation(opts: { withinDays: number }): OccurrenceFn {
  return (fy, ctx) => {
    const inc = ctx.company.incorporationDate;
    if (!inc) return [];
    const dueDate = addDaysTo(inc, opts.withinDays);
    if (dueDate < fy.start || dueDate > fy.end) return [];
    return [
      {
        periodKey: 'ONCE',
        periodLabel: 'One-time',
        periodStart: inc,
        periodEnd: dueDate,
        dueDate,
        metadata: { incorporationDate: inc.toISOString().slice(0, 10) },
      },
    ];
  };
}

/**
 * Fans an inner schedule out across every active GST registration, so a company
 * with GSTINs in three states gets three sets of returns rather than one.
 */
export function perGstin(inner: (freq: string, stateCode: string) => OccurrenceFn): OccurrenceFn {
  return (fy, ctx) => {
    const out: Occurrence[] = [];
    for (const reg of ctx.gstRegistrations.filter((g) => g.isActive)) {
      for (const occ of inner(reg.filingFrequency, reg.stateCode)(fy, ctx)) {
        out.push({
          ...occ,
          periodKey: `${reg.gstin}:${occ.periodKey}`,
          periodLabel: `${occ.periodLabel} — ${reg.gstin}`,
          metadata: { ...occ.metadata, gstin: reg.gstin, stateCode: reg.stateCode },
        });
      }
    }
    return out;
  };
}

/** Emits nothing on a schedule — the obligation is triggered by an event. */
export const eventDriven: OccurrenceFn = () => [];

export { monthName };
