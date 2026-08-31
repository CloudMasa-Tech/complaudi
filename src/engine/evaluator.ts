import { allRules, getRule } from './catalog';
import type { ComplianceContext, ComplianceRule, ConditionResult, RuleEvaluation } from './types';

/**
 * Decide whether a rule applies, and record *why*.
 *
 * The reason trace is the point: a compliance tool that says "you must file
 * GSTR-9C" without saying "because your turnover crossed ₹5 crore" is not
 * auditable, and the user cannot tell a real obligation from a bad assumption.
 */
export function evaluateRule(rule: ComplianceRule, ctx: ComplianceContext): RuleEvaluation {
  const reasons: ConditionResult[] = [];

  let applicable = true;
  for (const condition of rule.applicableWhen) {
    const passed = condition.test(ctx);
    reasons.push({ label: condition.label, passed, negated: false });
    if (!passed) applicable = false;
  }

  // Carve-outs are only worth evaluating — and showing — if the rule got this far.
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

/** Explain one rule for a company — powers the "why does this apply to me?" endpoint. */
export function explainRule(code: string, ctx: ComplianceContext): RuleEvaluation | null {
  const rule = getRule(code);
  return rule ? evaluateRule(rule, ctx) : null;
}
