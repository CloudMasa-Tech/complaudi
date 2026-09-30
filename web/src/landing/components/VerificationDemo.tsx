import { useEffect, useRef, useState } from 'react';
import { DEMO_CIN_REVEAL_MS, DEMO_CO, VERIFY, VERIFY_RESULT } from '../data';
import { Icon } from '../icons';
import { ConceptNote, DemoTag, Reveal, SectionHead } from './primitives';

type Phase = 'idle' | 'typing' | 'searching' | 'done';

/**
 * The scripted verification sequence: idle → typing → searching → done.
 *
 * This is a *demonstration of the interface*, and the product rule is that no
 * verification logic lives on the landing page. There is no fetch, no CIN
 * check, no validation — the result is a constant in data.ts and this component
 * only decides when to show it. The result panel is labelled as concept data on
 * the panel itself, and the "planned" state of every provider is stated in the
 * sources grid below, so nothing on the page can be read as a live connection.
 *
 * Under `prefers-reduced-motion` the whole sequence is skipped: the field is
 * pre-filled and the result is rendered immediately, so the same information is
 * available without a 4-second animation.
 */
const TYPING_MS = DEMO_CO.cin.length * DEMO_CIN_REVEAL_MS;
const SEARCH_MS = 900;

export function VerificationDemo() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [typed, setTyped] = useState('');
  const timers = useRef<number[]>([]);

  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      setReduced(mq.matches);
      // The initial value is read in this effect rather than in useState,
      // because a lazy initialiser would capture the media query during the
      // first render and then miss a preference changed later. When the
      // preference is on, the result has to be *there* — a reduced-motion
      // visitor must not have to press a button to see the outcome.
      if (mq.matches) {
        setTyped(DEMO_CO.cin);
        setPhase('done');
      }
    };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const clear = () => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  };

  useEffect(() => clear, []);

  const run = () => {
    clear();
    if (reduced) {
      setTyped(DEMO_CO.cin);
      setPhase('done');
      return;
    }
    setTyped('');
    setPhase('typing');

    const at = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)); };

    for (let i = 1; i <= DEMO_CO.cin.length; i += 1) {
      at(i * DEMO_CIN_REVEAL_MS, () => setTyped(DEMO_CO.cin.slice(0, i)));
    }
    at(TYPING_MS + 260, () => setPhase('searching'));
    at(TYPING_MS + 260 + SEARCH_MS, () => setPhase('done'));
  };

  const searching = phase === 'searching';
  const done = phase === 'done';
  const showResult = done;

  return (
    <section className="lp-section lp-band-light" id="verification" aria-labelledby="lp-verify-h">
      <div className="lp-container is-wide">
        <SectionHead
          eyebrow={VERIFY.eyebrow}
          headline={VERIFY.headline}
          lede={VERIFY.lede}
          wide
          id="lp-verify-h"
        />

        <div className="lp-verify">
          {/* copy column */}
          <Reveal className="lp-verify-copy">
            <ul className="lp-verify-points">
              {VERIFY.points.map((p) => (
                <li key={p.title} className="lp-verify-point">
                  <span className="lp-verify-point-icon" aria-hidden="true">
                    <Icon name={p.icon} size={14} />
                  </span>
                  <span>
                    <b>{p.title}</b>
                    <p>{p.body}</p>
                  </span>
                </li>
              ))}
            </ul>
          </Reveal>

          {/* the demo */}
          <Reveal delay={1}>
            <div className="lp-appframe lp-verify-ui lp-ui">
              <div className="lp-appframe-bar">
                <span className="lp-dots" aria-hidden="true"><i /><i /><i /></span>
                <span className="lp-appframe-url">app.complaudi.com / verify</span>
                <DemoTag>Concept interface</DemoTag>
              </div>

              <div className="lp-appframe-body">
                <div className="lp-verify-field">
                  <label htmlFor="lp-cin">
                    <span>Enter CIN</span>
                    <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>
                      Demo — no lookup is performed
                    </span>
                  </label>
                  <div className="lp-cin-input">
                    <input
                      id="lp-cin"
                      value={typed}
                      /* Read-only on purpose. An editable field that then
                         ignores what was typed would imply a live input; the
                         script is what fills this box. */
                      readOnly
                      placeholder="U12345AA2026PTC000000"
                      autoComplete="off"
                      spellCheck={false}
                      aria-describedby="lp-cin-hint"
                    />
                    {phase === 'typing' && <span className="lp-cin-caret" aria-hidden="true" />}
                    <span className="lp-cin-chip" aria-hidden="true">CIN</span>
                  </div>
                  <p className="lp-sr" id="lp-cin-hint">
                    Illustrative field. No company registry is contacted and no data is returned.
                  </p>
                </div>

                <button
                  type="button"
                  className="btn-lp btn-premium-primary btn-block"
                  onClick={run}
                  disabled={searching}
                >
                  {searching ? 'Verifying…' : 'Verify Company'}
                </button>

                {/* AI Verification Animation Area */}
                <div aria-live="polite" aria-atomic="true" style={{ position: 'relative', marginTop: 16 }}>
                  {searching && (
                    <div className="lp-verify-ai-sequence">
                      <div className="lp-ai-glow-pulse"></div>
                      <div className="lp-ai-scan-line"></div>
                      <p className="lp-verify-status" style={{ color: 'var(--lp-premium-blue)' }}>
                        <span className="lp-spinner is-blue" aria-hidden="true" />
                        <strong>AI Verification Processing…</strong>
                      </p>
                      <p className="lp-verify-status" style={{ color: 'var(--lp-premium-orange)', marginTop: 8 }}>
                        <span className="lp-spinner is-orange" aria-hidden="true" />
                        <strong>Data Validation in progress…</strong>
                      </p>
                    </div>
                  )}

                  {done && (
                    <div className="lp-verify-ai-sequence is-done">
                      <p className="lp-verify-status is-good" style={{ color: 'var(--lp-premium-blue)' }}>
                        <Icon name="check" size={16} strokeWidth={3} />
                        <strong>Verified</strong>
                      </p>
                      <p className="lp-verify-status is-good" style={{ color: 'var(--lp-good)', marginTop: 8 }}>
                        <Icon name="check-shield" size={16} strokeWidth={3} />
                        <strong>Compliance Status Generated</strong>
                      </p>
                    </div>
                  )}
                </div>

                {showResult && (
                  <>
                    <dl className="lp-verify-fields">
                      {VERIFY_RESULT.map((f) => (
                        <div key={f.label} className={`lp-verify-field-cell${f.full ? ' is-full' : ''}`}>
                          <dt>{f.label}</dt>
                          <dd className={f.good ? 'is-good' : undefined}>
                            {f.good && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <Icon name="check" size={14} strokeWidth={2.8} />
                                {f.value}
                              </span>
                            )}
                            {!f.good && f.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <ConceptNote>
                      <strong>Illustrative result.</strong> The interface, field set and layout shown
                      here are a concept. The company record above is sample data and is not a live
                      verification against MCA or any other registry.
                    </ConceptNote>
                  </>
                )}
              </div>
            </div>
          </Reveal>
        </div>

        {/* verification sources */}
        <div className="lp-sources">
          <Reveal>
            <SectionHead
              eyebrow={VERIFY.sourcesEyebrow}
              headline={VERIFY.sourcesHeadline}
              lede={VERIFY.sourcesLede}
              centered
              wide
            />
          </Reveal>
          <div className="lp-sources-grid">
            {VERIFY.sources.map((s, i) => (
              <Reveal key={s.name} delay={i} className="lp-source is-planned">
                <span className="lp-source-icon" aria-hidden="true">
                  <Icon name={s.icon} size={17} />
                </span>
                <span className="lp-source-text">
                  <b>{s.name}</b>
                  <span>{s.state}</span>
                </span>
              </Reveal>
            ))}
          </div>
          <Reveal delay={1}>
            <ConceptNote>
              <strong>None of these integrations are live today.</strong> Complaudi is built to
              support them through a separate verification service and a set of provider adapters.
              Each source is switched on only once it is connected and tested.
            </ConceptNote>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
