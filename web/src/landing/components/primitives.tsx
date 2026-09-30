import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react';
import { TONE_KEY_CLASS, type Status, type Tone } from '../data';
import { Icon, type IconName } from '../icons';

/* ── scroll reveal ─────────────────────────────────────────────────────────
 * One IntersectionObserver per element, disconnected after it fires. An element
 * already in the viewport on load reveals on the first callback, and anything
 * below the fold reveals as it arrives — so there is no "you have to scroll to
 * see the hero" trap.

 * Under `prefers-reduced-motion` the content is simply rendered revealed and no
 * observer is created at all, rather than being animated to the same end state.
 */
export function Reveal({
  as: Tag = 'div', delay, className = '', children, ...rest
}: {
  as?: ElementType;
  delay?: number;
  className?: string;
  children: ReactNode;
} & Record<string, unknown>) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(true);
      return;
    }
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.06 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={`lp-reveal${shown ? ' is-in' : ''}${className ? ` ${className}` : ''}`}
      data-delay={delay}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/* ── status pill ───────────────────────────────────────────────────────────
 * Colour, a glyph and a word together. The glyph is exposed to assistive tech
 * via a visually hidden prefix rather than being dropped, so a screen-reader
 * user hears "Attention required" rather than the colour name.
 */
export function StatusPill({ status, large }: { status: Status; large?: boolean }) {
  return (
    <span className={`lp-status ${TONE_KEY_CLASS[status.tone]}${large ? ' is-lg' : ''}`}>
      <span className="lp-status-glyph" aria-hidden="true">{status.glyph}</span>
      {status.label}
    </span>
  );
}

export function ToneKey({ tone }: { tone: Tone }) {
  return <span className={`lp-legend-key ${TONE_KEY_CLASS[tone]}`} aria-hidden="true" />;
}

export function IconPlate({
  name, tone, size = 21,
}: {
  name: IconName;
  tone?: 'good' | 'warn' | 'plain';
  size?: number;
}) {
  return (
    <span className={`lp-icon-plate${tone ? ` is-${tone}` : ''}`}>
      <Icon name={name} size={size} />
    </span>
  );
}

/* ── section header ───────────────────────────────────────────────────────
 * H2 rather than H1: the page owns a single H1 in the hero, and the heading
 * order has to stay flat for screen-reader navigation.
 */
export function SectionHead({
  eyebrow, headline, lede, centered, wide, id,
}: {
  eyebrow: string;
  headline: string;
  lede?: string;
  centered?: boolean;
  wide?: boolean;
  id?: string;
}) {
  return (
    <div className={`lp-head${centered ? ' is-centered' : ''}`}>
      <Reveal>
        <span className="lp-eyebrow">
          <span className="lp-eyebrow-dot" aria-hidden="true" />
          {eyebrow}
        </span>
        <h2 className={`lp-h2${wide ? ' is-wide' : ''}`} id={id}>{headline}</h2>
        {lede && <p className="lp-lede">{lede}</p>}
      </Reveal>
    </div>
  );
}

export function DemoTag({ children }: { children: ReactNode }) {
  return <span className="lp-demo-tag">{children}</span>;
}

/** Marks a whole mockup as illustrative, with the reason. */
export function ConceptNote({ children }: { children: ReactNode }) {
  return (
    <p className="lp-concept-note">
      <Icon name="info" size={16} className="lp-concept-note-icon" />
      <span>{children}</span>
    </p>
  );
}
