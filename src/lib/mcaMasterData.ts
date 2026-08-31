/**
 * MCA company master data import.
 *
 * MCA publishes company master data as CSV (data.gov.in, and the state-wise
 * extracts from the MCA portal). Column names differ between vintages and
 * between state files, so headers are matched by alias rather than position —
 * a file with `DATE_OF_REGISTRATION` and one with `DateOfIncorporation` both
 * land on the same field.
 *
 * Nothing here contacts MCA. It reads a file you downloaded from them.
 */
import { decodeCin, CIN_REGEX } from './india';

/** Header aliases, normalised to letters only before matching. */
const FIELD_ALIASES: Record<string, string[]> = {
  cin: ['corporateidentificationnumber', 'cin', 'companycin', 'cinllpin'],
  name: ['companyname', 'nameofcompany', 'company', 'legalname'],
  incorporatedOn: [
    'dateofregistration', 'dateofincorporation', 'registrationdate',
    'incorporationdate', 'dateofregistrationincorporation',
  ],
  companyClass: ['companyclass', 'class', 'classofcompany'],
  paidUpCapital: ['paidupcapital', 'paidupcapitalrs', 'paidup', 'paidupcapitalinrs'],
  authorisedCapital: ['authorizedcapital', 'authorisedcapital', 'authorizedcap', 'authorizedcapitalrs'],
  state: ['registeredstate', 'state', 'companystate'],
  activity: ['principalbusinessactivityasperciniic', 'principalbusinessactivity', 'industrialclass', 'activitydescription'],
  status: ['companystatus', 'companystatusforefiling', 'status'],
  email: ['emailaddr', 'emailaddress', 'email'],
};

const normaliseHeader = (h: string): string => h.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Minimal RFC-4180 reader — quoted fields, embedded commas, escaped quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const body = text.replace(/^﻿/, ''); // strip a BOM if Excel added one

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (body[i + 1] === '"') { field += '"'; i += 1; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i += 1;
      row.push(field);
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

/** MCA files carry dd/mm/yyyy, dd-mm-yyyy and ISO in roughly equal measure. */
export function parseMcaDate(raw: string): Date | null {
  const value = raw.trim();
  if (!value) return null;

  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));

  const dmy = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) return new Date(Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])));

  // "17 FEB 2026" and similar.
  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) {
    const d = new Date(parsed);
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  }
  return null;
}

export const parseAmount = (raw: string): number | null => {
  const digits = raw.replace(/[^0-9.]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? Math.round(n) : null;
};

export interface McaRecord {
  cin: string | null;
  name: string | null;
  incorporatedOn: Date | null;
  paidUpCapital: number | null;
  authorisedCapital: number | null;
  stateCode: string | null;
  entityType: string | null;
  industry: string | null;
  status: string | null;
}

export interface McaParseResult {
  /** Every row that carried a recognisable CIN. */
  records: McaRecord[];
  /** Headers we understood, for reporting back what the file actually gave us. */
  recognisedColumns: string[];
  unrecognisedColumns: string[];
  rowCount: number;
}

export function parseMcaMasterData(csv: string): McaParseResult {
  const rows = parseCsv(csv);
  if (rows.length < 2) return { records: [], recognisedColumns: [], unrecognisedColumns: [], rowCount: 0 };

  const headers = rows[0]!.map(normaliseHeader);
  const index: Partial<Record<keyof typeof FIELD_ALIASES, number>> = {};
  const recognised: string[] = [];

  headers.forEach((h, i) => {
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.includes(h) && index[field] === undefined) {
        index[field] = i;
        recognised.push(rows[0]![i]!.trim());
        return;
      }
    }
  });

  const unrecognised = rows[0]!
    .map((h) => h.trim())
    .filter((h) => !recognised.includes(h));

  const at = (row: string[], field: string): string => {
    const i = index[field];
    return i === undefined ? '' : (row[i] ?? '').trim();
  };

  const records: McaRecord[] = [];
  for (const row of rows.slice(1)) {
    const cinRaw = at(row, 'cin').toUpperCase();
    const cin = CIN_REGEX.test(cinRaw) ? cinRaw : null;
    if (!cin) continue; // a row with no usable CIN tells us nothing

    const decoded = decodeCin(cin);
    const classRaw = at(row, 'companyClass').toLowerCase();

    records.push({
      cin,
      name: at(row, 'name') || null,
      incorporatedOn: parseMcaDate(at(row, 'incorporatedOn')),
      paidUpCapital: parseAmount(at(row, 'paidUpCapital')),
      authorisedCapital: parseAmount(at(row, 'authorisedCapital')),
      // The CIN is the more reliable source for both of these.
      stateCode: decoded?.stateCode ?? null,
      entityType:
        decoded?.entityType ??
        (classRaw.includes('public') ? 'PUBLIC_LIMITED' : classRaw.includes('private') ? 'PRIVATE_LIMITED' : null),
      industry: at(row, 'activity') || decoded?.industry || null,
      status: at(row, 'status') || null,
    });
  }

  return { records, recognisedColumns: recognised, unrecognisedColumns: unrecognised, rowCount: rows.length - 1 };
}
