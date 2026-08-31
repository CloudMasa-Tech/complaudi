import type { Authority, ComplianceRule } from '../types';
import { gstRules } from './gst';
import { incomeTaxRules } from './incomeTax';
import { labourRules } from './labour';
import { mcaRules } from './mca';
import { msmeRules } from './msme';

export const allRules: ComplianceRule[] = [
  ...mcaRules,
  ...gstRules,
  ...incomeTaxRules,
  ...msmeRules,
  ...labourRules,
];

const byCode = new Map(allRules.map((r) => [r.code, r]));

// Rule codes are persisted on every compliance item, so a duplicate would
// silently merge two different obligations. Fail at import time instead.
if (byCode.size !== allRules.length) {
  const seen = new Set<string>();
  const dupes = allRules.map((r) => r.code).filter((c) => (seen.has(c) ? true : (seen.add(c), false)));
  throw new Error(`Duplicate compliance rule codes: ${[...new Set(dupes)].join(', ')}`);
}

export function getRule(code: string): ComplianceRule | undefined {
  return byCode.get(code);
}

export function rulesByAuthority(authority: Authority): ComplianceRule[] {
  return allRules.filter((r) => r.authority === authority);
}

export { gstRules, incomeTaxRules, labourRules, mcaRules, msmeRules };
