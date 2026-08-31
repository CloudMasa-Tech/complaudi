import { financialYearsBetween, firstFinancialYearEnd, today, type FinancialYear } from '../lib/dates';
import { evaluateAll } from './evaluator';
import type { Authority, ComplianceContext, EvidenceLevel, RuleEvaluation, Severity } from './types';

export interface GeneratedItem {
  ruleCode: string;
  title: string;
  authority: Authority;
  category: string;
  form: string | null;
  legalReference: string;
  severity: Severity;
  periodKey: string;
  periodLabel: string;
  periodStart: Date;
  periodEnd: Date;
  dueDate: Date;
  penaltyNote: string;
  evidenceRequired: string[];
  evidenceLevel: EvidenceLevel;
  metadata: Record<string, unknown> | null;
}

export interface GenerateOptions {
  /** Only keep obligations whose due date falls in this window. */
  from: Date;
  to: Date;
}

export interface GenerateResult {
  items: GeneratedItem[];
  evaluations: RuleEvaluation[];
  financialYears: FinancialYear[];
  /** Set when the profile is too incomplete to produce a calendar at all. */
  blockedBy?: string;
}

/**
 * Expand every applicable rule into dated obligations.
 *
 * Rules are asked for occurrences one financial year at a time, then filtered by
 * due date — an annual filing for FY2025-26 is due in October 2026, so the FY a
 * deadline *belongs to* and the FY it *falls in* are rarely the same.
 */
export function generateCalendar(ctx: ComplianceContext, opts: GenerateOptions): GenerateResult {
  const evaluations = evaluateAll(ctx);

  // Look one FY either side of the window so filings that spill across the
  // year boundary in both directions are still produced.
  const spanStart = new Date(opts.from.getTime());
  spanStart.setUTCFullYear(spanStart.getUTCFullYear() - 2);
  const financialYears = financialYearsBetween(spanStart, opts.to);

  // Without an incorporation date there is no way to tell an obligation the
  // company genuinely owes from one that fell due before it existed. Producing
  // a calendar anyway fills the screen with filings nobody ever had to make,
  // which is worse than an empty state that says what is missing.
  const incorporatedOn = ctx.company.incorporationDate;
  if (!incorporatedOn) {
    return {
      items: [],
      evaluations,
      financialYears: [],
      blockedBy:
        'The date of incorporation is missing. Until it is recorded there is no way to tell which obligations this entity actually owes, so no calendar is generated.',
    };
  }

  const firstFyEnd = firstFinancialYearEnd(incorporatedOn);

  const items: GeneratedItem[] = [];
  const seen = new Set<string>();

  for (const { rule, applicable } of evaluations) {
    if (!applicable) continue;

    for (const fy of financialYears) {
      let occurrences;
      try {
        occurrences = rule.occurrences(fy, ctx);
      } catch (err) {
        // One malformed rule must not take the whole calendar down.
        throw new Error(`Rule ${rule.code} failed to generate occurrences for ${fy.key}: ${(err as Error).message}`);
      }

      for (const occ of occurrences) {
        if (occ.dueDate < opts.from || occ.dueDate > opts.to) continue;

        // The period closed, or the filing fell due, before incorporation.
        if (occ.periodEnd < incorporatedOn || occ.dueDate < incorporatedOn) continue;
        // Accounts-based filings start with the first financial year, which may
        // absorb the year incorporation falls in — see s.2(41).
        if (rule.basedOnAnnualAccounts && occ.periodEnd < firstFyEnd) continue;

        const dedupeKey = `${rule.code}::${occ.periodKey}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        items.push({
          ruleCode: rule.code,
          title: occ.title ?? rule.title,
          authority: rule.authority,
          category: rule.category,
          form: rule.form ?? null,
          legalReference: rule.legalReference,
          severity: rule.severity,
          periodKey: occ.periodKey,
          periodLabel: occ.periodLabel,
          periodStart: occ.periodStart,
          periodEnd: occ.periodEnd,
          dueDate: occ.dueDate,
          penaltyNote: rule.penalty,
          evidenceRequired: rule.evidenceRequired,
          evidenceLevel: rule.evidenceLevel,
          metadata: occ.metadata ?? null,
        });
      }
    }
  }

  items.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.ruleCode.localeCompare(b.ruleCode));
  return { items, evaluations, financialYears };
}

export type DerivedStatus = 'UPCOMING' | 'DUE' | 'OVERDUE' | 'COMPLETED';

/** How many days out an item stops being "upcoming" and starts being "due". */
export const DUE_SOON_DAYS = 7;

export function deriveStatus(dueDate: Date, completedAt: Date | null, asOf: Date = today()): DerivedStatus {
  if (completedAt) return 'COMPLETED';
  const days = Math.round((dueDate.getTime() - asOf.getTime()) / 86_400_000);
  if (days < 0) return 'OVERDUE';
  if (days <= DUE_SOON_DAYS) return 'DUE';
  return 'UPCOMING';
}
