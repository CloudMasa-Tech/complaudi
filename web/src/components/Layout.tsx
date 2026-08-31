import { useState, type FormEvent } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useResource } from '../api/useResource';
import { qs } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useCompanies } from '../auth/CompanyContext';
import { ROLE_LABEL, type Capability, type Paged, type Task } from '../api/types';
import { ApiError, post, tokens } from '../api/client';
import { Drawer, ErrorNote, Field, Spinner, initials } from './ui';

/** One source for the wordmark, so the sidebar and the header cannot disagree. */
export const BRAND = 'Complaudi';
export const BRAND_TAGLINE = 'A platform for compliance Audit';

const NAV: Array<{ to: string; label: string; icon: string; end?: boolean; capability?: Capability }> = [
  { to: '/', label: 'Dashboard', icon: '◈', end: true },
  { to: '/calendar', label: 'Calendar', icon: '▤' },
  { to: '/tasks', label: 'Tasks', icon: '✓' },
  { to: '/documents', label: 'Documents', icon: '❐' },
  { to: '/companies', label: 'Companies', icon: '⬢' },
  { to: '/copilot', label: 'Copilot', icon: '✦' },
  { to: '/rules', label: 'Rule engine', icon: '§', capability: 'rules.read' as const },
  { to: '/team', label: 'People & access', icon: '◍', capability: 'users.manage' as const },
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
};

/** Anyone can change their own password, which is what a temporary one is for. */
function ChangePasswordDrawer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (form.newPassword !== form.confirm) {
      setError('The two new passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // The server ends every other session and hands back a fresh pair for
      // this one, so changing a password does not sign you out of the tab you
      // are sitting in.
      const next = await post<{ accessToken: string; refreshToken: string }>('/auth/change-password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      tokens.set(next.accessToken, next.refreshToken);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change the password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer onClose={onClose}>
      <header className="drawer-head">
        <div className="stack" style={{ flex: 1, gap: 4 }}>
          <h2 style={{ fontSize: 16 }}>Change your password</h2>
          <span className="tiny dim">Your other devices will be signed out.</span>
        </div>
        <button className="btn-ghost btn-sm" onClick={onClose}>✕</button>
      </header>

      <form className="drawer-body" onSubmit={submit}>
        {error && <ErrorNote error={error} />}
        <Field label="Current password">
          <input type="password" required autoFocus value={form.currentPassword}
                 onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
        </Field>
        <Field label="New password" hint="At least 10 characters, with an uppercase letter and a digit">
          <input type="password" required value={form.newPassword}
                 onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
        </Field>
        <Field label="Confirm new password">
          <input type="password" required value={form.confirm}
                 onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
        </Field>
        <div className="row">
          <button className="btn-primary" type="submit" disabled={busy}>
            {busy ? <><Spinner /> Changing…</> : 'Change password'}
          </button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Drawer>
  );
}

export function Layout() {
  const { user, logout, can } = useAuth();
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);
  const { companies, selectedId, select, error: companiesError, reload: reloadCompanies } = useCompanies();
  const { pathname } = useLocation();

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
          {NAV.filter((n) => !n.capability || can(n.capability)).map((n) => (
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
          <div className="who">
            <div className="avatar">{initials(user?.name ?? '?')}</div>
            <div className="stack" style={{ minWidth: 0 }}>
              <span className="tiny truncate" style={{ fontWeight: 550 }}>{user?.name}</span>
              <span className="tiny dim truncate">
                {user ? ROLE_LABEL[user.role] : ''}
                {user?.organization.name ? ` · ${user.organization.name}` : ''}
              </span>
            </div>
          </div>
          <button className="btn-ghost btn-sm" style={{ width: '100%', marginTop: 6 }}
                  onClick={() => setChangingPassword(true)}>
            Change password
          </button>
          <button className="btn-ghost btn-sm" style={{ width: '100%', marginTop: 2 }} onClick={logout}>
            Sign out
          </button>
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
                <option value="">All companies ({companies.length})</option>
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
          {passwordChanged && (
            <div className="alert alert-info">
              Your password has been changed. Any other devices you were signed in on have been signed out.
            </div>
          )}
          <Outlet />
        </main>
      </div>

      {changingPassword && (
        <ChangePasswordDrawer
          onClose={() => setChangingPassword(false)}
          onDone={() => { setChangingPassword(false); setPasswordChanged(true); }}
        />
      )}
    </div>
  );
}
