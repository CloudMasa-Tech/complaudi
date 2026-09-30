import { useState, useRef, useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useResource } from '../api/useResource';
import { qs, resolveApiUrl } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useCompanies } from '../auth/CompanyContext';

import { ROLE_LABEL, type Capability, type Paged, type Task } from '../api/types';
import { ENTITY_LABEL, initials } from './ui';

/** One source for the wordmark, so the sidebar and the header cannot disagree. */
export const BRAND = 'Complaudi';
/**
 * The tagline in two forms, from one definition.
 *
 * `BRAND_TAGLINE_PARTS` carries which words do the work, for the renderings
 * that emphasise them; `BRAND_TAGLINE` is joined from it, so the plain string
 * used in the page header and the document title can never drift from the
 * highlighted one in the sidebar.
 */
export const BRAND_TAGLINE_PARTS: Array<{ text: string; strong: boolean }> = [
  { text: 'An ', strong: false },
  { text: 'AI Platform', strong: true },
  { text: ' for ', strong: false },
  { text: 'compliance Audit', strong: true },
];

export const BRAND_TAGLINE = BRAND_TAGLINE_PARTS.map((p) => p.text).join('');

/**
 * Navigation icons.
 *
 * Previously single unicode glyphs — ◈ ▤ ❐ ⬢ ✦ ∑ — which is a font lookup, not
 * an icon set: each one comes from whichever family happens to carry it, so
 * their weights, sizes and baselines never matched, and a machine missing the
 * glyph drew a replacement box. These are drawn at one viewBox, one stroke
 * width and one join style, so the column reads as a set.
 */
const NAV_ICONS = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  tasks: <><path d="M9 6h11M9 12h11M9 18h11" /><path d="m3.5 6 1.2 1.2L7 5" /><path d="m3.5 12 1.2 1.2L7 11" /><path d="m3.5 18 1.2 1.2L7 17" /></>,
  documents: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>,
  companies: <><path d="M3 21h18M5 21V6a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v15M13 21V10h5a1 1 0 0 1 1 1v10" /><path d="M8 9h2M8 13h2M8 17h2M16 14h0M16 17h0" /></>,
  copilot: <><path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9Z" /><path d="M18 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7Z" /></>,
  rules: <><path d="M12 3v18M7 7h10" /><path d="M7 7 4 14h6ZM17 7l-3 7h6Z" /><path d="M4 14a3 3 0 0 0 6 0M14 14a3 3 0 0 0 6 0" /><path d="M8 21h8" /></>,
  people: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16.5 6.4a3.2 3.2 0 0 1 0 6.2M18 20a6 6 0 0 0-2.4-4.8" /></>,
  billing: <><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 10h19" /><path d="M6 15h4" /></>,
  analytics: <><path d="M3 21h18" /><rect x="5" y="12" width="3.6" height="6" rx="1" /><rect x="10.2" y="8" width="3.6" height="10" rx="1" /><rect x="15.4" y="4" width="3.6" height="14" rx="1" /></>,
} as const;

type NavIconName = keyof typeof NAV_ICONS;

const NavIcon = ({ name }: { name: NavIconName }) => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
       strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {NAV_ICONS[name]}
  </svg>
);

const NAV: Array<{ to: string; label: string; icon: NavIconName; end?: boolean; capability?: Capability; adminOnly?: boolean }> = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/calendar', label: 'Calendar', icon: 'calendar' },
  { to: '/tasks', label: 'Tasks', icon: 'tasks' },
  { to: '/documents', label: 'Documents', icon: 'documents' },
  { to: '/companies', label: 'Companies', icon: 'companies' },
  // The page header has always called this "AI Copilot"; only the nav disagreed.
  { to: '/copilot', label: 'AI Copilot', icon: 'copilot' },
  { to: '/rules', label: 'Rule engine', icon: 'rules', capability: 'rules.read' as const },
  { to: '/team', label: 'People & access', icon: 'people', capability: 'users.manage' as const },
  { to: '/billing', label: 'Billing', icon: 'billing' },
  { to: '/analytics', label: 'Platform analytics', icon: 'analytics', adminOnly: true },
];

const TITLES: Record<string, { title: string; sub: string }> = {
  '/': { title: 'Dashboard', sub: 'Compliance position across your entities' },
  '/calendar': { title: 'Compliance calendar', sub: 'Every obligation the engine generated, by due date' },
  '/tasks': { title: 'Tasks', sub: 'Who is doing what, and by when' },
  '/documents': { title: 'Document repository', sub: 'Evidence filed against each obligation' },
  '/companies': { title: 'Companies', sub: 'Entity profiles that drive the rules engine' },
  '/companies/new': { title: 'Onboard a company', sub: 'The engine runs as soon as you save' },
  '/copilot': { title: 'AI Copilot', sub: 'Answers grounded in the rule engine, with citations' },
  '/rules': { title: 'Rule engine', sub: 'Every rule the engine knows, with its statutory reference' },
  '/team': { title: 'People & access', sub: 'Who works here, and which companies they can reach' },
  '/profile': { title: 'Profile', sub: 'Your personal information and account settings' },
  '/billing': { title: 'Billing', sub: 'Plan details and payment settings' },
  '/analytics': { title: 'Platform analytics', sub: 'Revenue and adoption across every workspace' },
};

function CompanySwitcher({ companies, selectedId, select, userRole }: { companies: any[], selectedId: string | null, select: (id: string | null) => void, userRole?: string }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [ref]);

  const filtered = companies.filter(c => c.legalName.toLowerCase().includes(search.toLowerCase()));
  const selectedName = selectedId 
    ? companies.find(c => c.id === selectedId)?.legalName 
    : (userRole === 'SUPER_ADMIN' ? `All companies (${companies.length})` : 'Select company');

  return (
    <div ref={ref} style={{ position: 'relative', width: 280, fontSize: 14 }}>
      <button 
        className="btn-ghost" 
        style={{ width: '100%', justifyContent: 'space-between', border: '1px solid var(--border)', background: 'var(--surface)' }} 
        onClick={() => setOpen(!open)}
      >
        <span className="truncate">{selectedName}</span>
        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>▼</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, 
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, 
          boxShadow: 'var(--shadow)', zIndex: 100, 
          display: 'flex', flexDirection: 'column', maxHeight: 400
        }}>
          <div style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
            <input 
              type="text" 
              placeholder="Search companies..." 
              value={search} 
              onChange={e => setSearch(e.target.value)} 
              style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 4, boxSizing: 'border-box', outline: 'none' }}
              autoFocus
            />
          </div>
          <div style={{ overflowY: 'auto', padding: '4px 0', display: 'flex', flexDirection: 'column' }}>
            {userRole === 'SUPER_ADMIN' && (!search || "all companies".includes(search.toLowerCase())) && (
              <div 
                onClick={() => { select(null); setOpen(false); setSearch(''); }} 
                style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', cursor: 'pointer', gap: 8, background: selectedId === null ? 'var(--bg-card-alt)' : 'transparent' }}
              >
                <span style={{ width: 16, display: 'inline-block' }}>{selectedId === null ? '✓' : ''}</span>
                <span className="truncate">All companies ({companies.length})</span>
              </div>
            )}
            {filtered.map(c => (
              <div 
                key={c.id}
                onClick={() => { select(c.id); setOpen(false); setSearch(''); }} 
                style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', cursor: 'pointer', gap: 8, background: selectedId === c.id ? 'var(--bg-card-alt)' : 'transparent' }}
              >
                <span style={{ width: 16, display: 'inline-block' }}>{selectedId === c.id ? '✓' : ''}</span>
                <span className="truncate" title={c.legalName}>{c.legalName}</span>
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ padding: '12px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 13 }}>
                No matches found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const SignOutIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

export function Layout() {
  const { user, can, logout } = useAuth();
  const { companies, selectedId, select, error: companiesError, reload: reloadCompanies } = useCompanies();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  // A live count of open work, so the nav doubles as a nudge.
  const { data: openTasks } = useResource<Paged<Task>>(
    `/tasks${qs({ status: 'TODO,IN_PROGRESS,BLOCKED', companyId: selectedId ?? undefined, pageSize: 1 })}`,
    [selectedId],
  );

  /**
   * On a route that is about one company, the header names that company rather
   * than the product. Someone editing Trial Technologies already knows which
   * product they are in; what they need confirmed is which company they are
   * about to change — particularly when several are open in tabs.
   *
   * Only for routes carrying a company id. /companies and /companies/new are
   * not about one company, so they keep the brand.
   */
  const companyRouteId = pathname.match(/^\/companies\/([0-9a-f-]{36})(?:\/|$)/)?.[1] ?? null;
  const headerCompany = companyRouteId ? companies.find((c) => c.id === companyRouteId) ?? null : null;

  const page = TITLES[pathname] ?? { title: BRAND, sub: BRAND_TAGLINE };

  /**
   * The switcher narrows a view to one entity.
   *
   * The company screens are where every company the user holds is listed and
   * edited, so a filter there is a control that does nothing — and worse, reads
   * as though the list below it had been narrowed to the one company named.
   */
  const showCompanySwitcher = !pathname.startsWith('/companies');

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          {/* The same lockup the signed-out pages use, so the mark does not
              change shape the moment somebody logs in. One image, not a themed
              pair: the sidebar is dark under both settings, so the artwork with
              white lettering is always the right one. */}
          <div className="brand-lockup sidebar-lockup">
            <img src="/logo-dark.png" alt="Complaudi" className="brand-lockup-logo" />
            <p className="brand-lockup-tagline sidebar-tagline">
              {BRAND_TAGLINE_PARTS.map((part, i) =>
                part.strong
                  ? <strong key={i}>{part.text}</strong>
                  : <span key={i}>{part.text}</span>,
              )}
            </p>
          </div>
        </div>

        <nav className="nav">
          {NAV.filter((n) => (!n.capability || can(n.capability)) && (!n.adminOnly || user?.role === 'SUPER_ADMIN')).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}>
              <span className="nav-icon"><NavIcon name={n.icon} /></span>
              {n.label}
              {n.to === '/tasks' && openTasks && openTasks.total > 0 && (
                <span className="nav-count">{openTasks.total}</span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div
            className={`who ${pathname === '/profile' ? 'active' : ''}`}
            onClick={() => navigate('/profile')}
            style={{ cursor: user ? 'pointer' : 'default' }}
          >
            {user?.email === 'info@cloudmasa.com' ? (
              <img src="/superadmin.png" alt="Superadmin" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
            ) : (
              <div className="avatar">{initials(user?.name ?? '?')}</div>
            )}
            <div className="stack" style={{ minWidth: 0 }}>
              <span className="tiny truncate" style={{ fontWeight: 550 }}>{user?.name}</span>
              <span className="tiny dim truncate">
                {user ? ROLE_LABEL[user.role] : ''}
                {user?.organization.name ? ` · ${user.organization.name}` : ''}
              </span>
            </div>
          </div>

          {/* Directly under the person it signs out, which is where people look
              for it — it previously lived only on the Profile page, two clicks
              away and not obviously there at all. */}
          <button type="button" className="sign-out" onClick={logout}>
            <SignOutIcon />
            Sign out
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-title">
            {headerCompany ? (
              <div className="topbar-company">
                <span className="topbar-company-mark">
                  {headerCompany.logoStorageKey ? (
                    <img src={resolveApiUrl(`/companies/${headerCompany.id}/logo`)} alt="" />
                  ) : (
                    initials(headerCompany.legalName)
                  )}
                </span>
                <span className="stack" style={{ minWidth: 0, gap: 2 }}>
                  <h1 title={headerCompany.legalName}>{headerCompany.legalName}</h1>
                  <span className="topbar-sub">
                    {ENTITY_LABEL[headerCompany.entityType] ?? headerCompany.entityType}
                    {/* An LLP has an LLPIN rather than a CIN, so the label
                        follows whichever the entity actually holds. */}
                    {headerCompany.cin || headerCompany.llpin
                      ? ` · ${headerCompany.cin ?? headerCompany.llpin}`
                      : ''}
                  </span>
                </span>
              </div>
            ) : (
              <>
                <h1>{page.title}</h1>
                {page.sub && <span className="topbar-sub">{page.sub}</span>}
              </>
            )}
          </div>
          <div className="topbar-actions">
            {/* "All companies (0)" is a claim about what you hold. When the list
                could not be fetched we do not know that, so say what happened
                and offer the way out. */}
            {showCompanySwitcher && companiesError && (
              <button className="btn-sm" onClick={reloadCompanies} title={companiesError}>
                ⟳ Companies didn’t load — retry
              </button>
            )}
            {showCompanySwitcher && !companiesError && (
              <CompanySwitcher 
                companies={companies} 
                selectedId={selectedId} 
                select={select} 
                userRole={user?.role} 
              />
            )}
          </div>
        </header>

        <main className="content">
          {user?.trialDaysLeft !== null && user?.trialDaysLeft !== undefined && (
            <div className={`alert ${user.trialDaysLeft <= 3 ? 'alert-warn' : 'alert-info'}`}>
              <strong>
                {user.trialDaysLeft === 0
                  ? 'Your trial ends today.'
                  : `${user.trialDaysLeft} day${user.trialDaysLeft === 1 ? '' : 's'} left on your trial.`}
              </strong>{' '}
              Everything is open while it runs — complete the company profile, work the filings and attach
              evidence. Nothing you enter is lost when the trial ends.
            </div>
          )}

          <Outlet />
        </main>
      </div>


    </div>
  );
}
