/**
 * MSME obligations — MSMED Act 2006 and the Udyam registration framework.
 *
 * MSME-1, the half-yearly return on overdue payments to MSE suppliers, lives in
 * the MCA catalog because it is filed with the Registrar under s.405.
 */
import { CRORE, buysFromMsmeSuppliers, custom, hasMsmeRegistration, not } from '../conditions';
import { annual } from '../schedule';
import type { ComplianceRule } from '../types';

export const msmeRules: ComplianceRule[] = [
  {
    code: 'MSME_UDYAM_UPDATE',
    title: 'Update Udyam registration details',
    authority: 'MSME',
    category: 'Registration',
    legalReference: 'Notification S.O. 2119(E) dated 26 June 2020, Ministry of MSME',
    description:
      'Update the Udyam registration with the latest ITR and GST return details every year. The portal pulls turnover and investment figures from these filings to reconfirm the micro / small / medium classification; failure to update can suspend the registration and with it the MSME benefits.',
    severity: 'MEDIUM',
    penalty:
      'The Udyam registration is liable to be suspended, which withdraws priority-sector lending, the 45-day payment protection and public-procurement preferences.',
    evidenceRequired: ['Updated Udyam certificate', 'ITR acknowledgement for the year', 'GST return summary'],
    evidenceLevel: 'ATTEST',
    periodKind: 'ANNUAL',
    applicableWhen: [hasMsmeRegistration()],
    occurrences: annual({ month: 3, day: 31, anchor: 'within' }),
  },
  {
    code: 'MSME_PAYMENT_45_DAYS',
    title: 'Clear dues to micro and small suppliers within 45 days',
    authority: 'MSME',
    category: 'Payments',
    legalReference: 'Section 15, MSMED Act 2006 read with Section 43B(h), Income-tax Act 1961',
    description:
      'Payments to micro and small enterprise suppliers must be made within the agreed period, and in any case within 45 days of acceptance — 15 days where there is no written agreement. Amounts still outstanding at the year end are disallowed as a deduction for that year and only allowed in the year of actual payment.',
    severity: 'HIGH',
    penalty:
      'The unpaid amount is disallowed under s.43B(h), increasing taxable profit. Compound interest at three times the RBI bank rate is payable to the supplier under s.16 of the MSMED Act, and that interest is never deductible.',
    evidenceRequired: [
      'Ageing analysis of MSE creditors as at 31 March',
      'Udyam certificates collected from suppliers',
      'Payment proofs for dues cleared before year end',
    ],
    evidenceLevel: 'ATTEST',
    periodKind: 'ANNUAL',
    applicableWhen: [buysFromMsmeSuppliers()],
    occurrences: annual({ month: 3, day: 31, anchor: 'within' }),
  },
  {
    code: 'MSME_SUPPLIER_DECLARATIONS',
    title: 'Collect MSME status declarations from vendors',
    authority: 'MSME',
    category: 'Payments',
    legalReference: 'Section 22, MSMED Act 2006',
    description:
      'You can only apply the 45-day rule and make the required disclosure in the notes to accounts if you know which vendors are micro or small enterprises. Refresh vendor declarations and Udyam certificates annually, since classification changes as a vendor grows.',
    severity: 'MEDIUM',
    penalty:
      'Without declarations the s.22 disclosure in the financial statements is incomplete, which is an audit qualification and leaves the s.43B(h) disallowance undetected until assessment.',
    evidenceRequired: ['Vendor master with MSME flag', 'Signed vendor declarations', 'Udyam certificate copies'],
    evidenceLevel: 'ATTEST',
    periodKind: 'ANNUAL',
    applicableWhen: [buysFromMsmeSuppliers()],
    occurrences: annual({ month: 5, day: 31, anchor: 'within' }),
  },
  {
    code: 'MSME_UDYAM_REGISTRATION',
    title: 'Consider registering on Udyam',
    authority: 'MSME',
    category: 'Registration',
    legalReference: 'Section 8, MSMED Act 2006',
    description:
      'The entity is within the MSME turnover limits but has no Udyam registration on record. Registration is free and unlocks the 45-day payment protection, priority-sector lending, public-procurement preference and interest-subvention schemes. This is an opportunity rather than a statutory obligation.',
    severity: 'LOW',
    penalty: 'None — but the MSME protections and benefits are unavailable until the entity registers.',
    evidenceRequired: ['Udyam registration certificate'],
    evidenceLevel: 'NONE',
    periodKind: 'ONE_TIME',
    applicableWhen: [
      not(hasMsmeRegistration(), 'Has no Udyam registration on record'),
      custom('Turnover is within the medium-enterprise ceiling of ₹250 crore', (ctx) => ctx.company.annualTurnover <= 250 * CRORE),
    ],
    occurrences: annual({ month: 6, day: 30, anchor: 'within' }),
  },
];
