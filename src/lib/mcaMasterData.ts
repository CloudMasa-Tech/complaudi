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
import type { Buffer } from 'node:buffer';

/** Header aliases, normalised to letters only before matching. */
const FIELD_ALIASES: Record<string, string[]> = {
  cin: [
    'corporateidentificationnumber', 'cin', 'companycin', 'cinllpin',
    'cinnumber', 'cinno', 'corporationidentificationnumber',
  ],
  name: ['companyname', 'nameofcompany', 'company', 'legalname', 'companyllpname', 'companyorllpname'],
  incorporatedOn: [
    'dateofregistration', 'dateofincorporation', 'registrationdate',
    'incorporationdate', 'dateofregistrationincorporation', 'dateofincorporationddmmyyyy',
  ],
  companyClass: ['companyclass', 'class', 'classofcompany', 'companyclassification'],
  companyCategory: ['companycategory', 'category'],
  companySubCategory: ['companysubcategory', 'subcategory'],
  address: ['registeredaddress', 'registeredofficedetails', 'address', 'roaddress', 'registeredofficedetail', 'registeredofficedetailsaddress', 'registeredofficeaddress', 'registeredoffice'],
  paidUpCapital: [
    'paidupcapital', 'paidupcapitalrs', 'paidup', 'paidupcapitalinrs',
    'paidupcapitalinrcrore', 'paidupcapitalinlakhs', 'paiducapital', 'sharecapital',
  ],
  authorisedCapital: [
    'authorizedcapital', 'authorisedcapital', 'authorizedcap', 'authorizedcapitalrs',
    'authorizedcapitalinrcrore', 'authorisedcapitalinlakhs',
  ],
  state: ['registeredstate', 'state', 'companystate', 'registeredofficestate', 'registeredofficestatename', 'statename'],
  activity: ['principalbusinessactivityasperciniic', 'principalbusinessactivity', 'industrialclass', 'activitydescription'],
  status: ['companystatus', 'companystatusforefiling', 'status', 'statusofcompany'],
  email: ['emailaddr', 'emailaddress', 'email'],
};

const normaliseHeader = (h: string): string => h.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Decodes the raw bytes of an uploaded file to text.
 *
 * Excel saves "CSV (UTF-16)" with a byte-order mark and UTF-16 character
 * encoding, so files are sniffed rather than assumed to be UTF-8 — decoded as
 * UTF-8, a UTF-16 file reads back as one long line of NUL-padded text with no
 * usable header or row breaks.
 */
export function decodeCsvBuffer(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.toString('utf8', 3); // UTF-8 BOM — strip it rather than inherit it
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer.subarray(2));
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buffer.subarray(2));
  }

  // BOM-less UTF-16 escapes from some tools — NULs land on only one parity.
  const head = buffer.subarray(0, 2048);
  let even = 0;
  let odd = 0;
  for (let i = 0; i < head.length; i += 1) {
    if (head[i] === 0) {
      if (i % 2 === 0) even += 1;
      else odd += 1;
    }
  }
  if (odd > 16 && even < 4) return new TextDecoder('utf-16le').decode(buffer);
  if (even > 16 && odd < 4) return new TextDecoder('utf-16be').decode(buffer);

  return buffer.toString('utf8');
}

/**
 * Which separator a file actually uses. Excel saves "CSV" as comma-, semicolon-
 * or tab-delimited depending on the regional locale, so the delimiter is read
 * from the file rather than assumed — a header with no commas but plenty of
 * tabs is a tab file, and a comma-only parser would read it as one giant column.
 */
const guessDelimiter = (text: string): string => {
  const firstLine = text.replace(/^\uFEFF/, '').split(/[\r\n]/)[0] ?? '';
  const [best] = [',', ';', '\t'].map((d) => ({ d, n: firstLine.split(d).length - 1 }))
    .sort((a, b) => b.n - a.n);
  return best!.n > 0 ? best!.d : ',';
};

/** Minimal RFC-4180 reader — quoted fields, embedded delimiters, escaped quotes. */
export function parseCsv(text: string, delimiter = guessDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const body = text.replace(/^\uFEFF/, ''); // strip a BOM if Excel added one

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
    if (ch === delimiter) { row.push(field); field = ''; continue; }
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
  address: string | null;
  companyClass: string | null;
  companyCategory: string | null;
  companySubCategory: string | null;
  stateCode: string | null;
  entityType: string | null;
  industry: string | null;
  status: string | null;
  directors: McaDirector[];
}

export interface McaDirector {
  din: string | null;
  name: string | null;
  designation: string | null;
  appointedOn: Date | null;
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

  // A leading blank line (or a whitespace preamble) must not be read as the
  // header row — find the first line that actually names columns.
  let headerRow = 0;
  while (headerRow < rows.length && rows[headerRow]!.every((cell) => cell.trim() === '')) headerRow += 1;
  if (headerRow >= rows.length - 1) return { records: [], recognisedColumns: [], unrecognisedColumns: [], rowCount: 0 };

  const headers = rows[headerRow]!.map(normaliseHeader);
  const index: Partial<Record<keyof typeof FIELD_ALIASES, number>> = {};
  const recognised: string[] = [];

  headers.forEach((h, i) => {
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.includes(h) && index[field] === undefined) {
        index[field] = i;
        recognised.push(rows[headerRow]![i]!.trim());
        return;
      }
    }
  });

  const unrecognised = rows[headerRow]!
    .map((h) => h.trim())
    .filter((h) => !recognised.includes(h));

  const at = (row: string[], field: string): string => {
    const i = index[field];
    return i === undefined ? '' : (row[i] ?? '').trim();
  };

  const records: McaRecord[] = [];
  
  // Find directors if they exist in the file (Signatory Details table)
  const dirAliases = {
    din: ['din', 'dinpan', 'dinpanno', 'dpindin', 'dinofdirector'],
    name: ['name', 'nameofdirector', 'fullname', 'signatoryname'],
    designation: ['designation'],
    appointedOn: ['dateofappointment', 'appointmentdate'],
    status: ['status', 'directorstatus', 'currentstatus']
  };

  const directors: McaDirector[] = [];
  let inSignatoryTable = false;
  let dirIndex: Partial<Record<keyof typeof dirAliases, number>> = {};
  
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r]!;
    
    // Check if this row looks like a signatory table header
    const rowNorms = row.map(normaliseHeader);
    const hasDinCol = rowNorms.some(h => dirAliases.din.includes(h));
    const hasNameCol = rowNorms.some(h => dirAliases.name.includes(h));
    
    if (hasDinCol && hasNameCol) {
      inSignatoryTable = true;
      dirIndex = {};
      rowNorms.forEach((h, i) => {
        for (const [field, aliases] of Object.entries(dirAliases)) {
          if (aliases.includes(h) && dirIndex[field as keyof typeof dirAliases] === undefined) {
            dirIndex[field as keyof typeof dirAliases] = i;
          }
        }
      });
      continue;
    }
    
    if (inSignatoryTable) {
      if (row.every(c => c.trim() === '')) continue; // Skip empty rows
      const atD = (field: keyof typeof dirAliases) => {
        const i = dirIndex[field];
        return i === undefined ? '' : (row[i] ?? '').trim();
      };
      const dinRaw = atD('din');
      const name = atD('name');
      if (dinRaw || name) {
        directors.push({
          din: dinRaw || null,
          name: name || null,
          designation: atD('designation') || null,
          appointedOn: parseMcaDate(atD('appointedOn')),
          status: atD('status') || null
        });
      }
      continue;
    }

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
      address: at(row, 'address') || null,
      companyClass: at(row, 'companyClass') || null,
      companyCategory: at(row, 'companyCategory') || null,
      companySubCategory: at(row, 'companySubCategory') || null,
      // The CIN is the more reliable source for both of these.
      stateCode: decoded?.stateCode ?? null,
      entityType:
        decoded?.entityType ??
        (classRaw.includes('public') ? 'PUBLIC_LIMITED' : classRaw.includes('private') ? 'PRIVATE_LIMITED' : null),
      industry: at(row, 'activity') || decoded?.industry || null,
      status: at(row, 'status') || null,
      directors: [] // will be attached later if there's only 1 company
    });
  }
  
  if (records.length === 1 && directors.length > 0) {
    records[0]!.directors = directors;
    recognised.push('Directors'); // Just to signal we found directors
  }

  return { records, recognisedColumns: recognised, unrecognisedColumns: unrecognised, rowCount: rows.length - headerRow - 1 };
}

export function parseMcaMasterDataPdf(text: string): McaParseResult {
  const records: McaRecord[] = [];
  const recognisedColumns: string[] = [];

  const cinMatch = text.match(/([UL]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})/i);
  const cin = cinMatch ? cinMatch[1]!.toUpperCase() : null;

  if (cin) {
    recognisedColumns.push('CIN');
    const decoded = decodeCin(cin);
    
    const nameMatch = text.match(/Company Name\s+(.*?)\s+(?:ROC Code|Registration Number|Company Category)/i);
    const name = nameMatch ? nameMatch[1]!.trim() : null;
    if (name) recognisedColumns.push('Company Name');

    const incDateMatch = text.match(/Date of Incorporation\s+(\d{2}[/-]\d{2}[/-]\d{4})/i);
    const incorporatedOn = incDateMatch ? parseMcaDate(incDateMatch[1]!) : null;
    if (incDateMatch) recognisedColumns.push('Date of Incorporation');

    const classMatch = text.match(/Class of Company\s+(.*?)\s+(?:Authorised Capital|Company Category)/i);
    const companyClass = classMatch ? classMatch[1]!.trim() : null;
    if (companyClass) recognisedColumns.push('Class of Company');

    const categoryMatch = text.match(/Company Category\s+(.*?)\s+(?:Company SubCategory|Class of Company)/i);
    const companyCategory = categoryMatch ? categoryMatch[1]!.trim() : null;
    if (companyCategory) recognisedColumns.push('Company Category');

    const subcategoryMatch = text.match(/Company SubCategory\s+(.*?)\s+(?:Class of Company|Authorised Capital)/i);
    const companySubCategory = subcategoryMatch ? subcategoryMatch[1]!.trim() : null;
    if (companySubCategory) recognisedColumns.push('Company SubCategory');

    const authCapMatch = text.match(/Authorised Capital(?:\(Rs\))?\s+([\d,\.]+)/i);
    const authorisedCapital = authCapMatch ? parseAmount(authCapMatch[1]!) : null;
    if (authCapMatch) recognisedColumns.push('Authorised Capital');

    const paidCapMatch = text.match(/Paid up Capital(?:\(Rs\))?\s+([\d,\.]+)/i);
    const paidUpCapital = paidCapMatch ? parseAmount(paidCapMatch[1]!) : null;
    if (paidCapMatch) recognisedColumns.push('Paid up Capital');
    
    const addressMatch = text.match(/Registered Address\s+(.*?)\s+(?:Address other than|Email Id|Whether Listed)/i);
    const address = addressMatch ? addressMatch[1]!.trim() : null;
    if (addressMatch) recognisedColumns.push('Registered Address');
    
    const statusMatch = text.match(/Company Status(?:\(for efiling\))?\s+(.*?)\s*$/im) || text.match(/Company Status(?:\(for efiling\))?\s+(.*?)\s+(?:Date of|Number of)/i);
    const status = statusMatch ? statusMatch[1]!.trim() : null;
    if (statusMatch) recognisedColumns.push('Company Status');

    // For PDF, extracting directors reliably from flattened text is tricky and often not needed for simple upload.
    // If we wanted to, we would look for DIN/PAN and Name. We'll skip it for now to avoid false positives.

    records.push({
      cin,
      name,
      incorporatedOn,
      paidUpCapital,
      authorisedCapital,
      address,
      companyClass,
      companyCategory,
      companySubCategory,
      stateCode: decoded?.stateCode ?? null,
      entityType: decoded?.entityType ?? (companyClass?.toLowerCase().includes('public') ? 'PUBLIC_LIMITED' : companyClass?.toLowerCase().includes('private') ? 'PRIVATE_LIMITED' : null),
      industry: decoded?.industry ?? null,
      status,
      directors: []
    });
  }

  return { records, recognisedColumns, unrecognisedColumns: [], rowCount: records.length };
}
