// supabase/functions/_shared/engine/evaluator.ts
import { allRules, getRule } from './catalog/index.ts';
import type { ComplianceContext, ComplianceRule, ConditionResult, RuleEvaluation } from './types.ts';

export function evaluateRule(rule: ComplianceRule, ctx: ComplianceContext): RuleEvaluation {
  const reasons: ConditionResult[] = [];

  let applicable = true;
  for (const condition of rule.applicableWhen) {
    const passed = condition.test(ctx);
    reasons.push({ label: condition.label, passed, negated: false });
    if (!passed) applicable = false;
  }

  if (applicable && rule.excludeWhen?.length) {
    for (const condition of rule.excludeWhen) {
      const passed = condition.test(ctx);
      reasons.push({ label: `Exempt: ${condition.label}`, passed, negated: true });
      if (passed) applicable = false;
    }
  }

  return { rule, applicable, reasons };
}

export function evaluateAll(ctx: ComplianceContext): RuleEvaluation[] {
  return allRules.map((rule) => evaluateRule(rule, ctx));
}

export function applicableRules(ctx: ComplianceContext): ComplianceRule[] {
  return evaluateAll(ctx)
    .filter((e) => e.applicable)
    .map((e) => e.rule);
}

export function explainRule(code: string, ctx: ComplianceContext): RuleEvaluation | null {
  const rule = getRule(code);
  return rule ? evaluateRule(rule, ctx) : null;
}
