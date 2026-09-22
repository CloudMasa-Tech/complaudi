// supabase/functions/_shared/engine/types.ts
import type { FinancialYear } from '../dates.ts';

export type Authority = 'MCA' | 'GST' | 'INCOME_TAX' | 'MSME' | 'LABOUR' | 'DPIIT';
export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type EntityType =
  | 'PRIVATE_LIMITED'
  | 'PUBLIC_LIMITED'
  | 'OPC'
  | 'LLP'
  | 'PARTNERSHIP'
  | 'PROPRIETORSHIP'
  | 'SECTION_8'
  | 'UNREGISTERED';

export type GstFilingFrequency = 'MONTHLY' | 'QRMP' | 'COMPOSITION';
export type MsmeCategory = 'MICRO' | 'SMALL' | 'MEDIUM';

export type PeriodKind = 'ANNUAL' | 'HALF_YEARLY' | 'QUARTERLY' | 'MONTHLY' | 'ONE_TIME' | 'EVENT_BASED';

export type EvidenceLevel = 'REQUIRED' | 'ATTEST' | 'NONE';

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
  annualTurnover: number;
  paidUpCapital: number;
  cashTransactionRatioBelow5Pct: boolean;
  hasForeignTransactions: boolean;
  acceptsDeposits: boolean;
  isListed: boolean;
  buysFromMsmeSuppliers: boolean;
  agmDate: Date | null;
  epfoCode: string | null;
  esicCode: string | null;
  professionalTax: string | null;
  shopAndEstablishment: string | null;
  events?: Array<{ eventType: string; eventDate: Date }>;
}

export interface ComplianceContext {
  company: CompanyProfile;
  directors: DirectorProfile[];
  gstRegistrations: GstProfile[];
  msme: MsmeProfile | null;
}

export interface Condition {
  label: string;
  test: (ctx: ComplianceContext) => boolean;
  entityScope?: EntityType[];
  entityOnly?: boolean;
}

export interface ConditionResult {
  label: string;
  passed: boolean;
  negated: boolean;
}

export interface Occurrence {
  periodKey: string;
  periodLabel: string;
  periodStart: Date;
  periodEnd: Date;
  dueDate: Date;
  metadata?: Record<string, unknown>;
  title?: string;
}

export interface ComplianceRule {
  code: string;
  title: string;
  authority: Authority;
  category: string;
  form?: string;
  legalReference: string;
  description: string;
  severity: Severity;
  penalty: string;
  evidenceRequired: string[];
  evidenceLevel: EvidenceLevel;
  signatoryRequired?: boolean;
  basedOnAnnualAccounts?: boolean;
  periodKind: PeriodKind;
  applicableWhen: Condition[];
  excludeWhen?: Condition[];
  occurrences: (fy: FinancialYear, ctx: ComplianceContext) => Occurrence[];
}

export interface RuleEvaluation {
  rule: ComplianceRule;
  applicable: boolean;
  reasons: ConditionResult[];
}
