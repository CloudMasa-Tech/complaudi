import { COMPLIANCE, DOCS } from '../data';
import { Icon } from '../icons';
import { ConceptNote, DemoTag, Reveal, SectionHead, StatusPill, ToneKey } from './primitives';

/**
 * The compliance tracker. Readable in three seconds because the status is the
 * loudest thing on each row, the authority is demoted to a quiet tag, and the
 * reason is one plain line rather than a paragraph.
 *
 * Below 620px the table becomes a card list: each cell carries its own column
 * name via `data-th` and a flex row, so a narrow screen never needs to scroll
 * sideways and the labels never have to be repeated in the markup.
 */
export function ComplianceOverview() {
  return (
    <section className="lp-section lp-band-white" id="compliance" aria-labelledby="lp-comp-h">
      <div className="lp-container is-wide">
        <SectionHead
          eyebrow={COMPLIANCE.eyebrow}
          headline={COMPLIANCE.headline}
          lede={COMPLIANCE.lede}
          wide
          id="lp-comp-h"
        />

        <Reveal>
          <div className="lp-legend">
            {COMPLIANCE.legend.map((l) => (
              <span key={l.label} className="lp-legend-item">
                <ToneKey tone={l.tone} />
                {l.label}
              </span>
            ))}
          </div>
        </Reveal>

        <div className="lp-compliance" style={{ marginTop: 16 }}>
          <Reveal className="lp-ui">
            <div className="lp-ui-card">
              <div className="lp-ui-head">
                <p className="lp-ui-panel-title">Compliance Overview</p>
                <span className="lp-ui-label" style={{ marginLeft: 'auto' }}>FY 2026–27</span>
              </div>
              <table className="lp-ui-table">
                <caption className="lp-sr">
                  Compliance status by registration for the sample company, with the authority and
                  the next action for each.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Registration</th>
                    <th scope="col">Authority</th>
                    <th scope="col">Status</th>
                    <th scope="col">Next action</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPLIANCE.rows.map((r) => (
                    <tr key={r.name}>
                      <td data-th="Registration">
                        <span style={{ fontWeight: 600, color: 'var(--lp-text)' }}>{r.name}</span>
                      </td>
                      <td data-th="Authority">
                        <span style={{ fontSize: 12, color: 'var(--lp-text-3)' }}>{r.authority}</span>
                      </td>
                      <td data-th="Status"><StatusPill status={r.status} /></td>
                      <td data-th="Next action">
                        <span style={{ fontSize: 12.5, color: 'var(--lp-text-2)' }}>{r.note}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Reveal>

          <div className="lp-compliance-side lp-ui">
            {COMPLIANCE.side.map((s) => (
              <Reveal key={s.label} delay={1} className="lp-ui-card">
                <div className="lp-mini-stat">
                  <span className={`lp-doc-count-icon is-${s.tone}`} aria-hidden="true">
                    <Icon name={s.icon} size={16} />
                  </span>
                  <span className="lp-mini-stat-body">
                    <b style={{ color: `var(--lp-${s.tone === 'good' ? 'good' : 'warn'})` }}>{s.value}</b>
                    <span>{s.label}</span>
                  </span>
                </div>
              </Reveal>
            ))}

            <Reveal delay={2} className="lp-ui-card">
              <div className="lp-ui-head"><p className="lp-ui-panel-title">Breakdown</p></div>
              <div className="lp-bar" role="img" aria-label="3 completed, 1 needs attention, 2 not started">
                <i className="seg-good" style={{ width: '50%' }} />
                <i className="seg-warn" style={{ width: '17%' }} />
                <i className="seg-crit" style={{ width: '0%' }} />
                <i className="seg-info" style={{ width: '33%' }} />
              </div>
              <p style={{ fontSize: 11.5, color: 'var(--lp-text-3)', marginTop: 9, lineHeight: 1.5 }}>
                3 of 6 registrations complete. Trade licence renewal and 2 ROC filings are the
                next things to move.
              </p>
            </Reveal>
          </div>
        </div>

        <Reveal delay={1}>
          <ConceptNote>
            <strong>Sample workspace.</strong> Registrations, dates and the compliance health score
            are illustrative. Complaudi calculates these from the Indian financial year and the
            rules that apply to each entity type.
          </ConceptNote>
        </Reveal>
      </div>
    </section>
  );
}

/**
 * Document management. The Upload / View / Download controls are present because
 * the brief asks for them and because a document table without actions does not
 * look like a product — but they are rendered as non-operating buttons inside a
 * labelled concept surface rather than as live file I/O.
 */
export function DocumentManagement() {
  return (
    <section className="lp-section lp-band-light" id="documents" aria-labelledby="lp-doc-h">
      <div className="lp-container is-wide">
        <SectionHead
          eyebrow={DOCS.eyebrow}
          headline={DOCS.headline}
          lede={DOCS.lede}
          centered
          wide
          id="lp-doc-h"
        />

        <div className="lp-docs">
          <Reveal className="lp-ui">
            <div className="lp-appframe lp-ui" style={{ boxShadow: 'var(--lp-shadow-md)' }}>
              <div className="lp-appframe-bar">
                <span className="lp-dots" aria-hidden="true"><i /><i /><i /></span>
                <span className="lp-appframe-url">app.complaudi.com / documents</span>
                <DemoTag>Sample data</DemoTag>
              </div>
              <div className="lp-appframe-body">
                <div className="lp-ui-card">
                  <div className="lp-ui-head">
                    <p className="lp-ui-panel-title">Documents</p>
                    <span className="lp-ui-label" style={{ marginLeft: 'auto' }}>{DOCS.rows.length} shown</span>
                  </div>
                  <table className="lp-ui-table">
                    <caption className="lp-sr">
                      Business documents with status, upload date and verification state.
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">{DOCS.columns[0]}</th>
                        <th scope="col">{DOCS.columns[1]}</th>
                        <th scope="col">{DOCS.columns[2]}</th>
                        <th scope="col">{DOCS.columns[3]}</th>
                        <th scope="col"><span className="lp-sr">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {DOCS.rows.map((d) => (
                        <tr key={d.name}>
                          <td data-th="Document">
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
                              <span
                                aria-hidden="true"
                                style={{
                                  width: 26, height: 26, borderRadius: 7, display: 'grid',
                                  placeItems: 'center', flex: 'none',
                                  background: 'var(--lp-surface-2)',
                                  border: '1px solid var(--lp-border)',
                                  color: 'var(--lp-text-2)',
                                }}
                              >
                                <Icon name="file-text" size={13} />
                              </span>
                              <span>
                                <span style={{ display: 'block', fontWeight: 600, color: 'var(--lp-text)' }}>
                                  {d.name}
                                </span>
                                <span style={{ display: 'block', fontSize: 11, color: 'var(--lp-text-3)' }}>
                                  {d.kind}
                                </span>
                              </span>
                            </span>
                          </td>
                          <td data-th="Status"><StatusPill status={d.status} /></td>
                          <td data-th="Uploaded">
                            <span className="num" style={{ fontSize: 12.5, color: 'var(--lp-text-2)' }}>
                              {d.uploaded}
                            </span>
                          </td>
                          <td data-th="Verification"><StatusPill status={d.verification} /></td>
                          <td data-th="Actions">
                            <span className="lp-doc-actions">
                              <button type="button" className="lp-doc-btn is-icon" aria-label={`View ${d.name}`} disabled>
                                <Icon name="eye" size={13} />
                              </button>
                              <button type="button" className="lp-doc-btn is-icon" aria-label={`Download ${d.name}`} disabled>
                                <Icon name="download" size={13} />
                              </button>
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <ConceptNote>
              <strong>Sample library.</strong> Documents, dates and verification states are
              illustrative. View and download are shown disabled — a marketing page does not hold
              your files.
            </ConceptNote>
          </Reveal>

          <Reveal delay={1}>
            <div className="lp-upload">
              <span className="lp-upload-icon" aria-hidden="true"><Icon name="upload" size={19} /></span>
              <b>Upload Document</b>
              <p>Certificates, registrations and supporting evidence.</p>
            </div>

            <div className="lp-doc-counts">
              {DOCS.counts.map((c) => (
                <div key={c.label} className="lp-doc-count">
                  <span className={`lp-doc-count-icon is-${c.tone}`} aria-hidden="true">
                    <Icon name={c.icon} size={15} />
                  </span>
                  <span style={{ fontSize: 13.5, fontWeight: 550, color: 'var(--lp-text-2)' }}>{c.label}</span>
                  <b>{c.value}</b>
                </div>
              ))}
            </div>

            <div className="lp-concept-note" style={{ marginTop: 18 }}>
              <Icon name="folder" size={16} />
              <span>
                Each document is kept with the obligation it belongs to, so the evidence for a
                filing is in the same place as the filing.
              </span>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
