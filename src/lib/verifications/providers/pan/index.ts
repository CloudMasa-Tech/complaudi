// src/lib/verifications/providers/pan/index.ts
import { BizVerifyPanProvider, type BizVerifyPanOptions } from './bizVerify';
import type { PanVerificationProvider } from '../../types';

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
