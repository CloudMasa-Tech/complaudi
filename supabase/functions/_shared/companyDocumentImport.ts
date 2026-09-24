// supabase/functions/_shared/companyDocumentImport.ts
import { CIN_REGEX, LLPIN_REGEX, PAN_REGEX, decodeCin } from './india.ts';
import { decodeCsvBuffer, parseAmount, parseMcaDate, parseMcaMasterData, type McaRecord } from './mcaMasterData.ts';

export type ImportSource = 'csv' | 'pdf';

export interface ImportPreview {
  source: ImportSource;
  record: (McaRecord & { pan: string | null; llpin: string | null }) | null;
  recognisedColumns: string[];
  unrecognisedColumns: string[];
  rowsInFile: number;
  note: string | null;
}

const empty = (source: ImportSource, note: string): ImportPreview => ({
  source, record: null, recognisedColumns: [], unrecognisedColumns: [], rowsInFile: 0, note,
});

export const looksLikePdf = (buffer: Uint8Array): boolean => {
  if (buffer.length < 4) return false;
  return buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
};

function labelled(text: string, labels: string[], pattern: string): string | null {
  const gap = String.raw`[^A-Za-z0-9]{0,40}?(?:Rs\.?|INR|₹)?[^A-Za-z0-9]{0,10}?`;
  for (const label of labels) {
    const re = new RegExp(`${label}${gap}(${pattern})`, 'i');
    const m = text.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

const DATE_PATTERN = String.raw`\d{1,2}(?:st|nd|rd|th)?[\s./-][A-Za-z]{3,9}[\s./-]\d{4}|\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{4}-\d{2}-\d{2}`;

export function extractFromPdfText(text: string): ImportPreview['record'] {
  const flat = text.replace(/\s+/g, ' ');

  const cin = flat.match(CIN_REGEX.source.replace(/^\^|\$$/g, ''))?.[0]?.toUpperCase() ?? null;
  const llpinRaw = flat.match(/\b[A-Z]{3}-\d{4}\b/)?.[0] ?? null;
  const llpin = llpinRaw && LLPIN_REGEX.test(llpinRaw) ? llpinRaw : null;
  const panRaw = labelled(flat, ['permanent account number', '\\bPAN\\b'], String.raw`[A-Z]{5}\d{4}[A-Z]`);
  const pan = panRaw && PAN_REGEX.test(panRaw) ? panRaw : null;

  const decoded = cin ? decodeCin(cin) : null;

  const name =
    labelled(flat, ['name of the company', 'name of company', 'company name', 'name of the llp'],
             String.raw`[A-Za-z0-9&.,'’()\- ]{3,150}?(?:PRIVATE LIMITED|PUBLIC LIMITED|LIMITED|LLP)`)
    ?? flat.match(/\b[A-Z][A-Za-z0-9&.,'’()\- ]{3,150}?(?:PRIVATE LIMITED|LIMITED|LLP)\b/)?.[0]
    ?? null;

  const dateRaw =
    labelled(flat, ['date of incorporation', 'incorporated on', 'date of registration', 'dated this'], DATE_PATTERN);
  const incorporatedOn = dateRaw ? parseMcaDate(dateRaw.replace(/(st|nd|rd|th)/i, '')) : null;

  const paidUpCapital = parseAmount(
    labelled(flat, ['paid.?up capital', 'paid.?up share capital'], String.raw`[\d,.]+`) ?? '',
  );
  const authorisedCapital = parseAmount(
    labelled(flat, ['authori[sz]ed capital', 'authori[sz]ed share capital'], String.raw`[\d,.]+`) ?? '',
  );

  if (!cin && !llpin && !name && !incorporatedOn) return null;

  return {
    cin,
    llpin,
    pan,
    name: name ? name.replace(/\s+/g, ' ').trim() : null,
    incorporatedOn,
    paidUpCapital,
    authorisedCapital,
    stateCode: decoded?.stateCode ?? null,
    entityType: decoded?.entityType ?? (llpin ? 'LLP' : null),
    industry: decoded?.industry ?? null,
    status: null,
    address: null,
    companyClass: null,
    companyCategory: null,
    companySubCategory: null,
    directors: [],
  };
}

export function previewCompanyImport(buffer: Uint8Array): ImportPreview {
  if (looksLikePdf(buffer)) {
    const text = new TextDecoder('latin1').decode(buffer);
    const record = extractFromPdfText(text);
    return {
      source: 'pdf',
      record,
      recognisedColumns: [],
      unrecognisedColumns: [],
      rowsInFile: record ? 1 : 0,
      note: record
        ? null
        : 'No CIN, company name or date of incorporation was found in that PDF. A scanned image carries no text to read.',
    };
  }

  const parsed = parseMcaMasterData(decodeCsvBuffer(buffer));
  const first = parsed.records[0];
  return {
    source: 'csv',
    record: first ? { ...first, pan: null, llpin: null } : null,
    recognisedColumns: parsed.recognisedColumns,
    unrecognisedColumns: parsed.unrecognisedColumns,
    rowsInFile: parsed.records.length,
    note: !first
      ? 'No row in that CSV carried a readable CIN.'
      : parsed.records.length > 1
        ? `That file describes ${parsed.records.length} companies — the first is offered here. Onboard the others separately.`
        : null,
  };
}
