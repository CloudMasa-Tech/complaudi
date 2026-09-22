// supabase/functions/_shared/database.ts
// @ts-ignore
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { env } from './env.ts';

export function getSupabaseAdminClient(): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

export function getSupabaseUserClient(_authHeader: string): SupabaseClient {
  return getSupabaseAdminClient();
}

export const getAdminSupabase = getSupabaseAdminClient;

export function getClientSupabase(_req: Request): SupabaseClient {
  return getSupabaseAdminClient();
}

export function serialiseBigInt<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
}
