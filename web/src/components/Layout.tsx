
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useResource } from '../api/useResource';
import { qs } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useCompanies } from '../auth/CompanyContext';

import { ROLE_LABEL, type Capability, type Paged, type Task } from '../api/types';
import { initials } from './ui';

/** One source for the wordmark, so the sidebar and the header cannot disagree. */
export const BRAND = 'Complaudi';
export const BRAND_TAGLINE = 'A platform for compliance Audit';

const NAV: Array<{ to: string; label: string; icon: string; end?: boolean; capability?: Capability; adminOnly?: boolean }> = [
  { to: '/', label: 'Dashboard', icon: '◈', end: true },
  { to: '/calendar', label: 'Calendar', icon: '▤' },
  { to: '/tasks', label: 'Tasks', icon: '✓' },
  { to: '/documents', label: 'Documents', icon: '❐' },
  { to: '/companies', label: 'Companies', icon: '⬢' },
  { to: '/copilot', label: 'Copilot', icon: '✦' },
  { to: '/rules', label: 'Rule engine', icon: '§', capability: 'rules.read' as const },
  { to: '/team', label: 'People & access', icon: '◍', capability: 'users.manage' as const },
  { to: '/subscriptions', label: 'Subscriptions', icon: '★', adminOnly: true },
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
  '/subscriptions': { title: 'Subscriptions', sub: 'Platform-wide overview of organizations and their plan status' },
};


export function Layout() {
  const { user, can } = useAuth();
  const { companies, selectedId, select, error: companiesError, reload: reloadCompanies } = useCompanies();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  // A live count of open work, so the nav doubles as a nudge.
  const { data: openTasks } = useResource<Paged<Task>>(
    `/tasks${qs({ status: 'TODO,IN_PROGRESS,BLOCKED', companyId: selectedId ?? undefined, pageSize: 1 })}`,
    [selectedId],
  );

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
          <div className="brand-row">
            <div className="brand-mark">C</div>
            <span className="brand-name">{BRAND}</span>
          </div>
          <span className="brand-tagline">{BRAND_TAGLINE}</span>
        </div>

        <nav className="nav">
          {NAV.filter((n) => (!n.capability || can(n.capability)) && (!n.adminOnly || user?.role === 'SUPER_ADMIN')).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}>
              <span className="nav-icon">{n.icon}</span>
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
            <div className="avatar">{initials(user?.name ?? '?')}</div>
            <div className="stack" style={{ minWidth: 0 }}>
              <span className="tiny truncate" style={{ fontWeight: 550 }}>{user?.name}</span>
              <span className="tiny dim truncate">
                {user ? ROLE_LABEL[user.role] : ''}
                {user?.organization.name ? ` · ${user.organization.name}` : ''}
              </span>
            </div>
          </div>


        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-title">
            <h1>{page.title}</h1>
            {page.sub && <span className="topbar-sub">{page.sub}</span>}
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
              <select
                value={selectedId ?? ''}
                onChange={(e) => select(e.target.value || null)}
                style={{ width: 250 }}
                aria-label="Company"
              >
                {user?.role === 'SUPER_ADMIN' && (
                  <option value="">All companies ({companies.length})</option>
                )}
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.legalName}</option>
                ))}
              </select>
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
