/**
 * Which entity types a rule can ever apply to, derived statically from the
 * rule's own predicates.
 *
 * No company data is consulted: this answers "if you were an X, could this
 * obligation ever be yours?", which is what a constitution-by-constitution
 * review of the catalog needs. The determination is deliberately coarse in two
 * places:
 *
 *  - `custom(...)` closures carry no metadata, so a rule whose entity logic
 *    lives only inside a closure is reported as possible for every type, with
 *    CONTINGENT so the page still flags that its applicability varies. Four
 *    rules hit this today: MCA_MGT7A, MCA_BOARD_MEETING_SMALL, IT_ITR_AUDITED
 *    and IT_ITR_NON_AUDITED (the small-company / auditability logic).
 *  - value-dependent carve-outs in `excludeWhen` (e.g. isSmallCompany) keep
 *    the type as CONTINGENT rather than disappearing it, because a company of
 *    that type *can* owe the obligation depending on its facts. Only a pure
 *    entity condition in excludeWhen cuts the type out entirely.
 */
import { ALL_ENTITY_TYPES } from './conditions';
import type { ComplianceRule, EntityType } from './types';

/** How a rule relates to one entity type, for the reference view. */
export type RuleEntityStatus = 'ALWAYS' | 'CONTINGENT' | 'NEVER';

export type RuleEntityApplicability = Record<EntityType, RuleEntityStatus>;

export function applicableEntityTypes(rule: ComplianceRule): RuleEntityApplicability {
  const allowed = new Set<EntityType>(ALL_ENTITY_TYPES);

  // In `applicableWhen`, every scope-bearing condition is a constraint: an
  // entity outside its scope can never satisfy it, so it can never be in the
  // calendar.
  for (const condition of rule.applicableWhen) {
    if (!condition.entityScope) continue;
    for (const t of allowed) {
      if (!condition.entityScope.includes(t)) allowed.delete(t);
    }
  }

  // A type that qualifies purely on its constitution is ALWAYS. Any
  // value-dependent gate anywhere (turnover, GST status, employees) — or any
  // exemption, contingent or not — makes it CONTINGENT instead.
  const onlyConstitution =
    rule.applicableWhen.every((c) => c.entityOnly) &&
    (rule.excludeWhen?.length ?? 0) === 0;

  // In `excludeWhen`, only a pure entity condition carves types out
  // categorically (an OPC never files MGT-7). Value-dependent exemptions are
  // not subtracted here — that is exactly what the CONTINGENT flag captures.
  for (const condition of rule.excludeWhen ?? []) {
    if (condition.entityOnly && condition.entityScope) {
      for (const t of condition.entityScope) allowed.delete(t);
    }
  }

  const result = {} as RuleEntityApplicability;
  for (const t of ALL_ENTITY_TYPES) {
    result[t] = allowed.has(t) ? (onlyConstitution ? 'ALWAYS' : 'CONTINGENT') : 'NEVER';
  }
  return result;
}