import { useState, type FormEvent } from 'react';
import { ApiError, patch, post, put } from '../api/client';
import { useResource } from '../api/useResource';
import { useAuth } from '../auth/AuthContext';
import { useCompanies } from '../auth/CompanyContext';
import { ROLE_LABEL, type Company, type TeamMember, type UserRole } from '../api/types';
import { Badge, Card, Drawer, Empty, ErrorNote, Field, Loading, Spinner, fmtDateTime, initials } from '../components/ui';

/** Base roles a super admin hands out. SUPER_ADMIN is promoted separately, never invited into. */
const ASSIGNABLE: UserRole[] = ['ADMIN', 'CA', 'COMPANY_OWNER', 'VIEWER'];

/**
 * Roles a *per-company grant* may carry — everything except super admin, who
 * sees the whole organisation and is therefore never granted one company.
 */
const GRANTABLE: UserRole[] = ['ADMIN', 'CA', 'COMPANY_OWNER', 'VIEWER'];

const ROLE_BLURB: Record<UserRole, string> = {
  SUPER_ADMIN: 'Every company in the organisation, plus user and access management.',
  ADMIN: 'Only granted companies — onboards, archives and works filings on them.',
  CA: 'Only granted companies — works the filings and edits profiles.',
  COMPANY_OWNER: 'Only granted companies — completes filings and uploads evidence, cannot reshape the profile.',
  VIEWER: 'Read-only, on granted companies.',
};

/**
 * Every role this person holds, one dropdown per company.
 *
 * The per-company grant is what decides what someone may do — the base role only
 * seeds new grants — so a single role for the person could only ever contradict
 * the grants underneath it. Each company carries its own dropdown here, and the
 * Access drawer edits the same grants, so the two can never disagree.
 *
 * A super admin holds no grants and needs none, and someone with no companies
 * yet has nothing to set per company; both keep the single person-level role.
 */
function RoleCell({ member, busy, onPickBase, onPickGrant }: {
  member: TeamMember;
  busy: boolean;
  onPickBase: (role: UserRole) => void;
  onPickGrant: (companyId: string, role: UserRole) => void;
}) {
  const baseSelect = (
    <select style={{ width: 210 }} value={member.role} disabled={busy}
            aria-label={`Role for ${member.name}`}
            onChange={(e) => onPickBase(e.target.value as UserRole)}>
      <option value="SUPER_ADMIN">{ROLE_LABEL.SUPER_ADMIN}</option>
      {ASSIGNABLE.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
    </select>
  );

  if (member.seesEveryCompany) {
    return (
      <div className="stack" style={{ gap: 6 }}>
        {baseSelect}
        <Badge value="COMPLETED">Every company</Badge>
        {member.companies.length > 0 && (
          <span className="tiny dim">
            {member.companies.length} company role{member.companies.length === 1 ? '' : 's'} kept but dormant
            while they see everything — change this role and they come back as they were.
          </span>
        )}
      </div>
    );
  }

  if (member.companies.length === 0) {
    return (
      <div className="stack" style={{ gap: 6 }}>
        {baseSelect}
        <span className="tiny" style={{ color: 'var(--high)' }}>
          No companies yet — grant some with Access.
        </span>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 7 }}>
      {member.companies.map((c) => (
        <div key={c.companyId} className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="dot" style={{ background: 'var(--good)', flex: 'none' }} />
          <span className="tiny muted" style={{ flex: 1, minWidth: 0 }}>{c.legalName}</span>
          <select
            style={{ width: 190, flex: 'none' }}
            value={c.role}
            disabled={busy}
            aria-label={`Role on ${c.legalName}`}
            onChange={(e) => onPickGrant(c.companyId, e.target.value as UserRole)}
          >
            {GRANTABLE.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </div>
      ))}
      {/* The one role that is not a grant, so it cannot live in the rows above. */}
      <button
        className="btn-ghost btn-sm"
        style={{ alignSelf: 'flex-start' }}
        disabled={busy}
        title="A super admin sees every company, so this releases the grants above."
        onClick={() => onPickBase('SUPER_ADMIN')}
      >
        Make super admin
      </button>
    </div>
  );
}

/**
 * Sets a new password for someone locked out.
 *
 * The password is shown once and never stored in the clear, so it has to be
 * copied before this closes — the drawer says so rather than letting someone
 * discover it afterwards.
 */
function ResetPasswordDrawer({ member, onClose, onDone }: {
  member: TeamMember; onClose: () => void; onDone: (message: string) => void;
}) {
  const [chosen, setChosen] = useState('');
  const [result, setResult] = useState<{ password: string; generated: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  return (
    <Drawer onClose={onClose}>
      <header className="drawer-head">
        <div className="stack" style={{ flex: 1, gap: 4 }}>
          <h2 style={{ fontSize: 16 }}>Reset password</h2>
          <span className="tiny dim">{member.name} · {member.email}</span>
        </div>
        <button className="btn-ghost btn-sm" onClick={onClose}>✕</button>
      </header>

      <div className="drawer-body">
        {error && <ErrorNote error={error} />}

        {result ? (
          <>
            <div className="alert alert-warn">
              <strong>Copy this now — it is shown once and cannot be retrieved.</strong> Pass it to {member.name}
              {' '}through a channel you trust, and ask them to change it after signing in.
            </div>
            <div className="card">
              <div className="card-body row" style={{ gap: 12 }}>
                <code className="mono" style={{ fontSize: 18, letterSpacing: '0.06em', flex: 1 }}>{result.password}</code>
                <button
                  onClick={() => { void navigator.clipboard?.writeText(result.password); setCopied(true); }}
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
            <div className="alert">
              Every session they had has ended — existing tokens are refused, so the old password cannot keep
              anyone signed in.
            </div>
            <div className="row">
              <button className="btn-primary" onClick={() => onDone(`Password reset for ${member.name}.`)}>Done</button>
            </div>
          </>
        ) : (
          <>
            <div className="alert">
              This signs {member.name} out everywhere and replaces their password. Leave the field empty to
              generate a strong one.
            </div>
            <Field label="New password" hint="Optional — at least 10 characters with an uppercase letter and a digit">
              <input value={chosen} placeholder="Leave empty to generate one"
                     onChange={(e) => { setChosen(e.target.value); setError(null); }} />
            </Field>
            <div className="row">
              <button className="btn-primary" disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setError(null);
                        try {
                          setResult(await post(`/auth/users/${member.id}/reset-password`,
                            chosen.trim() ? { password: chosen.trim() } : {}));
                        } catch (err) {
                          setError(err instanceof ApiError ? err.message : 'Could not reset the password');
                        } finally {
                          setBusy(false);
                        }
                      }}>
                {busy ? <><Spinner /> Resetting…</> : chosen.trim() ? 'Set this password' : 'Generate a password'}
              </button>
              <button onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}

/** Which companies a person may see, edited as a whole. */
function AccessDrawer({ member, companies, onClose, onSaved }: {
  member: TeamMember; companies: Company[]; onClose: () => void; onSaved: (message: string) => void;
}) {
  const [grants, setGrants] = useState<Record<string, UserRole>>(
    Object.fromEntries(member.companies.map((c) => [c.companyId, c.role])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) =>
    setGrants((g) => {
      const next = { ...g };
      if (next[id]) delete next[id];
      // Default the grant to the person's own role, unless that role is
              // organisation-wide and therefore not grantable.
              else next[id] = GRANTABLE.includes(member.role) ? member.role : 'CA';
      return next;
    });

  const count = Object.keys(grants).length;

  return (
    <Drawer onClose={onClose}>
      <header className="drawer-head">
        <div className="stack" style={{ flex: 1, gap: 4 }}>
          <h2 style={{ fontSize: 16 }}>{member.name}</h2>
          <span className="tiny dim">{ROLE_LABEL[member.role]} · {member.email}</span>
        </div>
        <button className="btn-ghost btn-sm" onClick={onClose}>✕</button>
      </header>

      <div className="drawer-body">
        {error && <ErrorNote error={error} />}

        {member.seesEveryCompany ? (
          <div className="alert alert-info">
            <strong>Super admins see every company in the organisation.</strong> There is nothing to grant.
            Change their role if you want to restrict them to particular companies.
          </div>
        ) : (
          <>
            <div className="alert">
              Tick the companies this person may see. Everything else — the calendar, tasks, documents, the
              dashboard — follows from this. With none ticked they can sign in and see nothing.
              <div style={{ marginTop: 6 }} className="tiny dim">
                The role beside each company applies to that company only. To let someone see every company,
                make them an admin on the People list above instead.
              </div>
            </div>

            <div className="stack" style={{ gap: 2 }}>
              {companies.map((c) => (
                <div key={c.id} className="checklist-row" style={{ cursor: 'default' }}>
                  {/* The label wraps only the tick and the name. With the select
                      inside it, clicking the dropdown activated the label and
                      toggled the company straight back off. */}
                  <label className="row" style={{ flex: 1, gap: 9, cursor: 'pointer' }}>
                    <input type="checkbox" checked={Boolean(grants[c.id])} onChange={() => toggle(c.id)} />
                    <span>{c.legalName}</span>
                  </label>
                  {grants[c.id] && (
                    <select
                      value={grants[c.id]}
                      onChange={(e) => setGrants((g) => ({ ...g, [c.id]: e.target.value as UserRole }))}
                      style={{ width: 200 }}
                      aria-label={`Role on ${c.legalName}`}
                    >
                      {GRANTABLE.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                  )}
                </div>
              ))}
              {companies.length === 0 && <Empty>No companies to grant yet.</Empty>}
            </div>

            <div className="row">
              <button
                className="btn-primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await put(`/auth/users/${member.id}/access`, {
                      grants: Object.entries(grants).map(([companyId, role]) => ({ companyId, role })),
                    });
                    onSaved(
                      count === 0
                        ? `${member.name} now has access to no companies.`
                        : `${member.name} now has access to ${count} compan${count === 1 ? 'y' : 'ies'}.`,
                    );
                  } catch (err) {
                    setError(err instanceof ApiError ? err.message : 'Could not save access');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? <><Spinner /> Saving…</> : `Save access (${count} selected)`}
              </button>
              <button onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}

export function Team() {
  const { user, can } = useAuth();
  const { companies, selected, selectedId } = useCompanies();
  const { data: members, initial, error, reload } = useResource<TeamMember[]>('/auth/users');

  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [resetting, setResetting] = useState<TeamMember | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState({ name: '', email: '', password: '', role: 'CA' as UserRole, companyIds: [] as string[] });
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [editingDetails, setEditingDetails] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', email: '' });

  if (!can('users.manage')) {
    return (
      <Card>
        <Empty>Only a super admin can manage people and access.</Empty>
      </Card>
    );
  }

  if (error) return <ErrorNote error={error} />;
  if (initial || !members) return <Loading label="Loading the team" />;

  // Picking a company at the top narrows this to the people who can reach it —
  // the question you are usually asking on this screen.
  const shown = selectedId
    ? members.filter((m) => m.seesEveryCompany || m.companies.some((c) => c.companyId === selectedId))
    : members;

  async function run(fn: () => Promise<unknown>, message?: string) {
    setBusy(true);
    setSaveError(null);
    try {
      await fn();
      reload();
      if (message) setNotice(message);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  }

  async function submitInvite(e: FormEvent) {
    e.preventDefault();

    // A scoped role with no companies signs in to an empty application, which is
    // almost never what was meant. Say so rather than create a stranded account.
    if (scoped && invite.companyIds.length === 0) {
      setInviteError(
        `A ${ROLE_LABEL[invite.role].toLowerCase()} sees only the companies you grant. ` +
          'Pick at least one, or make them an admin if they should see everything.',
      );
      return;
    }

    setInviteError(null);
    await run(async () => {
      await post('/auth/users', invite);
      setInvite({ name: '', email: '', password: '', role: 'CA', companyIds: [] });
    }, `${invite.name} added as ${ROLE_LABEL[invite.role].toLowerCase()}.`);
  }

  const scoped = invite.role !== 'ADMIN';

  return (
    <>
      {saveError && <ErrorNote error={saveError} />}
      {notice && <div className="alert alert-info">{notice}</div>}

      <Card
        title="People"
        note={
          selectedId
            ? `${shown.length} with access to ${selected?.legalName ?? 'this company'}`
            : `${members.length} in ${user?.organization.name}`
        }
        action={
          selectedId ? (
            <span className="tiny dim">Showing only people who can reach the selected company</span>
          ) : undefined
        }
      >
        {/* The roster grows; the header stays put and the body scrolls. */}
        <div className="table-wrap" style={{ maxHeight: '58vh', overflowY: 'auto' }}>
          <table>
            <thead className="sticky-head">
              <tr>
                <th style={{ minWidth: 240 }}>Person</th>
                <th style={{ minWidth: 380 }}>Role on each company</th>
                <th style={{ width: 160, whiteSpace: 'nowrap' }}>Last signed in</th>
                <th style={{ width: 300 }} />
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <tr key={m.id}>
                  <td>
                    {editingDetails === m.id ? (
                      <div className="stack" style={{ gap: 6 }}>
                        <input value={draft.name} placeholder="Full name"
                               onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                        <input type="email" value={draft.email} placeholder="name@company.com"
                               onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
                        <div className="row">
                          <button className="btn-primary btn-sm" disabled={busy}
                                  onClick={() => run(async () => {
                                    if (draft.name.trim().length < 2) {
                                      throw new ApiError(400, 'BAD_REQUEST', 'A name is required.');
                                    }
                                    await patch(`/auth/users/${m.id}`, {
                                      name: draft.name.trim(),
                                      email: draft.email.trim().toLowerCase(),
                                    });
                                    setEditingDetails(null);
                                  }, 'Details updated.')}>Save</button>
                          <button className="btn-sm" onClick={() => setEditingDetails(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="row" style={{ gap: 9 }}>
                        <div className="avatar">{initials(m.name)}</div>
                        <div className="stack">
                          <span style={{ fontWeight: 500 }}>
                            {m.name}{m.id === user?.id && <span className="dim" style={{ fontWeight: 400 }}> · you</span>}
                          </span>
                          <span className="tiny dim">{m.email}{m.isActive ? '' : ' · deactivated'}</span>
                        </div>
                      </div>
                    )}
                  </td>
                  <td style={{ minWidth: 380 }}>
                    <RoleCell
                      member={m}
                      busy={busy}
                      onPickBase={(role) => run(
                        () => patch(`/auth/users/${m.id}`, { role }),
                        `${m.name} is now ${ROLE_LABEL[role].toLowerCase()}.`,
                      )}
                      onPickGrant={(companyId, role) => run(
                        // The endpoint replaces the grants wholesale, so the rest
                        // travel with the one that changed.
                        () => put(`/auth/users/${m.id}/access`, {
                          grants: m.companies.map((c) => ({
                            companyId: c.companyId,
                            role: c.companyId === companyId ? role : c.role,
                          })),
                        }),
                        `${m.name} is now ${ROLE_LABEL[role].toLowerCase()} on `
                          + `${m.companies.find((c) => c.companyId === companyId)?.legalName}.`,
                      )}
                    />
                  </td>
                  <td className="tiny muted" style={{ whiteSpace: 'nowrap', verticalAlign: 'top', paddingTop: 14 }}>
                    {m.lastLoginAt ? fmtDateTime(m.lastLoginAt) : 'never'}
                  </td>
                  <td className="right" style={{ whiteSpace: 'nowrap', verticalAlign: 'top', paddingTop: 10 }}>
                    <button
                      className="btn-sm"
                      onClick={() => { setEditingDetails(m.id); setDraft({ name: m.name, email: m.email }); }}
                    >
                      Edit
                    </button>
                    <button
                      className="btn-sm"
                      disabled={m.seesEveryCompany}
                      title={m.seesEveryCompany ? 'Super admins see every company — there is nothing to grant.' : undefined}
                      onClick={() => setEditing(m)}
                    >
                      Access
                    </button>
                    <button className="btn-sm" onClick={() => setResetting(m)}>Reset password</button>
                    {m.id !== user?.id && (
                      <button
                        className="btn-sm btn-ghost btn-danger"
                        disabled={busy}
                        onClick={() => run(
                          () => patch(`/auth/users/${m.id}`, { isActive: !m.isActive }),
                          `${m.name} ${m.isActive ? 'deactivated' : 'reactivated'}.`,
                        )}
                      >
                        {m.isActive ? 'Deactivate' : 'Reactivate'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Add someone" note="They can sign in immediately">
        <form className="card-body" onSubmit={submitInvite} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="grid grid-4">
            <Field label="Name">
              <input required value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} />
            </Field>
            <Field label="Email">
              <input required type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
            </Field>
            <Field label="Temporary password" hint="At least 10 characters">
              <input required minLength={10} value={invite.password} onChange={(e) => setInvite({ ...invite, password: e.target.value })} />
            </Field>
            <Field label="Role" hint={ROLE_BLURB[invite.role]}>
              <select value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value as UserRole })}>
                {ASSIGNABLE.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </Field>
          </div>

          {scoped && (
            <div className="field">
              <label>Companies they may see</label>
              {inviteError && <span className="field-error">{inviteError}</span>}
              <div className="stack" style={{ gap: 2 }}>
                {companies.map((c) => (
                  <label key={c.id} className="checklist-row">
                    <input
                      type="checkbox"
                      checked={invite.companyIds.includes(c.id)}
                      onChange={(e) => {
                        setInvite((i) => ({
                          ...i,
                          companyIds: e.target.checked
                            ? [...i.companyIds, c.id]
                            : i.companyIds.filter((x) => x !== c.id),
                        }));
                        setInviteError(null);
                      }}
                    />
                    {c.legalName}
                  </label>
                ))}
              </div>
              <span className="field-hint">
                {invite.companyIds.length === 0
                  ? 'With none selected they will sign in and see nothing until you grant access.'
                  : `${invite.companyIds.length} selected.`}
              </span>
            </div>
          )}

          <div className="row">
            <button className="btn-primary" type="submit" disabled={busy}>
              {busy ? <><Spinner /> Adding…</> : 'Add person'}
            </button>
          </div>
        </form>
      </Card>

      {resetting && (
        <ResetPasswordDrawer
          member={resetting}
          onClose={() => setResetting(null)}
          onDone={(message) => { setResetting(null); setNotice(message); reload(); }}
        />
      )}

      {editing && (
        <AccessDrawer
          member={editing}
          companies={companies}
          onClose={() => setEditing(null)}
          onSaved={(message) => { setEditing(null); setNotice(message); reload(); }}
        />
      )}
    </>
  );
}
