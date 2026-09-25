// src/lib/verifications/providers/mca/index.ts
import { BizVerifyProvider, type BizVerifyOptions } from './bizVerify';

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
