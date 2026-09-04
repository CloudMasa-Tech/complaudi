import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, del, post, qs } from '../api/client';
import { useResource } from '../api/useResource';
import { useAuth } from '../auth/AuthContext';
import { useCompanies } from '../auth/CompanyContext';
import { InviteMemberModal } from '../components/InviteMemberModal';
import type { Applicability, Company, CompanyMember, OnboardedCompany, SyncResult, UserRole } from '../api/types';
import { ROLE_LABEL } from '../api/types';
import {
  AuthorityTag, Badge, Card, Drawer, Empty, ENTITY_LABEL, ErrorNote, Loading,
  SeverityDot, Spinner, fmtDate, fmtINR,
} from '../components/ui';

function ApplicabilityDrawer({ company, onClose }: { company: Company; onClose: () => void }) {
  const { data, initial, error } = useResource<Applicability[]>(`/compliance/companies/${company.id}/applicability`);
  const [showAll, setShowAll] = useState(false);

  const rows = (data ?? []).filter((r) => showAll || r.applicable);

  return (
    <Drawer onClose={onClose}>
      <header className="drawer-head">
        <div className="stack" style={{ flex: 1, gap: 4 }}>
          <h2 style={{ fontSize: 16 }}>{company.legalName}</h2>
          <span className="tiny dim">
            {data ? `${data.filter((r) => r.applicable).length} of ${data.length} rules apply` : 'Evaluating…'}
          </span>
        </div>
        <button className="btn-ghost btn-sm" onClick={onClose}>✕</button>
      </header>

      <div className="drawer-body">
        {error && <ErrorNote error={error} />}
        {initial && <Loading />}

        <label className="check">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Show rules that do not apply, and why
        </label>

        {rows.map((r) => {
          // Only the conditions that actually decided a "no" are worth showing.
          const deciding = r.reasons.filter((x) => (x.negated ? x.passed : !x.passed));
          return (
            <div key={r.ruleCode} className="card">
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="row" style={{ gap: 7 }}>
                  {r.severity && <SeverityDot value={r.severity} />}
                  {r.authority && <AuthorityTag value={r.authority} />}
                  {r.form && <span className="auth-tag">{r.form}</span>}
                  <span className="spacer" style={{ marginLeft: 'auto' }}>
                    <Badge value={r.applicable ? 'COMPLETED' : 'WAIVED'}>
                      {r.applicable ? 'Applies' : 'Not applicable'}
                    </Badge>
                  </span>
                </div>
                <span style={{ fontWeight: 550 }}>{r.title}</span>
                <div className="reasons">
                  {(r.applicable ? r.reasons : deciding).map((x, i) => {
                    const ok = x.negated ? !x.passed : x.passed;
                    return (
                      <div key={i} className="reason">
                        <span className={`reason-mark ${ok ? 'reason-pass' : 'reason-fail'}`}>{ok ? '✓' : '✕'}</span>
                        <span className={ok ? '' : 'muted'}>{x.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Drawer>
  );
}

interface Impact {
  company: { id: string; legalName: string; isActive: boolean };
  items: number; completed: number; documents: number; tasks: number;
}

/**
 * Permanent deletion destroys a company's entire compliance history, so it is
 * gated behind seeing exactly what will go and typing the name back.
 */
function DeleteDialog({ company, onClose, onDeleted }: {
  company: Company; onClose: () => void; onDeleted: (name: string) => void;
}) {
  const { data: impact, initial } = useResource<Impact>(`/companies/${company.id}/deletion-impact`);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = confirmation.trim() === company.legalName;

  return (
    <Drawer onClose={onClose}>
      <header className="drawer-head">
        <div className="stack" style={{ flex: 1, gap: 4 }}>
          <h2 style={{ fontSize: 16 }}>Delete {company.legalName}</h2>
          <span className="tiny dim">This cannot be undone.</span>
        </div>
        <button className="btn-ghost btn-sm" onClick={onClose}>✕</button>
      </header>

      <div className="drawer-body">
        {error && <ErrorNote error={error} />}
        {initial && <Loading />}

        {impact && (
          <div className="alert alert-error">
            <strong>This permanently destroys:</strong>
            <div style={{ marginTop: 6 }}>
              · {impact.items} obligations, {impact.completed} of them already completed<br />
              · {impact.tasks} tasks<br />
              · {impact.documents} evidence files, deleted from storage as well<br />
              · the company's score history and applicability record
            </div>
            <div style={{ marginTop: 8 }}>
              The audit log entry recording this deletion is kept against the organization.
            </div>
          </div>
        )}

        <div className="alert alert-warn">
          Archiving instead keeps all of the above and hides the company from every view. Prefer it unless the
          record genuinely must not exist.
        </div>

        <div className="field">
          <label>Type <strong>{company.legalName}</strong> to confirm</label>
          <input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} placeholder={company.legalName} />
        </div>

        <div className="row">
          <button
            className="btn-danger"
            disabled={busy || !matches}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await post(`/companies/${company.id}/permanent-delete`, { confirmation: confirmation.trim() });
                onDeleted(company.legalName);
              } catch (err) {
                setError(err instanceof ApiError ? err.message : 'Delete failed');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <><Spinner /> Deleting…</> : 'Permanently delete'}
          </button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Drawer>
  );
}

/**
 * Platform-wide onboarding view, shown only to the SUPER_ADMIN.
 *
 * Feeds off a deliberately slim endpoint that carries none of a company's
 * private profile — just who onboarded it, when, and which organisation it
 * landed in.
 */
function OnboardingOverview() {
  const { data, initial, error, reload } = useResource<OnboardedCompany[]>('/companies/onboarded-overview');

  return (
    <Card title="Onboarded (all organisations)" note={`${data?.length ?? 0} companies`}>
      {error && <ErrorNote error={error} />}
      {initial && <Loading />}
      {data && data.length === 0 && <Empty>No companies have onboarded yet.</Empty>}
      {data && data.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th>Organisation</th>
                <th>Onboarded by</th>
                <th>When</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id}>
                  <td>
                    <span style={{ fontWeight: 500 }}>{c.legalName}</span>
                    <div className="tiny dim">{ENTITY_LABEL[c.entityType] ?? c.entityType}</div>
                  </td>
                  <td>
                    {c.organization.name}
                    <div className="tiny dim">{c.organization.slug}</div>
                  </td>
                  <td>
                    {c.onboardedBy ? (
                      <>
                        <span>{c.onboardedBy.name}</span>
                        <div className="tiny dim">{c.onboardedBy.email}</div>
                      </>
                    ) : (
                      <span className="dim">—</span>
                    )}
                  </td>
                  <td>{fmtDate(c.onboardedAt)}</td>
                  <td><Badge value={c.status}>{c.status === 'ACTIVE' ? 'Active' : 'Archived'}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn-sm" onClick={reload}>Refresh</button>
      </div>
    </Card>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase())
    .slice(0, 2)
    .join('');
}

/**
 * The company's own team — everyone with a grant on it. The owner can invite a
 * CA or admin straight from here; during a trial the action is locked with a
 * note to upgrade first.
 */
function TeamSection({ company, onTrial }: { company: Company; onTrial: boolean }) {
  const { data: members, initial, error, reload } = useResource<CompanyMember[]>(
    `/companies/${company.id}/members`,
    [company.id],
  );
  const [inviting, setInviting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { canOn } = useCompanies();

  const mayInvite = canOn(company.id, 'work.write');

  return (
    <div className="team">
      <div className="team-head">
        <span className="team-title">Team</span>
        {notice && <span className="tiny dim team-notice">{notice}</span>}
        <span className="spacer" style={{ marginLeft: 'auto' }}>
          {mayInvite && (
            <button
              className="btn-sm btn-ghost"
              disabled={onTrial}
              title={onTrial ? 'Available after upgrade' : 'Invite a CA or admin to work this company'}
              onClick={() => setInviting(true)}
            >
              + Invite CA/Admin
            </button>
          )}
        </span>
      </div>

      {error && <ErrorNote error={error} />}
      {initial && <div className="tiny dim" style={{ padding: '4px 0' }}>Loading team…</div>}

      {members && members.length === 0 && (
        <div className="tiny dim" style={{ padding: '4px 0' }}>
          No team members yet{onTrial ? '. Inviting is available after upgrade.' : '.'}
        </div>
      )}

      {members && members.length > 0 && (
        <div className="team-list">
          {members.map((m) => (
            <div key={m.member.id} className="team-row">
              <span className="avatar team-avatar">{initials(m.member.name)}</span>
              <div className="stack" style={{ flex: 1, minWidth: 0 }}>
                <span className="truncate" style={{ fontWeight: 550 }}>
                  {m.member.name}
                  {!m.member.isActive && <span className="dim"> · deactivated</span>}
                </span>
                <span className="tiny dim truncate">{m.member.email}</span>
              </div>
              <span className="tiny">{ROLE_LABEL[m.role as UserRole] ?? m.role}</span>
              {m.member.isActive
                ? <span className="team-status team-active" title="Active">✓</span>
                : <span className="team-status team-inactive" title="Inactive">—</span>}
            </div>
          ))}
        </div>
      )}

      {inviting && (
        <InviteMemberModal
          companyId={company.id}
          onInvited={() => {
            setNotice('Invite sent');
            setInviting(false);
            reload();
          }}
          onClose={() => setInviting(false)}
        />
      )}
    </div>
  );
}

export function Companies() {
  const { can, user } = useAuth();
  const { companies, loading, reload, select, canOn } = useCompanies();
  const [showArchived, setShowArchived] = useState(false);
  const [deleting, setDeleting] = useState<Company | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Onboarding is the only company action with no company in hand, so it is the
  // only one gated on the base role. Everything else is decided per company,
  // because the grant is authoritative.
  const canCreate = can('company.create');

  // Archived companies are excluded from every org-wide view, so they need a
  // deliberate way back into sight.
  const { data: archived, reload: reloadArchived } = useResource<Company[]>(
    showArchived ? `/companies${qs({ includeInactive: true })}` : null,
    [showArchived],
  );
  const archivedOnly = (archived ?? []).filter((c) => !c.isActive);

  async function act(label: string, fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      reload();
      reloadArchived();
      setNotice(label);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work');
    }
  }
  const [syncing, setSyncing] = useState<string | null>(null);
  const [result, setResult] = useState<{ name: string; sync: SyncResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inspect, setInspect] = useState<Company | null>(null);

  async function sync(company: Company) {
    setSyncing(company.id);
    setError(null);
    try {
      const sync = await post<SyncResult>(`/compliance/companies/${company.id}/sync`);
      setResult({ name: company.legalName, sync });
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sync failed');
    } finally {
      setSyncing(null);
    }
  }

  if (loading && companies.length === 0) return <Loading label="Loading companies" />;

  return (
    <>
      <div className="row">
        <span className="muted tiny">
          The engine reads these profiles. Turnover, headcount and the flags below move real statutory thresholds.
        </span>
        <span className="row" style={{ marginLeft: 'auto' }}>
          {can('company.archive') && (
            <label className="check tiny">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
              Show archived
            </label>
          )}
          {canCreate && <Link className="btn btn-primary" to="/companies/new">Onboard a company</Link>}
        </span>
      </div>

      {error && <ErrorNote error={error} />}
      {notice && <div className="alert alert-info">{notice}</div>}
      {result && (
        <div className="alert alert-info">
          <strong>{result.name} re-synced.</strong>{' '}
          {result.sync.applicableRules} rules apply, {result.sync.inapplicableRules} do not ·{' '}
          {result.sync.created} new obligations, {result.sync.updated} updated, {result.sync.removed} withdrawn.
        </div>
      )}

      {companies.length === 0 ? (
        <Card><Empty>No companies yet. Onboard one to build its compliance calendar.</Empty></Card>
      ) : (
        <div className="grid grid-2">
          {companies.map((c) => (
            <Card key={c.id} title={c.legalName} note={ENTITY_LABEL[c.entityType] ?? c.entityType}>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <dl className="kv">
                  <dt>{c.entityType === 'LLP' ? 'LLPIN' : 'CIN'}</dt>
                  <dd className="mono">{c.llpin ?? c.cin ?? '—'}</dd>
                  <dt>PAN / TAN</dt>
                  <dd className="mono">{c.pan ?? '—'} {c.tan ? `· ${c.tan}` : ''}</dd>
                  <dt>Turnover</dt>
                  <dd><strong>{fmtINR(c.annualTurnover)}</strong> · capital {fmtINR(c.paidUpCapital)}</dd>
                  <dt>People</dt>
                  <dd>{c.employeeCount} employees · {c.directors.length} director{c.directors.length === 1 ? '' : 's'}</dd>
                  <dt>State</dt>
                  <dd>{c.stateCode}{c.industry ? ` · ${c.industry}` : ''}</dd>
                  <dt>Incorporated</dt>
                  <dd>{fmtDate(c.incorporationDate)}{c.agmDate ? ` · AGM ${fmtDate(c.agmDate)}` : ''}</dd>
                </dl>

                <div className="row row-wrap" style={{ gap: 6 }}>
                  {c.gstRegistrations.map((g) => (
                    <span key={g.id} className="auth-tag" title={`${g.stateCode} · ${g.filingFrequency}`}>
                      {g.gstin} · {g.filingFrequency}
                    </span>
                  ))}
                  {c.msmeRegistration && <span className="auth-tag">Udyam · {c.msmeRegistration.category}</span>}
                  {c.hasForeignTransactions && <span className="auth-tag">Transfer pricing</span>}
                  {c.acceptsDeposits && <span className="auth-tag">DPT-3</span>}
                  {c.buysFromMsmeSuppliers && <span className="auth-tag">MSME suppliers</span>}
                </div>

                <TeamSection company={c} onTrial={user?.trialDaysLeft !== null && user?.trialDaysLeft !== undefined} />

                <div className="row row-wrap">
                  <button className="btn-sm" onClick={() => setInspect(c)}>Which rules apply?</button>
                  {canOn(c.id, 'company.sync') && (
                    <button className="btn-sm" disabled={syncing === c.id} onClick={() => sync(c)}>
                      {syncing === c.id ? <><Spinner /> Syncing</> : 'Re-run engine'}
                    </button>
                  )}
                  {canOn(c.id, 'company.edit') && (
                    <Link className="btn btn-sm" to={`/companies/${c.id}/edit`}>Edit</Link>
                  )}
                  {canOn(c.id, 'company.archive') && (
                    <button
                      className="btn-sm btn-ghost btn-danger"
                      onClick={() => act(`${c.legalName} archived. Its history is kept and it can be restored.`,
                        () => del(`/companies/${c.id}`))}
                    >
                      Archive
                    </button>
                  )}
                  <Link className="btn btn-sm" to="/calendar" onClick={() => select(c.id)} style={{ marginLeft: 'auto' }}>
                    Calendar →
                  </Link>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {user?.seesEveryCompany && <OnboardingOverview />}

      {showArchived && (
        <Card title="Archived" note={`${archivedOnly.length} hidden from every other view`}>
          {archivedOnly.length === 0 ? (
            <Empty>Nothing archived.</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <tbody>
                  {archivedOnly.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <div className="stack">
                          <span style={{ fontWeight: 500 }}>{c.legalName}</span>
                          <span className="tiny dim">{ENTITY_LABEL[c.entityType]} · {c.cin ?? c.llpin ?? '—'}</span>
                        </div>
                      </td>
                      <td className="right" style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn-sm" onClick={() => act(`${c.legalName} restored.`,
                          () => post(`/companies/${c.id}/restore`))}>Restore</button>
                        {canOn(c.id, 'company.delete') && (
                          <button className="btn-sm btn-ghost btn-danger" onClick={() => setDeleting(c)}>
                            Delete permanently
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {inspect && <ApplicabilityDrawer company={inspect} onClose={() => setInspect(null)} />}
      {deleting && (
        <DeleteDialog
          company={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={(name) => {
            setDeleting(null);
            setNotice(`${name} was permanently deleted.`);
            reload();
            reloadArchived();
          }}
        />
      )}
    </>
  );
}
