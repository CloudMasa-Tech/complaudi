import { useRef, useState } from 'react';
import { useCompanies } from '../auth/CompanyContext';
import { ApiError, del, download, patch, post, upload } from '../api/client';
import { useResource } from '../api/useResource';
import type { ComplianceItem, DocumentRow, EvidenceLevel, Reason, Task } from '../api/types';
import {
  AuthorityTag, Badge, Drawer, ErrorNote, Loading, SeverityDot,
  fmtBytes, fmtDate, fmtDateTime, relativeDue, titleise,
} from './ui';

interface Detail extends ComplianceItem {
  company: { id: string; legalName: string };
  task: Task | null;
  documents: DocumentRow[];
}

interface Explanation {
  rule: { code: string; description: string; penalty: string; periodKind: string; signatoryRequired?: boolean };
  applicable: boolean;
  reasons: Reason[];
}

const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED'] as const;

const MIN_ATTESTATION = 10;

/**
 * What the gate will ask for. Mirrors src/engine/gate.ts — the server is the
 * authority and refuses with a 422 regardless, but showing the requirement up
 * front beats letting someone press a button that cannot work.
 */
const GATE_COPY: Record<EvidenceLevel, { label: string; blurb: string } | null> = {
  REQUIRED: {
    label: 'Evidence required',
    blurb: 'This filing produces a document. Attach the acknowledgement, challan or signed copy before closing it out.',
  },
  ATTEST: {
    label: 'Declaration required',
    blurb: 'There is no external receipt for this one. Attach supporting evidence, or record what was done — the declaration is stored against your name.',
  },
  NONE: null,
};

export function ItemDrawer({ itemId, onClose, onChanged }: {
  itemId: string; onClose: () => void; onChanged: () => void;
}) {
  const { data: item, error, initial, reload } = useResource<Detail>(`/compliance/items/${itemId}`);
  const { canOn } = useCompanies();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [waiving, setWaiving] = useState(false);
  const [waiveReason, setWaiveReason] = useState('');
  const [attestation, setAttestation] = useState('');
  const [signatory, setSignatory] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const { data: explain } = useResource<Explanation>(
    item ? `/compliance/companies/${item.company.id}/explain/${item.ruleCode}` : null,
    [item?.id],
  );

  // Scoped to the company this obligation belongs to, so the picker never
  // offers a colleague who cannot open it.
  const { data: people } = useResource<{ id: string; name: string }[]>(
    item ? `/tasks/assignable?companyId=${item.company.id}` : null,
    [item?.company.id],
  );

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      reload();
      onChanged();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  }

  async function uploadFile(file: File) {
    const form = new FormData();
    form.append('file', file);
    form.append('companyId', item!.company.id);
    form.append('complianceItemId', item!.id);
    if (item!.task) form.append('taskId', item!.task.id);
    await run(() => upload('/documents', form));
  }

  if (error) return <Drawer onClose={onClose}><div className="drawer-body"><ErrorNote error={error} /></div></Drawer>;
  if (initial || !item) return <Drawer onClose={onClose}><Loading /></Drawer>;

  const task = item.task;
  const closed = item.status === 'COMPLETED' || item.status === 'WAIVED';

  const mayWork = canOn(item.company.id, 'work.write');
  const mayAttach = canOn(item.company.id, 'evidence.write');
  const gate = GATE_COPY[item.evidenceLevel];
  const hasEvidence = item.documents.length > 0;
  const gated = item.evidenceLevel !== 'NONE';
  // A document satisfies both levels; only REQUIRED refuses a declaration.
  const blockedByEvidence = item.evidenceLevel === 'REQUIRED' && !hasEvidence;
  const needsDeclaration = item.evidenceLevel === 'ATTEST' && !hasEvidence;
  const needsSignatory = Boolean(explain?.rule.signatoryRequired) && hasEvidence;

  const checklist = task?.checklist ?? [];
  const checklistDone = checklist.filter((c) => c.done).length;

  // Mirrors the server's gate so the requirements are visible before the click.
  // The server still refuses independently — this is guidance, not the control.
  const blockers: string[] = [];
  if (gated && !task?.assigneeId) blockers.push('Assign it to someone');
  if (gated && checklist.length > 0 && checklistDone < checklist.length) {
    blockers.push(`Work through the checklist (${checklistDone} of ${checklist.length} done)`);
  }
  if (blockedByEvidence) blockers.push('Attach the document this filing produces');
  if (needsDeclaration && attestation.trim().length < MIN_ATTESTATION) blockers.push('Record a declaration of what was done');
  // Checked after the evidence, because that is the order the work happens in:
  // assign it, work the checklist, attach what it produced, then mark it done.
  if (gated && task?.status !== 'DONE') blockers.push('Mark the task Done once the work is finished');
  if (needsSignatory && signatory.trim().length < 3) blockers.push('Name the person who signed the document');

  return (
    <Drawer onClose={onClose}>
      <header className="drawer-head">
        <div className="stack" style={{ flex: 1, minWidth: 0, gap: 6 }}>
          <div className="row" style={{ gap: 6 }}>
            <SeverityDot value={item.severity} />
            <AuthorityTag value={item.authority} />
            {item.form && <span className="auth-tag">{item.form}</span>}
            <Badge value={item.status} />
          </div>
          <h2 style={{ fontSize: 16 }}>{item.title}</h2>
          <span className="tiny dim">{item.company.legalName} · {item.periodLabel}</span>
        </div>
        <button className="btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button>
      </header>

      <div className="drawer-body">
        {actionError && <ErrorNote error={actionError} />}

        <div className="card">
          <div className="card-body">
            <dl className="kv">
              <dt>Due</dt>
              <dd>
                <strong>{fmtDate(item.dueDate)}</strong>{' '}
                <span className={item.status === 'OVERDUE' ? '' : 'dim'}
                      style={item.status === 'OVERDUE' ? { color: 'var(--critical)' } : undefined}>
                  · {relativeDue(item.dueDate)}
                </span>
              </dd>
              <dt>Period</dt>
              <dd>{fmtDate(item.periodStart)} → {fmtDate(item.periodEnd)}</dd>
              <dt>Statute</dt>
              <dd>{item.legalReference}</dd>
              <dt>Rule code</dt>
              <dd className="mono">{item.ruleCode}</dd>
              {item.completedAt && (<><dt>Completed</dt><dd>{fmtDateTime(item.completedAt)}</dd></>)}
              {item.waivedReason && (<><dt>Waived</dt><dd>{item.waivedReason}</dd></>)}
              {item.signatoryName && (<><dt>Signed by</dt><dd>{item.signatoryName}</dd></>)}
              {item.attestationText && (
                <>
                  <dt>Declared</dt>
                  <dd>
                    “{item.attestationText}”
                    <div className="tiny dim" style={{ marginTop: 3 }}>Recorded {fmtDateTime(item.attestedAt)}</div>
                  </dd>
                </>
              )}
            </dl>
          </div>
        </div>

        {explain && (
          <div className="card">
            <header className="card-head"><h2>Why this applies</h2></header>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p className="muted" style={{ fontSize: 13, lineHeight: 1.55 }}>{explain.rule.description}</p>
              <div className="reasons">
                {explain.reasons.map((r, i) => {
                  const ok = r.negated ? !r.passed : r.passed;
                  return (
                    <div key={i} className="reason">
                      <span className={`reason-mark ${ok ? 'reason-pass' : 'reason-fail'}`}>{ok ? '✓' : '✕'}</span>
                      <span className={ok ? '' : 'muted'}>{r.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {item.penaltyNote && (
          <div className="alert alert-warn">
            <strong>If missed.</strong> {item.penaltyNote}
          </div>
        )}

        {task && (
          <div className="card">
            <header className="card-head">
              <h2>Task</h2>
              <span className="spacer">
                <Badge value={task.status} />
              </span>
            </header>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="row" style={{ gap: 8 }}>
                <select
                  value={task.status}
                  disabled={busy || !mayWork}
                  onChange={(e) => run(() => patch(`/tasks/${task.id}`, { status: e.target.value }))}
                  style={{ flex: 1 }}
                >
                  {TASK_STATUSES.map((s) => <option key={s} value={s}>{titleise(s)}</option>)}
                </select>
                <select
                  value={task.assigneeId ?? task.assignee?.id ?? ''}
                  disabled={busy || !mayWork}
                  onChange={(e) => run(() => patch(`/tasks/${task.id}`, { assigneeId: e.target.value || null }))}
                  style={{ flex: 1 }}
                >
                  <option value="">Unassigned</option>
                  {(people ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              <span className="tiny dim">
                Done means the work is finished. Filing the obligation is the separate final step below.
              </span>

              {task.checklist.length > 0 && (
                <div className="checklist">
                  {task.checklist.map((c) => (
                    <label key={c.id} className={`checklist-row ${c.done ? 'done' : ''}`}>
                      <input
                        type="checkbox"
                        checked={c.done}
                        disabled={busy || !mayWork}
                        onChange={(e) => run(() => post(`/tasks/${task.id}/checklist/${c.id}`, { done: e.target.checked }))}
                      />
                      {c.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="card">
          <header className="card-head">
            <h2>Evidence</h2>
            <span className="card-note">
              {item.documents.length} file{item.documents.length === 1 ? '' : 's'}
              {item.evidenceLevel === 'REQUIRED' ? ' · required' : item.evidenceLevel === 'ATTEST' ? ' · or a declaration' : ''}
            </span>
          </header>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {item.evidenceRequired.length > 0 && item.documents.length === 0 && (
              <div className="stack tiny muted">
                <span className="dim">Expected for this filing:</span>
                {item.evidenceRequired.map((e) => <span key={e}>· {e}</span>)}
              </div>
            )}

            {item.documents.map((doc) => (
              <div key={doc.id} className="file-row">
                <span className="file-icon">{(doc.fileName.split('.').pop() ?? '?').slice(0, 4).toUpperCase()}</span>
                <div className="stack" style={{ flex: 1, minWidth: 0 }}>
                  <span className="truncate" style={{ fontWeight: 500 }}>{doc.fileName}</span>
                  <span className="tiny dim">
                    {fmtBytes(doc.sizeBytes)}
                    {doc.pdfPages ? ` · ${doc.pdfPages} page${doc.pdfPages === 1 ? '' : 's'}` : ''}
                    {' · '}{fmtDateTime(doc.createdAt)}
                    {doc.uploadedBy ? ` · ${doc.uploadedBy.name}` : ''}
                  </span>
                  {doc.detectedType === 'pdf' && (
                    <span
                      className="tiny"
                      style={{ color: doc.hasDigitalSignature ? 'var(--good)' : 'var(--text-3)' }}
                      title={
                        doc.hasDigitalSignature
                          ? 'A digital signature was found in this PDF'
                          : 'No digital signature found — this may be a scan of a wet-ink signature, which software cannot verify'
                      }
                    >
                      {doc.hasDigitalSignature
                        ? `✓ digitally signed${doc.signers.length ? ` — ${doc.signers.join(', ')}` : ''}`
                        : '○ no digital signature'}
                    </span>
                  )}
                </div>
                <button className="btn-sm btn-ghost" onClick={() => download(doc.id, doc.fileName)}>Download</button>
                {mayAttach && (
                  <button className="btn-sm btn-ghost btn-danger" disabled={busy}
                          onClick={() => run(() => del(`/documents/${doc.id}`))}>Delete</button>
                )}
              </div>
            ))}

            <input
              ref={fileInput}
              type="file"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadFile(file);
                e.target.value = '';
              }}
            />
            {mayAttach ? (
              <div className="dropzone" onClick={() => fileInput.current?.click()}>
                {busy ? 'Working…' : 'Attach a challan, acknowledgement or working paper'}
              </div>
            ) : (
              <span className="tiny dim">Your role on this company is read-only, so evidence cannot be attached.</span>
            )}
          </div>
        </div>

        {waiving ? (
          <div className="card">
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label>Why does this not apply for this period?</label>
              <textarea rows={3} value={waiveReason} onChange={(e) => setWaiveReason(e.target.value)}
                        placeholder="e.g. No reportable transactions this year." />
              <div className="row">
                <button className="btn-primary" disabled={busy || waiveReason.trim().length < 3}
                        onClick={() => run(async () => {
                          await patch(`/compliance/items/${item.id}/status`, { status: 'WAIVED', waivedReason: waiveReason.trim() });
                          setWaiving(false);
                        })}>
                  Waive this period
                </button>
                <button onClick={() => setWaiving(false)}>Cancel</button>
              </div>
            </div>
          </div>
        ) : !mayWork ? (
          <div className="alert">
            Your role on this company is read-only. Someone with a practitioner or company-owner grant has to
            close this out.
          </div>
        ) : closed ? (
          <div className="row">
            <button disabled={busy}
                    onClick={() => run(() => patch(`/compliance/items/${item.id}/status`, { status: 'UPCOMING' }))}>
              Reopen
            </button>
          </div>
        ) : (
          <div className="card">
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              {gate && (
                <div className={`alert ${blockedByEvidence ? 'alert-warn' : ''}`}>
                  <strong>{gate.label}.</strong> {gate.blurb}
                </div>
              )}

              {blockers.length > 0 && (
                <div className="stack" style={{ gap: 6 }}>
                  <span className="tiny dim">Before this can be marked completed:</span>
                  {blockers.map((b) => (
                    <div key={b} className="reason">
                      <span className="reason-mark reason-fail">✕</span>
                      <span className="muted">{b}</span>
                    </div>
                  ))}
                </div>
              )}

              {needsDeclaration && (
                <div className="field">
                  <label>Declaration</label>
                  <textarea
                    rows={3}
                    value={attestation}
                    onChange={(e) => setAttestation(e.target.value)}
                    placeholder="e.g. Board met on 12 June 2026; four directors present, minutes circulated."
                  />
                  <span className="field-hint">
                    {attestation.trim().length < MIN_ATTESTATION
                      ? `At least ${MIN_ATTESTATION} characters — say what was actually done.`
                      : `Recorded against ${'your name'} with a timestamp, and written to the audit trail.`}
                  </span>
                </div>
              )}

              {needsSignatory && (
                <div className="field">
                  <label>Authorised signatory</label>
                  <input
                    value={signatory}
                    onChange={(e) => setSignatory(e.target.value)}
                    placeholder="e.g. Priya Ramanathan, Managing Director"
                  />
                  <span className="field-hint">
                    A scanned signature cannot be verified by software, so the accountable person is named on the
                    record instead. Written to the audit trail.
                  </span>
                </div>
              )}

              <div className="row">
                <button
                  className="btn-primary"
                  disabled={busy || blockers.length > 0}
                  onClick={() =>
                    run(async () => {
                      await patch(`/compliance/items/${item.id}/status`, {
                        status: 'COMPLETED',
                        ...(needsDeclaration ? { attestation: attestation.trim() } : {}),
                        ...(needsSignatory ? { signatoryName: signatory.trim() } : {}),
                      });
                      setAttestation('');
                      setSignatory('');
                    })
                  }
                >
                  Mark completed
                </button>
                <button disabled={busy} onClick={() => setWaiving(true)}>Not applicable</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}
