// supabase/functions/_shared/verifications/index.ts
import { getBizVerifyProvider } from './providers/mca/index.ts';
import type { CompanyVerificationProvider } from './types.ts';

export * from './types.ts';
export * from './providers/mca/index.ts';

/**
 * Returns the active Company Verification Provider (BizVerify).
 */
export function getCompanyVerificationProvider(): CompanyVerificationProvider {
  return getBizVerifyProvider();
}
