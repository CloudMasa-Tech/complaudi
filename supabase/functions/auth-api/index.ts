// supabase/functions/auth-api/index.ts
import { handleCors } from '../_shared/cors.ts';
import { getAuthContext, requireCapability } from '../_shared/auth.ts';
import { getSupabaseAdminClient } from '../_shared/database.ts';
import { AppError, BadRequestError } from '../_shared/errors.ts';
import { errorResponse, jsonResponse } from '../_shared/response.ts';
import { parseJsonBody } from '../_shared/validation.ts';
import { validateCompanyMasterData } from '../_shared/companyValidation.ts';
import { getCompanyVerificationProvider } from '../_shared/verifications/index.ts';
import { env } from '../_shared/env.ts';
// @ts-ignore
import { z } from 'https://esm.sh/zod@3.23.8';
// @ts-ignore
import bcrypt from 'https://esm.sh/bcryptjs@2.4.3';
// @ts-ignore
import { create, verify, getNumericDate } from 'https://deno.land/x/djwt@v3.0.2/mod.ts';

async function generateAccessToken(payload: { sub: string; org: string; email: string; name: string; role: string }) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.JWT_ACCESS_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return await create(
    { alg: 'HS256', typ: 'JWT' },
    {
      sub: payload.sub,
      org: payload.org,
      orgId: payload.org,
      email: payload.email,
      name: payload.name,
      role: payload.role,
      exp: getNumericDate(60 * 15),
      iat: getNumericDate(0),
    },
    key,
  );
}

async function generateRefreshToken(userId: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.JWT_REFRESH_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return await create(
    { alg: 'HS256', typ: 'JWT' },
    {
      sub: userId,
      jti: crypto.randomUUID(),
      exp: getNumericDate(60 * 60 * 24 * 7),
      iat: getNumericDate(0),
    },
    key,
  );
}

async function sha256Hex(text: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const url = new URL(req.url);
    const path = (url.pathname
      .replace(/^\/functions\/v1\/[^\/]+/, '')
      .replace(/^\/api\/v1\/[^\/]+/, '')
      .replace(/^\/[^\/]+-api/, '')
      .replace(/^\/auth/, '') || '/');

    const supabase = getSupabaseAdminClient();

    // ── Public Routes ────────────────────────────────────────────────────────

    // POST /register-trial
    if (req.method === 'POST' && (path === '/register-trial' || path === '/register-trial/')) {
      const schema = z.object({
        email: z.string().email().toLowerCase(),
        password: z.string().min(8).max(128),
        name: z.string().min(2).max(120),
        phone: z.string().min(10).max(15),
        companyName: z.string().min(2).max(160),
        entityType: z.enum(['PRIVATE_LIMITED', 'PUBLIC_LIMITED', 'OPC', 'LLP', 'PARTNERSHIP', 'PROPRIETORSHIP', 'SECTION_8', 'UNREGISTERED']),
        stateCode: z.string().min(2).max(10),
        cin: z.string().max(21).optional().nullable(),
        incorporationDate: z.string().optional().nullable(),
      });
      const body = await parseJsonBody(req, schema);

      // Server-side Company Master Data & Duplicate CIN Validation
      let existingCinsInDb: string[] = [];
      try {
        const { data: compRows } = await supabase.from('companies').select('cin');
        if (compRows) {
          existingCinsInDb = compRows.map((c: any) => c.cin).filter(Boolean) as string[];
        }
      } catch (err) {
        console.warn('Could not query database for duplicate CIN check:', err);
      }

      let masterRecord = null;
      if (body.cin && typeof body.cin === 'string' && body.cin.trim()) {
        const verifyRes = await getCompanyVerificationProvider().verifyCompany(body.cin.trim());

        if (!verifyRes.success) {
          if (verifyRes.error?.code === 'SERVICE_UNAVAILABLE') {
            throw new AppError(
              'MCA / BizVerify company verification service is currently unavailable. Registration cannot proceed without MCA verification.',
              503,
            );
          }
          if (verifyRes.error?.code === 'COMPANY_NOT_FOUND') {
            throw new BadRequestError(`Company with CIN "${body.cin}" was not found in official MCA records.`, [
              { field: 'cin', message: verifyRes.error.message },
            ]);
          }
          throw new BadRequestError(`Company verification failed: ${verifyRes.error?.message || 'Verification error'}`, [
            { field: 'cin', message: verifyRes.error?.message || 'Verification error' },
          ]);
        }

        masterRecord = verifyRes.data ?? null;
      }

      const valResult = validateCompanyMasterData({
        cin: body.cin,
        companyName: body.companyName,
        entityType: body.entityType,
        incorporationDate: body.incorporationDate,
        stateCode: body.stateCode,
        masterRecord,
        existingCinsInDb,
      });

      if (!valResult.valid) {
        throw new BadRequestError('Company validation failed', valResult.errors);
      }

      const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
        email: body.email,
        password: body.password,
        email_confirm: true,
        user_metadata: { name: body.name },
      });

      if (authError || !authUser.user) {
        throw new AppError(`Registration failed: ${authError?.message || 'User creation error'}`, 400);
      }

      let orgId = crypto.randomUUID();
      let companyId = crypto.randomUUID();
      let trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

      const { data: rpcResult, error: rpcError } = await supabase.rpc('fn_register_trial', {
        p_user_id: authUser.user.id,
        p_email: body.email,
        p_password_hash: 'SUPABASE_AUTH_MANAGED',
        p_name: body.name,
        p_phone: body.phone,
        p_company_name: body.companyName,
        p_entity_type: body.entityType,
        p_state_code: body.stateCode,
        p_cin: body.cin || null,
      });

      if (rpcError) {
        console.warn('fn_register_trial RPC failed, attempting direct table inserts:', rpcError.message);
        const slug = body.companyName.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Math.random().toString(36).substring(2, 8);
        try {
          const { error: orgErr } = await supabase.from('organizations').insert({
            id: orgId,
            name: body.companyName,
            slug,
            trialEndsAt,
            trialSignedUpAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          if (orgErr) throw orgErr;

          const { error: userErr } = await supabase.from('users').insert({
            id: authUser.user.id,
            organizationId: orgId,
            email: body.email,
            passwordHash: 'SUPABASE_AUTH_MANAGED',
            name: body.name,
            role: 'SUPER_ADMIN',
            phone: body.phone,
            isActive: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          if (userErr) throw userErr;

          const { error: compErr } = await supabase.from('companies').insert({
            id: companyId,
            organizationId: orgId,
            legalName: body.companyName,
            entityType: body.entityType,
            stateCode: body.stateCode,
            cin: body.cin || null,
            isActive: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          if (compErr) throw compErr;

          const { error: memErr } = await supabase.from('company_memberships').insert({
            id: crypto.randomUUID(),
            userId: authUser.user.id,
            companyId: companyId,
            role: 'SUPER_ADMIN',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          if (memErr) throw memErr;
        } catch (directErr: any) {
          await supabase.auth.admin.deleteUser(authUser.user.id);
          throw new AppError(`Trial registration failed: ${directErr.message || directErr}`, 400);
        }
      } else if (rpcResult) {
        orgId = rpcResult.organizationId;
        companyId = rpcResult.companyId;
        trialEndsAt = rpcResult.trialEndsAt;
      }

      const accessToken = await generateAccessToken({
        sub: authUser.user.id,
        org: orgId,
        email: body.email,
        name: body.name,
        role: 'SUPER_ADMIN',
      });
      const refreshToken = await generateRefreshToken(authUser.user.id);
      const tokenHash = await sha256Hex(refreshToken);

      await supabase.from('refresh_tokens').insert({
        id: crypto.randomUUID(),
        userId: authUser.user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString(),
      });

      return jsonResponse({
        accessToken,
        refreshToken,
        user: { id: authUser.user.id, email: body.email, name: body.name, organizationId: orgId, role: 'SUPER_ADMIN' },
        trialEndsAt,
      }, 201);
    }

    // POST /login
    if (req.method === 'POST' && (path === '/login' || path === '/login/')) {
      const schema = z.object({
        email: z.string().email().toLowerCase(),
        password: z.string().min(1),
      });
      const body = await parseJsonBody(req, schema);

      // 1. Search in public.users table (for bcrypt-hashed users created via Express/Prisma)
      const { data: dbUser } = await supabase
        .from('users')
        .select('*')
        .eq('email', body.email)
        .single();

      let authenticatedUser: any = null;

      if (dbUser && dbUser.isActive) {
        if (dbUser.passwordHash && dbUser.passwordHash !== 'SUPABASE_AUTH_MANAGED') {
          const isValid = bcrypt.compareSync(body.password, dbUser.passwordHash);
          if (isValid) {
            authenticatedUser = dbUser;
          }
        }
      }

      if (authenticatedUser) {
        const accessToken = await generateAccessToken({
          sub: authenticatedUser.id,
          org: authenticatedUser.organizationId,
          email: authenticatedUser.email,
          name: authenticatedUser.name,
          role: authenticatedUser.role,
        });
        const refreshToken = await generateRefreshToken(authenticatedUser.id);
        const tokenHash = await sha256Hex(refreshToken);

        await supabase.from('refresh_tokens').insert({
          id: crypto.randomUUID(),
          userId: authenticatedUser.id,
          tokenHash,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          createdAt: new Date().toISOString(),
        });

        return jsonResponse({
          accessToken,
          refreshToken,
          user: {
            id: authenticatedUser.id,
            name: authenticatedUser.name,
            email: authenticatedUser.email,
            role: authenticatedUser.role,
            organizationId: authenticatedUser.organizationId,
          },
        });
      }

      // 2. Fallback to Supabase Auth
      const { data: session, error } = await supabase.auth.signInWithPassword({
        email: body.email,
        password: body.password,
      });

      if (error || !session.user || !session.session) {
        throw new AppError('Invalid email or password', 401, 'UNAUTHORIZED');
      }

      const { data: profile } = await supabase
        .from('users')
        .select('id, organizationId, email, role, name')
        .eq('id', session.user.id)
        .single();

      // Ensure user has a users table record
      let userProfile = profile;
      if (!userProfile) {
        // Check if a users table record exists by email
        const { data: existingUser } = await supabase
          .from('users')
          .select('id, organizationId, email, role, name')
          .eq('email', body.email)
          .single();

        if (existingUser) {
          userProfile = existingUser;
        } else {
          // Create a minimal users table record for Supabase Auth users
          const userRole = 'VIEWER'; // Default role for new logins
          await supabase.from('users').insert({
            id: session.user.id,
            organizationId: '', // Will be set on first company grant
            email: body.email,
            name: session.user.user_metadata?.name || body.email.split('@')[0],
            role: userRole,
            isActive: true,
          });
          userProfile = { id: session.user.id, organizationId: '', email: body.email, name: session.user.user_metadata?.name || body.email.split('@')[0], role: userRole, isActive: true };
        }
      }

      return jsonResponse({
        accessToken: session.session.access_token,
        refreshToken: session.session.refresh_token,
        user: userProfile,
      });
    }

    // POST /refresh
    if (req.method === 'POST' && (path === '/refresh' || path === '/refresh/')) {
      const schema = z.object({ refreshToken: z.string().min(1) });
      const body = await parseJsonBody(req, schema);

      try {
        const key = await crypto.subtle.importKey(
          'raw',
          new TextEncoder().encode(env.JWT_REFRESH_SECRET),
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['verify'],
        );
        const payload = await verify(body.refreshToken, key) as Record<string, unknown>;

        if (payload && payload.sub) {
          const userId = String(payload.sub);
          const tokenHash = await sha256Hex(body.refreshToken);

          const { data: storedToken } = await supabase
            .from('refresh_tokens')
            .select('*')
            .eq('tokenHash', tokenHash)
            .single();

          if (storedToken) {
            const { data: user } = await supabase
              .from('users')
              .select('*')
              .eq('id', userId)
              .single();

            if (user && user.isActive) {
              await supabase.from('refresh_tokens').delete().eq('id', storedToken.id);

              const newAccessToken = await generateAccessToken({
                sub: user.id,
                org: user.organizationId,
                email: user.email,
                name: user.name,
                role: user.role,
              });
              const newRefreshToken = await generateRefreshToken(user.id);
              const newTokenHash = await sha256Hex(newRefreshToken);

              await supabase.from('refresh_tokens').insert({
                id: crypto.randomUUID(),
                userId: user.id,
                tokenHash: newTokenHash,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                createdAt: new Date().toISOString(),
              });

              return jsonResponse({
                accessToken: newAccessToken,
                refreshToken: newRefreshToken,
              });
            }
          }
        }
      } catch {
        // Custom JWT verification failed - proceed to Supabase Auth fallback
      }

      // Try Supabase Auth refresh fallback
      try {
        const { data: session, error } = await supabase.auth.refreshSession({
          refresh_token: body.refreshToken,
        });
        if (!error && session?.session) {
          return jsonResponse({
            accessToken: session.session.access_token,
            refreshToken: session.session.refresh_token,
          });
        }
      } catch {
        // Supabase Auth also failed
      }

      // Both custom JWT and Supabase Auth failed - throw 401 error
      throw new AppError('Could not refresh session', 401, 'UNAUTHORIZED');
    }

    // POST /logout
    if (req.method === 'POST' && (path === '/logout' || path === '/logout/')) {
      try {
        const schema = z.object({ refreshToken: z.string().optional() });
        const body = await parseJsonBody(req, schema).catch(() => ({ refreshToken: undefined }));
        if (body?.refreshToken) {
          const tokenHash = await sha256Hex(body.refreshToken);
          await supabase.from('refresh_tokens').delete().eq('tokenHash', tokenHash);
          await supabase.auth.admin.signOut(body.refreshToken).catch(() => undefined);
        }
      } catch {
        // Ignore errors during logout
      }
      return jsonResponse({ success: true });
    }

// POST /forgot-password — send a recovery email only to real accounts.
    //
    // The user lookup happens server-side through the Supabase Admin API before
    // any mail is dispatched. When the address has no Auth user, nothing is
    // sent. The HTTP response is identical either way so the endpoint never
    // reveals whether an account exists (no user enumeration).
    if (req.method === 'POST' && (path === '/forgot-password' || path === '/forgot-password/')) {
      const schema = z.object({
        email: z.string().email().toLowerCase(),
      });
      const body = await parseJsonBody(req, schema);

      const baseUrl = (env.APP_BASE_URL || 'http://localhost:5173').replace(/\/+$/, '');
      const redirectTo = `${baseUrl}/reset-password`;

      try {
        // 1. Existence check via the users table (never disclosed to the client).
        const { data: existingUser, error: lookupError } = await supabase
          .from('users')
          .select('id')
          .eq('email', body.email)
          .single();

        const userExists = !!existingUser;

        if (lookupError && lookupError.code !== 'PGRST116') {
          console.warn(`[auth-api /forgot-password] lookup error for ${body.email}:`, lookupError.message);
        }

        if (!userExists) {
          console.warn(`[auth-api /forgot-password] no account for ${body.email} — reset email suppressed`);
        } else {
          // 2. Account exists — dispatch the recovery email.
          const { error } = await supabase.auth.resetPasswordForEmail(body.email, { redirectTo });
          if (error) {
            console.warn('[auth-api /forgot-password] recovery email not dispatched:', error.message);
          }
        }
      } catch (err) {
        // Server-side bookkeeping only; the response never reveals account existence.
        console.warn('[auth-api /forgot-password] lookup/dispatch failed:', err instanceof Error ? err.message : 'unknown');
      }

      return jsonResponse({ success: true });
    }

    // POST /reset-password — a user finishing the recovery link sets a new password.
    //
    // The recovery session comes from the reset-link redirect (either an OTP
    // token_hash or a recovery access_token). It is handed to Supabase Auth,
    // which is the only place a password is ever set or stored. The matching
    // app-side sessions are revoked so old tokens cannot outlive the change.
    if (req.method === 'POST' && (path === '/reset-password' || path === '/reset-password/')) {
      const schema = z.object({
        password: z.string().min(10).max(128),
        tokenHash: z.string().optional(),
        accessToken: z.string().optional(),
      });
      const body = await parseJsonBody(req, schema);

      const failures: string[] = [];
      if (body.password.length < 10) failures.push('at least 10 characters');
      if (!/[a-z]/.test(body.password)) failures.push('a lowercase letter');
      if (!/[A-Z]/.test(body.password)) failures.push('an uppercase letter');
      if (!/[0-9]/.test(body.password)) failures.push('a digit');
      if (failures.length) {
        throw new BadRequestError(`The password needs ${failures.join(', ')}.`);
      }

      // Resolve the user owning the recovery token through Supabase Auth only.
      let userId: string | null = null;
      if (body.tokenHash) {
        const { data, error } = await supabase.auth.verifyOtp({
          type: 'recovery',
          token_hash: body.tokenHash,
        });
        if (error || !data?.user) {
          throw new AppError('This reset link is invalid or has expired. Please request a new one.', 400, 'INVALID_RESET_LINK');
        }
        userId = data.user.id;
      } else if (body.accessToken) {
        const { data, error } = await supabase.auth.getUser(body.accessToken);
        if (error || !data?.user) {
          throw new AppError('This reset link is invalid or has expired. Please request a new one.', 400, 'INVALID_RESET_LINK');
        }
        userId = data.user.id;
      } else {
        throw new BadRequestError('This reset link is missing its recovery token. Please use the link from the email.');
      }

      const { error: updateErr } = await supabase.auth.admin.updateUserById(userId, { password: body.password });
      if (updateErr) {
        throw new AppError('We could not update your password. Please try again.', 400, 'PASSWORD_UPDATE_FAILED');
      }

      // Keep the app's own session table in step: a changed password ends every
      // live custom-JWT session, mirroring the Node resetPassword behaviour.
      const nowIso = new Date().toISOString();
      await supabase
        .from('users')
        .update({ passwordChangedAt: nowIso, updatedAt: nowIso })
        .eq('id', userId)
        .catch(() => undefined);
      await supabase.from('refresh_tokens').delete().eq('userId', userId).catch(() => undefined);
      await supabase.auth.admin.signOut(userId, 'global').catch(() => undefined);

      return jsonResponse({ success: true });
    }

    // ── Protected Routes ─────────────────────────────────────────────────────
    const authCtx = await getAuthContext(req);

    // GET /me
    if (req.method === 'GET' && (path === '/me' || path === '/me/')) {
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('id', authCtx.userId)
        .single();

      if (userError || !user) {
        console.error('[GET /me Error]:', userError);
        throw new AppError('User profile not found', 404);
      }

      const { data: org } = await supabase
        .from('organizations')
        .select('id, name, slug, trialEndsAt')
        .eq('id', user.organizationId)
        .single();

      const { count: membershipCount } = await supabase
        .from('company_memberships')
        .select('id', { count: 'exact', head: true })
        .eq('userId', user.id);

      const role = user.role as any;
      const capabilities = role === 'SUPER_ADMIN'
        ? ['*']
        : role === 'ADMIN'
        ? ['company.create', 'company.edit', 'company.archive', 'company.view', 'compliance.view', 'compliance.update', 'tasks.view', 'tasks.manage', 'documents.view', 'documents.upload', 'documents.delete', 'users.manage', 'audit.read', 'rules.read', 'billing.manage']
        : role === 'CA'
        ? ['company.view', 'company.edit', 'compliance.view', 'compliance.update', 'tasks.view', 'tasks.manage', 'documents.view', 'documents.upload']
        : role === 'COMPANY_OWNER'
        ? ['company.view', 'company.edit', 'compliance.view', 'compliance.update', 'tasks.view', 'tasks.manage', 'documents.view', 'documents.upload', 'billing.manage']
        : role === 'VIEWER'
        ? ['company.view', 'compliance.view', 'tasks.view', 'documents.view']
        : [];

      const trialEndsAt = org?.trialEndsAt || null;
      const trialDaysLeft = trialEndsAt ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86400000)) : null;

      const profile = {
        ...user,
        organization: org || { id: user.organizationId, name: 'Organization', slug: 'org' },
        trialEndsAt,
        trialDaysLeft,
        capabilities,
        seesEveryCompany: role === 'SUPER_ADMIN' || role === 'ADMIN',
        companyCount: membershipCount || 0,
      };

      return jsonResponse(profile);
    }

    // GET /users
    if (req.method === 'GET' && (path === '/users' || path === '/users/')) {
      const { data: users } = await supabase
        .from('users')
        .select('*, memberships:company_memberships(*, company:companies(id, legalName))')
        .eq('organizationId', authCtx.organizationId)
        .order('createdAt', { ascending: false });

      return jsonResponse(users || []);
    }

    // POST /users (Invite User)
    if (req.method === 'POST' && (path === '/users' || path === '/users/')) {
      requireCapability(authCtx, 'users.manage');
      const schema = z.object({
        email: z.string().email().toLowerCase(),
        name: z.string().min(2).max(120),
        role: z.enum(['SUPER_ADMIN', 'ADMIN', 'CA', 'COMPANY_OWNER', 'VIEWER']),
        password: z.string().optional(),
        companyIds: z.array(z.string().uuid()).optional(),
      });
      const body = await parseJsonBody(req, schema);

      const userPassword = body.password && body.password.length >= 8 ? body.password : `Temp@${crypto.randomUUID().slice(0, 8)}`;
      const { data: newAuthUser, error: inviteError } = await supabase.auth.admin.createUser({
        email: body.email,
        password: userPassword,
        email_confirm: true,
        user_metadata: { name: body.name },
      });

      if (inviteError || !newAuthUser.user) {
        throw new AppError(`User invite failed: ${inviteError?.message}`, 400);
      }

      const { data: newUser, error: dbError } = await supabase
        .from('users')
        .insert({
          id: newAuthUser.user.id,
          organizationId: authCtx.organizationId,
          email: body.email,
          passwordHash: 'SUPABASE_AUTH_MANAGED',
          name: body.name,
          role: body.role,
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .select()
        .single();

      if (dbError) throw new AppError(dbError.message, 400);

      // Create company membership grants if companyIds are provided
      if (body.companyIds && body.companyIds.length > 0) {
        const rows = body.companyIds.map((cId) => ({
          id: crypto.randomUUID(),
          userId: newUser.id,
          companyId: cId,
          role: body.role === 'ADMIN' || body.role === 'SUPER_ADMIN' ? 'ADMIN' : body.role,
          grantedById: authCtx.userId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }));
        await supabase.from('company_memberships').insert(rows);
      }

      const { data: memberships } = await supabase
        .from('company_memberships')
        .select('*, company:companies(id, legalName)')
        .eq('userId', newUser.id);

      return jsonResponse({
        ...newUser,
        memberships: memberships || [],
      }, 201);
    }

    // PUT /users/:id/access (Company Grants)
    const accessMatch = path.match(/^\/users\/([a-f0-9-]+)\/access$/);
    if (req.method === 'PUT' && accessMatch) {
      requireCapability(authCtx, 'users.manage');
      const targetUserId = accessMatch[1];
      const schema = z.object({
        grants: z.array(z.object({
          companyId: z.string().uuid(),
          role: z.enum(['ADMIN', 'CA', 'COMPANY_OWNER', 'VIEWER']).default('CA'),
        })),
      });
      const body = await parseJsonBody(req, schema);

      await supabase.from('company_memberships').delete().eq('userId', targetUserId);

      if (body.grants.length > 0) {
        const rows = body.grants.map((g) => ({
          userId: targetUserId,
          companyId: g.companyId,
          role: g.role,
          grantedById: authCtx.userId,
        }));
        await supabase.from('company_memberships').insert(rows);
      }

      const { data: updatedGrants } = await supabase
        .from('company_memberships')
        .select('*, company:companies(id, legalName)')
        .eq('userId', targetUserId);

      return jsonResponse(updatedGrants || []);
    }

    throw new BadRequestError(`No route matches ${req.method} ${path}`);
  } catch (err) {
    return errorResponse(err);
  }
});
