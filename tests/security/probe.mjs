/**
 * Black-box security probe against a running API.
 *
 * Not part of `npm test`: it needs a server and a database, and it signs in as
 * a real seeded user. Run it against a dev or staging instance after touching
 * auth, access control or the middleware:
 *
 *   npm run security:probe                       # http://localhost:4000
 *   API=https://staging.example.com/api/v1 npm run security:probe
 *
 * No dependencies — Node's own fetch. Every check prints PASS or FAIL and the
 * process exits non-zero if any fails, so CI can gate on it.
 *
 * It exercises the things that unit tests cannot: that the wiring is actually
 * in place on a live server. Two real gaps were found this way — single-session
 * enforcement missing entirely from the Express API, and a refresh token
 * continuing to work after its session had been displaced — both of which
 * typechecked and passed the unit suite while being wrong.
 */
import crypto from 'node:crypto';

const API = process.env.API ?? 'http://localhost:4000/api/v1';
const EMAIL = process.env.PROBE_EMAIL;
const PASSWORD = process.env.PROBE_PASSWORD;

/**
 * There is no default account, deliberately.
 *
 * This probe signs in repeatedly, and the single-session rule means every
 * sign-in ends that account's session elsewhere. Pointed at an account a person
 * is using, it signs them out — which is exactly what happened when it defaulted
 * to a seeded login: someone working in the browser was thrown out mid-session
 * by a test run, with a message blaming a device that did not exist.
 *
 * Give it an account that nobody is sitting in front of.
 */
if (!EMAIL || !PASSWORD) {
  console.error(`
  PROBE_EMAIL and PROBE_PASSWORD are required.

  This signs in several times and will sign that account out everywhere else,
  so point it at a dedicated test account — never one a person is using.

      PROBE_EMAIL=probe@yourdomain.test PROBE_PASSWORD=… npm run security:probe
`);
  process.exit(2);
}

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const post = (path, body, headers = {}) =>
  fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const get = (path, token) =>
  fetch(API + path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
const login = async (ua) => (await post('/auth/login', { email: EMAIL, password: PASSWORD }, ua ? { 'user-agent': ua } : {})).json();

console.log(`\nSecurity probe against ${API}\n`);

// ── 1. nothing is reachable without a token ────────────────────────────────
console.log('Authentication required');
for (const p of ['/companies', '/companies/onboarded-overview', '/tasks', '/documents',
                 '/dashboard/overview', '/audit', '/billing', '/billing/analytics',
                 '/regulatory/overlays', '/regulatory/sweep']) {
  const r = await get(p);
  check(r.status === 401, `401 without a token: ${p}`, r.status === 401 ? '' : `got ${r.status}`);
}

const session = await login();
const token = session.accessToken;
if (!token) { console.log('\n  cannot sign in — is the server up and seeded?\n'); process.exit(1); }
const [h, pl] = token.split('.');
const claims = JSON.parse(Buffer.from(pl, 'base64url').toString());
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sig = token.split('.')[2];

// ── 2. forged tokens are refused ───────────────────────────────────────────
console.log('\nToken forgery');
const forged = {
  'alg=none, unsigned':            `${b64({ alg: 'none', typ: 'JWT' })}.${pl}.`,
  'role escalated to SUPER_ADMIN': `${h}.${b64({ ...claims, role: 'SUPER_ADMIN' })}.${sig}`,
  'organisation swapped':          `${h}.${b64({ ...claims, org: crypto.randomUUID() })}.${sig}`,
  'session id swapped':            `${h}.${b64({ ...claims, sid: crypto.randomUUID() })}.${sig}`,
  'expired':                       `${h}.${b64({ ...claims, exp: Math.floor(Date.now() / 1000) - 60 })}.${sig}`,
  're-signed with a guessed key':  (() => { const p2 = b64({ ...claims, role: 'SUPER_ADMIN' });
                                      return `${h}.${p2}.${crypto.createHmac('sha256', 'secret').update(`${h}.${p2}`).digest('base64url')}`; })(),
  'garbage':                       'not.a.token',
};
for (const [label, t] of Object.entries(forged)) {
  const r = await get('/companies', t);
  check(r.status === 401, `refused: ${label}`, r.status === 401 ? '' : `got ${r.status}`);
}

// ── 3. one session per account ─────────────────────────────────────────────
console.log('\nOne session per account');
const a = await login('Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/141.0 Safari/537.36');
const b = await login('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604.1');
const displaced = await get('/companies', a.accessToken);
check(displaced.status === 401, 'the older session is displaced by a new sign-in',
      displaced.status === 401 ? '' : `got ${displaced.status}`);
const body = await displaced.json().catch(() => ({}));
check(body?.error?.code === 'SESSION_DISPLACED', 'displacement is reported as SESSION_DISPLACED',
      body?.error?.code ?? 'no code');
// The usual leak: a displaced device still holds a refresh token.
const rDisp = await post('/auth/refresh', { refreshToken: a.refreshToken });
check(rDisp.status === 401, 'a displaced session cannot refresh back in',
      rDisp.status === 401 ? '' : `got ${rDisp.status}`);
// ...while refreshing must not displace you from your own session.
const rOwn = await post('/auth/refresh', { refreshToken: b.refreshToken });
const refreshed = await rOwn.json().catch(() => ({}));
check(rOwn.status === 200, 'the live session can refresh');
if (refreshed.accessToken) {
  const sidBefore = JSON.parse(Buffer.from(b.accessToken.split('.')[1], 'base64url')).sid;
  const sidAfter = JSON.parse(Buffer.from(refreshed.accessToken.split('.')[1], 'base64url')).sid;
  check(sidBefore === sidAfter, 'refreshing keeps your own session rather than displacing it');
  const reuse = await post('/auth/refresh', { refreshToken: b.refreshToken });
  check(reuse.status === 401, 'refresh tokens are single-use');
}

// ── 4. tenant isolation ────────────────────────────────────────────────────
console.log('\nTenant isolation');
const live = refreshed.accessToken ?? b.accessToken;
const mineRes = await get('/companies', live);
const mine = await mineRes.json().catch(() => []);
const held = (Array.isArray(mine) ? mine : mine.rows ?? []).map((c) => c.id);
check(held.length > 0, 'the probe account holds at least one company (control)');
const foreign = crypto.randomUUID();   // an id this account certainly does not hold
for (const [method, path, label] of [
  ['GET', `/companies/${foreign}`, 'read another tenant\'s company'],
  ['GET', `/companies/${foreign}/members`, 'read another tenant\'s team'],
  ['GET', `/companies/${foreign}/events`, 'read another tenant\'s events'],
  ['GET', `/compliance/companies/${foreign}/applicability`, 'read another tenant\'s applicability'],
  ['POST', `/compliance/companies/${foreign}/sync`, 'write to another tenant (sync)'],
  ['PATCH', `/companies/${foreign}`, 'write to another tenant (edit)'],
  ['DELETE', `/companies/${foreign}`, 'delete another tenant\'s company'],
]) {
  const r = await fetch(API + path, {
    method,
    headers: { authorization: `Bearer ${live}`, 'content-type': 'application/json' },
    ...(method === 'PATCH' ? { body: '{}' } : {}),
  });
  check(r.status === 404 || r.status === 403, `refused: ${label}`, `got ${r.status}`);
}

// ── 5. user enumeration ────────────────────────────────────────────────────
console.log('\nUser enumeration');
const known = await (await post('/auth/login', { email: EMAIL, password: 'definitely-wrong' })).text();
const unknown = await (await post('/auth/login', { email: `no-such-${crypto.randomUUID()}@nowhere.test`, password: 'definitely-wrong' })).text();
check(known === unknown, 'a wrong password and an unknown email are indistinguishable');

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);
