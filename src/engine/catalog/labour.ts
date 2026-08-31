/**
 * Labour and payroll obligations.
 *
 * Applicability is driven by headcount and state, both of which the onboarding
 * profile already captures. State-specific due dates vary, so the monthly
 * professional-tax rule carries a warning to confirm the local date.
 */
import { utcDate } from '../../lib/dates';
import { custom, employeesAtLeast } from '../conditions';
import { annual, monthly } from '../schedule';
import type { ComplianceRule } from '../types';

/** ESI applies from 10 employees, except in Maharashtra and Chandigarh where the threshold is 20. */
const esiApplies = custom(
  'Headcount crosses the ESI threshold for the state (10 employees; 20 in Maharashtra and Chandigarh)',
  (ctx) => {
    const threshold = ['MH', 'CH'].includes(ctx.company.stateCode.toUpperCase()) ? 20 : 10;
    return ctx.company.employeeCount >= threshold;
  },
);

/** States and union territories that levy professional tax. */
const PT_STATES = new Set([
  'MH', 'KA', 'WB', 'TN', 'AP', 'TG', 'GJ', 'MP', 'OD', 'OR', 'AS',
  'KL', 'TR', 'MN', 'MZ', 'ML', 'NL', 'SK', 'JH', 'BR', 'PY',
]);

const professionalTaxApplies = custom(
  'Operates in a state that levies professional tax',
  (ctx) => PT_STATES.has(ctx.company.stateCode.toUpperCase()) && ctx.company.employeeCount >= 1,
);

export const labourRules: ComplianceRule[] = [
  {
    code: 'LABOUR_EPF_ECR',
    title: 'File the EPF electronic challan-cum-return and remit contributions',
    authority: 'LABOUR',
    category: 'Payroll',
    form: 'ECR',
    legalReference: 'Paragraph 38, Employees’ Provident Funds Scheme 1952',
    description:
      'Upload the ECR and remit employee and employer provident fund contributions by the 15th of the following month.',
    severity: 'CRITICAL',
    penalty:
      'Interest at 12% per annum under s.7Q plus damages of 5% to 25% per annum under s.14B, escalating with the length of the delay. Employee contributions not deposited are also disallowed as a deduction under s.36(1)(va) of the Income-tax Act.',
    evidenceRequired: ['ECR text file', 'Payment confirmation receipt (TRRN)', 'Monthly payroll register'],
    evidenceLevel: 'REQUIRED',
    periodKind: 'MONTHLY',
    applicableWhen: [employeesAtLeast(20)],
    occurrences: monthly({ day: 15 }),
  },
  {
    code: 'LABOUR_ESI_CONTRIBUTION',
    title: 'Remit ESI contributions',
    authority: 'LABOUR',
    category: 'Payroll',
    legalReference: 'Regulation 31, Employees’ State Insurance (General) Regulations 1950',
    description:
      'Remit employee and employer ESI contributions for employees earning up to ₹21,000 a month (₹25,000 for employees with disabilities) by the 15th of the following month.',
    severity: 'CRITICAL',
    penalty: 'Interest at 12% per annum plus damages of 5% to 25% per annum, and possible prosecution under s.85.',
    evidenceRequired: ['ESI monthly contribution challan', 'Contribution statement', 'Payroll register'],
    evidenceLevel: 'REQUIRED',
    periodKind: 'MONTHLY',
    applicableWhen: [esiApplies],
    occurrences: monthly({ day: 15 }),
  },
  {
    code: 'LABOUR_PROFESSIONAL_TAX',
    title: 'Deposit professional tax deducted from salaries',
    authority: 'LABOUR',
    category: 'Payroll',
    legalReference: 'State professional tax legislation (levied under Article 276 of the Constitution)',
    description:
      'Deduct professional tax from salaries and deposit it with the state authority. Due dates and slabs are set by each state — confirm the exact date for your state before relying on this reminder.',
    severity: 'MEDIUM',
    penalty: 'Interest and penalty as prescribed by the state, commonly 1.25% to 2% per month plus a fixed penalty per return.',
    evidenceRequired: ['Professional tax challan', 'Monthly return acknowledgement', 'Employee-wise deduction statement'],
    evidenceLevel: 'REQUIRED',
    periodKind: 'MONTHLY',
    applicableWhen: [professionalTaxApplies],
    occurrences: monthly({ day: 15 }),
  },
  {
    code: 'LABOUR_POSH_IC',
    title: 'Constitute and refresh the Internal Committee under the POSH Act',
    authority: 'LABOUR',
    category: 'Workplace',
    legalReference: 'Section 4, Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act 2013',
    description:
      'Every workplace with ten or more employees must have an Internal Committee headed by a senior woman employee, with at least half its members being women and one external member from an NGO or a person familiar with the issues. Members hold office for a maximum of three years.',
    severity: 'HIGH',
    penalty: '₹50,000 for the first contravention; repeat offences can lead to cancellation of business licences and registration.',
    evidenceRequired: ['Order constituting the Internal Committee', 'Consent letters from members', 'External member appointment letter', 'POSH policy'],
    evidenceLevel: 'ATTEST',
    signatoryRequired: true,
    periodKind: 'ANNUAL',
    applicableWhen: [employeesAtLeast(10)],
    occurrences: annual({ month: 4, day: 30, anchor: 'within' }),
  },
  {
    code: 'LABOUR_POSH_ANNUAL_REPORT',
    title: 'File the POSH annual report with the District Officer',
    authority: 'LABOUR',
    category: 'Workplace',
    legalReference: 'Section 21 read with Section 22, POSH Act 2013',
    description:
      'The Internal Committee files an annual report for the calendar year with the District Officer, and the employer discloses the number of cases filed and disposed of in the board report.',
    severity: 'HIGH',
    penalty: '₹50,000 for failure to file, escalating on repeat contraventions.',
    evidenceRequired: ['Annual report submitted to the District Officer', 'Acknowledgement of filing', 'Extract of the board report disclosure'],
    evidenceLevel: 'ATTEST',
    periodKind: 'ANNUAL',
    applicableWhen: [employeesAtLeast(10)],
    // Reports on the preceding calendar year; 31 January falls inside the financial year.
    occurrences: annual({ month: 1, day: 31, anchor: 'within' }),
  },
  {
    code: 'LABOUR_BONUS_FORM_D',
    title: 'Pay statutory bonus and file the annual return (Form D)',
    authority: 'LABOUR',
    category: 'Payroll',
    form: 'Form D',
    legalReference: 'Sections 19 and 26, Payment of Bonus Act 1965 read with Rule 5',
    description:
      'Statutory bonus is payable within eight months of the close of the accounting year, that is by 30 November. The annual return in Form D follows within thirty days of that limit.',
    severity: 'MEDIUM',
    penalty: 'Imprisonment of up to six months or a fine of up to ₹1,000, or both, under s.28.',
    evidenceRequired: ['Bonus computation sheet', 'Proof of payment to employees', 'Form D acknowledgement'],
    evidenceLevel: 'ATTEST',
    periodKind: 'ANNUAL',
    applicableWhen: [employeesAtLeast(20)],
    occurrences: (fy) => [
      {
        periodKey: fy.key,
        periodLabel: fy.label,
        periodStart: fy.start,
        periodEnd: fy.end,
        dueDate: utcDate(fy.endYear, 12, 30),
      },
    ],
  },
  {
    code: 'LABOUR_SHOPS_ESTABLISHMENT',
    title: 'Renew the Shops and Establishments registration',
    authority: 'LABOUR',
    category: 'Registration',
    legalReference: 'State Shops and Commercial Establishments Acts',
    description:
      'Most states require the establishment registration to be renewed periodically and any change in employer, address or headcount to be notified. Renewal cycles and due dates differ by state — confirm yours and adjust this date.',
    severity: 'MEDIUM',
    penalty: 'State-specific fines, typically ₹1,000 to ₹50,000, and the risk of the establishment being ordered to close.',
    evidenceRequired: ['Current registration certificate', 'Renewal application and fee receipt'],
    evidenceLevel: 'ATTEST',
    periodKind: 'ANNUAL',
    applicableWhen: [employeesAtLeast(1)],
    occurrences: annual({ month: 3, day: 31, anchor: 'within' }),
  },
];
