// supabase/functions/_shared/totp.ts
/**
 * RFC 6238 TOTP, and the base32 it travels in, on Web Crypto alone.
 *
 * Written out rather than pulled from esm.sh deliberately: this is perhaps
 * eighty lines of well-specified arithmetic, and a second-factor check is the
 * last place to accept an unpinned third-party module fetched at cold start.
 *
 * Interoperates with Google Authenticator, 1Password, Authy and Aegis — all of
 * which assume the defaults below (SHA-1, 6 digits, 30-second step). Those are
 * weak-sounding but correct: HMAC-SHA1 is unbroken for this use, and changing
 * any of them silently breaks every authenticator app people actually have.
 */

const DIGITS = 6;
const PERIOD = 30;
/** How many steps either side of now are accepted, for clock drift. */
const WINDOW = 1;

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Uint8Array {
  // Authenticator apps and humans both introduce spacing and lowercase; padding
  // is optional in practice. Normalise rather than reject.
  const clean = input.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');

  let bits = 0;
  let value = 0;
  const out: number[] = [];

  for (const char of clean) {
    const idx = B32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error('Invalid base32 character in TOTP secret');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** A fresh 160-bit secret — the size RFC 4226 recommends for HMAC-SHA1. */
export function generateTotpSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

async function hotp(secret: Uint8Array, counter: number): Promise<string> {
  // The counter is eight bytes, big-endian. It is written through a DataView as
  // a BigInt so the top four bytes are not silently lost to JavaScript's 32-bit
  // bitwise operators — a bug that stays invisible until 2038.
  const buf = new ArrayBuffer(8);
  new DataView(buf).setBigUint64(0, BigInt(counter), false);

  const key = await crypto.subtle.importKey(
    'raw',
    // Cast is for the type-checker only: both Deno and Node accept a
    // Uint8Array here, but their lib definitions name the parameter type
    // differently.
    secret as unknown as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf));

  // Dynamic truncation, RFC 4226 §5.4.
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary =
    ((mac[offset]! & 0x7f) << 24) |
    ((mac[offset + 1]! & 0xff) << 16) |
    ((mac[offset + 2]! & 0xff) << 8) |
    (mac[offset + 3]! & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

export async function generateTotp(secretBase32: string, atMs: number = Date.now()): Promise<string> {
  return hotp(base32Decode(secretBase32), Math.floor(atMs / 1000 / PERIOD));
}

/**
 * Check a submitted code.
 *
 * Accepts one step either side of the present, which covers the phone and the
 * server disagreeing by up to thirty seconds. Comparison is constant-time: a
 * six-digit space is small enough that leaking "how many leading digits were
 * right" through timing would genuinely narrow it.
 */
export async function verifyTotp(
  secretBase32: string,
  code: string,
  atMs: number = Date.now(),
): Promise<boolean> {
  const submitted = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(submitted)) return false;

  const secret = base32Decode(secretBase32);
  const step = Math.floor(atMs / 1000 / PERIOD);

  let matched = false;
  for (let drift = -WINDOW; drift <= WINDOW; drift += 1) {
    // Every candidate is evaluated — no early return — so the time taken does
    // not reveal which step matched.
    if (timingSafeEqual(await hotp(secret, step + drift), submitted)) matched = true;
  }
  return matched;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The URI an authenticator app scans. Issuer appears twice by convention. */
export function totpUri(opts: { secret: string; account: string; issuer: string }): string {
  const label = `${encodeURIComponent(opts.issuer)}:${encodeURIComponent(opts.account)}`;
  const params = new URLSearchParams({
    secret: opts.secret,
    issuer: opts.issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ------------------------------------------------------------- recovery codes

/**
 * Ten single-use codes, shown once at enrolment and stored only as hashes.
 *
 * Crockford-style alphabet without I, L, O, U or 0/1: these are read off a
 * printout under pressure, having lost the phone, and a misread character is
 * indistinguishable from a wrong code.
 */
const RECOVERY_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    const body = [...bytes].map((b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join('');
    codes.push(`${body.slice(0, 5)}-${body.slice(5, 10)}`);
  }
  return codes;
}

export async function hashRecoveryCode(code: string): Promise<string> {
  const normalised = code.toUpperCase().replace(/[\s-]/g, '');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalised));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
