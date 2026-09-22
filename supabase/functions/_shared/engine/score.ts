import { addDays, today } from '../dates.ts';
import type { Authority, Severity } from './types.ts';

export const SEVERITY_WEIGHT: Record<Severity, number> = {
  CRITICAL: 10,
  HIGH: 6,
  MEDIUM: 3,
  LOW: 1,
};

const LATE_CREDIT = 0.5;

export interface ScorableItem {
  ruleCode: string;
  authority: Authority;
  severity: Severity;
  dueDate: Date;
  status: string;
  completedAt: Date | null;
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
  assessed: number;
  onTime: number;
  late: number;
  missed: number;
  waived: number;
  preOnboarding: number;
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

    if (item.dueDate < windowStart) continue;

    if (item.onboardedAt && item.dueDate < item.onboardedAt && !item.completedAt) {
      preOnboarding += 1;
    }

    const weight = SEVERITY_WEIGHT[item.severity] || 1;
    const r = row(item.authority);
    possible += weight;
    r.possible += weight;

    if (item.completedAt) {
      const wasOnTime = item.completedAt <= addDays(item.dueDate, 1);
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
