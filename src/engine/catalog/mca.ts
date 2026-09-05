/**
 * MCA / Registrar of Companies obligations — Companies Act 2013 and LLP Act 2008.
 *
 * Due dates that hang off the AGM use `annualFromAgm`, which falls back to the
 * statutory outer limit when the company has not recorded an AGM date yet.
 */
import { addMonths, firstFinancialYearEnd, utcDate, formatDate } from '../../lib/dates';
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
    code: 'MCA_DIR12',
    title: 'Intimate director/KMP change (DIR-12)',
    authority: 'MCA',
    category: 'Governance',
    form: 'DIR-12',
    legalReference: 'Sections 7(1)(c), 168 and 170(2), Companies Act 2013 read with Rule 17 of the Companies (Appointment and Qualification of Directors) Rules, 2014',
    description:
      'File DIR-12 within 30 days of any director or KMP appointment, cessation, or change in designation. Governed by Sections 7(1)(c), 168 and 170(2) of the Companies Act 2013. Penalty: \u00b33 lakh for the company and \u00b31 lakh for officer in default.',
    severity: 'CRITICAL',
    penalty: '\u00b33,00,000 for the company and \u00b31,00,000 for the officer in default; plus additional fees of 2x-12x normal filing fee for delays beyond 30 days.',
    evidenceRequired: ['Board resolution approving appointment/change', 'DIR-2 (written consent of appointee)', 'DIR-8 (declaration of non-disqualification)', 'Appointment letter or resignation intimation'],
    evidenceLevel: 'REQUIRED',
    periodKind: 'EVENT_BASED',
    applicableWhen: [isCompaniesActEntity()],
    occurrences: (fy: any, ctx: any) => {
      const events = (ctx.company.events || []).filter((e: any) => e.eventType === 'DIR-12');
      return events.map((e: any) => ({
        periodKey: ctx.company.id + '-DIR12-' + e.eventDate + '-' + (new Date(e.eventDate.getTime() + 30 * 86400000).getTime()),
        periodLabel: 'DIR-12: ' + formatDate(new Date(e.eventDate.getTime() + 30 * 86400000)),
        periodStart: new Date(e.eventDate.getTime()),
        periodEnd: new Date(e.eventDate.getTime() + 30 * 86400000),
        dueDate: new Date(e.eventDate.getTime() + 30 * 86400000),
        metadata: { event: e, ruleCode: 'MCA_DIR12' },
      }));
    },
  },
  {
    code: 'MCA_PAS3',
    title: 'File return of allotment (PAS-3)',
    authority: 'MCA',
    category: 'MSME reporting',
    form: 'PAS-3',
    legalReference: 'Sections 39(4) and 42(9), Companies Act 2013 read with Rules 12 and 14 of the Companies (Prospectus and Allotment of Securities) Rules, 2014',
    description:
      'File PAS-3 within 30 days of the date of allotment of shares or other securities. Due 15 days for private placement under Section 42(9), otherwise 30 days. Governed by Sections 39(4) and 42(9) of the Companies Act 2013 read with Rules 12 and 14 of the Companies (Prospectus and Allotment of Securities) Rules 2014.',
    severity: 'HIGH',
    penalty: '\u00b31,000 per day or \u00b31 lakh, whichever is less (per Section 39(5)), plus additional fee escalating from 2x to 12x normal fee under Rule 12',
    evidenceRequired: ['Board resolution approving allotment', 'List of allottees (name, address, PAN)', 'Details of securities allotted (class, number, nominal value, issue price/premium)', 'Evidence of consideration received'],
    evidenceLevel: 'REQUIRED',
    periodKind: 'EVENT_BASED',
    applicableWhen: [isCompaniesActEntity()],
    occurrences: (fy: any, ctx: any) => {
      const events = (ctx.company.events || []).filter((e: any) => e.eventType === 'PAS-3');
      return events.map((e: any) => ({
        periodKey: ctx.company.id + '-PAS3-' + e.eventDate + '-' + (new Date(e.eventDate.getTime() + 30 * 86400000).getTime()),
        periodLabel: 'PAS-3: ' + formatDate(new Date(e.eventDate.getTime() + 30 * 86400000)),
        periodStart: new Date(e.eventDate.getTime()),
        periodEnd: new Date(e.eventDate.getTime() + 30 * 86400000),
        dueDate: new Date(e.eventDate.getTime() + 30 * 86400000),
        metadata: { event: e, ruleCode: 'MCA_PAS3' },
      }));
    },
  },
  {
    code: 'MCA_CHG1',
    title: 'Intimation of charge creation/modification (CHG-1)',
    authority: 'MCA',
    category: 'Governance',
    form: 'CHG-1',
    legalReference: 'Sections 77, 78 and 79, Companies Act 2013 read with Rule 3(1) of the Companies (Registration of Charges) Rules, 2014',
    description:
      'File CHG-1 within 30 days of the creation or modification of a charge on company assets (other than debentures). Governed by Sections 77, 78 and 79 of the Companies Act 2013. Unregistered charge is void against liquidator and creditors (Section 77(3)).',
    severity: 'CRITICAL',
    penalty: 'Additional fees escalating with delay: 2x up to 30 days, 4x up to 60 days, 6x up to 90 days, 10x up to 180 days, 12x beyond; plus charge void against liquidator and creditors if unregistered.',
    evidenceRequired: ['Instrument creating/modifying the charge (loan agreement, hypothecation deed, mortgage deed)', 'Board resolution authorising charge creation', 'Particulars of charge (amount secured, interest rate, repayment terms, property charged)', 'Details of every charge holder (name, address, category, PAN)', 'Company PAN and CIN'],
    evidenceLevel: 'REQUIRED',
    periodKind: 'EVENT_BASED',
    applicableWhen: [isCompaniesActEntity()],
    occurrences: (fy: any, ctx: any) => {
      const events = (ctx.company.events || []).filter((e: any) => e.eventType === 'CHG-1');
      return events.map((e: any) => ({
        periodKey: ctx.company.id + '-CHG1-' + e.eventDate + '-' + (new Date(e.eventDate.getTime() + 30 * 86400000).getTime()),
        periodLabel: 'CHG-1: ' + formatDate(new Date(e.eventDate.getTime() + 30 * 86400000)),
        periodStart: new Date(e.eventDate.getTime()),
        periodEnd: new Date(e.eventDate.getTime() + 30 * 86400000),
        dueDate: new Date(e.eventDate.getTime() + 30 * 86400000),
        metadata: { event: e, ruleCode: 'MCA_CHG1' },
      }));
    },
  },
  {
    code: 'MCA_MGT14',
    title: 'File resolutions (MGT-14)',
    authority: 'MCA',
    category: 'Governance',
    form: 'MGT-14',
    legalReference: 'Section 117(1), Companies Act 2013 read with Rule 24 of the Companies (Management and Administration) Rules, 2014',
    description:
      'File MGT-14 within 30 days of the date of passing a resolution or executing an agreement. Covers special resolutions and specified board resolutions under Section 117(3). Private companies exempt from certain board resolutions under Section 179(3).',
    severity: 'HIGH',
    penalty: 'Company: \u00b31,00,000 + \u00b3500/day (max \u00b325,00,000); Officers: \u00b350,000 + \u00b3500/day (max \u00b35,00,000) (per Section 117(2))',
    evidenceRequired: ['Certified true copy of the resolution/agreement', 'Details of the resolution passed at Board/Shareholders\u0027 meeting', 'Explanatory statement (if under Section 102)'],
    evidenceLevel: 'REQUIRED',
    periodKind: 'EVENT_BASED',
    applicableWhen: [isCompaniesActEntity()],
    occurrences: (fy: any, ctx: any) => {
      const events = (ctx.company.events || []).filter((e: any) => e.eventType === 'MGT-14');
      return events.map((e: any) => ({
periodKey: ctx.company.id + '-MGT14-' + e.eventDate + '-' + (new Date(e.eventDate.getTime() + 30 * 86400000).getTime()),
        periodLabel: 'MGT-14: ' + formatDate(new Date(e.eventDate.getTime() + 30 * 86400000)),
        periodStart: new Date(e.eventDate.getTime()),
        periodEnd: new Date(e.eventDate.getTime() + 30 * 86400000),
        dueDate: new Date(e.eventDate.getTime() + 30 * 86400000),
        metadata: { event: e, ruleCode: 'MCA_MGT14' },
      }));
    },
  },

  // NEW: DIR-11 — Director's own resignation filing
  {
    code: 'MCA_DIR11',
    title: 'File return of director resignation (DIR-11)',
    authority: 'MCA',
    category: 'Governance',
    form: 'DIR-11',
    legalReference: 'Section 168(1), Companies Act 2013 read with Rule 16 of the Companies (Appointment and Qualification of Directors) Rules, 2014',
    description:
      'File DIR-11 within 30 days of the effective date of a director\'s resignation. Filed by the resigning director personally with the ROC. Note: Company must also file DIR-12 within 30 days of receiving the resignation notice under Rule 15.',
    severity: 'HIGH',
    penalty: 'No direct statutory penalty for DIR-11 itself (optional filing post-2018 amendment), but indirect consequences: if company defaults on AOC-4/MGT-7 for 3 consecutive years, director faces Section 164(2) disqualification (5-year ban on directorships in any Indian company). Company penalty for not filing DIR-12: Rs 100/day + up to Rs 1,00,000-5,00,000 under Section 172.',
    evidenceRequired: ['Resignation letter from director', 'Proof of dispatch (speed post/courier/email)', 'DIN of resigning director', 'Board resolution acknowledging resignation'],
    evidenceLevel: 'REQUIRED',
    periodKind: 'EVENT_BASED',
    applicableWhen: [isCompaniesActEntity()],
    occurrences: (fy: any, ctx: any) => {
      const events = (ctx.company.events || []).filter((e: any) => e.eventType === 'DIR-11');
      return events.map((e: any) => ({
        periodKey: ctx.company.id + '-DIR11-' + e.eventDate + '-' + (new Date(e.eventDate.getTime() + 30 * 86400000).getTime()),
        periodLabel: 'DIR-11: ' + formatDate(new Date(e.eventDate.getTime() + 30 * 86400000)),
        periodStart: new Date(e.eventDate.getTime()),
        periodEnd: new Date(e.eventDate.getTime() + 30 * 86400000),
        dueDate: new Date(e.eventDate.getTime() + 30 * 86400000),
        metadata: { event: e, ruleCode: 'MCA_DIR11' },
      }));
    },
  },
  // NEW: CHG-4 — Charge fully repaid (satisfaction)
  {
    code: 'MCA_CHG4',
    title: 'File satisfaction of charge (CHG-4)',
    authority: 'MCA',
    category: 'Governance',
    form: 'CHG-4',
    legalReference: 'Section 82(1), Companies Act 2013 read with Rule 8(1) of the Companies (Registration of Charges) Rules, 2014',
    description:
      'File CHG-4 within 30 days of the date on which a charge (loan/secured obligation) has been fully repaid and satisfied. Updates MCA records to reflect charge removal. Failure to file attracts penalty of Rs 5,00,000 on company + Rs 50,000 on officer in default under Section 86(1), plus additional fees escalating 2x-12x for delays beyond 30 days (2x up to 30 days, 4x up to 60 days, 6x up to 90 days, 10x up to 180 days, 12x beyond). Beyond 300 days requires NCLT approval via Form CHG-8.',
    severity: 'CRITICAL',
    penalty: 'Company: Rs 5,00,000 + officer in default: Rs 50,000 (per Section 86(1)); plus additional fees: 2x up to 30 days, 4x up to 60 days, 6x up to 90 days, 10x up to 180 days, 12x beyond normal filing fee. Beyond 300 days: requires NCLT condonation via Form CHG-8.',
    evidenceRequired: ['Board resolution authorising charge satisfaction', 'Proof of full repayment (bank/NBFC letter, NOC)', 'Original charge document (CHG-1 copy or loan agreement)', 'Details of charge (amount, date created, property charged)', 'Company PAN and CIN'],
    evidenceLevel: 'REQUIRED',
    periodKind: 'EVENT_BASED',
    applicableWhen: [isCompaniesActEntity()],
    occurrences: (fy: any, ctx: any) => {
      const events = (ctx.company.events || []).filter((e: any) => e.eventType === 'CHG-4');
      return events.map((e: any) => ({
        periodKey: ctx.company.id + '-CHG4-' + e.eventDate + '-' + (new Date(e.eventDate.getTime() + 30 * 86400000).getTime()),
        periodLabel: 'CHG-4: ' + formatDate(new Date(e.eventDate.getTime() + 30 * 86400000)),
        periodStart: new Date(e.eventDate.getTime()),
        periodEnd: new Date(e.eventDate.getTime() + 30 * 86400000),
        dueDate: new Date(e.eventDate.getTime() + 30 * 86400000),
        metadata: { event: e, ruleCode: 'MCA_CHG4' },
      }));
    },
  },
  // NEW: SH-7 — Authorized share capital changed
  {
    code: 'MCA_SH7',
    title: 'File alteration of share capital (SH-7)',
    authority: 'MCA',
    category: 'Governance',
    form: 'SH-7',
    legalReference: 'Section 64, Companies Act 2013 read with Rule 15 of the Companies (Share Capital and Debentures) Rules, 2014',
    description:
      'File SH-7 within 30 days of passing the ordinary resolution altering authorized share capital. Required whenever company increases, consolidates, or otherwise alters its authorized share capital. Late filing attracts penalty of ₹500/day (or ₹1,000/day per Section 450) up to ₹50,000 per officer, and fees multiplying 2x-10x (2x up to 30 days, 4x up to 60 days, 6x up to 90 days, 10x beyond 90 days). Real adjudication case: 669-day delay = ₹3,34,500 on company + ₹1,00,000 on Managing Director.',
    severity: 'HIGH',
    penalty: '₹500/day (or ₹1,000/day per Section 450) up to ₹50,000 per officer; plus additional fees multiplying 2x-10x depending on delay period (2x up to 30 days, 4x up to 60 days, 6x up to 90 days, 10x beyond 90 days). Real adjudication case: 669-day delay = ₹3,34,500 on company + ₹1,00,000 on Managing Director.',
    evidenceRequired: ['Certified true copy of ordinary resolution', 'Amended Memorandum of Association (Clause V)', 'EGM notice with explanatory statement (Section 102)', 'Board meeting convening notice (21 clear days)', 'DSC of authorized signatory (Director/CS/CEO/CFO)'],
    evidenceLevel: 'REQUIRED',
    periodKind: 'EVENT_BASED',
    applicableWhen: [isCompaniesActEntity()],
    occurrences: (fy: any, ctx: any) => {
      const events = (ctx.company.events || []).filter((e: any) => e.eventType === 'SH-7');
      return events.map((e: any) => ({
        periodKey: ctx.company.id + '-SH7-' + e.eventDate + '-' + (new Date(e.eventDate.getTime() + 30 * 86400000).getTime()),
        periodLabel: 'SH-7: ' + formatDate(new Date(e.eventDate.getTime() + 30 * 86400000)),
        periodStart: new Date(e.eventDate.getTime()),
        periodEnd: new Date(e.eventDate.getTime() + 30 * 86400000),
        dueDate: new Date(e.eventDate.getTime() + 30 * 86400000),
        metadata: { event: e, ruleCode: 'MCA_SH7' },
      }));
    },
  },
  // NEW: INC-22 — Registered office address changed
  {
    code: 'MCA_INC22',
    title: 'File registered office address change (INC-22)',
    authority: 'MCA',
    category: 'Governance',
    form: 'INC-22',
    legalReference: 'Section 12, Companies Act 2013 read with Rule 27 of the Companies (Incorporation) Rules, 2014',
    description:
      'File INC-22 within 30 days of passing the board/special resolution for a registered office address change. Required when company shifts its registered office — within same city (board resolution), within same state (special resolution), or to different ROC (special resolution + RD approval + INC-23). Late filing attracts penalty of Rs 1,000 per day under Section 12(8), capped at Rs 1,00,000.',
    severity: 'HIGH',
    penalty: 'Rs 1,000 per day under Section 12(8), capped at Rs 1,00,000. Additionally, Section 403: ₹100 per day of default. Real penalty exposure: multi-month delays can accumulate to ₹1,00,000+ in late fees. Companies Compliance Facilitation Scheme 2026 (CCFS-2026) provides one-time window to regularise pending filings by paying normal fee + 10% of accumulated late fees.',
    evidenceRequired: ['Board resolution or Special Resolution (as applicable)', 'Address proof of new registered office (utility bill not older than 2 months)', 'NOC from property owner / landlord', 'Rent agreement or sale deed of new office', 'GPS coordinates of new registered office', 'Latest audited balance sheet'],
    evidenceLevel: 'REQUIRED',
    periodKind: 'EVENT_BASED',
    applicableWhen: [isCompaniesActEntity()],
    occurrences: (fy: any, ctx: any) => {
      const events = (ctx.company.events || []).filter((e: any) => e.eventType === 'INC-22');
      return events.map((e: any) => ({
        periodKey: ctx.company.id + '-INC22-' + e.eventDate + '-' + (new Date(e.eventDate.getTime() + 30 * 86400000).getTime()),
        periodLabel: 'INC-22: ' + formatDate(new Date(e.eventDate.getTime() + 30 * 86400000)),
        periodStart: new Date(e.eventDate.getTime()),
        periodEnd: new Date(e.eventDate.getTime() + 30 * 86400000),
        dueDate: new Date(e.eventDate.getTime() + 30 * 86400000),
        metadata: { event: e, ruleCode: 'MCA_INC22' },
      }));
    },
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
