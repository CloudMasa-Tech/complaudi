import type { FinancialYear } from '../lib/dates';

export type Authority = 'MCA' | 'GST' | 'INCOME_TAX' | 'MSME' | 'LABOUR';
export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type EntityType =
  | 'PRIVATE_LIMITED'
  | 'PUBLIC_LIMITED'
  | 'OPC'
  | 'LLP'
  | 'PARTNERSHIP'
  | 'PROPRIETORSHIP'
  | 'SECTION_8';

export type GstFilingFrequency = 'MONTHLY' | 'QRMP' | 'COMPOSITION';
export type MsmeCategory = 'MICRO' | 'SMALL' | 'MEDIUM';

export type PeriodKind = 'ANNUAL' | 'HALF_YEARLY' | 'QUARTERLY' | 'MONTHLY' | 'ONE_TIME' | 'EVENT_BASED';

/**
 * What it takes to close an obligation out.
 *
 * The toolkit cannot verify a filing against MCA, GSTN or the Income Tax
 * Department — nothing here reaches those systems. So "completed" is a claim,
 * and this decides how much that claim has to be backed by:
 *
 *   REQUIRED — a document must be attached. For filings that produce a real
 *              artefact: an SRN challan, an ARN acknowledgement, a tax challan.
 *              No document, no completion.
 *   ATTEST   — a document, or failing that a signed declaration recorded
 *              against the user's name. For obligations with no external
 *              receipt: board meetings, POSH committees, MSME ageing checks.
 *   NONE     — an internal reminder with nothing to prove. Tick and move on.
 */
export type EvidenceLevel = 'REQUIRED' | 'ATTEST' | 'NONE';

// ------------------------------------------------------------------ context

export interface DirectorProfile {
  id: string;
  name: string;
  din: string | null;
  designation: string;
  appointedOn: Date | null;
  resignedOn: Date | null;
}

export interface GstProfile {
  id: string;
  gstin: string;
  stateCode: string;
  filingFrequency: GstFilingFrequency;
  isTdsDeductor: boolean;
  isEcommerceOperator: boolean;
  isActive: boolean;
}

export interface MsmeProfile {
  udyamNumber: string;
  category: MsmeCategory;
  registeredOn: Date | null;
}

export interface CompanyProfile {
  id: string;
  legalName: string;
  entityType: EntityType;
  cin: string | null;
  llpin: string | null;
  pan: string | null;
  tan: string | null;
  incorporationDate: Date | null;
  stateCode: string;
  industry: string | null;
  employeeCount: number;
  /** INR */
  annualTurnover: number;
  /** INR */
  paidUpCapital: number;
  cashTransactionRatioBelow5Pct: boolean;
  hasForeignTransactions: boolean;
  acceptsDeposits: boolean;
  isListed: boolean;
  buysFromMsmeSuppliers: boolean;
  agmDate: Date | null;
}

/** Everything a rule is allowed to look at. Nothing else. */
export interface ComplianceContext {
  company: CompanyProfile;
  directors: DirectorProfile[];
  gstRegistrations: GstProfile[];
  msme: MsmeProfile | null;
}

// ------------------------------------------------------------------ rules

/**
 * A named, testable predicate. The `label` is what the user is shown when they
 * ask "why does this apply to me?", so it must read as a reason, not a variable
 * name — e.g. "Turnover exceeds ₹5 crore".
 */
export interface Condition {
  label: string;
  test: (ctx: ComplianceContext) => boolean;
}

export interface ConditionResult {
  label: string;
  passed: boolean;
  /** true when this came from `excludeWhen` — passing it means the rule is switched off */
  negated: boolean;
}

/** One dated obligation produced by a rule for a specific period. */
export interface Occurrence {
  /** Unique within (company, rule). Also the idempotency key for regeneration. */
  periodKey: string;
  periodLabel: string;
  periodStart: Date;
  periodEnd: Date;
  dueDate: Date;
  /** Rule-specific extras, e.g. { gstin, quarter, instalmentPct } */
  metadata?: Record<string, unknown>;
  /** Overrides the rule title when a rule needs per-occurrence naming. */
  title?: string;
}

export interface ComplianceRule {
  /** Stable identifier — never renumber; it is the persisted foreign key. */
  code: string;
  title: string;
  authority: Authority;
  category: string;
  /** Statutory form name, when there is one, e.g. "AOC-4", "GSTR-3B". */
  form?: string;
  legalReference: string;
  description: string;
  severity: Severity;
  /** What happens if you miss it. Shown on the task. */
  penalty: string;
  evidenceRequired: string[];
  /** How completion is proved. See {@link EvidenceLevel}. */
  evidenceLevel: EvidenceLevel;
  /**
   * The evidence for this rule is a document a human signs — minutes, financial
   * statements, an auditor's report. Software cannot verify a scanned
   * signature, so completion instead requires naming the signatory, which puts
   * an accountable person on the record.
   */
  signatoryRequired?: boolean;
  /**
   * The obligation arises from the company's annual accounts — AOC-4, MGT-7,
   * the AGM, the audit report, the income tax return. These only begin with the
   * first financial year, which under s.2(41) can run up to fifteen months, so
   * they are skipped for any earlier year even where the period overlaps the
   * incorporation date.
   */
  basedOnAnnualAccounts?: boolean;
  periodKind: PeriodKind;
  /** All must pass for the rule to apply. */
  applicableWhen: Condition[];
  /** If any passes, the rule does not apply — carve-outs and exemptions. */
  excludeWhen?: Condition[];
  /**
   * Dated obligations for one financial year. A rule may emit zero occurrences
   * (e.g. a one-time filing whose window has already closed) or fan out across
   * GSTINs.
   */
  occurrences: (fy: FinancialYear, ctx: ComplianceContext) => Occurrence[];
}

export interface RuleEvaluation {
  rule: ComplianceRule;
  applicable: boolean;
  reasons: ConditionResult[];
}
