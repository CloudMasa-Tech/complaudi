import { Link } from 'react-router-dom';
import {
  CTA, CTA_SECTION, PROBLEM, SECURITY, SOLUTION, STEPS, USE_CASES, WHY,
} from '../data';
import { Icon } from '../icons';
import { IconPlate, Reveal, SectionHead } from './primitives';

/* ── problem ─────────────────────────────────────────────────────────────
 * The cards are deliberately plain. The point of this section is to name a
 * familiar frustration, and a design that competes with that message works
 * against it.
 */
export function ProblemSection() {
  return (
    <section className="lp-section-premium" id="problem" aria-labelledby="lp-problem-h">
      <div className="lp-container is-wide">
        <SectionHead
          eyebrow={PROBLEM.eyebrow}
          headline={PROBLEM.headline}
          lede={PROBLEM.lede}
          centered
          id="lp-problem-h"
        />
        <div className="lp-bento-grid">
          {PROBLEM.items.map((p, i) => {
            // Asymmetric bento sizing
            const cols = i === 0 ? 'lp-bento-col-8' : i === 1 ? 'lp-bento-col-4' : i === 2 ? 'lp-bento-col-4' : 'lp-bento-col-8';
            return (
              <Reveal key={p.title} as="article" delay={i} className={`lp-bento-item ${cols}`}>
                <IconPlate name={p.icon} />
                <h3 className="lp-card-title">{p.title}</h3>
                <p className="lp-card-body" style={{ marginTop: 12 }}>{p.body}</p>
              </Reveal>
            );
          })}
        </div>
        <Reveal delay={1}>
          <p className="lp-problem-note" style={{ textAlign: 'center', marginTop: 40, color: 'var(--lp-text-3)' }}>{PROBLEM.note}</p>
        </Reveal>
      </div>
    </section>
  );
}

/* ── solution ────────────────────────────────────────────────────────────
 * Six stages, with verification lifted out of the row on a raised card. The
 * lift is the whole point: this is the capability the product is organised
 * around, so it should be the thing the eye lands on first.
 */
export function SolutionWorkflow() {
  return (
    <section className="lp-section-premium" style={{ background: 'var(--lp-premium-light-blue)' }} id="solutions" aria-labelledby="lp-solution-h">
      <div className="lp-container is-wide" style={{ position: 'relative' }}>
        <SectionHead
          eyebrow={SOLUTION.eyebrow}
          headline={SOLUTION.headline}
          lede={SOLUTION.lede}
          centered
          wide
          id="lp-solution-h"
        />
        
        <div className="lp-flow-container" style={{ position: 'relative', marginTop: 40 }}>
          <div className="lp-flow-glow-line" />
          <ol className="lp-flow">
            {SOLUTION.steps.map((s, i) => (
              <Reveal
                as="li"
                key={s.title}
                delay={i}
                className={`lp-flow-step${s.focus ? ' is-focus' : ''} lp-premium-flow-step`}
              >
                <div className="lp-flow-node-glow" aria-hidden="true" />
                <span className="lp-flow-num" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                <span className="lp-flow-icon">
                  <Icon name={s.icon} size={20} />
                </span>
                <b>{s.title}</b>
                <p>{s.body}</p>
              </Reveal>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/* ── how it works ────────────────────────────────────────────────────────
 * The same markup is a horizontal rail at ≥900px and a vertical spine below
 * it — a media query on the container, not a second component, so the two
 * layouts can never describe different steps.
 */
export function HowItWorks() {
  return (
    <section className="lp-section-premium" style={{ background: 'var(--lp-premium-deep-blue)', color: 'white' }} id="how-it-works" aria-labelledby="lp-steps-h">
      <div className="lp-container is-wide">
        <SectionHead
          eyebrow={STEPS.eyebrow}
          headline={STEPS.headline}
          lede={STEPS.lede}
          centered
          wide
          id="lp-steps-h"
        />
        <div className="lp-steps" style={{ position: 'relative', marginTop: 40 }}>
          {STEPS.items.map((s, i) => (
            <Reveal as="article" key={s.title} delay={i} className="lp-step lp-premium-step-card">
              <span className="lp-step-dot" aria-hidden="true" style={{ background: 'var(--lp-premium-orange)', borderColor: 'rgba(234, 88, 12, 0.5)', boxShadow: '0 0 15px rgba(234, 88, 12, 0.4)' }}>{i + 1}</span>
              <span className="lp-step-num" aria-hidden="true" style={{ color: 'rgba(255, 255, 255, 0.7)' }}>STEP {String(i + 1).padStart(2, '0')}</span>
              <h3 style={{ color: 'white' }}>{s.title}</h3>
              <p style={{ color: 'rgba(255, 255, 255, 0.8)' }}>{s.body}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── why complaudi ───────────────────────────────────────────────────────
 * The page's dark break. Six properties, no icons of their own beyond one, so
 * the section reads as a statement rather than another feature grid.
 */
export function WhyComplaudi() {
  return (
    <section className="lp-section-premium is-dark" id="why" aria-labelledby="lp-why-h">
      <div className="lp-container is-wide">
        <SectionHead
          eyebrow={WHY.eyebrow}
          headline={WHY.headline}
          lede={WHY.lede}
          centered
          wide
          id="lp-why-h"
        />
        <div className="lp-bento-grid">
          {WHY.items.map((w, i) => (
            <Reveal as="article" key={w.title} delay={i % 3} className="lp-bento-item lp-bento-col-4" style={{ background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)' }}>
              <span className="lp-why-icon" aria-hidden="true" style={{ color: '#fff', marginBottom: 16, display: 'block' }}>
                <Icon name={w.icon} size={24} />
              </span>
              <b style={{ color: '#fff', fontSize: '1.1rem' }}>{w.title}</b>
              <p style={{ color: 'rgba(255,255,255,0.7)', marginTop: 8 }}>{w.body}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── use cases ────────────────────────────────────────────────────────────
 * Three checkmarks per card, all capability statements — no customer counts,
 * no adoption figures, nothing that would need a source.
 */
export function UseCases() {
  return (
    <section className="lp-section-premium" style={{ background: 'var(--lp-premium-light-blue)' }} id="use-cases" aria-labelledby="lp-uc-h">
      <div className="lp-container is-wide">
        <SectionHead
          eyebrow={USE_CASES.eyebrow}
          headline={USE_CASES.headline}
          lede={USE_CASES.lede}
          centered
          wide
          id="lp-uc-h"
        />
        <div className="lp-bento-grid" style={{ marginTop: 40 }}>
          {USE_CASES.items.map((u, i) => (
            <Reveal as="article" key={u.title} delay={i} className="lp-bento-item lp-bento-col-4">
              <span className="lp-uc-tag" style={{ background: 'rgba(37, 99, 235, 0.1)', color: 'var(--lp-premium-blue)' }}>{u.tag}</span>
              <h3 className="lp-card-title">{u.title}</h3>
              <p className="lp-card-body">{u.body}</p>
              <ul className="lp-uc-points" style={{ marginTop: 24, listStyle: 'none', padding: 0 }}>
                {u.points.map((p) => (
                  <li key={p} className="lp-uc-point" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, color: 'var(--lp-text-2)' }}>
                    <span style={{ color: 'var(--lp-premium-orange)' }}>
                      <Icon name="check" size={16} strokeWidth={3} />
                    </span>
                    {p}
                  </li>
                ))}
              </ul>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── security ────────────────────────────────────────────────────────────
 * The `boundary` panel is the most trust-building object on the page. A
 * compliance vendor that states plainly what it does not do is more credible
 * than one that claims everything, and it is also the honest reading of the
 * brief's "do not claim certifications" rule.
 */
export function SecuritySection() {
  return (
    <section className="lp-section-premium" style={{ background: 'white' }} id="security" aria-labelledby="lp-sec-h">
      <div className="lp-container is-wide">
        <SectionHead
          eyebrow={SECURITY.eyebrow}
          headline={SECURITY.headline}
          lede={SECURITY.lede}
          wide
          id="lp-sec-h"
        />
        <div className="lp-sec" style={{ marginTop: 40 }}>
          <Reveal>
            <div className="lp-claim-boundary" style={{ background: 'var(--lp-premium-light-blue)', border: '1px solid rgba(37, 99, 235, 0.1)' }}>
              <h3 style={{ color: 'var(--lp-premium-deep-blue)' }}>{SECURITY.boundaryTitle}</h3>
              <ul>
                {SECURITY.boundary.map((b) => (
                  <li key={b} style={{ color: 'var(--lp-text-2)' }}>
                    <span style={{ color: 'var(--lp-premium-blue)' }}>
                      <Icon name="minus" size={15} strokeWidth={2.5} />
                    </span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>

          <div className="lp-bento-grid" style={{ gridTemplateColumns: '1fr', gap: 16 }}>
            {SECURITY.items.map((s, i) => (
              <Reveal as="article" key={s.title} delay={i % 2} className="lp-bento-item" style={{ display: 'flex', gap: 20, alignItems: 'flex-start', padding: 24 }}>
                <span className="lp-sec-icon" aria-hidden="true" style={{ background: 'var(--lp-premium-blue)', color: 'white', padding: 12, borderRadius: 12 }}>
                  <Icon name={s.icon} size={20} />
                </span>
                <span>
                  <b style={{ fontSize: '1.1rem', color: 'var(--lp-premium-deep-blue)' }}>{s.title}</b>
                  <p style={{ marginTop: 8, color: 'var(--lp-text-2)' }}>{s.body}</p>
                </span>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── closing cta ───────────────────────────────────────────────────────── */
export function CTASection() {
  return (
    <section className="lp-cta-premium" aria-labelledby="lp-cta-h">
      <div className="lp-cta-premium-inner">
        <Reveal>
          <span className="lp-hero-premium-eyebrow" style={{ background: 'rgba(255,255,255,0.15)', borderColor: 'rgba(255,255,255,0.3)', color: '#fff' }}>
            {CTA_SECTION.eyebrow}
          </span>
          <h2 id="lp-cta-h">{CTA_SECTION.headline}</h2>
          <p>{CTA_SECTION.copy}</p>

          <div className="lp-hero-premium-actions">
            <Link to="/register" className="btn-lp btn-premium-primary btn-lg">{CTA.primary}</Link>
            <a href="#contact" className="btn-lp btn-premium-secondary btn-lg">{CTA.talk}</a>
          </div>

          <ul style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 24, marginTop: 40, listStyle: 'none', padding: 0 }}>
            {CTA_SECTION.fine.map((f) => (
              <li key={f} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 14, color: 'rgba(255,255,255,0.8)' }}>
                <Icon name="check" size={14} strokeWidth={2.4} />
                {f}
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
