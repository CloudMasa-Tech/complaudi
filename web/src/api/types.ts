export type Authority = 'MCA' | 'GST' | 'INCOME_TAX' | 'MSME' | 'LABOUR';
export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type ItemStatus = 'UPCOMING' | 'DUE' | 'OVERDUE' | 'COMPLETED' | 'WAIVED';
export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED';
export type EvidenceLevel = 'REQUIRED' | 'ATTEST' | 'NONE';

export type EntityType =
  | 'PRIVATE_LIMITED' | 'PUBLIC_LIMITED' | 'OPC' | 'LLP'
  | 'PARTNERSHIP' | 'PROPRIETORSHIP' | 'SECTION_8';

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
  id: string; name: string; email: string; role: UserRole; organizationId: string;
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
}

export interface GstRegistration {
  id: string; gstin: string; stateCode: string;
  filingFrequency: 'MONTHLY' | 'QRMP' | 'COMPOSITION';
  isTdsDeductor: boolean; isEcommerceOperator: boolean; isActive: boolean;
}

export interface Director {
  id: string; name: string; din: string | null; email: string | null;
  designation: string; appointedOn: string | null; resignedOn: string | null;
  dscExpiresOn?: string | null;
  isResident: boolean;
}

export interface Company {
  id: string; legalName: string; brandName: string | null; entityType: EntityType;
  cin: string | null; llpin: string | null; pan: string | null; tan: string | null;
  incorporationDate: string | null; stateCode: string; industry: string | null;
  employeeCount: number; annualTurnover: string; paidUpCapital: string;
  cashTransactionRatioBelow5Pct: boolean; hasForeignTransactions: boolean;
  acceptsDeposits: boolean; isListed: boolean; buysFromMsmeSuppliers: boolean;
  agmDate: string | null; isActive: boolean; createdAt: string;
  /** Registrations held. They drive no rules — the dashboard reports them. */
  dpiitRecognitionNumber: string | null; dpiitRecognisedOn: string | null;
  epfoCode: string | null; esicCode: string | null;
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
  organization: { id: string; name: string; slug: string };
  onboardedBy: { id: string; name: string; email: string } | null;
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
  registrationLabel: 'CIN' | 'LLPIN' | 'PAN';
  registrationNumber: string | null;
  incorporationDate: string | null;
  ageYears: number | null;
  pan: string | null;
  directors: { id: string; name: string; din: string | null; designation: string;
               dscExpiresOn: string | null; dscStatus: 'ACTIVE' | 'EXPIRED' | 'NOT_RECORDED' }[];
  msme: { udyamNumber: string; category: string; registeredOn: string | null } | null;
  gstins: { gstin: string; stateCode: string; isActive: boolean }[];
  dpiit: { number: string; recognisedOn: string | null } | null;
  epfoCode: string | null;
  esicCode: string | null;
  dsc: { status: 'ACTIVE' | 'EXPIRED' | 'NOT_RECORDED'; active: number; total: number; nextExpiry: string | null };
  mcaKyc: { status: 'MET' | 'NOT_MET' | 'NOT_DUE' | 'NOT_APPLICABLE'; dueDate: string | null; periodLabel: string | null };
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
