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

// Interfaces prepared for expansion (GST, PAN, Udyam, Director)

export type GstVerificationErrorCode =
  | 'INVALID_GSTIN'
  | 'INVALID_CAPTCHA'
  | 'SESSION_EXPIRED'
  | 'GSTIN_NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'SERVICE_UNAVAILABLE'
  | 'PROVIDER_ERROR';

export interface GstVerificationError {
  code: GstVerificationErrorCode;
  message: string;
  details?: unknown;
}

export interface GstSessionResult {
  success: boolean;
  sessionId?: string;
  gstin?: string;
  captchaImage?: string;
  expiresAt?: string;
  error?: GstVerificationError;
  rawResponse?: unknown;
}

export interface GstMasterRecord {
  gstin: string;
  legalName: string;
  tradeName: string | null;
  registrationDate: string | null;
  status: string;
  taxpayerType: string | null;
  constitution: string | null;
  state: string | null;
  stateCode: string | null;
  panEmbedded: string | null;
  principalPlaceOfBusiness: {
    address: string;
    city: string | null;
    state: string | null;
    pincode: string | null;
  } | null;
  natureOfBusiness: string[];
  jurisdiction: {
    stateJurisdiction: string | null;
    centralJurisdiction: string | null;
  } | null;
  einvoiceStatus: string | null;
}

export interface GstVerificationResult {
  success: boolean;
  data?: GstMasterRecord | null;
  error?: GstVerificationError;
  rawResponse?: unknown;
}

export interface GstVerificationProvider {
  /**
   * Initiates a GST verification session and retrieves a CAPTCHA image challenge.
   */
  createSession(gstin: string): Promise<GstSessionResult>;

  /**
   * Verifies the GSTIN with the human-entered CAPTCHA for a given session.
   */
  verifySession(params: {
    sessionId: string;
    gstin: string;
    captcha: string;
  }): Promise<GstVerificationResult>;
}

export type PanVerificationErrorCode =
  | 'INVALID_PAN'
  | 'PAN_NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'SERVICE_UNAVAILABLE'
  | 'PROVIDER_ERROR';

export interface PanVerificationError {
  code: PanVerificationErrorCode;
  message: string;
  details?: unknown;
}

export interface PanGstCrossReference {
  legalName: string;
  tradeName: string | null;
  status: string;
  constitution: string | null;
  registrationDate: string | null;
}

export interface PanMasterRecord {
  pan: string;
  verified: boolean;
  panStatus: string;
  formatValid: boolean;
  entityTypeCode: string;
  entityType: string;
  verificationLevel: string;
  verificationSource: string;
  verificationMethod: string;
  linkedGstins: string[];
  gst: PanGstCrossReference | null;
  note?: string | null;
  source?: string | null;
  fetchedAt?: string | null;
}

export interface PanVerificationResult {
  success: boolean;
  data?: PanMasterRecord | null;
  error?: PanVerificationError;
  rawResponse?: unknown;
}

export interface PanVerificationProvider {
  /**
   * Performs PAN verification via BizVerify (with format check & GST cross-referencing).
   */
  verifyPan(pan: string): Promise<PanVerificationResult>;
}

export type UdyamVerificationErrorCode =
  | 'INVALID_UDYAM'
  | 'INVALID_CAPTCHA'
  | 'SESSION_EXPIRED'
  | 'UDYAM_NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'SERVICE_UNAVAILABLE'
  | 'PROVIDER_ERROR';

export interface UdyamVerificationError {
  code: UdyamVerificationErrorCode;
  message: string;
  details?: unknown;
}

export interface UdyamSessionResult {
  success: boolean;
  sessionId?: string;
  udyamNumber?: string;
  captchaImage?: string;
  expiresAt?: string;
  error?: UdyamVerificationError;
  rawResponse?: unknown;
}

export interface UdyamMasterRecord {
  udyamNumber: string;
  enterpriseName: string;
  ownerName: string;
  category: "Micro" | "Small" | "Medium";
  activityType: "Manufacturing" | "Service";
  nicCode: string;
  nicDescription: string;
  dateOfRegistration: string;
  dateOfCommencement: string;
  pan: string | null;
  gstin: string | null;
  socialCategory: string;
  district: string;
  state: string;
  status: string;
  employees: {
    male: number;
    female: number;
    total: number;
  };
  investmentInPlantMachineryInr: number | null;
  turnoverInr: number | null;
  source?: string;
  fetchedAt?: string;
}

export interface UdyamVerificationResult {
  success: boolean;
  data?: UdyamMasterRecord | null;
  error?: UdyamVerificationError;
  rawResponse?: unknown;
}

export interface UdyamVerificationProvider {
  /**
   * Initiates a Udyam verification session and retrieves a CAPTCHA image challenge.
   */
  createSession(udyamNumber: string): Promise<UdyamSessionResult>;

  /**
   * Verifies the Udyam number with the human-entered CAPTCHA for a given session.
   */
  verifySession(params: {
    sessionId: string;
    udyamNumber: string;
    captcha: string;
  }): Promise<UdyamVerificationResult>;
}

export interface DirectorVerificationResult {
  success: boolean;
  din?: string;
  name?: string;
  designation?: string;
  error?: { code: string; message: string };
}

