/**
 * Income Tax obligations — Income-tax Act 1961.
 *
 * Note on the return due dates: a company always requires audit, so ITR-6 is
 * due 31 October. Entities with international or specified domestic
 * transactions get an extra month (30 November) because Form 3CEB is due first.
 */
import { utcDate } from '../../lib/dates';
import {
  CRORE,
  crossesTaxAuditThreshold,
  custom,
  employeesAtLeast,
  entityIs,
  hasForeignTransactions,
  hasTan,
  not,
  turnoverAtLeast,
} from '../conditions';
import { annual, fixedDatesInFy, monthly, quarterly } from '../schedule';
import type { ComplianceRule } from '../types';

const noTransferPricing = not(hasForeignTransactions(), 'Has no international or specified domestic transactions');

/** Companies and Section 8 companies are audited regardless of turnover. */
const isAlwaysAudited = entityIs('PRIVATE_LIMITED', 'PUBLIC_LIMITED', 'OPC', 'SECTION_8');

const isUnauditedFirm = custom(
  'Is a firm or proprietorship below the tax-audit threshold',
  (ctx) =>
    ['LLP', 'PARTNERSHIP', 'PROPRIETORSHIP'].includes(ctx.company.entityType) &&
    !crossesTaxAuditThreshold().test(ctx),
);

const isAuditedFirm = custom(
  'Is a firm or proprietorship above the tax-audit threshold',
  (ctx) =>
    ['LLP', 'PARTNERSHIP', 'PROPRIETORSHIP'].includes(ctx.company.entityType) &&
    crossesTaxAuditThreshold().test(ctx),
);

export const incomeTaxRules: ComplianceRule[] = [
  // ------------------------------------------------------------- advance tax
  {
    code: 'IT_ADVANCE_TAX',
    title: 'Pay advance tax instalment',
    authority: 'INCOME_TAX',
    category: 'Payment',
    legalReference: 'Sections 208 to 211, Income-tax Act 1961',
    description:
      'Where the estimated tax liability for the year is ₹10,000 or more, pay advance tax in four instalments: 15% by 15 June, 45% by 15 September, 75% by 15 December and 100% by 15 March.',
    severity: 'HIGH',
    penalty: 'Interest at 1% per month under s.234B on the shortfall and under s.234C for deferment of each instalment.',
    evidenceRequired: ['Challan 280 for each instalment', 'Computation of estimated income and tax'],
    evidenceLevel: 'REQUIRED',
    periodKind: 'QUARTERLY',
    applicableWhen: [custom('Has taxable business income', (ctx) => ctx.company.annualTurnover > 0)],
    occurrences: fixedDatesInFy([
      { key: 'AT1', label: 'Advance tax — 1st instalment (15% cumulative)', month: 6, day: 15, metadata: { cumulativePct: 15 } },
      { key: 'AT2', label: 'Advance tax — 2nd instalment (45% cumulative)', month: 9, day: 15, metadata: { cumulativePct: 45 } },
      { key: 'AT3', label: 'Advance tax — 3rd instalment (75% cumulative)', month: 12, day: 15, metadata: { cumulativePct: 75 } },
      { key: 'AT4', label: 'Advance tax — 4th instalment (100% cumulative)', month: 3, day: 15, metadata: { cumulativePct: 100 } },
    ]),
  },

  // ------------------------------------------------------------- TDS
  {
    code: 'IT_TDS_PAYMENT',
    title: 'Deposit tax deducted at source',
    authority: 'INCOME_TAX',
    category: 'Payment',
    legalReference: 'Section 200 read with Rule 30, Income-tax Rules 1962',
    description:
      'Deposit TDS deducted during the month by the 7th of the following month. Tax deducted in March may be deposited by 30 April.',
    severity: 'CRITICAL',
    penalty:
      'Interest at 1% per month for late deduction and 1.5% per month for late deposit. Persistent default can attract prosecution under s.276B.',
    evidenceRequired: ['Challan ITNS-281', 'TDS deduction working for the month'],
    evidenceLevel: 'REQUIRED',
    periodKind: 'MONTHLY',
    applicableWhen: [hasTan()],
    occurrences: (fy, ctx) =>
      monthly({ day: 7 })(fy, ctx).map((o) =>
        o.periodStart.getUTCMonth() + 1 === 3
          ? { ...o, dueDate: utcDate(fy.endYear, 4, 30), metadata: { ...o.metadata, note: 'March TDS may be deposited by 30 April' } }
          : o,
      ),
  },
  {
    code: 'IT_TDS_RETURN',
    title: 'File quarterly TDS return (Form 24Q / 26Q / 27Q)',
    authority: 'INCOME_TAX',
    category: 'Quarterly return',
    form: '24Q / 26Q / 27Q',
    legalReference: 'Section 200(3) read with Rule 31A, Income-tax Rules 1962',
    description:
      'File the quarterly statement of tax deducted — 24Q for salaries, 26Q for other resident payments and 27Q for payments to non-residents.',
    severity: 'HIGH',
    penalty:
      '₹200 per day under s.234E until filed, capped at the TDS amount, plus a penalty of ₹10,000 to ₹1,00,000 under s.271H.',
    evidenceRequired: ['Provisional receipt / token number', 'FVU file', 'Justification report from TRACES'],
    evidenceLevel: 'REQUIRED',
    periodKind: 'QUARTERLY',
    applicableWhen: [hasTan()],
    occurrences: quarterly({
      due: (_p, fy, i) =>
        [utcDate(fy.startYear, 7, 31), utcDate(fy.startYear, 10, 31), utcDate(fy.endYear, 1, 31), utcDate(fy.endYear, 5, 31)][i]!,
    }),
  },
  {
    code: 'IT_FORM16A',
    title: 'Issue TDS certificates (Form 16A)',
    authority: 'INCOME_TAX',
    category: 'Quarterly return',
    form: 'Form 16A',
    legalReference: 'Rule 31(3), Income-tax Rules 1962',
    description: 'Download and issue Form 16A to deductees within 15 days of the due date for the quarterly TDS return.',
    severity: 'MEDIUM',
    penalty: '₹100 per day of delay per certificate under s.272A(2)(g), capped at the TDS amount.',
    evidenceRequired: ['Form 16A downloaded from TRACES', 'Proof of issue to deductees'],
    evidenceLevel: 'ATTEST',
    periodKind: 'QUARTERLY',
    applicableWhen: [hasTan()],
    occurrences: quarterly({
      due: (_p, fy, i) =>
        [utcDate(fy.startYear, 8, 15), utcDate(fy.startYear, 11, 15), utcDate(fy.endYear, 2, 15), utcDate(fy.endYear, 6, 15)][i]!,
    }),
  },
  {
    code: 'IT_FORM16',
    title: 'Issue Form 16 to employees',
    authority: 'INCOME_TAX',
    category: 'Annual return',
    form: 'Form 16',
    legalReference: 'Rule 31(3), Income-tax Rules 1962',
    description: 'Issue the annual salary TDS certificate to every employee by 15 June following the financial year.',
    severity: 'HIGH',
    penalty: '₹100 per day of delay per certificate under s.272A(2)(g).',
    evidenceRequired: ['Form 16 Part A from TRACES', 'Form 16 Part B', 'Acknowledgement of issue to employees'],
    evidenceLevel: 'ATTEST',
    periodKind: 'ANNUAL',
    applicableWhen: [hasTan(), employeesAtLeast(1)],
    occurrences: annual({ month: 6, day: 15 }),
  },

  // ------------------------------------------------------------- audit & returns
  {
    code: 'IT_TAX_AUDIT',
    title: 'Complete tax audit and file the report (Form 3CA/3CB-3CD)',
    authority: 'INCOME_TAX',
    category: 'Audit',
    form: '3CA-3CD / 3CB-3CD',
    legalReference: 'Section 44AB, Income-tax Act 1961',
    description:
      'A tax audit is required once turnover crosses ₹1 crore — relaxed to ₹10 crore where both cash receipts and cash payments stay within 5% of the total. The report must be filed by 30 September.',
    severity: 'CRITICAL',
    penalty: '0.5% of turnover or ₹1,50,000, whichever is lower, under s.271B.',
    evidenceRequired: ['Signed Form 3CD', 'Audited financial statements', 'Filing acknowledgement'],
    evidenceLevel: 'REQUIRED',
    basedOnAnnualAccounts: true,
    signatoryRequired: true,
    periodKind: 'ANNUAL',
    applicableWhen: [crossesTaxAuditThreshold()],
    occurrences: annual({ month: 9, day: 30 }),
  },
  {
    code: 'IT_FORM3CEB',
    title: 'File transfer pricing report (Form 3CEB)',
    authority: 'INCOME_TAX',
    category: 'Audit',
    form: 'Form 3CEB',
    legalReference: 'Section 92E, Income-tax Act 1961',
    description:
      'An accountant’s report on international transactions and specified domestic transactions with associated enterprises, due 31 October.',
    severity: 'CRITICAL',
    penalty: '₹1,00,000 under s.271BA for non-filing, plus 2% of the transaction value for non-maintenance of documentation.',
    evidenceRequired: ['Signed Form 3CEB', 'Transfer pricing study report', 'Filing acknowledgement'],
    evidenceLevel: 'REQUIRED',
    basedOnAnnualAccounts: true,
    signatoryRequired: true,
    periodKind: 'ANNUAL',
    applicableWhen: [hasForeignTransactions()],
    occurrences: annual({ month: 10, day: 31 }),
  },
  {
    code: 'IT_ITR_AUDITED',
    title: 'File the income tax return (audited entity)',
    authority: 'INCOME_TAX',
    category: 'Annual return',
    form: 'ITR-5 / ITR-6 / ITR-7',
    legalReference: 'Section 139(1), Income-tax Act 1961',
    description:
      'Entities whose accounts require audit file their return by 31 October. Companies file ITR-6, firms and LLPs file ITR-5, and Section 8 companies file ITR-7.',
    severity: 'CRITICAL',
    penalty:
      'Late fee of up to ₹5,000 under s.234F, interest at 1% per month under s.234A, and loss of the right to carry forward business losses.',
    evidenceRequired: ['ITR-V acknowledgement', 'Computation of income', 'Audited financial statements', 'Form 26AS / AIS reconciliation'],
    evidenceLevel: 'REQUIRED',
    basedOnAnnualAccounts: true,
    periodKind: 'ANNUAL',
    applicableWhen: [
      custom('Accounts require audit', (ctx) => isAlwaysAudited.test(ctx) || isAuditedFirm.test(ctx)),
      noTransferPricing,
    ],
    occurrences: annual({ month: 10, day: 31 }),
  },
  {
    code: 'IT_ITR_TP',
    title: 'File the income tax return (transfer pricing case)',
    authority: 'INCOME_TAX',
    category: 'Annual return',
    form: 'ITR-5 / ITR-6',
    legalReference: 'Section 139(1) Explanation 2(a)(iii), Income-tax Act 1961',
    description:
      'Where Form 3CEB is required, the return is due 30 November instead of 31 October.',
    severity: 'CRITICAL',
    penalty: 'Late fee under s.234F, interest under s.234A, and loss of the right to carry forward business losses.',
    evidenceRequired: ['ITR-V acknowledgement', 'Computation of income', 'Form 3CEB acknowledgement'],
    evidenceLevel: 'REQUIRED',
    basedOnAnnualAccounts: true,
    periodKind: 'ANNUAL',
    applicableWhen: [hasForeignTransactions()],
    occurrences: annual({ month: 11, day: 30 }),
  },
  {
    code: 'IT_ITR_NON_AUDITED',
    title: 'File the income tax return (non-audited firm or proprietorship)',
    authority: 'INCOME_TAX',
    category: 'Annual return',
    form: 'ITR-3 / ITR-4 / ITR-5',
    legalReference: 'Section 139(1), Income-tax Act 1961',
    description: 'Firms and proprietorships not subject to audit file their return by 31 July.',
    severity: 'CRITICAL',
    penalty: 'Late fee of up to ₹5,000 under s.234F and interest at 1% per month under s.234A.',
    evidenceRequired: ['ITR-V acknowledgement', 'Computation of income', 'Form 26AS / AIS reconciliation'],
    evidenceLevel: 'REQUIRED',
    basedOnAnnualAccounts: true,
    periodKind: 'ANNUAL',
    applicableWhen: [isUnauditedFirm, noTransferPricing],
    occurrences: annual({ month: 7, day: 31 }),
  },
  {
    code: 'IT_SFT',
    title: 'File the statement of financial transactions (Form 61A)',
    authority: 'INCOME_TAX',
    category: 'Annual return',
    form: 'Form 61A',
    legalReference: 'Section 285BA read with Rule 114E, Income-tax Rules 1962',
    description:
      'Report specified high-value transactions — including receipts of ₹2 lakh or more in cash against sales of goods or services — by 31 May following the financial year. File only if such transactions occurred during the year; otherwise mark this waived.',
    severity: 'MEDIUM',
    penalty: '₹500 per day of default, rising to ₹1,000 per day after a notice is served, under s.271FA.',
    evidenceRequired: ['Form 61A acknowledgement', 'Working of reportable transactions'],
    evidenceLevel: 'ATTEST',
    periodKind: 'ANNUAL',
    applicableWhen: [turnoverAtLeast(1 * CRORE)],
    occurrences: annual({ month: 5, day: 31 }),
  },
];
