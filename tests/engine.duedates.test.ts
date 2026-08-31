import { describe, expect, it } from 'vitest';
import { getRule } from '../src/engine/catalog';
import { generateCalendar } from '../src/engine/generator';
import { financialYearFromStartYear, firstFinancialYearEnd, formatDate, parseDate } from '../src/lib/dates';
import { CRORE, makeCompany, makeContext } from './helpers';

const FY = financialYearFromStartYear(2025); // FY2025-26

/** Due dates a rule produces for FY2025-26, as yyyy-mm-dd. */
function dueDates(code: string, ctx = makeContext()): string[] {
  const rule = getRule(code);
  if (!rule) throw new Error(`Unknown rule ${code}`);
  return rule.occurrences(FY, ctx).map((o) => formatDate(o.dueDate));
}

describe('MCA due dates for FY2025-26', () => {
  it('falls back to the statutory outer limit when no AGM date is recorded', () => {
    expect(dueDates('MCA_AOC4')).toEqual(['2026-10-30']);
    expect(dueDates('MCA_MGT7')).toEqual(['2026-11-28']);
    expect(dueDates('MCA_ADT1')).toEqual(['2026-10-14']);
  });

  it('measures from the actual AGM date once one is recorded', () => {
    const ctx = makeContext({ company: makeCompany({ agmDate: parseDate('2026-09-15') }) });
    expect(dueDates('MCA_AOC4', ctx)).toEqual(['2026-10-15']); // AGM + 30 days
    expect(dueDates('MCA_MGT7', ctx)).toEqual(['2026-11-14']); // AGM + 60 days
    expect(dueDates('MCA_ADT1', ctx)).toEqual(['2026-09-30']); // AGM + 15 days
  });

  it('ignores an AGM date that belongs to a different financial year', () => {
    const ctx = makeContext({ company: makeCompany({ agmDate: parseDate('2025-09-15') }) });
    expect(dueDates('MCA_AOC4', ctx)).toEqual(['2026-10-30']);
    const [occ] = getRule('MCA_AOC4')!.occurrences(FY, ctx);
    expect(occ!.metadata).toMatchObject({ assumedOuterLimit: true });
  });

  it('gives an OPC 180 days from the year end', () => {
    const ctx = makeContext({ company: makeCompany({ entityType: 'OPC' }) });
    expect(dueDates('MCA_AOC4_OPC', ctx)).toEqual(['2026-09-27']);
  });

  it('places DIR-3 KYC on 30 September and DPT-3 on 30 June', () => {
    expect(dueDates('MCA_DIR3KYC')).toEqual(['2026-09-30']);
    expect(dueDates('MCA_DPT3')).toEqual(['2026-06-30']);
  });

  it('splits MSME-1 into 31 October and 30 April', () => {
    expect(dueDates('MCA_MSME1')).toEqual(['2025-10-31', '2026-04-30']);
  });

  it('places the LLP filings on 30 May and 30 October', () => {
    const ctx = makeContext({ company: makeCompany({ entityType: 'LLP' }) });
    expect(dueDates('LLP_FORM11', ctx)).toEqual(['2026-05-30']);
    expect(dueDates('LLP_FORM8', ctx)).toEqual(['2026-10-30']);
  });

  it('computes INC-20A as 180 days from incorporation', () => {
    const ctx = makeContext({ company: makeCompany({ incorporationDate: parseDate('2025-08-01') }) });
    expect(dueDates('MCA_INC20A', ctx)).toEqual(['2026-01-28']);
  });
});

describe('GST due dates', () => {
  it('files monthly GSTR-3B on the 20th of the following month', () => {
    const dates = dueDates('GST_GSTR3B_MONTHLY');
    expect(dates).toHaveLength(12);
    expect(dates[0]).toBe('2025-05-20'); // April 2025
    expect(dates[11]).toBe('2026-04-20'); // March 2026
  });

  it('files monthly GSTR-1 on the 11th', () => {
    expect(dueDates('GST_GSTR1_MONTHLY')[0]).toBe('2025-05-11');
  });

  it('uses the 22nd for Group X states and the 24th for Group Y under QRMP', () => {
    const tn = makeContext({
      gstRegistrations: [
        { id: 'g1', gstin: '33AAACT1234A1Z8', stateCode: 'TN', filingFrequency: 'QRMP', isTdsDeductor: false, isEcommerceOperator: false, isActive: true },
      ],
    });
    const dl = makeContext({
      gstRegistrations: [
        { id: 'g2', gstin: '07AAACT1234A1Z3', stateCode: 'DL', filingFrequency: 'QRMP', isTdsDeductor: false, isEcommerceOperator: false, isActive: true },
      ],
    });
    expect(dueDates('GST_GSTR3B_QRMP', tn)).toEqual(['2025-07-22', '2025-10-22', '2026-01-22', '2026-04-22']);
    expect(dueDates('GST_GSTR3B_QRMP', dl)).toEqual(['2025-07-24', '2025-10-24', '2026-01-24', '2026-04-24']);
  });

  it('emits PMT-06 only for the first two months of each quarter', () => {
    const ctx = makeContext({
      gstRegistrations: [
        { id: 'g1', gstin: '33AAACT1234A1Z8', stateCode: 'TN', filingFrequency: 'QRMP', isTdsDeductor: false, isEcommerceOperator: false, isActive: true },
      ],
    });
    const dates = dueDates('GST_PMT06', ctx);
    expect(dates).toHaveLength(8);
    expect(dates.slice(0, 3)).toEqual(['2025-05-25', '2025-06-25', '2025-08-25']);
  });

  it('fans returns out across every active GSTIN', () => {
    const ctx = makeContext({
      gstRegistrations: [
        { id: 'g1', gstin: '33AAACT1234A1Z8', stateCode: 'TN', filingFrequency: 'MONTHLY', isTdsDeductor: false, isEcommerceOperator: false, isActive: true },
        { id: 'g2', gstin: '29AAACT1234A1ZX', stateCode: 'KA', filingFrequency: 'MONTHLY', isTdsDeductor: false, isEcommerceOperator: false, isActive: true },
      ],
    });
    const occurrences = getRule('GST_GSTR3B_MONTHLY')!.occurrences(FY, ctx);
    expect(occurrences).toHaveLength(24);
    expect(occurrences[0]!.periodKey).toBe('33AAACT1234A1Z8:2025-04');
    expect(occurrences[0]!.metadata).toMatchObject({ gstin: '33AAACT1234A1Z8', stateCode: 'TN' });
  });

  it('places both annual GST returns on 31 December', () => {
    const ctx = makeContext({ company: makeCompany({ annualTurnover: 9 * CRORE }) });
    expect(dueDates('GST_GSTR9', ctx)).toEqual(['2026-12-31']);
    expect(dueDates('GST_GSTR9C', ctx)).toEqual(['2026-12-31']);
  });
});

describe('Income tax due dates', () => {
  it('spaces advance tax over the four statutory dates', () => {
    expect(dueDates('IT_ADVANCE_TAX')).toEqual(['2025-06-15', '2025-09-15', '2025-12-15', '2026-03-15']);
  });

  it('gives March TDS until 30 April but every other month the 7th', () => {
    const dates = dueDates('IT_TDS_PAYMENT');
    expect(dates[0]).toBe('2025-05-07'); // April 2025
    expect(dates[11]).toBe('2026-04-30'); // March 2026 — the statutory relaxation
  });

  it('uses the non-uniform quarterly TDS return dates', () => {
    expect(dueDates('IT_TDS_RETURN')).toEqual(['2025-07-31', '2025-10-31', '2026-01-31', '2026-05-31']);
    expect(dueDates('IT_FORM16A')).toEqual(['2025-08-15', '2025-11-15', '2026-02-15', '2026-06-15']);
  });

  it('moves the return to 30 November when transfer pricing applies', () => {
    const plain = makeContext();
    const tp = makeContext({ company: makeCompany({ hasForeignTransactions: true }) });

    expect(dueDates('IT_ITR_AUDITED', plain)).toEqual(['2026-10-31']);
    const applicable = (ctx: typeof plain, code: string) =>
      generateCalendar(ctx, { from: parseDate('2025-04-01'), to: parseDate('2027-03-31') }).items.some((i) => i.ruleCode === code);

    expect(applicable(plain, 'IT_ITR_AUDITED')).toBe(true);
    expect(applicable(tp, 'IT_ITR_AUDITED')).toBe(false);
    expect(applicable(tp, 'IT_ITR_TP')).toBe(true);
    expect(dueDates('IT_ITR_TP', tp)).toEqual(['2026-11-30']);
  });
});

describe('labour due dates', () => {
  it('places PF and ESI on the 15th of the following month', () => {
    expect(dueDates('LABOUR_EPF_ECR')[0]).toBe('2025-05-15');
    expect(dueDates('LABOUR_ESI_CONTRIBUTION')[0]).toBe('2025-05-15');
  });

  it('places the bonus return on 30 December, thirty days after the payment deadline', () => {
    expect(dueDates('LABOUR_BONUS_FORM_D')).toEqual(['2026-12-30']);
  });
});

describe('calendar generation', () => {
  it('only returns obligations whose due date falls inside the window', () => {
    const ctx = makeContext();
    const { items } = generateCalendar(ctx, { from: parseDate('2025-04-01'), to: parseDate('2026-03-31') });
    expect(items.length).toBeGreaterThan(50);
    for (const item of items) {
      expect(item.dueDate >= parseDate('2025-04-01')).toBe(true);
      expect(item.dueDate <= parseDate('2026-03-31')).toBe(true);
    }
  });

  it('returns items sorted by due date and never duplicates a period', () => {
    const { items } = generateCalendar(makeContext(), { from: parseDate('2025-04-01'), to: parseDate('2027-03-31') });
    const keys = items.map((i) => `${i.ruleCode}::${i.periodKey}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (let i = 1; i < items.length; i += 1) {
      expect(items[i]!.dueDate.getTime()).toBeGreaterThanOrEqual(items[i - 1]!.dueDate.getTime());
    }
  });

  it('produces nothing for a rule that does not apply', () => {
    const llp = makeContext({ company: makeCompany({ entityType: 'LLP' }) });
    const { items } = generateCalendar(llp, { from: parseDate('2025-04-01'), to: parseDate('2027-03-31') });
    expect(items.some((i) => i.ruleCode === 'MCA_AOC4')).toBe(false);
    expect(items.some((i) => i.ruleCode === 'LLP_FORM11')).toBe(true);
  });
});

describe('a company cannot owe anything from before it existed', () => {
  // Incorporated 17 February 2026, so under s.2(41) its first financial year
  // runs to 31 March 2027 — there are no FY2025-26 accounts at all.
  const newCo = makeContext({ company: makeCompany({ incorporationDate: parseDate('2026-02-17') }) });
  const window = { from: parseDate('2024-04-01'), to: parseDate('2028-03-31') };

  it('generates nothing for a period that closed before incorporation', () => {
    const { items } = generateCalendar(newCo, window);
    const early = items.filter((i) => i.periodEnd < parseDate('2026-02-17'));
    expect(early.map((i) => `${i.ruleCode} ${i.periodLabel}`)).toEqual([]);
  });

  it('never sets a due date earlier than the incorporation date', () => {
    const { items } = generateCalendar(newCo, window);
    expect(items.filter((i) => i.dueDate < parseDate('2026-02-17'))).toEqual([]);
  });

  it('skips the accounts-based filings for the year the first FY absorbs', () => {
    const { items } = generateCalendar(newCo, window);
    const aoc4 = items.filter((i) => i.ruleCode === 'MCA_AOC4');
    // FY2025-26 ends 31 Mar 2026, inside the extended first year — no AOC-4.
    expect(aoc4.map((i) => i.periodLabel)).not.toContain('FY 2025-26');
    expect(aoc4.map((i) => i.periodLabel)).toContain('FY 2026-27');
  });

  it('still generates the periodic returns that overlap incorporation', () => {
    const { items } = generateCalendar(newCo, window);
    // February 2026 straddles the incorporation date, so that month is owed.
    const feb = items.filter((i) => i.periodLabel.includes('Feb 2026'));
    expect(feb.length).toBeGreaterThan(0);
    expect(items.some((i) => i.periodLabel.includes('Jan 2026'))).toBe(false);
  });

  it('gives the first AGM nine months, not six', () => {
    const { items } = generateCalendar(newCo, window);
    const agm = items.filter((i) => i.ruleCode === 'MCA_AGM');
    // First FY ends 31 Mar 2027 -> AGM by 31 Dec 2027, not 30 Sep 2027.
    expect(formatDate(agm[0]!.dueDate)).toBe('2027-12-31');
    expect(agm[0]!.metadata).toMatchObject({ firstAgm: true });
  });

  it('hangs AOC-4 and MGT-7A off the extended first AGM limit', () => {
    const { items } = generateCalendar(newCo, window);
    const due = (code: string) => formatDate(items.find((i) => i.ruleCode === code)!.dueDate);
    expect(due('MCA_AOC4')).toBe('2028-01-30');  // first AGM limit + 30 days
    expect(due('MCA_MGT7A')).toBe('2028-02-29'); // + 60 days
  });

  it('leaves an established company on the ordinary six-month deadline', () => {
    const established = makeContext({ company: makeCompany({ incorporationDate: parseDate('2020-07-14') }) });
    const { items } = generateCalendar(established, { from: parseDate('2026-04-01'), to: parseDate('2027-03-31') });
    const agm = items.find((i) => i.ruleCode === 'MCA_AGM');
    expect(formatDate(agm!.dueDate)).toBe('2026-09-30');
  });
});

describe('first financial year (s.2(41))', () => {
  it('extends the first year to fifteen months when incorporated in Jan–Mar', () => {
    expect(formatDate(firstFinancialYearEnd(parseDate('2026-02-17')))).toBe('2027-03-31');
    expect(formatDate(firstFinancialYearEnd(parseDate('2023-03-10')))).toBe('2024-03-31');
    expect(formatDate(firstFinancialYearEnd(parseDate('2026-01-01')))).toBe('2027-03-31');
  });

  it('leaves an April–December incorporation on the ordinary year end', () => {
    expect(formatDate(firstFinancialYearEnd(parseDate('2020-07-14')))).toBe('2021-03-31');
    expect(formatDate(firstFinancialYearEnd(parseDate('2026-04-01')))).toBe('2027-03-31');
    expect(formatDate(firstFinancialYearEnd(parseDate('2025-12-31')))).toBe('2026-03-31');
  });
});
