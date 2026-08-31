import { describe, expect, it } from 'vitest';
import { computeComplianceScore, type ScorableItem } from '../src/engine/score';
import { parseDate } from '../src/lib/dates';

const ASOF = parseDate('2026-01-31');

const item = (o: Partial<ScorableItem> & Pick<ScorableItem, 'dueDate'>): ScorableItem => ({
  ruleCode: 'X',
  authority: 'GST',
  severity: 'HIGH',
  status: 'COMPLETED',
  completedAt: null,
  ...o,
});

describe('compliance score', () => {
  it('is 100 when nothing has fallen due yet', () => {
    const result = computeComplianceScore([item({ dueDate: parseDate('2026-03-20') })], { asOf: ASOF });
    expect(result.score).toBe(100);
    expect(result.assessed).toBe(0);
    expect(result.upcoming).toBe(1);
  });

  it('gives full credit for filings made on or before the due date', () => {
    const result = computeComplianceScore(
      [
        item({ dueDate: parseDate('2025-12-20'), completedAt: parseDate('2025-12-18') }),
        item({ dueDate: parseDate('2026-01-20'), completedAt: parseDate('2026-01-20') }),
      ],
      { asOf: ASOF },
    );
    expect(result.score).toBe(100);
    expect(result.onTime).toBe(2);
    expect(result.band).toBe('A');
  });

  it('gives half credit for a late filing and none for a miss', () => {
    const late = computeComplianceScore([item({ dueDate: parseDate('2025-12-20'), completedAt: parseDate('2026-01-05') })], { asOf: ASOF });
    expect(late.score).toBe(50);
    expect(late.late).toBe(1);

    const missed = computeComplianceScore([item({ dueDate: parseDate('2025-12-20') })], { asOf: ASOF });
    expect(missed.score).toBe(0);
    expect(missed.missed).toBe(1);
    expect(missed.overdueNow).toBe(1);
  });

  it('weights a missed critical obligation far more heavily than a low one', () => {
    const missedCritical = computeComplianceScore(
      [
        item({ dueDate: parseDate('2025-12-20'), severity: 'CRITICAL' }),
        item({ dueDate: parseDate('2025-12-21'), severity: 'LOW', completedAt: parseDate('2025-12-20') }),
      ],
      { asOf: ASOF },
    );
    const missedLow = computeComplianceScore(
      [
        item({ dueDate: parseDate('2025-12-20'), severity: 'CRITICAL', completedAt: parseDate('2025-12-19') }),
        item({ dueDate: parseDate('2025-12-21'), severity: 'LOW' }),
      ],
      { asOf: ASOF },
    );
    expect(missedCritical.score).toBe(9); // 1 of 11 weighted points
    expect(missedLow.score).toBe(91); // 10 of 11
  });

  it('excludes waived items from the calculation entirely', () => {
    const result = computeComplianceScore(
      [
        item({ dueDate: parseDate('2025-12-20'), status: 'WAIVED' }),
        item({ dueDate: parseDate('2025-12-21'), completedAt: parseDate('2025-12-21') }),
      ],
      { asOf: ASOF },
    );
    expect(result.score).toBe(100);
    expect(result.waived).toBe(1);
    expect(result.assessed).toBe(1);
  });

  it('ignores obligations older than the scoring window', () => {
    const result = computeComplianceScore([item({ dueDate: parseDate('2024-06-20') })], { asOf: ASOF, lookbackDays: 365 });
    expect(result.assessed).toBe(0);
    expect(result.score).toBe(100);
  });

  it('breaks the score down by authority', () => {
    const result = computeComplianceScore(
      [
        item({ dueDate: parseDate('2025-12-20'), authority: 'GST', completedAt: parseDate('2025-12-19') }),
        item({ dueDate: parseDate('2025-12-20'), authority: 'MCA' }),
      ],
      { asOf: ASOF },
    );
    const rows = Object.fromEntries(result.byAuthority.map((r) => [r.authority, r.score]));
    expect(rows).toEqual({ GST: 100, MCA: 0 });
  });

  it('counts what is due in the next thirty days', () => {
    const result = computeComplianceScore(
      [
        item({ dueDate: parseDate('2026-02-20') }), // within 30 days
        item({ dueDate: parseDate('2026-05-20') }), // beyond
      ],
      { asOf: ASOF },
    );
    expect(result.dueInNext30Days).toBe(1);
    expect(result.upcoming).toBe(2);
  });
});

describe('obligations that predate onboarding', () => {
  const ONBOARDED = parseDate('2025-11-01');

  it('does not blame a new account for filings that fell due before it existed', () => {
    const result = computeComplianceScore(
      [
        item({ dueDate: parseDate('2025-06-20'), onboardedAt: ONBOARDED }),
        item({ dueDate: parseDate('2025-08-20'), onboardedAt: ONBOARDED }),
      ],
      { asOf: ASOF },
    );
    expect(result.score).toBe(100);
    expect(result.preOnboarding).toBe(2);
    expect(result.assessed).toBe(0);
    expect(result.missed).toBe(0);
  });

  it('scores a pre-onboarding obligation once someone says what happened to it', () => {
    const result = computeComplianceScore(
      [item({ dueDate: parseDate('2025-06-20'), onboardedAt: ONBOARDED, completedAt: parseDate('2025-07-15') })],
      { asOf: ASOF },
    );
    expect(result.preOnboarding).toBe(0);
    expect(result.late).toBe(1);
    expect(result.score).toBe(50);
  });

  it('still scores everything that fell due after onboarding', () => {
    const result = computeComplianceScore(
      [
        item({ dueDate: parseDate('2025-06-20'), onboardedAt: ONBOARDED }), // ignored
        item({ dueDate: parseDate('2025-12-20'), onboardedAt: ONBOARDED }), // missed
      ],
      { asOf: ASOF },
    );
    expect(result.preOnboarding).toBe(1);
    expect(result.assessed).toBe(1);
    expect(result.score).toBe(0);
  });
});
