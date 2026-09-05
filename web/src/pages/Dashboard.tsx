import { Link } from 'react-router-dom';
import { qs } from '../api/client';
import { useResource } from '../api/useResource';
import { useCompanies } from '../auth/CompanyContext';
import type { Company, CompanyProfile, Overview } from '../api/types';
import {
  AUTHORITY_LABEL, Badge, Card, Empty, ENTITY_LABEL, ErrorNote, Loading,
  SeverityDot, Stat, fmtDate, titleise, initials,
} from '../components/ui';

const SEVERITY_COLOUR: Record<string, string> = {
  CRITICAL: 'var(--critical)', HIGH: 'var(--high)', MEDIUM: 'var(--medium)', LOW: 'var(--text-3)',
};

/** One registration. Held ones are marked; the rest say so and step back. */
function Reg({ label, value, foot }: { label: string; value: string | null; foot?: string }) {
  return (
    <div className={`reg-tile ${value ? 'held' : 'empty'}`}>
      <span className="reg-label">{label}</span>
      <span className={`reg-value${value ? '' : ' na'}`}>{value ?? 'Not held'}</span>
      {foot && <span className="reg-foot">{foot}</span>}
    </div>
  );
}

/** A standing question with a one-word answer, coloured by the answer. */
function Status({ label, value, foot, tone }: {
  label: string; value: string; foot: string; tone: 'good' | 'bad' | 'warn' | 'idle';
}) {
  const colour = tone === 'good' ? 'var(--good)' : tone === 'bad' ? 'var(--critical)'
    : tone === 'warn' ? 'var(--high)' : 'var(--text-3)';
  return (
    <div className="status-pill">
      <span className="dot" style={{ background: colour }} />
      <div className="stack" style={{ minWidth: 0, gap: 1 }}>
        <span className="status-pill-label">{label}</span>
        <span className="status-pill-value" style={{ color: colour }}>{value}</span>
        <span className="status-pill-foot">{foot}</span>
      </div>
    </div>
  );
}

const DSC_VIEW = {
  ACTIVE: { word: 'Active', tone: 'good' },
  EXPIRED: { word: 'Expired', tone: 'bad' },
  NOT_RECORDED: { word: 'Not recorded', tone: 'idle' },
} as const;

const KYC_VIEW = {
  MET: { word: 'Met', tone: 'good' },
  NOT_MET: { word: 'Not met', tone: 'bad' },
  NOT_DUE: { word: 'Not yet due', tone: 'warn' },
  NOT_APPLICABLE: { word: 'Not applicable', tone: 'idle' },
} as const;

/**
 * The entity itself, before anything it owes.
 *
 * Three bands, because a reviewer asks three questions in order: who is this,
 * is it in good standing, and what does it hold. A flat grid of equal tiles
 * answered all three at the same volume — and gave a blank the same weight as
 * a registration number.
 */
function EntityCard({ profile }: { profile: CompanyProfile }) {
  const { dsc, mcaKyc, msme, gstins, dpiit } = profile;
  const live = gstins.filter((g) => g.isActive);
  const dscView = DSC_VIEW[dsc.status];
  const kycView = KYC_VIEW[mcaKyc.status];

  return (
    <div className="card">
      <header className="entity-head">
        <div className="entity-mark">{initials(profile.legalName)}</div>
        <div className="stack" style={{ minWidth: 0, gap: 3 }}>
          <span className="entity-name">{profile.legalName}</span>
          <span className="entity-sub">
            {ENTITY_LABEL[profile.entityType] ?? titleise(profile.entityType)}
            {profile.incorporationDate && ` · Incorporated ${fmtDate(profile.incorporationDate)}`}
            {profile.ageYears !== null && ` · ${profile.ageYears} year${profile.ageYears === 1 ? '' : 's'} old`}
          </span>
        </div>
        {profile.registrationNumber && (
          <div className="entity-id">
            <span className="entity-id-label">{profile.registrationLabel}</span>
            <span className="entity-id-value">{profile.registrationNumber}</span>
            {profile.pan && profile.registrationLabel !== 'PAN' && (
              <span className="entity-id-label">PAN {profile.pan}</span>
            )}
          </div>
        )}
      </header>

      <div className="status-strip">
        <Status
          label="DSC"
          value={dscView.word}
          tone={dscView.tone}
          foot={
            dsc.status === 'NOT_RECORDED'
              ? `No expiry on record for ${dsc.total} director${dsc.total === 1 ? '' : 's'}`
              : `${dsc.active} of ${dsc.total} current${dsc.nextExpiry ? ` · next expires ${fmtDate(dsc.nextExpiry)}` : ''}`
          }
        />
        <Status
          label="MCA KYC · DIR-3"
          value={kycView.word}
          tone={kycView.tone}
          foot={
            mcaKyc.status === 'NOT_APPLICABLE'
              ? 'No DIN on record, so none is raised'
              : `${mcaKyc.periodLabel ?? ''}${mcaKyc.dueDate ? ` · due ${fmtDate(mcaKyc.dueDate)}` : ''}`
          }
        />
      </div>

      <div className="reg-grid">
        <Reg
          label="GSTIN"
          value={live[0]?.gstin ?? null}
          foot={
            live.length > 1 ? `${live[0]!.stateCode} · ${live.length - 1} more state${live.length === 2 ? '' : 's'}`
              : live.length === 1 ? live[0]!.stateCode : 'Not registered'
          }
        />
        <Reg
          label="MSME · Udyam"
          value={msme?.udyamNumber ?? null}
          foot={msme ? `${titleise(msme.category)}${msme.registeredOn ? ` · ${fmtDate(msme.registeredOn)}` : ''}` : 'Not registered'}
        />
        <Reg
          label="DPIIT · Startup India"
          value={dpiit?.number ?? null}
          foot={dpiit?.recognisedOn ? `Recognised ${fmtDate(dpiit.recognisedOn)}` : dpiit ? undefined : 'Not recognised'}
        />
        <Reg label="PF · EPFO" value={profile.epfoCode} foot={profile.epfoCode ? undefined : 'Not enrolled'} />
        <Reg label="ESI · ESIC" value={profile.esicCode} foot={profile.esicCode ? undefined : 'Not enrolled'} />
      </div>

      <div className="row" style={{ padding: '0 18px 8px' }}>
        <span className="reg-label">Directors on record</span>
        <span className="tiny dim" style={{ marginLeft: 'auto' }}>{profile.directors.length} serving</span>
      </div>
      {profile.directors.length === 0 ? (
        <div style={{ padding: '0 18px 16px' }}><Empty>No directors recorded yet.</Empty></div>
      ) : (
        <div className="dir-strip">
          {profile.directors.map((dir) => (
            <span key={dir.id} className="dir-chip">
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
          <div className="card stat" style={{ border: 'none', background: 'var(--bg-2)' }}>
            <span className="stat-label">Total Companies</span>
            <span className="stat-value">{companies.length}</span>
            <span className="stat-foot">{activeCount} active · {companies.length - activeCount} archived</span>
          </div>
          <div className="card stat" style={{ border: 'none', background: 'var(--bg-2)' }}>
            <span className="stat-label">Total Directors</span>
            <span className="stat-value">{totalDirectors}</span>
            <span className="stat-foot">Across all entities</span>
          </div>
          <div className="card stat" style={{ border: 'none', background: 'var(--bg-2)' }}>
            <span className="stat-label">GST Registered</span>
            <span className="stat-value">{withGst}</span>
            <span className="stat-foot">{Math.round((withGst / companies.length) * 100)}% coverage</span>
          </div>
          <div className="card stat" style={{ border: 'none', background: 'var(--bg-2)' }}>
            <span className="stat-label">MSME Registered</span>
            <span className="stat-value">{withMsme}</span>
            <span className="stat-foot">{Math.round((withMsme / companies.length) * 100)}% coverage</span>
          </div>
        </div>

        <div style={{ marginTop: 24 }}>
          <span className="label" style={{ marginBottom: 12, display: 'block' }}>Entity Types Breakdown</span>
          <div className="grid grid-4" style={{ gap: 12 }}>
            {Object.entries(entityTypes).map(([type, count]) => (
              <div key={type} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-1)' }}>
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

export function Dashboard() {
  const { companies, selectedId, selected } = useCompanies();
  const { data, error, initial } = useResource<Overview>(
    `/dashboard/overview${qs({ companyId: selectedId ?? undefined })}`,
    [selectedId],
  );

  if (error) return <ErrorNote error={error} />;
  if (initial || !data) return <Loading label="Building the compliance picture" />;

  const { score, statusCounts, severityCounts, evidence } = data;
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
        <EntityCard profile={data.profile} />
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
              background: 'var(--primary)',
              color: 'white',
              borderRadius: '4px',
              fontSize: '12px',
              fontWeight: 500,
            }}>
            Update Profile
          </Link>
        </div>
      )}

      <div className="grid grid-4">
        <div className="card stat">
          <span className="stat-label">Compliance score</span>
          <div className="gauge">
            <span className="gauge-num">{score.score}</span>
            <span className={`gauge-band band-${score.band}`}>{score.band}</span>
          </div>
          <span className="stat-foot">
            {score.assessed} obligations assessed · {score.onTime} on time, {score.late} late
          </span>
        </div>

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

    </>
  );
}
