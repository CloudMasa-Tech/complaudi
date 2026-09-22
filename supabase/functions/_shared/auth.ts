// supabase/functions/_shared/auth.ts
// @ts-ignore
import { verify } from 'https://deno.land/x/djwt@v3.0.2/mod.ts';
import { env } from './env.ts';
import { ForbiddenError, UnauthorizedError } from './errors.ts';
import { getSupabaseAdminClient } from './database.ts';

export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'CA' | 'COMPANY_OWNER' | 'VIEWER';

export interface AuthContext {
  userId: string;
  organizationId: string;
  email: string;
  role: UserRole;
  name: string;
}

export const ROLE_HIERARCHY: Record<UserRole, number> = {
  SUPER_ADMIN: 100,
  ADMIN: 80,
  CA: 60,
  COMPANY_OWNER: 40,
  VIEWER: 20,
};

export function isSuperAdmin(role: UserRole): boolean {
  return role === 'SUPER_ADMIN';
}

export function seesEveryCompany(role: UserRole): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

const CAPABILITIES: Record<UserRole, string[]> = {
  SUPER_ADMIN: ['*'],
  ADMIN: [
    'company.create',
    'company.edit',
    'company.archive',
    'company.view',
    'compliance.view',
    'compliance.update',
    'tasks.view',
    'tasks.manage',
    'documents.view',
    'documents.upload',
    'documents.delete',
    'users.manage',
    'audit.read',
    'rules.read',
    'billing.manage',
  ],
  CA: [
    'company.view',
    'company.edit',
    'compliance.view',
    'compliance.update',
    'tasks.view',
    'tasks.manage',
    'documents.view',
    'documents.upload',
  ],
  COMPANY_OWNER: [
    'company.view',
    'company.edit',
    'compliance.view',
    'compliance.update',
    'tasks.view',
    'tasks.manage',
    'documents.view',
    'documents.upload',
    'billing.manage',
  ],
  VIEWER: [
    'company.view',
    'compliance.view',
    'tasks.view',
    'documents.view',
  ],
};

export function hasCapability(role: UserRole, capability: string): boolean {
  const granted = CAPABILITIES[role] || [];
  return granted.includes('*') || granted.includes(capability);
}

export function requireCapability(ctx: AuthContext, capability: string): void {
  if (!hasCapability(ctx.role, capability)) {
    throw new ForbiddenError(`Your role (${ctx.role}) lacks capability '${capability}'`);
  }
}

export async function getAuthContext(req: Request): Promise<AuthContext> {
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or invalid Authorization header');
  }

  const token = authHeader.slice(7).trim();
  const supabase = getSupabaseAdminClient();

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (user && !error) {
      const { data: profile } = await supabase
        .from('users')
        .select('id, organizationId, email, role, name, isActive')
        .eq('id', user.id)
        .single();

      if (profile && profile.isActive) {
        return {
          userId: profile.id,
          organizationId: profile.organizationId,
          email: profile.email,
          role: profile.role as UserRole,
          name: profile.name,
        };
      }
    }
  } catch (_e) {
    // Fallback to custom JWT verification if token is custom app JWT
  }

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(env.JWT_ACCESS_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const payload = await verify(token, key) as Record<string, unknown>;

    if (payload && payload.sub && (payload.orgId || payload.org)) {
      const userId = String(payload.sub);
      const { data: profile } = await supabase
        .from('users')
        .select('id, organizationId, email, role, name, isActive')
        .eq('id', userId)
        .single();

      if (profile && profile.isActive) {
        return {
          userId: profile.id,
          organizationId: profile.organizationId,
          email: profile.email,
          role: profile.role as UserRole,
          name: profile.name,
        };
      }
    }
  } catch (_err) {
    throw new UnauthorizedError('Invalid access token or expired session');
  }

  throw new UnauthorizedError('User account not found or inactive');
}

export async function assertCan(
  ctx: AuthContext,
  companyId: string,
  capability: string,
): Promise<void> {
  const supabase = getSupabaseAdminClient();

  const { data: company, error } = await supabase
    .from('companies')
    .select('id, organizationId')
    .eq('id', companyId)
    .single();

  if (error || !company) {
    throw new ForbiddenError('Company not found');
  }

  // Super Admin and Admin can access any company
  if (seesEveryCompany(ctx.role)) {
    return;
  }

  // Check explicit grant in company_memberships
  const { data: membership } = await supabase
    .from('company_memberships')
    .select('role')
    .eq('userId', ctx.userId)
    .eq('companyId', companyId)
    .maybeSingle();

  if (membership) {
    const effectiveRole = membership.role as UserRole;
    if (hasCapability(effectiveRole, capability)) {
      return;
    }
    throw new ForbiddenError(`Your capability on this company (${effectiveRole}) lacks '${capability}'`);
  }

  // Check if company organization matches user's organization
  if (company.organizationId && ctx.organizationId && company.organizationId === ctx.organizationId) {
    if (hasCapability(ctx.role, capability)) {
      return;
    }
    throw new ForbiddenError(`Your role (${ctx.role}) lacks capability '${capability}'`);
  }

  throw new ForbiddenError('Access to this company has not been granted');
}
