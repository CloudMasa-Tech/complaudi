/**
 * Upload inspection.
 *
 * An evidence gate is only as good as the evidence. Before this, a 69-byte stub
 * or a poster renamed `.pdf` closed out a statutory filing. These checks are
 * cheap and catch the careless cases; they do not — and cannot — establish that
 * a document is genuinely *this* company's AGM minutes. That needs a human, or
 * a digital signature, both of which are handled above this layer.
 */
import { PDFDocument } from 'pdf-lib';
import forge from 'node-forge';
import { logger } from './logger';

/**
 * An absolute floor to catch empty and placeholder files. Deliberately low:
 * PDFs compress well and a genuine one-page acknowledgement can be under 2 KB,
 * so the real test for a PDF is structural — it must parse and have pages —
 * not its weight.
 */
export const MIN_DOCUMENT_BYTES = 512;

/** Leading bytes that identify a format, regardless of what the client claimed. */
const MAGIC: Array<{ type: string; mime: string[]; test: (b: Buffer) => boolean }> = [
  { type: 'pdf', mime: ['application/pdf'], test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { type: 'png', mime: ['image/png'], test: (b) => b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' },
  { type: 'jpeg', mime: ['image/jpeg'], test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'webp', mime: ['image/webp'], test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  {
    // xlsx/docx/zip all share the PKZIP header; they are distinguished by content
    // we do not need to inspect here.
    type: 'zip',
    mime: [
      'application/zip',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    test: (b) => b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07),
  },
  { type: 'ole', mime: ['application/vnd.ms-excel', 'application/msword'], test: (b) => b.subarray(0, 8).toString('hex') === 'd0cf11e0a1b11ae1' },
];

/** Formats with no reliable magic bytes — validated by decodability instead. */
const TEXTUAL = new Set(['text/csv', 'text/plain', 'application/xml', 'text/xml']);

export interface PdfFacts {
  pages: number;
  encrypted: boolean;
  /** A signature dictionary is present and carries signed bytes. */
  hasDigitalSignature: boolean;
  /** Common names pulled from the signing certificates, best effort. */
  signers: string[];
  signedAt: string | null;
}

export interface FileInspection {
  ok: boolean;
  problems: string[];
  detectedType: string | null;
  sizeBytes: number;
  pdf: PdfFacts | null;
}

/**
 * Detects a PDF signature from the file structure.
 *
 * A signed PDF carries `/ByteRange` (the spans covered by the signature) and a
 * `/SubFilter` naming the scheme. That is reliable and cheap. Reading the signer
 * out of the PKCS#7 blob is best effort — a malformed or unusual certificate
 * yields no name, which is not itself a reason to reject the file.
 */
function inspectSignature(buffer: Buffer): Pick<PdfFacts, 'hasDigitalSignature' | 'signers' | 'signedAt'> {
  const raw = buffer.toString('latin1');
  const hasByteRange = /\/ByteRange\s*\[/.test(raw);
  const hasSubFilter = /\/SubFilter\s*\/(adbe\.pkcs7\.(detached|sha1)|ETSI\.CAdES\.detached)/.test(raw);

  if (!hasByteRange || !hasSubFilter) {
    return { hasDigitalSignature: false, signers: [], signedAt: null };
  }

  const signers: string[] = [];
  let signedAt: string | null = null;

  try {
    // /Contents <hex...> holds the DER-encoded PKCS#7 signature.
    const match = raw.match(/\/Contents\s*<([0-9A-Fa-f\s]+)>/);
    if (match?.[1]) {
      const der = forge.util.hexToBytes(match[1].replace(/\s+/g, '').replace(/(00)+$/, ''));
      const asn1 = forge.asn1.fromDer(der, false);
      const p7 = forge.pkcs7.messageFromAsn1(asn1) as unknown as {
        certificates?: forge.pki.Certificate[];
      };

      for (const cert of p7.certificates ?? []) {
        const cn = cert.subject.getField('CN')?.value;
        if (cn && !signers.includes(cn)) signers.push(cn);
      }
    }

    const dateMatch = raw.match(/\/M\s*\(D:(\d{14})/);
    if (dateMatch?.[1]) {
      const d = dateMatch[1];
      signedAt = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${d.slice(8, 10)}:${d.slice(10, 12)}:${d.slice(12, 14)}Z`;
    }
  } catch (err) {
    // The signature exists; we simply could not name the signer.
    logger.debug({ err }, 'could not parse the PKCS#7 signature block');
  }

  return { hasDigitalSignature: true, signers, signedAt };
}

export async function inspectUpload(
  buffer: Buffer,
  declaredMime: string,
  fileName: string,
): Promise<FileInspection> {
  const problems: string[] = [];
  const sizeBytes = buffer.length;

  if (sizeBytes < MIN_DOCUMENT_BYTES) {
    problems.push(
      `The file is only ${sizeBytes} bytes — that is a placeholder, not a filing. Attach the real acknowledgement, challan or signed copy.`,
    );
  }

  const detected = MAGIC.find((m) => m.test(buffer));
  const isTextual = TEXTUAL.has(declaredMime);

  if (!detected && !isTextual) {
    problems.push(`"${fileName}" does not look like a ${declaredMime} file. Its contents match no format we accept.`);
  } else if (detected && !detected.mime.includes(declaredMime)) {
    problems.push(
      `"${fileName}" was uploaded as ${declaredMime} but its contents are ${detected.type}. Rename or re-export it correctly.`,
    );
  }

  if (isTextual && !detected) {
    // A text file that will not decode as UTF-8 is binary wearing a .csv name.
    const decoded = buffer.toString('utf8');
    if (decoded.includes('�')) problems.push(`"${fileName}" is not readable text.`);
  }

  let pdf: PdfFacts | null = null;
  if (detected?.type === 'pdf') {
    try {
      const doc = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
      const pages = doc.getPageCount();
      if (pages < 1) problems.push('The PDF contains no pages.');
      pdf = { pages, encrypted: doc.isEncrypted, ...inspectSignature(buffer) };
    } catch (err) {
      problems.push(`The PDF could not be read — it may be corrupt or password-protected. (${(err as Error).message})`);
      pdf = { pages: 0, encrypted: false, ...inspectSignature(buffer) };
    }
  }

  return { ok: problems.length === 0, problems, detectedType: detected?.type ?? (isTextual ? 'text' : null), sizeBytes, pdf };
}
