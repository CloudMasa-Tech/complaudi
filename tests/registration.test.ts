import { describe, expect, it } from 'vitest';
import { getRule } from '../src/engine/catalog';
import { evaluateRule } from '../src/engine/evaluator';
import { generateCalendar } from '../src/engine/generator';
import { REGISTRATION_GRACE_DAYS } from '../src/engine/schedule';
import { addDays, parseDate, today } from '../src/lib/dates';
import { CRORE, LAKH, makeCompany, makeContext } from './helpers';

const applies = (code: string, ctx = makeContext()) => evaluateRule(getRule(code)!, ctx).applicable;

describe('GST_REGISTER', () => {
  const ctx = makeContext({
    company: makeCompany({ annualTurnover: 21 * LAKH }),
    gstRegistrations: [],
  });

  it('fires when turnover crosses the ₹20 lakh threshold and no active GSTIN is on record', () => {
    expect(applies('GST_REGISTER', ctx)).toBe(true);
  });

  it('does not fire once a GST registration is recorded', () => {
    const registered = makeContext({
      company: makeCompany({ annualTurnover: 21 * LAKH }),
      // helpers ships an active TN GSTIN by default
    });
    expect(applies('GST_REGISTER', registered)).toBe(false);
  });

  it('does not fire below the threshold', () => {
    expect(applies('GST_REGISTER', makeContext({ company: makeCompany({ annualTurnover: 5 * LAKH }), gstRegistrations: [] }))).toBe(false);
  });

  it('shows the two deciding reasons when it does not apply', () => {
    const eval_ = evaluateRule(getRule('GST_REGISTER')!, ctx);
    expect(eval_.reasons.map((r) => r.label)).toEqual([
      'Annual turnover is ₹20 lakh or more — the mandatory GST registration threshold for services',
      'Has no active GST registration',
    ]);
    expect(eval_.reasons.every((r) => r.passed)).toBe(true);
  });
});

describe('PF_REGISTER and ESI_REGISTER', () => {
  it('fires once the headcount crosses 20 with no EPFO code, and stays until it is recorded', () => {
    const quiet = makeContext({ company: makeCompany({ employeeCount: 19, epfoCode: null }) });
    expect(applies('PF_REGISTER', quiet)).toBe(false);

    const crossing = makeContext({ company: makeCompany({ employeeCount: 20, epfoCode: null }) });
    expect(applies('PF_REGISTER', crossing)).toBe(true);

    const enrolled = makeContext({ company: makeCompany({ employeeCount: 25, epfoCode: 'TNBLU0034567000' }) });
    expect(applies('PF_REGISTER', enrolled)).toBe(false);
  });

  it('fires once the state ESI threshold is crossed with no ESIC code, and stays until it is recorded', () => {
    // Maharashtra threshold is 20, so 15 employees is below it (TN default is 10).
    const mh = makeContext({ company: makeCompany({ stateCode: 'MH', employeeCount: 15, esicCode: null }) });
    expect(applies('ESI_REGISTER', mh)).toBe(false);

    const crossing = makeContext({ company: makeCompany({ stateCode: 'TN', employeeCount: 10, esicCode: null }) });
    expect(applies('ESI_REGISTER', crossing)).toBe(true);

    const enrolled = makeContext({ company: makeCompany({ employeeCount: 10, esicCode: '12345678901234567' }) });
    expect(applies('ESI_REGISTER', enrolled)).toBe(false);
  });
});

describe('the existing MSME reminder still fires unregistered', () => {
  it('applies to a company inside the ₹250 crore ceiling with no Udyam registration', () => {
    const ctx = makeContext({ company: makeCompany({ annualTurnover: 10 * CRORE }), msme: null });
    expect(applies('MSME_UDYAM_REGISTRATION', ctx)).toBe(true);
    // A registered entity no longer needs the reminder.
    const registered = makeContext({
      company: makeCompany({ annualTurnover: 10 * CRORE }),
      msme: { udyamNumber: 'UDYAM-KA-03-0114562', category: 'MICRO', registeredOn: parseDate('2025-08-01') },
    });
    expect(applies('MSME_UDYAM_REGISTRATION', registered)).toBe(false);
  });
});

describe('registration reminders in the calendar', () => {
  const window = { from: addDays(today(), -400), to: addDays(today(), 550) };

  it('emit exactly one REGISTER occurrence, due 30 days from the sync, in the current FY', () => {
    const ctx = makeContext({ company: makeCompany({ annualTurnover: 8 * CRORE, employeeCount: 25, epfoCode: null, esicCode: null }), gstRegistrations: [] });
    const { items } = generateCalendar(ctx, window);

    for (const code of ['GST_REGISTER', 'PF_REGISTER', 'ESI_REGISTER']) {
      const row = items.filter((i) => i.ruleCode === code);
      expect(row).toHaveLength(1);
      expect(row[0]!.periodKey).toBe('REGISTER');
      expect(row[0]!.periodLabel).toBe('Registration');
      expect(row[0]!.dueDate.getTime()).toBeGreaterThanOrEqual(addDays(today(), REGISTRATION_GRACE_DAYS).getTime());
      expect(row[0]!.dueDate.getTime()).toBeLessThanOrEqual(addDays(today(), REGISTRATION_GRACE_DAYS + 1).getTime());
    }
  });

  it('drop the reminder for an authority the company has registered with', () => {
    // Default context has an active GSTIN and an MSME-less profile.
    const { items } = generateCalendar(makeContext(), window);
    expect(items.some((i) => i.ruleCode === 'GST_REGISTER')).toBe(false);
    // MSME not registered and turnover within ceiling, so the Udyam reminder stays.
    expect(items.some((i) => i.ruleCode === 'MSME_UDYAM_REGISTRATION')).toBe(true);
  });
});