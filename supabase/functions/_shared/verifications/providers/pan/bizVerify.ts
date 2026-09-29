// supabase/functions/_shared/verifications/providers/pan/bizVerify.ts
import { env } from '../../../env.ts';
import { PAN_REGEX } from '../../../india.ts';
import type {
  PanVerificationProvider,
  PanVerificationResult,
  PanMasterRecord,
  PanVerificationErrorCode,
} from '../../types.ts';

export interface BizVerifyPanOptions {
  baseUrl?: string;
  serviceToken?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export class BizVerifyPanProvider implements PanVerificationProvider {
  private baseUrl: string;
  private serviceToken: string;
  private timeoutMs: number;
  private fetchFn: typeof fetch;

  constructor(options: BizVerifyPanOptions = {}) {
    this.baseUrl = (options.baseUrl || env.BIZVERIFY_BASE_URL || 'https://bizverify.regibiz.in').replace(/\/+$/, '');
    this.serviceToken = options.serviceToken || env.BIZVERIFY_SERVICE_TOKEN || 'dev-bizverify-service-token';
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.fetchFn = options.fetchFn || fetch.bind(globalThis);
  }

  /**
   * Performs PAN verification with format check & GST cross-referencing via BizVerify.
   */
  async verifyPan(pan: string): Promise<PanVerificationResult> {
    const rawPan = (pan || '').toUpperCase().trim();

    if (!PAN_REGEX.test(rawPan)) {
      return {
        success: false,
        error: {
          code: 'INVALID_PAN',
          message: `Invalid PAN format "${rawPan}". PAN must be 10 characters (e.g. AAACT1234A).`,
        },
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const targetUrl = `${this.baseUrl}/api/pan/verify`;

      const response = await this.fetchFn(targetUrl, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.serviceToken}`,
          'x-service-token': this.serviceToken,
        },
        body: JSON.stringify({
          pan: rawPan,
          cross_reference_gst: true,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.status === 400) {
        const body: any = await response.json().catch(() => ({}));
        return {
          success: false,
          error: {
            code: 'INVALID_PAN',
            message: body?.message || body?.error || `Invalid PAN parameter for "${rawPan}".`,
          },
          rawResponse: body,
        };
      }

      if (response.status === 401 || response.status === 403) {
        const body: any = await response.json().catch(() => ({}));
        return {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Unauthorized call to BizVerify service. Check BIZVERIFY_SERVICE_TOKEN.',
          },
          rawResponse: body,
        };
      }

      if (response.status === 404) {
        const body: any = await response.json().catch(() => ({}));
        return {
          success: false,
          error: {
            code: 'PAN_NOT_FOUND',
            message: body?.message || body?.error || `No record found for PAN "${rawPan}".`,
          },
          rawResponse: body,
        };
      }

      if (response.status >= 500) {
        const body: any = await response.json().catch(() => ({}));
        return {
          success: false,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: `BizVerify service returned server error HTTP ${response.status}.`,
          },
          rawResponse: body,
        };
      }

      if (!response.ok) {
        const body: any = await response.json().catch(() => ({}));
        return {
          success: false,
          error: {
            code: 'PROVIDER_ERROR',
            message: `BizVerify API request failed with HTTP status ${response.status}.`,
          },
          rawResponse: body,
        };
      }

      const body: any = await response.json();

      if (!body || body.success === false) {
        return {
          success: false,
          error: {
            code: (body?.code as PanVerificationErrorCode) || 'PROVIDER_ERROR',
            message: body?.error || body?.message || 'PAN verification failed at provider.',
          },
          rawResponse: body,
        };
      }

      const gstObj = body.gst
        ? {
            legalName: body.gst.legal_name || body.gst.legalName || '',
            tradeName: body.gst.trade_name || body.gst.tradeName || null,
            status: body.gst.status || 'Active',
            constitution: body.gst.constitution || null,
            registrationDate: body.gst.registration_date || body.gst.registrationDate || null,
          }
        : null;

      const data: PanMasterRecord = {
        pan: body.pan || rawPan,
        verified: Boolean(body.verified ?? true),
        panStatus: body.panStatus || body.pan_status || 'ACTIVE',
        formatValid: Boolean(body.format_valid ?? true),
        entityTypeCode: body.entity_type_code || rawPan[3] || 'C',
        entityType: body.entity_type || 'Company',
        verificationLevel: body.verificationLevel || body.verification_level || (gstObj ? 'GST_CROSS_REFERENCE' : 'LOCAL_VALIDATION'),
        verificationSource: body.verificationSource || body.verification_source || body.source || (gstObj ? 'GST_PORTAL' : 'LOCAL'),
        verificationMethod: body.verificationMethod || body.verification_method || (gstObj ? 'GST_CROSS_REFERENCE' : 'LOCAL_VALIDATION'),
        linkedGstins: Array.isArray(body.linked_gstins)
          ? body.linked_gstins
          : Array.isArray(body.linkedGstins)
            ? body.linkedGstins
            : [],
        gst: gstObj,
        note: body.note || null,
        source: body.source || null,
        fetchedAt: body.fetched_at || body.fetchedAt || new Date().toISOString(),
      };

      return {
        success: true,
        data,
        rawResponse: body,
      };
    } catch (err: any) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        return {
          success: false,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: `BizVerify API call timed out after ${this.timeoutMs}ms.`,
          },
        };
      }
      return {
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: err?.message || 'Network failure communicating with BizVerify service.',
        },
      };
    }
  }
}
