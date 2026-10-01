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
  AuthorityTag, Badge, BUSINESS_TYPE_LABEL, Card, Drawer, Empty, ENTITY_LABEL, ErrorNote, Loading,
  SeverityDot, Spinner, fmtDate, fmtINR,
} from '../components/ui';

/**
 * The applicability endpoint answers in one of two shapes.
 *
 * The Express API flattens it — ruleCode, title, authority, severity, form
 * alongside `applicable` and `reasons`. The Supabase edge function returned
 * `evaluateAll()` raw, which nests all of that under `.rule`. Against the raw
 * shape every field this drawer renders came through undefined, so each card
 * showed a bare condition label and nothing else; the ten MCA rules whose only
 * condition is the entity type then looked like the same rule repeated ten
 * times, when they are ADT-1, DIR-12, PAS-3, CHG-1, MGT-14 and the rest.
 *
 * The edge function has been corrected, but it is deployed separately, so the
 * client reads both rather than depending on that having happened.
 */
function normaliseApplicability(row: unknown): Applicability {
  const r = row as Record<string, any>;
  if (!r?.rule) return r as Applicability;

  const rule = r.rule as Record<string, any>;
  return {
    ruleCode: rule.code,
    applicable: r.applicable,
    reasons: r.reasons ?? [],
    evaluatedAt: r.evaluatedAt ?? '',
    title: rule.title,
    authority: rule.authority ?? null,
    category: rule.category ?? null,
    severity: rule.severity ?? null,
    form: rule.form ?? null,
  };
}

function ApplicabilityDrawer({ company, onClose }: { company: Company; onClose: () => void }) {
  const { data, initial, error } = useResource<Applicability[]>(`/compliance/companies/${company.id}/applicability`);
  const [showAll, setShowAll] = useState(false);

  const rows = (data ?? [])
    .map(normaliseApplicability)
    .filter((r) => showAll || r.applicable)
    // Applicable first, then by code, whichever end answered.
    .sort((a, b) => Number(b.applicable) - Number(a.applicable) || (a.ruleCode ?? '').localeCompare(b.ruleCode ?? ''));

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
                <span style={{ fontWeight: 550 }}>{r.title || r.ruleCode || 'Unnamed rule'}</span>
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
/**
 * One row of the overview, whichever shape the server sent.
 *
 * An older edge function returns only id/legalName/entityType/createdAt, which
 * left `status` undefined — and `status === 'ACTIVE'` being false then reported
 * every live company as Archived. Absence of the field is not evidence of
 * archival, so it is read from `isActive` where that is present and treated as
 * active otherwise; a company genuinely archived always says so explicitly.
 */
function normaliseOnboarded(row: unknown): OnboardedCompany {
  const r = row as Record<string, any>;
  const org = Array.isArray(r.organization) ? r.organization[0] : r.organization;
  return {
    ...r,
    status: r.status ?? (r.isActive === false ? 'ARCHIVED' : 'ACTIVE'),
    onboardedAt: r.onboardedAt ?? r.createdAt ?? null,
    onboardedBy: r.onboardedBy ?? null,
    organization: org ?? { id: '', name: '—', slug: '' },
  } as OnboardedCompany;
}

/** A trial that has run out — the point at which archiving becomes offerable. */
function trialEnded(c: OnboardedCompany): boolean {
  const ends = c.organization?.trialEndsAt;
  return Boolean(ends && new Date(ends).getTime() < Date.now());
}

function OnboardingOverview() {
  const { data: raw, initial, error, loading, reload } = useResource<OnboardedCompany[]>('/companies/onboarded-overview');
  const { can } = useAuth();
  const [archiving, setArchiving] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const data = raw?.map(normaliseOnboarded);

  async function archive(c: OnboardedCompany) {
    setArchiving(c.id);
    setActionError(null);
    try {
      await del(`/companies/${c.id}`);
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not archive that company.');
    } finally {
      setArchiving(null);
    }
  }

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
                  <td>
                    <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                      <Badge value={c.status === 'ACTIVE' ? 'COMPLETED' : 'WAIVED'}>
                        {c.status === 'ACTIVE' ? 'Active' : 'Archived'}
                      </Badge>
                      {c.status === 'ACTIVE' && trialEnded(c) && (
                        <span className="tiny" style={{ color: 'var(--high)', fontWeight: 600 }}>
                          Trial ended {fmtDate(c.organization.trialEndsAt!)}
                        </span>
                      )}
                      {/* Archiving is offered only where it is actually
                          available: a live company whose trial has run out, and
                          only to a role that may archive. */}
                      {c.status === 'ACTIVE' && trialEnded(c) && can('company.archive') && (
                        <button
                          className="btn-sm"
                          disabled={archiving === c.id}
                          onClick={() => void archive(c)}
                        >
                          {archiving === c.id ? <><Spinner /> Archiving…</> : 'Archive'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {actionError && <ErrorNote error={actionError} />}
      <div className="row" style={{ marginTop: 10, gap: 10, alignItems: 'center' }}>
        {/* This always refetched — `reload` bumps the hook's nonce — but said
            nothing while it did, and the rows came back identical, so it read
            as a dead button. */}
        <button className="btn-sm" onClick={reload} disabled={loading}>
          {loading ? <><Spinner /> Refreshing…</> : 'Refresh'}
        </button>
        {loading && <span className="tiny dim">Fetching the latest…</span>}
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
  // Only for the fallback below, when the server cannot answer for itself.
  const { canOn } = useCompanies();

  /* The same answer the invite form uses, rather than a second guess from
     'work.write' plus a trial check of its own — which is how the button could
     be enabled for someone the server would refuse, and disabled for a CA who
     is in fact allowed to invite. */
  const { data: invitePermission, error: invitePermissionError } = useResource<
    { canInvite: boolean; roles: string[]; reason: string }
  >(`/companies/${company.id}/invite-permission`, [company.id]);

  /* If that endpoint is unavailable — an API that predates it, which is every
     deployment until companies-api ships — fall back to the old client-side
     test rather than hiding the button. Gating the *render* on the response is
     what made this disappear entirely: a feature must not vanish because a new
     endpoint 404s. The server checks the invite itself either way. */
  const permissionUnavailable = Boolean(invitePermissionError);
  const mayInvite = invitePermission
    ? invitePermission.canInvite
    : permissionUnavailable && canOn(company.id, 'work.write') && !onTrial;
  const inviteReason = invitePermission?.reason
    || (onTrial ? 'Inviting team members is available after upgrading from the trial.' : '');

  return (
    <div className="team">
      <div className="team-head">
        <span className="team-title">Team</span>
        {notice && <span className="tiny dim team-notice">{notice}</span>}
        <span className="spacer" style={{ marginLeft: 'auto' }}>
          {(invitePermission || permissionUnavailable) && (
            <button
              className="btn-sm btn-ghost"
              disabled={!mayInvite}
              title={mayInvite
                ? (invitePermission
                    ? `Add someone to this company as ${invitePermission.roles.join(', ')}`
                    : 'Add someone to this company')
                : inviteReason}
              onClick={() => setInviting(true)}
            >
              + Add team member
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
            <div key={m.member?.id || m.member?.email} className="team-row" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <span className="avatar team-avatar">{initials(m.member?.name || 'User')}</span>
              <div className="stack" style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                  <span className="truncate" style={{ fontWeight: 550, fontSize: 13.5 }}>
                    {m.member?.name || 'Team Member'}
                  </span>
                  <Badge value={m.invitationStatus === 'ACTIVE' || m.member?.isActive ? 'COMPLETED' : 'WAIVED'}>
                    {m.invitationStatus === 'ACTIVE' || m.member?.isActive ? 'Active' : 'Pending'}
                  </Badge>
                </div>
                <span className="tiny dim truncate">{m.member?.email} {m.invitedBy?.name ? `· invited by ${m.invitedBy.name}` : ''}</span>
              </div>
              <span className="badge badge-outline" style={{ fontSize: 11.5 }}>
                {ROLE_LABEL[m.role as UserRole] ?? m.role}
              </span>
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
  const { companies, loading, reload, select, canOn } = useCompanies();
  const { can, user } = useAuth();
  const [showArchived, setShowArchived] = useState(false);
  const [deleting, setDeleting] = useState<Company | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');

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
  const [showEvents, setShowEvents] = useState<boolean>(false);
  const [selectedEventType, setSelectedEventType] = useState<string | null>(null);
  const [selectedEventDate, setSelectedEventDate] = useState<string | null>(null);
  const [selectedMetadata, setSelectedMetadata] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

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

  async function submitEvent() {
    if (!selectedEventType || !selectedEventDate) return;
    setSubmitting(true);
    setError(null);
    try {
      await post(`/companies/${showEvents}/events`, {
        eventType: selectedEventType,
        eventDate: selectedEventDate,
        metadata: selectedMetadata,
      });
      setShowEvents(false);
      setSelectedEventType(null);
      setSelectedEventDate(null);
      setSelectedMetadata('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to log event');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && companies.length === 0) return <Loading label="Loading companies" />;

  const filteredCompanies = companies.filter(c => c.legalName.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <div className="row">
        <span className="muted tiny">
          The engine reads these profiles. Turnover, headcount and the flags below move real statutory thresholds.
        </span>
        <span className="row" style={{ marginLeft: 'auto', gap: 16 }}>
          <input 
            type="text" 
            placeholder="Search companies..." 
            value={search} 
            onChange={(e) => setSearch(e.target.value)} 
            style={{ padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 4, width: 220 }} 
          />
          {can('company.archive') && (
            <label className="check tiny" style={{ margin: 0 }}>
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
      ) : filteredCompanies.length === 0 ? (
        <Empty>No companies found matching "{search}".</Empty>
      ) : (
        <div className="grid grid-2">
          {filteredCompanies.map((c) => (
            <Card key={c.id} title={c.legalName}
              note={[ENTITY_LABEL[c.entityType] ?? c.entityType, c.businessType ? BUSINESS_TYPE_LABEL[c.businessType] : null]
                .filter(Boolean).join(' · ')}>
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
                  <button
                    className="btn-sm"
                    onClick={() => setShowEvents(true)}
                  >
                    Events
                  </button>
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
                  {canOn(c.id, 'company.delete') && (
                    <button className="btn-sm btn-ghost btn-danger" onClick={() => setDeleting(c)}>
                      Delete permanently
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
                          <span className="tiny dim">{ENTITY_LABEL[c.entityType]}
                          {c.businessType ? ` · ${BUSINESS_TYPE_LABEL[c.businessType]}` : ''}
                          {' · '}{c.cin ?? c.llpin ?? '—'}</span>
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

  {showEvents && (
    <div style={{
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: '92%',
      maxWidth: '520px',
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: '8px',
      boxShadow: 'var(--shadow-lg)',
      zIndex: 1000,
      padding: '24px',
      color: 'var(--text)',
      overflowY: 'auto'
    }}>
      <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
        Log Compliance Event
      </h3>

      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>Event Type</label>
        <select
          style={{ width: '100%', padding: '8px', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '14px', background: 'var(--surface)' }}
          onChange={(e) => setSelectedEventType(e.target.value)}
        >
          <option value="">Select event type</option>
          <option value="DIR-12">DIR-12 — Director/KMP change</option>
          <option value="PAS-3">PAS-3 — Share allotment</option>
          <option value="CHG-1">CHG-1 — Charge creation/modification</option>
          <option value="MGT-14">MGT-14 — Resolution filing</option>
        </select>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>Event Date</label>
        <input
          style={{ width: '100%', padding: '8px', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '14px', background: 'var(--surface)' }}
          type="date"
          onChange={(e) => setSelectedEventDate(e.target.value)}
        />
      </div>

      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>Metadata (optional)</label>
        <input
          style={{ width: '100%', padding: '8px', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '14px', background: 'var(--surface)' }}
          placeholder="e.g. director name, share class, charge amount"
          value={selectedMetadata || ''}
          onChange={(e) => setSelectedMetadata(e.target.value)}
        />
      </div>

      <div style={{ textAlign: 'right', marginTop: '20px' }}>
        <button
          style={{ marginRight: '8px', background: 'var(--surface-2)', border: '1px solid var(--border)', padding: '8px 16px', fontSize: '14px', color: 'var(--text)' }}
          onClick={() => setShowEvents(false)}
        >
          Cancel
        </button>
        <button
          className="btn-primary"
          style={{ padding: '8px 16px', fontSize: '14px' }}
          onClick={() => submitEvent()}
        >
          {submitting ? 'Logging…' : 'Log Event'}
        </button>
      </div>

      <div style={{ marginTop: '12px', fontSize: '12px', color: 'var(--text-2)' }}>
        Due in 30 days: <span style={{ color: 'var(--medium)' }}>calculated from event date</span>
      </div>
    </div>
  )}

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
