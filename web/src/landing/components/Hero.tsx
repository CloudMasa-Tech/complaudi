import { Link } from 'react-router-dom';
import { HERO } from '../data';
import { Icon } from '../icons';
import { Reveal, StatusPill } from './primitives';
import { RealDashboardPreview } from './RealDashboardPreview';

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



export function Hero() {
  const [lead, emphasis] = HERO.headlineParts;

  return (
    <section className="lp-hero-premium" aria-labelledby="lp-hero-h1">
      <div className="lp-container is-wide">
        <div className="lp-hero-premium-content lp">
          <Reveal>
            <span className="lp-hero-premium-eyebrow">
              <i aria-hidden="true" />
              {HERO.eyebrow}
            </span>
            <h1 id="lp-hero-h1">
              {lead.text}
              <em>{emphasis.text}</em>
            </h1>
            <p className="lp-hero-premium-copy">{HERO.copy}</p>

            <div className="lp-hero-premium-actions">
              <Link to="/register" className="btn-lp btn-premium-primary btn-lg">Get Started</Link>
              <a href="#solutions" className="btn-lp btn-premium-secondary btn-lg">Explore Complaudi</a>
            </div>

            <p className="lp-hero-trust" style={{ marginTop: 24, color: 'var(--lp-text-3)' }}>
              <span className="tick" aria-hidden="true" style={{ color: 'var(--lp-premium-blue)' }}><Icon name="check" size={15} strokeWidth={2.6} /></span>
              {HERO.trust}
            </p>
          </Reveal>
        </div>

        <div className="lp-hero-visual-wrapper">
          <div className="lp-hero-visual-main">
            <RealDashboardPreview />
          </div>
          
          <div className="lp-hero-visual-float-1 lp">
            <StatusPill status={{ tone: 'good', label: 'Business Verified', glyph: '✓' }} />
          </div>
          
          <div className="lp-hero-visual-float-2 lp">
            <HealthRing value={92} />
          </div>
        </div>
      </div>
    </section>
  );
}
