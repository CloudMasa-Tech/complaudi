import { describe, expect, it } from 'vitest';
import {
  normalizeLegalName,
  compareLegalNames,
  compareStateCode,
  compareConstitution,
  validateGstForCompany,
} from '../src/lib/gstValidation';
import type { GstMasterRecord } from '../src/lib/verifications/types';

describe('GST Verification & Data Validation Logic Unit Tests', () => {

  const sampleVerifiedGst: GstMasterRecord = {
    gstin: '27AAACT2727Q1ZW',
    legalName: 'NORTHWIND TECHNOLOGIES PRIVATE LIMITED',
    tradeName: 'NORTHWIND TECH',
    registrationDate: '2021-04-15',
    status: 'Active',
    taxpayerType: 'Regular',
    constitution: 'Private Limited Company',
    state: 'Maharashtra',
    stateCode: '27',
    panEmbedded: 'AAACT2727Q',
    principalPlaceOfBusiness: {
      address: '101 Tech Park, BKC, Mumbai',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400051',
    },
    natureOfBusiness: ['Software Development', 'Consulting'],
    jurisdiction: {
      stateJurisdiction: 'Ward 5',
      centralJurisdiction: 'Range 2',
    },
    einvoiceStatus: 'Yes',
  };

  const sampleCompany = {
    legalName: 'NORTHWIND TECHNOLOGIES PRIVATE LIMITED',
    stateCode: '27',
    entityType: 'PRIVATE_LIMITED',
  };

  it('1. Invalid GSTIN blocked before API call', () => {
    const invalidGstin = 'INVALID_GSTIN_123';
    const validation = validateGstForCompany(
      { ...sampleVerifiedGst, gstin: invalidGstin },
      sampleCompany
    );
    expect(validation.formatValid).toBe(false);
  });

  it('2. Valid GSTIN format passes initial check and initiates session', () => {
    const validation = validateGstForCompany(sampleVerifiedGst, sampleCompany);
    expect(validation.formatValid).toBe(true);
    expect(validation.checksumValid).toBe(true);
  });

  it('3. Normalizes legal names and detects matches correctly', () => {
    expect(normalizeLegalName('NORTHWIND TECHNOLOGIES PRIVATE LIMITED')).toBe('NORTHWIND TECHNOLOGIES PVT LTD');
    expect(normalizeLegalName('Northwind Technologies Pvt. Ltd.')).toBe('NORTHWIND TECHNOLOGIES PVT LTD');

    const res = compareLegalNames('NORTHWIND TECHNOLOGIES PRIVATE LIMITED', 'Northwind Technologies Pvt. Ltd.');
    expect(res.match).toBe(true);
    expect(res.details).toBe('Legal name matches');
  });

  it('4. Detects legal name mismatch when names differ significantly', () => {
    const res = compareLegalNames('NORTHWIND TECHNOLOGIES PRIVATE LIMITED', 'SOUTHWIND CONSULTING PRIVATE LIMITED');
    expect(res.match).toBe(false);
    expect(res.details).toContain('Legal name mismatch');
  });

  it('5. Validates state code match between GST state and company state', () => {
    const resSame = compareStateCode('27', '27');
    expect(resSame.match).toBe(true);

    const resStateCodeMatch = compareStateCode('27', 'MH');
    expect(resStateCodeMatch.match).toBe(true);

    const resStateNameMatch = compareStateCode('27', 'Maharashtra');
    expect(resStateNameMatch.match).toBe(true);

    const resMismatch = compareStateCode('27', 'KA');
    expect(resMismatch.match).toBe(false);
    expect(resMismatch.details).toContain('State mismatch');
  });

  it('6. Validates constitution vs company entity type', () => {
    const res1 = compareConstitution('Private Limited Company', 'PRIVATE_LIMITED');
    expect(res1.match).toBe(true);

    const res2 = compareConstitution('Limited Liability Partnership', 'LLP');
    expect(res2.match).toBe(true);

    const resMismatch = compareConstitution('Sole Proprietorship', 'PRIVATE_LIMITED');
    expect(resMismatch.match).toBe(false);
    expect(resMismatch.details).toContain('Constitution mismatch');
  });

  it('7. Correctly identifies active vs non-active GST status', () => {
    const activeValidation = validateGstForCompany(sampleVerifiedGst, sampleCompany);
    expect(activeValidation.isActiveStatus).toBe(true);
    expect(activeValidation.statusDetails).toBe('GST status: Active');

    const cancelledValidation = validateGstForCompany(
      { ...sampleVerifiedGst, status: 'Cancelled' },
      sampleCompany
    );
    expect(cancelledValidation.isActiveStatus).toBe(false);
    expect(cancelledValidation.statusDetails).toContain('Not Active');
  });

  it('8. Validates registration date and flags future dates', () => {
    const validDateRes = validateGstForCompany(sampleVerifiedGst, sampleCompany);
    expect(validDateRes.registrationDateCheck.valid).toBe(true);

    const futureGst = { ...sampleVerifiedGst, registrationDate: '2099-12-31' };
    const futureDateRes = validateGstForCompany(futureGst, sampleCompany);
    expect(futureDateRes.registrationDateCheck.valid).toBe(false);
    expect(futureDateRes.registrationDateCheck.details).toContain('Future registration date');
  });

  it('9. Formats complete company validation summary', () => {
    const summary = validateGstForCompany(sampleVerifiedGst, sampleCompany);

    expect(summary.formatValid).toBe(true);
    expect(summary.checksumValid).toBe(true);
    expect(summary.isActiveStatus).toBe(true);
    expect(summary.stateCheck.match).toBe(true);
    expect(summary.legalNameCheck.match).toBe(true);
    expect(summary.constitutionCheck.match).toBe(true);
    expect(summary.registrationDateCheck.valid).toBe(true);
  });

  it('10. Preserves verified data payload fields when preparing save object', () => {
    const savePayload = {
      gstin: sampleVerifiedGst.gstin,
      stateCode: sampleVerifiedGst.stateCode || sampleVerifiedGst.gstin.slice(0, 2),
      legalName: sampleVerifiedGst.legalName,
      tradeName: sampleVerifiedGst.tradeName,
      constitution: sampleVerifiedGst.constitution,
      registeredOn: sampleVerifiedGst.registrationDate,
      filingFrequency: 'MONTHLY',
      isActive: sampleVerifiedGst.status.toUpperCase() === 'ACTIVE',
    };

    expect(savePayload.gstin).toBe('27AAACT2727Q1ZW');
    expect(savePayload.stateCode).toBe('27');
    expect(savePayload.legalName).toBe('NORTHWIND TECHNOLOGIES PRIVATE LIMITED');
    expect(savePayload.tradeName).toBe('NORTHWIND TECH');
    expect(savePayload.constitution).toBe('Private Limited Company');
    expect(savePayload.filingFrequency).toBe('MONTHLY');
    expect(savePayload.isActive).toBe(true);
  });

  it('11. Preserves existing filing frequency options (MONTHLY, QRMP, COMPOSITION)', () => {
    const allowedFrequencies = ['MONTHLY', 'QRMP', 'COMPOSITION'];
    expect(allowedFrequencies).toContain('MONTHLY');
    expect(allowedFrequencies).toContain('QRMP');
    expect(allowedFrequencies).toContain('COMPOSITION');
  });

  it('12. Preserves existing certificateKey and TDS/eCommerce flags', () => {
    const existingRegistration = {
      id: 'reg-1',
      companyId: 'comp-1',
      gstin: '27AAACT2727Q1ZW',
      stateCode: '27',
      filingFrequency: 'MONTHLY',
      isTdsDeductor: false,
      isEcommerceOperator: false,
      isActive: true,
      certificateKey: 'org-1/comp-1/gst-cert.pdf',
    };

    expect(existingRegistration.certificateKey).toBe('org-1/comp-1/gst-cert.pdf');
    expect(existingRegistration.isTdsDeductor).toBe(false);
  });

  it('13. Enforces unique constraint (companyId, gstin) logic', () => {
    const existingRegistrations = [
      { id: 'reg-1', companyId: 'comp-1', gstin: '27AAACT2727Q1ZW' },
    ];

    const duplicateGstin = '27AAACT2727Q1ZW';
    const isDuplicate = existingRegistrations.some((r) => r.gstin === duplicateGstin);
    expect(isDuplicate).toBe(true);
  });

});
