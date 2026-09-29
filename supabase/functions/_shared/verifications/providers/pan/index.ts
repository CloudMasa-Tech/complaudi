// supabase/functions/_shared/verifications/providers/pan/index.ts
import { BizVerifyPanProvider, type BizVerifyPanOptions } from './bizVerify.ts';
import type { PanVerificationProvider } from '../../types.ts';

let defaultPanProvider: PanVerificationProvider | null = null;

export function getBizVerifyPanProvider(options?: BizVerifyPanOptions): PanVerificationProvider {
  if (options) {
    return new BizVerifyPanProvider(options);
  }
  if (!defaultPanProvider) {
    defaultPanProvider = new BizVerifyPanProvider();
  }
  return defaultPanProvider;
}

export { BizVerifyPanProvider, type BizVerifyPanOptions };
