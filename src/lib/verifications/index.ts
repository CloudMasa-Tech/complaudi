// src/lib/verifications/index.ts
import { getBizVerifyProvider } from './providers/mca';
import { getBizVerifyGstProvider } from './providers/gst';
import { getBizVerifyPanProvider } from './providers/pan';
import { getBizVerifyUdyamProvider } from './providers/udyam';
import type { CompanyVerificationProvider, GstVerificationProvider, PanVerificationProvider, UdyamVerificationProvider } from './types';

export * from './types';
export * from './providers/mca';
export * from './providers/gst';
export * from './providers/pan';
export * from './providers/udyam';

export function getCompanyVerificationProvider(): CompanyVerificationProvider {
  return getBizVerifyProvider();
}

export function getGstVerificationProvider(): GstVerificationProvider {
  return getBizVerifyGstProvider();
}

export function getPanVerificationProvider(): PanVerificationProvider {
  return getBizVerifyPanProvider();
}

export function getUdyamVerificationProvider(): UdyamVerificationProvider {
  return getBizVerifyUdyamProvider();
}


