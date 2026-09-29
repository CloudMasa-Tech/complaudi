// src/lib/verifications/providers/gst/bizVerify.ts
import { env } from '../../../../config/env';
import { GSTIN_REGEX } from '../../../india';
import type {
  GstVerificationProvider,
  GstSessionResult,
  GstVerificationResult,
  GstMasterRecord,
  GstVerificationErrorCode,
} from '../../types';

export interface BizVerifyGstOptions {
  baseUrl?: string;
  serviceToken?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export class BizVerifyGstProvider implements GstVerificationProvider {
  private baseUrl: string;
  private serviceToken: string;
  private timeoutMs: number;
  private fetchFn: typeof fetch;

  constructor(options: BizVerifyGstOptions = {}) {
    this.baseUrl = (options.baseUrl || env.BIZVERIFY_BASE_URL || 'https://bizverify.regibiz.in').replace(/\/+$/, '');
    this.serviceToken = options.serviceToken || env.BIZVERIFY_SERVICE_TOKEN || 'dev-bizverify-service-token';
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.fetchFn = options.fetchFn || fetch.bind(globalThis);
  }

  /**
   * Initiates a GST verification session with BizVerify and retrieves a CAPTCHA image challenge.
   */
  async createSession(gstin: string): Promise<GstSessionResult> {
    const rawGstin = (gstin || '').toUpperCase().trim();

    if (!GSTIN_REGEX.test(rawGstin)) {
      return {
        success: false,
        error: {
          code: 'INVALID_GSTIN',
          message: `Invalid GSTIN format "${rawGstin}". GSTIN must be 15 alphanumeric characters (e.g. 27AAACT2727Q1ZW).`,
        },
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const targetUrl = `${this.baseUrl}/api/gst/session`;

      const response = await this.fetchFn(targetUrl, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.serviceToken}`,
          'x-service-token': this.serviceToken,
        },
        body: JSON.stringify({ gstin: rawGstin }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.status === 400) {
        const body: any = await response.json().catch(() => ({}));
        return {
          success: false,
          error: {
            code: 'INVALID_GSTIN',
            message: body?.message || body?.error || `BizVerify reported invalid GSTIN format for "${rawGstin}".`,
          },
          rawResponse: body,
        };
      }

      if (response.status === 401) {
        return {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'BizVerify service token authentication failed.',
          },
        };
      }

      if (response.status === 404) {
        const body: any = await response.json().catch(() => ({}));
        return {
          success: false,
          error: {
            code: 'GSTIN_NOT_FOUND',
            message: body?.message || body?.error || `GSTIN "${rawGstin}" was not found on official records.`,
          },
          rawResponse: body,
        };
      }

      if (response.status === 502 || response.status === 503 || response.status === 504) {
        return {
          success: false,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: `BizVerify GST verification service returned HTTP ${response.status}. GST portal or upstream service is currently unavailable.`,
          },
        };
      }

      if (!response.ok) {
        if (response.status >= 500) {
          return {
            success: false,
            error: {
              code: 'SERVICE_UNAVAILABLE',
              message: `BizVerify GST service returned HTTP ${response.status}. Service is currently unavailable.`,
            },
          };
        }
        return {
          success: false,
          error: {
            code: 'PROVIDER_ERROR',
            message: `BizVerify returned unexpected status code ${response.status}.`,
          },
        };
      }

      const body: any = await response.json().catch(() => null);

      if (!body || typeof body !== 'object' || !body.success || !body.sessionId) {
        return {
          success: false,
          error: {
            code: 'PROVIDER_ERROR',
            message: body?.message || body?.error || 'BizVerify returned empty or malformed GST session response.',
          },
          rawResponse: body,
        };
      }

      return {
        success: true,
        sessionId: body.sessionId,
        gstin: body.gstin || rawGstin,
        captchaImage: body.captchaImage,
        expiresAt: body.expiresAt,
        rawResponse: body,
      };
    } catch (err: any) {
      clearTimeout(timer);

      if (err?.name === 'AbortError' || err?.message?.includes('aborted')) {
        return {
          success: false,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: `BizVerify GST session request timed out after ${this.timeoutMs}ms. Service is currently unavailable.`,
          },
        };
      }

      return {
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: `Unable to connect to BizVerify GST verification service: ${err?.message || 'Network error'}`,
        },
      };
    }
  }

  /**
   * Submits the human-entered CAPTCHA to verify GSTIN details for the given session.
   */
  async verifySession(params: {
    sessionId: string;
    gstin: string;
    captcha: string;
  }): Promise<GstVerificationResult> {
    const cleanSessionId = (params.sessionId || '').trim();
    const cleanGstin = (params.gstin || '').toUpperCase().trim();
    const cleanCaptcha = (params.captcha || '').trim();

    if (!cleanSessionId) {
      return {
        success: false,
        error: {
          code: 'SESSION_EXPIRED',
          message: 'Session ID is required to verify GST details.',
        },
      };
    }

    if (!cleanCaptcha) {
      return {
        success: false,
        error: {
          code: 'INVALID_CAPTCHA',
          message: 'CAPTCHA entry is required.',
        },
      };
    }

    if (!GSTIN_REGEX.test(cleanGstin)) {
      return {
        success: false,
        error: {
          code: 'INVALID_GSTIN',
          message: `Invalid GSTIN format "${cleanGstin}".`,
        },
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const targetUrl = `${this.baseUrl}/api/gst/verify`;

      const response = await this.fetchFn(targetUrl, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.serviceToken}`,
          'x-service-token': this.serviceToken,
        },
        body: JSON.stringify({
          sessionId: cleanSessionId,
          gstin: cleanGstin,
          captcha: cleanCaptcha,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.status === 400) {
        const body: any = await response.json().catch(() => ({}));
        const errMsg = body?.message || body?.error || 'Invalid CAPTCHA or expired GST session.';
        const code: GstVerificationErrorCode = errMsg.toLowerCase().includes('expire')
          ? 'SESSION_EXPIRED'
          : 'INVALID_CAPTCHA';

        return {
          success: false,
          error: {
            code,
            message: errMsg,
          },
          rawResponse: body,
        };
      }

      if (response.status === 401) {
        return {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'BizVerify service token authentication failed.',
          },
        };
      }

      if (response.status === 404) {
        const body: any = await response.json().catch(() => ({}));
        return {
          success: false,
          error: {
            code: 'GSTIN_NOT_FOUND',
            message: body?.message || body?.error || `GSTIN "${cleanGstin}" was not found on official records.`,
          },
          rawResponse: body,
        };
      }

      if (response.status === 502 || response.status === 503 || response.status === 504) {
        return {
          success: false,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: `BizVerify GST verification service returned HTTP ${response.status}. GST portal or upstream service is currently unavailable.`,
          },
        };
      }

      if (!response.ok) {
        if (response.status >= 500) {
          return {
            success: false,
            error: {
              code: 'SERVICE_UNAVAILABLE',
              message: `BizVerify GST service returned HTTP ${response.status}. Service is currently unavailable.`,
            },
          };
        }
        return {
          success: false,
          error: {
            code: 'PROVIDER_ERROR',
            message: `BizVerify returned unexpected status code ${response.status}.`,
          },
        };
      }

      const body: any = await response.json().catch(() => null);

      if (!body || typeof body !== 'object') {
        return {
          success: false,
          error: {
            code: 'PROVIDER_ERROR',
            message: 'BizVerify returned empty or malformed GST verification response.',
          },
          rawResponse: body,
        };
      }

      if (body.success === false) {
        const errMsg = body.message || body.error || 'GST verification failed at provider.';
        return {
          success: false,
          error: {
            code: 'PROVIDER_ERROR',
            message: errMsg,
          },
          rawResponse: body,
        };
      }

      const rawGstData = body.gst || body.data?.gst || body.data || body;
      const masterRecord = this.normalizeMasterRecord(cleanGstin, rawGstData);

      return {
        success: true,
        data: masterRecord,
        rawResponse: body,
      };
    } catch (err: any) {
      clearTimeout(timer);

      if (err?.name === 'AbortError' || err?.message?.includes('aborted')) {
        return {
          success: false,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: `BizVerify GST verification request timed out after ${this.timeoutMs}ms. Service is currently unavailable.`,
          },
        };
      }

      return {
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: `Unable to connect to BizVerify GST verification service: ${err?.message || 'Network error'}`,
        },
      };
    }
  }

  private normalizeMasterRecord(gstin: string, raw: any): GstMasterRecord {
    const legalName = (
      raw.legal_name ||
      raw.legalName ||
      raw.legal_name_of_business ||
      raw.trade_name ||
      raw.tradeName ||
      ''
    ).toUpperCase().trim();

    const tradeName = raw.trade_name || raw.tradeName || null;
    const registrationDate = raw.registration_date || raw.registrationDate || raw.date_of_registration || null;
    const status = (raw.status || raw.gstin_status || 'Active').trim();
    const taxpayerType = raw.taxpayer_type || raw.taxpayerType || null;
    const constitution = raw.constitution || raw.constitution_of_business || null;
    const state = raw.state || raw.state_name || null;
    const stateCode = raw.state_code || raw.stateCode || (gstin.length >= 2 ? gstin.slice(0, 2) : null);
    const panEmbedded = raw.pan_embedded || raw.panEmbedded || (gstin.length >= 12 ? gstin.slice(2, 12) : null);

    let principalPlaceOfBusiness: GstMasterRecord['principalPlaceOfBusiness'] = null;
    if (raw.principal_place_of_business || raw.principalPlaceOfBusiness || raw.address) {
      const ppob = raw.principal_place_of_business || raw.principalPlaceOfBusiness || {};
      const addrStr = typeof ppob === 'string' ? ppob : (ppob.address || raw.address || '');
      principalPlaceOfBusiness = {
        address: addrStr,
        city: ppob.city || raw.city || null,
        state: ppob.state || raw.state || null,
        pincode: ppob.pincode || ppob.pin_code || raw.pincode || null,
      };
    }

    const natureOfBusiness: string[] = Array.isArray(raw.nature_of_business)
      ? raw.nature_of_business
      : Array.isArray(raw.natureOfBusiness)
      ? raw.natureOfBusiness
      : [];

    let jurisdiction: GstMasterRecord['jurisdiction'] = null;
    if (raw.jurisdiction && typeof raw.jurisdiction === 'object') {
      jurisdiction = {
        stateJurisdiction: raw.jurisdiction.state_jurisdiction || raw.jurisdiction.stateJurisdiction || null,
        centralJurisdiction: raw.jurisdiction.central_jurisdiction || raw.jurisdiction.centralJurisdiction || null,
      };
    }

    const einvoiceStatus = raw.einvoice_status || raw.einvoiceStatus || null;

    return {
      gstin,
      legalName,
      tradeName: tradeName ? String(tradeName).trim() : null,
      registrationDate: registrationDate ? String(registrationDate).trim() : null,
      status: status || 'Active',
      taxpayerType: taxpayerType ? String(taxpayerType).trim() : null,
      constitution: constitution ? String(constitution).trim() : null,
      state: state ? String(state).trim() : null,
      stateCode: stateCode ? String(stateCode).trim() : null,
      panEmbedded: panEmbedded ? String(panEmbedded).trim() : null,
      principalPlaceOfBusiness,
      natureOfBusiness,
      jurisdiction,
      einvoiceStatus: einvoiceStatus ? String(einvoiceStatus).trim() : null,
    };
  }
}
