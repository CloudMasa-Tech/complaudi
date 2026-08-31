import { describe, expect, it } from 'vitest';
import { evaluateAll, evaluateRule } from '../src/engine/evaluator';
import { getRule } from '../src/engine/catalog';
import { CRORE, LAKH, makeCompany, makeContext } from './helpers';

const codesFor = (ctx: ReturnType<typeof makeContext>) =>
  evaluateAll(ctx)
    .filter((e) => e.applicable)
    .map((e) => e.rule.code);

describe('applicability by entity type', () => {
  it('gives a small private limited company MGT-7A rather than MGT-7', () => {
    const codes = codesFor(makeContext({ company: makeCompany({ annualTurnover: 5 * CRORE, paidUpCapital: 10 * LAKH }) }));
    expect(codes).toContain('MCA_MGT7A');
    expect(codes).not.toContain('MCA_MGT7');
    expect(codes).toContain('MCA_AOC4');
  });

  it('gives a large private limited company the full MGT-7', () => {
    const codes = codesFor(makeContext({ company: makeCompany({ annualTurnover: 60 * CRORE, paidUpCapital: 5 * CRORE }) }));
    expect(codes).toContain('MCA_MGT7');
    expect(codes).not.toContain('MCA_MGT7A');
  });

  it('gives an LLP Form 11 and Form 8, never AOC-4 or MGT-7', () => {
    const codes = codesFor(makeContext({ company: makeCompany({ entityType: 'LLP', cin: null, llpin: 'AAB-1234' }) }));
    expect(codes).toEqual(expect.arrayContaining(['LLP_FORM11', 'LLP_FORM8', 'LLP_AUDIT']));
    expect(codes).not.toContain('MCA_AOC4');
    expect(codes).not.toContain('MCA_MGT7');
    expect(codes).not.toContain('MCA_AGM');
  });

  it('gives an OPC the 180-day AOC-4 and no AGM', () => {
    const codes = codesFor(makeContext({ company: makeCompany({ entityType: 'OPC' }) }));
    expect(codes).toContain('MCA_AOC4_OPC');
    expect(codes).toContain('MCA_MGT7A');
    expect(codes).not.toContain('MCA_AOC4');
    expect(codes).not.toContain('MCA_AGM');
  });

  it('replaces quarterly board meetings with half-yearly ones for a small company', () => {
    const small = codesFor(makeContext({ company: makeCompany({ annualTurnover: 5 * CRORE, paidUpCapital: 10 * LAKH }) }));
    expect(small).toContain('MCA_BOARD_MEETING_SMALL');
    expect(small).not.toContain('MCA_BOARD_MEETING');

    const large = codesFor(makeContext({ company: makeCompany({ annualTurnover: 60 * CRORE, paidUpCapital: 5 * CRORE }) }));
    expect(large).toContain('MCA_BOARD_MEETING');
    expect(large).not.toContain('MCA_BOARD_MEETING_SMALL');
  });
});

describe('turnover-driven thresholds', () => {
  it('adds GSTR-9 above ₹2 crore and GSTR-9C above ₹5 crore', () => {
    const below = codesFor(makeContext({ company: makeCompany({ annualTurnover: 1 * CRORE }) }));
    expect(below).not.toContain('GST_GSTR9');
    expect(below).not.toContain('GST_GSTR9C');

    const mid = codesFor(makeContext({ company: makeCompany({ annualTurnover: 3 * CRORE }) }));
    expect(mid).toContain('GST_GSTR9');
    expect(mid).not.toContain('GST_GSTR9C');

    const high = codesFor(makeContext({ company: makeCompany({ annualTurnover: 9 * CRORE }) }));
    expect(high).toEqual(expect.arrayContaining(['GST_GSTR9', 'GST_GSTR9C', 'GST_EINVOICE_READINESS']));
  });

  it('applies the ₹10 crore tax-audit threshold when cash dealings are within 5%', () => {
    const lowCash = makeContext({ company: makeCompany({ annualTurnover: 5 * CRORE, cashTransactionRatioBelow5Pct: true }) });
    const highCash = makeContext({ company: makeCompany({ annualTurnover: 5 * CRORE, cashTransactionRatioBelow5Pct: false }) });
    expect(codesFor(lowCash)).not.toContain('IT_TAX_AUDIT');
    expect(codesFor(highCash)).toContain('IT_TAX_AUDIT');
  });
});

describe('headcount-driven labour rules', () => {
  it('adds ESI at 10 employees but PF only at 20', () => {
    const twelve = codesFor(makeContext({ company: makeCompany({ employeeCount: 12 }) }));
    expect(twelve).toContain('LABOUR_ESI_CONTRIBUTION');
    expect(twelve).toContain('LABOUR_POSH_IC');
    expect(twelve).not.toContain('LABOUR_EPF_ECR');

    const twentyFive = codesFor(makeContext({ company: makeCompany({ employeeCount: 25 }) }));
    expect(twentyFive).toContain('LABOUR_EPF_ECR');
  });

  it('uses the 20-employee ESI threshold in Maharashtra', () => {
    const mh = codesFor(makeContext({ company: makeCompany({ employeeCount: 12, stateCode: 'MH' }) }));
    expect(mh).not.toContain('LABOUR_ESI_CONTRIBUTION');
  });

  it('skips professional tax in states that do not levy it', () => {
    expect(codesFor(makeContext({ company: makeCompany({ stateCode: 'DL' }) }))).not.toContain('LABOUR_PROFESSIONAL_TAX');
    expect(codesFor(makeContext({ company: makeCompany({ stateCode: 'KA' }) }))).toContain('LABOUR_PROFESSIONAL_TAX');
  });
});

describe('reason traces', () => {
  it('records a readable reason for every condition, passed or failed', () => {
    const ctx = makeContext({ company: makeCompany({ annualTurnover: 1 * CRORE }) });
    const evaluation = evaluateRule(getRule('GST_GSTR9C')!, ctx);
    expect(evaluation.applicable).toBe(false);
    expect(evaluation.reasons).toEqual([
      { label: 'Has at least one active GST registration', passed: true, negated: false },
      { label: 'Annual turnover is ₹5 crore or more', passed: false, negated: false },
    ]);
  });

  it('marks exemptions as negated so the UI can phrase them differently', () => {
    const ctx = makeContext({ company: makeCompany({ entityType: 'OPC' }) });
    const evaluation = evaluateRule(getRule('MCA_BOARD_MEETING')!, ctx);
    expect(evaluation.applicable).toBe(false);
    expect(evaluation.reasons.some((r) => r.negated && r.passed)).toBe(true);
  });
});
