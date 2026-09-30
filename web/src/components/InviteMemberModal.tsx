import { useEffect, useState } from 'react';
import { useCompanies } from '../auth/CompanyContext';
import { ApiError, post } from '../api/client';
import { useResource } from '../api/useResource';
import { Drawer, ErrorNote, Spinner } from './ui';
import type { CompanyMember, UserRole } from '../api/types';

/** Labels only. Which of these may actually be granted is the server's answer,
 *  not this file's — see invitePermission. */
const ROLE_LABELS: Record<string, { label: string; hint: string }> = {
  ADMIN: {
    label: 'Admin',
    hint: 'Runs this company: works the filings and can invite and remove people.',
  },
  CA: {
    label: 'Chartered accountant',
    hint: "Works this company's tasks and filings, and can bring in other practitioners.",
  },
  VIEWER: {
    label: 'Viewer (read only)',
    hint: 'Can see the calendar, tasks and evidence, and change nothing.',
  },
};

interface InvitePermission {
  canInvite: boolean;
  roles: UserRole[];
  reason: string;
  inviterRole: UserRole | null;
}

interface InviteResult {
  user: { id: string; name: string; email: string; role: string };
  companies: string[];
}

/**
 * Shared invite flow used from the Tasks assignee dropdown and the Companies
 * team list. Only CA and ADMIN are offered — never COMPANY_OWNER or SUPER_ADMIN.
 * The backend emails the invitee a signup link; the UI never shows a password.
 */
export function InviteMemberModal({ companyId, onInvited, onClose }: {
  companyId: string;
  onInvited?: (member: CompanyMember) => void;
  onClose: () => void;
}) {
  const { companies } = useCompanies();
  const company = companies.find((c) => c.id === companyId);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole | ''>('');
  /* What this user may actually grant here. Asked rather than assumed: a
     practitioner cannot grant Admin, and a dropdown that offers it produces a
     403 from a choice that should never have been on screen. */
  const { data: permission } = useResource<InvitePermission>(`/companies/${companyId}/invite-permission`, [companyId]);
  const grantable = permission?.roles ?? [];

  // Default to the first role they can grant, once we know what that is.
  useEffect(() => {
    if (!role && grantable.length) setRole(grantable[0]!);
  }, [grantable, role]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneEmail, setDoneEmail] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await post<InviteResult>(`/companies/${companyId}/invite`, { name, email, role });
      onInvited?.({
        role: result.user.role as UserRole,
        since: new Date().toISOString(),
        member: { id: result.user.id, name: result.user.name, email: result.user.email, isActive: true },
        invitedBy: { id: '', name: '' },
      });
      setDoneEmail(result.user.email);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer onClose={onClose}>
      <header className="drawer-head">
        <div className="stack" style={{ flex: 1, gap: 4 }}>
          <h2 style={{ fontSize: 16 }}>Invite a team member</h2>
          <span className="tiny dim">
            {company ? `To ${company.legalName}` : 'To this company'}
          </span>
        </div>
        <button className="btn-ghost btn-sm" onClick={onClose}>✕</button>
      </header>

      <div className="drawer-body">
        {error && <ErrorNote error={error} />}

        {doneEmail ? (
          <div className="alert alert-info">
            <strong>Invite sent to {doneEmail}.</strong> They'll get an email with a link to set their
            own password and sign in.
          </div>
        ) : (
          <>
            <div className="field">
              <label>Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Priya Sharma"
                autoFocus
              />
            </div>
            <div className="field">
              <label>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="priya@example.com"
              />
            </div>
            <div className="field">
              <label>Role</label>
              <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} disabled={!grantable.length}>
                {grantable.map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]?.label ?? r}</option>
                ))}
              </select>
              <span className="field-hint">
                {role
                  ? ROLE_LABELS[role]?.hint
                  : permission
                    ? permission.reason || 'No roles are available for you to grant here.'
                    : 'Checking what you can grant…'}
              </span>
            </div>
            <div className="row">
              <button
                className="btn-primary"
                disabled={busy || !role || name.trim().length < 2 || !email.includes('@')}
                onClick={submit}
              >
                {busy ? <><Spinner /> Sending…</> : 'Send invite'}
              </button>
              <button onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}
