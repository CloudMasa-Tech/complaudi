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
import { endSession, startSession, describeDevice } from '../_shared/session.ts';
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  totpUri,
  verifyTotp,
} from '../_shared/totp.ts';
// @ts-ignore
import { z } from 'https://esm.sh/zod@3.23.8';
// @ts-ignore
import bcrypt from 'https://esm.sh/bcryptjs@2.4.3';
// @ts-ignore
import { create, verify, getNumericDate } from 'https://deno.land/x/djwt@v3.0.2/mod.ts';

async function generateAccessToken(payload: { sub: string; org: string; email: string; name: string; role: string; sid: string }) {
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
      // The account's single active session. Verified on every request; a token
      // whose sid no longer matches the stored one is refused.
      sid: payload.sid,
      exp: getNumericDate(60 * 15),
      iat: getNumericDate(0),
    },
    key,
  );
}

/**
 * A short-lived ticket proving the password step passed, handed out when the
 * account has 2FA on.
 *
 * Five minutes, single purpose. It is not an access token and carries no
 * session: `typ` is checked on the way back in, so a challenge ticket can never
 * be presented as a bearer token to the rest of the API.
 */
async function generate2faChallenge(userId: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.JWT_ACCESS_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return await create(
    { alg: 'HS256', typ: 'JWT' },
    { sub: userId, typ: '2fa', exp: getNumericDate(60 * 5), iat: getNumericDate(0) },
    key,
  );
}

async function verify2faChallenge(token: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.JWT_ACCESS_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const payload = await verify(token, key) as Record<string, unknown>;
  if (!payload?.sub || payload.typ !== '2fa') {
    throw new AppError('This verification has expired. Sign in again.', 401, 'UNAUTHORIZED');
  }
  return String(payload.sub);
}

/**
 * Everything a successful sign-in returns, once the account's single session
 * has been claimed. Used by the password path, the 2FA path and the Supabase
 * Auth fallback, so all three are guaranteed to issue the same shape of token.
 */
async function issueSession(supabase: any, req: Request, user: any) {
  const stamp = await startSession(supabase, user.id, req);

  const accessToken = await generateAccessToken({
    sub: user.id,
    org: user.organizationId,
    email: user.email,
    name: user.name,
    role: user.role,
    sid: stamp.sessionId,
  });
  const refreshToken = await generateRefreshToken(user.id, stamp.sessionId);

  await supabase.from('refresh_tokens').insert({
    id: crypto.randomUUID(),
    userId: user.id,
    tokenHash: await sha256Hex(refreshToken),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
  });

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
    },
    session: {
      startedAt: stamp.startedAt,
      device: describeDevice(stamp.userAgent),
    },
  };
}

async function generateRefreshToken(userId: string, sid: string) {
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
      sid,
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

      if (dbUser && dbUser.isActive && dbUser.passwordHash && dbUser.passwordHash !== 'SUPABASE_AUTH_MANAGED') {
        if (bcrypt.compareSync(body.password, dbUser.passwordHash)) {
          authenticatedUser = dbUser;
        }
      } else {
        // Compare against a throwaway hash when there is no password to check,
        // so an unknown address costs the same time as a wrong password. Without
        // this, response timing alone tells an attacker which of your clients
        // hold accounts here.
        bcrypt.compareSync(body.password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin');
      }

      if (authenticatedUser) {
        // Second factor, if the account has one. No session is claimed and no
        // token is issued until the code checks out — so a stolen password on
        // its own cannot displace the real user's live session.
        if (authenticatedUser.totpEnabledAt) {
          return jsonResponse({
            twoFactorRequired: true,
            challenge: await generate2faChallenge(authenticatedUser.id),
          });
        }

        return jsonResponse(await issueSession(supabase, req, authenticatedUser));
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

      // Deliberately not returning Supabase's own session token: it carries no
      // session claim, so accepting it would leave a way to hold a second
      // concurrent session and bypass the single-session rule entirely.
      if (userProfile.totpEnabledAt) {
        return jsonResponse({
          twoFactorRequired: true,
          challenge: await generate2faChallenge(userProfile.id),
        });
      }
      return jsonResponse(await issueSession(supabase, req, userProfile));
    }

    // POST /login/verify-2fa — the second step, holding the challenge ticket.
    if (req.method === 'POST' && (path === '/login/verify-2fa' || path === '/login/verify-2fa/')) {
      const schema = z.object({
        challenge: z.string().min(1),
        code: z.string().min(6).max(16),
      });
      const body = await parseJsonBody(req, schema);

      const userId = await verify2faChallenge(body.challenge);
      const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
      if (!user || !user.isActive || !user.totpEnabledAt) {
        throw new AppError('Two-factor verification is not available for this account', 401, 'UNAUTHORIZED');
      }

      const submitted = body.code.trim();
      let accepted = await verifyTotp(user.totpSecret, submitted);

      // A recovery code is spent on use. Burning it before issuing the session
      // means an interrupted sign-in cannot leave the same code replayable.
      if (!accepted && submitted.length > 6) {
        const hashed = await hashRecoveryCode(submitted);
        const remaining: string[] = user.totpRecoveryCodes ?? [];
        if (remaining.includes(hashed)) {
          accepted = true;
          await supabase
            .from('users')
            .update({
              totpRecoveryCodes: remaining.filter((h) => h !== hashed),
              updatedAt: new Date().toISOString(),
            })
            .eq('id', user.id);
        }
      }

      if (!accepted) throw new AppError('That code is not valid', 401, 'UNAUTHORIZED');

      return jsonResponse(await issueSession(supabase, req, user));
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
              // A refresh token only renews the session it was minted for.
              // Otherwise a displaced device could rotate its way back in and
              // hold a second concurrent session indefinitely.
              const sid = payload.sid ? String(payload.sid) : null;
              if (!sid || user.activeSessionId !== sid) {
                await supabase.from('refresh_tokens').delete().eq('id', storedToken.id);
                throw new AppError(
                  'This session was replaced by a newer sign-in. Please sign in again.',
                  401,
                  'SESSION_DISPLACED',
                );
              }

              await supabase.from('refresh_tokens').delete().eq('id', storedToken.id);

              const newAccessToken = await generateAccessToken({
                sub: user.id,
                org: user.organizationId,
                email: user.email,
                name: user.name,
                role: user.role,
                sid,
              });
              const newRefreshToken = await generateRefreshToken(user.id, sid);
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
      } catch (err) {
        // A displaced session is a decision, not a verification failure — it
        // must not fall through to the Supabase Auth fallback and quietly
        // succeed there.
        if (err instanceof AppError && err.code === 'SESSION_DISPLACED') throw err;
        // Custom JWT verification failed - proceed to Supabase Auth fallback
      }

      // The Supabase Auth refresh fallback used to live here and has been
      // removed. It minted a token carrying no session claim, which would have
      // been accepted with the single-session check skipped entirely — a
      // standing way around the one-session-per-account rule. Sign-in now
      // always issues our own tokens, so the only holders of a Supabase refresh
      // token are sessions predating that change; they get a clean 401 and sign
      // in again.

      // Both custom JWT and Supabase Auth failed - throw 401 error
      throw new AppError('Could not refresh session', 401, 'UNAUTHORIZED');
    }

    // ── two-factor enrolment ────────────────────────────────────────────────
    // Three steps on purpose: /2fa/setup mints a secret but turns nothing on,
    // /2fa/enable proves the phone works before it does, and /2fa/disable
    // re-checks the password. An enrolment abandoned halfway leaves the account
    // exactly as it was, so nobody can lock themselves out by closing a tab.

    // POST /2fa/setup
    if (req.method === 'POST' && (path === '/2fa/setup' || path === '/2fa/setup/')) {
      const ctx = await getAuthContext(req);
      const { data: user } = await supabase.from('users').select('*').eq('id', ctx.userId).single();
      if (user?.totpEnabledAt) {
        throw new AppError('Two-factor authentication is already on for this account', 409, 'CONFLICT');
      }

      const secret = generateTotpSecret();
      // Stored unconfirmed: totpEnabledAt is what actually switches 2FA on.
      await supabase
        .from('users')
        .update({ totpSecret: secret, updatedAt: new Date().toISOString() })
        .eq('id', ctx.userId);

      return jsonResponse({
        secret,
        uri: totpUri({ secret, account: ctx.email, issuer: 'Complaudi' }),
      });
    }

    // POST /2fa/enable
    if (req.method === 'POST' && (path === '/2fa/enable' || path === '/2fa/enable/')) {
      const ctx = await getAuthContext(req);
      const body = await parseJsonBody(req, z.object({ code: z.string().min(6).max(8) }));

      const { data: user } = await supabase.from('users').select('*').eq('id', ctx.userId).single();
      if (!user?.totpSecret) throw new BadRequestError('Start the setup step first');
      if (user.totpEnabledAt) throw new AppError('Already enabled', 409, 'CONFLICT');

      if (!(await verifyTotp(user.totpSecret, body.code.trim()))) {
        // Refusing to enable on a wrong code is the whole point of this step:
        // it proves the authenticator is actually working before the account
        // starts depending on it.
        throw new BadRequestError('That code is not valid. Check your authenticator app and try again.');
      }

      const recoveryCodes = generateRecoveryCodes();
      await supabase
        .from('users')
        .update({
          totpEnabledAt: new Date().toISOString(),
          totpRecoveryCodes: await Promise.all(recoveryCodes.map(hashRecoveryCode)),
          updatedAt: new Date().toISOString(),
        })
        .eq('id', ctx.userId);

      // The only time these are ever readable. They are stored hashed, so
      // neither we nor anyone with the database can show them again.
      return jsonResponse({ enabled: true, recoveryCodes });
    }

    // POST /2fa/disable
    if (req.method === 'POST' && (path === '/2fa/disable' || path === '/2fa/disable/')) {
      const ctx = await getAuthContext(req);
      const body = await parseJsonBody(req, z.object({ password: z.string().min(1) }));

      const { data: user } = await supabase.from('users').select('*').eq('id', ctx.userId).single();
      if (!user?.totpEnabledAt) throw new BadRequestError('Two-factor authentication is not on');

      // Re-authenticate: turning a factor off is exactly the action a stolen
      // session would want, and a live session alone must not be enough.
      if (!user.passwordHash || !bcrypt.compareSync(body.password, user.passwordHash)) {
        throw new AppError('That password is not correct', 401, 'UNAUTHORIZED');
      }

      await supabase
        .from('users')
        .update({
          totpSecret: null,
          totpEnabledAt: null,
          totpRecoveryCodes: [],
          updatedAt: new Date().toISOString(),
        })
        .eq('id', ctx.userId);

      return jsonResponse({ enabled: false });
    }

    // GET /2fa/status
    if (req.method === 'GET' && (path === '/2fa/status' || path === '/2fa/status/')) {
      const ctx = await getAuthContext(req);
      const { data: user } = await supabase
        .from('users')
        .select('totpEnabledAt, totpRecoveryCodes, sessionStartedAt, sessionUserAgent')
        .eq('id', ctx.userId)
        .single();

      return jsonResponse({
        enabled: Boolean(user?.totpEnabledAt),
        enabledAt: user?.totpEnabledAt ?? null,
        recoveryCodesRemaining: (user?.totpRecoveryCodes ?? []).length,
        session: {
          startedAt: user?.sessionStartedAt ?? null,
          device: describeDevice(user?.sessionUserAgent ?? null),
        },
      });
    }

    // POST /logout
    if (req.method === 'POST' && (path === '/logout' || path === '/logout/')) {
      try {
        const schema = z.object({ refreshToken: z.string().optional() });
        const body = await parseJsonBody(req, schema).catch(() => ({ refreshToken: undefined }));
        if (body?.refreshToken) {
          const tokenHash = await sha256Hex(body.refreshToken);
          const { data: stored } = await supabase
            .from('refresh_tokens')
            .select('userId')
            .eq('tokenHash', tokenHash)
            .maybeSingle();

          await supabase.from('refresh_tokens').delete().eq('tokenHash', tokenHash);
          // Release the account's session too, or the slot stays claimed and
          // the next sign-in looks like a displacement to nobody.
          if (stored?.userId) await endSession(supabase, stored.userId);
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
