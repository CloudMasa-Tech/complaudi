/**
 * Identifier formats and state codes used across Indian statutory filings.
 *
 * These are worth validating at the edge: a mistyped GSTIN or PAN propagates
 * silently into every return the calendar generates for that entity.
 */

export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const TAN_REGEX = /^[A-Z]{4}[0-9]{5}[A-Z]$/;
export const CIN_REGEX = /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;
export const LLPIN_REGEX = /^[A-Z]{3}-[0-9]{4}$/;
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const UDYAM_REGEX = /^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/;
export const DIN_REGEX = /^[0-9]{8}$/;

export interface StateInfo {
  /** GST state code, e.g. "33" */
  gstCode: string;
  /** Short code used throughout the app, e.g. "TN" */
  code: string;
  name: string;
}

export const STATES: StateInfo[] = [
  { gstCode: '01', code: 'JK', name: 'Jammu and Kashmir' },
  { gstCode: '02', code: 'HP', name: 'Himachal Pradesh' },
  { gstCode: '03', code: 'PB', name: 'Punjab' },
  { gstCode: '04', code: 'CH', name: 'Chandigarh' },
  { gstCode: '05', code: 'UK', name: 'Uttarakhand' },
  { gstCode: '06', code: 'HR', name: 'Haryana' },
  { gstCode: '07', code: 'DL', name: 'Delhi' },
  { gstCode: '08', code: 'RJ', name: 'Rajasthan' },
  { gstCode: '09', code: 'UP', name: 'Uttar Pradesh' },
  { gstCode: '10', code: 'BR', name: 'Bihar' },
  { gstCode: '11', code: 'SK', name: 'Sikkim' },
  { gstCode: '12', code: 'AR', name: 'Arunachal Pradesh' },
  { gstCode: '13', code: 'NL', name: 'Nagaland' },
  { gstCode: '14', code: 'MN', name: 'Manipur' },
  { gstCode: '15', code: 'MZ', name: 'Mizoram' },
  { gstCode: '16', code: 'TR', name: 'Tripura' },
  { gstCode: '17', code: 'ML', name: 'Meghalaya' },
  { gstCode: '18', code: 'AS', name: 'Assam' },
  { gstCode: '19', code: 'WB', name: 'West Bengal' },
  { gstCode: '20', code: 'JH', name: 'Jharkhand' },
  { gstCode: '21', code: 'OD', name: 'Odisha' },
  { gstCode: '22', code: 'CG', name: 'Chhattisgarh' },
  { gstCode: '23', code: 'MP', name: 'Madhya Pradesh' },
  { gstCode: '24', code: 'GJ', name: 'Gujarat' },
  { gstCode: '26', code: 'DNDD', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { gstCode: '27', code: 'MH', name: 'Maharashtra' },
  { gstCode: '29', code: 'KA', name: 'Karnataka' },
  { gstCode: '30', code: 'GA', name: 'Goa' },
  { gstCode: '31', code: 'LD', name: 'Lakshadweep' },
  { gstCode: '32', code: 'KL', name: 'Kerala' },
  { gstCode: '33', code: 'TN', name: 'Tamil Nadu' },
  { gstCode: '34', code: 'PY', name: 'Puducherry' },
  { gstCode: '35', code: 'AN', name: 'Andaman and Nicobar Islands' },
  { gstCode: '36', code: 'TG', name: 'Telangana' },
  { gstCode: '37', code: 'AP', name: 'Andhra Pradesh' },
  { gstCode: '38', code: 'LA', name: 'Ladakh' },
  { gstCode: '97', code: 'OT', name: 'Other Territory' },
];

const BY_SHORT_CODE = new Map(STATES.map((s) => [s.code, s]));
const BY_GST_CODE = new Map(STATES.map((s) => [s.gstCode, s]));

export const STATE_CODES = STATES.map((s) => s.code);

export const isValidStateCode = (code: string): boolean => BY_SHORT_CODE.has(code.toUpperCase());
export const stateByCode = (code: string): StateInfo | undefined => BY_SHORT_CODE.get(code.toUpperCase());
export const stateByGstCode = (gstCode: string): StateInfo | undefined => BY_GST_CODE.get(gstCode);

const GSTIN_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Verifies the 15th character of a GSTIN, which is a modulus-36 check digit
 * computed over the first fourteen. Catches transposed and mistyped digits that
 * the format regex alone lets through.
 */
export function isValidGstinChecksum(gstin: string): boolean {
  if (!GSTIN_REGEX.test(gstin)) return false;

  let sum = 0;
  let factor = 2;
  for (let i = 13; i >= 0; i -= 1) {
    const codePoint = GSTIN_ALPHABET.indexOf(gstin[i]!);
    if (codePoint < 0) return false;
    const product = codePoint * factor;
    factor = factor === 2 ? 1 : 2;
    sum += Math.floor(product / 36) + (product % 36);
  }

  const expected = GSTIN_ALPHABET[(36 - (sum % 36)) % 36];
  return expected === gstin[14];
}

/** The PAN sits in characters 3–12 of a GSTIN. */
export const panFromGstin = (gstin: string): string => gstin.slice(2, 12);

/** The state short code implied by a GSTIN's first two digits. */
export const stateCodeFromGstin = (gstin: string): string | undefined => stateByGstCode(gstin.slice(0, 2))?.code;

export interface GstinValidation {
  valid: boolean;
  errors: string[];
  stateCode?: string;
  pan?: string;
}

/** Full GSTIN check: format, check digit, resolvable state, and PAN agreement. */
export function validateGstin(gstin: string, companyPan?: string | null): GstinValidation {
  const errors: string[] = [];
  const value = gstin.toUpperCase().trim();

  if (!GSTIN_REGEX.test(value)) {
    return { valid: false, errors: ['GSTIN must be 15 characters in the format 22AAAAA0000A1Z5'] };
  }
  if (!isValidGstinChecksum(value)) errors.push('GSTIN check digit does not match — the number appears to be mistyped');

  const state = stateByGstCode(value.slice(0, 2));
  if (!state) errors.push(`GSTIN state code "${value.slice(0, 2)}" is not a recognised state`);

  const pan = panFromGstin(value);
  if (!PAN_REGEX.test(pan)) errors.push('The PAN embedded in the GSTIN is not a valid PAN');
  if (companyPan && pan !== companyPan.toUpperCase()) {
    errors.push(`GSTIN belongs to PAN ${pan}, which does not match the company PAN ${companyPan.toUpperCase()}`);
  }

  return { valid: errors.length === 0, errors, stateCode: state?.code, pan };
}

/** Characters 8–10 of a CIN carry the incorporation year; 6–7 carry the state. */
export function parseCin(cin: string): { listed: boolean; stateCode?: string; year?: number } | null {
  const value = cin.toUpperCase().trim();
  if (!CIN_REGEX.test(value)) return null;
  return {
    listed: value.startsWith('L'),
    stateCode: value.slice(6, 8),
    year: Number(value.slice(8, 12)),
  };
}

// ---------------------------------------------------------------- CIN decoding

/**
 * A CIN is a structured identifier, not an opaque key:
 *
 *   U 72900 TN 2020 PTC 138472
 *   │ │     │  │    │   └────── registration number
 *   │ │     │  │    └────────── ownership class
 *   │ │     │  └─────────────── year of incorporation
 *   │ │     └────────────────── state of the registering RoC
 *   │ └──────────────────────── industry / activity code
 *   └────────────────────────── L listed, U unlisted
 *
 * Everything below is read out of those characters. It is *derivation*, not a
 * lookup: no MCA service is contacted, so the legal name, the exact
 * incorporation date and the directors cannot come from here.
 */

/** MCA ownership classes, mapped to the entity types this app models. */
const OWNERSHIP: Record<string, { label: string; entityType: string | null }> = {
  PTC: { label: 'Private Limited Company', entityType: 'PRIVATE_LIMITED' },
  FTC: { label: 'Subsidiary of a Foreign Company (private)', entityType: 'PRIVATE_LIMITED' },
  ULT: { label: 'Unlimited Company (private)', entityType: 'PRIVATE_LIMITED' },
  PLC: { label: 'Public Limited Company', entityType: 'PUBLIC_LIMITED' },
  FLC: { label: 'Subsidiary of a Foreign Company (public)', entityType: 'PUBLIC_LIMITED' },
  ULL: { label: 'Unlimited Company (public)', entityType: 'PUBLIC_LIMITED' },
  OPC: { label: 'One Person Company', entityType: 'OPC' },
  NPL: { label: 'Section 8 (not-for-profit) Company', entityType: 'SECTION_8' },
  // A government company may be private or public, so the class alone does not
  // settle the entity type — better to leave it to the user than to guess.
  SGC: { label: 'State Government Company', entityType: null },
  GOI: { label: 'Union Government Company', entityType: null },
  GAP: { label: 'General Association (public)', entityType: null },
  GAT: { label: 'General Association (private)', entityType: null },
};

/**
 * Broad activity divisions from the first two digits of the CIN's industry
 * code. MCA codes follow the older NIC classification, so this is indicative —
 * enough to prefill a field the user can correct, not a definitive answer.
 */
const INDUSTRY_DIVISIONS: Array<[number, number, string]> = [
  [1, 5, 'Agriculture, hunting and forestry'],
  [5, 5, 'Fishing'],
  [10, 14, 'Mining and quarrying'],
  [15, 37, 'Manufacturing'],
  [40, 41, 'Electricity, gas and water supply'],
  [45, 45, 'Construction'],
  [50, 52, 'Wholesale and retail trade'],
  [55, 55, 'Hotels and restaurants'],
  [60, 64, 'Transport, storage and communications'],
  [65, 67, 'Financial intermediation'],
  [70, 74, 'Real estate, renting and business activities'],
  [72, 72, 'Computer and related activities'],
  [75, 75, 'Public administration and defence'],
  [80, 80, 'Education'],
  [85, 85, 'Health and social work'],
  [90, 93, 'Other community, social and personal services'],
  [95, 97, 'Private households with employed persons'],
  [99, 99, 'Extra-territorial organisations'],
];

function industryFor(code: string): string | null {
  const division = Number(code.slice(0, 2));
  if (!Number.isFinite(division)) return null;
  // Later, narrower entries win — 72 sits inside 70-74 but is more specific.
  let match: string | null = null;
  for (const [from, to, label] of INDUSTRY_DIVISIONS) {
    if (division >= from && division <= to) match = label;
  }
  return match;
}

/** CINs use a couple of state codes that differ from the GST short codes. */
const CIN_STATE_ALIASES: Record<string, string> = { OR: 'OD', UT: 'UK', DN: 'DNDD', DD: 'DNDD' };

export interface DecodedCin {
  cin: string;
  listed: boolean;
  industryCode: string;
  industry: string | null;
  stateCode: string | null;
  stateName: string | null;
  incorporationYear: number;
  ownershipCode: string;
  ownershipLabel: string | null;
  /** Null where the ownership class does not settle it — a government company, say. */
  entityType: string | null;
  registrationNumber: string;
}

export function decodeCin(cin: string): DecodedCin | null {
  const value = cin.toUpperCase().trim();
  if (!CIN_REGEX.test(value)) return null;

  const rawState = value.slice(6, 8);
  const stateCode = CIN_STATE_ALIASES[rawState] ?? rawState;
  const state = stateByCode(stateCode);
  const ownershipCode = value.slice(12, 15);
  const ownership = OWNERSHIP[ownershipCode];
  const industryCode = value.slice(1, 6);

  return {
    cin: value,
    listed: value.startsWith('L'),
    industryCode,
    industry: industryFor(industryCode),
    stateCode: state ? state.code : null,
    stateName: state ? state.name : null,
    incorporationYear: Number(value.slice(8, 12)),
    ownershipCode,
    ownershipLabel: ownership?.label ?? null,
    entityType: ownership?.entityType ?? null,
    registrationNumber: value.slice(15),
  };
}

/** The 4th character of a PAN encodes the kind of holder. */
const PAN_HOLDER: Record<string, string> = {
  C: 'Company', P: 'Individual', H: 'Hindu Undivided Family', F: 'Firm or LLP',
  A: 'Association of Persons', T: 'Trust', B: 'Body of Individuals',
  L: 'Local Authority', J: 'Artificial Juridical Person', G: 'Government',
};

export function decodePan(pan: string): { pan: string; holderCode: string; holderType: string | null } | null {
  const value = pan.toUpperCase().trim();
  if (!PAN_REGEX.test(value)) return null;
  const holderCode = value[3]!;
  return { pan: value, holderCode, holderType: PAN_HOLDER[holderCode] ?? null };
}

/**
 * Indian mobile numbers, with or without the country code.
 *
 * Deliberately permissive about spacing and separators — people paste numbers
 * from address books — but strict about the ten digits and the 6-9 leading
 * digit that make it a real mobile.
 */
export function normalisePhone(input: string): string | null {
  const digits = input.replace(/[^0-9]/g, '');
  const local = digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits;
  if (!/^[6-9][0-9]{9}$/.test(local)) return null;
  return `+91${local}`;
}
