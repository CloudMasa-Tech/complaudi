// src/lib/verifications/providers/udyam/bizVerify.ts
import { env } from '../../../../config/env';
import { UDYAM_REGEX } from '../../../india';
import type {
  UdyamVerificationProvider,
  UdyamSessionResult,
  UdyamVerificationResult,
  UdyamMasterRecord,
  UdyamVerificationErrorCode,
} from '../../types';

export interface BizVerifyUdyamOptions {
  baseUrl?: string;
  serviceToken?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export class BizVerifyUdyamProvider implements UdyamVerificationProvider {
  private baseUrl: string;
  private serviceToken: string;
  private timeoutMs: number;
  private fetchFn: typeof fetch;

  constructor(options: BizVerifyUdyamOptions = {}) {
    this.baseUrl = (options.baseUrl || env.BIZVERIFY_BASE_URL || 'https://bizverify.regibiz.in').replace(/\/+$/, '');
    this.serviceToken = options.serviceToken || env.BIZVERIFY_SERVICE_TOKEN || 'dev-bizverify-service-token';
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.fetchFn = options.fetchFn || fetch.bind(globalThis);
  }

  async createSession(udyamNumber: string): Promise<UdyamSessionResult> {
    const rawNumber = (udyamNumber || '').toUpperCase().trim();

    if (!UDYAM_REGEX.test(rawNumber)) {
      return {
        success: false,
        error: {
          code: 'INVALID_UDYAM',
          message: `Invalid Udyam number format "${rawNumber}". Expected UDYAM-[2-char state]-[2-digit]-[7-digit].`,
        },
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const targetUrl = `${this.baseUrl}/api/udyam/session`;

      const response = await this.fetchFn(targetUrl, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.serviceToken}`,
          'x-service-token': this.serviceToken,
        },
        body: JSON.stringify({ udyam_number: rawNumber }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.status === 400) {
        const body: any = await response.json().catch(() => ({}));
        return {
          success: false,
          error: {
            code: 'INVALID_UDYAM',
            message: body?.error || body?.message || `Invalid Udyam number format "${rawNumber}".`,
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
            code: 'UDYAM_NOT_FOUND',
            message: body?.error || body?.message || 'Udyam registration number was not found.',
          },
          rawResponse: body,
        };
      }

      if (response.status === 502 || response.status === 503 || response.status === 504) {
        return {
          success: false,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Udyam verification service is temporarily unavailable. Please try again later.',
          },
        };
      }

      if (!response.ok) {
        if (response.status >= 500) {
          return {
            success: false,
            error: {
              code: 'SERVICE_UNAVAILABLE',
              message: 'Udyam verification service is temporarily unavailable. Please try again later.',
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
            message: body?.error || body?.message || 'BizVerify returned empty or malformed Udyam session response.',
          },
          rawResponse: body,
        };
      }

      return {
        success: true,
        sessionId: body.sessionId,
        udyamNumber: body.udyam_number || rawNumber,
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
            message: 'Udyam verification service is temporarily unavailable. Please try again later.',
          },
        };
      }

      return {
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Udyam verification service is temporarily unavailable. Please try again later.',
        },
      };
    }
  }

  async verifySession(params: {
    sessionId: string;
    udyamNumber: string;
    captcha: string;
  }): Promise<UdyamVerificationResult> {
    const cleanSessionId = (params.sessionId || '').trim();
    const cleanNumber = (params.udyamNumber || '').toUpperCase().trim();
    const cleanCaptcha = (params.captcha || '').trim();

    if (!cleanSessionId) {
      return {
        success: false,
        error: {
          code: 'SESSION_EXPIRED',
          message: 'Verification session expired. Please get a new CAPTCHA.',
        },
      };
    }

    if (!cleanCaptcha) {
      return {
        success: false,
        error: {
          code: 'INVALID_CAPTCHA',
          message: 'Invalid CAPTCHA. Please try again.',
        },
      };
    }

    if (!UDYAM_REGEX.test(cleanNumber)) {
      return {
        success: false,
        error: {
          code: 'INVALID_UDYAM',
          message: `Invalid Udyam number format "${cleanNumber}".`,
        },
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const targetUrl = `${this.baseUrl}/api/udyam/verify`;

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
          udyam_number: cleanNumber,
          captcha: cleanCaptcha,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.status === 400) {
        const body: any = await response.json().catch(() => ({}));
        const rawCode = body?.code || '';
        let code: UdyamVerificationErrorCode = 'INVALID_CAPTCHA';
        let message = 'Invalid CAPTCHA. Please try again.';

        if (rawCode === 'SESSION_EXPIRED' || (body?.error && String(body.error).toLowerCase().includes('expire'))) {
          code = 'SESSION_EXPIRED';
          message = 'Verification session expired. Please get a new CAPTCHA.';
        } else if (rawCode === 'INVALID_INPUT') {
          code = 'INVALID_UDYAM';
          message = body?.error || 'Invalid Udyam number format.';
        }

        return {
          success: false,
          error: { code, message },
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
            code: 'UDYAM_NOT_FOUND',
            message: 'Udyam registration number was not found.',
          },
          rawResponse: body,
        };
      }

      if (response.status === 502 || response.status === 503 || response.status === 504) {
        return {
          success: false,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Udyam verification service is temporarily unavailable. Please try again later.',
          },
        };
      }

      if (!response.ok) {
        if (response.status >= 500) {
          return {
            success: false,
            error: {
              code: 'SERVICE_UNAVAILABLE',
              message: 'Udyam verification service is temporarily unavailable. Please try again later.',
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
            message: 'BizVerify returned empty or malformed Udyam verification response.',
          },
          rawResponse: body,
        };
      }

      if (body.success === false) {
        const rawCode = body.code || '';
        if (rawCode === 'INVALID_CAPTCHA') {
          return { success: false, error: { code: 'INVALID_CAPTCHA', message: 'Invalid CAPTCHA. Please try again.' }, rawResponse: body };
        }
        if (rawCode === 'SESSION_EXPIRED') {
          return { success: false, error: { code: 'SESSION_EXPIRED', message: 'Verification session expired. Please get a new CAPTCHA.' }, rawResponse: body };
        }
        if (rawCode === 'NOT_FOUND') {
          return { success: false, error: { code: 'UDYAM_NOT_FOUND', message: 'Udyam registration number was not found.' }, rawResponse: body };
        }
        if (rawCode === 'DATA_SOURCE_ERROR') {
          return { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Udyam verification service is temporarily unavailable. Please try again later.' }, rawResponse: body };
        }
        return {
          success: false,
          error: { code: 'PROVIDER_ERROR', message: body.error || 'Udyam verification failed at provider.' },
          rawResponse: body,
        };
      }

      const rawUdyamData = body.registration || body.data?.registration || body.data || body;
      const masterRecord = this.normalizeMasterRecord(cleanNumber, rawUdyamData);

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
            message: 'Udyam verification service is temporarily unavailable. Please try again later.',
          },
        };
      }

      return {
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Udyam verification service is temporarily unavailable. Please try again later.',
        },
      };
    }
  }

  private normalizeMasterRecord(udyamNumber: string, raw: any): UdyamMasterRecord {
    return {
      udyamNumber: raw.udyam_number || raw.udyamNumber || udyamNumber,
      enterpriseName: (raw.enterprise_name || raw.enterpriseName || raw.enterprise_name_of_unit || '').toUpperCase().trim(),
      ownerName: (raw.owner_name || raw.ownerName || '').trim(),
      category: raw.category || 'Micro',
      activityType: raw.activity_type || raw.activityType || 'Service',
      nicCode: raw.nic_code || raw.nicCode || '',
      nicDescription: raw.nic_description || raw.nicDescription || '',
      dateOfRegistration: raw.date_of_registration || raw.dateOfRegistration || '',
      dateOfCommencement: raw.date_of_commencement || raw.dateOfCommencement || '',
      pan: raw.pan || null,
      gstin: raw.gstin || null,
      socialCategory: raw.social_category || raw.socialCategory || '',
      district: raw.district || '',
      state: raw.state || '',
      status: raw.status || 'Active',
      employees: {
        male: raw.employees?.male ?? 0,
        female: raw.employees?.female ?? 0,
        total: raw.employees?.total ?? 0,
      },
      investmentInPlantMachineryInr: raw.investment_in_plant_machinery_inr ?? raw.investmentInPlantMachineryInr ?? null,
      turnoverInr: raw.turnover_inr ?? raw.turnoverInr ?? null,
      source: raw.source || 'Udyam Portal',
      fetchedAt: raw.fetched_at || raw.fetchedAt || new Date().toISOString(),
    };
  }
}
