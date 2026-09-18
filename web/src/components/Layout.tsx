import { useState, useRef, useEffect } from 'react';
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
  { to: '/billing', label: 'Billing', icon: '₹' },
  { to: '/analytics', label: 'Platform analytics', icon: '∑', adminOnly: true },
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
          <div className="brand-row" style={{ width: '100%', padding: '0 8px', boxSizing: 'border-box' }}>
            <img src="/logo.png" alt="Complaudi" style={{ width: '100%', maxWidth: 200, height: 'auto', objectFit: 'contain', display: 'block' }} />
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
