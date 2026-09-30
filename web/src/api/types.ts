export type Authority = 'MCA' | 'GST' | 'INCOME_TAX' | 'MSME' | 'LABOUR' | 'DPIIT';
export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type ItemStatus = 'UPCOMING' | 'DUE' | 'OVERDUE' | 'COMPLETED' | 'WAIVED';
export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED';
export type EvidenceLevel = 'REQUIRED' | 'ATTEST' | 'NONE';

/** How a rule relates to one entity type on the reference page. */
export type RuleEntityStatus = 'ALWAYS' | 'CONTINGENT' | 'NEVER';

/** Bookkeeping per constitution, served on every rule by GET /rules. */
export type RuleEntityApplicability = Record<EntityType, RuleEntityStatus>;

export type EntityType =
  | 'PRIVATE_LIMITED' | 'PUBLIC_LIMITED' | 'OPC' | 'LLP'
  | 'PARTNERSHIP' | 'PROPRIETORSHIP' | 'SECTION_8' | 'UNREGISTERED';

/** Sub-kind of an unincorporated business — display-only. */
export type BusinessType = 'SHOP_RETAIL' | 'FREELANCER' | 'PROFESSIONAL' | 'FOOD_RESTAURANT' | 'OTHER';

export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'CA' | 'COMPANY_OWNER' | 'VIEWER';

export type Capability =
  | 'company.create' | 'company.edit' | 'company.archive' | 'company.delete'
  | 'company.sync' | 'work.write' | 'evidence.write' | 'users.manage' | 'audit.read'
  | 'rules.read';

export const ROLE_LABEL: Record<UserRole, string> = {
  SUPER_ADMIN: 'Super admin',
  ADMIN: 'Admin',
  CA: 'Chartered accountant',
  COMPANY_OWNER: 'Company owner',
  VIEWER: 'Viewer',
};

export interface User {
  id: string; name: string; email: string; role: UserRole; organizationId: string; phone?: string;
}

export interface TeamMember {
  id: string; name: string; email: string; role: UserRole;
  isActive: boolean; lastLoginAt: string | null; createdAt: string;
  seesEveryCompany: boolean;
  companies: { companyId: string; role: UserRole; legalName: string; isActive: boolean }[];
}

/** One row of a company's own team — returned by GET /companies/:id/members. */
export interface CompanyMember {
  role: UserRole;
  since: string;
  member: { id: string; name: string; email: string; isActive: boolean };
  invitedBy: { id: string; name: string };
  invitationStatus?: 'ACTIVE' | 'PENDING';
}

export interface GstRegistration {
  id: string; gstin: string; stateCode: string;
  legalName?: string | null;
  tradeName?: string | null;
  constitution?: string | null;
  registeredOn?: string | null;
  filingFrequency: 'MONTHLY' | 'QRMP' | 'COMPOSITION';
  isTdsDeductor: boolean; isEcommerceOperator: boolean; isActive: boolean;
}

export interface GstSessionResult {
  success: boolean;
  sessionId?: string;
  gstin?: string;
  captchaImage?: string;
  expiresAt?: string;
  error?: { code: string; message: string };
}

export interface GstMasterRecord {
  gstin: string;
  legalName: string;
  tradeName: string | null;
  registrationDate: string | null;
  status: string;
  taxpayerType: string | null;
  constitution: string | null;
  state: string | null;
  stateCode: string | null;
  panEmbedded: string | null;
  principalPlaceOfBusiness: {
    address: string;
    city: string | null;
    state: string | null;
    pincode: string | null;
  } | null;
  natureOfBusiness: string[];
  jurisdiction: {
    stateJurisdiction: string | null;
    centralJurisdiction: string | null;
  } | null;
  einvoiceStatus: string | null;
}

export interface GstVerificationResult {
  success: boolean;
  gstin?: string;
  gst?: GstMasterRecord;
  error?: { code: string; message: string };
  rawResponse?: unknown;
}

export interface PanGstCrossReference {
  legalName: string;
  tradeName: string | null;
  status: string;
  constitution: string | null;
  registrationDate: string | null;
}

export interface PanMasterRecord {
  pan: string;
  verified: boolean;
  panStatus: string;
  formatValid: boolean;
  entityTypeCode: string;
  entityType: string;
  verificationLevel: string;
  verificationSource: string;
  verificationMethod: string;
  linkedGstins: string[];
  gst: PanGstCrossReference | null;
  note?: string | null;
  source?: string | null;
  fetchedAt?: string | null;
}

export interface PanVerificationResult {
  success: boolean;
  pan?: string;
  data?: PanMasterRecord;
  error?: { code: string; message: string };
  rawResponse?: unknown;
}

export interface UdyamSessionResult {
  success: boolean;
  sessionId?: string;
  udyamNumber?: string;
  captchaImage?: string;
  expiresAt?: string;
  error?: { code: string; message: string };
  rawResponse?: unknown;
}

export interface UdyamMasterRecord {
  udyamNumber: string;
  enterpriseName: string;
  ownerName: string;
  category: "Micro" | "Small" | "Medium";
  activityType: "Manufacturing" | "Service";
  nicCode: string;
  nicDescription: string;
  dateOfRegistration: string;
  dateOfCommencement: string;
  pan: string | null;
  gstin: string | null;
  socialCategory: string;
  district: string;
  state: string;
  status: string;
  employees: {
    male: number;
    female: number;
    total: number;
  };
  investmentInPlantMachineryInr: number | null;
  turnoverInr: number | null;
  source?: string;
  fetchedAt?: string;
}

export interface UdyamVerificationResult {
  success: boolean;
  udyamNumber?: string;
  registration?: UdyamMasterRecord;
  data?: UdyamMasterRecord;
  error?: { code: string; message: string };
  rawResponse?: unknown;
}

/**
 * A DIN's standing, inferred from the DIR-3 KYC record rather than checked with
 * MCA — which publishes no API for it. `derived` is always true, and the UI has
 * to say so: reporting a DIN active when the Registrar disagrees is worse than
 * reporting nothing.
 */
export interface DinStatus {
  state: 'ACTIVE' | 'DEACTIVATED' | 'DUE' | 'UNKNOWN';
  label: string;
  action: string | null;
  derived: boolean;
  asOfPeriod: string | null;
}

export interface Director {
  id: string; name: string; din: string | null; email: string | null;
  designation: string; appointedOn: string | null; resignedOn: string | null;
  dscExpiresOn?: string | null;
  isResident: boolean;
}

export interface Company {
  id: string; legalName: string; brandName: string | null; logoStorageKey: string | null; entityType: EntityType;
  businessType: BusinessType | null;
  cin: string | null; llpin: string | null; pan: string | null; tan: string | null;
  incorporationDate: string | null; stateCode: string; industry: string | null;
  registeredAddress: string | null; companyStatus: string | null;
  companyCategory: string | null; companySubCategory: string | null;
  companyClass: string | null; authorisedCapital: string;
  employeeCount: number; annualTurnover: string; paidUpCapital: string;
  cashTransactionRatioBelow5Pct: boolean; hasForeignTransactions: boolean;
  acceptsDeposits: boolean; isListed: boolean; buysFromMsmeSuppliers: boolean;
  agmDate: string | null; isActive: boolean; createdAt: string;
  /** Registrations held. They drive no rules — the dashboard reports them. */
  dpiitRecognitionNumber: string | null; dpiitRecognisedOn: string | null;
  epfoCode: string | null; esicCode: string | null;
  shopAndEstablishment: string | null; fssaiNumber: string | null;
  professionalTax: string | null; tradeLicense: string | null;
  /** This viewer's role and capabilities on this company specifically. */
  myRole: UserRole | null;
  myCapabilities: Capability[];
  directors: Director[];
  gstRegistrations: GstRegistration[];
  msmeRegistration: { udyamNumber: string; category: string; registeredOn: string | null } | null;
  /** Platform-wide onboarding metadata, present only for a SUPER_ADMIN. */
  status?: 'ACTIVE' | 'ARCHIVED';
  onboardedAt?: string | null;
  profileConfirmedAt?: string | null;
  onboardedBy?: { id: string; name: string; email: string } | null;
  organization?: { id: string; name: string; slug: string } | null;
}

/** One row of the SUPER_ADMIN platform-wide onboarding view. */
export interface OnboardedCompany {
  id: string;
  legalName: string;
  entityType: EntityType;
  status: 'ACTIVE' | 'ARCHIVED';
  onboardedAt: string;
  organization: { id: string; name: string; slug: string; trialEndsAt?: string | null };
  onboardedBy: { id: string; name: string; email: string } | null;
}

// ------------------------------------------------------------------ billing

export type PaymentStatus = 'CREATED' | 'AUTHORIZED' | 'SUCCESS' | 'FAILED' | 'REFUNDED';

/** One payment on the Company Owner's billing page — a real Payment row. */
export interface BillingPaymentRow {
  id: string;
  company: string | null;
  rzxOrderId: string;
  /** Inclusive of GST — what the card was actually debited. */
  amountPaise: number;
  amountLabel: string;
  /** The invoice split, as charged. Payments taken before plan tiers shipped
   *  carry a zero tax line, because no tax was separately charged on them. */
  baseAmountPaise: number;
  baseLabel: string;
  taxPercent: number;
  taxAmountPaise: number;
  taxLabel: string;
  currency: string;
  planName: string;
  planKey: string;
  status: PaymentStatus;
  method: string | null;
  paidAt: string | null;
  validUntil: string | null;
  createdAt: string;
}

/** GET /billing — the whole Company Owner billing page in one call. */
/** One purchasable term. Every figure is computed server-side from the plan
 *  catalog — the page prints these and never derives a price of its own. */
export interface PlanOption {
  key: 'ANNUAL' | 'TRIENNIAL';
  name: string;
  periodLabel: string;
  periodDays: number;
  recommended: boolean;
  baseAmountPaise: number;
  baseLabel: string;
  taxPercent: number;
  taxAmountPaise: number;
  taxLabel: string;
  amountPaise: number;
  amountLabel: string;
  perYearLabel: string;
}

export interface BillingView {
  plans: PlanOption[];
  currency: string;
  subscription: {
    status: 'TRIAL' | 'PAID';
    trialEndsAt: string | null;
    trialDaysLeft: number | null;
    validUntil: string | null;
    currentPlanKey: string | null;
    currentPlanName: string | null;
    paymentCount: number;
  };
  payments: BillingPaymentRow[];
  canPurchase: boolean;
}

export interface RenewalRow {
  organizationId: string;
  organizationName: string | null;
  validUntil: string | null;
  dueInDays: number;
}

export interface FailedPaymentRow {
  id: string;
  organizationName: string | null;
  rzxOrderId: string;
  amountPaise: number;
  amountLabel: string;
  status: PaymentStatus;
  method: string | null;
  createdAt: string;
}

export interface AnalyticsPaymentRow {
  id: string;
  organizationName: string | null;
  companyName: string | null;
  paidBy: { name: string; email: string } | null;
  rzxOrderId: string;
  amountPaise: number;
  amountLabel: string;
  currency: string;
  planName: string;
  status: PaymentStatus;
  method: string | null;
  paidAt: string | null;
  validUntil: string | null;
  createdAt: string;
}

/** GET /billing/analytics — SUPER_ADMIN platform-wide, all real data. */
export interface AnalyticsView {
  revenue: { allTime: number; thisMonth: number; thisYear: number; fiscalYear: number };
  revenueLabels: { allTime: string; thisMonth: string; thisYear: string; fiscalYear: string };
  organisations: { total: number; onTrial: number; trialExpired: number; payingNow: number; fullUnbilled: number; churned: number };
  conversion: { trialSignups: number; converted: number; rate: number; displayRate: string };
  churn: { everConverted: number; churned: number; rate: number; displayRate: string };
  renewals: { next30Days: RenewalRow[]; next30to60Days: RenewalRow[]; list: RenewalRow[] };
  trend: { key: string; label: string; amountPaise: number; amountLabel: string }[];
  failedPayments: FailedPaymentRow[];
  paymentHistory: AnalyticsPaymentRow[];
}

export interface ComplianceItem {
  id: string; ruleCode: string; title: string; authority: Authority; category: string;
  form: string | null; legalReference: string; severity: Severity;
  periodKey: string; periodLabel: string; periodStart: string; periodEnd: string;
  dueDate: string; status: ItemStatus; completedAt: string | null;
  waivedReason: string | null; penaltyNote: string | null;
  evidenceRequired: string[]; evidenceLevel: EvidenceLevel;
  attestationText: string | null; attestedAt: string | null; attestedById: string | null;
  signatoryName: string | null;
  company?: { id: string; legalName: string; entityType?: EntityType };
  task?: { id: string; status: TaskStatus; assigneeId?: string | null;
           assignee?: { id: string; name: string } | null } | null;
  _count?: { documents: number };
}

export interface Task {
  id: string; complianceItemId: string; companyId: string; title: string;
  description: string | null; status: TaskStatus; dueDate: string;
  notes: string | null; completedAt: string | null;
  checklist: { id: string; label: string; done: boolean }[];
  assigneeId: string | null;
  assignee: { id: string; name: string; email: string } | null;
  complianceItem: {
    id: string; ruleCode: string; authority: Authority; category: string;
    form: string | null; severity: Severity; status: ItemStatus;
    periodLabel: string; legalReference: string; penaltyNote: string | null;
    evidenceRequired: string[]; evidenceLevel: EvidenceLevel;
  };
  documents?: DocumentRow[];
  _count?: { documents: number };
}

export interface DocumentRow {
  id: string; fileName: string; mimeType: string; sizeBytes: number; sha256: string;
  label: string | null; storageDriver: string; createdAt: string;
  detectedType: string | null; pdfPages: number | null;
  hasDigitalSignature: boolean; signers: string[]; signedAt: string | null;
  companyId: string; complianceItemId: string | null; taskId: string | null;
  uploadedBy: { id: string; name: string; email: string } | null;
}

export interface Reason { label: string; passed: boolean; negated: boolean }

export interface Applicability {
  ruleCode: string; applicable: boolean; reasons: Reason[]; evaluatedAt: string;
  title: string; authority: Authority | null; category: string | null;
  severity: Severity | null; form: string | null;
}

export interface Score {
  score: number; band: 'A' | 'B' | 'C' | 'D';
  assessed: number; onTime: number; late: number; missed: number;
  waived: number; preOnboarding: number; upcoming: number;
  dueInNext30Days: number; overdueNow: number;
  byAuthority: { authority: Authority; earned: number; possible: number;
                 score: number; onTime: number; late: number; missed: number }[];
  windowStart: string; windowEnd: string;
}

/** The entity's own particulars, assembled by the dashboard in one call. */
export interface CompanyProfile {
  id: string;
  legalName: string;
  entityType: string;
  businessType: BusinessType | null;
  industry: string | null;
  registrationLabel: 'CIN' | 'LLPIN' | 'PAN';
  registrationNumber: string | null;
  incorporationDate: string | null;
  ageYears: number | null;
  pan: string | null;
  annualTurnover: number | null;
  employeeCount: number | null;
  stateCode: string | null;
  directors: { id: string; name: string; din: string | null; designation: string;
               dscExpiresOn: string | null; dscStatus: 'ACTIVE' | 'EXPIRED' | 'NOT_RECORDED';
               dinStatus: DinStatus }[];
  msme: { udyamNumber: string; category: string; registeredOn: string | null } | null;
  gstins: { gstin: string; stateCode: string; isActive: boolean }[];
  dpiit: { number: string; recognisedOn: string | null } | null;
  epfoCode: string | null;
  esicCode: string | null;
  shopAndEstablishment: string | null;
  fssai: string | null;
  professionalTax: string | null;
  tradeLicense: string | null;
  dsc: { status: 'ACTIVE' | 'EXPIRED' | 'NOT_RECORDED'; active: number; total: number; nextExpiry: string | null };
  mcaKyc: { status: 'MET' | 'NOT_MET' | 'NOT_DUE' | 'NOT_APPLICABLE'; dueDate: string | null; periodLabel: string | null };
}

export interface EvaluatedRegistration {
  id: string;
  title: string;
  status: 'REGISTERED' | 'ELIGIBLE' | 'MANDATORY' | 'PENDING_APPLICATION' | 'EXPIRED_RENEWAL_DUE';
  reason: string;
  ctaUrl?: string;
  authority: Authority;
}

export interface Overview {
  score: Score;
  companies: number;
  statusCounts: Record<ItemStatus, number>;
  severityCounts: Record<Severity, number>;
  byAuthority: { authority: Authority; total: number; overdue: number;
                 completed: number; upcoming: number }[];
  overdue: ComplianceItem[];
  dueSoon: ComplianceItem[];
  registrations: EvaluatedRegistration[];
  taskCounts: Record<string, number>;
  evidence: { itemsRequiringEvidence: number; itemsWithEvidence: number; coveragePct: number };
  /** Null org-wide — there is no single entity to describe. */
  profile: CompanyProfile | null;
}

export interface Paged<T> { total: number; page: number; pageSize: number; rows: T[] }

export interface Citation {
  ruleCode: string; title: string; form: string | null; authority: string;
  legalReference: string; severity: string; penalty: string;
  appliesToThisCompany: boolean | null; reasons: Reason[] | null;
  nextDueDate: string | null; nextDueStatus: string | null;
}

export interface CopilotAnswer {
  question: string; answer: string; citations: Citation[];
  companyId: string | null; provider: string;
  confidence: 'high' | 'medium' | 'low'; disclaimer: string;
}

export interface SyncResult {
  companyId: string; applicableRules: number; inapplicableRules: number;
  created: number; updated: number; removed: number;
}
