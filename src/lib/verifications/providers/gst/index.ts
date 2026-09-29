// src/lib/verifications/providers/gst/index.ts
import { BizVerifyGstProvider, type BizVerifyGstOptions } from './bizVerify';
import type { GstVerificationProvider } from '../../types';

export * from './bizVerify';

let defaultGstProvider: GstVerificationProvider | null = null;

export function getBizVerifyGstProvider(options?: BizVerifyGstOptions): GstVerificationProvider {
  if (options || !defaultGstProvider) {
    const provider = new BizVerifyGstProvider(options);
    if (!options) defaultGstProvider = provider;
    return provider;
  }
  return defaultGstProvider;
}
