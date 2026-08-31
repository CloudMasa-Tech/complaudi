import type { ComplianceContext, CompanyProfile, EntityType } from '../src/engine/types';
import { parseDate } from '../src/lib/dates';

export const CRORE = 10_000_000;
export const LAKH = 100_000;

export function makeCompany(overrides: Partial<CompanyProfile> = {}): CompanyProfile {
  return {
    id: 'company-1',
    legalName: 'Test Private Limited',
    entityType: 'PRIVATE_LIMITED' as EntityType,
    cin: 'U72900TN2020PTC123456',
    llpin: null,
    pan: 'AAACT1234A',
    tan: 'CHET12345A',
    incorporationDate: parseDate('2020-06-15'),
    stateCode: 'TN',
    industry: 'Software',
    employeeCount: 25,
    annualTurnover: 8 * CRORE,
    paidUpCapital: 10 * LAKH,
    cashTransactionRatioBelow5Pct: true,
    hasForeignTransactions: false,
    acceptsDeposits: false,
    isListed: false,
    buysFromMsmeSuppliers: true,
    agmDate: null,
    ...overrides,
  };
}

export function makeContext(overrides: Partial<ComplianceContext> = {}): ComplianceContext {
  return {
    company: makeCompany(),
    directors: [
      { id: 'd1', name: 'A Director', din: '01234567', designation: 'Director', appointedOn: parseDate('2020-06-15'), resignedOn: null },
    ],
    gstRegistrations: [
      { id: 'g1', gstin: '33AAACT1234A1Z8', stateCode: 'TN', filingFrequency: 'MONTHLY', isTdsDeductor: false, isEcommerceOperator: false, isActive: true },
    ],
    msme: null,
    ...overrides,
  };
}
