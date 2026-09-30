import { describe, expect, it, vi } from 'vitest';
import { BizVerifyProvider } from '../src/lib/verifications/providers/mca/bizVerify';
import { validateCompanyMasterData } from '../src/lib/companyValidation';

/**
 * registerTrial reaches the database and the real verification provider, and
 * neither belongs in a unit test.
 *
 * Unmocked, test 6 below created users and organisations in the live Supabase
 * database on every run — hence rows like unavail_test_<timestamp>@example.com
 * and 22 organisations against 4 real companies — and called the BizVerify API
 * over the network, which is what made it time out at 5s and fail at random.
 */
vi.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
    company: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
    organization: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('../src/lib/mailer', () => ({ sendMail: vi.fn().mockResolvedValue(undefined) }));

const mockVerifyCompany = vi.fn();
vi.mock('../src/lib/verifications', () => ({
  getCompanyVerificationProvider: () => ({ verifyCompany: mockVerifyCompany }),
}));

import { registerTrial } from '../src/modules/auth/auth.service';
import { prisma } from '../src/lib/prisma';

describe('BizVerify Provider & Verification Architecture', () => {

  it('1. Successfully verifies and normalizes master record for a valid CIN', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          cin: 'U72900TN2020PTC138472',
          companyName: 'NORTHWIND TECHNOLOGIES PRIVATE LIMITED',
          companyStatus: 'ACTIVE',
          incorporationDate: '2020-07-14',
          stateCode: 'TN',
          entityType: 'PRIVATE_LIMITED',
          roc: 'ROC Chennai',
        },
      }),
    });

    const provider = new BizVerifyProvider({
      baseUrl: 'http://localhost:8000',
      serviceToken: 'test-token',
      fetchFn: mockFetch as any,
    });

    const res = await provider.verifyCompany('U72900TN2020PTC138472');

    expect(res.success).toBe(true);
    expect(res.data).toBeDefined();
    expect(res.data?.cin).toBe('U72900TN2020PTC138472');
    expect(res.data?.legalName).toBe('NORTHWIND TECHNOLOGIES PRIVATE LIMITED');
    expect(res.data?.status).toBe('ACTIVE');
    expect(res.data?.stateCode).toBe('TN');
    expect(res.data?.incorporationYear).toBe(2020);

    // Verify correct authorization headers were sent
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8000/api/company/U72900TN2020PTC138472',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer test-token',
          'x-service-token': 'test-token',
        }),
      }),
    );
  });

  it('2. Returns INVALID_CIN error for malformed CIN format without contacting API', async () => {
    const mockFetch = vi.fn();
    const provider = new BizVerifyProvider({ fetchFn: mockFetch as any });

    const res = await provider.verifyCompany('INVALIDCIN123');

    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('INVALID_CIN');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('3. Returns COMPANY_NOT_FOUND error when BizVerify API returns 404', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Company not found' }),
    });

    const provider = new BizVerifyProvider({ fetchFn: mockFetch as any });
    const res = await provider.verifyCompany('U99999MH2020PTC999999');

    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('COMPANY_NOT_FOUND');
    expect(res.error?.message).toContain('was not found in official MCA records');
  });

  it('4. Returns SERVICE_UNAVAILABLE error when BizVerify API times out or returns 500', async () => {
    const mockFetch = vi.fn().mockImplementation(() => {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      return Promise.reject(error);
    });

    const provider = new BizVerifyProvider({
      timeoutMs: 100,
      fetchFn: mockFetch as any,
    });

    const res = await provider.verifyCompany('U72900TN2020PTC138472');

    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('SERVICE_UNAVAILABLE');
    expect(res.error?.message).toContain('timed out');
  });

  it('5. Validates user input against BizVerify CompanyMasterRecord and detects mismatches', async () => {
    const masterRecord = {
      cin: 'U72900TN2020PTC138472',
      legalName: 'NORTHWIND TECHNOLOGIES PRIVATE LIMITED',
      entityType: 'PRIVATE_LIMITED',
      incorporationDate: '2020-07-14',
      incorporationYear: 2020,
      stateCode: 'TN',
      roc: 'ROC Chennai',
      status: 'ACTIVE',
    };

    // User supplies wrong company name
    const resultMismatchName = validateCompanyMasterData({
      cin: 'U72900TN2020PTC138472',
      companyName: 'WRONG NAME PRIVATE LIMITED',
      entityType: 'PRIVATE_LIMITED',
      incorporationDate: '2020-07-14',
      stateCode: 'TN',
      masterRecord,
    });

    expect(resultMismatchName.valid).toBe(false);
    expect(resultMismatchName.errors.some((e) => e.field === 'companyName')).toBe(true);

    // User supplies wrong state code
    const resultMismatchState = validateCompanyMasterData({
      cin: 'U72900TN2020PTC138472',
      companyName: 'NORTHWIND TECHNOLOGIES PRIVATE LIMITED',
      entityType: 'PRIVATE_LIMITED',
      incorporationDate: '2020-07-14',
      stateCode: 'KA', // Mismatch vs TN
      masterRecord,
    });

    expect(resultMismatchState.valid).toBe(false);
    expect(resultMismatchState.errors.some((e) => e.field === 'stateCode')).toBe(true);
  });

  it('6. Ensures registration fails when BizVerify verification service is unavailable', async () => {
    // The provider is unreachable...
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: 'Service Unavailable' }),
    });
    const provider = new BizVerifyProvider({ fetchFn: mockFetch as any });
    const res = await provider.verifyCompany('U72900TN2020PTC138472');
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('SERVICE_UNAVAILABLE');

    // ...and registration refuses rather than enrolling an unverified company.
    mockVerifyCompany.mockResolvedValue(res);

    await expect(
      registerTrial({
        name: 'Test Admin',
        email: 'unavail_test@example.com',
        phone: '9876543210',
        password: 'Password123!',
        companyName: 'NORTHWIND TECHNOLOGIES PRIVATE LIMITED',
        entityType: 'PRIVATE_LIMITED',
        stateCode: 'TN',
        incorporationDate: '2020-07-14',
        cin: 'U72900TN2020PTC138472',
      }),
      // Asserted on the message, not just "throws": this must fail *because*
      // verification was unavailable, not because a mock returned undefined.
    ).rejects.toThrow(/verification service is currently unavailable/i);

    // And nothing was written. This is the part that was landing in the real
    // database on every run.
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.organization.create).not.toHaveBeenCalled();
    expect(prisma.company.create).not.toHaveBeenCalled();
  });
});
