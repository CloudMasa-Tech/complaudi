/**
 * Which entity types a rule can ever apply to, derived statically from the
 * rule's own predicates.
 */
import { ALL_ENTITY_TYPES } from './conditions.ts';
import type { ComplianceRule, EntityType } from './types.ts';

/** How a rule relates to one entity type, for the reference view. */
export type RuleEntityStatus = 'ALWAYS' | 'CONTINGENT' | 'NEVER';

export type RuleEntityApplicability = Record<EntityType, RuleEntityStatus>;

export function applicableEntityTypes(rule: ComplianceRule): RuleEntityApplicability {
  const allowed = new Set<EntityType>(ALL_ENTITY_TYPES);

  for (const condition of rule.applicableWhen) {
    if (!condition.entityScope) continue;
    for (const t of allowed) {
      if (!condition.entityScope.includes(t)) allowed.delete(t);
    }
  }

  const onlyConstitution =
    rule.applicableWhen.every((c) => c.entityOnly) &&
    (rule.excludeWhen?.length ?? 0) === 0;

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
