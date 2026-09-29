// supabase/functions/_shared/verifications/index.ts
import { getBizVerifyProvider } from './providers/mca/index.ts';
import { getBizVerifyGstProvider } from './providers/gst/index.ts';
import { getBizVerifyPanProvider } from './providers/pan/index.ts';
import { getBizVerifyUdyamProvider } from './providers/udyam/index.ts';
import type { CompanyVerificationProvider, GstVerificationProvider, PanVerificationProvider, UdyamVerificationProvider } from './types.ts';

export * from './types.ts';
export * from './providers/mca/index.ts';
export * from './providers/gst/index.ts';
export * from './providers/pan/index.ts';
export * from './providers/udyam/index.ts';

/**
 * Returns the active Company Verification Provider (BizVerify).
 */
export function getCompanyVerificationProvider(): CompanyVerificationProvider {
  return getBizVerifyProvider();
}

/**
 * Returns the active GST Verification Provider (BizVerify).
 */
export function getGstVerificationProvider(): GstVerificationProvider {
  return getBizVerifyGstProvider();
}

/**
 * Returns the active PAN Verification Provider (BizVerify).
 */
export function getPanVerificationProvider(): PanVerificationProvider {
  return getBizVerifyPanProvider();
}

/**
 * Returns the active Udyam Verification Provider (BizVerify).
 */
export function getUdyamVerificationProvider(): UdyamVerificationProvider {
  return getBizVerifyUdyamProvider();
}


