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
    <footer className="lp-foot lp-on-dark">
      <div className="lp-container is-wide">
        <div className="lp-foot-top">
          <div className="lp-foot-brand">
            <a href="#lp-hero-h1" className="lp-logo" aria-label="Complaudi — back to top">
              <span className="lp-logo-mark" aria-hidden="true">
                <Icon name="shield-check" size={19} strokeWidth={2} />
              </span>
              <span className="lp-logo-word"><b>{FOOTER.brand}</b></span>
            </a>
            <p>{FOOTER.tagline}</p>
            <p style={{ marginTop: 12, maxWidth: '38ch' }}>{FOOTER.note}</p>

            <ul className="lp-foot-social">
              {FOOTER.social.map((s) => (
                <li key={s.label}>
                  <a
                    className="lp-social"
                    href={s.href}
                    aria-label={s.label}
                    {...(isPlaceholder(s.href) ? {} : { rel: 'noopener' })}
                  >
                    <Icon name={s.icon} size={17} />
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
              // The closing CTA's "Talk to Us" targets this column, so it needs
              // an id to land on.
              id={col.title === 'Company' ? 'contact' : undefined}
            >
              <h3>{col.title}</h3>
              <ul>
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

        <div className="lp-foot-bottom">
          <span>{FOOTER.copyright}</span>
          <span className="lp-foot-bottom-links">
            <span>Built for Indian businesses</span>
            <span>MCA · GST · MSME · Income Tax</span>
          </span>
        </div>
      </div>
    </footer>
  );
}
