import { describe, expect, it } from 'vitest';
import { extractGstInfo, extractUdyamInfo } from '../src/lib/certificateExtractor';
import { formatDate } from '../src/lib/dates';
import { parseDmyDate } from '../src/lib/dates';

const UDYAM_TEXT = `
UDYAM REGISTRATION CERTIFICATE
UDYAM-PY-03-0054543
NAME OF ENTERPRISE
SRI BALAJI TRADERS
DATE OF UDYAM REGISTRATION 27/06/2020
TYPE OF ENTERPRISE MICRO
SOCIAL CATEGORY OF ENTREPRENEUR GENERAL
MAJOR ACTIVITY SERVICES
`;

describe('extractUdyamInfo', () => {
  it('pulls the Udyam number, enterprise name and classification', () => {
    const info = extractUdyamInfo(UDYAM_TEXT);
    expect(info.udyamNumber).toBe('UDYAM-PY-03-0054543');
    expect(info.enterpriseName).toBe('SRI BALAJI TRADERS');
    expect(info.organisationType).toBe('MICRO');
    expect(info.socialCategory).toBe('GENERAL');
    expect(info.majorActivity).toBe('SERVICES');
  });

  it('emits the registration date in the DD/MM/YYYY form printed on the certificate', () => {
    const info = extractUdyamInfo(UDYAM_TEXT);
    expect(info.registeredOn).toBe('27/06/2020');
  });

  it('returns nulls — not garbage — when the text carries nothing recognisable', () => {
    const info = extractUdyamInfo('some random scanned-page noise');
    expect(info.udyamNumber).toBeNull();
    expect(info.registeredOn).toBeNull();
  });
});

describe('certificate import date handling (regression: import-udyam 500)', () => {
  it('the extracted DD/MM/YYYY date parses via parseDmyDate instead of crashing parseDate', () => {
    const info = extractUdyamInfo(UDYAM_TEXT);
    expect(() => parseDmyDate(info.registeredOn)).not.toThrow();
    expect(formatDate(parseDmyDate(info.registeredOn)!)).toBe('2020-06-27');
  });

  it('extractGstInfo liability dates parse the same way', () => {
    const info = extractGstInfo('GSTIN 33AAACT1234A1Z8\nDate of Liability 01/07/2017\n');
    expect(info.gstin).toBe('33AAACT1234A1Z8');
    expect(formatDate(parseDmyDate(info.registeredOn)!)).toBe('2017-07-01');
  });
});
