// supabase/functions/_shared/verifications/providers/mca/index.ts
import { BizVerifyProvider, type BizVerifyOptions } from './bizVerify.ts';

let defaultBizVerifyProvider: BizVerifyProvider | null = null;

export function getBizVerifyProvider(options?: BizVerifyOptions): BizVerifyProvider {
  if (options) {
    return new BizVerifyProvider(options);
  }
  if (!defaultBizVerifyProvider) {
    defaultBizVerifyProvider = new BizVerifyProvider();
  }
  return defaultBizVerifyProvider;
}

export { BizVerifyProvider };
