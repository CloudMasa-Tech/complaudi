/**
 * Data-only amendments layered on top of the static rule catalog.
 *
 * Indian statutory deadlines move constantly — an MCA general circular extends
 * AOC-4 by thirty days, a notification lifts an e-invoicing threshold from ₹5
 * crore to ₹1 crore, an amendment rule carves OPCs out of a form. None of that
 * is worth a deploy, and waiting for one means the calendar is wrong in the
 * meantime.
 *
 * An overlay expresses such a change as *data*: text replacements, a due-date
 * shift, a suspension window, or applicability conditions named from the closed
 * predicate registry. It can never introduce executable logic, so the blast
 * radius of a bad overlay is bounded by what this file is able to express.
 *
 * Everything here is pure. `applyOverlays` takes rules and overlays and returns
 * new rules; it reads no database and no clock beyond the `asOf` it is handed.
 * The one mutable cell is the registry at the bottom, which the runtime layer
 * fills from the database — the engine never reaches out for it.
 */
import type { FinancialYear } from '../lib/dates';
import { resolvePredicate, type PredicateRef } from './predicates';
import type {
  ComplianceContext,
  ComplianceRule,
  Condition,
  EvidenceLevel,
  Occurrence,
  RuleAmendment,
  Severity,
} from './types';

/**
 * What an overlay is allowed to change. Every field is optional; an overlay
 * typically sets one or two.
 */
export interface RuleOverlayPatch {
  // -------------------------------------------------------------- narrative
  title?: string;
  description?: string;
  penalty?: string;
  legalReference?: string;
  category?: string;
  form?: string;
  severity?: Severity;

  // --------------------------------------------------------------- evidence
  evidenceLevel?: EvidenceLevel;
  evidenceRequired?: string[];
  signatoryRequired?: boolean;

  // ------------------------------------------------------------- scheduling
  /**
   * Move every due date by N days. The ordinary shape of an MCA or CBDT
   * extension: "the due date stands extended by 30 days". Negative values pull
   * a deadline forward.
   */
  dueDateShiftDays?: number;
  /**
   * Replace the due date of specific occurrences outright, keyed by
   * `periodKey`. Use when a circular names one period — "for FY 2025-26 only,
   * the due date shall be 30 November 2026". Takes precedence over a shift.
   */
  dueDateOverrides?: Record<string, string>;
  /**
   * Waive obligations *falling due* inside this window, inclusive. For a
   * genuine relaxation where the filing is not required at all; an extension is
   * a shift, not a suspension.
   */
  suspendedFrom?: string;
  suspendedTo?: string;

  // ---------------------------------------------------------- applicability
  /** Additional conditions that must all pass. Narrows who the rule applies to. */
  addApplicableWhen?: PredicateRef[];
  /** Additional carve-outs. Any passing condition switches the rule off. */
  addExcludeWhen?: PredicateRef[];
  /**
   * Drop existing conditions by their exact `label`. This is how a threshold
   * change is expressed: remove "Annual turnover is ₹5 crore or more", add
   * `turnoverAtLeast(10000000)`.
   */
  removeConditionLabels?: string[];

  // -------------------------------------------------------------- lifecycle
  /**
   * The obligation no longer exists. The rule is kept and evaluated so its
   * history and reason trace survive, but it is switched off with a carve-out
   * that always passes — the user sees *why* it stopped applying.
   */
  withdrawn?: boolean;
  /** Shown on the carve-out when `withdrawn` is set. */
  withdrawnReason?: string;
}

export interface RuleOverlay {
  id: string;
  ruleCode: string;
  patch: RuleOverlayPatch;
  /** Null means "since forever" / "until further notice". */
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  note: string | null;
}

const toUtcDate = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

/** Is this overlay in force on the given date? */
export function isOverlayInForce(overlay: RuleOverlay, asOf: Date): boolean {
  if (overlay.effectiveFrom && asOf < overlay.effectiveFrom) return false;
  if (overlay.effectiveTo && asOf > overlay.effectiveTo) return false;
  return true;
}

/**
 * Compose the occurrence function with the patch's scheduling changes.
 *
 * Order is deliberate: a per-period override names an exact date and wins over
 * a blanket shift, and suspension is applied last against the *final* due date,
 * because the question a waiver answers is "did anything fall due in the
 * window", not "would it have, before the extension".
 */
function patchOccurrences(
  base: ComplianceRule['occurrences'],
  patch: RuleOverlayPatch,
): ComplianceRule['occurrences'] {
  const { dueDateShiftDays, dueDateOverrides, suspendedFrom, suspendedTo } = patch;

  const hasSchedulingChange =
    typeof dueDateShiftDays === 'number' ||
    (dueDateOverrides && Object.keys(dueDateOverrides).length > 0) ||
    suspendedFrom ||
    suspendedTo;

  if (!hasSchedulingChange) return base;

  const from = suspendedFrom ? toUtcDate(suspendedFrom) : null;
  const to = suspendedTo ? toUtcDate(suspendedTo) : null;

  return (fy: FinancialYear, ctx: ComplianceContext): Occurrence[] => {
    const out: Occurrence[] = [];

    for (const occ of base(fy, ctx)) {
      let dueDate = occ.dueDate;

      const override = dueDateOverrides?.[occ.periodKey];
      if (override) {
        dueDate = toUtcDate(override);
      } else if (typeof dueDateShiftDays === 'number' && dueDateShiftDays !== 0) {
        dueDate = new Date(occ.dueDate.getTime() + dueDateShiftDays * 86_400_000);
      }

      // A one-sided window is still a window: "suspended from 1 April" with no
      // end date waives everything from then on.
      const suspended = (from || to) && (!from || dueDate >= from) && (!to || dueDate <= to);
      if (suspended) continue;

      out.push(dueDate === occ.dueDate ? occ : { ...occ, dueDate });
    }

    return out;
  };
}

function patchConditions(existing: Condition[], remove: string[] | undefined, add: PredicateRef[] | undefined): Condition[] {
  const removals = new Set(remove ?? []);
  const kept = removals.size ? existing.filter((c) => !removals.has(c.label)) : existing;
  const added = (add ?? []).map(resolvePredicate);
  return added.length ? [...kept, ...added] : kept;
}

/**
 * Apply one overlay to one rule. Pure: returns a new rule, never mutates.
 *
 * Throws if the patch names an unregistered predicate — see predicates.ts for
 * why that has to be loud rather than silently skipped.
 */
export function applyOverlay(rule: ComplianceRule, overlay: RuleOverlay): ComplianceRule {
  const { patch } = overlay;

  const amendment: RuleAmendment = {
    overlayId: overlay.id,
    note: overlay.note,
    effectiveFrom: overlay.effectiveFrom,
    effectiveTo: overlay.effectiveTo,
  };

  const excludeWhen = patchConditions(rule.excludeWhen ?? [], patch.removeConditionLabels, patch.addExcludeWhen);

  if (patch.withdrawn) {
    // An always-true carve-out rather than deletion: the rule still evaluates,
    // so "why is this no longer on my calendar?" has a traceable answer.
    excludeWhen.push({
      label:
        patch.withdrawnReason ??
        overlay.note ??
        'This obligation has been withdrawn and no longer applies.',
      test: () => true,
    });
  }

  return {
    ...rule,
    title: patch.title ?? rule.title,
    description: patch.description ?? rule.description,
    penalty: patch.penalty ?? rule.penalty,
    legalReference: patch.legalReference ?? rule.legalReference,
    category: patch.category ?? rule.category,
    form: patch.form ?? rule.form,
    severity: patch.severity ?? rule.severity,
    evidenceLevel: patch.evidenceLevel ?? rule.evidenceLevel,
    evidenceRequired: patch.evidenceRequired ?? rule.evidenceRequired,
    signatoryRequired: patch.signatoryRequired ?? rule.signatoryRequired,
    applicableWhen: patchConditions(
      rule.applicableWhen,
      patch.removeConditionLabels,
      patch.addApplicableWhen,
    ),
    excludeWhen: excludeWhen.length ? excludeWhen : undefined,
    occurrences: patchOccurrences(rule.occurrences, patch),
    amendments: [...(rule.amendments ?? []), amendment],
  };
}

/**
 * Apply every in-force overlay to the catalog.
 *
 * Overlays for the same rule are applied in the order given — the caller sorts
 * by creation time, so a later circular amending an earlier one wins. A rule
 * with no overlays is returned by identity, so with the feature switched off
 * this is a no-op over the static catalog.
 */
export function applyOverlays(
  rules: ComplianceRule[],
  overlays: RuleOverlay[],
  asOf: Date,
): ComplianceRule[] {
  if (overlays.length === 0) return rules;

  const byCode = new Map<string, RuleOverlay[]>();
  for (const overlay of overlays) {
    if (!isOverlayInForce(overlay, asOf)) continue;
    const list = byCode.get(overlay.ruleCode);
    if (list) list.push(overlay);
    else byCode.set(overlay.ruleCode, [overlay]);
  }

  if (byCode.size === 0) return rules;

  return rules.map((rule) => {
    const applicable = byCode.get(rule.code);
    if (!applicable) return rule;
    return applicable.reduce(applyOverlay, rule);
  });
}

// --------------------------------------------------------------- the registry

/**
 * The engine's single mutable cell.
 *
 * Overlays live in the database, which the engine may not read. So the runtime
 * layer loads them and pushes them in here — at boot, and again whenever an
 * admin approves or revokes one. Until it does, the engine behaves exactly as
 * it did before overlays existed.
 */
let registered: RuleOverlay[] = [];
let cache: { key: string; rules: ComplianceRule[] } | null = null;

export function setRuleOverlays(overlays: RuleOverlay[]): void {
  // Stable order in, stable order out: overlays are applied in creation order,
  // and the caller owns that sort.
  registered = overlays;
  cache = null;
}

export function registeredOverlays(): RuleOverlay[] {
  return registered;
}

export function clearRuleOverlays(): void {
  setRuleOverlays([]);
}

/**
 * Overlay-applied view of a rule set, memoised per (overlay generation, day).
 *
 * The day is part of the key because effective windows open and close at
 * midnight; a long-lived process must not keep serving yesterday's view.
 */
export function withRegisteredOverlays(rules: ComplianceRule[], asOf: Date): ComplianceRule[] {
  if (registered.length === 0) return rules;

  const key = `${asOf.toISOString().slice(0, 10)}::${registered.map((o) => o.id).join(',')}`;
  if (cache && cache.key === key) return cache.rules;

  const applied = applyOverlays(rules, registered, asOf);
  cache = { key, rules: applied };
  return applied;
}
