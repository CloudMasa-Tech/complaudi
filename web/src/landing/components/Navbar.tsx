import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CTA, NAV_LINKS } from '../data';
import { Icon } from '../icons';

/**
 * The bar is transparent over the dark hero and opaque once the page has
 * scrolled past it, and it loses height at the same time. Both changes ride one
 * `is-stuck` class, so they can never land out of step.
 *
 * The mobile sheet is a dialog: it traps nothing but it does claim the whole
 * viewport, so it hides the page behind an `aria-modal` surface and closes on
 * Escape. It is unmounted when closed rather than hidden, which keeps its links
 * out of the tab order and off screen readers when it should not exist.
 */
export function Navbar() {
  const [stuck, setStuck] = useState(false);
  const [open, setOpen] = useState(false);
  const burgerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // 24px is roughly the point where the transparent bar would start to sit on
    // top of the hero headline.
    const onScroll = () => setStuck(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close the sheet whenever the viewport grows past the mobile breakpoint, or
  // the hamburger disappears while its dialog is still open.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1001px)');
    const onChange = () => { if (mq.matches) setOpen(false); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        burgerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    // Scrolling the page behind a full-height sheet is a wheel trap.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <header className={`lp-nav${stuck ? ' is-stuck' : ''}`}>
        <div className="lp-container is-wide lp-nav-inner">
          <Link to="/" className="lp-logo" aria-label="Complaudi — home">
            <span className="lp-logo-mark" aria-hidden="true">
              <Icon name="shield-check" size={19} strokeWidth={2} />
            </span>
            <span className="lp-logo-word">
              <b>Complaudi</b>
            </span>
          </Link>

          <nav className="lp-nav-links" aria-label="Primary">
            {NAV_LINKS.map((l) => (
              <a key={l.href} className="lp-nav-link" href={l.href}>{l.label}</a>
            ))}
          </nav>

          <div className="lp-nav-right">
            <Link to="/login" className="lp-nav-login">{CTA.login}</Link>
            <Link to="/register" className="btn-lp btn-primary">{CTA.primary}</Link>
            <button
              ref={burgerRef}
              type="button"
              className="lp-burger"
              aria-expanded={open}
              aria-controls="lp-mobile-sheet"
              aria-label={open ? 'Close menu' : 'Open menu'}
              onClick={() => setOpen((v) => !v)}
            >
              <span className="lp-burger-bars" aria-hidden="true">
                <i /><i /><i />
              </span>
            </button>
          </div>
        </div>
      </header>

      {open && (
        <div className="lp-sheet" id="lp-mobile-sheet" role="dialog" aria-modal="true" aria-label="Site menu">
          <nav className="lp-sheet-nav" aria-label="Mobile">
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setOpen(false)}>{l.label}</a>
            ))}
          </nav>
          <div className="lp-sheet-foot">
            <Link to="/register" className="btn-lp btn-primary btn-lg btn-block" onClick={() => setOpen(false)}>
              {CTA.primary}
            </Link>
            <Link to="/login" className="btn-lp btn-secondary btn-block" onClick={() => setOpen(false)}>
              {CTA.login}
            </Link>
            <p className="lp-sheet-note">Built for Indian businesses</p>
          </div>
        </div>
      )}
    </>
  );
}
