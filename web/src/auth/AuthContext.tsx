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
}

interface AuthState {
  user: Profile | null;
  ready: boolean;
  /** Gate on capability, not role — the server is the source of both. */
  can: (capability: Capability) => boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => {
    const refresh = tokens.refresh();
    if (refresh) void post('/auth/logout', { refreshToken: refresh }).catch(() => undefined);
    tokens.clear();
    setUser(null);
  }, []);

  // The client calls this when a refresh fails and the session cannot be saved.
  useEffect(() => {
    setSessionLostHandler(() => setUser(null));
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

  const login = useCallback(async (email: string, password: string) => {
    const result = await post<{ accessToken: string; refreshToken: string }>('/auth/login', { email, password });
    tokens.set(result.accessToken, result.refreshToken);
    setUser(await get<Profile>('/auth/me'));
  }, []);

  const can = useCallback(
    (capability: Capability) => Boolean(user?.capabilities?.includes(capability)),
    [user],
  );

  const value = useMemo(() => ({ user, ready, can, login, logout }), [user, ready, can, login, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
