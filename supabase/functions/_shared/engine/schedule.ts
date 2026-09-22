// supabase/functions/_shared/engine/schedule.ts
import {
  addMonths,
  daysInMonth,
  firstFinancialYearEnd,
  fyHalves,
  fyMonths,
  fyQuarters,
  monthName,
  today,
  utcDate,
  type FinancialYear,
  type Period,
} from '../dates.ts';
import type { ComplianceContext, Occurrence } from './types.ts';

export type OccurrenceFn = (fy: FinancialYear, ctx: ComplianceContext) => Occurrence[];

export function dateInFy(fy: FinancialYear, month: number, day: number): Date {
  const year = month >= 4 ? fy.startYear : fy.endYear;
  return utcDate(year, month, Math.min(day, daysInMonth(year, month)));
}

export function dateAfterFy(fy: FinancialYear, month: number, day: number): Date {
  const year = month >= 4 ? fy.endYear : fy.endYear + 1;
  return utcDate(year, month, Math.min(day, daysInMonth(year, month)));
}

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

export function annual(opts: {
  month: number;
  day: number;
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

export function annualFromAgm(opts: {
  offsetDays: number;
  fallback: { month: number; day: number };
}): OccurrenceFn {
  return (fy, ctx) => {
    const agm = ctx.company.agmDate;
    const usable = agm && agm.getTime() > fy.end.getTime() && agm.getTime() <= addMonths(fy.end, 12).getTime();

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

export function monthly(opts: { day: number; lagMonths?: number }): OccurrenceFn {
  const lag = opts.lagMonths ?? 1;
  return (fy) =>
    fyMonths(fy).map((p: Period) => ({
      periodKey: p.key,
      periodLabel: p.label,
      periodStart: p.start,
      periodEnd: p.end,
      dueDate: shiftMonths(p.start, lag, opts.day),
    }));
}

export function quarterly(opts: { due: (period: Period, fy: FinancialYear, index: number) => Date }): OccurrenceFn {
  return (fy) =>
    fyQuarters(fy).map((p: Period, i: number) => ({
      periodKey: p.key,
      periodLabel: p.label,
      periodStart: p.start,
      periodEnd: p.end,
      dueDate: opts.due(p, fy, i),
      metadata: { quarter: i + 1 },
    }));
}

export function halfYearly(opts: { due: (period: Period, fy: FinancialYear, index: number) => Date }): OccurrenceFn {
  return (fy) =>
    fyHalves(fy).map((p: Period, i: number) => ({
      periodKey: p.key,
      periodLabel: p.label,
      periodStart: p.start,
      periodEnd: p.end,
      dueDate: opts.due(p, fy, i),
      metadata: { half: i + 1 },
    }));
}

export function fixedDatesInFy(
  entries: Array<{ key: string; label: string; month: number; day: number; metadata?: Record<string, unknown> }>,
): OccurrenceFn {
  return (fy) =>
    entries.map((e) => {
      const dueDate = dateInFy(fy, e.month, e.day);
      return {
        periodKey: `${fy.key}-${e.key}`,
        periodLabel: fy.label,
        periodStart: fy.start,
        periodEnd: fy.end,
        dueDate,
        metadata: e.metadata,
        title: e.label,
      };
    });
}

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

export const eventDriven: OccurrenceFn = () => [];

export const REGISTRATION_GRACE_DAYS = 30;

export function registrationReminder(): OccurrenceFn {
  return (fy) => {
    const now = today();
    if (now < fy.start || now > fy.end) return [];
    return [
      {
        periodKey: 'REGISTER',
        periodLabel: 'Registration',
        periodStart: fy.start,
        periodEnd: fy.end,
        dueDate: addDaysTo(now, REGISTRATION_GRACE_DAYS),
      },
    ];
  };
}

export { monthName };
