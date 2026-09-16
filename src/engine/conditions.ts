import type { Condition, EntityType, GstFilingFrequency } from './types';

export const CRORE = 10_000_000;
export const LAKH = 100_000;

/** Format an INR amount the way an Indian accountant would read it. */
export function inr(amount: number): string {
  if (amount >= CRORE) {
    const cr = amount / CRORE;
    return `₹${Number.isInteger(cr) ? cr : cr.toFixed(2)} crore`;
  }
  if (amount >= LAKH) {
    const l = amount / LAKH;
    return `₹${Number.isInteger(l) ? l : l.toFixed(2)} lakh`;
  }
  return `₹${amount.toLocaleString('en-IN')}`;
}

const ENTITY_LABELS: Record<EntityType, string> = {
  PRIVATE_LIMITED: 'Private Limited Company',
  PUBLIC_LIMITED: 'Public Limited Company',
  OPC: 'One Person Company',
  LLP: 'Limited Liability Partnership',
  PARTNERSHIP: 'Partnership Firm',
  PROPRIETORSHIP: 'Sole Proprietorship',
  SECTION_8: 'Section 8 Company',
};

export const entityLabel = (t: EntityType): string => ENTITY_LABELS[t] ?? t;

// ------------------------------------------------------------------ builders

export const always = (label = 'Applies to every registered entity'): Condition => ({
  label,
  test: () => true,
});

/**
 * Every constitution the toolkit knows. Used as the universe for derived
 * entity-type metadata (see engine/entityApplicability.ts).
 */
export const ALL_ENTITY_TYPES: EntityType[] = [
  'PRIVATE_LIMITED',
  'PUBLIC_LIMITED',
  'OPC',
  'LLP',
  'PARTNERSHIP',
  'PROPRIETORSHIP',
  'SECTION_8',
];

const asSet = (types: EntityType[]): EntityType[] => [...new Set(types)];

export const entityIs = (...types: EntityType[]): Condition => ({
  label: `Entity is a ${types.map(entityLabel).join(' or ')}`,
  test: (ctx) => types.includes(ctx.company.entityType),
  entityScope: asSet(types),
  entityOnly: true,
});

/** Companies Act entities — everything registered with the RoC under the 2013 Act. */
export const isCompaniesActEntity = (): Condition =>
  entityIs('PRIVATE_LIMITED', 'PUBLIC_LIMITED', 'OPC', 'SECTION_8');

export const turnoverAtLeast = (amount: number): Condition => ({
  label: `Annual turnover is ${inr(amount)} or more`,
  test: (ctx) => ctx.company.annualTurnover >= amount,
});

export const turnoverBelow = (amount: number): Condition => ({
  label: `Annual turnover is below ${inr(amount)}`,
  test: (ctx) => ctx.company.annualTurnover < amount,
});

export const paidUpCapitalAtLeast = (amount: number): Condition => ({
  label: `Paid-up share capital is ${inr(amount)} or more`,
  test: (ctx) => ctx.company.paidUpCapital >= amount,
});

export const employeesAtLeast = (n: number): Condition => ({
  label: `Has ${n} or more employees`,
  test: (ctx) => ctx.company.employeeCount >= n,
});

export const hasGstRegistration = (): Condition => ({
  label: 'Has at least one active GST registration',
  test: (ctx) => ctx.gstRegistrations.some((g) => g.isActive),
});

export const anyGstFrequencyIs = (...freqs: GstFilingFrequency[]): Condition => ({
  label: `Files GST under the ${freqs.join(' / ')} scheme`,
  test: (ctx) => ctx.gstRegistrations.some((g) => g.isActive && freqs.includes(g.filingFrequency)),
});

export const anyGstDeductsTds = (): Condition => ({
  label: 'Registered as a GST TDS deductor',
  test: (ctx) => ctx.gstRegistrations.some((g) => g.isActive && g.isTdsDeductor),
});

export const anyGstIsEcommerceOperator = (): Condition => ({
  label: 'Registered as an e-commerce operator collecting TCS',
  test: (ctx) => ctx.gstRegistrations.some((g) => g.isActive && g.isEcommerceOperator),
});

export const hasMsmeRegistration = (): Condition => ({
  label: 'Holds a Udyam (MSME) registration',
  test: (ctx) => ctx.msme !== null,
});

/**
 * Mandatory GST registration: a supplier of goods or services must register
 * once turnover crosses the threshold. The engine holds only total turnover,
 * not the goods-vs-services split, so the strictest services threshold (₹20
 * lakh) drives the reminder; the rule's description carries the goods nuance.
 */
export const crossesGstRegistrationThreshold = (): Condition => ({
  label: 'Annual turnover is ₹20 lakh or more — the mandatory GST registration threshold for services',
  test: (ctx) => ctx.company.annualTurnover >= 20 * LAKH,
});

/** The other side of the gate — a company the engine is warning, not tracking. */
export const hasNoGstRegistration = (): Condition =>
  not(hasGstRegistration(), 'Has no active GST registration');

export const hasNoEpfoEnrollment = (): Condition =>
  custom('No EPFO establishment code on record', (ctx) => !ctx.company.epfoCode);

export const hasNoEsicEnrollment = (): Condition =>
  custom('No ESIC employer code on record', (ctx) => !ctx.company.esicCode);

export const hasTan = (): Condition => ({
  label: 'Holds a TAN (deducts tax at source)',
  test: (ctx) => Boolean(ctx.company.tan),
});

export const hasDirectorWithDin = (): Condition => ({
  label: 'Has at least one director/partner holding a DIN or DPIN',
  test: (ctx) => ctx.directors.some((d) => Boolean(d.din) && !d.resignedOn),
});

export const acceptsDeposits = (): Condition => ({
  label: 'Has outstanding loans or money received not treated as deposits',
  test: (ctx) => ctx.company.acceptsDeposits,
});

export const buysFromMsmeSuppliers = (): Condition => ({
  label: 'Procures goods or services from MSME-registered suppliers',
  test: (ctx) => ctx.company.buysFromMsmeSuppliers,
});

export const hasForeignTransactions = (): Condition => ({
  label: 'Has international or specified domestic transactions (transfer pricing)',
  test: (ctx) => ctx.company.hasForeignTransactions,
});

export const isListed = (): Condition => ({
  label: 'Is a listed company',
  test: (ctx) => ctx.company.isListed,
});

/**
 * Tax audit threshold under s.44AB: ₹1 crore, relaxed to ₹10 crore when both
 * cash receipts and cash payments stay within 5% of the total.
 */
export const crossesTaxAuditThreshold = (): Condition => ({
  label: 'Turnover crosses the s.44AB tax-audit threshold (₹1 crore, or ₹10 crore if cash dealings ≤ 5%)',
  test: (ctx) => {
    const threshold = ctx.company.cashTransactionRatioBelow5Pct ? 10 * CRORE : 1 * CRORE;
    return ctx.company.annualTurnover >= threshold;
  },
});

/** LLP audit is required above ₹40 lakh turnover or ₹25 lakh contribution. */
export const llpCrossesAuditThreshold = (): Condition => ({
  label: 'LLP turnover exceeds ₹40 lakh or contribution exceeds ₹25 lakh',
  test: (ctx) => ctx.company.annualTurnover > 40 * LAKH || ctx.company.paidUpCapital > 25 * LAKH,
});

/** A custom escape hatch, so the catalog never has to reach for `any`. */
export const custom = (label: string, test: Condition['test']): Condition => ({ label, test });

export const not = (c: Condition, label?: string): Condition => ({
  label: label ?? `NOT — ${c.label}`,
  test: (ctx) => !c.test(ctx),
  ...(c.entityScope
    ? { entityScope: ALL_ENTITY_TYPES.filter((t) => !c.entityScope!.includes(t)) }
    : {}),
});

export const anyOf = (label: string, ...conditions: Condition[]): Condition => {
  // A branch without an entityScope is agnostic — it could be satisfied by any
  // constitution (e.g. isSmallCompany). One such branch makes the whole
  // condition agnostic too; only when every branch names its scope does the
  // union narrow to something a reviewer can act on.
  const allScoped = conditions.every((c) => c.entityScope !== undefined);
  return {
    label,
    test: (ctx) => conditions.some((c) => c.test(ctx)),
    ...(allScoped ? { entityScope: asSet(conditions.flatMap((c) => c.entityScope!)) } : {}),
  };
};
