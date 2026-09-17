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
});