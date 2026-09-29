import { describe, expect, it } from 'vitest';
import { mcaRules as nodeRules } from '../src/engine/catalog/mca';
import { mcaRules as edgeRules } from '../supabase/functions/_shared/engine/catalog/mca';
import { generateCalendar } from '../supabase/functions/_shared/engine/generator';
import { utcDate } from '../supabase/functions/_shared/dates';
import type { ComplianceContext } from '../supabase/functions/_shared/engine/types';

type EventInput = { eventType: string; eventDate: Date };

/** The MCA rules that hang off a LoggedEvent row in the company_events table. */
const EVENT_RULES = ['MCA_DIR11', 'MCA_DIR12', 'MCA_CHG1', 'MCA_CHG4', 'MCA_INC22', 'MCA_MGT14', 'MCA_PAS3', 'MCA_SH7'];

/** The four rules previously missing from the Supabase catalog. */
const NEWLY_ADDED = ['MCA_DIR11', 'MCA_CHG4', 'MCA_SH7', 'MCA_INC22'];

/**
 * The Node catalog is the source of truth for the rule text, save for one
 * known defect: a handful of its penalty/description strings contain a
 * superscript-three (U+00B3, "³") where the rupee symbol (U+20B9, "₹") was
 * intended. Normalise that one character away so parity can be asserted at
 * the full-string level without re-importing the bug.
 */
const clean = (s: string): string => s.replace(/\u00b3/g, '\u20b9');

const baseCompany = {
  id: 'company-1',
  legalName: 'Northwind Technologies Private Limited',
  entityType: 'PRIVATE_LIMITED' as const,
  cin: 'U72900TN2020PTC138472',
  llpin: null,
  pan: 'AABCN1234F',
  tan: null,
  incorporationDate: utcDate(2020, 7, 14),
  stateCode: 'TN',
  industry: 'IT',
  employeeCount: 12,
  annualTurnover: 30_000_000,
  paidUpCapital: 2_500_000,
  cashTransactionRatioBelow5Pct: true,
  hasForeignTransactions: false,
  acceptsDeposits: false,
  isListed: false,
  buysFromMsmeSuppliers: false,
  agmDate: null,
  epfoCode: null,
  esicCode: null,
  professionalTax: null,
  shopAndEstablishment: null,
};

const event = (eventType: string, isoDay: string): EventInput => ({
  eventType,
  eventDate: new Date(`${isoDay}T00:00:00.000Z`),
});

function makeCtx(events: EventInput[]): ComplianceContext {
  return {
    company: { ...baseCompany, events },
    directors: [],
    gstRegistrations: [],
    msme: null,
  };
}

function generatedRuleCodes(ctx: ComplianceContext): Set<string> {
  const { items } = generateCalendar(ctx, { from: new Date('2025-06-01T00:00:00.000Z'), to: new Date('2026-06-01T00:00:00.000Z') });
  return new Set(items.map((i) => i.ruleCode));
}

function generatedItem(ctx: ComplianceContext, ruleCode: string) {
  const { items } = generateCalendar(ctx, { from: new Date('2025-06-01T00:00:00.000Z'), to: new Date('2026-06-01T00:00:00.000Z') });
  return items.find((i) => i.ruleCode === ruleCode);
}

describe('MCA catalog parity (Node vs Supabase)', () => {
  it('exposes the same rule codes in both catalogs', () => {
    const nodeCodes = nodeRules.map((r) => r.code).sort();
    const edgeCodes = edgeRules.map((r) => r.code).sort();
    expect(edgeCodes).toEqual(nodeCodes);
  });

  it('has every shared MCA rule present under the same code in both catalogs', () => {
    const nodeByCode = new Map(nodeRules.map((r) => [r.code, r]));
    for (const rule of edgeRules) {
      expect(nodeByCode.get(rule.code), `node missing ${rule.code}`).toBeDefined();
    }
  });

  it('keeps the four newly added event rules definitionally in parity with Node', () => {
    const nodeByCode = new Map(nodeRules.map((r) => [r.code, r]));
    for (const code of NEWLY_ADDED) {
      const edge = edgeRules.find((r) => r.code === code)!;
      const node = nodeByCode.get(code)!;
      expect(edge.evidenceRequired).toEqual(node.evidenceRequired);
      expect(edge.description).toBe(node.description);
      expect(edge.penalty).toBe(node.penalty);
      expect(edge.legalReference).toBe(node.legalReference);
      expect(edge.periodKind).toBe('EVENT_BASED');
    }
  });

  it('matches evidenceRequired for every shared rule', () => {
    const nodeByCode = new Map(nodeRules.map((r) => [r.code, r]));
    for (const edge of edgeRules) {
      const node = nodeByCode.get(edge.code);
      if (!node) continue;
      expect(edge.evidenceRequired, `${edge.code} evidenceRequired`).toEqual(node.evidenceRequired);
    }
  });

  it('matches the Node text for every shared rule, modulo the known rupee-symbol typo', () => {
    const nodeByCode = new Map(nodeRules.map((r) => [r.code, r]));
    for (const edge of edgeRules) {
      const node = nodeByCode.get(edge.code);
      if (!node) continue;
      expect(clean(edge.description), `${edge.code} description`).toBe(clean(node.description));
      expect(clean(edge.penalty), `${edge.code} penalty`).toBe(clean(node.penalty));
      expect(clean(edge.legalReference), `${edge.code} legalReference`).toBe(clean(node.legalReference));
      expect(edge.title, `${edge.code} title`).toBe(node.title);
      expect(edge.form ?? null, `${edge.code} form`).toBe(node.form ?? null);
      expect(edge.severity, `${edge.code} severity`).toBe(node.severity);
      expect(edge.periodKind, `${edge.code} periodKind`).toBe(node.periodKind);
    }
  });
});

describe('MCA event rules with company_events present', () => {
  it('shows nothing for event rules when no events exist', () => {
    const codes = generatedRuleCodes(makeCtx([]));
    for (const code of EVENT_RULES) {
      expect(codes.has(code), `${code} should not apply without an event`).toBe(false);
    }
  });

  it('file return of director resignation (DIR-11) is due 30 days after the event', () => {
    const item = generatedItem(makeCtx([event('DIR-11', '2025-08-10')]), 'MCA_DIR11');
    expect(item).toBeDefined();
    expect(item!.dueDate.toISOString()).toBe('2025-09-09T00:00:00.000Z');
    expect(item!.penaltyNote).toContain('DIR-11');
  });

  it('satisfaction of charge (CHG-4) is due 30 days after the event', () => {
    const item = generatedItem(makeCtx([event('CHG-4', '2025-08-10')]), 'MCA_CHG4');
    expect(item).toBeDefined();
    expect(item!.dueDate.toISOString()).toBe('2025-09-09T00:00:00.000Z');
  });

  it('alteration of share capital (SH-7) is due 30 days after the event', () => {
    const item = generatedItem(makeCtx([event('SH-7', '2025-08-10')]), 'MCA_SH7');
    expect(item).toBeDefined();
    expect(item!.dueDate.toISOString()).toBe('2025-09-09T00:00:00.000Z');
  });

  it('registered office address change (INC-22) is due 30 days after the event', () => {
    const item = generatedItem(makeCtx([event('INC-22', '2025-08-10')]), 'MCA_INC22');
    expect(item).toBeDefined();
    expect(item!.dueDate.toISOString()).toBe('2025-09-09T00:00:00.000Z');
  });

  it('the four newly added rules all generate obligations when their events exist', () => {
    const codes = generatedRuleCodes(
      makeCtx([
        event('DIR-11', '2025-07-05'),
        event('CHG-4', '2025-07-06'),
        event('SH-7', '2025-07-07'),
        event('INC-22', '2025-07-08'),
      ]),
    );
    for (const code of NEWLY_ADDED) {
      expect(codes.has(code), `${code} should generate an obligation`).toBe(true);
    }
  });

  it('the pre-existing event rules still evaluate from the same events', () => {
    const codes = generatedRuleCodes(
      makeCtx([
        event('DIR-12', '2025-07-05'),
        event('CHG-1', '2025-07-06'),
        event('MGT-14', '2025-07-07'),
        event('PAS-3', '2025-07-08'),
      ]),
    );
    for (const code of ['MCA_DIR12', 'MCA_CHG1', 'MCA_MGT14', 'MCA_PAS3']) {
      expect(codes.has(code), `${code} should generate an obligation`).toBe(true);
    }
  });
});