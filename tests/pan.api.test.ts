import { describe, expect, it, vi, beforeEach } from 'vitest';
import { handlePanApiRequest } from '../src/lib/verifications/panApi';
import * as verificationsModule from '../src/lib/verifications/index';

vi.mock('../src/lib/verifications/index', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    getPanVerificationProvider: vi.fn(),
  };
});

describe('PAN API Edge Function (pan-api) Unit Tests', () => {
  const validCompanyId = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';
  const validPan = 'AAACT2727Q';

  const mockProvider = {
    verifyPan: vi.fn(),
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
    vi.mocked(verificationsModule.getPanVerificationProvider).mockReturnValue(mockProvider as any);
  });

  it('1. Handles OPTIONS CORS preflight request', async () => {
    const req = new Request('http://localhost:8000/functions/v1/pan-api/verify', {
      method: 'OPTIONS',
    });
    const res = await handlePanApiRequest(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('2. Rejects unauthenticated request missing auth token', async () => {
    const getAuthContext = vi.fn().mockRejectedValue({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Missing Authorization header' });

    const req = new Request('http://localhost:8000/functions/v1/pan-api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId: validCompanyId, pan: validPan }),
    });

    const res = await handlePanApiRequest(req, { getAuthContext });
    expect(res.status).toBe(401);
    const body: any = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('3. Rejects unauthorized company edit permission', async () => {
    const getAuthContext = vi.fn().mockResolvedValue(defaultAuthContext);
    const assertCan = vi.fn().mockRejectedValue({ statusCode: 403, code: 'FORBIDDEN', message: 'User lacks company.edit permission' });

    const req = new Request('http://localhost:8000/functions/v1/pan-api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId: validCompanyId, pan: validPan }),
    });

    const res = await handlePanApiRequest(req, { getAuthContext, assertCan });
    expect(res.status).toBe(403);
    const body: any = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
    expect(assertCan).toHaveBeenCalledWith(defaultAuthContext, validCompanyId, 'company.edit');
  });

  it('4. Rejects invalid PAN format before calling provider', async () => {
    const getAuthContext = vi.fn().mockResolvedValue(defaultAuthContext);
    const assertCan = vi.fn().mockResolvedValue(undefined);

    const req = new Request('http://localhost:8000/functions/v1/pan-api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId: validCompanyId, pan: 'INVALID123' }),
    });

    const res = await handlePanApiRequest(req, { getAuthContext, assertCan });
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error.message).toContain('Invalid PAN format');
    expect(mockProvider.verifyPan).not.toHaveBeenCalled();
  });

  it('5. Successfully verifies valid PAN via BizVerify provider', async () => {
    const getAuthContext = vi.fn().mockResolvedValue(defaultAuthContext);
    const assertCan = vi.fn().mockResolvedValue(undefined);

    mockProvider.verifyPan.mockResolvedValue({
      success: true,
      data: {
        pan: validPan,
        verified: true,
        panStatus: 'ACTIVE',
        formatValid: true,
        entityTypeCode: 'C',
        entityType: 'Company',
        verificationLevel: 'GST_CROSS_REFERENCE',
        verificationSource: 'GST_PORTAL',
        verificationMethod: 'GST_CROSS_REFERENCE',
        linkedGstins: ['27AAACT2727Q1ZW'],
        gst: {
          legalName: 'TATA MOTORS PASSENGER VEHICLES LIMITED',
          tradeName: 'TATA MOTORS PASSENGER VEHICLES LIMITED',
          status: 'Active',
          constitution: 'Public Limited Company',
          registrationDate: '2017-07-01',
        },
      },
    });

    const req = new Request('http://localhost:8000/functions/v1/pan-api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId: validCompanyId, pan: '  aaact2727q  ' }),
    });

    const res = await handlePanApiRequest(req, { getAuthContext, assertCan });
    expect(res.status).toBe(200);

    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.pan).toBe('AAACT2727Q');
    expect(body.data.verificationLevel).toBe('GST_CROSS_REFERENCE');
    expect(body.data.linkedGstins).toEqual(['27AAACT2727Q1ZW']);
    expect(body.data.gst.legalName).toBe('TATA MOTORS PASSENGER VEHICLES LIMITED');
  });

  it('6. Handles BizVerify failure response gracefully', async () => {
    const getAuthContext = vi.fn().mockResolvedValue(defaultAuthContext);
    const assertCan = vi.fn().mockResolvedValue(undefined);

    mockProvider.verifyPan.mockResolvedValue({
      success: false,
      error: {
        code: 'PAN_NOT_FOUND',
        message: 'No record found for PAN AAACT2727Q',
      },
    });

    const req = new Request('http://localhost:8000/functions/v1/pan-api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId: validCompanyId, pan: validPan }),
    });

    const res = await handlePanApiRequest(req, { getAuthContext, assertCan });
    expect(res.status).toBe(404);
    const body: any = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('7. Handles BizVerify service timeout / unavailability', async () => {
    const getAuthContext = vi.fn().mockResolvedValue(defaultAuthContext);
    const assertCan = vi.fn().mockResolvedValue(undefined);

    mockProvider.verifyPan.mockResolvedValue({
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'BizVerify API call timed out',
      },
    });

    const req = new Request('http://localhost:8000/functions/v1/pan-api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId: validCompanyId, pan: validPan }),
    });

    const res = await handlePanApiRequest(req, { getAuthContext, assertCan });
    expect(res.status).toBe(502);
    const body: any = await res.json();
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('8. Ensures BIZVERIFY_SERVICE_TOKEN is never exposed in output', async () => {
    const getAuthContext = vi.fn().mockResolvedValue(defaultAuthContext);
    const assertCan = vi.fn().mockResolvedValue(undefined);

    mockProvider.verifyPan.mockResolvedValue({
      success: true,
      data: {
        pan: validPan,
        verified: true,
        panStatus: 'ACTIVE',
        formatValid: true,
        entityTypeCode: 'C',
        entityType: 'Company',
        verificationLevel: 'GST_CROSS_REFERENCE',
        verificationSource: 'GST_PORTAL',
        verificationMethod: 'GST_CROSS_REFERENCE',
        linkedGstins: ['27AAACT2727Q1ZW'],
        gst: {
          legalName: 'TATA MOTORS PASSENGER VEHICLES LIMITED',
          tradeName: 'TATA MOTORS PASSENGER VEHICLES LIMITED',
          status: 'Active',
          constitution: 'Public Limited Company',
          registrationDate: '2017-07-01',
        },
      },
    });

    const req = new Request('http://localhost:8000/functions/v1/pan-api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId: validCompanyId, pan: validPan }),
    });

    const res = await handlePanApiRequest(req, { getAuthContext, assertCan });
    const text = await res.text();

    expect(text).not.toContain('BIZVERIFY_SERVICE_TOKEN');
    expect(text).not.toContain('dev-bizverify-service-token');
  });
});
