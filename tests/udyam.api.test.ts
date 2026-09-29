import { describe, expect, it, vi, beforeEach } from 'vitest';
import { handleUdyamApiRequest } from '../src/lib/verifications/udyamApi';
import * as verificationsModule from '../src/lib/verifications/index';

vi.mock('../src/lib/verifications/index', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    getUdyamVerificationProvider: vi.fn(),
  };
});

describe('Udyam API Edge Function (udyam-api) Unit Tests', () => {
  const validCompanyId = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';
  const validUdyam = 'UDYAM-TN-28-0008330';

  const mockProvider = {
    createSession: vi.fn(),
    verifySession: vi.fn(),
  };

  const defaultAuthContext = {
    userId: 'user-1',
    organizationId: 'org-1',
    email: 'owner@example.com',
    role: 'COMPANY_OWNER',
    name: 'Owner',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verificationsModule.getUdyamVerificationProvider).mockReturnValue(mockProvider as any);
  });

  it('1. Handles OPTIONS CORS preflight request', async () => {
    const req = new Request('http://localhost:8000/functions/v1/udyam-api/session', {
      method: 'OPTIONS',
    });
    const res = await handleUdyamApiRequest(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('2. Rejects unauthorized request missing auth token', async () => {
    const getAuthContext = vi.fn().mockRejectedValue({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Missing Authorization header' });

    const req = new Request('http://localhost:8000/functions/v1/udyam-api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId: validCompanyId, udyam_number: validUdyam }),
    });

    const res = await handleUdyamApiRequest(req, { getAuthContext });
    expect(res.status).toBe(401);
    const body: any = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('3. Rejects request missing companyId', async () => {
    const getAuthContext = vi.fn().mockResolvedValue(defaultAuthContext);

    const req = new Request('http://localhost:8000/functions/v1/udyam-api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-123' },
      body: JSON.stringify({ udyam_number: validUdyam }),
    });

    const res = await handleUdyamApiRequest(req, { getAuthContext });
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error.message).toContain('companyId is required');
  });

  it('4. Rejects request with invalid Udyam format', async () => {
    const getAuthContext = vi.fn().mockResolvedValue(defaultAuthContext);
    const assertCan = vi.fn().mockResolvedValue(undefined);

    const req = new Request('http://localhost:8000/functions/v1/udyam-api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-123' },
      body: JSON.stringify({ companyId: validCompanyId, udyam_number: 'INVALID_UDYAM' }),
    });

    const res = await handleUdyamApiRequest(req, { getAuthContext, assertCan });
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error.message).toContain('Invalid Udyam registration number format');
  });

  it('5. Handles successful /udyam/session creation', async () => {
    const getAuthContext = vi.fn().mockResolvedValue(defaultAuthContext);
    const assertCan = vi.fn().mockResolvedValue(undefined);
    mockProvider.createSession.mockResolvedValue({
      success: true,
      sessionId: 'sess-udyam-123',
      udyamNumber: validUdyam,
      captchaImage: 'data:image/png;base64,mockPngBase64',
      expiresAt: '2026-09-28T16:00:00Z',
    });

    const req = new Request('http://localhost:8000/functions/v1/udyam-api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-123' },
      body: JSON.stringify({ companyId: validCompanyId, udyam_number: validUdyam }),
    });

    const res = await handleUdyamApiRequest(req, { getAuthContext, assertCan });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.sessionId).toBe('sess-udyam-123');
    expect(body.captchaImage).toContain('data:image/png;base64');
  });

  it('6. Handles successful /udyam/verify', async () => {
    const getAuthContext = vi.fn().mockResolvedValue(defaultAuthContext);
    const assertCan = vi.fn().mockResolvedValue(undefined);
    mockProvider.verifySession.mockResolvedValue({
      success: true,
      data: {
        udyamNumber: validUdyam,
        enterpriseName: 'CLOUDMASA LABS',
        ownerName: 'KEERTHANA',
        category: 'Micro',
        activityType: 'Service',
        nicCode: '62011',
        nicDescription: 'Software development',
        dateOfRegistration: '2021-05-10',
        dateOfCommencement: '2021-05-01',
        pan: 'ABCDE1234F',
        gstin: '27ABCDE1234F1Z5',
        socialCategory: 'General',
        district: 'CHENNAI',
        state: 'TAMIL NADU',
        status: 'Active',
        employees: { male: 5, female: 3, total: 8 },
        investmentInPlantMachineryInr: 500000,
        turnoverInr: 2000000,
      },
    });

    const req = new Request('http://localhost:8000/functions/v1/udyam-api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-123' },
      body: JSON.stringify({
        companyId: validCompanyId,
        sessionId: 'sess-udyam-123',
        udyam_number: validUdyam,
        captcha: 'ABC123',
      }),
    });

    const res = await handleUdyamApiRequest(req, { getAuthContext, assertCan });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.registration.enterpriseName).toBe('CLOUDMASA LABS');
  });

  it('7. Handles invalid CAPTCHA error response (400)', async () => {
    const getAuthContext = vi.fn().mockResolvedValue(defaultAuthContext);
    const assertCan = vi.fn().mockResolvedValue(undefined);
    mockProvider.verifySession.mockResolvedValue({
      success: false,
      error: { code: 'INVALID_CAPTCHA', message: 'Invalid CAPTCHA. Please try again.' },
    });

    const req = new Request('http://localhost:8000/functions/v1/udyam-api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-123' },
      body: JSON.stringify({
        companyId: validCompanyId,
        sessionId: 'sess-udyam-123',
        udyam_number: validUdyam,
        captcha: 'WRONG',
      }),
    });

    const res = await handleUdyamApiRequest(req, { getAuthContext, assertCan });
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error.message).toContain('Invalid CAPTCHA');
  });

  it('8. Handles expired session error response (400)', async () => {
    const getAuthContext = vi.fn().mockResolvedValue(defaultAuthContext);
    const assertCan = vi.fn().mockResolvedValue(undefined);
    mockProvider.verifySession.mockResolvedValue({
      success: false,
      error: { code: 'SESSION_EXPIRED', message: 'Verification session expired. Please get a new CAPTCHA.' },
    });

    const req = new Request('http://localhost:8000/functions/v1/udyam-api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-123' },
      body: JSON.stringify({
        companyId: validCompanyId,
        sessionId: 'expired-sess',
        udyam_number: validUdyam,
        captcha: 'CORRECT',
      }),
    });

    const res = await handleUdyamApiRequest(req, { getAuthContext, assertCan });
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error.message).toContain('expired');
  });

  it('9. Handles Udyam not found response (404)', async () => {
    const getAuthContext = vi.fn().mockResolvedValue(defaultAuthContext);
    const assertCan = vi.fn().mockResolvedValue(undefined);
    mockProvider.verifySession.mockResolvedValue({
      success: false,
      error: { code: 'UDYAM_NOT_FOUND', message: 'Udyam registration number was not found.' },
    });

    const req = new Request('http://localhost:8000/functions/v1/udyam-api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-123' },
      body: JSON.stringify({
        companyId: validCompanyId,
        sessionId: 'sess-udyam-123',
        udyam_number: validUdyam,
        captcha: 'CORRECT',
      }),
    });

    const res = await handleUdyamApiRequest(req, { getAuthContext, assertCan });
    expect(res.status).toBe(404);
    const body: any = await res.json();
    expect(body.error.message).toContain('not found');
  });

  it('10. Handles portal / network service error (502)', async () => {
    const getAuthContext = vi.fn().mockResolvedValue(defaultAuthContext);
    const assertCan = vi.fn().mockResolvedValue(undefined);
    mockProvider.createSession.mockResolvedValue({
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Udyam verification service is temporarily unavailable. Please try again later.' },
    });

    const req = new Request('http://localhost:8000/functions/v1/udyam-api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-123' },
      body: JSON.stringify({ companyId: validCompanyId, udyam_number: validUdyam }),
    });

    const res = await handleUdyamApiRequest(req, { getAuthContext, assertCan });
    expect(res.status).toBe(502);
    const body: any = await res.json();
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
  });
});
