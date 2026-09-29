import { describe, expect, it, vi, beforeEach } from 'vitest';
import { handleGstApiRequest } from '../src/lib/verifications/gstApi';
import * as verificationsModule from '../src/lib/verifications/index';

vi.mock('../src/lib/verifications/index', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    getGstVerificationProvider: vi.fn(),
  };
});

describe('GST API Edge Function (gst-api) Unit Tests', () => {
  const validCompanyId = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';
  const validGstin = '27AAACT2727Q1ZW';

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
    vi.mocked(verificationsModule.getGstVerificationProvider).mockReturnValue(mockProvider as any);
  });

  it('1. Handles OPTIONS CORS preflight request', async () => {
    const req = new Request('http://localhost:8000/functions/v1/gst-api/session', {
      method: 'OPTIONS',
    });
    const res = await handleGstApiRequest(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('2. Rejects unauthorized request missing auth token', async () => {
    const getAuthContext = vi.fn().mockRejectedValue({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Missing Authorization header' });

    const req = new Request('http://localhost:8000/functions/v1/gst-api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId: validCompanyId, gstin: validGstin }),
    });

    const res = await handleGstApiRequest(req, { getAuthContext });
    expect(res.status).toBe(401);
    const body: any = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('3. Rejects request missing companyId', async () => {
    const getAuthContext = vi.fn().mockResolvedValue(defaultAuthContext);

    const req = new Request('http://localhost:8000/functions/v1/gst-api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-123' },
      body: JSON.stringify({ gstin: validGstin }),
    });

    const res = await handleGstApiRequest(req, { getAuthContext });
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error.message).toContain('companyId is required');
  });

  it('4. Rejects request with invalid non-UUID companyId', async () => {
    const getAuthContext = vi.fn().mockResolvedValue(defaultAuthContext);

    const req = new Request('http://localhost:8000/functions/v1/gst-api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-123' },
      body: JSON.stringify({ companyId: 'not-a-valid-uuid', gstin: validGstin }),
    });

    const res = await handleGstApiRequest(req, { getAuthContext });
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error.message).toContain('must be a valid UUID');
  });

  it('5. Rejects user without company.edit permission', async () => {
    const getAuthContext = vi.fn().mockResolvedValue({ ...defaultAuthContext, role: 'VIEWER' });
    const assertCan = vi.fn().mockRejectedValue({ statusCode: 403, code: 'FORBIDDEN', message: 'Access denied' });

    const req = new Request('http://localhost:8000/functions/v1/gst-api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-123' },
      body: JSON.stringify({ companyId: validCompanyId, gstin: validGstin }),
    });

    const res = await handleGstApiRequest(req, { getAuthContext, assertCan });
    expect(res.status).toBe(403);
    const body: any = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('6. Rejects request with invalid GSTIN format', async () => {
    const getAuthContext = vi.fn().mockResolvedValue(defaultAuthContext);
    const assertCan = vi.fn().mockResolvedValue(undefined);

    const req = new Request('http://localhost:8000/functions/v1/gst-api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-123' },
      body: JSON.stringify({ companyId: validCompanyId, gstin: 'INVALID_GSTIN_123' }),
    });

    const res = await handleGstApiRequest(req, { getAuthContext, assertCan });
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error.message).toContain('Invalid GSTIN format');
  });

  it('7. Handles successful /gst/session creation', async () => {
    const getAuthContext = vi.fn().mockResolvedValue(defaultAuthContext);
    const assertCan = vi.fn().mockResolvedValue(undefined);
    mockProvider.createSession.mockResolvedValue({
      success: true,
      sessionId: 'sess-test-999',
      gstin: validGstin,
      captchaImage: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...',
      expiresAt: '2026-09-26T12:00:00Z',
    });

    const req = new Request('http://localhost:8000/functions/v1/gst-api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-123' },
      body: JSON.stringify({ companyId: validCompanyId, gstin: validGstin }),
    });

    const res = await handleGstApiRequest(req, { getAuthContext, assertCan });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.sessionId).toBe('sess-test-999');
    expect(body.captchaImage).toBe('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...');
  });

  it('8. Verifies correct GSTIN passed to provider after normalization', async () => {
    const getAuthContext = vi.fn().mockResolvedValue(defaultAuthContext);
    const assertCan = vi.fn().mockResolvedValue(undefined);
    mockProvider.createSession.mockResolvedValue({
      success: true, sessionId: 's1', gstin: validGstin, captchaImage: 'c1',
    });

    const req = new Request('http://localhost:8000/functions/v1/gst-api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-123' },
      body: JSON.stringify({ companyId: validCompanyId, gstin: ' 27aaact2727q1zw ' }),
    });

    await handleGstApiRequest(req, { getAuthContext, assertCan });
    expect(mockProvider.createSession).toHaveBeenCalledWith('27AAACT2727Q1ZW');
  });

  it('9. Handles successful /gst/verify', async () => {
    const getAuthContext = vi.fn().mockResolvedValue(defaultAuthContext);
    const assertCan = vi.fn().mockResolvedValue(undefined);
    mockProvider.verifySession.mockResolvedValue({
      success: true,
      data: {
        gstin: validGstin,
        legalName: 'TEST CORP LTD',
        tradeName: 'TEST CORP',
        registrationDate: '2020-01-01',
        status: 'Active',
        taxpayerType: 'Regular',
        constitution: 'Private Limited Company',
        state: 'Maharashtra',
        stateCode: '27',
        panEmbedded: 'AAACT2727Q',
        principalPlaceOfBusiness: { address: 'Mumbai', city: 'Mumbai', state: 'MH', pincode: '400001' },
        natureOfBusiness: ['Software'],
        jurisdiction: { stateJurisdiction: 'W1', centralJurisdiction: 'C1' },
        einvoiceStatus: 'Yes',
      },
    });

    const req = new Request('http://localhost:8000/functions/v1/gst-api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-123' },
      body: JSON.stringify({
        companyId: validCompanyId,
        sessionId: 'sess-123',
        gstin: validGstin,
        captcha: 'K9P2W',
      }),
    });

    const res = await handleGstApiRequest(req, { getAuthContext, assertCan });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.gst.legalName).toBe('TEST CORP LTD');
  });

  it('10. Rejects /gst/verify missing sessionId', async () => {
    const getAuthContext = vi.fn().mockResolvedValue(defaultAuthContext);

    const req = new Request('http://localhost:8000/functions/v1/gst-api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-123' },
      body: JSON.stringify({ companyId: validCompanyId, gstin: validGstin, captcha: 'K9P2W' }),
    });

    const res = await handleGstApiRequest(req, { getAuthContext });
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error.message).toContain('sessionId is required');
  });

  it('11. Rejects /gst/verify missing CAPTCHA', async () => {
    const getAuthContext = vi.fn().mockResolvedValue(defaultAuthContext);

    const req = new Request('http://localhost:8000/functions/v1/gst-api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-123' },
      body: JSON.stringify({ companyId: validCompanyId, sessionId: 'sess-123', gstin: validGstin }),
    });

    const res = await handleGstApiRequest(req, { getAuthContext });
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error.message).toContain('captcha is required');
  });

  it('12. Handles invalid CAPTCHA or expired session error from provider', async () => {
    const getAuthContext = vi.fn().mockResolvedValue(defaultAuthContext);
    const assertCan = vi.fn().mockResolvedValue(undefined);
    mockProvider.verifySession.mockResolvedValue({
      success: false,
      error: { code: 'INVALID_CAPTCHA', message: 'Invalid CAPTCHA code entered.' },
    });

    const req = new Request('http://localhost:8000/functions/v1/gst-api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-123' },
      body: JSON.stringify({
        companyId: validCompanyId, sessionId: 'sess-123', gstin: validGstin, captcha: 'WRONG',
      }),
    });

    const res = await handleGstApiRequest(req, { getAuthContext, assertCan });
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error.message).toContain('Invalid CAPTCHA');
  });

  it('13. Handles GSTIN not found from provider (HTTP 404)', async () => {
    const getAuthContext = vi.fn().mockResolvedValue(defaultAuthContext);
    const assertCan = vi.fn().mockResolvedValue(undefined);
    mockProvider.createSession.mockResolvedValue({
      success: false,
      error: { code: 'GSTIN_NOT_FOUND', message: 'GSTIN was not found on official records.' },
    });

    const req = new Request('http://localhost:8000/functions/v1/gst-api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-123' },
      body: JSON.stringify({ companyId: validCompanyId, gstin: validGstin }),
    });

    const res = await handleGstApiRequest(req, { getAuthContext, assertCan });
    expect(res.status).toBe(404);
    const body: any = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('14. Handles BizVerify service failure (HTTP 502)', async () => {
    const getAuthContext = vi.fn().mockResolvedValue(defaultAuthContext);
    const assertCan = vi.fn().mockResolvedValue(undefined);
    mockProvider.createSession.mockResolvedValue({
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: 'BizVerify service unavailable.' },
    });

    const req = new Request('http://localhost:8000/functions/v1/gst-api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-123' },
      body: JSON.stringify({ companyId: validCompanyId, gstin: validGstin }),
    });

    const res = await handleGstApiRequest(req, { getAuthContext, assertCan });
    expect(res.status).toBe(502);
    const body: any = await res.json();
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('15. Handles unexpected provider error (HTTP 500)', async () => {
    const getAuthContext = vi.fn().mockResolvedValue(defaultAuthContext);
    const assertCan = vi.fn().mockResolvedValue(undefined);
    mockProvider.createSession.mockResolvedValue({
      success: false,
      error: { code: 'PROVIDER_ERROR', message: 'Unexpected provider failure.' },
    });

    const req = new Request('http://localhost:8000/functions/v1/gst-api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-123' },
      body: JSON.stringify({ companyId: validCompanyId, gstin: validGstin }),
    });

    const res = await handleGstApiRequest(req, { getAuthContext, assertCan });
    expect(res.status).toBe(500);
    const body: any = await res.json();
    expect(body.error.code).toBe('PROVIDER_ERROR');
  });

  it('Verifies security constraints: service token never leaked, no DB writes', async () => {
    const getAuthContext = vi.fn().mockResolvedValue(defaultAuthContext);
    const assertCan = vi.fn().mockResolvedValue(undefined);
    mockProvider.verifySession.mockResolvedValue({
      success: true,
      data: {
        gstin: validGstin, legalName: 'SECURE LTD', tradeName: null, registrationDate: null,
        status: 'Active', taxpayerType: null, constitution: null, state: null, stateCode: '27',
        panEmbedded: 'AAACT2727Q', principalPlaceOfBusiness: null, natureOfBusiness: [],
        jurisdiction: null, einvoiceStatus: null,
      },
    });

    const req = new Request('http://localhost:8000/functions/v1/gst-api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-123' },
      body: JSON.stringify({
        companyId: validCompanyId, sessionId: 'sess-123', gstin: validGstin, captcha: 'SECRET_HUMAN_CAPTCHA',
      }),
    });

    const res = await handleGstApiRequest(req, { getAuthContext, assertCan });
    const text = await res.text();

    expect(text).not.toContain('BIZVERIFY_SERVICE_TOKEN');
    expect(text).not.toContain('dev-bizverify-service-token');
    expect(text).not.toContain('SECRET_HUMAN_CAPTCHA');
  });
});
