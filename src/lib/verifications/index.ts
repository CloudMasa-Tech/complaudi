// src/lib/verifications/index.ts
import { getBizVerifyProvider } from './providers/mca';
import type { CompanyVerificationProvider } from './types';

export * from './types';
export * from './providers/mca';

export function getCompanyVerificationProvider(): CompanyVerificationProvider {
  return getBizVerifyProvider();
}
