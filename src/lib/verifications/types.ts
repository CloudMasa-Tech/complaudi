// src/lib/verifications/types.ts
import type { CompanyMasterRecord } from '../companyValidation';

export type CompanyVerificationErrorCode =
  | 'INVALID_CIN'
  | 'COMPANY_NOT_FOUND'
  | 'SERVICE_UNAVAILABLE'
  | 'PROVIDER_ERROR';

export interface CompanyVerificationError {
  code: CompanyVerificationErrorCode;
  message: string;
  details?: unknown;
}

export interface CompanyVerificationResult {
  success: boolean;
  data?: CompanyMasterRecord | null;
  error?: CompanyVerificationError;
  rawResponse?: unknown;
}

export interface CompanyVerificationProvider {
  verifyCompany(cin: string): Promise<CompanyVerificationResult>;
}
