import { describe, expect, it } from 'vitest';
import {
  isValidUdyamFormat,
  normalizeLegalName,
  compareLegalNames,
  comparePan,
  compareState,
  validateUdyamForCompany,
} from '../web/src/lib/udyamValidation';
import type { UdyamMasterRecord } from '../web/src/api/types';

describe('Udyam Verification UI & Company Validation Tests', () => {
  const mockVerifiedUdyam: UdyamMasterRecord = {
    udyamNumber: 'UDYAM-TN-28-0008330',
    enterpriseName: 'ACME TECHNOLOGIES PRIVATE LIMITED',
    ownerName: 'KEERTHANA',
    category: 'Micro',
    activityType: 'Service',
    nicCode: '62011',
    nicDescription: 'Software development',
    dateOfRegistration: '2021-05-10',
    dateOfCommencement: '2021-05-01',
    pan: 'AAPFU0939F',
    gstin: '33AAPFU0939F1ZV',
    socialCategory: 'General',
    district: 'CHENNAI',
    state: 'TAMIL NADU',
    status: 'Active',
    employees: { male: 5, female: 3, total: 8 },
    investmentInPlantMachineryInr: 500000,
    turnoverInr: 2000000,
  };

  const mockCompany = {
    legalName: 'ACME TECHNOLOGIES PRIVATE LIMITED',
    stateCode: 'TN',
    pan: 'AAPFU0939F',
  };

  it('1. Validates Udyam Registration Number format correctly', () => {
    expect(isValidUdyamFormat('UDYAM-TN-28-0008330')).toBe(true);
    expect(isValidUdyamFormat('udyam-tn-28-0008330')).toBe(true);
    expect(isValidUdyamFormat('INVALID_UDYAM')).toBe(false);
    expect(isValidUdyamFormat('')).toBe(false);
  });

  it('2. Normalizes enterprise name and legal name for robust comparison', () => {
    expect(normalizeLegalName('ACME TECHNOLOGIES PRIVATE LIMITED')).toBe('ACME TECHNOLOGIES PVT LTD');
    expect(normalizeLegalName('Acme Technologies Pvt. Ltd.')).toBe('ACME TECHNOLOGIES PVT LTD');

    const res = compareLegalNames('ACME TECHNOLOGIES PRIVATE LIMITED', 'Acme Technologies Pvt Ltd');
    expect(res.match).toBe(true);
  });

  it('3. Identifies legal name mismatch when names differ significantly', () => {
    const res = compareLegalNames('DIFFERENT ENTERPRISE PRIVATE LIMITED', 'Acme Technologies Pvt Ltd');
    expect(res.match).toBe(false);
    expect(res.details).toContain('Legal name mismatch');
  });

  it('4. Compares PAN correctly between Udyam and company', () => {
    expect(comparePan('AAPFU0939F', 'AAPFU0939F').match).toBe(true);
    expect(comparePan('AAPFU0939F', 'DIFFERENTP').match).toBe(false);
    expect(comparePan(null, 'AAPFU0939F').match).toBe(true); // skipped
  });

  it('5. Compares State correctly between Udyam state name and company state code', () => {
    expect(compareState('TAMIL NADU', 'TN').match).toBe(true);
    expect(compareState('MAHARASHTRA', 'TN').match).toBe(false);
  });

  it('6. Generates complete company validation summary for matching Udyam record', () => {
    const summary = validateUdyamForCompany(mockVerifiedUdyam, mockCompany);

    expect(summary.formatValid).toBe(true);
    expect(summary.isActiveStatus).toBe(true);
    expect(summary.legalNameCheck.match).toBe(true);
    expect(summary.panCheck.match).toBe(true);
    expect(summary.stateCheck.match).toBe(true);
    expect(summary.failedChecks.length).toBe(0);
    expect(summary.passedChecks.length).toBeGreaterThanOrEqual(4);
  });

  it('7. Handles cancelled Udyam status by putting it in warnings', () => {
    const cancelledRecord = { ...mockVerifiedUdyam, status: 'Cancelled' };
    const summary = validateUdyamForCompany(cancelledRecord, mockCompany);

    expect(summary.isActiveStatus).toBe(false);
    expect(summary.warnings.some((w) => w.includes('Cancelled'))).toBe(true);
  });
});
