import { useRef, useState } from 'react';
import { ApiError, del, download, qs, upload } from '../api/client';
import { useResource } from '../api/useResource';
import { useCompanies } from '../auth/CompanyContext';
import type { DocumentRow, Paged } from '../api/types';
import { Card, Empty, ErrorNote, Loading, Spinner, fmtBytes, fmtDateTime } from '../components/ui';

interface Coverage {
  totalItems: number; itemsRequiringEvidence: number; itemsWithEvidence: number; coveragePct: number;
  missing: { id: string; title: string; ruleCode: string; status: string; dueDate: string; expected: string[] }[];
}

export function Documents() {
  const { selectedId, selected, companies } = useCompanies();
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const { data, error, initial, loading, reload } = useResource<Paged<DocumentRow>>(
    `/documents${qs({ companyId: selectedId ?? undefined, search: search || undefined, pageSize: 100 })}`,
    [selectedId],
  );

  const { data: coverage, reload: reloadCoverage } = useResource<Coverage>(
    selectedId ? `/documents/coverage/${selectedId}` : null,
    [selectedId],
  );

  const uploadTarget = selectedId ?? (companies.length === 1 ? companies[0]!.id : null);

  async function send(file: File) {
    if (!uploadTarget) return;
    setBusy(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('companyId', uploadTarget);
      await upload('/documents', form);
      reload();
      reloadCoverage();
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {coverage && (
        <Card title="Evidence coverage" note={selected?.legalName}>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            <div className="row">
              <span className="stat-value" style={{ fontSize: 24 }}>{coverage.coveragePct}%</span>
              <div className="meter" style={{ flex: 1 }}>
                <span style={{ width: `${coverage.coveragePct}%`, background: 'var(--good)' }} />
              </div>
              <span className="tiny muted">
                {coverage.itemsWithEvidence} of {coverage.itemsRequiringEvidence} obligations documented
              </span>
            </div>
            {coverage.missing.length > 0 && (
              <div className="alert alert-warn">
                <strong>{coverage.missing.length} completed or overdue obligations have no evidence attached.</strong>{' '}
                Open them from the calendar to file the challan or acknowledgement.
              </div>
            )}
          </div>
        </Card>
      )}

      <div className="card">
        <div className="card-body filters">
          <div className="field grow">
            <label>Search</label>
            <input placeholder="File name or label…" defaultValue={search}
                   onBlur={(e) => setSearch(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter') setSearch((e.target as HTMLInputElement).value); }} />
          </div>
          <input ref={fileInput} type="file" hidden onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void send(f);
            e.target.value = '';
          }} />
          <button className="btn-primary" disabled={busy || !uploadTarget} onClick={() => fileInput.current?.click()}>
            {busy ? <><Spinner /> Uploading</> : 'Upload file'}
          </button>
        </div>
        {!uploadTarget && (
          <div className="card-body" style={{ paddingTop: 0 }}>
            <span className="tiny dim">Pick a company in the header to upload a general file, or attach evidence to a specific obligation from the calendar.</span>
          </div>
        )}
      </div>

      {uploadError && <ErrorNote error={uploadError} />}
      {error && <ErrorNote error={error} />}
      {initial && <Loading label="Loading documents" />}

      {data && (
        <Card title="Files" note={`${data.total} stored`} action={loading ? <Spinner /> : undefined}>
          {data.rows.length === 0 ? (
            <Empty>No documents yet. Attach evidence from a calendar item, or upload one here.</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>File</th><th>Label</th><th>Size</th><th>Uploaded</th><th>By</th><th /></tr>
                </thead>
                <tbody>
                  {data.rows.map((doc) => (
                    <tr key={doc.id}>
                      <td>
                        <div className="row" style={{ gap: 9 }}>
                          <span className="file-icon">{(doc.fileName.split('.').pop() ?? '?').slice(0, 4).toUpperCase()}</span>
                          <span style={{ fontWeight: 500 }}>{doc.fileName}</span>
                        </div>
                      </td>
                      <td className="tiny muted">{doc.label ?? (doc.complianceItemId ? 'Attached to an obligation' : '—')}</td>
                      <td className="tiny muted">{fmtBytes(doc.sizeBytes)}</td>
                      <td className="tiny muted">{fmtDateTime(doc.createdAt)}</td>
                      <td className="tiny muted">{doc.uploadedBy?.name ?? '—'}</td>
                      <td className="right" style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn-sm btn-ghost" onClick={() => download(doc.id, doc.fileName)}>Download</button>
                        <button className="btn-sm btn-ghost btn-danger"
                                onClick={async () => { await del(`/documents/${doc.id}`); reload(); reloadCoverage(); }}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
