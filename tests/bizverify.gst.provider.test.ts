import { describe, expect, it, vi } from 'vitest';
import { BizVerifyGstProvider } from '../src/lib/verifications/providers/gst/bizVerify';

describe('BizVerify GST Verification Provider Unit Tests', () => {

  it('1. Successful GST session creation', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        sessionId: 'sess-abc123xyz',
        gstin: '27AAACT2727Q1ZW',
        captchaImage: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...',
        expiresAt: '2026-09-26T12:00:00Z',
      }),
    });

    const provider = new BizVerifyGstProvider({
      baseUrl: 'http://localhost:8000',
      serviceToken: 'test-token',
      fetchFn: mockFetch as any,
    });

    const sessionRes = await provider.createSession('27AAACT2727Q1ZW');

    expect(sessionRes.success).toBe(true);
    expect(sessionRes.sessionId).toBe('sess-abc123xyz');
    expect(sessionRes.gstin).toBe('27AAACT2727Q1ZW');
    expect(sessionRes.captchaImage).toBe('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...');
    expect(sessionRes.expiresAt).toBe('2026-09-26T12:00:00Z');
  });

  it('2. GSTIN normalization in session creation and verify calls', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        sessionId: 'sess-abc123xyz',
        gstin: '27AAACT2727Q1ZW',
        captchaImage: 'data:image/png;base64,...',
        expiresAt: '2026-09-26T12:00:00Z',
      }),
    });

    const provider = new BizVerifyGstProvider({
      baseUrl: 'http://localhost:8000',
      serviceToken: 'test-token',
      fetchFn: mockFetch as any,
    });

    // Pass lowercase with leading/trailing spaces
    await provider.createSession('  27aaact2727q1zw  ');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8000/api/gst/session',
      expect.objectContaining({
        body: JSON.stringify({ gstin: '27AAACT2727Q1ZW' }),
      })
    );
  });

  it('3. Successful GST verification', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        gstin: '27AAACT2727Q1ZW',
        format_valid: true,
        gst: {
          legal_name: 'COMPLAUDI TECH PRIVATE LIMITED',
          trade_name: 'COMPLAUDI',
          registration_date: '2021-04-15',
          status: 'Active',
          taxpayer_type: 'Regular',
          constitution: 'Private Limited Company',
          state: 'Maharashtra',
          state_code: '27',
          pan_embedded: 'AAACT2727Q',
          principal_place_of_business: {
            address: '101 Tech Park, BKC',
            city: 'Mumbai',
            state: 'Maharashtra',
            pincode: '400051',
          },
          nature_of_business: ['Software Development', 'Consulting'],
          jurisdiction: {
            state_jurisdiction: 'Ward 5',
            central_jurisdiction: 'Range 2',
          },
          einvoice_status: 'Yes',
        },
        source: 'GST Portal',
        fetched_at: '2026-09-26T11:00:00Z',
      }),
    });

    const provider = new BizVerifyGstProvider({
      baseUrl: 'http://localhost:8000',
      serviceToken: 'test-token',
      fetchFn: mockFetch as any,
    });

    const verifyRes = await provider.verifySession({
      sessionId: 'sess-abc123xyz',
      gstin: '27AAACT2727Q1ZW',
      captcha: 'K9P2W',
    });

    expect(verifyRes.success).toBe(true);
    expect(verifyRes.data).toBeDefined();
    expect(verifyRes.data?.gstin).toBe('27AAACT2727Q1ZW');
    expect(verifyRes.data?.legalName).toBe('COMPLAUDI TECH PRIVATE LIMITED');
    expect(verifyRes.data?.status).toBe('Active');
  });

  it('4. Correct request URL for session and verify endpoints', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, sessionId: 's1', captchaImage: 'c1' }),
    });

    const provider = new BizVerifyGstProvider({
      baseUrl: 'https://bizverify.regibiz.in/',
      serviceToken: 'token-abc',
      fetchFn: mockFetch as any,
    });

    await provider.createSession('27AAACT2727Q1ZW');
    expect(mockFetch).toHaveBeenLastCalledWith(
      'https://bizverify.regibiz.in/api/gst/session',
      expect.anything()
    );

    await provider.verifySession({
      sessionId: 's1',
      gstin: '27AAACT2727Q1ZW',
      captcha: '12345',
    });
    expect(mockFetch).toHaveBeenLastCalledWith(
      'https://bizverify.regibiz.in/api/gst/verify',
      expect.anything()
    );
  });

  it('5. Correct service-token authentication headers', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, sessionId: 's1', captchaImage: 'c1' }),
    });

    const provider = new BizVerifyGstProvider({
      baseUrl: 'http://localhost:8000',
      serviceToken: 'secret-service-token-999',
      fetchFn: mockFetch as any,
    });

    await provider.createSession('27AAACT2727Q1ZW');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer secret-service-token-999',
          'x-service-token': 'secret-service-token-999',
        }),
      })
    );
  });

  it('6. Session ID forwarding in verifySession call', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, gstin: '27AAACT2727Q1ZW', gst: { legal_name: 'TEST' } }),
    });

    const provider = new BizVerifyGstProvider({
      fetchFn: mockFetch as any,
    });

    await provider.verifySession({
      sessionId: 'target-session-id-456',
      gstin: '27AAACT2727Q1ZW',
      captcha: 'X7Y8Z',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"sessionId":"target-session-id-456"'),
      })
    );
  });

  it('7. CAPTCHA forwarding in verifySession call', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, gstin: '27AAACT2727Q1ZW', gst: { legal_name: 'TEST' } }),
    });

    const provider = new BizVerifyGstProvider({
      fetchFn: mockFetch as any,
    });

    await provider.verifySession({
      sessionId: 'sess-123',
      gstin: '27AAACT2727Q1ZW',
      captcha: 'HUMAN_CAPTCHA_VAL',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"captcha":"HUMAN_CAPTCHA_VAL"'),
      })
    );
  });

  it('8. Complete GST master data normalization', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        gstin: '27AAACT2727Q1ZW',
        gst: {
          legal_name: 'ACME ENTERPRISES PRIVATE LIMITED',
          trade_name: 'ACME LABS',
          registration_date: '2019-11-20',
          status: 'Active',
          taxpayer_type: 'Regular',
          constitution: 'Private Limited Company',
          state: 'Maharashtra',
          state_code: '27',
          pan_embedded: 'AAACT2727Q',
          principal_place_of_business: {
            address: 'Plot 45, MIDC Industrial Area',
            city: 'Pune',
            state: 'Maharashtra',
            pincode: '411018',
          },
          nature_of_business: ['Manufacturing', 'Wholesale'],
          jurisdiction: {
            state_jurisdiction: 'Division Pune 1',
            central_jurisdiction: 'Commissionerate Pune',
          },
          einvoice_status: 'Yes',
        },
      }),
    });

    const provider = new BizVerifyGstProvider({ fetchFn: mockFetch as any });

    const res = await provider.verifySession({
      sessionId: 's1',
      gstin: '27AAACT2727Q1ZW',
      captcha: 'C1234',
    });

    expect(res.success).toBe(true);
    const d = res.data!;
    expect(d.gstin).toBe('27AAACT2727Q1ZW');
    expect(d.legalName).toBe('ACME ENTERPRISES PRIVATE LIMITED');
    expect(d.tradeName).toBe('ACME LABS');
    expect(d.registrationDate).toBe('2019-11-20');
    expect(d.status).toBe('Active');
    expect(d.taxpayerType).toBe('Regular');
    expect(d.constitution).toBe('Private Limited Company');
    expect(d.state).toBe('Maharashtra');
    expect(d.stateCode).toBe('27');
    expect(d.panEmbedded).toBe('AAACT2727Q');
    expect(d.principalPlaceOfBusiness).toEqual({
      address: 'Plot 45, MIDC Industrial Area',
      city: 'Pune',
      state: 'Maharashtra',
      pincode: '411018',
    });
    expect(d.natureOfBusiness).toEqual(['Manufacturing', 'Wholesale']);
    expect(d.jurisdiction).toEqual({
      stateJurisdiction: 'Division Pune 1',
      centralJurisdiction: 'Commissionerate Pune',
    });
    expect(d.einvoiceStatus).toBe('Yes');
  });

  it('9. BizVerify 400 handling (Invalid GSTIN / CAPTCHA)', async () => {
    const mockFetchSession = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Invalid GSTIN format' }),
    });

    const provider1 = new BizVerifyGstProvider({ fetchFn: mockFetchSession as any });
    const res1 = await provider1.createSession('27AAACT2727Q1ZW');
    expect(res1.success).toBe(false);
    expect(res1.error?.code).toBe('INVALID_GSTIN');

    const mockFetchVerify = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Invalid CAPTCHA code entered' }),
    });

    const provider2 = new BizVerifyGstProvider({ fetchFn: mockFetchVerify as any });
    const res2 = await provider2.verifySession({ sessionId: 's1', gstin: '27AAACT2727Q1ZW', captcha: 'WRONG' });
    expect(res2.success).toBe(false);
    expect(res2.error?.code).toBe('INVALID_CAPTCHA');
  });

  it('10. BizVerify 401 handling (Unauthorized / Service token failure)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized service token' }),
    });

    const provider = new BizVerifyGstProvider({ fetchFn: mockFetch as any });

    const sessionRes = await provider.createSession('27AAACT2727Q1ZW');
    expect(sessionRes.success).toBe(false);
    expect(sessionRes.error?.code).toBe('UNAUTHORIZED');

    const verifyRes = await provider.verifySession({ sessionId: 's1', gstin: '27AAACT2727Q1ZW', captcha: '12345' });
    expect(verifyRes.success).toBe(false);
    expect(verifyRes.error?.code).toBe('UNAUTHORIZED');
  });

  it('11. BizVerify 404 handling (GSTIN not found)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'GSTIN not found on official records' }),
    });

    const provider = new BizVerifyGstProvider({ fetchFn: mockFetch as any });

    const sessionRes = await provider.createSession('27AAACT2727Q1ZW');
    expect(sessionRes.success).toBe(false);
    expect(sessionRes.error?.code).toBe('GSTIN_NOT_FOUND');

    const verifyRes = await provider.verifySession({ sessionId: 's1', gstin: '27AAACT2727Q1ZW', captcha: '12345' });
    expect(verifyRes.success).toBe(false);
    expect(verifyRes.error?.code).toBe('GSTIN_NOT_FOUND');
  });

  it('12. BizVerify 502 handling (Portal / Provider Service Unavailable)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ error: 'Bad Gateway / GST Portal down' }),
    });

    const provider = new BizVerifyGstProvider({ fetchFn: mockFetch as any });

    const sessionRes = await provider.createSession('27AAACT2727Q1ZW');
    expect(sessionRes.success).toBe(false);
    expect(sessionRes.error?.code).toBe('SERVICE_UNAVAILABLE');

    const verifyRes = await provider.verifySession({ sessionId: 's1', gstin: '27AAACT2727Q1ZW', captcha: '12345' });
    expect(verifyRes.success).toBe(false);
    expect(verifyRes.error?.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('13. Malformed response handling', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ unexpectedKey: 'malformed_data' }),
    });

    const provider = new BizVerifyGstProvider({ fetchFn: mockFetch as any });

    const sessionRes = await provider.createSession('27AAACT2727Q1ZW');
    expect(sessionRes.success).toBe(false);
    expect(sessionRes.error?.code).toBe('PROVIDER_ERROR');

    const mockFetchFailSuccess = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: false, message: 'Upstream GST portal error' }),
    });

    const provider2 = new BizVerifyGstProvider({ fetchFn: mockFetchFailSuccess as any });
    const verifyRes = await provider2.verifySession({ sessionId: 's1', gstin: '27AAACT2727Q1ZW', captcha: '12345' });
    expect(verifyRes.success).toBe(false);
    expect(verifyRes.error?.code).toBe('PROVIDER_ERROR');
    expect(verifyRes.error?.message).toBe('Upstream GST portal error');
  });

});
