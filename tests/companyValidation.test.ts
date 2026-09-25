import { describe, expect, it } from 'vitest';
import { validateCompanyMasterData } from '../src/lib/companyValidation';

describe('Company CIN Validation Business Rules', () => {
  const existingCin = 'U62099PY2026PTC009629';
  const anotherCin = 'L22210MH1995PLC084781';
  const newValidCin = 'U72900TN2020PTC138472';
  const currentCompanyId = 'f4cc7ada-ace4-4062-b676-bb8d0791926a';

  describe('Registration Flow', () => {
    it('1. Registration: New company + existing CIN -> BLOCK', () => {
      const res = validateCompanyMasterData({
        cin: existingCin,
        existingCinsInDb: [existingCin],
      });

      expect(res.valid).toBe(false);
      expect(res.errors).toHaveLength(1);
      expect(res.errors[0]?.field).toBe('cin');
      expect(res.errors[0]?.message).toBe(
        `CIN ${existingCin} is already registered in Complaudi. Duplicate company onboarding is not permitted.`
      );
    });

    it('2. Registration: New company + new valid CIN -> ALLOW', () => {
      const res = validateCompanyMasterData({
        cin: newValidCin,
        existingCinsInDb: [existingCin],
      });

      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });
  });

  describe('Company Edit Flow', () => {
    it('3. Company Edit: Existing company + its own existing CIN -> ALLOW', () => {
      // In Edit mode for currentCompanyId, database query excludes current company ID
      const res = validateCompanyMasterData({
        cin: existingCin,
        currentCompanyId,
        existingCinsInDb: [], // current company's CIN excluded from other companies' CIN list
      });

      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
      expect(res.masterRecord?.cin).toBe(existingCin);
    });

    it("4. Company Edit: Existing company + another company's CIN -> BLOCK", () => {
      // Editing company A, but entering CIN that belongs to company B
      const res = validateCompanyMasterData({
        cin: anotherCin,
        currentCompanyId,
        existingCinsInDb: [anotherCin], // anotherCin belongs to company B
      });

      expect(res.valid).toBe(false);
      expect(res.errors).toHaveLength(1);
      expect(res.errors[0]?.field).toBe('cin');
      expect(res.errors[0]?.message).toBe(
        `CIN ${anotherCin} is already registered to another company in Complaudi.`
      );
    });

    it('5. Company Edit: Existing company + new unused valid CIN -> ALLOW', () => {
      const res = validateCompanyMasterData({
        cin: newValidCin,
        currentCompanyId,
        existingCinsInDb: [existingCin, anotherCin],
      });

      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
      expect(res.masterRecord?.cin).toBe(newValidCin);
    });

    it('6. Company Edit: Invalid CIN -> BLOCK', () => {
      const res = validateCompanyMasterData({
        cin: 'INVALID_CIN_123',
        currentCompanyId,
      });

      expect(res.valid).toBe(false);
      expect(res.errors).toHaveLength(1);
      expect(res.errors[0]?.field).toBe('cin');
      expect(res.errors[0]?.message).toContain('Invalid CIN format');
    });

    it('7. Company Edit: MCA/BizVerify unavailable -> preserves input master record', () => {
      const res = validateCompanyMasterData({
        cin: existingCin,
        companyName: 'EXEMPLAR TECH PRIVATE LIMITED',
        stateCode: 'PY',
        currentCompanyId,
        masterRecord: null, // MCA lookup failed/unavailable
      });

      expect(res.valid).toBe(true);
      expect(res.masterRecord).toBeDefined();
      expect(res.masterRecord?.cin).toBe(existingCin);
      expect(res.masterRecord?.legalName).toBe('EXEMPLAR TECH PRIVATE LIMITED');
    });
  });
});
