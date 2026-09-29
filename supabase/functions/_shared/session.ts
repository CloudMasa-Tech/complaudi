// supabase/functions/_shared/session.ts
/**
 * One active session per account.
 *
 * A compliance login is not a personal login: it reaches a whole book of
 * clients, their filings and their evidence. Sharing one set of credentials
 * around an office destroys the audit trail — every action lands under one
 * name, and "who marked AOC-4 complete?" stops having an answer.
 *
 * So an account may hold exactly one session. Every access token carries the
 * `sid` it was minted under; the moment a second sign-in happens, the stored id
 * changes and the first token stops verifying — on the next request, not in
 * fifteen minutes. The displaced device is told what happened and where from,
 * because an unexplained sign-out reads as a fault, while "signed in on another
 * device at 14:32" reads as information.
 *
 * Last login wins, deliberately. Blocking the newer sign-in instead would mean
 * a lost or wedged device could lock somebody out of their own account until a
 * token expired, and the person most likely to be inconvenienced by that is the
 * legitimate owner.
 */

export interface SessionStamp {
  sessionId: string;
  startedAt: string;
  userAgent: string | null;
  ip: string | null;
}

/** Trim to something a column and a sentence can hold. */
const clip = (v: string | null, max: number): string | null =>
  v ? v.slice(0, max) : null;

function clientIp(req: Request): string | null {
  // Supabase sits behind a proxy; the left-most entry is the client.
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return clip(forwarded.split(',')[0]!.trim(), 64);
  return clip(req.headers.get('cf-connecting-ip'), 64);
}

/**
 * Claim the account's single session for this sign-in.
 *
 * Revokes every outstanding refresh token first: without that, the displaced
 * device could quietly mint itself a fresh access token and carry on, which
 * would make the whole mechanism decorative.
 */
export async function startSession(
  supabase: any,
  userId: string,
  req: Request,
): Promise<SessionStamp> {
  const stamp: SessionStamp = {
    sessionId: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    userAgent: clip(req.headers.get('user-agent'), 256),
    ip: clientIp(req),
  };

  await supabase.from('refresh_tokens').delete().eq('userId', userId);

  await supabase
    .from('users')
    .update({
      activeSessionId: stamp.sessionId,
      sessionStartedAt: stamp.startedAt,
      sessionUserAgent: stamp.userAgent,
      sessionIp: stamp.ip,
      lastLoginAt: stamp.startedAt,
      updatedAt: stamp.startedAt,
    })
    .eq('id', userId);

  return stamp;
}

/** Give up the session on an explicit sign-out, so nothing is left claimable. */
export async function endSession(supabase: any, userId: string): Promise<void> {
  await supabase
    .from('users')
    .update({ activeSessionId: null, sessionStartedAt: null, updatedAt: new Date().toISOString() })
    .eq('id', userId);
}

export interface SessionCheck {
  ok: boolean;
  /** Written for the displaced user, not for a log. */
  message: string;
}

/**
 * Does this token still hold the account's session?
 *
 * A token with no `sid` at all is one minted before this feature shipped. It is
 * refused rather than waved through: accepting it would leave a standing way to
 * bypass the check for as long as any old token lived.
 */
export function checkSession(
  user: { activeSessionId: string | null; sessionStartedAt: string | null; sessionUserAgent: string | null },
  sid: unknown,
): SessionCheck {
  if (typeof sid !== 'string' || !sid) {
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

function describeDisplacement(user: {
  sessionStartedAt: string | null;
  sessionUserAgent: string | null;
}): string {
  const where = describeDevice(user.sessionUserAgent);
  const when = user.sessionStartedAt
    ? new Date(user.sessionStartedAt).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  const detail = [where, when ? `at ${when}` : null].filter(Boolean).join(' ');
  return detail
    ? `This account was signed in on another device (${detail}). Only one session is allowed at a time.`
    : 'This account was signed in on another device. Only one session is allowed at a time.';
}

/**
 * A coarse, human description of a device — never the raw user-agent.
 *
 * The string is shown back to whoever was displaced, so it needs to be enough
 * to recognise your own laptop and no more. A full user-agent in the UI is
 * noise, and reflecting it verbatim invites HTML injection for no benefit.
 */
export function describeDevice(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const ua = userAgent.toLowerCase();

  const os = ua.includes('iphone') ? 'iPhone'
    : ua.includes('ipad') ? 'iPad'
    : ua.includes('android') ? 'Android'
    : ua.includes('mac os') || ua.includes('macintosh') ? 'Mac'
    : ua.includes('windows') ? 'Windows'
    : ua.includes('linux') ? 'Linux'
    : null;

  // Order matters: Edge and Chrome both claim Safari, Edge also claims Chrome.
  const browser = ua.includes('edg/') ? 'Edge'
    : ua.includes('firefox') ? 'Firefox'
    : ua.includes('chrome') ? 'Chrome'
    : ua.includes('safari') ? 'Safari'
    : null;

  if (os && browser) return `${browser} on ${os}`;
  return browser ?? os;
}
