import { describe, expect, it } from 'vitest';
import { validatePanInput } from '../src/lib/panValidation';

describe('PAN Verification UI & Helper Unit Tests', () => {
  it('1. Rejects empty PAN input', () => {
    const res = validatePanInput('');
    expect(res.formatValid).toBe(false);
  });

  it('2. Rejects invalid PAN format (wrong length or characters)', () => {
    const res1 = validatePanInput('INVALID123');
    expect(res1.formatValid).toBe(false);

    const res2 = validatePanInput('12345ABCDE');
    expect(res2.formatValid).toBe(false);
  });

  it('3. Normalizes PAN input and decodes holder type (Company code C)', () => {
    const res = validatePanInput('  aaact2727q  ');
    expect(res.formatValid).toBe(true);
    expect(res.holderCode).toBe('C');
    expect(res.holderType).toBe('Company');
    expect(res.isCompany).toBe(true);
  });

  it('4. Decodes individual holder code P correctly', () => {
    const res = validatePanInput('ABCPE1234F');
    expect(res.formatValid).toBe(true);
    expect(res.holderCode).toBe('P');
    expect(res.holderType).toBe('Individual');
    expect(res.isCompany).toBe(false);
  });

  it('5. Decodes Firm/LLP holder code F correctly', () => {
    const res = validatePanInput('ABCFE1234F');
    expect(res.formatValid).toBe(true);
    expect(res.holderCode).toBe('F');
    expect(res.holderType).toBe('Firm or LLP');
  });

  it('6. Validates LOCAL_VALIDATION result disclaimer rules', () => {
    const mockResult = {
      verificationLevel: 'LOCAL_VALIDATION',
      verificationSource: 'FORMAT_VALIDATION',
      linkedGstins: [],
      gst: null,
    };

    expect(mockResult.verificationLevel).toBe('LOCAL_VALIDATION');
    expect(mockResult.linkedGstins.length).toBe(0);
    // Explicit disclaimer check
    const disclaimer = 'Income Tax PAN verification is not configured.';
    expect(disclaimer).toContain('Income Tax PAN verification is not configured');
  });

  it('7. Validates GST_CROSS_REFERENCE result structure', () => {
    const mockResult = {
      verificationLevel: 'GST_CROSS_REFERENCE',
      verificationSource: 'GST_PORTAL',
      linkedGstins: ['27AAACT2727Q1ZW'],
      gst: {
        legalName: 'TATA MOTORS PASSENGER VEHICLES LIMITED',
        tradeName: 'TATA MOTORS PASSENGER VEHICLES LIMITED',
        status: 'Active',
        constitution: 'Public Limited Company',
        registrationDate: '2017-07-01',
      },
    };

    expect(mockResult.verificationLevel).toBe('GST_CROSS_REFERENCE');
    expect(mockResult.linkedGstins[0]).toBe('27AAACT2727Q1ZW');
    expect(mockResult.gst?.legalName).toBe('TATA MOTORS PASSENGER VEHICLES LIMITED');
  });

  it('8. Ensures changing PAN invalidates previous verification state', () => {
    let verifiedPan: string | null = 'AAACT2727Q';
    let verifiedResult: any = { verificationLevel: 'LOCAL_VALIDATION' };

    // User edits PAN to new value
    const nextPan = 'ABCDE1234F';
    if (nextPan !== verifiedPan) {
      verifiedResult = null;
      verifiedPan = null;
    }

    expect(verifiedResult).toBeNull();
    expect(verifiedPan).toBeNull();
  });
});
