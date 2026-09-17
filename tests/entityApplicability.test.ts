import { describe, expect, it } from 'vitest';
import { allRules, getRule } from '../src/engine/catalog';
import { applicableEntityTypes, type RuleEntityApplicability, type RuleEntityStatus } from '../src/engine/entityApplicability';
import type { EntityType } from '../src/engine/types';

const PL: EntityType = 'PRIVATE_LIMITED';
const PUB: EntityType = 'PUBLIC_LIMITED';
const OPC: EntityType = 'OPC';
const LLP: EntityType = 'LLP';
const PART: EntityType = 'PARTNERSHIP';
const PROP: EntityType = 'PROPRIETORSHIP';
const S8: EntityType = 'SECTION_8';
const UREG: EntityType = 'UNREGISTERED';
const ALL: EntityType[] = [PL, PUB, OPC, LLP, PART, PROP, S8, UREG];

const applicability = (code: string): RuleEntityApplicability => {
  const rule = getRule(code);
  if (!rule) throw new Error(`no rule ${code}`);
  return applicableEntityTypes(rule);
};

const statusAt = (code: string, t: EntityType): RuleEntityStatus => applicability(code)[t];

describe('entity-type reference matrix', () => {
  it('covers every rule in the catalog', () => {
    expect(allRules).toHaveLength(59);
    for (const rule of allRules) {
      const m = applicableEntityTypes(rule);
      expect(Object.keys(m).sort()).toEqual([...ALL].sort());
      for (const t of ALL) {
        expect(['ALWAYS', 'CONTINGENT', 'NEVER']).toContain(m[t]);
      }
      // A rule that cannot apply to anyone would be a bug before a UI problem.
      expect(ALL.some((t) => m[t] !== 'NEVER')).toBe(true);
    }
  });

  it('assigns exactly the four documented trade-off rules to every type as CONTINGENT', () => {
    for (const code of ['MCA_MGT7A', 'MCA_BOARD_MEETING_SMALL', 'IT_ITR_AUDITED', 'IT_ITR_NON_AUDITED']) {
      for (const t of ALL) {
        expect(statusAt(code, t), `${code} @ ${t}`).toBe('CONTINGENT');
      }
    }
  });
});

describe('annual company filings (MCA)', () => {
  it('AOC-4 covers only the company types that must file financials', () => {
    expect(statusAt('MCA_AOC4', PL)).toBe('ALWAYS');
    expect(statusAt('MCA_AOC4', PUB)).toBe('ALWAYS');
    expect(statusAt('MCA_AOC4', S8)).toBe('ALWAYS');
    expect(statusAt('MCA_AOC4', OPC)).toBe('NEVER');
    expect(statusAt('MCA_AOC4', LLP)).toBe('NEVER');
    expect(statusAt('MCA_AOC4', PART)).toBe('NEVER');
    expect(statusAt('MCA_AOC4', PROP)).toBe('NEVER');
  });

  it('AOC-4 is the one-person company halving of AOC-4', () => {
    expect(statusAt('MCA_AOC4_OPC', OPC)).toBe('ALWAYS');
    for (const t of ALL) {
      if (t !== OPC) expect(statusAt('MCA_AOC4_OPC', t)).toBe('NEVER');
    }
  });

  it('MGT-7 is contingent because small companies are excused', () => {
    expect(statusAt('MCA_MGT7', PL)).toBe('CONTINGENT');
    expect(statusAt('MCA_MGT7', PUB)).toBe('CONTINGENT');
    expect(statusAt('MCA_MGT7', S8)).toBe('CONTINGENT');
    expect(statusAt('MCA_MGT7', OPC)).toBe('NEVER');
  });

  it('boards sit only in companies, and small ones are exempt — never an OPC', () => {
    expect(statusAt('MCA_BOARD_MEETING', PL)).toBe('CONTINGENT');
    expect(statusAt('MCA_BOARD_MEETING', PUB)).toBe('CONTINGENT');
    expect(statusAt('MCA_BOARD_MEETING', S8)).toBe('CONTINGENT');
    expect(statusAt('MCA_BOARD_MEETING', OPC)).toBe('NEVER');
    expect(statusAt('MCA_BOARD_MEETING', LLP)).toBe('NEVER');
    expect(statusAt('MCA_BOARD_MEETING', PART)).toBe('NEVER');
    expect(statusAt('MCA_BOARD_MEETING', PROP)).toBe('NEVER');
  });

  it('AGM is every Companies Act company that is not an OPC — unconditional', () => {
    expect(statusAt('MCA_AGM', PL)).toBe('ALWAYS');
    expect(statusAt('MCA_AGM', PUB)).toBe('ALWAYS');
    expect(statusAt('MCA_AGM', S8)).toBe('ALWAYS');
    expect(statusAt('MCA_AGM', OPC)).toBe('NEVER');
    expect(statusAt('MCA_AGM', PART)).toBe('NEVER');
    expect(statusAt('MCA_AGM', PROP)).toBe('NEVER');
  });

  it('DIR-3 KYC is entity-agnostic — partnership partners hold DPIN too', () => {
    for (const t of ALL) {
      expect(statusAt('MCA_DIR3KYC', t)).toBe('CONTINGENT');
    }
  });

  it('DPT-3 / MSME-1 reach the four RoC-registered types only', () => {
    for (const code of ['MCA_DPT3', 'MCA_MSME1']) {
      expect(statusAt(code, PL)).toBe('CONTINGENT');
      expect(statusAt(code, PUB)).toBe('CONTINGENT');
      expect(statusAt(code, OPC)).toBe('CONTINGENT');
      expect(statusAt(code, S8)).toBe('CONTINGENT');
      expect(statusAt(code, LLP)).toBe('NEVER');
      expect(statusAt(code, PART)).toBe('NEVER');
      expect(statusAt(code, PROP)).toBe('NEVER');
    }
  });

  it('unconditional Companies Act housekeeping lands on the four company types', () => {
    for (const code of [
      'MCA_ADT1', 'MCA_DIR12', 'MCA_PAS3', 'MCA_CHG1', 'MCA_MGT14',
      'MCA_DIR11', 'MCA_CHG4', 'MCA_SH7', 'MCA_INC22', 'MCA_MBP1',
    ]) {
      expect(statusAt(code, PL)).toBe('ALWAYS');
      expect(statusAt(code, PUB)).toBe('ALWAYS');
      expect(statusAt(code, OPC)).toBe('ALWAYS');
      expect(statusAt(code, S8)).toBe('ALWAYS');
      expect(statusAt(code, LLP)).toBe('NEVER');
      expect(statusAt(code, PART)).toBe('NEVER');
      expect(statusAt(code, PROP)).toBe('NEVER');
    }
  });

  it('INC-20A is a share-capital rule: no OPC-less sliding, and not for LLPs', () => {
    expect(statusAt('MCA_INC20A', PL)).toBe('CONTINGENT');
    expect(statusAt('MCA_INC20A', PUB)).toBe('CONTINGENT');
    expect(statusAt('MCA_INC20A', OPC)).toBe('CONTINGENT');
    expect(statusAt('MCA_INC20A', S8)).toBe('NEVER');
    expect(statusAt('MCA_INC20A', LLP)).toBe('NEVER');
  });
});

describe('LLP filings (MCA)', () => {
  it('Form 11 and Form 8 are LLP-only filings, due every year unconditionally', () => {
    expect(statusAt('LLP_FORM11', LLP)).toBe('ALWAYS');
    expect(statusAt('LLP_FORM8', LLP)).toBe('ALWAYS');
    for (const t of ALL) {
      if (t !== LLP) {
        expect(statusAt('LLP_FORM11', t)).toBe('NEVER');
        expect(statusAt('LLP_FORM8', t)).toBe('NEVER');
      }
    }
  });

  it('LLP audit is LLP-only and remains contingent on the mandate thresholds', () => {
    expect(statusAt('LLP_AUDIT', LLP)).toBe('CONTINGENT');
    expect(statusAt('LLP_AUDIT', PL)).toBe('NEVER');
    expect(statusAt('LLP_AUDIT', PART)).toBe('NEVER');
  });
});

describe('income tax', () => {
  it('ITR/tax-audit rules are computation-driven, so every type can hit them', () => {
    for (const code of [
      'IT_ITR_AUDITED', 'IT_ITR_NON_AUDITED', 'IT_ITR_TP', 'IT_TAX_AUDIT',
      'IT_FORM3CEB', 'IT_ADVANCE_TAX', 'IT_SFT',
    ]) {
      for (const t of ALL) expect(statusAt(code, t)).toBe('CONTINGENT');
    }
  });

  it('TDS rules apply through a TAN regardless of the entity type', () => {
    for (const code of ['IT_TDS_PAYMENT', 'IT_TDS_RETURN', 'IT_FORM16', 'IT_FORM16A']) {
      for (const t of ALL) expect(statusAt(code, t)).toBe('CONTINGENT');
    }
  });
});

describe('GST, MSME and labour', () => {
  it('GST obligations follow registrations, not the structure of the owner', () => {
    for (const rule of allRules.filter((r) => r.authority === 'GST')) {
      const m = applicability(rule.code);
      for (const t of ALL) expect(m[t], `${rule.code} @ ${t}`).toBe('CONTINGENT');
    }
  });

  it('labour and MSME obligations follow headcount, turnover and registrations', () => {
    for (const rule of allRules.filter((r) => r.authority === 'LABOUR' || r.authority === 'MSME')) {
      const m = applicability(rule.code);
      for (const t of ALL) expect(m[t], `${rule.code} @ ${t}`).toBe('CONTINGENT');
    }
  });
});



describe('unregistered businesses', () => {
  it('never get MCA company or LLP filings', () => {
    for (const code of ['MCA_AOC4', 'MCA_MGT7', 'MCA_AGM', 'MCA_DIR12', 'LLP_FORM11', 'LLP_FORM8']) {
      expect(statusAt(code, UREG), code).toBe('NEVER');
    }
  });

  it('reach GST/labour obligations like any business', () => {
    for (const code of [
      'GST_GSTR3B_MONTHLY', 'LABOUR_SHOPS_ESTABLISHMENT', 'LABOUR_EPF_ECR',
    ]) {
      expect(statusAt(code, UREG), code).toBe('CONTINGENT');
    }
  });

  it('gets the same ITR guidance as firms, contingent on turnover', () => {
    expect(statusAt('IT_ITR_AUDITED', UREG)).toBe('CONTINGENT');
    expect(statusAt('IT_ITR_NON_AUDITED', UREG)).toBe('CONTINGENT');
    expect(statusAt('IT_TAX_AUDIT', UREG)).toBe('CONTINGENT');
  });
});