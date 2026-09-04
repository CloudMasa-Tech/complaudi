import { useState } from 'react';
import { useCompanies } from '../auth/CompanyContext';
import { ApiError, post } from '../api/client';
import { Drawer, ErrorNote, Spinner } from './ui';
import type { CompanyMember, UserRole } from '../api/types';

const INVITE_ROLES: { value: UserRole; label: string }[] = [
  { value: 'CA', label: 'Chartered accountant' },
  { value: 'ADMIN', label: 'Admin' },
];

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
  const [role, setRole] = useState<UserRole>('CA');
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
          <h2 style={{ fontSize: 16 }}>Invite CA / Admin</h2>
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
              <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
                {INVITE_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              <span className="field-hint">
                They can work this company's pending tasks and filings, but cannot manage people or the account.
              </span>
            </div>
            <div className="row">
              <button
                className="btn-primary"
                disabled={busy || name.trim().length < 2 || !email.includes('@')}
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
