import { addDays, today } from '../lib/dates';
import type { Authority, Severity } from './types';

/** How much each obligation is worth. A missed GSTR-3B is not a missed board minute. */
export const SEVERITY_WEIGHT: Record<Severity, number> = {
  CRITICAL: 10,
  HIGH: 6,
  MEDIUM: 3,
  LOW: 1,
};

/** Credit retained when something was filed, but filed late. */
const LATE_CREDIT = 0.5;

export interface ScorableItem {
  ruleCode: string;
  authority: Authority;
  severity: Severity;
  dueDate: Date;
  status: string;
  completedAt: Date | null;
  /**
   * When the company joined the platform. Obligations that fell due before this
   * and were never touched are outside what the tool can vouch for.
   */
  onboardedAt?: Date | null;
  hasEvidence?: boolean;
}

export interface ScoreBreakdownRow {
  authority: Authority;
  earned: number;
  possible: number;
  score: number;
  onTime: number;
  late: number;
  missed: number;
}

export interface ScoreResult {
  score: number;
  band: 'A' | 'B' | 'C' | 'D';
  /** Obligations that had actually fallen due within the window. */
  assessed: number;
  onTime: number;
  late: number;
  missed: number;
  waived: number;
  /**
   * Fell due before the company was onboarded and has never been touched. Shown
   * in the calendar, but not scored — see `computeComplianceScore`.
   */
  preOnboarding: number;
  /** Not yet due — excluded from the score, but worth surfacing. */
  upcoming: number;
  dueInNext30Days: number;
  overdueNow: number;
  byAuthority: ScoreBreakdownRow[];
  windowStart: Date;
  windowEnd: Date;
}

function band(score: number): ScoreResult['band'] {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  return 'D';
}

/**
 * Score = weighted share of obligations that had fallen due in the trailing
 * window and were actually met.
 *
 * Two categories are deliberately excluded rather than counted as failures:
 *
 *   - Obligations not yet due. Counting them as successes would let a company
 *     raise its score simply by generating more future calendar entries.
 *   - Obligations that fell due before the company was onboarded and were never
 *     touched. The calendar is back-filled on onboarding, so these appear as
 *     overdue, but the tool has no idea whether they were filed on paper years
 *     ago. Scoring a brand-new account at zero for them would be wrong. They
 *     are surfaced as `preOnboarding` so the user can review and mark them, and
 *     once marked they score normally.
 */
export function computeComplianceScore(
  items: ScorableItem[],
  opts: { asOf?: Date; lookbackDays?: number } = {},
): ScoreResult {
  const asOf = opts.asOf ?? today();
  const windowStart = addDays(asOf, -(opts.lookbackDays ?? 365));
  const horizon = addDays(asOf, 30);

  const rows = new Map<Authority, ScoreBreakdownRow>();
  const row = (a: Authority): ScoreBreakdownRow => {
    let r = rows.get(a);
    if (!r) {
      r = { authority: a, earned: 0, possible: 0, score: 100, onTime: 0, late: 0, missed: 0 };
      rows.set(a, r);
    }
    return r;
  };

  let earned = 0;
  let possible = 0;
  let onTime = 0;
  let late = 0;
  let missed = 0;
  let waived = 0;
  let preOnboarding = 0;
  let upcoming = 0;
  let dueInNext30Days = 0;
  let overdueNow = 0;

  for (const item of items) {
    if (item.status === 'WAIVED') {
      waived += 1;
      continue;
    }

    const isDue = item.dueDate <= asOf;
    if (!isDue) {
      upcoming += 1;
      if (item.dueDate <= horizon) dueInNext30Days += 1;
      continue;
    }

    if (item.dueDate < windowStart) continue; // older than the scoring window

    // Predates onboarding and nobody has said what happened to it.
    if (item.onboardedAt && item.dueDate < item.onboardedAt && !item.completedAt) {
      preOnboarding += 1;
      continue;
    }

    const weight = SEVERITY_WEIGHT[item.severity];
    const r = row(item.authority);
    possible += weight;
    r.possible += weight;

    if (item.completedAt) {
      const wasOnTime = item.completedAt <= addDays(item.dueDate, 1); // filed on the due date still counts
      const credit = wasOnTime ? 1 : LATE_CREDIT;
      earned += weight * credit;
      r.earned += weight * credit;
      if (wasOnTime) {
        onTime += 1;
        r.onTime += 1;
      } else {
        late += 1;
        r.late += 1;
      }
    } else {
      missed += 1;
      overdueNow += 1;
      r.missed += 1;
    }
  }

  for (const r of rows.values()) {
    r.earned = Math.round(r.earned * 100) / 100;
    r.score = r.possible === 0 ? 100 : Math.round((r.earned / r.possible) * 100);
  }

  const score = possible === 0 ? 100 : Math.round((earned / possible) * 100);

  return {
    score,
    band: band(score),
    assessed: onTime + late + missed,
    onTime,
    late,
    missed,
    waived,
    preOnboarding,
    upcoming,
    dueInNext30Days,
    overdueNow,
    byAuthority: [...rows.values()].sort((a, b) => a.authority.localeCompare(b.authority)),
    windowStart,
    windowEnd: asOf,
  };
}
