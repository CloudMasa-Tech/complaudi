import { describe, expect, it } from 'vitest';

/**
 * Which paths a 401 must not be read as a lost session.
 *
 * Mirrors the guard in web/src/api/client.ts. A 401 from the endpoints that
 * establish a session is an answer — a wrong password, a stale reset link — and
 * clearing state there reports "you were signed out" to somebody who was never
 * signed in.
 */
const isCredentialEndpoint = (path: string) =>
  /^\/auth\/(login|register|refresh|forgot-password|reset-password|two-factor|change-password)/.test(path);

describe('what a 401 means, by endpoint', () => {
  it('treats a 401 while signing in as an answer, not a lost session', () => {
    for (const p of ['/auth/login', '/auth/register', '/auth/refresh', '/auth/forgot-password',
                     '/auth/reset-password', '/auth/two-factor', '/auth/change-password']) {
      expect(isCredentialEndpoint(p)).toBe(true);
    }
  });

  it('treats a 401 anywhere else as a session that is over', () => {
    // This is the case that was doing nothing: with no refresh token to spend —
    // what a displacement or a sign-out leaves behind — the client kept its
    // profile, rendered the whole shell, and put "Missing or invalid
    // Authorization header" in every panel. Signed out, still looking signed in.
    for (const p of ['/dashboard/overview', '/companies', '/tasks', '/documents',
                     '/billing', '/compliance/calendar', '/auth/me', '/auth/logout']) {
      expect(isCredentialEndpoint(p)).toBe(false);
    }
  });

  it('does not match a path that merely mentions one of those words', () => {
    // Anchored at the start, so a company named "login" or a query string
    // cannot exempt a real endpoint from ending the session.
    expect(isCredentialEndpoint('/companies?q=login')).toBe(false);
    expect(isCredentialEndpoint('/documents/auth/login')).toBe(false);
  });
});
