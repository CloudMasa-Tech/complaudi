import { formatDate, today } from '../../lib/dates';
import { inr } from '../../engine/conditions';
import { evaluateRule } from '../../engine/evaluator';
import { prisma } from '../../lib/prisma';
import { buildContext } from '../compliance/compliance.service';
import { getCompanyOrThrow } from '../companies/companies.service';
import type { Actor } from '../../lib/access';
import { retrieveRules, type Retrieved } from './retrieval';

export interface Citation {
  ruleCode: string;
  title: string;
  form: string | null;
  authority: string;
  legalReference: string;
  severity: string;
  penalty: string;
  appliesToThisCompany: boolean | null;
  reasons: Array<{ label: string; passed: boolean; negated: boolean }> | null;
  nextDueDate: string | null;
  nextDueStatus: string | null;
}

export interface CopilotAnswer {
  question: string;
  answer: string;
  citations: Citation[];
  companyId: string | null;
  provider: string;
  /** How much of the question the retrieval actually matched. */
  confidence: 'high' | 'medium' | 'low';
  disclaimer: string;
}

export interface Grounding {
  question: string;
  retrieved: Retrieved[];
  company: Awaited<ReturnType<typeof getCompanyOrThrow>> | null;
  citations: Citation[];
}

/**
 * A copilot backend. The rule-grounded implementation below needs no external
 * service; swapping in an LLM means implementing this one method and letting it
 * write the prose from the same `Grounding` object, so citations stay accurate.
 */
export interface CopilotProvider {
  readonly name: string;
  answer(grounding: Grounding): Promise<{ answer: string; confidence: CopilotAnswer['confidence'] }>;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-09-15" reads as a database value; "15 Sep 2026" reads as a deadline. */
function readableDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}

const DISCLAIMER =
  'This is generated from the built-in rule engine and your recorded company profile. It is general guidance, not professional advice — confirm state-specific dates and edge cases with your chartered accountant or company secretary.';

function describeCompany(company: NonNullable<Grounding['company']>): string {
  const bits = [
    company.entityType.replace(/_/g, ' ').toLowerCase(),
    `turnover ${inr(Number(company.annualTurnover))}`,
    `${company.employeeCount} employee${company.employeeCount === 1 ? '' : 's'}`,
    `registered in ${company.stateCode}`,
  ];
  if (company.gstRegistrations.length) bits.push(`${company.gstRegistrations.length} GST registration(s)`);
  if (company.msmeRegistration) bits.push('Udyam registered');
  return bits.join(', ');
}

/**
 * Composes the answer from retrieved rules and the company's own evaluation.
 * Deterministic, fully cited, and available with no API key configured.
 */
export class RuleGroundedCopilot implements CopilotProvider {
  readonly name = 'rule-grounded';

  async answer(grounding: Grounding): Promise<{ answer: string; confidence: CopilotAnswer['confidence'] }> {
    const { retrieved, citations, company } = grounding;

    if (retrieved.length === 0) {
      return {
        answer:
          'I could not match that question to anything in the rule engine. Try naming a form (AOC-4, GSTR-3B, Form 11), an authority (MCA, GST, income tax, MSME, labour), or a topic such as "director KYC", "tax audit" or "provident fund".',
        confidence: 'low',
      };
    }

    const top = retrieved[0]!;
    const topCitation = citations.find((c) => c.ruleCode === top.rule.code);
    const lines: string[] = [];

    if (company) lines.push(`For ${company.legalName} — ${describeCompany(company)}:`, '');

    // Several titles already name their form — "Issue TDS certificates (Form 16A)"
    // — so only append it when it is not there already.
    const name = (c: Citation) =>
      c.form && !c.title.toLowerCase().includes(c.form.toLowerCase()) ? `${c.title} (${c.form})` : c.title;

    const detail = (c: Citation): string[] => {
      const out = [`• ${name(c)}`, `  ${c.legalReference} — ${c.severity.toLowerCase()} priority.`];
      if (c.nextDueDate) out.push(`  Next due ${readableDate(c.nextDueDate)} (currently ${c.nextDueStatus?.toLowerCase()}).`);
      out.push(`  If missed: ${c.penalty}`, '');
      return out;
    };

    /** The conditions that actually decided a "no" — an unmet requirement, or a met exemption. */
    const decidingReasons = (c: Citation): string[] =>
      (c.reasons ?? [])
        .filter((r) => (r.negated ? r.passed : !r.passed))
        .map((r) => (r.negated ? `Exempt because ${r.label.replace(/^Exempt: /, '')}` : `Not met: ${r.label}`));

    const applicable = citations.filter((c) => c.appliesToThisCompany !== false);
    const notApplicable = citations.filter((c) => c.appliesToThisCompany === false);

    // When the closest match to the question does not apply, that *is* the
    // answer — lead with it rather than burying it under adjacent rules.
    if (topCitation && topCitation.appliesToThisCompany === false) {
      lines.push(`${name(topCitation)} does not apply${company ? ` to ${company.legalName}` : ''}.`);
      for (const reason of decidingReasons(topCitation)) lines.push(`  • ${reason}`);
      lines.push('');

      if (applicable.length > 0) {
        lines.push('Related obligations that do apply:', '');
        for (const c of applicable.slice(0, 3)) lines.push(...detail(c));
      }
    } else {
      for (const c of applicable.slice(0, 4)) lines.push(...detail(c));

      const others = notApplicable.filter((c) => c.ruleCode !== topCitation?.ruleCode);
      if (others.length > 0) {
        lines.push(`Also matched but not applicable to you: ${others.map((c) => c.title).join('; ')}.`, '');
      }
    }

    const confidence: CopilotAnswer['confidence'] = top.score >= 12 ? 'high' : top.score >= 5 ? 'medium' : 'low';
    return { answer: lines.join('\n').trim(), confidence };
  }
}

let provider: CopilotProvider = new RuleGroundedCopilot();

/** Swap in an LLM-backed provider at boot without touching the route layer. */
export function setCopilotProvider(next: CopilotProvider): void {
  provider = next;
}

export function getCopilotProvider(): CopilotProvider {
  return provider;
}

/** Builds grounding, then hands it to whichever provider is installed. */
export async function ask(
  actor: Actor,
  question: string,
  companyId?: string | null,
): Promise<CopilotAnswer> {
  const retrieved = retrieveRules(question);
  const company = companyId ? await getCompanyOrThrow(actor, companyId) : null;
  const ctx = company ? buildContext(company) : null;

  // Pull the next open occurrence of each retrieved rule so the answer can say
  // "due 30 October" rather than only "due 30 days after the AGM".
  const nextItems = company
    ? await prisma.complianceItem.findMany({
        where: {
          companyId: company.id,
          ruleCode: { in: retrieved.map((r) => r.rule.code) },
          status: { notIn: ['COMPLETED', 'WAIVED'] },
          dueDate: { gte: today() },
        },
        orderBy: { dueDate: 'asc' },
        select: { ruleCode: true, dueDate: true, status: true },
      })
    : [];

  const nextByRule = new Map<string, { dueDate: Date; status: string }>();
  for (const item of nextItems) if (!nextByRule.has(item.ruleCode)) nextByRule.set(item.ruleCode, item);

  const citations: Citation[] = retrieved.map(({ rule }) => {
    const evaluation = ctx ? evaluateRule(rule, ctx) : null;
    const next = nextByRule.get(rule.code);
    return {
      ruleCode: rule.code,
      title: rule.title,
      form: rule.form ?? null,
      authority: rule.authority,
      legalReference: rule.legalReference,
      severity: rule.severity,
      penalty: rule.penalty,
      appliesToThisCompany: evaluation ? evaluation.applicable : null,
      reasons: evaluation ? evaluation.reasons : null,
      nextDueDate: next ? formatDate(next.dueDate) : null,
      nextDueStatus: next?.status ?? null,
    };
  });

  const active = getCopilotProvider();
  const { answer, confidence } = await active.answer({ question, retrieved, company, citations });

  return {
    question,
    answer,
    citations,
    companyId: company?.id ?? null,
    provider: active.name,
    confidence,
    disclaimer: DISCLAIMER,
  };
}

/** Full-text-ish search over the catalog, for a "browse the regulations" view. */
export function searchKnowledgeBase(query: string, limit = 20) {
  return retrieveRules(query, limit).map(({ rule, score, matchedTerms }) => ({
    score: Math.round(score * 100) / 100,
    matchedTerms,
    code: rule.code,
    title: rule.title,
    authority: rule.authority,
    category: rule.category,
    form: rule.form ?? null,
    legalReference: rule.legalReference,
    description: rule.description,
    severity: rule.severity,
    penalty: rule.penalty,
    evidenceRequired: rule.evidenceRequired,
    periodKind: rule.periodKind,
  }));
}
