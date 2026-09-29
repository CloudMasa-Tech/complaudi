// src/lib/verifications/providers/udyam/index.ts
import { BizVerifyUdyamProvider, type BizVerifyUdyamOptions } from './bizVerify';
import type { UdyamVerificationProvider } from '../../types';

export * from './bizVerify';

let defaultUdyamProvider: UdyamVerificationProvider | null = null;

export function getBizVerifyUdyamProvider(options?: BizVerifyUdyamOptions): UdyamVerificationProvider {
  if (options || !defaultUdyamProvider) {
    const provider = new BizVerifyUdyamProvider(options);
    if (!options) defaultUdyamProvider = provider;
    return provider;
  }
  return defaultUdyamProvider;
}
