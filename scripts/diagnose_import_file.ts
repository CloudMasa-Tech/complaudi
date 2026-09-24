import fs from 'node:fs';
import path from 'node:path';

const filePath = process.argv[2];

if (!filePath) {
  console.error('Usage: npx tsx scripts/diagnose_import_file.ts <path-to-file>');
  process.exit(1);
}

const resolvedPath = path.resolve(filePath);
if (!fs.existsSync(resolvedPath)) {
  console.error(`File not found: ${resolvedPath}`);
  process.exit(1);
}

const buffer = fs.readFileSync(resolvedPath);
console.log('====================================================');
console.log('        FILE DIAGNOSTIC INSPECTION REPORT           ');
console.log('====================================================\n');

console.log(`1. File Name: ${path.basename(resolvedPath)}`);
console.log(`2. File Path: ${resolvedPath}`);
console.log(`3. File Size: ${buffer.length} bytes (${(buffer.length / 1024).toFixed(2)} KB)`);

// Magic Bytes
const hex = Array.from(buffer.subarray(0, 16))
  .map((b) => b.toString(16).padStart(2, '0'))
  .join(' ');
console.log(`4. Magic Bytes (First 16 Hex): ${hex}`);

// Format Detection
let format = 'PLAIN TEXT / CSV';
if (buffer.length >= 4 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
  format = 'PDF DOCUMENT (%PDF)';
} else if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
  format = 'ZIP / EXCEL .XLSX DOCUMENT (PK)';
} else if (buffer.length >= 8 && buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0) {
  format = 'EXCEL .XLS BINARY DOCUMENT';
} else if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
  format = 'UTF-8 TEXT WITH BOM';
} else if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
  format = 'UTF-16LE TEXT WITH BOM';
} else if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
  format = 'UTF-16BE TEXT WITH BOM';
}
console.log(`5. Detected Format: ${format}`);

// Encoding text preview
let text = '';
if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
  text = new TextDecoder('utf-16le').decode(buffer.subarray(2));
} else if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
  text = new TextDecoder('utf-16be').decode(buffer.subarray(2));
} else if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
  text = new TextDecoder('utf-8').decode(buffer.subarray(3));
} else {
  text = new TextDecoder('utf-8').decode(buffer);
}

// Delimiter Guessing
const firstLine = text.replace(/^\uFEFF/, '').split(/[\r\n]/)[0] ?? '';
const counts = [
  { delimiter: 'Comma (,)', count: (firstLine.match(/,/g) || []).length },
  { delimiter: 'Tab (\\t)', count: (firstLine.match(/\t/g) || []).length },
  { delimiter: 'Semicolon (;)', count: (firstLine.match(/;/g) || []).length },
  { delimiter: 'Pipe (|)', count: (firstLine.match(/\|/g) || []).length },
].sort((a, b) => b.count - a.count);

console.log(`6. Top Delimiter Candidate: ${counts[0]?.delimiter} (${counts[0]?.count} occurrences in line 1)`);

const lines = text.split(/[\r\n]+/).filter((l) => l.trim().length > 0);
console.log(`7. Non-Empty Line Count: ${lines.length}`);

console.log('\n--- RAW TEXT PREVIEW (FIRST 10 LINES) ---');
lines.slice(0, 10).forEach((l, i) => {
  console.log(`Line ${i + 1}: ${l}`);
});
console.log('====================================================\n');
