/**
 * The closed vocabulary of applicability predicates an overlay may reference.
 *
 * Rules in the catalog are TypeScript: their conditions are closures, and their
 * due dates come from functions. Nothing outside this process — least of all a
 * language model — can be allowed to introduce executable logic into that.
 *
 * So the overlay layer speaks in *references* instead: `{ predicate:
 * 'turnoverAtLeast', args: 50000000 }` resolves, through this registry, to a
 * condition that was written by hand and is covered by tests. An overlay that
 * names a predicate not in this table is rejected before it reaches the engine.
 *
 * This table is also what the regulatory watcher is shown as its grammar, so a
 * proposal is either expressible here or it is flagged as needing a code
 * change. Adding a predicate is a deliberate act: write the condition in
 * conditions.ts, test it, then expose it here.
 *
 * Pure: zod is a validation library with no I/O. No Prisma, no Express.
 */
import { z } from 'zod';
import {
  acceptsDeposits,
  anyGstDeductsTds,
  anyGstFrequencyIs,
  anyGstIsEcommerceOperator,
  buysFromMsmeSuppliers,
  crossesGstRegistrationThreshold,
  crossesTaxAuditThreshold,
  dpiitRecognisedWithinYears,
  employeesAtLeast,
  employeesBelow,
  entityIs,
  hasDirectorWithDin,
  hasDpiitRecognition,
  hasEpfoEnrollment,
  hasEsicEnrollment,
  hasForeignTransactions,
  hasGstRegistration,
  hasMsmeRegistration,
  hasNoDpiitRecognition,
  hasNoEpfoEnrollment,
  hasNoEsicEnrollment,
  hasNoGstRegistration,
  hasProfessionalTax,
  hasShopsAndEstablishment,
  hasTan,
  incorporatedBefore,
  incorporatedOnOrAfter,
  isCompaniesActEntity,
  isListed,
  llpCrossesAuditThreshold,
  msmeCategoryIs,
  paidUpCapitalAtLeast,
  stateCodeIn,
  turnoverAtLeast,
  turnoverBelow,
  turnoverBetween,
} from './conditions';
import type { Condition } from './types';

/** A reference to a registered predicate, as persisted inside an overlay patch. */
export interface PredicateRef {
  predicate: string;
  /** Shape is defined by the named predicate's `args` schema. Omitted for nullary ones. */
  args?: unknown;
}

export interface PredicateSpec {
  /** One line, written for the watcher prompt — says when a drafter should reach for this. */
  summary: string;
  args: z.ZodTypeAny;
  build: (args: never) => Condition;
}

const ENTITY_TYPE = z.enum([
  'PRIVATE_LIMITED',
  'PUBLIC_LIMITED',
  'OPC',
  'LLP',
  'PARTNERSHIP',
  'PROPRIETORSHIP',
  'SECTION_8',
  'UNREGISTERED',
]);
const GST_FREQUENCY = z.enum(['MONTHLY', 'QRMP', 'COMPOSITION']);
const MSME_CATEGORY = z.enum(['MICRO', 'SMALL', 'MEDIUM']);
const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected a YYYY-MM-DD date');
/** INR, whole rupees. Capped at ₹10,000 crore so a stray zero cannot silently disable a rule. */
const RUPEES = z.number().int().nonnegative().max(100_000 * 10_000_000);
const HEADCOUNT = z.number().int().nonnegative().max(1_000_000);
const NONE = z.undefined();

function spec<S extends z.ZodTypeAny>(
  summary: string,
  args: S,
  build: (args: z.infer<S>) => Condition,
): PredicateSpec {
  return { summary, args, build: build as PredicateSpec['build'] };
}

/**
 * Every predicate an overlay may name. Keys are stable identifiers persisted
 * inside overlay patches — renaming one orphans live overlays, so don't.
 */
export const PREDICATES: Record<string, PredicateSpec> = {
  // ------------------------------------------------------------ constitution
  entityIs: spec(
    'Entity is one of the listed constitutions. Use PRIVATE_LIMITED alone for a Pvt Ltd-only obligation.',
    z.array(ENTITY_TYPE).min(1),
    (types) => entityIs(...types),
  ),
  isCompaniesActEntity: spec(
    'Any company registered with the RoC under the Companies Act 2013 (Pvt Ltd, Public Ltd, OPC, Section 8).',
    NONE,
    () => isCompaniesActEntity(),
  ),
  incorporatedOnOrAfter: spec(
    'Incorporated on or after a commencement date — the usual shape of "applies to entities incorporated on or after X".',
    ISO_DATE,
    (iso) => incorporatedOnOrAfter(iso),
  ),
  incorporatedBefore: spec('Incorporated before a cutoff date — grandfathering clauses.', ISO_DATE, (iso) =>
    incorporatedBefore(iso),
  ),
  stateCodeIn: spec(
    'Registered office is in one of the listed two-digit state codes — for state-specific labour and professional tax rules.',
    z.array(z.string().regex(/^\d{2}$/)).min(1),
    (codes) => stateCodeIn(...codes),
  ),
  isListed: spec('Is a listed company.', NONE, () => isListed()),

  // ---------------------------------------------------------------- turnover
  turnoverAtLeast: spec('Annual turnover is at or above a rupee threshold.', RUPEES, (n) => turnoverAtLeast(n)),
  turnoverBelow: spec('Annual turnover is below a rupee threshold.', RUPEES, (n) => turnoverBelow(n)),
  turnoverBetween: spec(
    'Annual turnover falls in a band [min, max). Use for slab-based obligations.',
    z.object({ min: RUPEES, max: RUPEES }).refine((v) => v.max > v.min, 'max must exceed min'),
    ({ min, max }) => turnoverBetween(min, max),
  ),
  paidUpCapitalAtLeast: spec('Paid-up share capital is at or above a rupee threshold.', RUPEES, (n) =>
    paidUpCapitalAtLeast(n),
  ),
  crossesTaxAuditThreshold: spec(
    'Crosses the s.44AB tax-audit threshold (₹1 crore, ₹10 crore where cash dealings stay within 5%).',
    NONE,
    () => crossesTaxAuditThreshold(),
  ),
  llpCrossesAuditThreshold: spec(
    'LLP turnover exceeds ₹40 lakh or contribution exceeds ₹25 lakh.',
    NONE,
    () => llpCrossesAuditThreshold(),
  ),

  // --------------------------------------------------------------- headcount
  employeesAtLeast: spec(
    'Headcount is at or above a threshold — e.g. 10 for ESI, 20 for EPF and POSH-adjacent obligations.',
    HEADCOUNT,
    (n) => employeesAtLeast(n),
  ),
  employeesBelow: spec('Headcount is below a threshold — small-establishment carve-outs.', HEADCOUNT, (n) =>
    employeesBelow(n),
  ),

  // --------------------------------------------------------------------- GST
  hasGstRegistration: spec('Holds at least one active GSTIN.', NONE, () => hasGstRegistration()),
  hasNoGstRegistration: spec('Holds no active GSTIN.', NONE, () => hasNoGstRegistration()),
  anyGstFrequencyIs: spec(
    'Files GST under one of the listed schemes on at least one active GSTIN.',
    z.array(GST_FREQUENCY).min(1),
    (freqs) => anyGstFrequencyIs(...freqs),
  ),
  anyGstDeductsTds: spec('Registered as a GST TDS deductor.', NONE, () => anyGstDeductsTds()),
  anyGstIsEcommerceOperator: spec('Registered as an e-commerce operator collecting TCS.', NONE, () =>
    anyGstIsEcommerceOperator(),
  ),
  crossesGstRegistrationThreshold: spec(
    'Turnover crosses the mandatory GST registration threshold.',
    NONE,
    () => crossesGstRegistrationThreshold(),
  ),

  // -------------------------------------------------------------------- MSME
  hasMsmeRegistration: spec('Holds a Udyam (MSME) registration.', NONE, () => hasMsmeRegistration()),
  msmeCategoryIs: spec(
    'Udyam registration falls in one of the listed categories.',
    z.array(MSME_CATEGORY).min(1),
    (cats) => msmeCategoryIs(...cats),
  ),
  buysFromMsmeSuppliers: spec(
    'Procures from MSME-registered suppliers — drives the s.43B(h) and MSME Form 1 obligations.',
    NONE,
    () => buysFromMsmeSuppliers(),
  ),

  // ------------------------------------------------------------------- DPIIT
  hasDpiitRecognition: spec('Holds a DPIIT (Startup India) recognition.', NONE, () => hasDpiitRecognition()),
  hasNoDpiitRecognition: spec('Holds no DPIIT recognition.', NONE, () => hasNoDpiitRecognition()),
  dpiitRecognisedWithinYears: spec(
    'Inside the benefit window running from the date of DPIIT recognition — s.80-IAC, angel-tax relief, labour self-certification.',
    z.number().int().positive().max(25),
    (years) => dpiitRecognisedWithinYears(years),
  ),

  // ------------------------------------------------------------ labour / misc
  hasEpfoEnrollment: spec('Holds an EPFO establishment code (PF).', NONE, () => hasEpfoEnrollment()),
  hasNoEpfoEnrollment: spec('Holds no EPFO establishment code.', NONE, () => hasNoEpfoEnrollment()),
  hasEsicEnrollment: spec('Holds an ESIC employer code (ESI).', NONE, () => hasEsicEnrollment()),
  hasNoEsicEnrollment: spec('Holds no ESIC employer code.', NONE, () => hasNoEsicEnrollment()),
  hasProfessionalTax: spec('Holds a Professional Tax registration.', NONE, () => hasProfessionalTax()),
  hasShopsAndEstablishment: spec('Holds a Shops and Establishments registration.', NONE, () =>
    hasShopsAndEstablishment(),
  ),
  hasTan: spec('Holds a TAN, i.e. deducts tax at source.', NONE, () => hasTan()),
  hasDirectorWithDin: spec('Has at least one serving director or partner holding a DIN/DPIN.', NONE, () =>
    hasDirectorWithDin(),
  ),
  acceptsDeposits: spec('Has outstanding loans or money received not treated as deposits.', NONE, () =>
    acceptsDeposits(),
  ),
  hasForeignTransactions: spec(
    'Has international or specified domestic transactions (transfer pricing).',
    NONE,
    () => hasForeignTransactions(),
  ),
};

export type PredicateName = keyof typeof PREDICATES;

export const predicateNames = (): string[] => Object.keys(PREDICATES).sort();

export function isKnownPredicate(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(PREDICATES, name);
}

/**
 * Resolve a stored reference into a live condition.
 *
 * Throws rather than returning null: a reference that fails to resolve means a
 * persisted overlay is referencing a predicate that no longer exists, which is
 * a deployment error and must be loud. Callers that are merely validating
 * user-supplied input should use {@link validatePredicateRef} instead.
 */
export function resolvePredicate(ref: PredicateRef): Condition {
  const spec = PREDICATES[ref.predicate];
  if (!spec) {
    throw new Error(
      `Unknown predicate "${ref.predicate}". Known predicates: ${predicateNames().join(', ')}`,
    );
  }

  const parsed = spec.args.safeParse(ref.args);
  if (!parsed.success) {
    throw new Error(
      `Invalid arguments for predicate "${ref.predicate}": ${parsed.error.issues
        .map((i) => i.message)
        .join('; ')}`,
    );
  }

  return spec.build(parsed.data as never);
}

/** Non-throwing counterpart for validating proposals before they are stored. */
export function validatePredicateRef(ref: PredicateRef): { ok: true } | { ok: false; error: string } {
  try {
    resolvePredicate(ref);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * The vocabulary as a prompt fragment. Stable ordering matters: this text sits
 * in the cached prefix of every watcher request, and reordering it would
 * invalidate the prompt cache on every run.
 */
export function describePredicates(): string {
  return predicateNames()
    .map((name) => {
      const spec = PREDICATES[name]!;
      const args = spec.args instanceof z.ZodUndefined ? 'no arguments' : describeArgs(spec.args);
      return `- ${name}(${args}): ${spec.summary}`;
    })
    .join('\n');
}

function describeArgs(schema: z.ZodTypeAny): string {
  if (schema instanceof z.ZodArray) return `array of ${describeArgs(schema.element)}`;
  if (schema instanceof z.ZodEnum) return (schema.options as string[]).join('|');
  if (schema instanceof z.ZodEffects) return describeArgs(schema.innerType());
  if (schema instanceof z.ZodObject) {
    return `{ ${Object.keys(schema.shape).join(', ')} }`;
  }
  if (schema instanceof z.ZodNumber) return 'number';
  if (schema instanceof z.ZodString) return 'string';
  return 'value';
}
