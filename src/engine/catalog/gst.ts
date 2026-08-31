/**
 * GST obligations — CGST Act 2017 and the CGST Rules.
 *
 * Returns fan out per GSTIN: a company registered in three states files three
 * sets of GSTR-1 and GSTR-3B, on state-dependent due dates under QRMP.
 */
import { CRORE, anyGstFrequencyIs, anyGstIsEcommerceOperator, anyGstDeductsTds, hasGstRegistration, turnoverAtLeast } from '../conditions';
import { annual, monthly, perGstin, quarterly, shiftMonths } from '../schedule';
import type { ComplianceRule, Occurrence } from '../types';

/**
 * Under QRMP, GSTR-3B is due on the 22nd for "Group X" states and the 24th for
 * "Group Y" states. Notification 29/2021-Central Tax.
 */
const QRMP_GROUP_Y = new Set([
  'HP', 'PB', 'UK', 'HR', 'RJ', 'UP', 'BR', 'SK', 'AR', 'NL', 'MN',
  'MZ', 'TR', 'ML', 'AS', 'WB', 'JH', 'OD', 'OR', 'JK', 'LA', 'CH', 'DL',
]);

export function qrmpGstr3bDueDay(stateCode: string): 22 | 24 {
  return QRMP_GROUP_Y.has(stateCode.toUpperCase()) ? 24 : 22;
}

/** An empty schedule — used when a GSTIN's filing frequency does not match the rule. */
const none = () => [] as Occurrence[];

export const gstRules: ComplianceRule[] = [
  // ------------------------------------------------------------- outward supplies
  {
    code: 'GST_GSTR1_MONTHLY',
    title: 'File outward supplies return (GSTR-1)',
    authority: 'GST',
    category: 'Monthly return',
    form: 'GSTR-1',
    legalReference: 'Section 37, CGST Act 2017 read with Rule 59',
    description: 'Report all outward supplies for the month by the 11th of the following month.',
    severity: 'HIGH',
    penalty: '₹50 per day of delay (₹20 per day for a nil return), capped at ₹5,000 per return. Blocks the recipient’s input tax credit.',
    evidenceRequired: ['GSTR-1 filed acknowledgement (ARN)', 'Sales register for the period'],
    evidenceLevel: 'REQUIRED',
    periodKind: 'MONTHLY',
    applicableWhen: [hasGstRegistration(), anyGstFrequencyIs('MONTHLY')],
    occurrences: perGstin((freq) => (freq === 'MONTHLY' ? monthly({ day: 11 }) : none)),
  },
  {
    code: 'GST_GSTR1_QRMP',
    title: 'File quarterly outward supplies return (GSTR-1 under QRMP)',
    authority: 'GST',
    category: 'Quarterly return',
    form: 'GSTR-1',
    legalReference: 'Section 37, CGST Act 2017 read with Rule 59(1)',
    description: 'Taxpayers on the QRMP scheme report outward supplies quarterly, by the 13th of the month following the quarter.',
    severity: 'HIGH',
    penalty: '₹50 per day of delay (₹20 per day for a nil return), capped at ₹5,000 per return.',
    evidenceRequired: ['GSTR-1 filed acknowledgement (ARN)', 'Sales register for the quarter'],
    evidenceLevel: 'REQUIRED',
    periodKind: 'QUARTERLY',
    applicableWhen: [hasGstRegistration(), anyGstFrequencyIs('QRMP')],
    occurrences: perGstin((freq) =>
      freq === 'QRMP' ? quarterly({ due: (p) => shiftMonths(p.end, 1, 13) }) : none,
    ),
  },
  {
    code: 'GST_IFF',
    title: 'Invoice Furnishing Facility (optional, QRMP)',
    authority: 'GST',
    category: 'Monthly return',
    form: 'IFF',
    legalReference: 'Rule 59(2), CGST Rules 2017',
    description:
      'Optional for QRMP taxpayers: upload B2B invoices for the first two months of the quarter by the 13th of the following month so recipients can claim input tax credit without waiting for the quarterly return.',
    severity: 'LOW',
    penalty: 'No late fee — but recipients cannot claim input tax credit until the invoices appear in their GSTR-2B.',
    evidenceRequired: ['IFF acknowledgement (ARN)'],
    evidenceLevel: 'NONE',
    periodKind: 'MONTHLY',
    applicableWhen: [hasGstRegistration(), anyGstFrequencyIs('QRMP')],
    occurrences: perGstin((freq) =>
      freq !== 'QRMP'
        ? none
        : (fy, ctx) =>
            monthly({ day: 13 })(fy, ctx).filter((o) => {
              // Only months 1 and 2 of each quarter — month 3 is covered by the quarterly GSTR-1.
              const month = o.periodStart.getUTCMonth() + 1;
              return ![6, 9, 12, 3].includes(month);
            }),
    ),
  },

  // ------------------------------------------------------------- summary return & payment
  {
    code: 'GST_GSTR3B_MONTHLY',
    title: 'File summary return and pay tax (GSTR-3B)',
    authority: 'GST',
    category: 'Monthly return',
    form: 'GSTR-3B',
    legalReference: 'Section 39, CGST Act 2017 read with Rule 61',
    description: 'File the monthly summary return and discharge the net tax liability by the 20th of the following month.',
    severity: 'CRITICAL',
    penalty: '₹50 per day of delay (₹20 for nil), capped at ₹5,000, plus interest at 18% per annum on unpaid tax.',
    evidenceRequired: ['GSTR-3B filed acknowledgement (ARN)', 'Challan for tax paid', 'GSTR-2B reconciliation'],
    evidenceLevel: 'REQUIRED',
    periodKind: 'MONTHLY',
    applicableWhen: [hasGstRegistration(), anyGstFrequencyIs('MONTHLY')],
    occurrences: perGstin((freq) => (freq === 'MONTHLY' ? monthly({ day: 20 }) : none)),
  },
  {
    code: 'GST_GSTR3B_QRMP',
    title: 'File quarterly summary return (GSTR-3B under QRMP)',
    authority: 'GST',
    category: 'Quarterly return',
    form: 'GSTR-3B',
    legalReference: 'Section 39(1) proviso, CGST Act 2017 read with Rule 61(1)(ii)',
    description:
      'QRMP taxpayers file GSTR-3B quarterly. The due date is the 22nd or the 24th of the month following the quarter depending on the state of registration.',
    severity: 'CRITICAL',
    penalty: '₹50 per day of delay (₹20 for nil), capped at ₹5,000, plus interest at 18% per annum on unpaid tax.',
    evidenceRequired: ['GSTR-3B filed acknowledgement (ARN)', 'Challan for tax paid'],
    evidenceLevel: 'REQUIRED',
    periodKind: 'QUARTERLY',
    applicableWhen: [hasGstRegistration(), anyGstFrequencyIs('QRMP')],
    occurrences: perGstin((freq, stateCode) =>
      freq === 'QRMP'
        ? quarterly({ due: (p) => shiftMonths(p.end, 1, qrmpGstr3bDueDay(stateCode)) })
        : none,
    ),
  },
  {
    code: 'GST_PMT06',
    title: 'Monthly tax payment under QRMP (PMT-06)',
    authority: 'GST',
    category: 'Payment',
    form: 'PMT-06',
    legalReference: 'Rule 61A, CGST Rules 2017',
    description:
      'QRMP taxpayers pay tax for the first two months of each quarter by the 25th of the following month, using either the fixed-sum or the self-assessment method.',
    severity: 'HIGH',
    penalty: 'Interest at 18% per annum on the shortfall.',
    evidenceRequired: ['PMT-06 challan', 'Working for the fixed-sum or self-assessed amount'],
    evidenceLevel: 'REQUIRED',
    periodKind: 'MONTHLY',
    applicableWhen: [hasGstRegistration(), anyGstFrequencyIs('QRMP')],
    occurrences: perGstin((freq) =>
      freq !== 'QRMP'
        ? none
        : (fy, ctx) =>
            monthly({ day: 25 })(fy, ctx).filter((o) => {
              const month = o.periodStart.getUTCMonth() + 1;
              return ![6, 9, 12, 3].includes(month); // months 1 and 2 of each quarter only
            }),
    ),
  },
  {
    code: 'GST_ITC_RECON',
    title: 'Reconcile input tax credit against GSTR-2B',
    authority: 'GST',
    category: 'Reconciliation',
    legalReference: 'Section 16(2)(aa) and 16(2)(ba), CGST Act 2017 read with Rule 36(4)',
    description:
      'Input tax credit can only be claimed for invoices appearing in GSTR-2B. Reconcile the purchase register against GSTR-2B before filing GSTR-3B and chase suppliers who have not reported.',
    severity: 'MEDIUM',
    penalty: 'Excess credit claimed is recovered with interest at 18% per annum and a penalty of up to 10% of the tax.',
    evidenceRequired: ['GSTR-2B download', 'Purchase register', 'Reconciliation working with the mismatch list'],
    evidenceLevel: 'NONE',
    periodKind: 'MONTHLY',
    applicableWhen: [hasGstRegistration()],
    occurrences: monthly({ day: 14 }),
  },

  // ------------------------------------------------------------- composition
  {
    code: 'GST_CMP08',
    title: 'Quarterly statement for composition dealers (CMP-08)',
    authority: 'GST',
    category: 'Quarterly return',
    form: 'CMP-08',
    legalReference: 'Rule 62, CGST Rules 2017',
    description: 'Composition taxpayers pay tax and file the quarterly statement by the 18th of the month following the quarter.',
    severity: 'HIGH',
    penalty: '₹50 per day of delay (₹20 for nil), capped at ₹5,000, plus interest at 18% per annum.',
    evidenceRequired: ['CMP-08 acknowledgement (ARN)', 'Tax payment challan'],
    evidenceLevel: 'REQUIRED',
    periodKind: 'QUARTERLY',
    applicableWhen: [hasGstRegistration(), anyGstFrequencyIs('COMPOSITION')],
    occurrences: perGstin((freq) =>
      freq === 'COMPOSITION' ? quarterly({ due: (p) => shiftMonths(p.end, 1, 18) }) : none,
    ),
  },
  {
    code: 'GST_GSTR4',
    title: 'Annual return for composition dealers (GSTR-4)',
    authority: 'GST',
    category: 'Annual return',
    form: 'GSTR-4',
    legalReference: 'Section 39(2), CGST Act 2017 read with Rule 62',
    description: 'Composition taxpayers file the annual return by 30 June following the financial year.',
    severity: 'HIGH',
    penalty: '₹50 per day of delay (₹20 for nil), capped at ₹2,000.',
    evidenceRequired: ['GSTR-4 acknowledgement (ARN)', 'Annual turnover summary'],
    evidenceLevel: 'REQUIRED',
    periodKind: 'ANNUAL',
    applicableWhen: [hasGstRegistration(), anyGstFrequencyIs('COMPOSITION')],
    occurrences: annual({ month: 6, day: 30 }),
  },

  // ------------------------------------------------------------- annual
  {
    code: 'GST_GSTR9',
    title: 'File GST annual return (GSTR-9)',
    authority: 'GST',
    category: 'Annual return',
    form: 'GSTR-9',
    legalReference: 'Section 44, CGST Act 2017 read with Rule 80',
    description:
      'Consolidate the year’s outward supplies, input tax credit and tax paid. Mandatory once aggregate turnover crosses ₹2 crore; due 31 December following the financial year.',
    severity: 'HIGH',
    penalty: '₹200 per day of delay capped at 0.5% of turnover in the state or union territory.',
    evidenceRequired: ['GSTR-9 acknowledgement (ARN)', 'Annual reconciliation working', 'Books-to-returns turnover reconciliation'],
    evidenceLevel: 'REQUIRED',
    periodKind: 'ANNUAL',
    applicableWhen: [hasGstRegistration(), turnoverAtLeast(2 * CRORE)],
    occurrences: annual({ month: 12, day: 31 }),
  },
  {
    code: 'GST_GSTR9C',
    title: 'File GST reconciliation statement (GSTR-9C)',
    authority: 'GST',
    category: 'Annual return',
    form: 'GSTR-9C',
    legalReference: 'Section 44 proviso, CGST Act 2017 read with Rule 80(3)',
    description:
      'Self-certified reconciliation between the audited financial statements and the annual return, required once aggregate turnover crosses ₹5 crore. Due with GSTR-9 on 31 December.',
    severity: 'HIGH',
    penalty: 'General penalty of up to ₹25,000 under s.125 of the CGST Act.',
    evidenceRequired: ['GSTR-9C acknowledgement (ARN)', 'Audited financial statements', 'Reconciliation working'],
    evidenceLevel: 'REQUIRED',
    periodKind: 'ANNUAL',
    applicableWhen: [hasGstRegistration(), turnoverAtLeast(5 * CRORE)],
    occurrences: annual({ month: 12, day: 31 }),
  },

  // ------------------------------------------------------------- TDS / TCS
  {
    code: 'GST_GSTR7',
    title: 'File GST TDS return (GSTR-7)',
    authority: 'GST',
    category: 'Monthly return',
    form: 'GSTR-7',
    legalReference: 'Section 51, CGST Act 2017 read with Rule 66',
    description: 'Deductors of GST TDS file the monthly return and pay the deducted tax by the 10th of the following month.',
    severity: 'HIGH',
    penalty: '₹50 per day of delay capped at ₹2,000, plus interest at 18% per annum.',
    evidenceRequired: ['GSTR-7 acknowledgement (ARN)', 'TDS certificates issued in GSTR-7A'],
    evidenceLevel: 'REQUIRED',
    periodKind: 'MONTHLY',
    applicableWhen: [hasGstRegistration(), anyGstDeductsTds()],
    occurrences: monthly({ day: 10 }),
  },
  {
    code: 'GST_GSTR8',
    title: 'File e-commerce TCS return (GSTR-8)',
    authority: 'GST',
    category: 'Monthly return',
    form: 'GSTR-8',
    legalReference: 'Section 52, CGST Act 2017 read with Rule 67',
    description: 'E-commerce operators report supplies made through the platform and the tax collected at source by the 10th of the following month.',
    severity: 'HIGH',
    penalty: '₹200 per day of delay capped at ₹5,000, plus interest at 18% per annum.',
    evidenceRequired: ['GSTR-8 acknowledgement (ARN)', 'Supplier-wise TCS statement'],
    evidenceLevel: 'REQUIRED',
    periodKind: 'MONTHLY',
    applicableWhen: [hasGstRegistration(), anyGstIsEcommerceOperator()],
    occurrences: monthly({ day: 10 }),
  },

  // ------------------------------------------------------------- readiness
  {
    code: 'GST_EINVOICE_READINESS',
    title: 'Confirm e-invoicing is enabled and compliant',
    authority: 'GST',
    category: 'Readiness',
    legalReference: 'Rule 48(4), CGST Rules 2017',
    description:
      'E-invoicing is mandatory once aggregate turnover in any financial year since 2017-18 crosses ₹5 crore. Every B2B invoice must carry an IRN and a signed QR code, and must be reported to the IRP within 30 days.',
    severity: 'HIGH',
    penalty: '₹10,000 per invoice for failure to issue an e-invoice, and ₹25,000 per invoice for an incorrect one. Non-compliant invoices are not valid documents for input tax credit.',
    evidenceRequired: ['IRP registration confirmation', 'Sample e-invoice with IRN and QR code', 'ERP/billing system configuration note'],
    evidenceLevel: 'ATTEST',
    periodKind: 'ANNUAL',
    applicableWhen: [hasGstRegistration(), turnoverAtLeast(5 * CRORE)],
    occurrences: annual({ month: 4, day: 30, anchor: 'within' }),
  },
];
