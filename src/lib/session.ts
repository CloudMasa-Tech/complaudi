/**
 * One active session per account.
 *
 * The rule is that signing in anywhere ends the session everywhere else. This
 * existed only in the Supabase edge function; the Express API had the database
 * columns but never read or wrote them, so two devices could hold valid tokens
 * for the same account at the same time. This is the Express half, written to
 * match supabase/functions/_shared/session.ts so the two runtimes cannot
 * disagree about whose session is live.
 *
 * Two decisions worth keeping:
 *
 *   The check runs on every request, not at sign-in. Refusing a second sign-in
 *   would strand somebody who lost a phone; displacing the older session lets
 *   them back in, and the older device stops on its next call rather than
 *   running on for the rest of its fifteen-minute token.
 *
 *   The message names the device and time that took over. "Signed out" alone
 *   reads as a bug; "signed in on Chrome, Windows at 4:32 pm" reads as either
 *   your other laptop or somebody you need to know about.
 */
import crypto from 'node:crypto';
import { AppError } from './errors';
import { prisma } from './prisma';

/** 401, with a code the front end already special-cases to explain itself. */
export class SessionDisplacedError extends AppError {
  constructor(message: string) {
    super(message, 401, 'SESSION_DISPLACED');
  }
}

export interface SessionStamp {
  sessionId: string;
  startedAt: Date;
  userAgent: string | null;
  ip: string | null;
}

const clip = (v: string | null | undefined, n: number): string | null =>
  v ? v.slice(0, n) : null;

/** Who is signing in, as plain values — the service layer takes no Express
 *  types, the same way it takes an Actor rather than a Request. */
export interface SessionContext {
  userAgent?: string | null;
  ip?: string | null;
}

/**
 * A device, as far as this rule is concerned: the browser and the address it
 * came from. Not a fingerprint — just enough to tell "the same laptop signing
 * in again" from "somebody else's phone".
 */
function sameDevice(
  a: { userAgent: string | null; ip: string | null },
  b: { userAgent: string | null; ip: string | null },
): boolean {
  if (!a.userAgent || !b.userAgent) return false;
  return a.userAgent === b.userAgent && a.ip === b.ip;
}

/**
 * Claim the account's single session for this device.
 *
 * Signing in again from the device that already holds the session keeps that
 * session rather than replacing it. Replacing it is what produced "this account
 * was signed in on another device" when no other device was involved — a second
 * sign-in from the same laptop displaced the first, and the message was both
 * alarming and untrue. The rule people want is the one it claims to be: you are
 * signed out when somebody signs in *elsewhere*.
 *
 * When the device is genuinely different, every other refresh token is revoked
 * in the same breath. Without that, a displaced device could keep minting fresh
 * access tokens from a refresh token the displacement never touched — which is
 * how a single-session rule gets quietly bypassed.
 */
export async function startSession(userId: string, ctx: SessionContext = {}): Promise<SessionStamp> {
  const incoming = { userAgent: clip(ctx.userAgent, 256), ip: clip(ctx.ip, 64) };

  const current = await prisma.user.findUnique({
    where: { id: userId },
    select: { activeSessionId: true, sessionStartedAt: true, sessionUserAgent: true, sessionIp: true },
  });

  // The same device re-authenticating: keep the session id, so anything it
  // already holds stays valid and nothing anywhere reports a displacement.
  const reuse = Boolean(
    current?.activeSessionId &&
      sameDevice({ userAgent: current.sessionUserAgent, ip: current.sessionIp }, incoming),
  );

  const stamp: SessionStamp = {
    sessionId: reuse ? current!.activeSessionId! : crypto.randomUUID(),
    startedAt: new Date(),
    userAgent: incoming.userAgent,
    ip: incoming.ip,
  };

  await prisma.$transaction([
    // Only a genuinely different device invalidates what the account already
    // holds. Revoking on a same-device sign-in would sign the user's own other
    // tab out, which is the complaint this exists to answer.
    ...(reuse
      ? []
      : [
          prisma.refreshToken.updateMany({
            where: { userId, revokedAt: null },
            data: { revokedAt: stamp.startedAt },
          }),
        ]),
    prisma.user.update({
      where: { id: userId },
      data: {
        activeSessionId: stamp.sessionId,
        sessionStartedAt: stamp.startedAt,
        sessionUserAgent: stamp.userAgent,
        sessionIp: stamp.ip,
      },
    }),
  ]);

  return stamp;
}

/** Signing out gives the account back, so the next sign-in is not a displacement. */
export async function endSession(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { activeSessionId: null, sessionStartedAt: null, sessionUserAgent: null, sessionIp: null },
  });
}

export interface SessionUser {
  activeSessionId: string | null;
  sessionStartedAt: Date | null;
  sessionUserAgent: string | null;
}

export interface SessionCheck {
  ok: boolean;
  message: string;
}

export function checkSession(user: SessionUser, sid: unknown): SessionCheck {
  if (typeof sid !== 'string' || !sid) {
    // A token minted before this shipped carries no sid. It cannot be matched
    // against anything, so it is retired rather than trusted.
    return { ok: false, message: 'Your session predates a security update. Please sign in again.' };
  }
  if (!user.activeSessionId) {
    return { ok: false, message: 'This session has been signed out. Please sign in again.' };
  }
  if (user.activeSessionId !== sid) {
    return { ok: false, message: describeDisplacement(user) };
  }
  return { ok: true, message: '' };
}

function describeDisplacement(user: SessionUser): string {
  const where = describeDevice(user.sessionUserAgent);
  const when = user.sessionStartedAt
    ? user.sessionStartedAt.toLocaleString('en-IN', {
        day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
      })
    : null;
  const tail = [where && `on ${where}`, when && `at ${when}`].filter(Boolean).join(' ');
  return `This account was signed in${tail ? ` ${tail}` : ' somewhere else'}. Only one device can be signed in at a time, so this one was signed out.`;
}

/** "Chrome, Windows" — enough to recognise your own laptop, no fingerprinting. */
export function describeDevice(ua: string | null): string | null {
  if (!ua) return null;
  const browser =
    /\bEdg\//.test(ua) ? 'Edge' :
    /\bOPR\//.test(ua) ? 'Opera' :
    /\bChrome\//.test(ua) ? 'Chrome' :
    /\bFirefox\//.test(ua) ? 'Firefox' :
    /\bSafari\//.test(ua) ? 'Safari' : null;
  const os =
    /\bAndroid\b/.test(ua) ? 'Android' :
    /\b(iPhone|iPad|iOS)\b/.test(ua) ? 'iOS' :
    /\bMac OS X\b/.test(ua) ? 'macOS' :
    /\bWindows\b/.test(ua) ? 'Windows' :
    /\bLinux\b/.test(ua) ? 'Linux' : null;
  return [browser, os].filter(Boolean).join(', ') || null;
}
