import crypto from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import { UnauthorizedError } from './errors';

export interface AccessTokenPayload {
  sub: string;
  org: string;
  email: string;
  name: string;
  role: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: env.JWT_ACCESS_TTL } as SignOptions);
}

/** `iat` is needed to refuse tokens minted before a password change. */
export interface VerifiedAccessToken extends AccessTokenPayload {
  iat: number;
}

export function verifyAccessToken(token: string): VerifiedAccessToken {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET) as VerifiedAccessToken;
  } catch {
    throw new UnauthorizedError('Access token is invalid or has expired');
  }
}

export function signRefreshToken(userId: string): string {
  return jwt.sign({ sub: userId, jti: crypto.randomUUID() }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_TTL,
  } as SignOptions);
}

export function verifyRefreshToken(token: string): { sub: string; jti: string; exp: number } {
  try {
    return jwt.verify(token, env.JWT_REFRESH_SECRET) as { sub: string; jti: string; exp: number };
  } catch {
    throw new UnauthorizedError('Refresh token is invalid or has expired');
  }
}

/** Refresh tokens are stored hashed, so a database leak cannot be replayed. */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const PASSWORD_ALPHABET = 'abcdefghijkmnopqrstuvwxyz';
const PASSWORD_UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const PASSWORD_DIGITS = '23456789';

/**
 * A temporary password that satisfies the policy by construction.
 *
 * Ambiguous glyphs (l/1/I, o/0/O) are left out — this gets read aloud or copied
 * from a message, and a password nobody can transcribe is a support call.
 */
export function generateTemporaryPassword(): string {
  const pick = (set: string, n: number) =>
    Array.from(crypto.getRandomValues(new Uint32Array(n)), (v) => set[v % set.length]).join('');

  const core = `${pick(PASSWORD_UPPER, 3)}${pick(PASSWORD_ALPHABET, 6)}${pick(PASSWORD_DIGITS, 3)}`;
  // Shuffle so the shape is not predictable.
  const chars = core.split('');
  const order = crypto.getRandomValues(new Uint32Array(chars.length));
  return chars
    .map((c, i) => ({ c, k: order[i]! }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.c)
    .join('');
}
