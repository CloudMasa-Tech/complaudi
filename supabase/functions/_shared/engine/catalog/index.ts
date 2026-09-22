// supabase/functions/_shared/engine/catalog/index.ts
import type { Authority, ComplianceRule } from '../types.ts';
import { gstRules } from './gst.ts';
import { incomeTaxRules } from './incomeTax.ts';
import { labourRules } from './labour.ts';
import { mcaRules } from './mca.ts';
import { msmeRules } from './msme.ts';

export const allRules: ComplianceRule[] = [
  ...mcaRules,
  ...gstRules,
  ...incomeTaxRules,
  ...msmeRules,
  ...labourRules,
];

const byCode = new Map(allRules.map((r) => [r.code, r]));

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
