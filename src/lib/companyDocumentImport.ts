/**
 * Reads a company's particulars out of a document you already hold.
 *
 * Two shapes arrive in practice and they are read differently:
 *
 *   *CSV*  — an MCA master-data extract: many companies, one per row, columns
 *            that differ by vintage. Handled by `parseMcaMasterData`.
 *   *PDF*  — a single company's paperwork, most often the certificate of
 *            incorporation. There are no columns, so the particulars are found
 *            by the shape of the values themselves and by the labels beside
 *            them.
 *
 * Nothing here contacts MCA or any other registry. It reads the file given to
 * it, and it never writes: the caller decides what to do with what came back,
 * which is what lets the onboarding form offer the values for review rather
 * than silently filling itself in.
 */
import { CIN_REGEX, LLPIN_REGEX, PAN_REGEX, decodeCin } from './india';
import { parseAmount, parseMcaDate, parseMcaMasterData, type McaRecord } from './mcaMasterData';

export type ImportSource = 'csv' | 'pdf';

export interface ImportPreview {
  source: ImportSource;
  /** Null when the file parsed but held nothing recognisable. */
  record: (McaRecord & { pan: string | null; llpin: string | null }) | null;
  /** CSV only — what the header row gave us, and what it did not. */
  recognisedColumns: string[];
  unrecognisedColumns: string[];
  /** How many companies the file described; a CSV may hold thousands. */
  rowsInFile: number;
  /** Set when a CSV held more than one company and we took the first. */
  note: string | null;
}

const empty = (source: ImportSource, note: string): ImportPreview => ({
  source, record: null, recognisedColumns: [], unrecognisedColumns: [], rowsInFile: 0, note,
});

/** A PDF begins with `%PDF-`; anything else here is read as text. */
export const looksLikePdf = (buffer: Buffer): boolean =>
  buffer.subarray(0, 5).toString('latin1') === '%PDF-';

/**
 * Pulls a value that follows a label, tolerating the punctuation and line
 * breaks a PDF's text layer inserts between the two.
 */
function labelled(text: string, labels: string[], pattern: string): string | null {
  // The gap may carry punctuation and a currency word — "Paid up Capital: Rs.
  // 1,00,000" is the ordinary way an Indian certificate writes an amount.
  const gap = String.raw`[^A-Za-z0-9]{0,40}?(?:Rs\.?|INR|₹)?[^A-Za-z0-9]{0,10}?`;
  for (const label of labels) {
    const re = new RegExp(`${label}${gap}(${pattern})`, 'i');
    const m = text.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

const DATE_PATTERN = String.raw`\d{1,2}(?:st|nd|rd|th)?[\s./-][A-Za-z]{3,9}[\s./-]\d{4}|\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{4}-\d{2}-\d{2}`;

/**
 * Reads one company out of a certificate of incorporation, or anything else
 * whose text carries the same particulars.
 *
 * The CIN is the anchor: it encodes the state, the entity type and the year, so
 * a document that carries one tells us most of the profile even when every
 * label in it is worded unusually.
 */
export function extractFromPdfText(text: string): ImportPreview['record'] {
  const flat = text.replace(/\s+/g, ' ');

  const cin = flat.match(CIN_REGEX.source.replace(/^\^|\$$/g, ''))?.[0]?.toUpperCase() ?? null;
  const llpinRaw = flat.match(/\b[A-Z]{3}-\d{4}\b/)?.[0] ?? null;
  const llpin = llpinRaw && LLPIN_REGEX.test(llpinRaw) ? llpinRaw : null;
  const panRaw = labelled(flat, ['permanent account number', '\\bPAN\\b'], String.raw`[A-Z]{5}\d{4}[A-Z]`);
  const pan = panRaw && PAN_REGEX.test(panRaw) ? panRaw : null;

  const decoded = cin ? decodeCin(cin) : null;

  // The registered name sits beside one of a handful of labels, and always ends
  // in a suffix the Act requires — which is what makes it findable at all.
  const name =
    labelled(flat, ['name of the company', 'name of company', 'company name', 'name of the llp'],
             String.raw`[A-Za-z0-9&.,'’()\- ]{3,150}?(?:PRIVATE LIMITED|PUBLIC LIMITED|LIMITED|LLP)`)
    ?? flat.match(/\b[A-Z][A-Za-z0-9&.,'’()\- ]{3,150}?(?:PRIVATE LIMITED|LIMITED|LLP)\b/)?.[0]
    ?? null;

  const dateRaw =
    labelled(flat, ['date of incorporation', 'incorporated on', 'date of registration', 'dated this'], DATE_PATTERN);
  const incorporatedOn = dateRaw ? parseMcaDate(dateRaw.replace(/(st|nd|rd|th)/i, '')) : null;

  // Both spellings are current in Indian filings, so the vowel is a class
  // rather than an optional letter — `authoris?zed` quietly matched only the z.
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
  };
}

/**
 * The text layer of a PDF, page by page.
 *
 * Loaded lazily and by its legacy build: pdf.js ships ESM by default and this
 * service is CommonJS, and the legacy bundle is also the one that runs without
 * a DOM. `standardFontDataUrl` is left unset deliberately — nothing is being
 * rendered, and a missing font only affects glyph shapes, not the characters
 * the text layer reports.
 */
async function pdfText(buffer: Buffer): Promise<string> {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    // A worker buys nothing here: this already runs off the request thread's
    // critical path, and spawning one per upload costs more than it saves.
    disableWorker: true,
    isEvalSupported: false,
  }).promise;

  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push(content.items.map((i: { str?: string }) => i.str ?? '').join(' '));
  }
  await doc.destroy();
  return pages.join('\n');
}

/** Reads whichever of the two shapes the buffer turns out to be. */
export async function previewCompanyImport(buffer: Buffer): Promise<ImportPreview> {
  if (looksLikePdf(buffer)) {
    let text: string;
    try {
      text = await pdfText(buffer);
    } catch {
      return empty('pdf', 'That PDF could not be read. If it is a scan, the text has to be typed in by hand.');
    }

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

  const parsed = parseMcaMasterData(buffer.toString('utf8'));
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
