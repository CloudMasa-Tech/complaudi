import { describe, expect, it } from 'vitest';
import { parseCsv, parseMcaDate, parseMcaMasterData } from '../src/lib/mcaMasterData';
import { formatDate } from '../src/lib/dates';

describe('CSV reading', () => {
  it('handles quoted fields, embedded commas and escaped quotes', () => {
    expect(parseCsv('a,b\n"x,y","he said ""hi"""')).toEqual([['a', 'b'], ['x,y', 'he said "hi"']]);
  });

  it('copes with CRLF and a BOM from Excel', () => {
    expect(parseCsv('﻿a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('MCA date formats', () => {
  it('reads the shapes MCA extracts actually use', () => {
    expect(formatDate(parseMcaDate('17/02/2026')!)).toBe('2026-02-17');
    expect(formatDate(parseMcaDate('17-02-2026')!)).toBe('2026-02-17');
    expect(formatDate(parseMcaDate('2026-02-17')!)).toBe('2026-02-17');
  });

  it('returns null rather than a wrong date', () => {
    expect(parseMcaDate('')).toBeNull();
    expect(parseMcaDate('not a date')).toBeNull();
  });
});

describe('master data mapping', () => {
  const csv =
    'CORPORATE_IDENTIFICATION_NUMBER,COMPANY_NAME,COMPANY_CLASS,DATE_OF_REGISTRATION,PAIDUP_CAPITAL,REGISTERED_OFFICE_ADDRESS\n' +
    'U72900TN2020PTC138472,"NORTHWIND TECHNOLOGIES PRIVATE LIMITED",Private,14/07/2020,"25,00,000","1 Mount Road"\n';

  it('maps a row and prefers the CIN over the file for state and entity type', () => {
    const { records } = parseMcaMasterData(csv);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      cin: 'U72900TN2020PTC138472',
      name: 'NORTHWIND TECHNOLOGIES PRIVATE LIMITED',
      entityType: 'PRIVATE_LIMITED',
      stateCode: 'TN',
      paidUpCapital: 2500000,
    });
    expect(formatDate(records[0]!.incorporatedOn!)).toBe('2020-07-14');
  });

  it('reports which columns it understood and which it ignored', () => {
    const parsed = parseMcaMasterData(csv);
    expect(parsed.recognisedColumns).toContain('CORPORATE_IDENTIFICATION_NUMBER');
    expect(parsed.unrecognisedColumns).toEqual(['REGISTERED_OFFICE_ADDRESS']);
  });

  it('accepts the alternative header spellings other extracts use', () => {
    const { records } = parseMcaMasterData(
      'CIN,NameOfCompany,DateOfIncorporation\nU72900TN2020PTC138472,Northwind,2020-07-14\n',
    );
    expect(records[0]?.name).toBe('Northwind');
    expect(formatDate(records[0]!.incorporatedOn!)).toBe('2020-07-14');
  });

  it('drops rows with no usable CIN rather than importing a blank', () => {
    const { records, rowCount } = parseMcaMasterData('CIN,COMPANY_NAME\nNOTACIN,Nothing\n,Blank\n');
    expect(rowCount).toBe(2);
    expect(records).toEqual([]);
  });
});

describe('a calendar needs a date of incorporation', () => {
  it('generates nothing, and says why, when it is missing', async () => {
    const { generateCalendar } = await import('../src/engine/generator');
    const { makeContext, makeCompany } = await import('./helpers');
    const { addDays, today } = await import('../src/lib/dates');

    const ctx = makeContext({ company: makeCompany({ incorporationDate: null }) });
    const result = generateCalendar(ctx, { from: addDays(today(), -400), to: addDays(today(), 550) });

    expect(result.items).toEqual([]);
    expect(result.blockedBy).toContain('date of incorporation is missing');
  });
});
