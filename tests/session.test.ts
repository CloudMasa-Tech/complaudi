import { describe, expect, it } from 'vitest';
import { checkSession, describeDevice } from '../src/lib/session';

const live = (id: string) => ({
  activeSessionId: id,
  sessionStartedAt: new Date('2026-10-01T06:45:00Z'),
  sessionUserAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1',
});

describe('one session per account', () => {
  it('accepts the session that currently holds the account', () => {
    expect(checkSession(live('abc'), 'abc').ok).toBe(true);
  });

  it('refuses a session that has been displaced', () => {
    const r = checkSession(live('new-device'), 'old-device');
    expect(r.ok).toBe(false);
    // The message has to say what happened, or it reads as a bug rather than
    // as somebody else signing in.
    expect(r.message).toMatch(/signed in/i);
    expect(r.message).toMatch(/Safari, iOS/);
    expect(r.message).toMatch(/one device/i);
  });

  it('refuses a token minted before sessions existed', () => {
    // Tokens issued before this shipped carry no sid. They cannot be matched
    // against anything, so they are retired rather than trusted.
    for (const sid of [undefined, null, '', 0, {}, []]) {
      const r = checkSession(live('abc'), sid);
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/predates a security update/i);
    }
  });

  it('refuses every session once the account has been signed out', () => {
    const r = checkSession({ activeSessionId: null, sessionStartedAt: null, sessionUserAgent: null }, 'abc');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/signed out/i);
  });

  it('never reports ok for a mismatch, whatever the metadata is missing', () => {
    expect(checkSession({ activeSessionId: 'x', sessionStartedAt: null, sessionUserAgent: null }, 'y').ok).toBe(false);
  });
});

describe('naming the device that took over', () => {
  it.each([
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/141.0 Safari/537.36', 'Chrome, macOS'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1', 'Safari, iOS'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64) Chrome/141.0 Safari/537.36 Edg/141.0', 'Edge, Windows'],
    ['Mozilla/5.0 (X11; Linux x86_64) Firefox/133.0', 'Firefox, Linux'],
    ['Mozilla/5.0 (Linux; Android 14) Chrome/141.0 Mobile Safari/537.36', 'Chrome, Android'],
  ])('reads %s as %s', (ua, expected) => {
    expect(describeDevice(ua)).toBe(expected);
  });

  it('says nothing rather than guessing', () => {
    // Chrome's UA contains "Safari" and Edge's contains both "Chrome" and
    // "Safari", so order matters; anything unrecognised must yield null rather
    // than a confident wrong answer.
    expect(describeDevice(null)).toBeNull();
    expect(describeDevice('curl/8.4.0')).toBeNull();
  });
});

/**
 * Whether a sign-in counts as "another device".
 *
 * Mirrors the sameDevice test inside startSession. It is exercised here rather
 * than through the database because the rule is the part that matters and the
 * consequence — displace or keep — follows from it directly.
 */
const sameDevice = (
  a: { userAgent: string | null; ip: string | null },
  b: { userAgent: string | null; ip: string | null },
): boolean => {
  if (!a.userAgent || !b.userAgent) return false;
  return a.userAgent === b.userAgent && a.ip === b.ip;
};

describe('what counts as another device', () => {
  const laptop = { userAgent: 'Mozilla/5.0 (Macintosh) Chrome/141.0', ip: '106.200.16.35' };

  it('treats the same browser at the same address as the same device', () => {
    // Signing in again on your own laptop must not sign your own laptop out.
    // Treating it as a displacement produced "signed in on another device" when
    // there was no other device.
    expect(sameDevice(laptop, { ...laptop })).toBe(true);
  });

  it('treats a different browser as another device', () => {
    expect(sameDevice(laptop, { userAgent: 'Mozilla/5.0 (iPhone) Safari/604.1', ip: laptop.ip })).toBe(false);
  });

  it('treats the same browser from a different address as another device', () => {
    // A stolen token replayed from elsewhere is the case worth catching, and it
    // is worth more than sparing a roaming user one extra sign-in.
    expect(sameDevice(laptop, { ...laptop, ip: '203.0.113.9' })).toBe(false);
  });

  it('never claims a match when the device is unknown', () => {
    // No user-agent is not evidence of sameness. Defaulting to "same" would let
    // a header-less client inherit somebody else's live session.
    expect(sameDevice({ userAgent: null, ip: laptop.ip }, laptop)).toBe(false);
    expect(sameDevice(laptop, { userAgent: null, ip: laptop.ip })).toBe(false);
    expect(sameDevice({ userAgent: null, ip: null }, { userAgent: null, ip: null })).toBe(false);
  });
});
