import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { get, post, setSessionLostHandler, tokens } from '../api/client';
import type { Capability, User } from '../api/types';

interface Profile extends User {
  organization: { id: string; name: string; slug: string };
  /** Sent by the server so the UI never re-derives what a role may do. */
  capabilities: Capability[];
  seesEveryCompany: boolean;
  companyCount: number;
  /** Null on a full account; set while a self-service trial is running. */
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
  phone?: string;
  createdAt: string;
  /** The account is holding a password somebody else chose. Until it sets its
   *  own, the API refuses everything but /me, /logout and /change-password, so
   *  the app must send it straight to the change screen. */
  mustChangePassword?: boolean;
}

/**
 * What a password submission produced. An account with 2FA on does not get a
 * token yet — it gets a short-lived challenge to carry into the second step.
 */
export type LoginOutcome =
  | { status: 'signed-in' }
  | { status: 'two-factor'; challenge: string };

interface AuthState {
  user: Profile | null;
  ready: boolean;
  /** Gate on capability, not role — the server is the source of both. */
  can: (capability: Capability) => boolean;
  login: (email: string, password: string) => Promise<LoginOutcome>;
  verifyTwoFactor: (challenge: string, code: string) => Promise<void>;
  logout: () => void;
  /** Set when the server signed this device out because the account was claimed elsewhere. */
  displacedReason: string | null;
  clearDisplaced: () => void;
  /** Re-read /auth/me. Used after setting a password, so the flag that gated
   *  the app is cleared without making the user sign in again. */
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);
  const [displacedReason, setDisplacedReason] = useState<string | null>(null);

  const logout = useCallback(() => {
    const refresh = tokens.refresh();
    if (refresh) void post('/auth/logout', { refreshToken: refresh }).catch(() => undefined);
    tokens.clear();
    setUser(null);
  }, []);

  // The client calls this when a refresh fails and the session cannot be saved.
  // A displacement carries the server's explanation, so the login screen can
  // say why rather than looking like an unexplained sign-out.
  useEffect(() => {
    setSessionLostHandler((reason) => {
      setDisplacedReason(reason ?? null);
      setUser(null);
    });
  }, []);

  // Restore the session on reload rather than bouncing the user to /login.
  useEffect(() => {
    if (!tokens.access()) {
      setReady(true);
      return;
    }
    get<Profile>('/auth/me')
      .then(setUser)
      .catch(() => tokens.clear())
      .finally(() => setReady(true));
  }, []);

  const refresh = useCallback(async () => {
    try {
      setUser(await get<Profile>('/auth/me'));
    } catch {
      // A failure here leaves the previous profile in place; the next request
      // that matters will surface the real problem.
    }
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<LoginOutcome> => {
    const result = await post<{
      accessToken?: string;
      refreshToken?: string;
      twoFactorRequired?: boolean;
      challenge?: string;
    }>('/auth/login', { email, password });

    if (result.twoFactorRequired && result.challenge) {
      return { status: 'two-factor', challenge: result.challenge };
    }

    tokens.set(result.accessToken!, result.refreshToken!);
    setDisplacedReason(null);
    setUser(await get<Profile>('/auth/me'));
    return { status: 'signed-in' };
  }, []);

  const verifyTwoFactor = useCallback(async (challenge: string, code: string) => {
    const result = await post<{ accessToken: string; refreshToken: string }>(
      '/auth/login/verify-2fa',
      { challenge, code },
    );
    tokens.set(result.accessToken, result.refreshToken);
    setDisplacedReason(null);
    setUser(await get<Profile>('/auth/me'));
  }, []);

  const clearDisplaced = useCallback(() => setDisplacedReason(null), []);

  const can = useCallback(
    (capability: Capability) => Boolean(user?.capabilities?.includes(capability)),
    [user],
  );

  const value = useMemo(
    () => ({ user, ready, can, login, verifyTwoFactor, logout, displacedReason, clearDisplaced, refresh }),
    [user, ready, can, login, verifyTwoFactor, logout, displacedReason, clearDisplaced, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
