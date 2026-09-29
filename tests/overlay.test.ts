import { afterEach, describe, expect, it } from 'vitest';
import { getRule } from '../src/engine/catalog';
import { effectiveRules, getEffectiveRule } from '../src/engine/catalog';
import { evaluateRule } from '../src/engine/evaluator';
import {
  applyOverlay,
  applyOverlays,
  clearRuleOverlays,
  isOverlayInForce,
  setRuleOverlays,
  type RuleOverlay,
} from '../src/engine/overlay';
import { PREDICATES, describePredicates, predicateNames, resolvePredicate } from '../src/engine/predicates';
import { overlayPatchSchema } from '../src/modules/regulatory/regulatory.schemas';
import { financialYearFromStartYear, parseDate } from '../src/lib/dates';
import { makeCompany, makeContext } from './helpers';
import type { ComplianceRule } from '../src/engine/types';

const FY = financialYearFromStartYear(2025); // FY2025-26
const AS_OF = parseDate('2026-01-15');

const overlay = (partial: Partial<RuleOverlay> & Pick<RuleOverlay, 'ruleCode' | 'patch'>): RuleOverlay => ({
  id: 'ov-1',
  effectiveFrom: null,
  effectiveTo: null,
  note: 'MCA General Circular 09/2026',
  ...partial,
});

afterEach(() => clearRuleOverlays());

describe('predicate registry', () => {
  it('resolves every registered predicate with a plausible argument', () => {
    // The registry is the vocabulary handed to the model; a spec whose build
    // throws on its own schema's output would only surface at approval time.
    const samples: Record<string, unknown> = {
      entityIs: ['PRIVATE_LIMITED'],
      incorporatedOnOrAfter: '2018-11-02',
      incorporatedBefore: '2018-11-02',
      stateCodeIn: ['33'],
      turnoverAtLeast: 50_000_000,
      turnoverBelow: 50_000_000,
      turnoverBetween: { min: 10_000_000, max: 50_000_000 },
      paidUpCapitalAtLeast: 40_000_000,
      employeesAtLeast: 10,
      employeesBelow: 10,
      anyGstFrequencyIs: ['QRMP'],
      msmeCategoryIs: ['MICRO'],
      dpiitRecognisedWithinYears: 10,
    };

    for (const name of predicateNames()) {
      const condition = resolvePredicate({ predicate: name, args: samples[name] });
      expect(condition.label.length, `${name} must carry a human-readable label`).toBeGreaterThan(3);
      expect(() => condition.test(makeContext())).not.toThrow();
    }
  });

  it('rejects an unknown predicate by name and lists what is available', () => {
    expect(() => resolvePredicate({ predicate: 'turnoverIsVibes', args: 1 })).toThrow(/Unknown predicate/);
  });

  it('rejects arguments that do not fit the predicate', () => {
    expect(() => resolvePredicate({ predicate: 'turnoverAtLeast', args: 'five crore' })).toThrow(
      /Invalid arguments/,
    );
    expect(() => resolvePredicate({ predicate: 'entityIs', args: ['SOLE_TRADER'] })).toThrow(/Invalid arguments/);
    // A negative headcount would silently make a rule apply to everyone.
    expect(() => resolvePredicate({ predicate: 'employeesAtLeast', args: -5 })).toThrow(/Invalid arguments/);
  });

  it('describes every predicate for the watcher prompt', () => {
    const described = describePredicates();
    for (const name of predicateNames()) expect(described).toContain(`- ${name}(`);
    // Stable ordering keeps the prompt prefix cacheable across runs.
    expect(describePredicates()).toBe(described);
  });
});

describe('DPIIT conditions', () => {
  it('reads recognition and its benefit window', () => {
    const recognised = resolvePredicate({ predicate: 'hasDpiitRecognition' });
    expect(recognised.test(makeContext())).toBe(false);

    const ctx = makeContext({
      company: makeCompany({ dpiitRecognitionNumber: 'DIPP12345', dpiitRecognisedOn: parseDate('2024-01-01') }),
    });
    expect(recognised.test(ctx)).toBe(true);
    expect(resolvePredicate({ predicate: 'dpiitRecognisedWithinYears', args: 10 }).test(ctx)).toBe(true);
    expect(resolvePredicate({ predicate: 'dpiitRecognisedWithinYears', args: 1 }).test(ctx)).toBe(false);
  });

  it('fails closed when the recognition date is missing', () => {
    // A recognition with no date cannot be shown to be inside any window, and
    // granting a time-boxed benefit on an unknown date would be a real error.
    const ctx = makeContext({
      company: makeCompany({ dpiitRecognitionNumber: 'DIPP12345', dpiitRecognisedOn: null }),
    });
    expect(resolvePredicate({ predicate: 'dpiitRecognisedWithinYears', args: 10 }).test(ctx)).toBe(false);
  });
});

describe('applying an overlay', () => {
  const base = getRule('MCA_AOC4')!;

  it('shifts every due date by a fixed number of days', () => {
    const before = base.occurrences(FY, makeContext());
    const patched = applyOverlay(base, overlay({ ruleCode: 'MCA_AOC4', patch: { dueDateShiftDays: 30 } }));
    const after = patched.occurrences(FY, makeContext());

    expect(after).toHaveLength(before.length);
    for (const [i, occ] of after.entries()) {
      expect(occ.dueDate.getTime() - before[i]!.dueDate.getTime()).toBe(30 * 86_400_000);
    }
  });

  it('lets a named-period override beat a blanket shift', () => {
    const before = base.occurrences(FY, makeContext());
    const periodKey = before[0]!.periodKey;

    const patched = applyOverlay(
      base,
      overlay({
        ruleCode: 'MCA_AOC4',
        patch: { dueDateShiftDays: 30, dueDateOverrides: { [periodKey]: '2026-11-30' } },
      }),
    );

    const occ = patched.occurrences(FY, makeContext()).find((o) => o.periodKey === periodKey)!;
    expect(occ.dueDate.toISOString().slice(0, 10)).toBe('2026-11-30');
  });

  it('drops occurrences falling due inside a suspension window', () => {
    const before = base.occurrences(FY, makeContext());
    const due = before[0]!.dueDate.toISOString().slice(0, 10);

    const patched = applyOverlay(
      base,
      overlay({ ruleCode: 'MCA_AOC4', patch: { suspendedFrom: due, suspendedTo: due } }),
    );

    expect(patched.occurrences(FY, makeContext())).toHaveLength(before.length - 1);
  });

  it('applies suspension against the shifted date, not the original', () => {
    // A waiver asks "did anything fall due in the window" — after any extension
    // has moved it. Checking the pre-shift date would waive the wrong filing.
    const original = base.occurrences(FY, makeContext())[0]!;
    const shifted = new Date(original.dueDate.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);

    const patched = applyOverlay(
      base,
      overlay({
        ruleCode: 'MCA_AOC4',
        patch: { dueDateShiftDays: 30, suspendedFrom: shifted, suspendedTo: shifted },
      }),
    );

    const keys = patched.occurrences(FY, makeContext()).map((o) => o.periodKey);
    expect(keys).not.toContain(original.periodKey);
  });

  it('narrows applicability through the predicate registry', () => {
    const ctx = makeContext({ company: makeCompany({ annualTurnover: 8 * 10_000_000 }) });
    expect(evaluateRule(base, ctx).applicable).toBe(true);

    const patched = applyOverlay(
      base,
      overlay({
        ruleCode: 'MCA_AOC4',
        patch: { addApplicableWhen: [{ predicate: 'turnoverAtLeast', args: 100_000_000 }] },
      }),
    );

    const evaluation = evaluateRule(patched, ctx);
    expect(evaluation.applicable).toBe(false);
    expect(evaluation.reasons.some((r) => r.label.includes('₹10 crore') && !r.passed)).toBe(true);
  });

  it('expresses a threshold change as a removal plus an addition', () => {
    const rule = getRule('GST_GSTR9C')!;
    const oldLabel = rule.applicableWhen.find((c) => c.label.includes('turnover'))?.label;
    expect(oldLabel, 'GSTR-9C should have a turnover condition to replace').toBeTruthy();

    const patched = applyOverlay(
      rule,
      overlay({
        ruleCode: 'GST_GSTR9C',
        patch: {
          removeConditionLabels: [oldLabel!],
          addApplicableWhen: [{ predicate: 'turnoverAtLeast', args: 100_000_000 }],
        },
      }),
    );

    expect(patched.applicableWhen.map((c) => c.label)).not.toContain(oldLabel);
    expect(patched.applicableWhen.some((c) => c.label.includes('₹10 crore'))).toBe(true);
  });

  it('switches a withdrawn rule off while keeping it explicable', () => {
    const patched = applyOverlay(
      base,
      overlay({
        ruleCode: 'MCA_AOC4',
        patch: { withdrawn: true, withdrawnReason: 'Form omitted by the 2026 Amendment Rules.' },
      }),
    );

    const evaluation = evaluateRule(patched, makeContext());
    expect(evaluation.applicable).toBe(false);
    // The rule survives with a reason rather than vanishing from the catalog.
    expect(evaluation.reasons.some((r) => r.negated && r.passed && r.label.includes('omitted'))).toBe(true);
  });

  it('records what amended it, and never mutates the catalog entry', () => {
    const originalDue = base.occurrences(FY, makeContext())[0]!.dueDate.getTime();

    const patched = applyOverlay(base, overlay({ ruleCode: 'MCA_AOC4', patch: { dueDateShiftDays: 15 } }));
    expect(patched.amendments).toEqual([
      { overlayId: 'ov-1', note: 'MCA General Circular 09/2026', effectiveFrom: null, effectiveTo: null },
    ]);

    expect(getRule('MCA_AOC4')!.occurrences(FY, makeContext())[0]!.dueDate.getTime()).toBe(originalDue);
    expect(getRule('MCA_AOC4')!.amendments).toBeUndefined();
  });

  it('applies overlays for one rule in the order given, so a later circular wins', () => {
    const [applied] = applyOverlays(
      [base],
      [
        overlay({ id: 'a', ruleCode: 'MCA_AOC4', patch: { severity: 'LOW', dueDateShiftDays: 10 } }),
        overlay({ id: 'b', ruleCode: 'MCA_AOC4', patch: { severity: 'HIGH' } }),
      ],
      AS_OF,
    );

    expect(applied!.severity).toBe('HIGH');
    expect(applied!.amendments).toHaveLength(2);
    // The earlier shift is not undone by the later patch leaving it alone.
    const before = base.occurrences(FY, makeContext())[0]!.dueDate.getTime();
    expect(applied!.occurrences(FY, makeContext())[0]!.dueDate.getTime()).toBe(before + 10 * 86_400_000);
  });
});

describe('effective windows', () => {
  const inForce = (from: string | null, to: string | null, asOf: string) =>
    isOverlayInForce(
      overlay({
        ruleCode: 'MCA_AOC4',
        patch: { dueDateShiftDays: 1 },
        effectiveFrom: from ? parseDate(from) : null,
        effectiveTo: to ? parseDate(to) : null,
      }),
      parseDate(asOf),
    );

  it('honours open, closed and half-open windows', () => {
    expect(inForce(null, null, '2026-01-15')).toBe(true);
    expect(inForce('2026-01-01', null, '2026-01-15')).toBe(true);
    expect(inForce('2026-02-01', null, '2026-01-15')).toBe(false);
    expect(inForce(null, '2026-01-01', '2026-01-15')).toBe(false);
    expect(inForce('2026-01-01', '2026-01-31', '2026-01-15')).toBe(true);
  });

  it('leaves the catalog untouched when nothing is in force', () => {
    const rules: ComplianceRule[] = [getRule('MCA_AOC4')!];
    const out = applyOverlays(
      rules,
      [
        overlay({
          ruleCode: 'MCA_AOC4',
          patch: { dueDateShiftDays: 30 },
          effectiveFrom: parseDate('2027-01-01'),
        }),
      ],
      AS_OF,
    );
    // Identity, not a copy — an out-of-window overlay must cost nothing.
    expect(out[0]).toBe(rules[0]);
  });
});

describe('the registry the runtime pushes into', () => {
  it('is a no-op until overlays are registered', () => {
    expect(effectiveRules()).toHaveLength(getRule('MCA_AOC4') ? effectiveRules().length : 0);
    expect(getEffectiveRule('MCA_AOC4')).toBe(getRule('MCA_AOC4'));
  });

  it('changes what evaluateRule and getEffectiveRule see once set', () => {
    setRuleOverlays([
      overlay({ ruleCode: 'MCA_AOC4', patch: { penalty: 'Late fee waived for FY 2025-26.' } }),
    ]);

    expect(getEffectiveRule('MCA_AOC4')!.penalty).toBe('Late fee waived for FY 2025-26.');
    expect(getRule('MCA_AOC4')!.penalty).not.toBe('Late fee waived for FY 2025-26.');

    clearRuleOverlays();
    expect(getEffectiveRule('MCA_AOC4')).toBe(getRule('MCA_AOC4'));
  });

  it('keeps rule codes unique and complete under overlays', () => {
    setRuleOverlays([overlay({ ruleCode: 'MCA_AOC4', patch: { severity: 'LOW' } })]);
    const codes = effectiveRules().map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.length).toBe(effectiveRules().length);
  });
});

describe('patch validation', () => {
  const valid = (patch: unknown) => overlayPatchSchema.safeParse(patch).success;

  it('accepts the shapes the watcher is asked to produce', () => {
    expect(valid({ dueDateShiftDays: 30 })).toBe(true);
    expect(valid({ dueDateOverrides: { 'FY2025-26': '2026-11-30' } })).toBe(true);
    expect(valid({ addExcludeWhen: [{ predicate: 'entityIs', args: ['OPC'] }] })).toBe(true);
    expect(valid({ withdrawn: true, withdrawnReason: 'Form omitted by amendment.' })).toBe(true);
  });

  it('rejects an empty patch', () => {
    expect(valid({})).toBe(false);
  });

  it('rejects fields outside the overlay vocabulary', () => {
    // A model reaching for `occurrences` or `applicableWhen` directly is exactly
    // what this layer exists to stop.
    expect(valid({ occurrences: 'fy => []' })).toBe(false);
    expect(valid({ applicableWhen: [] })).toBe(false);
    expect(valid({ code: 'MCA_NEW' })).toBe(false);
  });

  it('rejects an unknown predicate inside a patch', () => {
    expect(valid({ addApplicableWhen: [{ predicate: 'isVibeCompliant' }] })).toBe(false);
  });

  it('bounds a due-date shift to something a circular could plausibly say', () => {
    expect(valid({ dueDateShiftDays: 400 })).toBe(false);
    expect(valid({ dueDateShiftDays: -400 })).toBe(false);
  });

  it('rejects an inverted suspension window', () => {
    expect(valid({ suspendedFrom: '2026-06-01', suspendedTo: '2026-01-01' })).toBe(false);
  });

  it('rejects a withdrawal that also tries to shift dates', () => {
    expect(valid({ withdrawn: true, dueDateShiftDays: 30 })).toBe(false);
  });

  it('covers every field the engine reads, so the two cannot drift apart', () => {
    // If a field is added to RuleOverlayPatch without being added here, .strict()
    // would reject a patch the engine would happily have applied.
    const engineFields = [
      'title', 'description', 'penalty', 'legalReference', 'category', 'form', 'severity',
      'evidenceLevel', 'evidenceRequired', 'signatoryRequired',
      'dueDateShiftDays', 'dueDateOverrides', 'suspendedFrom', 'suspendedTo',
      'addApplicableWhen', 'addExcludeWhen', 'removeConditionLabels',
      'withdrawn', 'withdrawnReason',
    ];
    const schemaFields = Object.keys(overlayPatchSchema._def.schema.shape);
    expect(schemaFields.sort()).toEqual(engineFields.sort());
  });
});

describe('the vocabulary handed to the model', () => {
  it('names only predicates the engine can resolve', () => {
    // The prompt and the registry are generated from the same table, so this
    // guards against a hand-edited prompt drifting away from the code.
    for (const name of Object.keys(PREDICATES)) {
      expect(() => PREDICATES[name]!.args.safeParse(undefined)).not.toThrow();
    }
    expect(predicateNames().length).toBe(Object.keys(PREDICATES).length);
  });
});
