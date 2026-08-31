/**
 * Retrieval over the rule engine.
 *
 * The catalog is the knowledge base: every rule carries its statutory
 * reference, description, penalty and evidence list, so an answer grounded in
 * it can always be traced back to a section number. This is the retrieval half
 * of the RAG box in the architecture — the generation half is pluggable.
 */
import { allRules } from '../../engine/catalog';
import type { ComplianceRule } from '../../engine/types';

/** Terms users actually type, mapped to the vocabulary the catalog uses. */
const SYNONYMS: Record<string, string[]> = {
  roc: ['mca', 'registrar', 'companies'],
  mca: ['roc', 'registrar', 'companies'],
  annual: ['yearly', 'annual'],
  return: ['filing', 'return'],
  filing: ['return', 'file'],
  audit: ['audited', 'auditor', 'audit'],
  tds: ['deducted', 'source', 'deduction', '24q', '26q'],
  tcs: ['collected', 'source'],
  itr: ['income', 'tax', 'return'],
  pf: ['provident', 'epf', 'ecr'],
  epf: ['provident', 'pf', 'ecr'],
  esi: ['insurance', 'state'],
  posh: ['harassment', 'internal', 'committee'],
  msme: ['udyam', 'micro', 'small', 'enterprise'],
  udyam: ['msme', 'micro', 'small'],
  gst: ['gstr', 'goods', 'services'],
  director: ['din', 'kyc', 'directors'],
  penalty: ['fine', 'late', 'fee'],
  deadline: ['due', 'date'],
  llp: ['partnership', 'limited', 'liability'],
  invoice: ['einvoice', 'irn', 'billing'],
  bonus: ['payment', 'bonus'],
  salary: ['payroll', 'employee', 'wages'],
};

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'do', 'does', 'did', 'for', 'of', 'to', 'in', 'on', 'and', 'or',
  'my', 'our', 'we', 'i', 'what', 'when', 'which', 'how', 'need', 'needs', 'have', 'has', 'be', 'should', 'must',
  'can', 'about', 'me', 'you', 'it', 'this', 'that', 'with', 'as', 'if', 'am', 'any', 'all',
]);

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));

function expand(tokens: string[]): string[] {
  const out = new Set(tokens);
  for (const token of tokens) for (const syn of SYNONYMS[token] ?? []) out.add(syn);
  return [...out];
}

/** Weighted fields — a hit in the title or form name means more than one in the body. */
function ruleText(rule: ComplianceRule): { field: string; weight: number }[] {
  return [
    { field: rule.title, weight: 3 },
    { field: rule.form ?? '', weight: 4 },
    { field: rule.code.replace(/_/g, ' '), weight: 3 },
    { field: rule.category, weight: 2 },
    { field: rule.authority, weight: 2 },
    { field: rule.legalReference, weight: 2 },
    { field: rule.description, weight: 1 },
    { field: rule.penalty, weight: 0.5 },
    { field: rule.evidenceRequired.join(' '), weight: 0.5 },
  ];
}

export interface Retrieved {
  rule: ComplianceRule;
  score: number;
  matchedTerms: string[];
}

export function retrieveRules(question: string, limit = 6): Retrieved[] {
  const terms = expand(tokenize(question));
  if (terms.length === 0) return [];

  const scored = allRules.map((rule) => {
    const fields = ruleText(rule);
    let score = 0;
    const matched = new Set<string>();

    for (const term of terms) {
      for (const { field, weight } of fields) {
        const haystack = field.toLowerCase();
        if (!haystack.includes(term)) continue;
        // Whole-word hits outrank substring hits.
        const whole = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(haystack);
        score += weight * (whole ? 1 : 0.4);
        matched.add(term);
      }
    }

    // Reward breadth of match so a rule hitting three query terms beats one
    // hitting a single term three times.
    score *= 1 + matched.size * 0.25;
    return { rule, score, matchedTerms: [...matched] };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
