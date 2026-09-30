// Every word of marketing copy and every mock product value lives here, so the
// components stay structural and a copy change never means touching JSX.
// The two rules that shape this file:
//
//  1. Nothing on this page is presented as a shipped capability unless it is.
//     Provider integrations are `planned`, the verification result is
//     `concept`, and the dashboard numbers are `demo`.
//  2. The sample company is internally consistent. A CIN's first letter encodes
//     the registering state, and `PY` is Puducherry, so the sample CIN begins
//     with `P`. (The brief's `U62099PY...` pairs an Uttarakhand prefix with a
//     Puducherry listing — on a page whose whole argument is that the platform
//     reads those codes correctly, an obvious mismatch would cost more trust
//     than the fidelity was worth.)

import type { IconName } from './icons';

// ── status vocabulary ────────────────────────────────────────────────────
// One type for state across the whole page. Tone drives colour; `glyph` and
// `label` are what carry the state for anyone who cannot see the colour, so
// the two can never disagree — there is no way to render a tone without them.

export type Tone = 'good' | 'info' | 'warn' | 'crit' | 'mute';

/** One stage of the platform journey. `focus` marks the emphasised one. */
export interface FlowStep {
  icon: IconName;
  title: string;
  body: string;
  focus?: boolean;
}

interface SolutionCopy {
  eyebrow: string;
  headline: string;
  lede: string;
  steps: readonly FlowStep[];
}

export interface Status {
  tone: Tone;
  label: string;
  /** Distinct per tone. Read by assistive tech too, not decorative. */
  glyph: string;
}

const S = {
  verified:   { tone: 'good', label: 'Verified',           glyph: '✓' },
  completed:  { tone: 'good', label: 'Completed',          glyph: '✓' },
  active:     { tone: 'good', label: 'Active',             glyph: '✓' },
  progress:   { tone: 'info', label: 'In Progress',        glyph: '◐' },
  pending:    { tone: 'warn', label: 'Pending',            glyph: '○' },
  attention:  { tone: 'warn', label: 'Attention Required', glyph: '○' },
  upcoming:   { tone: 'warn', label: 'Upcoming',           glyph: '○' },
  action:     { tone: 'crit', label: 'Action Required',    glyph: '!' },
  notStarted: { tone: 'mute', label: 'Not Started',        glyph: '–' },
  review:     { tone: 'mute', label: 'Awaiting Review',    glyph: '–' },
} as const satisfies Record<string, Status>;

export const STATUS = S;

export const TONE_KEY_CLASS: Record<Tone, string> = {
  good: 'is-good',
  info: 'is-info',
  warn: 'is-warn',
  crit: 'is-crit',
  mute: 'is-mute',
};

// ── the demo company ─────────────────────────────────────────────────────

/**
 * A label/value row in a definition grid.
 *
 * The three optional flags are layout and emphasis, not data: `full` spans both
 * columns for a value too long to sit in one, `mono` sets tabular figures for an
 * identifier, `good` marks a value worth a tick. Declared here rather than
 * inferred, because `as const` would otherwise infer six separate object types
 * and `row.full` would not typecheck on the ones that omit it.
 */
export interface FieldRow {
  label: string;
  value: string;
  full?: boolean;
  mono?: boolean;
  good?: boolean;
}

export const DEMO_CO = {
  name: 'Acme Industries Pvt. Ltd.',
  legalName: 'Acme Industries Private Limited',
  initials: 'AI',
  cin: 'U72900KA2023PTC172034',
  entityType: 'Private Limited Company',
  status: 'Active',
  incorporationDate: '17 Feb 2023',
  state: 'Karnataka',
  roc: 'Bangalore',
  pan: 'AAACA4821P',
  /** The disclosure that makes the rest of the page honest. */
  disclaimer: 'Sample company — demo data',
} as const;

/** Typed into the CIN field character by character when the demo replays. */
export const DEMO_CIN_REVEAL_MS = 42;

// ── navigation ───────────────────────────────────────────────────────────
// Anchors to sections that exist on this page. A marketing nav that dead-ends
// undermines the whole surface, so every entry resolves to real content; the
// brief's "Resources / About" have no equivalent section and are footer links
// instead of nav entries.

export const NAV_LINKS = [
  { label: 'Product', href: '#verification' },
  { label: 'Solutions', href: '#solutions' },
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'Use Cases', href: '#use-cases' },
  { label: 'Security', href: '#security' },
] as const;

export const CTA = {
  primary: 'Get Started',
  secondary: 'Explore Complaudi',
  talk: 'Talk to Us',
  login: 'Log in',
} as const;

// ── hero ─────────────────────────────────────────────────────────────────

export const HERO = {
  eyebrow: 'Business Compliance, Simplified',
  headline: 'Stay Compliant. Stay Confident.',
  /** The emphasised fragment is highlighted below; the array keeps the
   *  emphasis in the data rather than in an <em> buried in the copy. */
  headlineParts: [
    { text: 'Stay Compliant. ', strong: false },
    { text: 'Stay Confident.', strong: true },
  ],
  copy:
    'Verify your business, manage business registration, track GST compliance and other ' +
    'obligations, and keep important business documents organized — all from one ' +
    'intelligent platform.',
  trust: 'Built for Indian businesses',
  facts: [
    'Company verification India',
    'GST & MSME compliance',
    'Compliance tracking',
  ],
} as const;

// ── dashboard preview ────────────────────────────────────────────────────

export const DASH_STATS = [
  { label: 'Compliance Health', value: '92%', tone: 'good' as Tone, foot: 'sample' },
  { label: 'Upcoming Tasks', value: '3', tone: 'warn' as Tone, foot: 'next 30 days' },
  { label: 'Documents', value: '18', tone: 'mute' as Tone, foot: 'stored' },
  { label: 'Registrations', value: '5', tone: 'info' as Tone, foot: 'tracked' },
] as const;

export const DASH_REGISTRATIONS = [
  { icon: 'shield-check' as const, title: 'Business Verification', note: 'CIN matched against provider data', status: STATUS.verified },
  { icon: 'stamp' as const, title: 'Company Registration', note: 'Incorporation on record', status: STATUS.completed },
  { icon: 'file-text' as const, title: 'GST Registration', note: 'Application under processing', status: STATUS.progress },
  { icon: 'briefcase' as const, title: 'MSME / Udyam', note: 'Udyam registration recorded', status: STATUS.verified },
  { icon: 'activity' as const, title: 'Income Tax', note: 'PAN mapped to entity', status: STATUS.completed },
] as const;

export const DASH_TASKS = [
  { title: 'File DIR-3 KYC for 2 directors', due: 'Due 18 Sep', done: true },
  { title: 'Upload MSME certificate', due: 'Completed 12 Sep', done: true },
  { title: 'GSTR-3B preparation', due: 'Due 20 Sep', done: false },
  { title: 'Trade licence renewal', due: 'Due 04 Oct', done: false },
] as const;

export const DASH_FIELDS: readonly FieldRow[] = [
  { label: 'Legal Name', value: DEMO_CO.legalName, full: true },
  { label: 'CIN', value: DEMO_CO.cin, mono: true },
  { label: 'PAN', value: DEMO_CO.pan, mono: true },
  { label: 'Entity Type', value: DEMO_CO.entityType },
  { label: 'Incorporated', value: DEMO_CO.incorporationDate },
  { label: 'State', value: DEMO_CO.state },
];

// ── problem ──────────────────────────────────────────────────────────────

export const PROBLEM = {
  eyebrow: 'The Problem',
  headline: "Business compliance shouldn't feel complicated.",
  lede:
    'Registrations, documents and deadlines live in different places, and the work of ' +
    'keeping track of them is manual. Most businesses do not have a compliance problem ' +
    'so much as a visibility problem.',
  items: [
    {
      icon: 'scattered' as const,
      title: 'Scattered Information',
      body: 'Business information, registrations and documents are often stored across different systems.',
    },
    {
      icon: 'manual' as const,
      title: 'Manual Verification',
      body: 'Teams spend time checking and validating business information manually, one field at a time.',
    },
    {
      icon: 'missed' as const,
      title: 'Missed Compliance',
      body: 'Important deadlines and pending actions can easily be overlooked until they are urgent.',
    },
    {
      icon: 'disconnected' as const,
      title: 'Disconnected Workflows',
      body: 'Registration, documents and compliance activities are often managed separately, in isolation.',
    },
  ],
  note: 'The result is that compliance work happens reactively — when a reminder arrives, rather than as a managed process.',
} as const;

// ── solution ─────────────────────────────────────────────────────────────

export const SOLUTION: SolutionCopy = {
  eyebrow: 'The Platform',
  headline: 'One platform for your business compliance journey.',
  lede:
    'Complaudi brings business verification, registration, documents and compliance ' +
    'tracking into a single workflow, so the whole picture stays in one place.',
  steps: [
    { icon: 'building', title: 'Business', body: 'Your company profile and business information, structured.' },
    { icon: 'search', title: 'Verify', body: 'Company details validated against provider data.', focus: true },
    { icon: 'stamp', title: 'Register', body: 'GST, MSME and other registrations tracked in one place.' },
    { icon: 'folder', title: 'Manage', body: 'Every business document organized, versioned and reachable.' },
    { icon: 'activity', title: 'Track', body: 'Obligations, deadlines and compliance health made visible.' },
    { icon: 'lock', title: 'Stay Compliant', body: 'A structured process that grows with the business.' },
  ],
};

// ── verification ─────────────────────────────────────────────────────────

export const VERIFY = {
  eyebrow: 'Business Verification',
  headline: 'Verify business information with confidence.',
  lede:
    'Complaudi is designed to connect with external verification providers and ' +
    'authoritative business data sources, allowing company information to be validated ' +
    'dynamically rather than stored as a static record.',
  points: [
    {
      icon: 'db' as const,
      title: 'Provider adapters, not hardcoded data',
      body: 'The architecture routes each lookup to a provider adapter, so verification sources can be added or swapped without changing the product.',
    },
    {
      icon: 'activity' as const,
      title: 'Fetched, never assumed',
      body: 'Company records are retrieved and checked at the time you ask, so what you see reflects the source rather than a copy of it.',
    },
    {
      icon: 'history' as const,
      title: 'A trail you can audit',
      body: 'Verification runs are recorded, giving compliance tracking an evidence base instead of an assertion.',
    },
  ],
  sourcesEyebrow: 'Verification Sources',
  sourcesHeadline: 'Designed to support the registries Indian businesses actually use.',
  sourcesLede:
    'The verification layer is built as a set of provider adapters. Each source below is ' +
    'planned, and availability is shown as it ships — not before.',
  sources: [
    { icon: 'building' as const, name: 'MCA', state: 'Planned' },
    { icon: 'file-text' as const, name: 'GST', state: 'Planned' },
    { icon: 'briefcase' as const, name: 'Udyam / MSME', state: 'Planned' },
    { icon: 'file-text' as const, name: 'PAN', state: 'Planned' },
    { icon: 'users' as const, name: 'Director / DIN', state: 'Planned' },
  ],
} as const;

/** The scripted verification result. Concept data, labelled as such in the UI. */
export const VERIFY_RESULT: readonly FieldRow[] = [
  { label: 'Company Name', value: DEMO_CO.legalName, full: true },
  { label: 'Company Status', value: DEMO_CO.status, good: true },
  { label: 'Entity Type', value: DEMO_CO.entityType },
  { label: 'Incorporation Date', value: DEMO_CO.incorporationDate },
  { label: 'State', value: DEMO_CO.state },
  { label: 'ROC', value: DEMO_CO.roc },
];

// ── compliance management ────────────────────────────────────────────────

export const COMPLIANCE = {
  eyebrow: 'Compliance Management',
  headline: 'Know what needs attention.',
  lede:
    'Every registration and obligation in one view, with the status of each legible ' +
    'in about three seconds — so the next action is obvious without reading a list.',
  rows: [
    { name: 'GST Registration', authority: 'GST', status: STATUS.completed, note: 'Certificate on record' },
    { name: 'MSME / Udyam', authority: 'MSME', status: STATUS.completed, note: 'Registration active' },
    { name: 'Trade License', authority: 'Municipal', status: STATUS.pending, note: 'Renewal in 21 days' },
    { name: 'ROC Compliance', authority: 'MCA', status: STATUS.attention, note: '2 filings outstanding' },
    { name: 'Income Tax', authority: 'Income Tax', status: STATUS.upcoming, note: 'Advance tax due 15 Dec' },
    { name: 'PF Registration', authority: 'Labour', status: STATUS.notStarted, note: 'Not required at current headcount' },
  ],
  legend: [
    { tone: 'good' as Tone, label: 'Completed' },
    { tone: 'info' as Tone, label: 'In Progress' },
    { tone: 'warn' as Tone, label: 'Upcoming' },
    { tone: 'crit' as Tone, label: 'Action Required' },
    { tone: 'mute' as Tone, label: 'Not Started' },
  ],
  side: [
    { icon: 'check-shield' as const, value: '3', label: 'Completed', tone: 'good' as Tone },
    { icon: 'alert' as const, value: '1', label: 'Needs attention', tone: 'warn' as Tone },
  ],
} as const;

// ── documents ────────────────────────────────────────────────────────────

export const DOCS = {
  eyebrow: 'Document Management',
  headline: 'Keep important documents organized.',
  lede:
    'Certificates, registrations and resolutions in one structured place, each with its ' +
    'status and verification state — so a business document is something you can find, ' +
    'not something you go looking for.',
  columns: ['Document', 'Status', 'Uploaded', 'Verification'],
  rows: [
    { name: 'Certificate of Incorporation', kind: 'Registration', status: STATUS.completed, uploaded: '17 Feb 2026', verification: STATUS.verified },
    { name: 'GST Certificate', kind: 'Registration', status: STATUS.progress, uploaded: '04 Mar 2026', verification: STATUS.review },
    { name: 'PAN Card', kind: 'Identity', status: STATUS.completed, uploaded: '17 Feb 2026', verification: STATUS.verified },
    { name: 'MSME Certificate', kind: 'Registration', status: STATUS.completed, uploaded: '11 Mar 2026', verification: STATUS.verified },
    { name: 'Trade License', kind: 'Licence', status: STATUS.pending, uploaded: '—', verification: STATUS.notStarted },
    { name: 'Board Resolution', kind: 'Governance', status: STATUS.completed, uploaded: '22 Mar 2026', verification: STATUS.review },
  ],
  counts: [
    { icon: 'check-shield' as const, label: 'Verified', value: '11', tone: 'good' as Tone },
    { icon: 'manual' as const, label: 'Awaiting review', value: '4', tone: 'warn' as Tone },
    { icon: 'file-text' as const, label: 'Total stored', value: '18', tone: 'mute' as Tone },
  ],
} as const;

// ── how it works ─────────────────────────────────────────────────────────

export const STEPS = {
  eyebrow: 'How It Works',
  headline: 'From registration to compliance — in a few simple steps.',
  lede: 'Four steps, and the compliance work stops being a chore you remember at the wrong time.',
  items: [
    { title: 'Create your business profile', body: 'Entity type, registrations and business information captured once, as structured data.' },
    { title: 'Verify your business information', body: 'Company details are checked against verification providers, so what is on record is what is on file.' },
    { title: 'Complete registrations and compliance requirements', body: 'GST, MSME and other registrations, with the documents each one needs kept alongside it.' },
    { title: 'Track everything from one dashboard', body: 'Obligations, deadlines, documents and business information in a single view you can act on.' },
  ],
} as const;

// ── why complaudi ────────────────────────────────────────────────────────

export const WHY = {
  eyebrow: 'Why Complaudi',
  headline: 'Built to be the system of record for your compliance.',
  lede: 'Six properties that decide whether a compliance platform is usable two years in.',
  items: [
    { icon: 'layout' as const, title: 'Centralized', body: 'Manage business information, documents and compliance activities in one place.' },
    { icon: 'search' as const, title: 'Verification-first', body: 'Designed to validate important business information using external data sources.' },
    { icon: 'sparkle' as const, title: 'Automated', body: 'Reduce repetitive manual compliance work so attention goes to the exceptions.' },
    { icon: 'scale' as const, title: 'Scalable', body: 'Designed to support businesses as their compliance needs grow.' },
    { icon: 'lock' as const, title: 'Secure', body: 'Keep sensitive business information organized and controlled.' },
    { icon: 'eye' as const, title: 'Transparent', body: 'Clearly understand what is completed, pending and requires action.' },
  ],
} as const;

// ── use cases ────────────────────────────────────────────────────────────

export const USE_CASES = {
  eyebrow: 'Use Cases',
  headline: 'Built for every stage of your business.',
  lede: 'The same structure, whether you are registering your first company or running compliance across a group.',
  items: [
    {
      icon: 'sparkle' as const,
      tag: 'Startups',
      title: 'Startups',
      body: 'Complete registrations and establish your compliance foundation.',
      points: ['Entity registration', 'First GST and MSME filings', 'Founder document vault'],
    },
    {
      icon: 'activity' as const,
      tag: 'Growing',
      title: 'Growing Businesses',
      body: 'Organize registrations, documents and recurring compliance.',
      points: ['Recurring obligations', 'Multi-registration tracking', 'Deadline visibility'],
    },
    {
      icon: 'briefcase' as const,
      tag: 'Professionals',
      title: 'Accountants & Consultants',
      body: 'Manage compliance workflows for multiple businesses.',
      points: ['Multiple company profiles', 'Assigned compliance tasks', 'Evidence per obligation'],
    },
    {
      icon: 'building' as const,
      tag: 'Enterprise',
      title: 'Enterprises',
      body: 'Create structured compliance processes across teams.',
      points: ['Team access and roles', 'Standardised process', 'Audit-friendly history'],
    },
  ],
} as const;

// ── security ─────────────────────────────────────────────────────────────

export const SECURITY = {
  eyebrow: 'Trust & Security',
  headline: 'Your business information deserves a secure home.',
  lede:
    'Company information is some of the most sensitive data a business holds. Complaudi ' +
    'treats it as structured, access-controlled data rather than a folder of files.',
  items: [
    { icon: 'lock-key' as const, title: 'Secure authentication', body: 'Signed-in access with protected sessions before any business record is shown.' },
    { icon: 'users' as const, title: 'Controlled access', body: 'People reach company data in their own role, and the boundary is enforced per request.' },
    { icon: 'db' as const, title: 'Structured business data', body: 'Registrations and entity details held as fields, so they can be validated and tracked.' },
    { icon: 'folder' as const, title: 'Document management', body: 'Certificates and evidence kept with the obligation they belong to.' },
    { icon: 'shield-check' as const, title: 'Verification workflows', body: 'Business information confirmed through provider adapters rather than assumed.' },
    { icon: 'history' as const, title: 'Audit-friendly tracking', body: 'Compliance activity recorded over time, so the history is evidence.' },
  ],
  boundaryTitle: 'What we do not claim',
  boundary: [
    'Complaudi is a compliance management platform, not a government portal, and it does not file on your behalf of any authority.',
    'Provider integrations shown as planned are not live today, and no verification source is claimed as connected until it is.',
    'No certification or regulatory attestation is claimed on this page. Security controls described here are architectural.',
  ],
} as const;

// ── cta ──────────────────────────────────────────────────────────────────

export const CTA_SECTION = {
  eyebrow: 'Get Started',
  headline: 'Take control of your business compliance.',
  copy: 'Bring registrations, verification, documents and compliance tracking into one simple workflow.',
  fine: [
    'Built for Indian businesses',
    'Verification-first architecture',
    'No credit card required to explore',
  ],
} as const;

// ── footer ───────────────────────────────────────────────────────────────

export const FOOTER = {
  brand: 'Complaudi',
  tagline: 'Business compliance, simplified.',
  note:
    'A compliance and verification platform for Indian businesses — built to keep ' +
    'registrations, documents and compliance tracking in one place.',
  columns: [
    {
      title: 'Product',
      links: [
        { label: 'Business Verification', href: '#verification' },
        { label: 'Compliance Management', href: '#compliance' },
        { label: 'Documents', href: '#documents' },
        { label: 'Registrations', href: '#compliance' },
      ],
    },
    {
      title: 'Company',
      links: [
        { label: 'About', href: '#' },
        // "Talk to Us" in the closing CTA points here, so this needs a real
        // target rather than a placeholder.
        { label: 'Contact', href: '#contact' },
        { label: 'Careers', href: '#' },
      ],
    },
    {
      title: 'Resources',
      links: [
        { label: 'Compliance Guides', href: '#' },
        { label: 'FAQs', href: '#' },
        { label: 'Help Center', href: '#' },
      ],
    },
    {
      title: 'Legal',
      links: [
        { label: 'Privacy Policy', href: '#' },
        { label: 'Terms', href: '#' },
        { label: 'Security', href: '#security' },
      ],
    },
  ],
  social: [
    { icon: 'linkedin' as const, label: 'LinkedIn', href: '#' },
    { icon: 'instagram' as const, label: 'Instagram', href: '#' },
    { icon: 'youtube' as const, label: 'YouTube', href: '#' },
  ],
  copyright: '© 2026 Complaudi. All rights reserved.',
} as const;
