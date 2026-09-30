/**
 * What Complaudi sells, and for how much.
 *
 * Prices live in code rather than env for three reasons: a price change is a
 * product decision that should show up in a diff and a review; the Express API
 * and the Supabase edge function must charge the same number, and two servers
 * reading two env files is exactly how they drift; and an env typo that halves
 * a price is silent, where a bad literal here fails a test.
 *
 * GST is added on top of the listed price, not carved out of it. ₹1,999 is
 * what the plan costs; ₹2,358.82 is what the card is charged. Both numbers are
 * kept — the tax split has to appear on the invoice, and recomputing it later
 * from a rounded total is how invoices stop reconciling.
 *
 * No imports: this file is mirrored verbatim into supabase/functions/_shared so
 * the two runtimes cannot price differently. tests/plans.test.ts compares them.
 */

/** Percentage points of GST applied to every plan. */
export const GST_PERCENT = 18;

export type PlanKey = 'ANNUAL' | 'TRIENNIAL';

export interface Plan {
  key: PlanKey;
  /** Shown to the buyer and stored on the payment row at purchase time. */
  name: string;
  /** Listed price before tax, in paise. */
  baseAmountPaise: number;
  taxPercent: number;
  /** GST on the base, in paise. */
  taxAmountPaise: number;
  /** What Razorpay is actually asked to charge, in paise. */
  amountPaise: number;
  /** How long the entitlement runs from the payment date. */
  periodDays: number;
  periodLabel: string;
  /** Ordering and emphasis in the plan picker. */
  recommended: boolean;
}

/** Exact at 18%: both bases are multiples of 50 paise, so neither rounds. */
function gstOn(baseAmountPaise: number): number {
  return Math.round((baseAmountPaise * GST_PERCENT) / 100);
}

function plan(
  key: PlanKey,
  name: string,
  baseAmountPaise: number,
  periodDays: number,
  periodLabel: string,
  recommended: boolean,
): Plan {
  const taxAmountPaise = gstOn(baseAmountPaise);
  return {
    key,
    name,
    baseAmountPaise,
    taxPercent: GST_PERCENT,
    taxAmountPaise,
    amountPaise: baseAmountPaise + taxAmountPaise,
    periodDays,
    periodLabel,
    recommended,
  };
}

/** 1,095 days rather than 3 × 365: three years is priced as a flat term, and a
 *  leap day inside it is not a reason to shorten what somebody bought. */
export const PLANS: readonly Plan[] = [
  plan('ANNUAL', '1 Year', 199_900, 365, '1 year', false),
  plan('TRIENNIAL', '3 Years', 499_900, 1_095, '3 years', true),
];

export const DEFAULT_PLAN_KEY: PlanKey = 'ANNUAL';

/** Null for anything not in the catalog — callers turn that into a 400 rather
 *  than falling back to a price the buyer never saw. */
export function findPlan(key: string | undefined | null): Plan | null {
  return PLANS.find((p) => p.key === key) ?? null;
}

/** "₹2,358.82". Paise are shown when they exist: GST puts them on every total
 *  here, and rounding the display would disagree with the amount charged. */
export function inrLabel(paise: number): string {
  const hasPaise = paise % 100 !== 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: hasPaise ? 2 : 0,
  }).format(paise / 100);
}

/** Everything the plan picker needs, priced and labelled server-side so the
 *  page never computes a number it could get wrong. */
export function planView(p: Plan) {
  return {
    key: p.key,
    name: p.name,
    periodLabel: p.periodLabel,
    periodDays: p.periodDays,
    recommended: p.recommended,
    baseAmountPaise: p.baseAmountPaise,
    baseLabel: inrLabel(p.baseAmountPaise),
    taxPercent: p.taxPercent,
    taxAmountPaise: p.taxAmountPaise,
    taxLabel: inrLabel(p.taxAmountPaise),
    amountPaise: p.amountPaise,
    amountLabel: inrLabel(p.amountPaise),
    /** Per-year equivalent of the total, so the 3-year saving is visible. */
    perYearLabel: inrLabel(Math.round(p.amountPaise / (p.periodDays / 365))),
  };
}
