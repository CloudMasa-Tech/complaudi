/**
 * `npm run rules:list` — inspect the catalog without booting the server.
 * Useful when reviewing coverage against a statutory checklist.
 */
import { allRules } from './catalog';

const authority = process.argv[2]?.toUpperCase();
const rules = authority ? allRules.filter((r) => r.authority === authority) : allRules;

const byAuthority = new Map<string, typeof rules>();
for (const rule of rules) {
  byAuthority.set(rule.authority, [...(byAuthority.get(rule.authority) ?? []), rule]);
}

for (const [auth, group] of byAuthority) {
  console.log(`\n${auth}  (${group.length} rules)`);
  console.log('─'.repeat(80));
  for (const rule of group.sort((a, b) => a.code.localeCompare(b.code))) {
    const form = rule.form ? ` [${rule.form}]` : '';
    console.log(`  ${rule.code.padEnd(28)} ${rule.severity.padEnd(9)} ${rule.title}${form}`);
    console.log(`  ${' '.repeat(28)} ${rule.legalReference}`);
    console.log(`  ${' '.repeat(28)} applies when: ${rule.applicableWhen.map((c) => c.label).join('; ')}`);
    if (rule.excludeWhen?.length) {
      console.log(`  ${' '.repeat(28)} except when: ${rule.excludeWhen.map((c) => c.label).join('; ')}`);
    }
    console.log('');
  }
}

console.log(`\nTotal: ${rules.length} rules across ${byAuthority.size} authorities.\n`);
