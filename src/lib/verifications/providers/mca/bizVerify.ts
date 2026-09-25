// src/lib/verifications/providers/mca/bizVerify.ts
import { env } from '../../../../config/env';
import { CIN_REGEX, LLPIN_REGEX } from '../../../india';
import type { CompanyMasterRecord } from '../../../companyValidation';
import type {
  CompanyVerificationProvider,
  CompanyVerificationResult,
} from '../../types';

export interface BizVerifyOptions {
  baseUrl?: string;
  serviceToken?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export class BizVerifyProvider implements CompanyVerificationProvider {
  private baseUrl: string;
  private serviceToken: string;
  private timeoutMs: number;
  private fetchFn: typeof fetch;

  constructor(options: BizVerifyOptions = {}) {
    this.baseUrl = (options.baseUrl || env.BIZVERIFY_BASE_URL || 'http://localhost:8000').replace(/\/+$/, '');
    this.serviceToken = options.serviceToken || env.BIZVERIFY_SERVICE_TOKEN || 'dev-bizverify-service-token';
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.fetchFn = options.fetchFn || fetch.bind(globalThis);
  }

  async verifyCompany(cin: string): Promise<CompanyVerificationResult> {
    const rawCin = (cin || '').toUpperCase().trim();

    const isStandardCin = CIN_REGEX.test(rawCin);
    const isLlpin = LLPIN_REGEX.test(rawCin) || /^[A-Z]{3}[0-9]{4}$/i.test(rawCin);

    if (!isStandardCin && !isLlpin) {
      return {
        success: false,
        error: {
          code: 'INVALID_CIN',
          message: `Invalid CIN format. CIN must be 21 alphanumeric characters (e.g. U72900TN2020PTC138472) or 7-character LLPIN.`,
        },
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const targetUrl = `${this.baseUrl}/api/company/${encodeURIComponent(rawCin)}`;

      const response = await this.fetchFn(targetUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.serviceToken}`,
          'x-service-token': this.serviceToken,
        },
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.status === 404) {
        return {
          success: false,
          error: {
            code: 'COMPANY_NOT_FOUND',
            message: `Company with CIN "${rawCin}" was not found in official MCA records via BizVerify.`,
          },
        };
      }

      if (response.status === 400) {
        return {
          success: false,
          error: {
            code: 'INVALID_CIN',
            message: `BizVerify reported invalid CIN format for "${rawCin}".`,
          },
        };
      }

      if (!response.ok) {
        if (response.status >= 500) {
          return {
            success: false,
            error: {
              code: 'SERVICE_UNAVAILABLE',
              message: `BizVerify MCA verification service returned HTTP ${response.status}. Verification is currently unavailable.`,
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

      const body: any = await response.json();
      const data = body?.data || body;

      if (!data || typeof data !== 'object') {
        return {
          success: false,
          error: {
            code: 'PROVIDER_ERROR',
            message: 'BizVerify returned empty or malformed company payload.',
          },
        };
      }

      const masterRecord: CompanyMasterRecord = this.normalizeMasterRecord(rawCin, data);

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
            message: `BizVerify MCA verification request timed out after ${this.timeoutMs}ms. Service is currently unavailable.`,
          },
        };
      }

      return {
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: `Unable to connect to BizVerify MCA verification service: ${err?.message || 'Network error'}`,
        },
      };
    }
  }

  private normalizeMasterRecord(cin: string, raw: any): CompanyMasterRecord {
    const comp = raw.company || raw.data?.company || raw;
    const legalName = (comp.name || comp.legalName || comp.companyName || raw.legalName || raw.companyName || raw.name || '').toUpperCase().trim();
    const status = (comp.status || comp.companyStatus || raw.companyStatus || raw.status || 'ACTIVE').toUpperCase().trim();
    const entityType = comp.entityType || raw.entityType || (comp.type === 'Public' ? 'PUBLIC_LIMITED' : comp.type === 'Private' ? 'PRIVATE_LIMITED' : undefined);
    const stateCode = (comp.stateCode || comp.state || raw.stateCode || raw.state || '').toUpperCase().trim() || undefined;
    const roc = comp.roc || raw.roc || undefined;

    let incorporationDate = comp.date_of_incorporation || comp.incorporationDate || comp.dateOfIncorporation || raw.incorporationDate || raw.dateOfIncorporation || undefined;
    let incorporationYear: number | undefined = undefined;

    if (incorporationDate && typeof incorporationDate === 'string') {
      const parsedDate = new Date(incorporationDate);
      if (!Number.isNaN(parsedDate.getTime())) {
        incorporationDate = parsedDate.toISOString().split('T')[0];
        incorporationYear = parsedDate.getFullYear();
      }
    }

    if (!incorporationYear && (comp.incorporationYear || raw.incorporationYear)) {
      incorporationYear = Number(comp.incorporationYear || raw.incorporationYear);
    }

    return {
      cin,
      legalName: legalName || undefined,
      status: status || 'ACTIVE',
      entityType,
      incorporationDate,
      incorporationYear,
      stateCode,
      roc,
    };
  }
}
