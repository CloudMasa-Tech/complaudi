import { describe, expect, it } from 'vitest';
import { GST_PERCENT, PLANS, findPlan, inrLabel, planView } from '../src/modules/billing/plans';

describe('what the plans cost', () => {
  it('prices one year at 1,999 plus 18% GST', () => {
    const p = findPlan('ANNUAL')!;
    expect(p.baseAmountPaise).toBe(199_900);
    expect(p.taxPercent).toBe(18);
    expect(p.taxAmountPaise).toBe(35_982);
    expect(p.amountPaise).toBe(235_882);
    expect(p.periodDays).toBe(365);
  });

  it('prices three years at 4,999 plus 18% GST', () => {
    const p = findPlan('TRIENNIAL')!;
    expect(p.baseAmountPaise).toBe(499_900);
    expect(p.taxAmountPaise).toBe(89_982);
    expect(p.amountPaise).toBe(589_882);
    expect(p.periodDays).toBe(1_095);
  });

  it('adds GST on top rather than carving it out', () => {
    // The listed price is what the plan costs; the tax is charged in addition.
    // Carving it out of the total would quietly discount every sale.
    for (const p of PLANS) {
      expect(p.baseAmountPaise + p.taxAmountPaise).toBe(p.amountPaise);
      expect(p.taxAmountPaise).toBe(Math.round((p.baseAmountPaise * GST_PERCENT) / 100));
    }
  });

  it('charges whole paise — no plan lands on a fraction', () => {
    for (const p of PLANS) expect(Number.isInteger(p.amountPaise)).toBe(true);
  });

  it('makes three years genuinely cheaper per year', () => {
    const [annual, triennial] = [findPlan('ANNUAL')!, findPlan('TRIENNIAL')!];
    const perYear = (p: typeof annual) => p.amountPaise / (p.periodDays / 365);
    expect(perYear(triennial)).toBeLessThan(perYear(annual));
  });

  it('refuses a plan key it does not sell', () => {
    // A caller must get null and turn it into a 400, never a silent fallback
    // to a price the buyer never saw.
    for (const key of ['MONTHLY', 'annual', '', 'ANNUAL ', undefined, null]) {
      expect(findPlan(key as any)).toBeNull();
    }
  });
});

describe('the money labels', () => {
  it('keeps the paise that GST creates', () => {
    // Rounding 2,358.82 to "₹2,359" would print a number the card is never
    // charged, on the screen where somebody decides to pay it.
    expect(inrLabel(235_882)).toBe('₹2,358.82');
    expect(inrLabel(589_882)).toBe('₹5,898.82');
  });

  it('drops them when there are none', () => {
    expect(inrLabel(199_900)).toBe('₹1,999');
  });

  it('labels every plan from the same numbers it charges', () => {
    for (const p of PLANS) {
      const v = planView(p);
      expect(v.amountLabel).toBe(inrLabel(p.amountPaise));
      expect(v.baseLabel).toBe(inrLabel(p.baseAmountPaise));
      expect(v.taxLabel).toBe(inrLabel(p.taxAmountPaise));
    }
  });
});

describe('the Node and edge catalogs agree', () => {
  it('sells the same plans at the same prices', async () => {
    // Two runtimes bill the same customers and deploy separately. If these ever
    // diverge, one of them charges a price the other never quoted.
    const edge = await import('../supabase/functions/_shared/plans');
    expect(edge.PLANS).toEqual(PLANS);
    expect(edge.GST_PERCENT).toBe(GST_PERCENT);
    expect(edge.DEFAULT_PLAN_KEY).toBe('ANNUAL');
    for (const p of PLANS) expect(edge.planView(p as any)).toEqual(planView(p));
  });

  it('formats money identically', () => {
    // Deno and Node both carry ICU, but the label is rendered on one and shown
    // next to the other's, so it is compared rather than assumed.
    return import('../supabase/functions/_shared/plans').then((edge) => {
      for (const paise of [0, 100, 199_900, 235_882, 589_882, 1_234_567]) {
        expect(edge.inrLabel(paise)).toBe(inrLabel(paise));
      }
    });
  });
});
