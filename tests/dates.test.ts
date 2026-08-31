import { describe, expect, it } from 'vitest';
import {
  addMonths,
  diffDays,
  financialYearFromStartYear,
  financialYearOf,
  formatDate,
  fyHalves,
  fyMonths,
  fyQuarters,
  parseDate,
} from '../src/lib/dates';

describe('Indian financial year', () => {
  it('runs 1 April to 31 March', () => {
    const fy = financialYearFromStartYear(2025);
    expect(fy.key).toBe('FY2025-26');
    expect(formatDate(fy.start)).toBe('2025-04-01');
    expect(formatDate(fy.end)).toBe('2026-03-31');
    expect(fy.assessmentYear).toBe('AY2026-27');
  });

  it('places March in the previous financial year and April in the next', () => {
    expect(financialYearOf(parseDate('2026-03-31')).key).toBe('FY2025-26');
    expect(financialYearOf(parseDate('2026-04-01')).key).toBe('FY2026-27');
  });

  it('splits the year into quarters starting in April', () => {
    const q = fyQuarters(financialYearFromStartYear(2025));
    expect(q.map((p) => formatDate(p.start))).toEqual(['2025-04-01', '2025-07-01', '2025-10-01', '2026-01-01']);
    expect(q.map((p) => formatDate(p.end))).toEqual(['2025-06-30', '2025-09-30', '2025-12-31', '2026-03-31']);
  });

  it('splits the year into halves', () => {
    const h = fyHalves(financialYearFromStartYear(2025));
    expect(h.map((p) => `${formatDate(p.start)}..${formatDate(p.end)}`)).toEqual([
      '2025-04-01..2025-09-30',
      '2025-10-01..2026-03-31',
    ]);
  });

  it('produces twelve months, April first, with correct period keys', () => {
    const m = fyMonths(financialYearFromStartYear(2025));
    expect(m).toHaveLength(12);
    expect(m[0]!.key).toBe('2025-04');
    expect(m[11]!.key).toBe('2026-03');
    expect(formatDate(m[11]!.end)).toBe('2026-03-31');
  });
});

describe('date arithmetic', () => {
  it('clamps when adding months to a long month', () => {
    expect(formatDate(addMonths(parseDate('2025-01-31'), 1))).toBe('2025-02-28');
    expect(formatDate(addMonths(parseDate('2024-01-31'), 1))).toBe('2024-02-29');
  });

  it('counts whole days between dates', () => {
    expect(diffDays(parseDate('2025-04-01'), parseDate('2025-04-30'))).toBe(29);
    expect(diffDays(parseDate('2025-04-30'), parseDate('2025-04-01'))).toBe(-29);
  });
});
