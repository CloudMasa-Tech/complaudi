import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, patch, qs } from '../api/client';
import { useResource } from '../api/useResource';
import { useAuth } from '../auth/AuthContext';
import { useCompanies } from '../auth/CompanyContext';
import type { CompanyMember, Paged, Task, TaskStatus } from '../api/types';
import { ItemDrawer } from '../components/ItemDrawer';
import { InviteMemberModal } from '../components/InviteMemberModal';
import {
  AuthorityTag, Card, Empty, ErrorNote, Loading, SeverityDot,
  Spinner, fmtDate, relativeDue, titleise,
} from '../components/ui';

const STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED'];

export function Tasks() {
  const { selectedId, canOn } = useCompanies();
  const { user } = useAuth();
  // Inviting a team member is a full-account feature.
  const onTrial = user?.trialDaysLeft !== null && user?.trialDaysLeft !== undefined;
  // The dashboard tiles link here with the filter they were counting, so the
  // list that opens is the same work the number named. Read once, on arrival:
  // from then on the controls own the filter.
  const [params] = useSearchParams();
  const [status, setStatus] = useState(params.get('status') || 'TODO,IN_PROGRESS,BLOCKED');
  const [assignee, setAssignee] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(params.get('overdue') === '1');
  const [dueWindow, setDueWindow] = useState<{ from: string; to: string } | null>(() => {
    const from = params.get('from');
    const to = params.get('to');
    return from && to ? { from, to } : null;
  });
  const [search, setSearch] = useState('');
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [gateError, setGateError] = useState<{ task: Task; message: string } | null>(null);
  // Which company the user is inviting into, driving the shared invite modal.
  const [invite, setInvite] = useState<{ companyId: string; task?: Task } | null>(null);

  // Only people who can actually reach this company — not the whole organisation.
  const { data: people, reload: reloadPeople } = useResource<
    { id: string; name: string; role: string }[]
  >(`/tasks/assignable${qs({ companyId: selectedId ?? undefined })}`, [selectedId]);

  const path = `/tasks${qs({
    companyId: selectedId ?? undefined,
    status: status || undefined,
    assigneeId: assignee && assignee !== 'none' ? assignee : undefined,
    unassignedOnly: assignee === 'none' ? true : undefined,
    overdueOnly: overdueOnly || undefined,
    from: dueWindow?.from,
    to: dueWindow?.to,
    search: search || undefined,
    pageSize: 100,
  })}`;

  const { data, error, initial, loading, reload } = useResource<Paged<Task>>(path, [selectedId]);
  const { data: workload, reload: reloadWorkload } = useResource<
    { assignee: { id: string; name: string } | null; counts: Record<string, number>; total: number }[]
  >(`/tasks/workload${qs({ companyId: selectedId ?? undefined })}`, [selectedId]);

  async function change(task: Task, body: Record<string, unknown>) {
    setSavingId(task.id);
    setGateError(null);
    try {
      await patch(`/tasks/${task.id}`, body);
      reload();
      reloadWorkload();
    } catch (err) {
      // Closing a gated obligation from here is refused by the server. Say why,
      // and send them to the drawer where the evidence can actually be attached.
      if (err instanceof ApiError && err.status === 422) {
        setGateError({ task, message: err.message });
      } else {
        setGateError({ task, message: err instanceof ApiError ? err.message : 'That did not work' });
      }
      reload();
    } finally {
      setSavingId(null);
    }
  }

  async function onInvited(member: CompanyMember) {
    reloadPeople();
    if (invite?.task && member.member.id) {
      try {
        await patch(`/tasks/${invite.task.id}`, { assigneeId: member.member.id });
        reload();
        reloadWorkload();
      } catch {
        reload();
      }
    }
    setInvite(null);
  }

  return (
    <>
      {workload && workload.length > 0 && (
        <Card title="Open work by owner">
          <div className="card-body row row-wrap" style={{ gap: 10 }}>
            {workload.map((w) => (
              <button
                key={w.assignee?.id ?? 'none'}
                className={assignee === (w.assignee?.id ?? 'none') ? 'btn-primary' : ''}
                onClick={() => setAssignee(assignee === (w.assignee?.id ?? 'none') ? '' : (w.assignee?.id ?? 'none'))}
              >
                {w.assignee?.name ?? 'Unassigned'}
                <span className="nav-count" style={{ marginLeft: 2 }}>{w.total}</span>
              </button>
            ))}
          </div>
        </Card>
      )}

      <div className="card">
        <div className="card-body filters">
          <div className="field grow">
            <label>Search</label>
            <input placeholder="Task title…" defaultValue={search} onBlur={(e) => setSearch(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter') setSearch((e.target as HTMLInputElement).value); }} />
          </div>
          <div className="field">
            <label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="TODO,IN_PROGRESS,BLOCKED">Open</option>
              <option value="">All</option>
              {STATUSES.map((s) => <option key={s} value={s}>{titleise(s)}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Owner</label>
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Anyone</option>
              <option value="none">Unassigned</option>
              {(people ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ justifyContent: 'flex-end' }}>
            <label className="check">
              <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
              Overdue only
            </label>
          </div>
        </div>

        {/* A date window has no control of its own, so it says so — an unexplained
            short list is worse than no filter at all. */}
        {dueWindow && (
          <div className="card-body" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            <span className="row tiny muted" style={{ gap: 8 }}>
              Due between {fmtDate(dueWindow.from)} and {fmtDate(dueWindow.to)}
              <button className="btn-ghost btn-sm" onClick={() => setDueWindow(null)}>Clear</button>
            </span>
          </div>
        )}
      </div>

      {error && <ErrorNote error={error} />}

      {gateError && (
        <div className="alert alert-warn">
          <strong>{gateError.task.title} could not be closed.</strong> {gateError.message}{' '}
          <a href="#" onClick={(e) => { e.preventDefault(); setOpenItemId(gateError.task.complianceItem.id); setGateError(null); }}>
            Open it to attach evidence →
          </a>
        </div>
      )}

      {initial && <Loading label="Loading tasks" />}

      {data && (
        <Card title="Tasks" note={`${data.total} matching`} action={loading ? <Spinner /> : undefined}>
          {data.rows.length === 0 ? (
            <Empty>No tasks match these filters.</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Due</th><th>Task</th><th>Authority</th><th>Owner</th><th>Progress</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((t) => {
                    const done = t.checklist.filter((c) => c.done).length;
                    const overdue = t.status !== 'DONE' && t.status !== 'CANCELLED' && new Date(t.dueDate) < new Date();
                    return (
                      <tr key={t.id}>
                        <td style={{ width: 120, whiteSpace: 'nowrap' }}>
                          <div className="stack">
                            <span style={{ fontWeight: 550 }}>{fmtDate(t.dueDate)}</span>
                            <span className="tiny" style={{ color: overdue ? 'var(--critical)' : 'var(--text-3)' }}>
                              {relativeDue(t.dueDate)}
                            </span>
                          </div>
                        </td>
                        <td className="clickable" onClick={() => setOpenItemId(t.complianceItem.id)}>
                          <div className="row" style={{ gap: 7 }}>
                            <SeverityDot value={t.complianceItem.severity} />
                            <div className="stack" style={{ minWidth: 0 }}>
                              <span style={{ fontWeight: 500 }}>{t.title}</span>
                              <span className="tiny dim">
                                {t.complianceItem.periodLabel}
                                {t.complianceItem.form ? ` · ${t.complianceItem.form}` : ''}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td style={{ width: 96 }}><AuthorityTag value={t.complianceItem.authority} /></td>
                        <td style={{ width: 160 }}>
                          <select
                            value={t.assignee?.id ?? ''}
                            disabled={savingId === t.id || !canOn(t.companyId, 'work.write')}
                            onChange={(e) => {
                              if (e.target.value === 'invite') {
                                setInvite({ companyId: t.companyId, task: t });
                              } else {
                                change(t, { assigneeId: e.target.value || null });
                              }
                            }}
                          >
                            <option value="">Unassigned</option>
                            {(people ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                            <option value="invite" disabled={onTrial} title={onTrial ? 'Available after upgrade' : 'Invite a CA or admin to work this company'}>
                              + Invite CA/Admin
                            </option>
                          </select>
                        </td>
                        <td style={{ width: 108 }} className="tiny muted">
                          {t.checklist.length > 0 ? `${done}/${t.checklist.length}` : '—'}
                          {t._count?.documents ? <span className="dim"> · ❐{t._count.documents}</span> : null}
                          {!t._count?.documents && t.complianceItem.evidenceLevel !== 'NONE' && (
                            <span
                              className="dim"
                              title={
                                t.complianceItem.evidenceLevel === 'REQUIRED'
                                  ? 'A document must be attached before this can be completed'
                                  : 'Needs a document or a recorded declaration'
                              }
                            >
                              {' '}· {t.complianceItem.evidenceLevel === 'REQUIRED' ? '🔒' : '✎'}
                            </span>
                          )}
                        </td>
                        <td style={{ width: 148 }}>
                          <select
                            value={t.status}
                            disabled={savingId === t.id || !canOn(t.companyId, 'work.write')}
                            onChange={(e) => change(t, { status: e.target.value })}
                          >
                            {STATUSES.map((s) => <option key={s} value={s}>{titleise(s)}</option>)}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {openItemId && (
        <ItemDrawer itemId={openItemId} onClose={() => setOpenItemId(null)}
                    onChanged={() => { reload(); reloadWorkload(); }} />
      )}

      {invite && (
        <InviteMemberModal
          companyId={invite.companyId}
          onInvited={onInvited}
          onClose={() => setInvite(null)}
        />
      )}
    </>
  );
}
