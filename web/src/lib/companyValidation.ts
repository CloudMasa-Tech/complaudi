// web/src/lib/companyValidation.ts
import { decodeCin, stateByCode, CIN_REGEX, LLPIN_REGEX } from './india';

export interface CompanyMasterRecord {
  cin: string;
  legalName?: string;
  entityType?: string;
  incorporationDate?: string; // YYYY-MM-DD
  incorporationYear?: number;
  stateCode?: string;
  roc?: string;
  status?: string;
}

export const ROC_BY_STATE: Record<string, string[]> = {
  TN: ['ROC Chennai', 'ROC Coimbatore'],
  MH: ['ROC Mumbai', 'ROC Pune'],
  DL: ['ROC Delhi'],
  KA: ['ROC Bangalore'],
  GJ: ['ROC Ahmedabad'],
  WB: ['ROC Kolkata'],
  TG: ['ROC Hyderabad'],
  AP: ['ROC Vijayawada', 'ROC Hyderabad'],
  UP: ['ROC Kanpur'],
  RJ: ['ROC Jaipur'],
  KL: ['ROC Ernakulam'],
  BR: ['ROC Patna'],
  CH: ['ROC Chandigarh'],
  PB: ['ROC Chandigarh'],
  HR: ['ROC Chandigarh'],
  HP: ['ROC Chandigarh'],
  JK: ['ROC Jammu', 'ROC Srinagar'],
  CG: ['ROC Chhattisgarh'],
  JH: ['ROC Ranchi'],
  UK: ['ROC Uttarakhand'],
  MP: ['ROC Gwalior'],
  GA: ['ROC Goa'],
  OD: ['ROC Cuttack'],
  AS: ['ROC Shillong', 'ROC Guwahati'],
  ML: ['ROC Shillong'],
  TR: ['ROC Shillong'],
  MN: ['ROC Shillong'],
  MZ: ['ROC Shillong'],
  NL: ['ROC Shillong'],
  AR: ['ROC Shillong'],
  PY: ['ROC Puducherry'],
  AN: ['ROC Chennai'],
  LD: ['ROC Ernakulam'],
  LA: ['ROC Jammu'],
  DNDD: ['ROC Ahmedabad'],
};

export const ENTITY_TYPE_LABELS: Record<string, string> = {
  PRIVATE_LIMITED: 'Private Limited Company',
  PUBLIC_LIMITED: 'Public Limited Company',
  OPC: 'One Person Company',
  LLP: 'Limited Liability Partnership',
  PARTNERSHIP: 'Partnership Firm',
  PROPRIETORSHIP: 'Sole Proprietorship',
  SECTION_8: 'Section 8 Company',
  UNREGISTERED: 'Unregistered / Individual',
};

/** Normalize company name for comparison: strip punctuation, extra spaces, and standardize legal suffixes. */
export function normalizeCompanyName(name: string): string {
  if (!name) return '';
  return name
    .toUpperCase()
    .trim()
    .replace(/\bPVT\.?\s*LTD\.?\b|\bPVT\.?\s*LIMITED\b/g, 'PRIVATE LIMITED')
    .replace(/\bLTD\.?\b/g, 'LIMITED')
    .replace(/\bLLP\.?\b/g, 'LLP')
    .replace(/\bINC\.?\b/g, 'INCORPORATED')
    .replace(/\bCORP\.?\b/g, 'CORPORATION')
    .replace(/[^A-Z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ValidationFieldError {
  field: 'cin' | 'companyName' | 'entityType' | 'incorporationDate' | 'stateCode' | 'roc';
  message: string;
}

export interface CompanyValidationInput {
  cin?: string | null;
  companyName?: string | null;
  entityType?: string | null;
  incorporationDate?: string | null;
  stateCode?: string | null;
  roc?: string | null;
  status?: string | null;
  masterRecord?: CompanyMasterRecord | null;
  existingCinsInDb?: string[];
}

/**
 * Dynamic company master data validation engine.
 * Decodes CIN format dynamically and validates user input against MCA standards and DB records.
 */
export function validateCompanyMasterData(input: CompanyValidationInput): {
  valid: boolean;
  errors: ValidationFieldError[];
  masterRecord?: CompanyMasterRecord | null;
} {
  const errors: ValidationFieldError[] = [];
  const rawCin = (input.cin || '').toUpperCase().trim();

  if (!rawCin) {
    return { valid: true, errors: [] }; // Optional CIN, unconstrained when empty
  }

  // 1. CIN Format & Length Validation
  const isStandardCin = CIN_REGEX.test(rawCin);
  const isLlpin = LLPIN_REGEX.test(rawCin) || /^[A-Z]{3}[0-9]{4}$/i.test(rawCin);

  if (!isStandardCin && !isLlpin) {
    errors.push({
      field: 'cin',
      message: 'Invalid CIN format. CIN must be 21 alphanumeric characters (e.g. U72900TN2020PTC138472) or 7-character LLPIN.',
    });
    return { valid: false, errors };
  }

  // 8. Duplicate CIN Check against database
  if (input.existingCinsInDb && input.existingCinsInDb.map((c) => c.toUpperCase().trim()).includes(rawCin)) {
    errors.push({
      field: 'cin',
      message: `CIN ${rawCin} is already registered in Complaudi. Duplicate company onboarding is not permitted.`,
    });
  }

  // Decode CIN structure dynamically
  const decoded = isStandardCin ? decodeCin(rawCin) : null;
  const derivedStateCode = decoded?.stateCode || (isStandardCin ? rawCin.slice(6, 8) : null);
  const derivedEntityType = decoded?.entityType || (isLlpin ? 'LLP' : null);
  const derivedYear = decoded?.incorporationYear;
  const validRocs = derivedStateCode ? (ROC_BY_STATE[derivedStateCode] || ['ROC ' + derivedStateCode]) : [];

  const master: CompanyMasterRecord = {
    cin: rawCin,
    legalName: input.masterRecord?.legalName || (input.companyName ? input.companyName.toUpperCase().trim() : undefined),
    entityType: input.masterRecord?.entityType || derivedEntityType || undefined,
    incorporationDate: input.masterRecord?.incorporationDate,
    incorporationYear: input.masterRecord?.incorporationYear || derivedYear || undefined,
    stateCode: input.masterRecord?.stateCode || derivedStateCode || undefined,
    roc: input.masterRecord?.roc || (validRocs[0] ?? undefined),
    status: input.masterRecord?.status || input.status || 'ACTIVE',
  };

  // 7. Company Status Check
  const effectiveStatus = (master.status || 'ACTIVE').toUpperCase().trim();
  const ineligibleStatuses = ['STRIKE_OFF', 'STRUCK_OFF', 'DISSOLVED', 'UNDER_LIQUIDATION', 'LIQUIDATED', 'AMALGAMATED', 'INACTIVE', 'DORMANT'];
  if (ineligibleStatuses.includes(effectiveStatus)) {
    errors.push({
      field: 'cin',
      message: `Company status is "${effectiveStatus}". Ineligible company status cannot proceed with onboarding.`,
    });
  }

  // 2. CIN -> Company Name Validation (if master record name exists)
  if (input.companyName && input.masterRecord?.legalName) {
    const userNorm = normalizeCompanyName(input.companyName);
    const masterNorm = normalizeCompanyName(input.masterRecord.legalName);

    if (userNorm !== masterNorm) {
      errors.push({
        field: 'companyName',
        message: `Company Name does not match MCA records for this CIN. Registered name: "${input.masterRecord.legalName}".`,
      });
    }
  }

  // 3. CIN -> Entity Type Validation
  if (input.entityType && master.entityType) {
    if (input.entityType !== master.entityType) {
      const expectedLabel = ENTITY_TYPE_LABELS[master.entityType] || master.entityType;
      errors.push({
        field: 'entityType',
        message: `Entity Type does not match CIN records. This CIN is registered as ${expectedLabel}.`,
      });
    }
  }

  // 4. CIN -> Incorporation Date / Year Validation
  if (input.incorporationDate) {
    const userDateStr = input.incorporationDate.trim();
    const userYear = new Date(userDateStr).getFullYear();

    if (master.incorporationDate) {
      if (userDateStr !== master.incorporationDate) {
        errors.push({
          field: 'incorporationDate',
          message: `Date of Incorporation does not match MCA records for this CIN. Registered date: ${master.incorporationDate}.`,
        });
      }
    } else if (master.incorporationYear && Number.isFinite(userYear)) {
      if (userYear !== master.incorporationYear) {
        errors.push({
          field: 'incorporationDate',
          message: `Incorporation year (${userYear}) does not match CIN records (${master.incorporationYear}).`,
        });
      }
    }
  }

  // 5. CIN -> State Validation
  if (input.stateCode && master.stateCode) {
    const userState = input.stateCode.toUpperCase().trim();
    const masterState = master.stateCode.toUpperCase().trim();

    if (userState !== masterState) {
      const userStateObj = stateByCode(userState);
      const masterStateObj = stateByCode(masterState);
      const userStateName = userStateObj ? userStateObj.name : userState;
      const masterStateName = masterStateObj ? masterStateObj.name : masterState;

      errors.push({
        field: 'stateCode',
        message: `Selected state (${userStateName}) does not match CIN registered state (${masterStateName}).`,
      });
    }
  }

  // 6. CIN -> ROC Validation
  if (input.roc && master.stateCode) {
    const validRocsForState = ROC_BY_STATE[master.stateCode] || [master.roc || ''];
    if (!validRocsForState.map((r) => r.toLowerCase()).includes(input.roc.toLowerCase().trim())) {
      errors.push({
        field: 'roc',
        message: `ROC/Jurisdiction "${input.roc}" is not valid for state ${master.stateCode}. Expected: ${validRocsForState.join(' or ')}.`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    masterRecord: master,
  };
}
