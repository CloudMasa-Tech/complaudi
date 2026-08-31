import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Severity } from '../api/types';

// ── formatting ──────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Dates from the API are calendar dates; read them in UTC so they never shift. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function fmtMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${y}`;
}

/** Whole days from today to a calendar date, in UTC. */
export function daysUntil(iso: string): number {
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((new Date(iso).getTime() - today) / 86_400_000);
}

export function relativeDue(iso: string): string {
  const d = daysUntil(iso);
  if (d < -1) return `${Math.abs(d)} days overdue`;
  if (d === -1) return 'yesterday';
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d < 31) return `in ${d} days`;
  return fmtDate(iso);
}

/** Indian digit grouping, in crore / lakh where it reads better. */
export function fmtINR(value: string | number): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e7) {
    const cr = n / 1e7;
    return `₹${Number.isInteger(cr) ? cr : cr.toFixed(2)} cr`;
  }
  if (n >= 1e5) {
    const l = n / 1e5;
    return `₹${Number.isInteger(l) ? l : l.toFixed(2)} L`;
  }
  return `₹${n.toLocaleString('en-IN')}`;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const titleise = (s: string): string =>
  s.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

export const initials = (name: string): string =>
  name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');

/** Acronyms must not be title-cased — `titleise` would render LLP as "Llp". */
export const ENTITY_LABEL: Record<string, string> = {
  PRIVATE_LIMITED: 'Private Limited',
  PUBLIC_LIMITED: 'Public Limited',
  OPC: 'One Person Company',
  LLP: 'LLP',
  PARTNERSHIP: 'Partnership Firm',
  PROPRIETORSHIP: 'Proprietorship',
  SECTION_8: 'Section 8 Company',
};

/**
 * Who an entity has on record, and how many before it can exist at all.
 *
 * A private limited company is not registrable with one director and an LLP
 * does not have directors at all, so the onboarding form opens the right number
 * of the right rows rather than one row called "Director" for everyone.
 *
 * `max` is set only where the API enforces it too — a cap the server would
 * accept is a cap the form has no business imposing.
 */
export const ENTITY_OFFICERS: Record<string, {
  singular: string; plural: string; designation: string; min: number; max?: number; note: string;
}> = {
  PRIVATE_LIMITED: { singular: 'director', plural: 'Directors', designation: 'Director', min: 2,
                     note: 'A private limited company needs at least two directors.' },
  PUBLIC_LIMITED:  { singular: 'director', plural: 'Directors', designation: 'Director', min: 3,
                     note: 'A public limited company needs at least three directors.' },
  OPC:             { singular: 'director', plural: 'Director', designation: 'Director', min: 1, max: 1,
                     note: 'A One Person Company has a single director on record.' },
  LLP:             { singular: 'designated partner', plural: 'Designated partners', designation: 'Designated Partner', min: 2,
                     note: 'An LLP needs at least two designated partners, and a DPIN is what raises DIR-3 KYC.' },
  PARTNERSHIP:     { singular: 'partner', plural: 'Partners', designation: 'Partner', min: 2,
                     note: 'A partnership firm has at least two partners.' },
  PROPRIETORSHIP:  { singular: 'proprietor', plural: 'Proprietor', designation: 'Proprietor', min: 1,
                     note: 'A sole proprietorship has a single proprietor.' },
  SECTION_8:       { singular: 'director', plural: 'Directors', designation: 'Director', min: 2,
                     note: 'A Section 8 company needs at least two directors.' },
};

export const officersFor = (entityType: string) =>
  ENTITY_OFFICERS[entityType] ?? ENTITY_OFFICERS.PRIVATE_LIMITED!;

/**
 * What the incorporation date sets off.
 *
 * Mirrors MCA_INC20A in the engine — entity type, share capital and the 2 Nov
 * 2018 commencement, with the deadline at incorporation + 180 days — so the
 * field can say what the date will actually cost rather than only that it is
 * required. Kept deliberately literal: if the rule moves, this reads wrong
 * next to it and gets noticed.
 */
const INC20A_FROM = '2018-11-02';
const INC20A_ENTITIES = ['PRIVATE_LIMITED', 'PUBLIC_LIMITED', 'OPC'];
const INC20A_DAYS = 180;

export function inc20aNote(entityType: string, paidUpCapital: number, incorporationDate: string): string {
  const base = 'Required — the whole calendar is built from this date.';

  if (!INC20A_ENTITIES.includes(entityType)) return `${base} INC-20A does not apply to this entity type.`;
  if (!incorporationDate) return `${base} INC-20A then falls due ${INC20A_DAYS} days after it.`;
  if (incorporationDate < INC20A_FROM) return `${base} Incorporated before 2 Nov 2018, so INC-20A does not apply.`;
  if (!(paidUpCapital > 0)) {
    return `${base} INC-20A applies only to a company with share capital — none recorded yet.`;
  }

  const due = new Date(`${incorporationDate}T00:00:00Z`);
  if (Number.isNaN(due.getTime())) return base;
  due.setUTCDate(due.getUTCDate() + INC20A_DAYS);
  return `${base} INC-20A (commencement of business) is due ${fmtDate(due.toISOString().slice(0, 10))}`
    + ` — ${INC20A_DAYS} days after incorporation, and the company cannot commence business or borrow until it is filed.`;
}

export const AUTHORITY_LABEL: Record<string, string> = {
  MCA: 'MCA', GST: 'GST', INCOME_TAX: 'Income Tax', MSME: 'MSME', LABOUR: 'Labour',
};

// ── primitives ──────────────────────────────────────────────────────────

export const Badge = ({ value, children }: { value: string; children?: ReactNode }) => (
  <span className={`badge badge-${value}`}>{children ?? titleise(value)}</span>
);

export const SeverityDot = ({ value }: { value: Severity }) => (
  <span className={`dot dot-${value}`} title={titleise(value)} />
);

export const AuthorityTag = ({ value }: { value: string }) => (
  <span className="auth-tag">{AUTHORITY_LABEL[value] ?? value}</span>
);

export const Spinner = () => <span className="spinner" />;

export const Loading = ({ label = 'Loading' }: { label?: string }) => (
  <div className="loading"><Spinner /> {label}…</div>
);

export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;

export const ErrorNote = ({ error }: { error: string }) => <div className="alert alert-error">{error}</div>;

export function Card({ title, action, children, note }: {
  title?: string; action?: ReactNode; children: ReactNode; note?: string;
}) {
  return (
    <section className="card">
      {title && (
        <header className="card-head">
          <h2>{title}</h2>
          {note && <span className="card-note">{note}</span>}
          {action && <span className="spacer">{action}</span>}
        </header>
      )}
      {children}
    </section>
  );
}

/**
 * A headline number, optionally a way in.
 *
 * A number that names a set of work should lead to that work — reading "19
 * overdue" and then having to find the same 19 by hand is the sort of gap that
 * makes a dashboard decorative.
 */
export function Stat({ label, value, foot, tone, to }: {
  label: string; value: ReactNode; foot?: ReactNode; tone?: string; to?: string;
}) {
  const body = (
    <>
      <span className="stat-label">{label}</span>
      <span className="stat-value" style={tone ? { color: `var(--${tone})` } : undefined}>{value}</span>
      {foot && <span className="stat-foot">{foot}</span>}
    </>
  );

  if (!to) return <div className="card stat">{body}</div>;
  return <Link className="card stat stat-link" to={to}>{body}</Link>;
}

export function Field({ label, hint, error, children }: {
  label: string; hint?: string; error?: string; children: ReactNode;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

export function Drawer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">{children}</aside>
    </>
  );
}
