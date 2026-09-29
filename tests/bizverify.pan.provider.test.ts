import { describe, expect, it, vi } from 'vitest';
import { BizVerifyPanProvider } from '../src/lib/verifications/providers/pan/bizVerify';

describe('BizVerify PAN Verification Provider Unit Tests', () => {

  it('1. Rejects invalid PAN format before making backend call', async () => {
    const mockFetch = vi.fn();
    const provider = new BizVerifyPanProvider({ fetchFn: mockFetch as any });

    const result = await provider.verifyPan('INVALID_PAN');

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_PAN');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('2. Normalizes PAN input and sends correct request headers & body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        verified: true,
        pan: 'AAACT2727Q',
        panStatus: 'ACTIVE',
        format_valid: true,
        entity_type_code: 'C',
        entity_type: 'Company',
        verificationLevel: 'GST_CROSS_REFERENCE',
        linked_gstins: ['27AAACT2727Q1ZW'],
        gst: {
          legal_name: 'TATA MOTORS PASSENGER VEHICLES LIMITED',
          trade_name: 'TATA MOTORS PASSENGER VEHICLES LIMITED',
          status: 'Active',
          constitution: 'Public Limited Company',
          registration_date: '2017-07-01',
        },
      }),
    });

    const provider = new BizVerifyPanProvider({
      baseUrl: 'http://localhost:8000',
      serviceToken: 'test-service-token',
      fetchFn: mockFetch as any,
    });

    const res = await provider.verifyPan('  aaact2727q  ');

    expect(res.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8000/api/pan/verify',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer test-service-token',
          'x-service-token': 'test-service-token',
        }),
        body: JSON.stringify({
          pan: 'AAACT2727Q',
          cross_reference_gst: true,
        }),
      })
    );

    expect(res.data?.pan).toBe('AAACT2727Q');
    expect(res.data?.verificationLevel).toBe('GST_CROSS_REFERENCE');
    expect(res.data?.linkedGstins).toEqual(['27AAACT2727Q1ZW']);
    expect(res.data?.gst?.legalName).toBe('TATA MOTORS PASSENGER VEHICLES LIMITED');
  });

  it('3. Handles local PAN validation without linked GST', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        verified: true,
        pan: 'ABCDE1234F',
        panStatus: 'ACTIVE',
        format_valid: true,
        entity_type_code: 'C',
        entity_type: 'Company',
        verificationLevel: 'LOCAL_VALIDATION',
        verificationSource: 'LOCAL',
        linked_gstins: [],
        gst: null,
      }),
    });

    const provider = new BizVerifyPanProvider({ fetchFn: mockFetch as any });
    const res = await provider.verifyPan('ABCDE1234F');

    expect(res.success).toBe(true);
    expect(res.data?.verificationLevel).toBe('LOCAL_VALIDATION');
    expect(res.data?.linkedGstins).toEqual([]);
    expect(res.data?.gst).toBeNull();
  });

  it('4. Handles 400 Bad Request / Invalid PAN response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Invalid PAN parameter' }),
    });

    const provider = new BizVerifyPanProvider({ fetchFn: mockFetch as any });
    const res = await provider.verifyPan('AAACT2727Q');

    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('INVALID_PAN');
  });

  it('5. Handles 401 Unauthorized token response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized: Invalid token' }),
    });

    const provider = new BizVerifyPanProvider({ fetchFn: mockFetch as any });
    const res = await provider.verifyPan('AAACT2727Q');

    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('UNAUTHORIZED');
  });

  it('6. Handles 404 PAN not found response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'PAN not found' }),
    });

    const provider = new BizVerifyPanProvider({ fetchFn: mockFetch as any });
    const res = await provider.verifyPan('AAACT2727Q');

    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('PAN_NOT_FOUND');
  });

  it('7. Handles server timeout aborts cleanly', async () => {
    const mockFetch = vi.fn().mockImplementation(() => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    });

    const provider = new BizVerifyPanProvider({ fetchFn: mockFetch as any });
    const res = await provider.verifyPan('AAACT2727Q');

    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('SERVICE_UNAVAILABLE');
    expect(res.error?.message).toContain('timed out');
  });

  it('8. Ensures BIZVERIFY_SERVICE_TOKEN is not exposed in error object', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    const secret = 'super-secret-service-token-123';
    const provider = new BizVerifyPanProvider({ serviceToken: secret, fetchFn: mockFetch as any });

    const res = await provider.verifyPan('AAACT2727Q');
    const text = JSON.stringify(res);

    expect(text).not.toContain(secret);
  });
});
