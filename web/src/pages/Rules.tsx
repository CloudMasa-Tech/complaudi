import { Fragment, useMemo, useState } from 'react';
import { useResource } from '../api/useResource';
import { useAuth } from '../auth/AuthContext';
import {
  AUTHORITY_LABEL, AuthorityTag, Badge, Card, Empty, ErrorNote, ENTITY_LABEL,
  Loading, SeverityDot, titleise,
} from '../components/ui';
import type { Authority, EntityType, RuleEntityApplicability, Severity } from '../api/types';

interface Rule {
  code: string; title: string; authority: Authority; category: string; form: string | null;
  legalReference: string; description: string; severity: Severity; penalty: string;
  evidenceRequired: string[]; periodKind: string;
  entityTypes: RuleEntityApplicability;
  conditions: string[]; exemptions: string[];
}

const ENTITY_ORDER: EntityType[] = [
  'PRIVATE_LIMITED', 'PUBLIC_LIMITED', 'OPC', 'LLP', 'PARTNERSHIP', 'PROPRIETORSHIP', 'SECTION_8',
];

const WHY: Record<string, string> = {
  ALWAYS: 'every company of this type',
  CONTINGENT: 'only some companies of this type — depends on the profile below',
  NEVER: 'does not apply to this entity type',
};

export function Rules() {
  const { can } = useAuth();
  // The nav hides this, but a bookmarked URL does not — and the request behind
  // it is refused either way.
  const mayRead = can('rules.read');
  const { data, error, initial } = useResource<Rule[]>(mayRead ? '/rules' : null);
  const [authority, setAuthority] = useState('');
  const [search, setSearch] = useState('');
  const [entityType, setEntityType] = useState<EntityType | ''>('');
  const [showNotApplicable, setShowNotApplicable] = useState(false);
  const [openCode, setOpenCode] = useState<string | null>(null);

  const counts = useMemo(() => {
    const totals: Record<string, number> = { '': data?.length ?? 0 };
    for (const t of ENTITY_ORDER) {
      totals[t] = (data ?? []).filter((r) => r.entityTypes[t] !== 'NEVER').length;
    }
    return totals;
  }, [data]);

  const rules = useMemo(() => {
    const q = search.toLowerCase();
    return (data ?? []).filter((r) =>
      (!authority || r.authority === authority) &&
      (!entityType || showNotApplicable || r.entityTypes[entityType] !== 'NEVER') &&
      (!q ||
        r.title.toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q) ||
        (r.form ?? '').toLowerCase().includes(q) ||
        r.legalReference.toLowerCase().includes(q)),
    );
  }, [data, authority, search, entityType, showNotApplicable]);

  if (!mayRead) {
    return (
      <Card>
        <Empty>
          The rule engine is maintained by the compliance platform team. Only a super admin can open it.
        </Empty>
      </Card>
    );
  }

  if (error) return <ErrorNote error={error} />;
  if (initial) return <Loading label="Loading the rule engine" />;

  return (
    <>
      <div className="card">
        <div className="card-body filters">
          <div className="field grow">
            <label>Search</label>
            <input placeholder="Form, title, rule code or statute…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="field">
            <label>Authority</label>
            <select value={authority} onChange={(e) => setAuthority(e.target.value)}>
              <option value="">All</option>
              {Object.entries(AUTHORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>
      </div>

      <Card title="Rules" note={`${rules.length} of ${data?.length ?? 0}`}>
        <div className="entity-tabs" role="tablist" aria-label="Entity type">
          <button type="button" role="tab" aria-selected={entityType === ''} className={entityType === '' ? 'active' : ''} onClick={() => setEntityType('')}>
            All <span className="entity-tab-count">{counts['']}</span>
          </button>
          {ENTITY_ORDER.map((t) => (
            <button type="button" role="tab" aria-selected={entityType === t} key={t} className={entityType === t ? 'active' : ''} onClick={() => setEntityType(t)}>
              {ENTITY_LABEL[t]} <span className="entity-tab-count">{counts[t]}</span>
            </button>
          ))}
        </div>

        {entityType && (
          <div className="entity-tab-row">
            <span>
              <input id="show-na" type="checkbox" checked={showNotApplicable} onChange={(e) => setShowNotApplicable(e.target.checked)} />
              {' '}
              <label htmlFor="show-na">Show rules that never apply</label>
            </span>
            <span className="sep">·</span>
            <span>Counts exclude rules this constitution can never meet.</span>
          </div>
        )}

        {rules.length === 0 ? (
          <Empty>No rules match.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th /><th>Rule</th><th>Authority</th><th>Form</th><th>Cadence</th><th>Statute</th></tr>
              </thead>
              <tbody>
                {rules.map((r) => {
                  const status = entityType ? r.entityTypes[entityType] : null;
                  return (
                    // Fragment carries the list key; the rows inside are siblings.
                    <Fragment key={r.code}>
                      <tr className="clickable" onClick={() => setOpenCode(openCode === r.code ? null : r.code)}>
                        <td style={{ width: 22 }}><SeverityDot value={r.severity} /></td>
                        <td>
                          <div className="stack">
                            <span style={{ fontWeight: 500 }}>
                              {r.title}{' '}
                              {status === 'CONTINGENT' && (
                                <Badge value="VARIES" >Varies</Badge>
                              )}
                              {status === 'NEVER' && (
                                <Badge value="NEVER">Not applicable</Badge>
                              )}
                            </span>
                            <span className="tiny mono dim">{r.code}</span>
                          </div>
                        </td>
                        <td style={{ width: 96 }}><AuthorityTag value={r.authority} /></td>
                        <td style={{ width: 130 }} className="tiny mono dim">{r.form ?? '—'}</td>
                        <td style={{ width: 106 }} className="tiny muted">{titleise(r.periodKind)}</td>
                        <td className="tiny muted">{r.legalReference}</td>
                      </tr>
                      {openCode === r.code && (
                        <tr>
                          <td colSpan={6} style={{ background: 'var(--surface-2)' }}>
                            <div className="stack" style={{ gap: 10, padding: '4px 0' }}>
                              {status && (
                                <div className="alert tiny" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                                  <strong>{ENTITY_LABEL[entityType!]}:</strong> {WHY[status]}
                                </div>
                              )}
                              <p style={{ fontSize: 13, lineHeight: 1.55 }}>{r.description}</p>
                              <div>
                                <span className="tiny dim">Applies when</span>
                                <div className="reasons" style={{ marginTop: 4 }}>
                                  {r.conditions.map((c) => (
                                    <div key={c} className="reason"><span className="reason-mark dim">·</span>{c}</div>
                                  ))}
                                </div>
                              </div>
                              {r.exemptions.length > 0 && (
                                <div>
                                  <span className="tiny dim">Except when</span>
                                  <div className="reasons" style={{ marginTop: 4 }}>
                                    {r.exemptions.map((c) => (
                                      <div key={c} className="reason"><span className="reason-mark dim">·</span>{c}</div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              <div>
                                <span className="tiny dim">Evidence expected</span>
                                <div className="tiny muted" style={{ marginTop: 4 }}>{r.evidenceRequired.join(' · ') || '—'}</div>
                              </div>
                              <div className="alert alert-warn tiny"><strong>If missed.</strong> {r.penalty}</div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}