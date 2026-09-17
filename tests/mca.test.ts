import { describe, expect, it } from 'vitest';
import { decodeCsvBuffer, parseCsv, parseMcaDate, parseMcaMasterData } from '../src/lib/mcaMasterData';
import { formatDate } from '../src/lib/dates';

describe('CSV reading', () => {
  it('handles quoted fields, embedded commas and escaped quotes', () => {
    expect(parseCsv('a,b\n"x,y","he said ""hi"""')).toEqual([['a', 'b'], ['x,y', 'he said "hi"']]);
  });

  it('copes with CRLF and a BOM from Excel', () => {
    expect(parseCsv('﻿a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('sniffs a tab or semicolon delimiter instead of assuming a comma', () => {
    expect(parseCsv('CIN\tCOMPANY_NAME\tDATE_OF_REGISTRATION\nU72900TN2020PTC138472\tNorthwind\t14/07/2020\n'))
      .toEqual([['CIN', 'COMPANY_NAME', 'DATE_OF_REGISTRATION'], ['U72900TN2020PTC138472', 'Northwind', '14/07/2020']]);
    expect(parseCsv('CIN;COMPANY_NAME\nU72900TN2020PTC138472;Northwind\n'))
      .toEqual([['CIN', 'COMPANY_NAME'], ['U72900TN2020PTC138472', 'Northwind']]);
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
    'CORPORATE_IDENTIFICATION_NUMBER,COMPANY_NAME,COMPANY_CLASS,DATE_OF_REGISTRATION,PAIDUP_CAPITAL,REGISTERED_OFFICE_ADDRESS,UNKNOWN_COL\n' +
    'U72900TN2020PTC138472,"NORTHWIND TECHNOLOGIES PRIVATE LIMITED",Private,14/07/2020,"25,00,000","1 Mount Road","ignored"\n';

  it('maps a row and prefers the CIN over the file for state and entity type', () => {
    const { records } = parseMcaMasterData(csv);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      cin: 'U72900TN2020PTC138472',
      name: 'NORTHWIND TECHNOLOGIES PRIVATE LIMITED',
      entityType: 'PRIVATE_LIMITED',
      stateCode: 'TN',
      paidUpCapital: 2500000,
      address: '1 Mount Road',
    });
    expect(formatDate(records[0]!.incorporatedOn!)).toBe('2020-07-14');
  });

  it('reports which columns it understood and which it ignored', () => {
    const parsed = parseMcaMasterData(csv);
    expect(parsed.recognisedColumns).toContain('CORPORATE_IDENTIFICATION_NUMBER');
    expect(parsed.recognisedColumns).toContain('REGISTERED_OFFICE_ADDRESS');
    expect(parsed.unrecognisedColumns).toEqual(['UNKNOWN_COL']);
  });

  it('accepts the alternative header spellings other extracts use', () => {
    const { records } = parseMcaMasterData(
      'CIN,NameOfCompany,DateOfIncorporation\nU72900TN2020PTC138472,Northwind,2020-07-14\n',
    );
    expect(records[0]?.name).toBe('Northwind');
    expect(formatDate(records[0]!.incorporatedOn!)).toBe('2020-07-14');
  });

  it('accepts the widened CIN header variants real-portal files use', () => {
    for (const header of ['CIN NUMBER', 'CIN_NO', 'Corporation Identification Number', 'Corporate Identification Number']) {
      const { records } = parseMcaMasterData(`${header},COMPANY_NAME\nU72900TN2020PTC138472,Northwind\n`);
      expect(records[0]?.cin, `header "${header}"`).toBe('U72900TN2020PTC138472');
    }
  });

  it('reads tab-delimited master data', () => {
    const { records, rowCount } = parseMcaMasterData(
      'CIN\tCOMPANY_NAME\tDATE_OF_REGISTRATION\nU72900TN2020PTC138472\tNorthwind\t14/07/2020\n',
    );
    expect(rowCount).toBe(1);
    expect(records[0]?.cin).toBe('U72900TN2020PTC138472');
  });

  it('drops rows with no usable CIN rather than importing a blank', () => {
    const { records, rowCount } = parseMcaMasterData('CIN,COMPANY_NAME\nNOTACIN,Nothing\n,Blank\n');
    expect(rowCount).toBe(2);
    expect(records).toEqual([]);
  });
});

describe('raw file bytes handed to the parser', () => {
  const utf16le = (s: string): Buffer => {
    const bytes: number[] = [];
    for (const ch of s) {
      const code = ch.charCodeAt(0);
      bytes.push(code & 0xff, code >> 8);
    }
    return Buffer.from(bytes);
  };

  it('decodes an Excel UTF-16LE CSV (with BOM) into plain text', () => {
    const file = Buffer.concat([Buffer.from([0xff, 0xfe]), utf16le('CIN\r\nU72900TN2020PTC138472\r\n')]);
    const { records, rowCount } = parseMcaMasterData(decodeCsvBuffer(file));
    expect(rowCount).toBe(1);
    expect(records[0]?.cin).toBe('U72900TN2020PTC138472');
  });

  it('strips a UTF-8 BOM, which would otherwise pollute the first header', () => {
    const file = Buffer.from('\ufeffCIN\r\nU72900TN2020PTC138472\r\n', 'utf8');
    const { records } = parseMcaMasterData(decodeCsvBuffer(file));
    expect(records[0]?.cin).toBe('U72900TN2020PTC138472');
  });

  it('sniffs BOM-less UTF-16 from a NUL-heavy byte stream', () => {
    const file = utf16le('CIN\nU72900TN2020PTC138472\n');
    const text = decodeCsvBuffer(file);
    expect(text).not.toContain('\u0000');
    expect(text).toBe('CIN\nU72900TN2020PTC138472\n');
  });

  it('skips a leading blank line instead of reading it as the header', () => {
    const { records, rowCount } = parseMcaMasterData('\n\nCIN,COMPANY_NAME\nU72900TN2020PTC138472,Northwind\n');
    expect(rowCount).toBe(1);
    expect(records[0]?.cin).toBe('U72900TN2020PTC138472');
  });

  it('still reports empty input as having nothing at all', () => {
    expect(parseMcaMasterData(decodeCsvBuffer(Buffer.alloc(0)))).toEqual({
      records: [],
      recognisedColumns: [],
      unrecognisedColumns: [],
      rowCount: 0,
    });
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
