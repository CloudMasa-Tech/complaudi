import { describe, expect, it } from 'vitest';
import { evaluateRegistrations } from '../src/engine/catalog/registrations';

describe('evaluateRegistrations', () => {
  it('GST registration required for turnover >= 20L', () => {
    const profile = { entityType: 'PRIVATE_LIMITED', annualTurnover: 21_00_000, gstins: [] };
    const result = evaluateRegistrations(profile).find(r => r.id === 'gst')!;
    expect(result.status).toBe('MANDATORY');
    
    const profileBelow = { entityType: 'PRIVATE_LIMITED', annualTurnover: 5_00_000, gstins: [] };
    const resultBelow = evaluateRegistrations(profileBelow).find(r => r.id === 'gst')!;
    expect(resultBelow.status).toBe('ELIGIBLE');

    const profileDone = { entityType: 'PRIVATE_LIMITED', annualTurnover: 25_00_000, gstins: [{ gstin: '1' }] };
    const resultDone = evaluateRegistrations(profileDone).find(r => r.id === 'gst')!;
    expect(resultDone.status).toBe('REGISTERED');
  });

  it('MCA CIN applies only to specific entities', () => {
    const pvt = { entityType: 'PRIVATE_LIMITED', registrationNumber: null };
    const resultPvt = evaluateRegistrations(pvt).find(r => r.id === 'mca_cin')!;
    expect(resultPvt.status).toBe('MANDATORY');

    const llp = { entityType: 'LLP', registrationNumber: null };
    const resultLlp = evaluateRegistrations(llp).find(r => r.id === 'mca_cin');
    expect(resultLlp).toBeUndefined(); // Should not be in the list for LLP
  });

  it('correctly evaluates zero registrations for a company without false REGISTERED flags', () => {
    const zeroRegistrationsProfile = {
      id: 'comp-zero',
      entityType: 'PRIVATE_LIMITED',
      registrationNumber: null,
      annualTurnover: 0,
      employeeCount: 0,
      stateCode: 'MH',
      msme: null,
      dpiit: null,
      gstins: [],
      epfoCode: null,
      esicCode: null,
    };

    const results = evaluateRegistrations(zeroRegistrationsProfile);
    const registered = results.filter(r => r.status === 'REGISTERED');
    expect(registered.length).toBe(0);

    const msme = results.find(r => r.id === 'msme')!;
    expect(msme.status).toBe('ELIGIBLE');

    const dpiit = results.find(r => r.id === 'dpiit')!;
    expect(dpiit.status).toBe('ELIGIBLE');

    const cin = results.find(r => r.id === 'mca_cin')!;
    expect(cin.status).toBe('MANDATORY');
  });

  it('generates different scores for different companies based on real data', () => {
    const companyA = {
      entityType: 'PRIVATE_LIMITED',
      registrationNumber: 'U12345MH2020PTC123456',
      annualTurnover: 50_00_000,
      employeeCount: 25,
      stateCode: 'MH',
      msme: { udyamNumber: 'UDYAM-MH-01-0001234' },
      dpiit: null,
      gstins: [{ gstin: '27AAAAA0000A1Z5', stateCode: 'MH', isActive: true }],
      epfoCode: 'MH12345',
      esicCode: null,
    };

    const companyB = {
      entityType: 'LLP',
      registrationNumber: 'AAA-1234',
      annualTurnover: 10_00_000,
      employeeCount: 2,
      stateCode: 'KA',
      msme: null,
      dpiit: null,
      gstins: [],
      epfoCode: null,
      esicCode: null,
    };

    const resultsA = evaluateRegistrations(companyA);
    const regA = resultsA.filter(r => r.status === 'REGISTERED').length;

    const resultsB = evaluateRegistrations(companyB);
    const regB = resultsB.filter(r => r.status === 'REGISTERED').length;

    expect(regA).toBeGreaterThan(regB);
    expect(regA).toBe(4); // MCA CIN, GST, MSME, PF
    expect(regB).toBe(1); // MCA LLPIN
  });

  it('treats empty strings, whitespace, and undefined udyam/dpiit numbers as NOT REGISTERED', () => {
    const profileWithEmptyValues = {
      entityType: 'PRIVATE_LIMITED',
      registrationNumber: '   ',
      msme: { udyamNumber: undefined },
      dpiit: { number: '' },
      gstins: [{ gstin: '   ', isActive: true }],
      epfoCode: '',
      esicCode: '   ',
    };

    const results = evaluateRegistrations(profileWithEmptyValues);
    const registered = results.filter(r => r.status === 'REGISTERED');
    expect(registered.length).toBe(0);

    const msme = results.find(r => r.id === 'msme')!;
    expect(msme.status).toBe('ELIGIBLE');
    expect(msme.reason).not.toContain('undefined');

    const dpiit = results.find(r => r.id === 'dpiit')!;
    expect(dpiit.status).toBe('ELIGIBLE');
    expect(dpiit.reason).not.toContain('undefined');
  });
});