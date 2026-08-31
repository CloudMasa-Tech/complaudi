/**
 * MCA / Registrar of Companies obligations — Companies Act 2013 and LLP Act 2008.
 *
 * Due dates that hang off the AGM use `annualFromAgm`, which falls back to the
 * statutory outer limit when the company has not recorded an AGM date yet.
 */
import { addMonths, firstFinancialYearEnd, utcDate } from '../../lib/dates';
import {
  CRORE,
  acceptsDeposits,
  anyOf,
  buysFromMsmeSuppliers,
  custom,
  entityIs,
  hasDirectorWithDin,
  isCompaniesActEntity,
  llpCrossesAuditThreshold,
  paidUpCapitalAtLeast,
  turnoverAtLeast,
} from '../conditions';
import {
  annual,
  annualFromAgm,
  dateAfterFy,
  halfYearly,
  oneTimeFromIncorporation,
  quarterly,
} from '../schedule';
import type { ComplianceRule } from '../types';

/**
 * s.2(85): paid-up capital ≤ ₹4 crore and turnover ≤ ₹40 crore. Public and
 * Section 8 companies can never be small companies.
 */
const isSmallCompany = custom(
  'Qualifies as a small company (capital ≤ ₹4 crore and turnover ≤ ₹40 crore)',
  (ctx) =>
    ['PRIVATE_LIMITED'].includes(ctx.company.entityType) &&
    ctx.company.paidUpCapital <= 4 * CRORE &&
    ctx.company.annualTurnover <= 40 * CRORE,
);

const isNotSmallCompany = custom(
  'Is not a small company (files the full annual return, MGT-7)',
  (ctx) => !isSmallCompany.test(ctx),
);

/** Incorporated on or after 2 November 2018 — when INC-20A was introduced. */
const incorporatedAfterInc20aCommencement = custom(
  'Incorporated on or after 2 November 2018',
  (ctx) => Boolean(ctx.company.incorporationDate && ctx.company.incorporationDate >= utcDate(2018, 11, 2)),
);

export const mcaRules: ComplianceRule[] = [
  // ------------------------------------------------------------- annual filings
  {
    code: 'MCA_AOC4',
    title: 'File financial statements (AOC-4)',
    authority: 'MCA',
    category: 'Annual filing',
    form: 'AOC-4',
    legalReference: 'Section 137, Companies Act 2013',
    description:
      'File the audited balance sheet, profit & loss account, board report and auditor report with the Registrar within 30 days of the AGM.',
    severity: 'CRITICAL',
    penalty: '₹100 per day of delay with no upper limit, plus penalties on the company and every officer in default.',
    evidenceRequired: ['Audited financial statements', 'Board report', 'Auditor report', 'AOC-4 filing challan (SRN)'],
    evidenceLevel: 'REQUIRED',
    basedOnAnnualAccounts: true,
    signatoryRequired: true,
    periodKind: 'ANNUAL',
    applicableWhen: [entityIs('PRIVATE_LIMITED', 'PUBLIC_LIMITED', 'SECTION_8')],
    occurrences: annualFromAgm({ offsetDays: 30, fallback: { month: 10, day: 30 } }),
  },
  {
    code: 'MCA_AOC4_OPC',
    title: 'File financial statements (AOC-4) — One Person Company',
    authority: 'MCA',
    category: 'Annual filing',
    form: 'AOC-4',
    legalReference: 'Section 137(1) proviso, Companies Act 2013',
    description:
      'An OPC holds no AGM, so AOC-4 is due within 180 days of the close of the financial year.',
    severity: 'CRITICAL',
    penalty: '₹100 per day of delay with no upper limit.',
    evidenceRequired: ['Audited financial statements', 'Auditor report', 'AOC-4 filing challan (SRN)'],
    evidenceLevel: 'REQUIRED',
    basedOnAnnualAccounts: true,
    signatoryRequired: true,
    periodKind: 'ANNUAL',
    applicableWhen: [entityIs('OPC')],
    occurrences: (fy) => [
      {
        periodKey: fy.key,
        periodLabel: fy.label,
        periodStart: fy.start,
        periodEnd: fy.end,
        // 180 days from 31 March
        dueDate: new Date(fy.end.getTime() + 180 * 86_400_000),
      },
    ],
  },
  {
    code: 'MCA_MGT7',
    title: 'File annual return (MGT-7)',
    authority: 'MCA',
    category: 'Annual filing',
    form: 'MGT-7',
    legalReference: 'Section 92, Companies Act 2013',
    description:
      'File the annual return covering shareholding, directors, meetings and indebtedness within 60 days of the AGM.',
    severity: 'CRITICAL',
    penalty: '₹100 per day of delay with no upper limit. Company and officers face penalties up to ₹5,00,000.',
    evidenceRequired: ['Signed MGT-7', 'List of shareholders', 'MGT-8 certificate (where applicable)', 'Filing challan (SRN)'],
    evidenceLevel: 'REQUIRED',
    basedOnAnnualAccounts: true,
    signatoryRequired: true,
    periodKind: 'ANNUAL',
    applicableWhen: [entityIs('PRIVATE_LIMITED', 'PUBLIC_LIMITED', 'SECTION_8'), isNotSmallCompany],
    occurrences: annualFromAgm({ offsetDays: 60, fallback: { month: 11, day: 28 } }),
  },
  {
    code: 'MCA_MGT7A',
    title: 'File abridged annual return (MGT-7A)',
    authority: 'MCA',
    category: 'Annual filing',
    form: 'MGT-7A',
    legalReference: 'Section 92 read with Rule 11(1), Companies (Management and Administration) Rules 2014',
    description:
      'One Person Companies and small companies file the abridged annual return MGT-7A within 60 days of the AGM (or of the date the AGM ought to have been held).',
    severity: 'CRITICAL',
    penalty: '₹100 per day of delay with no upper limit.',
    evidenceRequired: ['Signed MGT-7A', 'List of shareholders', 'Filing challan (SRN)'],
    evidenceLevel: 'REQUIRED',
    basedOnAnnualAccounts: true,
    signatoryRequired: true,
    periodKind: 'ANNUAL',
    applicableWhen: [anyOf('Is an OPC or a small company', entityIs('OPC'), isSmallCompany)],
    occurrences: annualFromAgm({ offsetDays: 60, fallback: { month: 11, day: 28 } }),
  },
  {
    code: 'MCA_ADT1',
    title: 'Intimate auditor appointment (ADT-1)',
    authority: 'MCA',
    category: 'Audit',
    form: 'ADT-1',
    legalReference: 'Section 139, Companies Act 2013',
    description:
      'File ADT-1 within 15 days of the AGM at which the auditor is appointed or reappointed. An auditor appointed for a five-year term needs only one filing — mark this waived in the intervening years.',
    severity: 'HIGH',
    penalty: 'Additional fees on a sliding scale up to 12x the normal fee; the appointment remains unregistered.',
    evidenceRequired: ['Board/AGM resolution', "Auditor's written consent and eligibility certificate", 'ADT-1 challan (SRN)'],
    evidenceLevel: 'REQUIRED',
    basedOnAnnualAccounts: true,
    signatoryRequired: true,
    periodKind: 'ANNUAL',
    applicableWhen: [isCompaniesActEntity()],
    occurrences: annualFromAgm({ offsetDays: 15, fallback: { month: 10, day: 14 } }),
  },
  {
    code: 'MCA_DIR3KYC',
    title: 'Director KYC (DIR-3 KYC)',
    authority: 'MCA',
    category: 'Director compliance',
    form: 'DIR-3 KYC / DIR-3 KYC-WEB',
    legalReference: 'Rule 12A, Companies (Appointment and Qualification of Directors) Rules 2014',
    description:
      'Every person holding a DIN or DPIN as on 31 March must complete KYC by 30 September of the same year. Use the web service if nothing has changed since last year.',
    severity: 'CRITICAL',
    penalty: 'DIN is deactivated and a flat ₹5,000 fee per director is charged to reactivate it.',
    evidenceRequired: ['DIR-3 KYC acknowledgement per director', 'PAN and Aadhaar copies', 'Digital signature certificate'],
    evidenceLevel: 'REQUIRED',
    periodKind: 'ANNUAL',
    applicableWhen: [hasDirectorWithDin()],
    occurrences: annual({ month: 9, day: 30 }),
  },
  {
    code: 'MCA_DPT3',
    title: 'Return of deposits (DPT-3)',
    authority: 'MCA',
    category: 'Annual filing',
    form: 'DPT-3',
    legalReference: 'Rule 16, Companies (Acceptance of Deposits) Rules 2014',
    description:
      'Report outstanding loans and money received that are not treated as deposits, as at 31 March, by 30 June.',
    severity: 'HIGH',
    penalty: '₹5,000 plus ₹500 for each day the default continues.',
    evidenceRequired: ['Auditor certificate on outstanding balances', 'DPT-3 challan (SRN)'],
    evidenceLevel: 'REQUIRED',
    periodKind: 'ANNUAL',
    applicableWhen: [isCompaniesActEntity(), acceptsDeposits()],
    occurrences: annual({ month: 6, day: 30 }),
  },
  {
    code: 'MCA_MSME1',
    title: 'Half-yearly return for MSME dues (MSME-1)',
    authority: 'MCA',
    category: 'MSME reporting',
    form: 'MSME-1 (Form I)',
    legalReference: 'Section 405, Companies Act 2013 read with the MSME Development Act 2006',
    description:
      'Report payments to micro and small enterprise suppliers outstanding for more than 45 days. Due 31 October for April–September and 30 April for October–March.',
    severity: 'HIGH',
    penalty: 'Penalty up to ₹25,000 on the company and ₹25,000 to ₹3,00,000 on every officer in default.',
    evidenceRequired: ['Ageing report of MSME creditors', 'Udyam certificates of suppliers', 'MSME-1 challan (SRN)'],
    evidenceLevel: 'REQUIRED',
    periodKind: 'HALF_YEARLY',
    applicableWhen: [isCompaniesActEntity(), buysFromMsmeSuppliers()],
    occurrences: halfYearly({
      // H1 (Apr–Sep) → 31 Oct of the same year; H2 (Oct–Mar) → 30 Apr after FY close.
      due: (_p, fy, i) => (i === 0 ? utcDate(fy.startYear, 10, 31) : dateAfterFy(fy, 4, 30)),
    }),
  },
  {
    code: 'MCA_CSR2',
    title: 'CSR report (CSR-2)',
    authority: 'MCA',
    category: 'CSR',
    form: 'CSR-2',
    legalReference: 'Section 135, Companies Act 2013',
    description:
      'Companies covered by the CSR provisions file a separate CSR report as an addendum to AOC-4.',
    severity: 'MEDIUM',
    penalty: 'Twice the unspent CSR amount or ₹1 crore, whichever is less, plus penalties on officers.',
    evidenceRequired: ['CSR policy', 'CSR committee minutes', 'Annual CSR expenditure statement', 'CSR-2 challan (SRN)'],
    evidenceLevel: 'REQUIRED',
    basedOnAnnualAccounts: true,
    periodKind: 'ANNUAL',
    applicableWhen: [isCompaniesActEntity(), turnoverAtLeast(1000 * CRORE)],
    occurrences: annual({ month: 3, day: 31 }),
  },

  // ------------------------------------------------------------- governance
  {
    code: 'MCA_AGM',
    title: 'Hold the Annual General Meeting',
    authority: 'MCA',
    category: 'Governance',
    legalReference: 'Section 96, Companies Act 2013',
    description:
      'Hold the AGM within six months of the financial year end, and no more than 15 months after the previous AGM. The first AGM of a new company is due within nine months of its first financial year end.',
    severity: 'CRITICAL',
    penalty: 'Up to ₹1,00,000 on the company and every officer in default, plus ₹5,000 per day of continuing default.',
    evidenceRequired: ['Notice of AGM', 'Attendance register', 'Signed AGM minutes'],
    evidenceLevel: 'REQUIRED',
    basedOnAnnualAccounts: true,
    signatoryRequired: true,
    periodKind: 'ANNUAL',
    applicableWhen: [entityIs('PRIVATE_LIMITED', 'PUBLIC_LIMITED', 'SECTION_8')],
    occurrences: (fy, ctx) => {
      const incorporatedOn = ctx.company.incorporationDate;
      // s.96: within six months of the year end — but nine for the first AGM,
      // and that first year may itself run up to fifteen months.
      const isFirstAgm =
        incorporatedOn !== null && fy.end.getTime() === firstFinancialYearEnd(incorporatedOn).getTime();
      return [
        {
          periodKey: fy.key,
          periodLabel: fy.label,
          periodStart: fy.start,
          periodEnd: fy.end,
          dueDate: isFirstAgm ? addMonths(fy.end, 9) : dateAfterFy(fy, 9, 30),
          ...(isFirstAgm ? { metadata: { firstAgm: true } } : {}),
        },
      ];
    },
  },
  {
    code: 'MCA_BOARD_MEETING',
    title: 'Hold a board meeting for the quarter',
    authority: 'MCA',
    category: 'Governance',
    legalReference: 'Section 173, Companies Act 2013',
    description:
      'Hold at least four board meetings a year with no more than 120 days between consecutive meetings. OPCs and small companies may hold two, one in each half of the year.',
    severity: 'MEDIUM',
    penalty: '₹25,000 on the company and ₹5,000 on every officer in default.',
    evidenceRequired: ['Notice of board meeting', 'Signed board minutes', 'Attendance sheet'],
    evidenceLevel: 'ATTEST',
    signatoryRequired: true,
    periodKind: 'QUARTERLY',
    applicableWhen: [isCompaniesActEntity()],
    excludeWhen: [entityIs('OPC'), isSmallCompany],
    occurrences: quarterly({ due: (p) => p.end }),
  },
  {
    code: 'MCA_BOARD_MEETING_SMALL',
    title: 'Hold a board meeting for the half-year',
    authority: 'MCA',
    category: 'Governance',
    legalReference: 'Section 173(5), Companies Act 2013',
    description:
      'One Person Companies and small companies must hold at least one board meeting in each half of the calendar year, with a gap of at least 90 days between the two.',
    severity: 'MEDIUM',
    penalty: '₹25,000 on the company and ₹5,000 on every officer in default.',
    evidenceRequired: ['Notice of board meeting', 'Signed board minutes'],
    evidenceLevel: 'ATTEST',
    signatoryRequired: true,
    periodKind: 'HALF_YEARLY',
    applicableWhen: [anyOf('Is an OPC or a small company', entityIs('OPC'), isSmallCompany)],
    occurrences: halfYearly({ due: (p) => p.end }),
  },
  {
    code: 'MCA_MBP1',
    title: 'Collect directors’ disclosure of interest (MBP-1 and DIR-8)',
    authority: 'MCA',
    category: 'Governance',
    legalReference: 'Sections 184(1) and 164(2), Companies Act 2013',
    description:
      'Every director discloses their interest in other entities in Form MBP-1 and confirms they are not disqualified in Form DIR-8, at the first board meeting of each financial year.',
    severity: 'MEDIUM',
    penalty: 'Contravention of s.184 attracts a penalty of ₹1,00,000 on the director concerned.',
    evidenceRequired: ['Signed MBP-1 from each director', 'Signed DIR-8 from each director', 'Board minutes noting the disclosures'],
    evidenceLevel: 'ATTEST',
    signatoryRequired: true,
    periodKind: 'ANNUAL',
    applicableWhen: [isCompaniesActEntity()],
    occurrences: annual({ month: 4, day: 30, anchor: 'within' }),
  },

  // ------------------------------------------------------------- one-time
  {
    code: 'MCA_INC20A',
    title: 'Declaration of commencement of business (INC-20A)',
    authority: 'MCA',
    category: 'Incorporation',
    form: 'INC-20A',
    legalReference: 'Section 10A, Companies Act 2013',
    description:
      'A company with share capital must file the declaration that subscribers have paid the subscription money within 180 days of incorporation. The company cannot commence business or borrow until it is filed.',
    severity: 'CRITICAL',
    penalty: '₹50,000 on the company and ₹1,000 per day on every officer, up to ₹1,00,000. The RoC may strike the company off.',
    evidenceRequired: ['Bank statement showing subscription money received', 'Proof of registered office', 'INC-20A challan (SRN)'],
    evidenceLevel: 'REQUIRED',
    periodKind: 'ONE_TIME',
    applicableWhen: [
      entityIs('PRIVATE_LIMITED', 'PUBLIC_LIMITED', 'OPC'),
      paidUpCapitalAtLeast(1),
      incorporatedAfterInc20aCommencement,
    ],
    occurrences: oneTimeFromIncorporation({ withinDays: 180 }),
  },

  // ------------------------------------------------------------- LLP
  {
    code: 'LLP_FORM11',
    title: 'File LLP annual return (Form 11)',
    authority: 'MCA',
    category: 'Annual filing',
    form: 'Form 11',
    legalReference: 'Section 35, LLP Act 2008',
    description:
      'File the annual return showing partners and contribution within 60 days of the close of the financial year — that is, by 30 May.',
    severity: 'CRITICAL',
    penalty: '₹100 per day of delay with no upper limit.',
    evidenceRequired: ['Signed Form 11', 'Partner contribution details', 'Filing challan (SRN)'],
    evidenceLevel: 'REQUIRED',
    basedOnAnnualAccounts: true,
    signatoryRequired: true,
    periodKind: 'ANNUAL',
    applicableWhen: [entityIs('LLP')],
    occurrences: annual({ month: 5, day: 30 }),
  },
  {
    code: 'LLP_FORM8',
    title: 'File LLP statement of account and solvency (Form 8)',
    authority: 'MCA',
    category: 'Annual filing',
    form: 'Form 8',
    legalReference: 'Section 34(2), LLP Act 2008',
    description:
      'File the statement of account and solvency within 30 days of the end of six months from the close of the financial year — that is, by 30 October.',
    severity: 'CRITICAL',
    penalty: '₹100 per day of delay with no upper limit.',
    evidenceRequired: ['Statement of account and solvency', 'Financial statements', 'Filing challan (SRN)'],
    evidenceLevel: 'REQUIRED',
    basedOnAnnualAccounts: true,
    signatoryRequired: true,
    periodKind: 'ANNUAL',
    applicableWhen: [entityIs('LLP')],
    occurrences: annual({ month: 10, day: 30 }),
  },
  {
    code: 'LLP_AUDIT',
    title: 'Get the LLP accounts audited',
    authority: 'MCA',
    category: 'Audit',
    legalReference: 'Rule 24(8), LLP Rules 2009',
    description:
      'An LLP whose turnover exceeds ₹40 lakh or whose contribution exceeds ₹25 lakh must have its accounts audited by a chartered accountant.',
    severity: 'HIGH',
    penalty: '₹25,000 to ₹5,00,000 on the LLP and ₹10,000 to ₹1,00,000 on each designated partner.',
    evidenceRequired: ['Audited financial statements', 'Auditor report', 'Auditor appointment letter'],
    evidenceLevel: 'REQUIRED',
    basedOnAnnualAccounts: true,
    signatoryRequired: true,
    periodKind: 'ANNUAL',
    applicableWhen: [entityIs('LLP'), llpCrossesAuditThreshold()],
    occurrences: annual({ month: 9, day: 30 }),
  },
];
