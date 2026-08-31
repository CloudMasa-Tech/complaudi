import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { qs } from '../api/client';
import { useResource } from '../api/useResource';
import { useCompanies } from '../auth/CompanyContext';
import type { ComplianceItem, Paged } from '../api/types';
import { ItemDrawer } from '../components/ItemDrawer';
import {
  AUTHORITY_LABEL, AuthorityTag, Badge, Card, Empty, ErrorNote, Loading,
  SeverityDot, Spinner, fmtDate, fmtMonth, relativeDue,
} from '../components/ui';

const PAGE_SIZE = 60;

export function Calendar() {
  const { selectedId } = useCompanies();
  const [params, setParams] = useSearchParams();
  const [openId, setOpenId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  // Filters live in the URL so a filtered view can be linked to and shared.
  const filter = (key: string) => params.get(key) ?? '';
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setPage(1);
  };

  const path = `/compliance/calendar${qs({
    companyId: selectedId ?? undefined,
    authority: filter('authority') || undefined,
    status: filter('status') || undefined,
    severity: filter('severity') || undefined,
    search: filter('search') || undefined,
    from: filter('from') || undefined,
    to: filter('to') || undefined,
    page,
    pageSize: PAGE_SIZE,
  })}`;

  const { data, error, initial, loading, reload } = useResource<Paged<ComplianceItem>>(path, [selectedId]);

  // Group into months so the list reads as a calendar rather than a flat dump.
  const months = useMemo(() => {
    const out = new Map<string, ComplianceItem[]>();
    for (const item of data?.rows ?? []) {
      const key = item.dueDate.slice(0, 7);
      out.set(key, [...(out.get(key) ?? []), item]);
    }
    return [...out.entries()];
  }, [data]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <div className="card">
        <div className="card-body filters">
          <div className="field grow">
            <label>Search</label>
            <input
              placeholder="Title, form or rule code…"
              defaultValue={filter('search')}
              onKeyDown={(e) => { if (e.key === 'Enter') setFilter('search', (e.target as HTMLInputElement).value); }}
              onBlur={(e) => setFilter('search', e.target.value)}
            />
          </div>
          <div className="field">
            <label>Authority</label>
            <select value={filter('authority')} onChange={(e) => setFilter('authority', e.target.value)}>
              <option value="">All</option>
              {Object.entries(AUTHORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Status</label>
            <select value={filter('status')} onChange={(e) => setFilter('status', e.target.value)}>
              <option value="">All</option>
              <option value="OVERDUE">Overdue</option>
              <option value="DUE">Due soon</option>
              <option value="UPCOMING">Upcoming</option>
              <option value="OVERDUE,DUE,UPCOMING">Open</option>
              <option value="COMPLETED">Completed</option>
              <option value="WAIVED">Waived</option>
            </select>
          </div>
          <div className="field">
            <label>Severity</label>
            <select value={filter('severity')} onChange={(e) => setFilter('severity', e.target.value)}>
              <option value="">All</option>
              <option value="CRITICAL">Critical</option>
              <option value="CRITICAL,HIGH">Critical + High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>
          </div>
          <div className="field">
            <label>From</label>
            <input type="date" value={filter('from')} onChange={(e) => setFilter('from', e.target.value)} />
          </div>
          <div className="field">
            <label>To</label>
            <input type="date" value={filter('to')} onChange={(e) => setFilter('to', e.target.value)} />
          </div>
          {[...params.keys()].length > 0 && (
            <button className="btn-ghost" onClick={() => { setParams(new URLSearchParams(), { replace: true }); setPage(1); }}>
              Clear
            </button>
          )}
        </div>
      </div>

      {error && <ErrorNote error={error} />}
      {initial && <Loading label="Loading the calendar" />}

      {data && (
        <Card
          title="Obligations"
          note={`${data.total} matching · page ${page} of ${totalPages}`}
          action={loading ? <Spinner /> : undefined}
        >
          {data.rows.length === 0 ? (
            <Empty>No obligations match these filters.</Empty>
          ) : (
            <div className="month">
              {months.map(([month, items]) => (
                <div key={month}>
                  <div className="month-head">
                    <span className="month-name">{fmtMonth(month)}</span>
                    <span className="tiny dim">{items.length} item{items.length === 1 ? '' : 's'}</span>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <tbody>
                        {items.map((i) => (
                          <tr key={i.id} className="clickable" onClick={() => setOpenId(i.id)}>
                            <td style={{ width: 116, whiteSpace: 'nowrap' }}>
                              <div className="stack">
                                <span style={{ fontWeight: 550 }}>{fmtDate(i.dueDate)}</span>
                                <span className="tiny dim">{relativeDue(i.dueDate)}</span>
                              </div>
                            </td>
                            <td style={{ width: 22 }}><SeverityDot value={i.severity} /></td>
                            <td>
                              <div className="stack">
                                <span style={{ fontWeight: 500 }}>{i.title}</span>
                                <span className="tiny dim">
                                  {i.periodLabel} · {i.legalReference}
                                </span>
                              </div>
                            </td>
                            <td style={{ width: 96 }}><AuthorityTag value={i.authority} /></td>
                            <td style={{ width: 106 }} className="tiny mono dim">{i.form ?? ''}</td>
                            {!selectedId && (
                              <td className="tiny muted truncate" style={{ maxWidth: 160 }}>{i.company?.legalName}</td>
                            )}
                            <td style={{ width: 66 }} className="tiny dim right">
                              {i._count?.documents ? `❐ ${i._count.documents}` : ''}
                            </td>
                            <td style={{ width: 104 }}><Badge value={i.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="card-body row" style={{ borderTop: '1px solid var(--border)', justifyContent: 'center' }}>
              <button className="btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Previous</button>
              <span className="tiny muted">Page {page} of {totalPages}</span>
              <button className="btn-sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next →</button>
            </div>
          )}
        </Card>
      )}

      {openId && <ItemDrawer itemId={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </>
  );
}
