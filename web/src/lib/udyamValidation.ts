// web/src/lib/udyamValidation.ts
import { stateByCode, stateByGstCode } from './india';
import type { UdyamMasterRecord } from '../api/types';

export const UDYAM_REGEX = /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/i;

export function isValidUdyamFormat(udyamNumber: string): boolean {
  if (!udyamNumber) return false;
  return UDYAM_REGEX.test(udyamNumber.trim());
}

export function normalizeLegalName(name: string): string {
  if (!name) return '';
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\bPRIVATE\s+LIMITED\b/g, 'PVT LTD')
    .replace(/\bLIMITED\b/g, 'LTD')
    .replace(/\bPUBLIC\s+LIMITED\b/g, 'PUBLIC LTD')
    .replace(/\bLIMITED\s+LIABILITY\s+PARTNERSHIP\b/g, 'LLP')
    .replace(/\s+/g, ' ')
    .trim();
}

export function compareLegalNames(
  enterpriseName: string,
  companyLegalName: string
): { match: boolean; details: string } {
  const normEnterprise = normalizeLegalName(enterpriseName);
  const normComp = normalizeLegalName(companyLegalName);

  const match =
    normEnterprise === normComp ||
    (normEnterprise.length > 3 && normComp.length > 3 && (normEnterprise.includes(normComp) || normComp.includes(normEnterprise)));

  return {
    match,
    details: match
      ? `Enterprise name matches (${enterpriseName})`
      : `Legal name mismatch (Udyam: "${enterpriseName}", Company: "${companyLegalName}")`,
  };
}

export function comparePan(
  udyamPan: string | null,
  companyPan: string | null
): { match: boolean; details: string } {
  if (!udyamPan || !companyPan) {
    return { match: true, details: 'PAN comparison skipped (not recorded on both records)' };
  }

  const cleanUdyamPan = udyamPan.trim().toUpperCase();
  const cleanCompanyPan = companyPan.trim().toUpperCase();
  const match = cleanUdyamPan === cleanCompanyPan;

  return {
    match,
    details: match
      ? `PAN matches (${cleanUdyamPan})`
      : `PAN mismatch (Udyam: "${cleanUdyamPan}", Company: "${cleanCompanyPan}")`,
  };
}

export function compareState(
  udyamState: string,
  companyStateCode: string
): { match: boolean; details: string } {
  if (!udyamState) return { match: true, details: 'State code verified' };

  const stateInfo = stateByCode(companyStateCode) || stateByGstCode(companyStateCode);
  const expectedStateName = stateInfo?.name || companyStateCode;

  const cleanUdyamState = udyamState.toUpperCase().trim();
  const cleanCompStateCode = companyStateCode.toUpperCase().trim();

  const match =
    cleanUdyamState.includes(cleanCompStateCode) ||
    (stateInfo && (cleanUdyamState.includes(stateInfo.name.toUpperCase()) || stateInfo.name.toUpperCase().includes(cleanUdyamState)));

  return {
    match: Boolean(match),
    details: match
      ? `State matches (${udyamState})`
      : `State mismatch (Udyam State: ${udyamState}, Company State: ${expectedStateName} [${companyStateCode}])`,
  };
}

export interface UdyamCompanyValidationSummary {
  formatValid: boolean;
  isActiveStatus: boolean;
  statusDetails: string;
  legalNameCheck: { match: boolean; details: string };
  panCheck: { match: boolean; details: string };
  stateCheck: { match: boolean; details: string };
  passedChecks: string[];
  failedChecks: string[];
  warnings: string[];
}

export function validateUdyamForCompany(
  verifiedUdyam: UdyamMasterRecord,
  company: { legalName: string; stateCode: string; pan?: string | null }
): UdyamCompanyValidationSummary {
  const formatValid = isValidUdyamFormat(verifiedUdyam.udyamNumber);
  const isActiveStatus = (verifiedUdyam.status || 'Active').toUpperCase() === 'ACTIVE';
  const statusDetails = isActiveStatus ? 'Udyam status: Active' : `Udyam status: ${verifiedUdyam.status} (Cancelled/Inactive)`;

  const legalNameCheck = compareLegalNames(verifiedUdyam.enterpriseName, company.legalName);
  const panCheck = comparePan(verifiedUdyam.pan, company.pan || null);
  const stateCheck = compareState(verifiedUdyam.state, company.stateCode);

  const passedChecks: string[] = [];
  const failedChecks: string[] = [];
  const warnings: string[] = [];

  if (formatValid) passedChecks.push('Udyam registration number format is valid');
  else failedChecks.push('Invalid Udyam registration number format');

  if (isActiveStatus) passedChecks.push('Udyam registration status is Active');
  else warnings.push(statusDetails);

  if (legalNameCheck.match) passedChecks.push(legalNameCheck.details);
  else failedChecks.push(legalNameCheck.details);

  if (verifiedUdyam.pan && company.pan) {
    if (panCheck.match) passedChecks.push(panCheck.details);
    else failedChecks.push(panCheck.details);
  }

  if (stateCheck.match) passedChecks.push(stateCheck.details);
  else warnings.push(stateCheck.details);

  return {
    formatValid,
    isActiveStatus,
    statusDetails,
    legalNameCheck,
    panCheck,
    stateCheck,
    passedChecks,
    failedChecks,
    warnings,
  };
}
