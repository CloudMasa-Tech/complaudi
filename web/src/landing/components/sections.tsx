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
    <section className="lp-section lp-band-light" id="problem" aria-labelledby="lp-problem-h">
      <div className="lp-container">
        <SectionHead
          eyebrow={PROBLEM.eyebrow}
          headline={PROBLEM.headline}
          lede={PROBLEM.lede}
          centered
          id="lp-problem-h"
        />
        <div className="lp-grid lp-grid-4">
          {PROBLEM.items.map((p, i) => (
            <Reveal key={p.title} as="article" delay={i} className="lp-card is-lift">
              <IconPlate name={p.icon} />
              <h3 className="lp-card-title">{p.title}</h3>
              <p className="lp-card-body">{p.body}</p>
            </Reveal>
          ))}
        </div>
        <Reveal delay={1}>
          <p className="lp-problem-note">{PROBLEM.note}</p>
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
    <section className="lp-section lp-band-white" id="solutions" aria-labelledby="lp-solution-h">
      <div className="lp-container is-wide">
        <SectionHead
          eyebrow={SOLUTION.eyebrow}
          headline={SOLUTION.headline}
          lede={SOLUTION.lede}
          centered
          wide
          id="lp-solution-h"
        />
        <ol className="lp-flow">
          {SOLUTION.steps.map((s, i) => (
            <Reveal
              as="li"
              key={s.title}
              delay={i}
              className={`lp-flow-step${s.focus ? ' is-focus' : ''}`}
            >
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
    <section className="lp-section lp-band-white" id="how-it-works" aria-labelledby="lp-steps-h">
      <div className="lp-container is-wide">
        <SectionHead
          eyebrow={STEPS.eyebrow}
          headline={STEPS.headline}
          lede={STEPS.lede}
          centered
          wide
          id="lp-steps-h"
        />
        <ol className="lp-steps">
          {STEPS.items.map((s, i) => (
            <Reveal as="li" key={s.title} delay={i} className="lp-step">
              <span className="lp-step-dot" aria-hidden="true">{i + 1}</span>
              <span className="lp-step-num" aria-hidden="true">STEP {String(i + 1).padStart(2, '0')}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </Reveal>
          ))}
        </ol>
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
    <section className="lp-section lp-band-dark lp-on-dark" id="why" aria-labelledby="lp-why-h">
      <div className="lp-container is-wide">
        <SectionHead
          eyebrow={WHY.eyebrow}
          headline={WHY.headline}
          lede={WHY.lede}
          centered
          wide
          id="lp-why-h"
        />
        <div className="lp-why-grid">
          {WHY.items.map((w, i) => (
            <Reveal as="article" key={w.title} delay={i % 3} className="lp-why-card">
              <span className="lp-why-icon" aria-hidden="true">
                <Icon name={w.icon} size={20} />
              </span>
              <b>{w.title}</b>
              <p>{w.body}</p>
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
    <section className="lp-section lp-band-light" id="use-cases" aria-labelledby="lp-uc-h">
      <div className="lp-container is-wide">
        <SectionHead
          eyebrow={USE_CASES.eyebrow}
          headline={USE_CASES.headline}
          lede={USE_CASES.lede}
          centered
          wide
          id="lp-uc-h"
        />
        <div className="lp-uc-grid">
          {USE_CASES.items.map((u, i) => (
            <Reveal as="article" key={u.title} delay={i} className="lp-uc">
              <span className="lp-uc-tag">{u.tag}</span>
              <h3>{u.title}</h3>
              <p>{u.body}</p>
              <ul className="lp-uc-points">
                {u.points.map((p) => (
                  <li key={p} className="lp-uc-point">
                    <Icon name="check" size={13} strokeWidth={2.6} />
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
    <section className="lp-section lp-band-white" id="security" aria-labelledby="lp-sec-h">
      <div className="lp-container is-wide">
        <SectionHead
          eyebrow={SECURITY.eyebrow}
          headline={SECURITY.headline}
          lede={SECURITY.lede}
          wide
          id="lp-sec-h"
        />
        <div className="lp-sec">
          <Reveal>
            <div className="lp-claim-boundary">
              <h3>{SECURITY.boundaryTitle}</h3>
              <ul>
                {SECURITY.boundary.map((b) => (
                  <li key={b}>
                    <Icon name="minus" size={15} strokeWidth={2.2} />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>

          <div className="lp-sec-grid">
            {SECURITY.items.map((s, i) => (
              <Reveal as="article" key={s.title} delay={i % 2} className="lp-sec-item">
                <span className="lp-sec-icon" aria-hidden="true">
                  <Icon name={s.icon} size={16} />
                </span>
                <span>
                  <b>{s.title}</b>
                  <p>{s.body}</p>
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
    <section className="lp-section lp-cta lp-on-dark" aria-labelledby="lp-cta-h">
      <div className="lp-container">
        <div className="lp-cta-inner">
          <Reveal>
            <span className="lp-eyebrow">{CTA_SECTION.eyebrow}</span>
            <h2 id="lp-cta-h" style={{ marginTop: 18 }}>{CTA_SECTION.headline}</h2>
            <p>{CTA_SECTION.copy}</p>

            <div className="lp-cta-actions">
              <Link to="/register" className="btn-lp btn-primary btn-lg">{CTA.primary}</Link>
              <a href="#contact" className="btn-lp btn-secondary btn-lg">{CTA.talk}</a>
            </div>

            <ul className="lp-cta-fine">
              {CTA_SECTION.fine.map((f) => (
                <li key={f} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                  <Icon name="check" size={14} strokeWidth={2.4} />
                  {f}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
