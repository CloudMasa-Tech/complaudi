// supabase/functions/_shared/verifications/types.ts
import type { CompanyMasterRecord } from '../companyValidation.ts';

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
  /**
   * Performs an authoritative government / external provider verification of MCA Company Master Data against CIN.
   */
  verifyCompany(cin: string): Promise<CompanyVerificationResult>;
}

// Interfaces prepared for future expansion (GST, PAN, Udyam, Director)
export interface GstVerificationResult {
  success: boolean;
  gstin?: string;
  legalName?: string;
  tradeName?: string;
  status?: string;
  error?: { code: string; message: string };
}

export interface PanVerificationResult {
  success: boolean;
  pan?: string;
  name?: string;
  status?: string;
  error?: { code: string; message: string };
}

export interface UdyamVerificationResult {
  success: boolean;
  udyamNumber?: string;
  name?: string;
  category?: string;
  error?: { code: string; message: string };
}

export interface DirectorVerificationResult {
  success: boolean;
  din?: string;
  name?: string;
  designation?: string;
  error?: { code: string; message: string };
}
