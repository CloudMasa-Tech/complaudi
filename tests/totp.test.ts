import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  generateTotp,
  generateTotpSecret,
  hashRecoveryCode,
  totpUri,
  verifyTotp,
} from '../supabase/functions/_shared/totp';

/**
 * The seed from RFC 6238 Appendix B — the ASCII string "12345678901234567890",
 * which is what every conforming implementation is checked against.
 */
const RFC_SECRET = base32Encode(new TextEncoder().encode('12345678901234567890'));

describe('base32', () => {
  it('round-trips arbitrary bytes', () => {
    for (const len of [1, 2, 5, 10, 20, 31]) {
      const bytes = crypto.getRandomValues(new Uint8Array(len));
      expect([...base32Decode(base32Encode(bytes))]).toEqual([...bytes]);
    }
  });

  it('encodes the RFC seed the way authenticator apps expect', () => {
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it('tolerates the spacing and case people actually paste', () => {
    const canonical = [...base32Decode('GEZDGNBVGY3TQOJQ')];
    expect([...base32Decode('gezd gnbv gy3t qojq')]).toEqual(canonical);
    expect([...base32Decode('GEZD-GNBV-GY3T-QOJQ')]).toEqual(canonical);
    expect([...base32Decode('GEZDGNBVGY3TQOJQ====')]).toEqual(canonical);
  });

  it('rejects characters outside the alphabet', () => {
    // 0, 1, 8 and 9 are not base32 — silently dropping them would produce a
    // valid-looking secret that generates codes nobody's phone agrees with.
    expect(() => base32Decode('GEZD0NBV')).toThrow(/Invalid base32/);
  });
});

describe('TOTP against the RFC 6238 vectors', () => {
  // Appendix B, SHA-1 column, truncated to the six digits real apps show.
  const vectors: Array<[seconds: number, code: string]> = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    // Past 2^31 seconds — the case that breaks any implementation using 32-bit
    // bitwise operators to write the counter.
    [20000000000, '353130'],
  ];

  for (const [seconds, expected] of vectors) {
    it(`T=${seconds} produces ${expected}`, async () => {
      expect(await generateTotp(RFC_SECRET, seconds * 1000)).toBe(expected);
    });
  }
});

describe('verification', () => {
  const at = 1_700_000_000_000;

  it('accepts the code for the current step', async () => {
    expect(await verifyTotp(RFC_SECRET, await generateTotp(RFC_SECRET, at), at)).toBe(true);
  });

  it('accepts one step of drift either way', async () => {
    const before = await generateTotp(RFC_SECRET, at - 30_000);
    const after = await generateTotp(RFC_SECRET, at + 30_000);
    expect(await verifyTotp(RFC_SECRET, before, at)).toBe(true);
    expect(await verifyTotp(RFC_SECRET, after, at)).toBe(true);
  });

  it('refuses drift beyond the window', async () => {
    const stale = await generateTotp(RFC_SECRET, at - 120_000);
    expect(await verifyTotp(RFC_SECRET, stale, at)).toBe(false);
  });

  it('refuses anything that is not six digits', async () => {
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 56 78']) {
      expect(await verifyTotp(RFC_SECRET, bad, at)).toBe(false);
    }
  });

  it('ignores spacing in an otherwise valid code', async () => {
    const code = await generateTotp(RFC_SECRET, at);
    expect(await verifyTotp(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, at)).toBe(true);
  });

  it('rejects a code minted from a different secret', async () => {
    const other = generateTotpSecret();
    expect(await verifyTotp(RFC_SECRET, await generateTotp(other, at), at)).toBe(false);
  });
});

describe('secrets and enrolment', () => {
  it('mints 160-bit secrets that differ every time', () => {
    const secrets = new Set(Array.from({ length: 50 }, () => generateTotpSecret()));
    expect(secrets.size).toBe(50);
    for (const s of secrets) expect(base32Decode(s).length).toBe(20);
  });

  it('builds an otpauth URI an authenticator can scan', () => {
    const uri = totpUri({ secret: RFC_SECRET, account: 'ca@firm.in', issuer: 'Complaudi' });
    expect(uri.startsWith('otpauth://totp/Complaudi:ca%40firm.in?')).toBe(true);
    const params = new URLSearchParams(uri.split('?')[1]);
    expect(params.get('secret')).toBe(RFC_SECRET);
    expect(params.get('issuer')).toBe('Complaudi');
    expect(params.get('algorithm')).toBe('SHA1');
    expect(params.get('digits')).toBe('6');
    expect(params.get('period')).toBe('30');
  });
});

describe('recovery codes', () => {
  it('mints ten distinct, readable codes', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{5}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{5}$/);
  });

  it('avoids the characters that get misread off a printout', () => {
    const joined = generateRecoveryCodes(200).join('');
    for (const ambiguous of ['I', 'L', 'O', 'U', '0', '1']) {
      expect(joined).not.toContain(ambiguous);
    }
  });

  it('hashes to a stable digest regardless of how the code is typed back', async () => {
    const [code] = generateRecoveryCodes(1);
    const canonical = await hashRecoveryCode(code!);
    expect(await hashRecoveryCode(code!.toLowerCase())).toBe(canonical);
    expect(await hashRecoveryCode(code!.replace('-', ''))).toBe(canonical);
    expect(await hashRecoveryCode(` ${code!} `)).toBe(canonical);
    expect(canonical).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives different codes different hashes', async () => {
    const [a, b] = generateRecoveryCodes(2);
    expect(await hashRecoveryCode(a!)).not.toBe(await hashRecoveryCode(b!));
  });
});
