// supabase/functions/_shared/verifications/providers/gst/index.ts
import { BizVerifyGstProvider, type BizVerifyGstOptions } from './bizVerify.ts';
import type { GstVerificationProvider } from '../../types.ts';

export * from './bizVerify.ts';

let defaultGstProvider: GstVerificationProvider | null = null;

export function getBizVerifyGstProvider(options?: BizVerifyGstOptions): GstVerificationProvider {
  if (options || !defaultGstProvider) {
    const provider = new BizVerifyGstProvider(options);
    if (!options) defaultGstProvider = provider;
    return provider;
  }
  return defaultGstProvider;
}
