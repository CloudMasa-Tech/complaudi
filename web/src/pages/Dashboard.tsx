import { useState } from 'react';
import { Link } from 'react-router-dom';
import { view, forceDownload, qs, resolveApiUrl } from '../api/client';
import { useResource } from '../api/useResource';
import { useCompanies } from '../auth/CompanyContext';
import type { Company, CompanyProfile, DinStatus, Overview, EvaluatedRegistration } from '../api/types';

import {
  AUTHORITY_LABEL, Badge, Card, Drawer, Empty, ENTITY_LABEL, ErrorNote, Loading,
  SeverityDot, Stat, fmtDate, titleise, initials,
} from '../components/ui';

interface DocumentItem {
  id: string;
  companyId: string;
  fileName: string;
  label: string | null;
  createdAt: string;
}

const SEVERITY_COLOUR: Record<string, string> = {
  CRITICAL: 'var(--critical)', HIGH: 'var(--high)', MEDIUM: 'var(--medium)', LOW: 'var(--text-3)',
};

function EyeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function DownloadIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function DocumentActionButtons({ doc, style }: { doc: DocumentItem; style?: React.CSSProperties }) {
  return (
    <div className="doc-action-group" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, zIndex: 5, ...style }}>
      <button
        type="button"
        className="btn-xs btn-outline icon-btn-compact"
        title="View Documents"
        aria-label="View Documents"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 26,
          height: 26,
          padding: 0,
          borderRadius: 4,
          border: '1px solid var(--border-strong, #cbd5e1)',
          background: 'var(--surface-1, #ffffff)',
          color: 'var(--text-1, #1e293b)',
          cursor: 'pointer',
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
        }}
        onClick={(e) => { e.stopPropagation(); void view(doc.id); }}
      >
        <EyeIcon size={14} />
      </button>
      <button
        type="button"
        className="btn-xs btn-outline icon-btn-compact"
        title="Download Documents"
        aria-label="Download Documents"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 26,
          height: 26,
          padding: 0,
          borderRadius: 4,
          border: '1px solid var(--border-strong, #cbd5e1)',
          background: 'var(--surface-1, #ffffff)',
          color: 'var(--text-1, #1e293b)',
          cursor: 'pointer',
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
        }}
        onClick={(e) => { e.stopPropagation(); void forceDownload(doc.id, doc.fileName); }}
      >
        <DownloadIcon size={14} />
      </button>
    </div>
  );
}

function RegistrationBreakdownDrawer({ profile, registrations, docs, onClose }: { profile: CompanyProfile, registrations: EvaluatedRegistration[], docs: DocumentItem[], onClose: () => void }) {
  return (
    <Drawer onClose={onClose}>
      <header className="drawer-head">
        <h2 style={{ fontSize: 16 }}>Registration Requirements Breakdown</h2>
        <button className="btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button>
      </header>
      <div className="drawer-body">
        {registrations.map(r => {
          const docTypeKey = r.id === 'GSTIN' ? 'gst' : r.id === 'MSME' ? 'msme' : r.id === 'DPIIT' ? 'dpiit' : r.id === 'PAN' ? 'pan' : r.id.toLowerCase();
          const doc = docs.find(d => (d.label || '').toLowerCase() === docTypeKey);

          return (
            <div key={r.id} className="card stack" style={{ padding: 16, gap: 8 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600 }}>{r.title}</span>
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  {doc && <DocumentActionButtons doc={doc} />}
                  <Badge value={
                    r.status === 'REGISTERED' ? 'COMPLETED' 
                    : r.status === 'ELIGIBLE' || r.status === 'PENDING_APPLICATION' ? 'WAIVED' 
                    : 'DUE'
                  }>
                    {titleise(r.status.replace(/_/g, ' '))}
                  </Badge>
                </div>
              </div>
              <p className="tiny dim" style={{ margin: 0 }}>{r.reason}</p>

              {(r.status === 'MANDATORY' || r.status === 'ELIGIBLE' || r.status === 'EXPIRED_RENEWAL_DUE') && (
                <div className="row" style={{ gap: 12, marginTop: 4 }}>
                  <Link className="btn btn-sm btn-primary" to={`/companies/${profile.id}/edit`}>Add number to profile</Link>
                  {r.ctaUrl && (
                    <a className="btn btn-sm btn-outline" href={r.ctaUrl} target="_blank" rel="noopener noreferrer">
                      Register externally →
                    </a>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Drawer>
  );
}

/**
 * The colour a registration card wears.
 *
 * Driven by what the rules engine decided, not by whether the field is filled.
 * "Missing" and "missing and required" are different facts, and on a compliance
 * dashboard the difference is the whole point — red on an optional registration
 * reads as a finding against the company when there is none. A ₹2 lakh-turnover
 * company is nowhere near the ₹20 lakh GST threshold, so its blank GSTIN is a
 * choice, not a breach.
 *
 *   REGISTERED            green   held
 *   MANDATORY             red     required by the rules and missing
 *   EXPIRED_RENEWAL_DUE   red     held but lapsed
 *   PENDING_APPLICATION   amber   in flight
 *   ELIGIBLE              grey    available, not required
 */
function regTone(
  registrations: EvaluatedRegistration[],
  ids: string[],
  hasValue: boolean,
): 'good' | 'bad' | 'warn' | 'idle' {
  const found = registrations.find((r) => ids.includes(r.id));
  if (!found) return hasValue ? 'good' : 'idle';
  switch (found.status) {
    case 'REGISTERED': return 'good';
    case 'MANDATORY':
    case 'EXPIRED_RENEWAL_DUE':
    // ELIGIBLE means available but not required — Udyam and DPIIT are both
    // voluntary. Shown red anyway, by choice: on this dashboard a missing
    // registration is a gap to review, not a verdict on compliance.
    case 'ELIGIBLE': return 'bad';
    case 'PENDING_APPLICATION': return 'warn';
    default: return hasValue ? 'good' : 'bad';
  }
}

/** Clean card layout with left-aligned details and large right-aligned logo */
const ABSENT_VALUES = new Set([
  'Not held', 'Not registered', 'Not enrolled', 'Not recorded',
  'Not recognised', 'Not yet due', 'Not applicable', '—',
]);

function RegCard({
  title,
  subTitle,
  idLabel,
  idValue,
  statusLabel,
  tone,
  logoUrl,
  doc,
}: {
  title: string;
  subTitle?: string;
  idLabel?: string;
  idValue: string | null;
  statusLabel?: string;
  tone?: 'good' | 'bad' | 'warn' | 'idle';
  logoUrl?: string;
  doc?: DocumentItem;
}) {
  /**
   * The words a card uses to say it holds nothing.
   *
   * They drive the tile treatment — dashed and muted rather than solid — which
   * is separate from the colour of the status line. "Not recorded" and "Not yet
   * due" were absent from this list, so those two cards rendered as solid held
   * tiles while saying they held nothing. Listed rather than chained on `!==`,
   * so the next wording added is one entry, not another comparison to forget.
   */
  const hasValue = idValue !== null && !ABSENT_VALUES.has(idValue);
  const displayValue = idValue ?? 'Not held';
  /* A registration that is not held reads red, whether it is legally required
     or merely available. That is a deliberate choice about this product rather
     than about the law: the engine still knows the difference (see regTone),
     but the dashboard treats every gap as something to look at. `--critical`
     resolves per theme — #b42318 on light, #fda29b on dark — so the colour
     carries in both without a second rule. */
  const statusTone = tone ?? (hasValue ? 'good' : 'bad');

  const statusColour = statusTone === 'good' ? 'var(--good)'
    : statusTone === 'bad' ? 'var(--critical)'
    : statusTone === 'warn' ? 'var(--high)'
    : 'var(--text-3)';

  return (
    <div className={`reg-tile ${hasValue ? 'is-held' : 'is-empty'}`}>
      {/* Left Content Area */}
      <div className="card-left-content">
        <div className="card-title-row">
          {statusTone !== 'idle' && <span className="dot" style={{ background: statusColour, flexShrink: 0 }} />}
          <span className="card-title">{title}</span>
        </div>

        <div className="card-details-stack">
          {subTitle && <div className="card-subtitle">{subTitle}</div>}
          <div className="card-id-row">
            {idLabel && <span className="card-id-label">{idLabel}: </span>}
            <span className={`card-id-value ${hasValue ? '' : 'na'}`}>{displayValue}</span>
          </div>
          {statusLabel && (
            <div className="card-status-text" style={{ color: statusTone !== 'idle' ? statusColour : 'var(--text-3)' }}>
              {statusLabel}
            </div>
          )}
        </div>
      </div>

      {/* Right Area: Top-right Document Actions + Large Right-Aligned Logo */}
      <div className="card-right-area">
        {doc ? (
          <DocumentActionButtons doc={doc} style={{ alignSelf: 'flex-end' }} />
        ) : (
          <div style={{ height: 24 }} />
        )}
        {logoUrl && (
          <img src={logoUrl} alt={title} className="card-logo-large" />
        )}
      </div>
    </div>
  );
}

const DSC_VIEW = {
  ACTIVE: { word: 'Active', tone: 'good' },
  EXPIRED: { word: 'Expired', tone: 'bad' },
  // No certificate on file means no filing can be signed, so it reads as a gap.
  NOT_RECORDED: { word: 'Not recorded', tone: 'bad' },
} as const;

const KYC_VIEW = {
  MET: { word: 'Met', tone: 'good' },
  NOT_MET: { word: 'Not met', tone: 'bad' },
  NOT_DUE: { word: 'Not yet due', tone: 'bad' },
  // The one absence that stays grey: no DIN on record means the obligation does
  // not exist for this entity, so there is nothing to be missing.
  NOT_APPLICABLE: { word: 'Not applicable', tone: 'idle' },
} as const;

/**
 * The entity itself, before anything it owes.
 */
function EntityCard({ profile, logoStorageKey, registrations = [] }: {
  profile: CompanyProfile;
  logoStorageKey?: string | null;
  /** The engine's verdict per registration, which decides each card's colour. */
  registrations?: EvaluatedRegistration[];
}) {
  const { dsc, mcaKyc, msme, gstins, dpiit } = profile;
  const live = gstins.filter((g) => g.isActive);
  const dscView = DSC_VIEW[dsc.status];
  const kycView = KYC_VIEW[mcaKyc.status];

  const { data: docsData } = useResource<{ rows: DocumentItem[] }>(`/documents?companyId=${profile.id}`, [profile.id]);
  const docs = docsData?.rows || [];

  const panDoc = docs.find((d) => (d.label || '').toLowerCase() === 'pan');
  const msmeDoc = docs.find((d) => (d.label || '').toLowerCase() === 'msme');
  const gstDoc = docs.find((d) => (d.label || '').toLowerCase() === 'gst');
  const dpiitDoc = docs.find((d) => (d.label || '').toLowerCase() === 'dpiit');
  const dscDoc = docs.find((d) => (d.label || '').toLowerCase() === 'dsc');
  const mcaDoc = docs.find((d) => ['master_data', 'mca_report', 'mca'].includes((d.label || '').toLowerCase()));
  const kycDoc = docs.find((d) => ['kyc', 'dir3', 'dir3_kyc'].includes((d.label || '').toLowerCase()));
  const daDoc = docs.find((d) => ['da', 'director_audit'].includes((d.label || '').toLowerCase()));
  const r3Doc = docs.find((d) => ['r3', 'dir3_return', 'mca_return'].includes((d.label || '').toLowerCase()));
  const pfDoc = docs.find((d) => (d.label || '').toLowerCase() === 'pf');
  const esiDoc = docs.find((d) => (d.label || '').toLowerCase() === 'esi');

  const allCards = [
    {
      id: 'PAN',
      hasData: Boolean(profile.pan || panDoc),
      render: (
        <RegCard
          key="pan"
          title="PAN"
          subTitle="Income Tax PAN"
          idLabel="PAN Number"
          idValue={profile.pan ?? null}
          statusLabel={profile.pan ? 'Available & Valid' : panDoc ? 'Document Uploaded' : 'Not available'}
          logoUrl="/pan.svg?v=3"
          doc={panDoc}
        />
      ),
    },
    {
      id: 'MSME',
      hasData: Boolean(msme?.udyamNumber || msmeDoc),
      render: (
        <RegCard
          key="msme"
          title="MSME / UDYAM"
          subTitle="Udyam Registration"
          idLabel="Udyam Number"
          idValue={msme?.udyamNumber ?? null}
          statusLabel={msme ? `Registered${msme.category ? ` · ${titleise(msme.category)}` : ''}` : msmeDoc ? 'Document Uploaded' : 'Not registered'}
          tone={regTone(registrations, ['msme'], Boolean(msme))}
          logoUrl="/msme.webp?v=3"
          doc={msmeDoc}
        />
      ),
    },
    {
      id: 'GSTIN',
      hasData: Boolean((live.length > 0 && live[0]?.gstin) || gstDoc),
      render: (
        <RegCard
          key="gstin"
          title="GST"
          subTitle="GST Registration"
          idLabel="GSTIN"
          idValue={live[0]?.gstin ?? null}
          statusLabel={
            live.length > 1 ? `${live[0]!.stateCode} · ${live.length - 1} more states`
              : live.length === 1 ? `${live[0]!.stateCode} · Registered` : gstDoc ? 'Document Uploaded' : 'Not registered'
          }
          tone={regTone(registrations, ['gst'], live.length > 0)}
          logoUrl="/gst.webp?v=3"
          doc={gstDoc}
        />
      ),
    },
    {
      id: 'DPIIT',
      hasData: Boolean(dpiit?.number || dpiitDoc),
      render: (
        <RegCard
          key="dpiit"
          title="DPIIT / STARTUP"
          subTitle="DPIIT Recognition"
          idLabel="DPIIT Number"
          idValue={dpiit?.number ?? null}
          statusLabel={dpiit?.recognisedOn ? `Recognised · ${fmtDate(dpiit.recognisedOn)}` : dpiit ? 'Recognised' : dpiitDoc ? 'Document Uploaded' : 'Not recognised'}
          tone={regTone(registrations, ['dpiit'], Boolean(dpiit?.number))}
          logoUrl="/dpiit.webp?v=3"
          doc={dpiitDoc}
        />
      ),
    },
    {
      id: 'MCA',
      hasData: Boolean(profile.registrationNumber || mcaDoc),
      render: (
        <RegCard
          key="mca"
          title="MCA"
          subTitle="MCA Master Data"
          idLabel="Registration No"
          idValue={profile.registrationNumber || null}
          statusLabel={mcaDoc ? 'Document Uploaded' : profile.registrationNumber ? 'Master Data Recorded' : 'Not recorded'}
          tone={regTone(registrations, ['mca_cin', 'mca_llpin'], Boolean(profile.registrationNumber))}
          logoUrl="/mca.svg?v=3"
          doc={mcaDoc}
        />
      ),
    },
    {
      id: 'KYC',
      hasData: Boolean(mcaKyc.status === 'MET' || kycDoc || mcaDoc),
      render: (
        <RegCard
          key="kyc"
          title="KYC"
          subTitle="Director DIR-3 KYC"
          idLabel="Status"
          idValue={kycView.word}
          tone={kycView.tone}
          statusLabel={
            mcaKyc.status === 'NOT_APPLICABLE'
              ? 'No DIN on record'
              : `${mcaKyc.periodLabel ?? ''}${mcaKyc.dueDate ? ` · due ${fmtDate(mcaKyc.dueDate)}` : ''}`
          }
          logoUrl="/kyc.svg?v=3"
          doc={kycDoc || mcaDoc}
        />
      ),
    },
    {
      id: 'PF',
      hasData: Boolean(profile.epfoCode || pfDoc),
      render: (
        <RegCard
          key="epfo"
          title="PF"
          subTitle="EPFO Registration"
          idLabel="PF Code"
          idValue={profile.epfoCode ?? null}
          statusLabel={profile.epfoCode ? 'Enrolled' : pfDoc ? 'Document Uploaded' : 'Not enrolled'}
          tone={regTone(registrations, ['pf'], Boolean(profile.epfoCode))}
          logoUrl="/epfo.png?v=3"
          doc={pfDoc}
        />
      ),
    },
    {
      id: 'ESI',
      hasData: Boolean(profile.esicCode || esiDoc),
      render: (
        <RegCard
          key="esic"
          title="ESI"
          subTitle="ESIC Registration"
          idLabel="ESI Code"
          idValue={profile.esicCode ?? null}
          statusLabel={profile.esicCode ? 'Enrolled' : esiDoc ? 'Document Uploaded' : 'Not enrolled'}
          tone={regTone(registrations, ['esi'], Boolean(profile.esicCode))}
          logoUrl="/esic.png?v=3"
          doc={esiDoc}
        />
      ),
    },
    {
      id: 'DA',
      hasData: Boolean(dsc.status !== 'NOT_RECORDED' || daDoc || dscDoc),
      render: (
        <RegCard
          key="da"
          title="DA · Director Audit"
          subTitle="DSC & Expiry Audit"
          idLabel="Status"
          idValue={dscView.word}
          tone={dscView.tone}
          statusLabel={`${dsc.active} of ${dsc.total} directors active`}
          logoUrl="/da.svg?v=3"
          doc={daDoc || dscDoc}
        />
      ),
    },
    {
      id: 'R3',
      hasData: Boolean(profile.directors.length > 0 || r3Doc || mcaDoc),
      render: (
        <RegCard
          key="r3"
          title="R3 · DIR-3 Return"
          subTitle="DIR-3 Return Filing"
          idLabel="Filing"
          idValue={profile.directors.length > 0 ? 'Compliant' : 'Not required'}
          tone={profile.directors.length > 0 ? 'good' : 'idle'}
          statusLabel={profile.directors.length > 0 ? `${profile.directors.length} director DIN(s) filed` : 'No directors recorded'}
          logoUrl="/r3.svg?v=3"
          doc={r3Doc || mcaDoc}
        />
      ),
    },
  ];

  const filledCards = allCards.filter((c) => c.hasData);
  const unfilledCards = allCards.filter((c) => !c.hasData);
  const sortedCards = [...filledCards, ...unfilledCards];

  return (
    <div className="card">
      <header className="entity-head">
        <div className="entity-mark" style={logoStorageKey ? { background: 'transparent', boxShadow: 'none' } : undefined}>
          {logoStorageKey ? (
            <img src={resolveApiUrl(`/companies/${profile.id}/logo`)} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 'inherit' }} />
          ) : (
            initials(profile.legalName)
          )}
        </div>
        <div className="stack" style={{ minWidth: 0, gap: 3 }}>
          <span className="entity-name">{profile.legalName}</span>
          <span className="entity-sub">
            {ENTITY_LABEL[profile.entityType] ?? titleise(profile.entityType)}
            {profile.incorporationDate && ` · Incorporated ${fmtDate(profile.incorporationDate)}`}
            {profile.ageYears !== null && ` · ${profile.ageYears} year${profile.ageYears === 1 ? '' : 's'} old`}
          </span>
        </div>
        <div className="entity-id-wrap">
          {profile.registrationNumber && profile.registrationLabel !== 'PAN' && (
            <div className="id-badge-outline">
              <span className="id-badge-outline-label">{profile.registrationLabel}</span>
              <span className="id-badge-outline-value">{profile.registrationNumber}</span>
            </div>
          )}
        </div>
      </header>

      {/* Grid of Registration & Status Cards, dynamically ordered */}
      <div className="reg-grid">
        {sortedCards.map((c) => c.render)}
      </div>

      <div className="row" style={{ padding: '0 18px 8px' }}>
        <span className="reg-label">Directors on record</span>
        <span className="tiny dim" style={{ marginLeft: 'auto' }}>
          {profile.directors.length} serving
          {profile.directors.some((d) => dinOf(d).state !== 'UNKNOWN') && (
            <span title="MCA publishes no API for DIN status, so this is read from your DIR-3 KYC filing record rather than checked with the Registrar.">
              {' · DIN status derived from DIR-3 KYC'}
            </span>
          )}
        </span>
      </div>
      {profile.directors.length === 0 ? (
        <div style={{ padding: '0 18px 16px' }}><Empty>No directors recorded yet.</Empty></div>
      ) : (
        <div className="dir-strip">
          {profile.directors.map((dir) => (
            <span key={dir.id} className={`dir-chip din-${dinOf(dir).state.toLowerCase()}`}>
              <span className="avatar">{initials(dir.name)}</span>
              <span className="stack" style={{ minWidth: 0, gap: 1 }}>
                <span style={{ fontWeight: 550, fontSize: 13 }}>{dir.name}</span>
                <span className="tiny dim">
                  {dir.designation}{dir.din ? ` · DIN ${dir.din}` : ''}
                  {dir.dscStatus !== 'NOT_RECORDED' && (
                    <span style={{ color: dir.dscStatus === 'ACTIVE' ? 'var(--good)' : 'var(--critical)' }}>
                      {' · DSC '}{dir.dscStatus === 'ACTIVE' ? 'to' : 'expired'} {fmtDate(dir.dscExpiresOn!)}
                    </span>
                  )}
                </span>
                {/* Nothing is shown when there is nothing to say — an unknown
                    DIN must not be coloured as though it were a problem. */}
                {dinOf(dir).state !== 'UNKNOWN' && (
                  <span className="din-line" title={dinOf(dir).action ?? undefined}>
                    <span className="din-dot" aria-hidden="true" />
                    {dinOf(dir).state === 'ACTIVE' ? 'DIN active' :
                     dinOf(dir).state === 'DEACTIVATED' ? 'DIN deactivated' : 'KYC due'}
                    <span className="din-detail">· {dinOf(dir).label}</span>
                  </span>
                )}
                {dinOf(dir).action && dinOf(dir).state === 'DEACTIVATED' && (
                  <span className="din-action">{dinOf(dir).action}</span>
                )}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function PortfolioOverview({ companies }: { companies: Company[] }) {
  if (companies.length === 0) return null;

  const entityTypes = companies.reduce((acc, c) => {
    acc[c.entityType] = (acc[c.entityType] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const withGst = companies.filter((c) => c.gstRegistrations && c.gstRegistrations.length > 0).length;
  const withMsme = companies.filter((c) => !!c.msmeRegistration).length;
  const totalDirectors = companies.reduce((sum, c) => sum + (c.directors?.length || 0), 0);
  const activeCount = companies.filter(c => c.isActive).length;

  return (
    <Card title="Portfolio Analytics">
      <div className="card-body">
        <div className="grid grid-4" style={{ gap: 16 }}>
          <div className="card stat" style={{ border: 'none', background: 'var(--surface-2)' }}>
            <span className="stat-label">Total Companies</span>
            <span className="stat-value">{companies.length}</span>
            <span className="stat-foot">{activeCount} active · {companies.length - activeCount} archived</span>
          </div>
          <div className="card stat" style={{ border: 'none', background: 'var(--surface-2)' }}>
            <span className="stat-label">Total Directors</span>
            <span className="stat-value">{totalDirectors}</span>
            <span className="stat-foot">Across all entities</span>
          </div>
          <div className="card stat" style={{ border: 'none', background: 'var(--surface-2)' }}>
            <span className="stat-label">GST Registered</span>
            <span className="stat-value">{withGst}</span>
            <span className="stat-foot">{Math.round((withGst / companies.length) * 100)}% coverage</span>
          </div>
          <div className="card stat" style={{ border: 'none', background: 'var(--surface-2)' }}>
            <span className="stat-label">MSME Registered</span>
            <span className="stat-value">{withMsme}</span>
            <span className="stat-foot">{Math.round((withMsme / companies.length) * 100)}% coverage</span>
          </div>
        </div>

        <div style={{ marginTop: 24 }}>
          <span className="label" style={{ marginBottom: 12, display: 'block' }}>Entity Types Breakdown</span>
          <div className="grid grid-4" style={{ gap: 12 }}>
            {Object.entries(entityTypes).map(([type, count]) => (
              <div key={type} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)' }}>
                <span style={{ fontSize: 14 }}>{ENTITY_LABEL[type] || titleise(type)}</span>
                <span style={{ fontWeight: 600 }}>{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function RegistrationDonut({ registered, mandatory, eligible }: { registered: number; mandatory: number; eligible: number }) {
  const total = registered + mandatory + eligible || 1;
  const radius = 15.9155; // circumference = 100
  const circumference = 100;
  
  const compPct = (registered / total) * 100;
  const missPct = (mandatory / total) * 100;
  const naPct = (eligible / total) * 100;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
      <svg width="72" height="72" viewBox="0 0 36 36" style={{ transform: 'rotate(-90deg)', overflow: 'visible' }}>
        {eligible > 0 && (
          <circle cx="18" cy="18" r={radius} fill="transparent" stroke="var(--border-strong)" strokeWidth="4.5" 
            strokeDasharray={`${naPct} ${circumference - naPct}`} strokeDashoffset={100 - (compPct + missPct)} />
        )}
        {mandatory > 0 && (
          <circle cx="18" cy="18" r={radius} fill="transparent" stroke="var(--critical)" strokeWidth="4.5" 
            strokeDasharray={`${missPct} ${circumference - missPct}`} strokeDashoffset={100 - compPct} />
        )}
        {registered > 0 && (
          <circle cx="18" cy="18" r={radius} fill="transparent" stroke="var(--good)" strokeWidth="4.5" 
            strokeDasharray={`${compPct} ${circumference - compPct}`} strokeDashoffset={0} />
        )}
        <text x="18" y="18" textAnchor="middle" dy="0.3em" fontSize="10px" fontWeight="600" fill="var(--text)" style={{ transform: 'rotate(90deg)', transformOrigin: 'center' }}>
          {registered}/{total}
        </text>
      </svg>
      <div className="stack" style={{ gap: 6 }}>
        <span className="tiny" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className="dot" style={{ background: 'var(--good)' }}/> {registered} Registered</span>
        <span className="tiny" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className="dot" style={{ background: 'var(--critical)' }}/> {mandatory} Required</span>
        <span className="tiny" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className="dot" style={{ background: 'var(--border-strong)' }}/> {eligible} Eligible</span>
      </div>
    </div>
  );
}

/**
 * A director's DIN standing, or a safe blank.
 *
 * The two API implementations do not ship together, so a browser talking to an
 * edge function that predates this field gets directors without it — and
 * reading `.state` off undefined took the entire dashboard down. A missing
 * verdict is exactly the UNKNOWN case, which renders as nothing, so the page
 * degrades to how it looked before the feature instead of to a blank screen.
 */
const NO_DIN_STATUS: DinStatus = {
  state: 'UNKNOWN', label: '', action: null, derived: true, asOfPeriod: null,
};
const dinOf = (dir: { dinStatus?: DinStatus }): DinStatus => dir.dinStatus ?? NO_DIN_STATUS;

export function Dashboard() {
  const { companies, selectedId, selected } = useCompanies();
  const [drawerOpen, setDrawerOpen] = useState(false);
  
  const { data, error, initial } = useResource<Overview>(
    `/dashboard/overview${qs({ companyId: selectedId ?? undefined })}`,
    [selectedId],
  );
  const { data: docsData } = useResource<{ rows: DocumentItem[] }>(selectedId ? `/documents?companyId=${selectedId}` : null, [selectedId]);

  if (error) return <ErrorNote error={error} />;
  if (initial || !data) return <Loading label="Building the compliance picture" />;

  const { score, statusCounts, severityCounts, evidence, registrations } = data;
  
  const regRegistered = registrations.filter(r => r.status === 'REGISTERED').length;
  const regMandatory = registrations.filter(r => r.status === 'MANDATORY' || r.status === 'EXPIRED_RENEWAL_DUE').length;
  const regEligible = registrations.filter(r => r.status === 'ELIGIBLE' || r.status === 'PENDING_APPLICATION').length;

  // The same window the tile counts, handed to the task list so the two agree.
  const isoToday = new Date().toISOString().slice(0, 10);
  const isoIn30Days = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const totalItems = Object.values(statusCounts).reduce((a, b) => a + b, 0);
  const openBySeverity = Object.entries(severityCounts).filter(([, v]) => v > 0);
  const openTotal = openBySeverity.reduce((a, [, v]) => a + v, 0);

  return (
    <>
      {/* Only with one company in view: org-wide there is no single entity to
          describe, and the stat row above answers a different question. Say so,
          rather than leaving the card's absence to be read as a missing feature. */}
      {data.profile ? (
        <EntityCard profile={data.profile} logoStorageKey={selected?.logoStorageKey} registrations={registrations} />
      ) : companies.length > 1 && (
        <PortfolioOverview companies={companies} />
      )}

      {selected
        && !selected.profileConfirmedAt && (
        <div className="alert alert-info"
            style={{ marginBottom: 16, marginTop: 8 }}>
          <p>
            Complete your company profile for accurate compliance tracking.
            Adding turnover, employee count, and GST status ensures the engine
            shows obligations that actually apply to you.
          </p>
          <Link to={`/companies/${selected.id}/edit`}
            style={{
              display: 'inline-block',
              marginTop: 8,
              padding: '6px 12px',
              background: 'var(--accent)',
              color: 'white',
              borderRadius: '4px',
              fontSize: '12px',
              fontWeight: 500,
            }}>
            Update Profile
          </Link>
        </div>
      )}



      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <div className="card stat" style={{ cursor: 'pointer' }} onClick={() => data.profile && setDrawerOpen(true)}>
          <span className="stat-label">Registration Status (Click for details)</span>
          <RegistrationDonut registered={regRegistered} mandatory={regMandatory} eligible={regEligible} />
        </div>
        <div className="card stat">
          <span className="stat-label">Recurring Compliance</span>
          <div className="gauge">
            <span className="gauge-num">{score.score}</span>
            <span className={`gauge-band band-${score.band}`}>{score.band}</span>
          </div>
          <span className="stat-foot">
            {score.assessed} obligations assessed · {score.onTime} on time, {score.late} late
          </span>
        </div>
      </div>

      <div className="grid grid-3">
        <Stat
          label="Overdue"
          value={statusCounts.OVERDUE}
          tone={statusCounts.OVERDUE > 0 ? 'critical' : undefined}
          to="/tasks?overdue=1"
          foot={
            score.preOnboarding > 0
              ? `${score.preOnboarding} predate onboarding — unscored, need review`
              : 'All within the scored window'
          }
        />

        <Stat
          label="Due in next 30 days"
          value={score.dueInNext30Days}
          to={`/tasks?from=${isoToday}&to=${isoIn30Days}`}
          foot={`${statusCounts.UPCOMING + statusCounts.DUE} open in total`}
        />

        <Stat
          label="Evidence coverage"
          value={`${evidence.coveragePct}%`}
          to="/documents"
          foot={`${evidence.itemsWithEvidence} of ${evidence.itemsRequiringEvidence} obligations documented`}
        />
      </div>

      <div className="grid grid-2">
        <Card title="Calendar" note={`${totalItems} items`}>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            {(['OVERDUE', 'DUE', 'UPCOMING', 'COMPLETED', 'WAIVED'] as const).map((s) => (
              <div key={s} className="row">
                <Badge value={s} />
                <div className="meter" style={{ flex: 1, marginLeft: 4 }}>
                  <span
                    style={{
                      width: `${totalItems ? (statusCounts[s] / totalItems) * 100 : 0}%`,
                      background: s === 'OVERDUE' ? 'var(--critical)' : s === 'COMPLETED' ? 'var(--good)' : s === 'DUE' ? 'var(--high)' : 'var(--border-strong)',
                    }}
                  />
                </div>
                <span className="tiny muted" style={{ width: 42, textAlign: 'right' }}>{statusCounts[s]}</span>
              </div>
            ))}

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 11, marginTop: 2 }}>
              <span className="tiny dim">Open work by severity</span>
              <div className="meter" style={{ marginTop: 7, height: 9 }}>
                {openBySeverity.map(([sev, n]) => (
                  <span key={sev} style={{ width: `${(n / openTotal) * 100}%`, background: SEVERITY_COLOUR[sev] }} />
                ))}
              </div>
              <div className="row row-wrap" style={{ marginTop: 8, gap: 12 }}>
                {openBySeverity.map(([sev, n]) => (
                  <span key={sev} className="row tiny muted" style={{ gap: 5 }}>
                    <SeverityDot value={sev as never} /> {titleise(sev)} {n}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Card>

        <Card title="By authority">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Authority</th><th className="right">Total</th><th className="right">Overdue</th>
                  <th className="right">Done</th><th className="right">Score</th>
                </tr>
              </thead>
              <tbody>
                {data.byAuthority.map((row) => {
                  const s = score.byAuthority.find((a) => a.authority === row.authority);
                  return (
                    <tr key={row.authority}>
                      <td style={{ fontWeight: 550 }}>{AUTHORITY_LABEL[row.authority]}</td>
                      <td className="right muted">{row.total}</td>
                      <td className="right" style={{ color: row.overdue ? 'var(--critical)' : 'var(--text-3)', fontWeight: row.overdue ? 600 : 400 }}>
                        {row.overdue}
                      </td>
                      <td className="right muted">{row.completed}</td>
                      <td className="right" style={{ fontWeight: 600 }}>{s ? `${s.score}` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {score.preOnboarding > 0 && (
        <div className="alert alert-info">
          <strong>{score.preOnboarding} obligations fell due before {selected ? selected.legalName : 'these entities'} were onboarded.</strong>{' '}
          The calendar is back-filled on setup, so these appear as overdue — but the toolkit has no way to know whether
          they were filed before you signed up. They are excluded from the score until you mark each one completed or
          waived. <Link to="/calendar?status=OVERDUE">Review them →</Link>
        </div>
      )}

      {drawerOpen && data.profile && (
        <RegistrationBreakdownDrawer
          profile={data.profile}
          registrations={data.registrations}
          docs={docsData?.rows || []}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </>
  );
}
