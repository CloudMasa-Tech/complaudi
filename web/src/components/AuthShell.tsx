import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BRAND_TAGLINE } from './Layout';
import { SEGMENTS_LINE } from './ui';

/**
 * The split screen every signed-out page sits in.
 *
 * Sign-in, forgotten password and reset all share one panel so the brand does
 * not change shape halfway through a password recovery — the reset link lands
 * on a different page from the one that sent it, and a layout change there
 * reads as "wrong site" to someone already worried about their account.
 *
 * It lives here rather than being copied into each page because it was copied
 * into each page once already, and the copies drifted.
 */
export function AuthShell({
  children,
  wide = false,
  cta = 'trial',
}: {
  children: ReactNode;
  /** Widens the form column for a multi-field form such as enrolment. */
  wide?: boolean;
  /**
   * Which card closes the panel. On the enrolment page itself a "start your
   * free trial" button would link to the page you are already on, so that page
   * points the other way instead.
   */
  cta?: 'trial' | 'signin';
}) {
  return (
    <div className={wide ? 'auth-split wide' : 'auth-split'}>
      <aside className="auth-aside">
        <div className="auth-aside-inner">
          {/* Mark and tagline are one lockup: they sit tight to each other, and
              the gap below separates the pair from the headline. logo-dark is
              the same artwork with only the wordmark's navy letters recoloured
              white, so it needs no plate and sits straight on the gradient. */}
          <div className="auth-aside-lockup">
            <img src="/logo-dark.png" alt="Complaudi" className="auth-aside-logo" />
            <p className="auth-aside-tagline">{BRAND_TAGLINE}</p>
          </div>

          <h1 className="auth-headline">Never miss a statutory deadline again.</h1>
          <p className="auth-sub">
            Complaudi builds your compliance calendar from your company's own facts —
            entity type, turnover, headcount, registrations — and keeps it current as
            the law moves.
          </p>

          <ul className="auth-points">
            <li>
              <Tick />
              <div>
                <strong>100+ statutory rules across every segment</strong>
                <span>{SEGMENTS_LINE} — each continuously watched</span>
              </div>
            </li>
            <li>
              <Tick />
              <div>
                <strong>Every obligation is explainable</strong>
                <span>See exactly which fact made a filing apply to you</span>
              </div>
            </li>
            <li>
              <Tick />
              <div>
                <strong>Evidence-backed completion</strong>
                <span>Nothing is marked done without the challan to prove it</span>
              </div>
            </li>
            <li>
              <Tick />
              <div>
                {/* Every claim here is something a copilot answer actually
                    returns: the cited rule, whether it reaches this company,
                    its next due date and the penalty for missing it. */}
                <strong>Ask the AI copilot anything</strong>
                <span>What applies to you, when it's due, and what it costs to miss</span>
              </div>
            </li>
          </ul>

          {cta === 'trial' ? (
            <div className="trial-card">
              <span className="trial-badge">14 days free</span>
              <h2>Enrol your company today</h2>
              <p>Full access to the calendar, tasks and evidence vault. No card required.</p>
              <Link to="/register" className="trial-cta">
                Start your free trial
                <Arrow />
              </Link>
              <p className="trial-foot">Set up in minutes · Cancel anytime</p>
            </div>
          ) : (
            <div className="trial-card">
              <span className="trial-badge">14 days free</span>
              <h2>Already enrolled?</h2>
              <p>Sign in to pick up your compliance calendar where you left it.</p>
              <Link to="/login" className="trial-cta">
                Sign in
                <Arrow />
              </Link>
              <p className="trial-foot">No card required for the trial</p>
            </div>
          )}
        </div>
      </aside>

      <main className="auth-main">{children}</main>
    </div>
  );
}

/** The wordmark above a form, paired to the theme the surface is painted in. */
export function AuthFormBrand() {
  return (
    <span className="auth-form-brand">
      <img src="/logo.png" alt="Complaudi" className="auth-form-logo light" />
      <img src="/logo-dark.png" alt="" aria-hidden="true" className="auth-form-logo dark" />
    </span>
  );
}

export const Tick = () => (
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2.4"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="auth-tick">
    <path d="m4 12.5 5 5L20 6.5" />
  </svg>
);

export const Arrow = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const ShieldIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2.5 4.5 6v6c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6Z" />
  </svg>
);
