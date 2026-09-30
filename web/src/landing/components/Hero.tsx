import { Link } from 'react-router-dom';
import {
  DASH_FIELDS, DASH_REGISTRATIONS, DASH_STATS, DASH_TASKS, DEMO_CO, HERO,
} from '../data';
import { Icon } from '../icons';
import { DemoTag, Reveal, StatusPill } from './primitives';

/**
 * The hero's product surface. Every value in here is sample data, and the
 * disclosure is not a footnote — it is pinned in the frame's own toolbar and
 * repeated inside the business-information card, so a screenshot of any single
 * crop of this page still carries it.
 *
 * Compliance health is drawn as a ring rather than a bar because it is one
 * number out of 100; a stacked bar would imply parts of a whole that a health
 * score is not made of.
 */
function HealthRing({ value }: { value: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="lp-ring" style={{ width: 68, height: 68 }}>
      <svg width="68" height="68" aria-hidden="true">
        <circle className="track" cx="34" cy="34" r={r} strokeWidth="7" />
        <circle
          className="fill" cx="34" cy="34" r={r} strokeWidth="7"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - value / 100)}
        />
      </svg>
      <span className="lp-ring-label">
        <b>{value}%</b>
        <span>Health</span>
      </span>
    </div>
  );
}

export function DashboardPreview() {
  return (
    <div className="lp-appframe lp-ui">
      <div className="lp-appframe-bar">
        <span className="lp-dots" aria-hidden="true"><i /><i /><i /></span>
        <span className="lp-appframe-url">app.complaudi.com / dashboard</span>
        <DemoTag>{DEMO_CO.disclaimer}</DemoTag>
      </div>

      <div className="lp-appframe-body">
        <div className="lp-dash-top">
          <div className="lp-dash-co">
            <span className="lp-dash-co-mark" aria-hidden="true">{DEMO_CO.initials}</span>
            <span style={{ minWidth: 0 }}>
              <span className="lp-dash-co-name">{DEMO_CO.name}</span>
              <span className="lp-dash-co-meta">
                <span style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '0.03em' }}>{DEMO_CO.cin}</span>
                {' · '}{DEMO_CO.entityType}
              </span>
            </span>
          </div>
          <div className="lp-dash-top-right">
            <StatusPill status={{ tone: 'good', label: 'Business Verified', glyph: '✓' }} />
            <span className="lp-demo-tag">Demo workspace</span>
          </div>
        </div>

        <div className="lp-dash-stats">
          {DASH_STATS.map((s) => (
            <div key={s.label} className={`lp-dash-stat is-${s.tone}`}>
              <b>{s.value}</b>
              <span>{s.label}</span>
              <span style={{ opacity: 0.75 }}>{s.foot}</span>
            </div>
          ))}
        </div>

        <div className="lp-dash-cols">
          <div className="lp-ui-card">
            <div className="lp-ui-head">
              <p className="lp-ui-panel-title">Registrations &amp; Verification</p>
              <span className="lp-ui-label" style={{ marginLeft: 'auto' }}>{DASH_REGISTRATIONS.length} tracked</span>
            </div>
            {DASH_REGISTRATIONS.map((r) => (
              <div key={r.title} className="lp-stat-row">
                <span className={`lp-stat-row-icon is-${r.status.tone}`}>
                  <Icon name={r.icon} size={15} />
                </span>
                <span className="lp-stat-row-text">
                  <b>{r.title}</b>
                  <span>{r.note}</span>
                </span>
                <StatusPill status={r.status} />
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
            <div className="lp-ui-card">
              <div className="lp-ui-head"><p className="lp-ui-panel-title">Compliance Health</p></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <HealthRing value={92} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="lp-bar" role="img" aria-label="Compliance health: 92 percent">
                    <i className="seg-good" style={{ width: '78%' }} />
                    <i className="seg-warn" style={{ width: '14%' }} />
                    <i className="seg-info" style={{ width: '8%' }} />
                  </div>
                  <p style={{ fontSize: 11.5, color: 'var(--lp-text-3)', marginTop: 8, lineHeight: 1.45 }}>
                    11 of 14 obligations complete. 1 needs attention.
                  </p>
                </div>
              </div>
            </div>

            <div className="lp-ui-card">
              <div className="lp-ui-head">
                <p className="lp-ui-panel-title">Upcoming Tasks</p>
                <span className="lp-ui-label" style={{ marginLeft: 'auto' }}>Next 30 days</span>
              </div>
              {DASH_TASKS.map((t) => (
                <div key={t.title} className="lp-task">
                  <span className={`lp-task-box${t.done ? ' is-done' : ''}`} aria-hidden="true">
                    {t.done && <Icon name="check" size={11} strokeWidth={3} />}
                  </span>
                  <span className="lp-task-text">
                    <b>{t.title}</b>
                    <span>{t.due}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lp-ui-card" style={{ marginTop: 14 }}>
          <div className="lp-ui-head">
            <p className="lp-ui-panel-title">Business Information</p>
            <span className="lp-demo-tag" style={{ marginLeft: 'auto' }}>Sample data</span>
          </div>
          <dl className="lp-verify-fields">
            {DASH_FIELDS.map((f) => (
              <div key={f.label} className={`lp-verify-field-cell${f.full ? ' is-full' : ''}`}>
                <dt>{f.label}</dt>
                <dd className={f.mono ? 'mono' : undefined}>{f.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}

export function Hero() {
  const [lead, emphasis] = HERO.headlineParts;

  return (
    <section className="lp-hero" aria-labelledby="lp-hero-h1">
      <div className="lp-container is-wide">
        <div className="lp-hero-grid">
          <div>
            <Reveal>
              <span className="lp-eyebrow">
                <span className="lp-eyebrow-dot" aria-hidden="true" />
                {HERO.eyebrow}
              </span>
              <h1 id="lp-hero-h1">
                {lead.text}
                <em>{emphasis.text}</em>
              </h1>
              <p className="lp-hero-copy">{HERO.copy}</p>

              <div className="lp-hero-cta">
                <Link to="/register" className="btn-lp btn-primary btn-lg">Get Started</Link>
                <a href="#solutions" className="btn-lp btn-secondary btn-lg">Explore Complaudi</a>
              </div>

              <p className="lp-hero-trust">
                <span className="tick" aria-hidden="true"><Icon name="check" size={15} strokeWidth={2.6} /></span>
                {HERO.trust}
              </p>
            </Reveal>
          </div>

          <Reveal delay={2}>
            <ul className="lp-hero-facts" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none' }}>
              {HERO.facts.map((f) => (
                <li key={f} className="lp-hero-fact">
                  <Icon name="check" size={15} strokeWidth={2.4} />
                  {f}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </div>

      {/* Overlaps the hero's lower edge. A dashboard that breaks its container
          boundary reads as the product; one that sits inside a rounded card
          reads as a picture of it. */}
      <div className="lp-container is-wide lp-hero-frame">
        <Reveal delay={3}>
          <div className="lp-float">
            <DashboardPreview />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
