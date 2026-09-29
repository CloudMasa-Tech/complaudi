// supabase/functions/_shared/verifications/providers/udyam/index.ts
import { BizVerifyUdyamProvider } from './bizVerify.ts';
import type { UdyamVerificationProvider } from '../../types.ts';

let defaultUdyamProvider: UdyamVerificationProvider | null = null;

export function getBizVerifyUdyamProvider(): UdyamVerificationProvider {
  if (!defaultUdyamProvider) {
    defaultUdyamProvider = new BizVerifyUdyamProvider();
  }
  return defaultUdyamProvider;
}

export * from './bizVerify.ts';
