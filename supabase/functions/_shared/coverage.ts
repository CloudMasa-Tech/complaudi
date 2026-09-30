/**
 * How much of a company's evidence is actually on file.
 *
 * Pure, and shared: this was written twice and the two disagreed completely.
 * The edge implementation divided by every obligation and counted "this rule
 * requires evidence" as "this obligation has evidence" — the opposite of what
 * it means — so a company with no documents at all reported 60% coverage, and
 * the obligations it listed as missing evidence were the ones that need none.
 *
 * Mirrored verbatim into supabase/functions/_shared/coverage.ts, with
 * tests/coverage.test.ts comparing the two.
 */

/** The obligations an evidence requirement can attach to. */
export interface CoverageItem {
  id: string;
  title: string;
  ruleCode: string;
  status: string;
  dueDate: Date | string;
  /** Which documents this obligation expects — Udyam certificate, GST
   *  acknowledgement, DIR-3 KYC receipt, and so on. Empty means none. */
  evidenceRequired: string[];
}

export interface Coverage {
  totalItems: number;
  itemsRequiringEvidence: number;
  itemsWithEvidence: number;
  coveragePct: number;
  missing: Array<{
    id: string;
    title: string;
    ruleCode: string;
    status: string;
    dueDate: Date | string;
    expected: string[];
  }>;
}

/** Statuses where missing evidence is a real gap rather than work not yet due. */
const CHASEABLE = new Set(['COMPLETED', 'OVERDUE']);

/**
 * @param items          every obligation on the company
 * @param documentedIds  ids of obligations with at least one file attached
 */
export function computeCoverage(items: CoverageItem[], documentedIds: Set<string>): Coverage {
  const withRequirements = items.filter((i) => (i.evidenceRequired?.length ?? 0) > 0);
  const complete = withRequirements.filter((i) => documentedIds.has(i.id));

  return {
    totalItems: items.length,
    itemsRequiringEvidence: withRequirements.length,
    itemsWithEvidence: complete.length,
    // Nothing to evidence is complete, not zero — a company with no evidence
    // requirements has nothing outstanding.
    coveragePct:
      withRequirements.length === 0
        ? 100
        : Math.round((complete.length / withRequirements.length) * 100),
    // Only what can actually be chased: already completed or overdue, and
    // nothing filed. An obligation that is not due yet is not a gap.
    missing: withRequirements
      .filter((i) => !documentedIds.has(i.id) && CHASEABLE.has(i.status))
      .map((i) => ({
        id: i.id,
        title: i.title,
        ruleCode: i.ruleCode,
        status: i.status,
        dueDate: i.dueDate,
        expected: i.evidenceRequired,
      })),
  };
}
