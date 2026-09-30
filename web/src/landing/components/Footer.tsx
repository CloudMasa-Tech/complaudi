import { FOOTER } from '../data';
import { Icon } from '../icons';

/**
 * Links to sections that do not exist yet are `href="#"`, which the brief
 * accepts as a placeholder. They are rendered as anchors rather than as
 * buttons, so the structure is already right when the real routes land — but
 * each carries a visually hidden "page not yet published" note, because a link
 * that silently returns you to the top of the page reads as a broken site.
 */
function isPlaceholder(href: string) {
  return href === '#';
}

export function Footer() {
  return (
    <footer className="lp-foot-premium">
      <div className="lp-container is-wide">
        <div className="lp-foot-top" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 40 }}>
          <div className="lp-foot-brand" style={{ gridColumn: '1 / -1', maxWidth: 400, marginBottom: 40 }}>
            <a href="#lp-hero-h1" className="lp-logo" aria-label="Complaudi — back to top" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <span className="lp-logo-mark" aria-hidden="true" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 10 }}>
                <Icon name="shield-check" size={20} strokeWidth={2} />
              </span>
              <span className="lp-logo-word" style={{ fontSize: 20 }}><b>{FOOTER.brand}</b></span>
            </a>
            <p style={{ fontWeight: 600, color: 'var(--lp-premium-deep-blue)' }}>{FOOTER.tagline}</p>
            <p style={{ marginTop: 12, lineHeight: 1.6 }}>{FOOTER.note}</p>

            <ul className="lp-foot-social" style={{ display: 'flex', gap: 16, marginTop: 24, listStyle: 'none', padding: 0 }}>
              {FOOTER.social.map((s) => (
                <li key={s.label}>
                  <a
                    className="lp-social"
                    href={s.href}
                    aria-label={s.label}
                    {...(isPlaceholder(s.href) ? {} : { rel: 'noopener' })}
                    style={{ color: 'var(--lp-text-3)', display: 'block', padding: 8, background: 'var(--lp-surface-2)', borderRadius: 8, transition: 'all 0.2s' }}
                  >
                    <Icon name={s.icon} size={18} />
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {FOOTER.columns.map((col) => (
            <nav
              className="lp-foot-col"
              key={col.title}
              aria-label={col.title}
              id={col.title === 'Company' ? 'contact' : undefined}
            >
              <h3>{col.title}</h3>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {col.links.map((l) => (
                  <li key={l.label}>
                    <a href={l.href}>
                      {l.label}
                      {isPlaceholder(l.href) && <span className="lp-sr"> — page not yet published</span>}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="lp-foot-bottom" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 24, alignItems: 'center' }}>
          <span>{FOOTER.copyright}</span>
          <span className="lp-foot-bottom-links" style={{ display: 'flex', gap: 24 }}>
            <span>Built for Indian businesses</span>
            <span>MCA · GST · MSME · Income Tax</span>
          </span>
        </div>
      </div>
    </footer>
  );
}
