import { describe, expect, it } from 'vitest';
import { decodeCin, decodePan, isValidGstinChecksum, panFromGstin, parseCin, stateCodeFromGstin, validateGstin } from '../src/lib/india';

describe('GSTIN validation', () => {
  it('accepts a GSTIN with a correct check digit', () => {
    expect(isValidGstinChecksum('29AAACR5055K1Z3')).toBe(true);
    expect(isValidGstinChecksum('27AAPFU0939F1ZV')).toBe(true);
  });

  it('rejects a GSTIN whose check digit does not match', () => {
    expect(isValidGstinChecksum('29AAACR5055K1ZK')).toBe(false);
  });

  it('extracts the state and PAN', () => {
    expect(stateCodeFromGstin('29AAACR5055K1Z3')).toBe('KA');
    expect(stateCodeFromGstin('33AAACR5055K1ZE')).toBe('TN');
    expect(panFromGstin('29AAACR5055K1Z3')).toBe('AAACR5055K');
  });

  it('flags a GSTIN that belongs to a different PAN', () => {
    const result = validateGstin('29AAACR5055K1Z3', 'AAACT1234A');
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('does not match the company PAN');
  });

  it('accepts a matching PAN and reports the state', () => {
    const result = validateGstin('29AAACR5055K1Z3', 'AAACR5055K');
    expect(result).toMatchObject({ valid: true, stateCode: 'KA', pan: 'AAACR5055K' });
  });
});

describe('CIN parsing', () => {
  it('reads listing status, state and year', () => {
    expect(parseCin('U72900TN2020PTC123456')).toEqual({ listed: false, stateCode: 'TN', year: 2020 });
    expect(parseCin('L17110MH1973PLC019786')).toEqual({ listed: true, stateCode: 'MH', year: 1973 });
  });

  it('returns null for a malformed CIN', () => {
    expect(parseCin('NOTACIN')).toBeNull();
  });
});

describe('CIN decoding', () => {
  it('reads entity type, state, year and listing status out of the identifier', () => {
    expect(decodeCin('U72900TN2020PTC138472')).toMatchObject({
      entityType: 'PRIVATE_LIMITED',
      ownershipLabel: 'Private Limited Company',
      stateCode: 'TN',
      stateName: 'Tamil Nadu',
      incorporationYear: 2020,
      listed: false,
      industry: 'Computer and related activities',
      registrationNumber: '138472',
    });
  });

  it('recognises a listed public company', () => {
    expect(decodeCin('L17110MH1973PLC019786')).toMatchObject({
      entityType: 'PUBLIC_LIMITED',
      listed: true,
      stateCode: 'MH',
      incorporationYear: 1973,
      industry: 'Manufacturing',
    });
  });

  it('maps the OPC and Section 8 ownership classes', () => {
    expect(decodeCin('U74999MH2019OPC322111')?.entityType).toBe('OPC');
    expect(decodeCin('U85110DL2015NPL285432')?.entityType).toBe('SECTION_8');
  });

  it('refuses to guess the entity type of a government company', () => {
    const decoded = decodeCin('U40100RJ2000SGC016485');
    expect(decoded?.ownershipLabel).toBe('State Government Company');
    // Government companies may be private or public — better blank than wrong.
    expect(decoded?.entityType).toBeNull();
  });

  it('translates the CIN state codes that differ from the GST ones', () => {
    // CINs use OR for Odisha where the GST short code is OD.
    expect(decodeCin('U15100OR2010PTC012345')?.stateCode).toBe('OD');
  });

  it('prefers the narrower industry division when ranges overlap', () => {
    // 72 sits inside 70-74 but is more specific.
    expect(decodeCin('U72900TN2020PTC138472')?.industry).toBe('Computer and related activities');
    expect(decodeCin('U70101TN2020PTC138472')?.industry).toBe('Real estate, renting and business activities');
  });

  it('returns null for anything that is not a CIN', () => {
    expect(decodeCin('NOTACIN')).toBeNull();
    expect(decodeCin('X72900TN2020PTC138472')).toBeNull();
  });
});

describe('PAN decoding', () => {
  it('reads the holder type from the fourth character', () => {
    expect(decodePan('AAACN4321B')?.holderType).toBe('Company');
    expect(decodePan('AABFS9012C')?.holderType).toBe('Firm or LLP');
    expect(decodePan('ABCPK1234D')?.holderType).toBe('Individual');
    expect(decodePan('AAATR1234E')?.holderType).toBe('Trust');
  });

  it('returns null for a malformed PAN', () => {
    expect(decodePan('AAAC4321B')).toBeNull();
  });
});
