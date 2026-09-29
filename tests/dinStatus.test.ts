import { describe, expect, it } from 'vitest';
import { DIN_TONE, deriveDinStatus, type KycFiling } from '../src/engine/dinStatus';
import { parseDate } from '../src/lib/dates';

const serving = { din: '10842644', resignedOn: null };
const ASOF = parseDate('2026-12-01');

const kyc = (periodKey: string, due: string, status: string, completedAt?: string): KycFiling => ({
  periodKey,
  dueDate: parseDate(due),
  status,
  completedAt: completedAt ? parseDate(completedAt) : null,
});

describe('a DIN whose KYC is on file', () => {
  it('reads as active, and says when it was filed', () => {
    const s = deriveDinStatus(serving, [kyc('FY2026-27', '2026-09-30', 'COMPLETED', '2026-08-12')], ASOF);
    expect(s.state).toBe('ACTIVE');
    expect(s.label).toBe('KYC filed 12 Aug 2026');
    expect(s.action).toBeNull();
  });

  it('counts a waived obligation as filed', () => {
    // Waiving is a deliberate act by someone with the authority to do it; the
    // engine must not then report the DIN as dead.
    expect(deriveDinStatus(serving, [kyc('FY2026-27', '2026-09-30', 'WAIVED')], ASOF).state).toBe('ACTIVE');
  });

  it('still reports filed when the completion date was not recorded', () => {
    const s = deriveDinStatus(serving, [kyc('FY2026-27', '2026-09-30', 'COMPLETED')], ASOF);
    expect(s.state).toBe('ACTIVE');
    expect(s.label).toBe('KYC filed');
  });
});

describe('a DIN whose KYC was missed', () => {
  it('reads as deactivated, and names the fee', () => {
    const s = deriveDinStatus(serving, [kyc('FY2026-27', '2026-09-30', 'OVERDUE')], ASOF);
    expect(s.state).toBe('DEACTIVATED');
    expect(s.label).toBe('DIR-3 KYC overdue since 30 Sep 2026');
    expect(s.action).toContain('₹5,000');
  });

  it('judges on the most recent closed cycle, not the oldest', () => {
    // Last year was missed, this year was filed: the DIN is working again.
    const s = deriveDinStatus(serving, [
      kyc('FY2025-26', '2025-09-30', 'OVERDUE'),
      kyc('FY2026-27', '2026-09-30', 'COMPLETED', '2026-09-01'),
    ], ASOF);
    expect(s.state).toBe('ACTIVE');
    expect(s.asOfPeriod).toBe('FY2026-27');
  });

  it('and the other way round — filed last year, missed this year', () => {
    const s = deriveDinStatus(serving, [
      kyc('FY2025-26', '2025-09-30', 'COMPLETED', '2025-09-02'),
      kyc('FY2026-27', '2026-09-30', 'DUE'),
    ], ASOF);
    expect(s.state).toBe('DEACTIVATED');
    expect(s.asOfPeriod).toBe('FY2026-27');
  });
});

describe('a cycle that has not closed yet', () => {
  const beforeDeadline = parseDate('2026-07-01');

  it('is due, not deactivated — nothing is wrong before the deadline', () => {
    const s = deriveDinStatus(serving, [kyc('FY2026-27', '2026-09-30', 'UPCOMING')], beforeDeadline);
    expect(s.state).toBe('DUE');
    expect(s.action).toBe('File DIR-3 KYC by 30 Sep 2026');
  });

  it('never reports deactivated purely because a future filing is outstanding', () => {
    const s = deriveDinStatus(serving, [
      kyc('FY2026-27', '2026-09-30', 'UPCOMING'),
      kyc('FY2027-28', '2027-09-30', 'UPCOMING'),
    ], beforeDeadline);
    expect(s.state).not.toBe('DEACTIVATED');
  });
});

describe('when there is nothing to go on', () => {
  it('says unknown rather than guessing, with no DIN', () => {
    const s = deriveDinStatus({ din: null, resignedOn: null }, [], ASOF);
    expect(s.state).toBe('UNKNOWN');
    expect(s.label).toBe('No DIN recorded');
  });

  it('says unknown with no KYC record at all', () => {
    // A company incorporated after the last deadline has no closed cycle. That
    // is not a deactivated DIN, and must not be coloured like one.
    const s = deriveDinStatus(serving, [], ASOF);
    expect(s.state).toBe('UNKNOWN');
    expect(DIN_TONE[s.state]).toBe('muted');
  });

  it('drops a resigned director out of the picture', () => {
    const s = deriveDinStatus({ din: '10842644', resignedOn: parseDate('2026-06-30') },
      [kyc('FY2026-27', '2026-09-30', 'OVERDUE')], ASOF);
    expect(s.state).toBe('UNKNOWN');
    expect(s.label).toBe('Resigned');
  });

  it('keeps a director who resigns in the future', () => {
    const s = deriveDinStatus({ din: '10842644', resignedOn: parseDate('2027-06-30') },
      [kyc('FY2026-27', '2026-09-30', 'COMPLETED', '2026-08-01')], ASOF);
    expect(s.state).toBe('ACTIVE');
  });
});

describe('the verdict is always marked as inference', () => {
  it('sets derived on every outcome, so the UI can never present it as verified', () => {
    const cases: KycFiling[][] = [
      [kyc('FY2026-27', '2026-09-30', 'COMPLETED', '2026-08-12')],
      [kyc('FY2026-27', '2026-09-30', 'OVERDUE')],
      [kyc('FY2027-28', '2027-09-30', 'UPCOMING')],
      [],
    ];
    for (const filings of cases) {
      expect(deriveDinStatus(serving, filings, ASOF).derived).toBe(true);
    }
  });

  it('maps every state to a tone', () => {
    for (const state of ['ACTIVE', 'DEACTIVATED', 'DUE', 'UNKNOWN'] as const) {
      expect(DIN_TONE[state]).toBeTruthy();
    }
  });
});

describe('the Node and edge copies agree', () => {
  it('produces identical verdicts for every case', async () => {
    // Two implementations ship separately, and a browser can be talking to
    // either. The whole class of bug this file has been chasing is the two
    // drifting apart, so they are compared rather than assumed equal.
    const edge = await import('../supabase/functions/_shared/engine/dinStatus');

    type Dir = { din: string | null; resignedOn: Date | null };
    const cases: Array<[Dir, KycFiling[]]> = [
      [serving, [kyc('FY2026-27', '2026-09-30', 'COMPLETED', '2026-08-12')]],
      [serving, [kyc('FY2026-27', '2026-09-30', 'OVERDUE')]],
      [serving, [kyc('FY2026-27', '2026-09-30', 'WAIVED')]],
      [serving, [kyc('FY2027-28', '2027-09-30', 'UPCOMING')]],
      [serving, []],
      [{ din: null, resignedOn: null }, []],
      [{ din: '10842644', resignedOn: parseDate('2026-06-30') }, [kyc('FY2026-27', '2026-09-30', 'OVERDUE')]],
      [serving, [
        kyc('FY2025-26', '2025-09-30', 'OVERDUE'),
        kyc('FY2026-27', '2026-09-30', 'COMPLETED', '2026-09-01'),
      ]],
    ];

    for (const [director, filings] of cases) {
      expect(edge.deriveDinStatus(director, filings, ASOF)).toEqual(deriveDinStatus(director, filings, ASOF));
    }
  });
});
