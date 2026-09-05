import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useResource } from '../api/useResource';
import { useAuth } from './AuthContext';
import type { Capability, Company } from '../api/types';

const KEY = 'ct.company';

interface CompanyState {
  companies: Company[];
  loading: boolean;
  /** null means "all companies in the organization". */
  selectedId: string | null;
  selected: Company | null;
  select: (id: string | null) => void;
  /**
   * Capability on a specific company. The grant is authoritative, so the same
   * person may be able to edit one client and only read the next.
   */
  canOn: (companyId: string | null | undefined, capability: Capability) => boolean;
  /**
   * Set when the list could not be fetched. Distinct from an empty list: one
   * means "you hold no companies", the other means "we do not know yet", and
   * every company-scoped view reads very differently under the two.
   */
  error: string | null;
  reload: () => void;
}

const Ctx = createContext<CompanyState | null>(null);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { data, loading, error, reload } = useResource<Company[]>('/companies');
  const [selectedId, setSelectedId] = useState<string | null>(() => localStorage.getItem(KEY));

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  }, []);

  const companies = useMemo(() => data ?? [], [data]);

  /**
   * A failed load must not settle as "no companies".
   *
   * Nothing here retried, so one dropped request — a restarted API, a proxy
   * that lost a pooled socket — left the switcher reading "All companies (0)"
   * and every scoped view empty until the page was reloaded by hand. Try twice
   * more, then leave `error` set for the UI to own up to.
   */
  const attempts = useRef(0);
  useEffect(() => {
    if (!error) {
      attempts.current = 0;
      return;
    }
    if (attempts.current >= 2) return;
    attempts.current += 1;
    const timer = setTimeout(reload, 1200 * attempts.current);
    return () => clearTimeout(timer);
  }, [error, reload]);

  // A remembered id can point at a company that has since been deactivated or
  // belongs to a different login — fall back to the whole organization.
  const selected = useMemo(
    () => companies.find((c) => c.id === selectedId) ?? null,
    [companies, selectedId],
  );
  const effectiveId = selected ? selectedId : null;

  /**
   * One company is not a choice.
   *
   * Someone granted a single entity — most company owners, and any practitioner
   * onboarded onto one client — was landing on "All companies (1)", an org-wide
   * view that hides the very profile they came for. Select it for them, once:
   * if they deliberately switch back afterwards, that sticks.
   */
  const autoSelected = useRef(false);
  useEffect(() => {
    if (autoSelected.current || loading || error) return;
    if (!effectiveId && companies.length > 0) {
      if (companies.length === 1 || user?.role !== 'SUPER_ADMIN') {
        autoSelected.current = true;
        select(companies[0]!.id);
      }
    }
  }, [companies, effectiveId, loading, select, user]);

  const canOn = useCallback(
    (companyId: string | null | undefined, capability: Capability) => {
      if (!companyId) {
        // With no company in hand — an org-wide view — allow it if any company
        // would; the server refuses per company anyway.
        return companies.some((c) => c.myCapabilities?.includes(capability));
      }
      return Boolean(companies.find((c) => c.id === companyId)?.myCapabilities?.includes(capability));
    },
    [companies],
  );

  const value = useMemo(
    () => ({ companies, loading, selectedId: effectiveId, selected, select, canOn, error, reload }),
    [companies, loading, effectiveId, selected, select, canOn, error, reload],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCompanies(): CompanyState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCompanies must be used inside CompanyProvider');
  return ctx;
}
