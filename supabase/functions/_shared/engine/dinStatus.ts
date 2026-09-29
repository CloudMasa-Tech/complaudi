/**
 * Whether a director's DIN is still active — inferred, not verified.
 *
 * MCA publishes no API for DIN status; "Verify DIN/DPIN" is a captcha-protected
 * page. So this does not check anything with the Registrar. It reads the one
 * thing that actually deactivates a DIN in practice.
 *
 * Rule 12A: every holder of a DIN as on 31 March must complete KYC by 30
 * September that year. Miss it and the DIN is deactivated — the single
 * commonest reason a DIN stops working — and reactivation costs a flat ₹5,000
 * per director on top of filing the form late.
 *
 * So the company's own DIR-3 KYC record is a good proxy, and it is one the
 * toolkit already holds. What it is not is authoritative: a DIN can also be
 * deactivated on death, disqualification under s.164(2), or surrender via
 * DIR-5. Every status below therefore carries `derived: true`, and the UI says
 * so. Reporting a DIN as active when the Registrar disagrees would be worse
 * than reporting nothing at all.
 *
 * Pure: takes the filing record it needs and returns a verdict.
 */

export type DinState =
  /** KYC for the last completed cycle is on file. */
  | 'ACTIVE'
  /** The deadline passed with no filing — presumed deactivated. */
  | 'DEACTIVATED'
  /** This cycle's KYC is still open. Nothing is wrong yet. */
  | 'DUE'
  /** No DIN recorded, or no KYC obligation has come round yet. */
  | 'UNKNOWN';

export interface DinStatus {
  state: DinState;
  /** One line, written for the director chip. */
  label: string;
  /** What to do about it, when there is something to do. */
  action: string | null;
  /** Always true here — this is inference from filings, not an MCA lookup. */
  derived: boolean;
  /** The KYC deadline this verdict was read from. */
  asOfPeriod: string | null;
}

/** The DIR-3 KYC obligation, as the calendar stores it. */
export interface KycFiling {
  periodKey: string;
  dueDate: Date;
  /** ItemStatus from the calendar — COMPLETED and WAIVED both count as done. */
  status: string;
  completedAt: Date | null;
}

const DONE = new Set(['COMPLETED', 'WAIVED']);

/**
 * Read a DIN's standing from the company's DIR-3 KYC record.
 *
 * The obligation is filed per director but the engine tracks it per company and
 * financial year, so every serving DIN shares one verdict. That is a
 * simplification worth naming: if one director filed and another did not, this
 * cannot tell them apart. Per-director accuracy needs either per-director
 * calendar items or a provider lookup.
 */
export function deriveDinStatus(
  director: { din: string | null; resignedOn: Date | null },
  kycFilings: KycFiling[],
  asOf: Date = new Date(),
): DinStatus {
  if (!director.din) {
    return { state: 'UNKNOWN', label: 'No DIN recorded', action: null, derived: true, asOfPeriod: null };
  }
  if (director.resignedOn && director.resignedOn <= asOf) {
    // A resigned director's DIN is not this company's concern any more.
    return { state: 'UNKNOWN', label: 'Resigned', action: null, derived: true, asOfPeriod: null };
  }

  // Only cycles whose deadline has arrived can tell us anything; the newest of
  // those is the one that decides the current standing.
  const elapsed = kycFilings
    .filter((f) => f.dueDate <= asOf)
    .sort((a, b) => b.dueDate.getTime() - a.dueDate.getTime());

  const latest = elapsed[0];

  if (!latest) {
    // Either the company is too new for a KYC cycle to have closed, or the
    // calendar has not been generated. Silence is not evidence of a problem.
    const upcoming = kycFilings
      .filter((f) => f.dueDate > asOf)
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];

    return upcoming
      ? {
          state: 'DUE',
          label: 'KYC not yet due',
          action: `File DIR-3 KYC by ${formatDay(upcoming.dueDate)}`,
          derived: true,
          asOfPeriod: upcoming.periodKey,
        }
      : { state: 'UNKNOWN', label: 'No KYC record', action: null, derived: true, asOfPeriod: null };
  }

  if (DONE.has(latest.status)) {
    return {
      state: 'ACTIVE',
      label: latest.completedAt ? `KYC filed ${formatDay(latest.completedAt)}` : 'KYC filed',
      action: null,
      derived: true,
      asOfPeriod: latest.periodKey,
    };
  }

  return {
    state: 'DEACTIVATED',
    label: `DIR-3 KYC overdue since ${formatDay(latest.dueDate)}`,
    // The fee is flat and per director, and it is the part people are caught by.
    action: 'Reactivate by filing DIR-3 KYC with the ₹5,000 fee',
    derived: true,
    asOfPeriod: latest.periodKey,
  };
}

/**
 * "30 Sep 2026" — matching fmtDate on the front end.
 *
 * Spelled out rather than handed to toLocaleDateString: under en-IN, ICU
 * renders September as "Sept", so the server and the browser would print the
 * same date two different ways on the same screen.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDay(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** The colour the chip reads from, kept next to the states it describes. */
export const DIN_TONE: Record<DinState, 'good' | 'critical' | 'high' | 'muted'> = {
  ACTIVE: 'good',
  DEACTIVATED: 'critical',
  DUE: 'high',
  UNKNOWN: 'muted',
};
