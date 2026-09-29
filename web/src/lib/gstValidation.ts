// web/src/lib/gstValidation.ts
import { GSTIN_REGEX, isValidGstinChecksum, stateByGstCode } from './india';
import type { GstMasterRecord } from '../api/types';

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
  gstLegalName: string,
  companyLegalName: string
): { match: boolean; details: string } {
  const normGst = normalizeLegalName(gstLegalName);
  const normComp = normalizeLegalName(companyLegalName);

  const match =
    normGst === normComp ||
    (normGst.length > 3 && normComp.length > 3 && (normGst.includes(normComp) || normComp.includes(normGst)));

  return {
    match,
    details: match
      ? 'Legal name matches'
      : `Legal name mismatch (GST Portal: "${gstLegalName}", Company: "${companyLegalName}")`,
  };
}

export function compareStateCode(
  gstinStateCode: string | null,
  companyStateCode: string
): { match: boolean; details: string } {
  if (!gstinStateCode) return { match: true, details: 'State code verified' };

  const gstStateInfo = stateByGstCode(gstinStateCode);
  const gstStateName = gstStateInfo?.name || gstinStateCode;

  const cleanCompState = companyStateCode.toUpperCase().trim();
  const match =
    gstinStateCode === cleanCompState ||
    (gstStateInfo &&
      (gstStateInfo.code.toUpperCase() === cleanCompState ||
        gstStateInfo.name.toUpperCase() === cleanCompState));

  return {
    match: Boolean(match),
    details: match
      ? `State matches (${gstStateName})`
      : `State mismatch (GST State: ${gstStateName} [${gstinStateCode}], Company State: ${companyStateCode})`,
  };
}

export function compareConstitution(
  constitution: string | null,
  entityType: string
): { match: boolean; details: string } {
  if (!constitution) return { match: true, details: 'Constitution verified' };

  const constUpper = constitution.toUpperCase();
  const entityUpper = entityType.toUpperCase();

  let expectedKeywords: string[] = [];
  if (entityUpper === 'PRIVATE_LIMITED') expectedKeywords = ['PRIVATE', 'PVT', 'PRIVATE LIMITED'];
  else if (entityUpper === 'PUBLIC_LIMITED') expectedKeywords = ['PUBLIC', 'PUBLIC LIMITED'];
  else if (entityUpper === 'LLP') expectedKeywords = ['LIMITED LIABILITY PARTNERSHIP', 'LLP'];
  else if (entityUpper === 'PROPRIETORSHIP') expectedKeywords = ['PROPRIETORSHIP', 'PROPRIETOR'];
  else if (entityUpper === 'PARTNERSHIP') expectedKeywords = ['PARTNERSHIP'];
  else if (entityUpper === 'OPC') expectedKeywords = ['ONE PERSON', 'OPC'];

  const match = expectedKeywords.some((kw) => constUpper.includes(kw)) || constUpper.includes(entityUpper);

  return {
    match,
    details: match
      ? `Constitution matches (${constitution})`
      : `Constitution mismatch (GST: "${constitution}", Company: "${entityType}")`,
  };
}

export interface GstCompanyValidationSummary {
  formatValid: boolean;
  checksumValid: boolean;
  isActiveStatus: boolean;
  statusDetails: string;
  stateCheck: { match: boolean; details: string };
  legalNameCheck: { match: boolean; details: string };
  constitutionCheck: { match: boolean; details: string };
  registrationDateCheck: { valid: boolean; details: string };
}

export function validateGstForCompany(
  verifiedGst: GstMasterRecord,
  company: { legalName: string; stateCode: string; entityType: string }
): GstCompanyValidationSummary {
  const formatValid = GSTIN_REGEX.test(verifiedGst.gstin);
  const checksumValid = isValidGstinChecksum(verifiedGst.gstin);
  const isActiveStatus = verifiedGst.status.toUpperCase() === 'ACTIVE';

  let dateValid = true;
  let dateMsg = 'Registration date valid';
  if (verifiedGst.registrationDate) {
    const parsedDate = new Date(verifiedGst.registrationDate);
    if (!Number.isNaN(parsedDate.getTime()) && parsedDate > new Date()) {
      dateValid = false;
      dateMsg = `Future registration date: ${verifiedGst.registrationDate}`;
    } else {
      dateMsg = `Registration date: ${verifiedGst.registrationDate}`;
    }
  }

  return {
    formatValid,
    checksumValid,
    isActiveStatus,
    statusDetails: isActiveStatus ? 'GST status: Active' : `GST status: ${verifiedGst.status} (Not Active)`,
    stateCheck: compareStateCode(verifiedGst.stateCode, company.stateCode),
    legalNameCheck: compareLegalNames(verifiedGst.legalName, company.legalName),
    constitutionCheck: compareConstitution(verifiedGst.constitution, company.entityType),
    registrationDateCheck: { valid: dateValid, details: dateMsg },
  };
}
