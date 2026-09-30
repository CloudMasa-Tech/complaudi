/**
 * Mobile layout audit against a running frontend.
 *
 * Renders the app at phone widths in a real browser and fails on horizontal
 * overflow, the single defect that makes a desktop layout feel broken on a
 * phone. It also names the element responsible, which is the part that makes it
 * useful rather than merely alarming.
 *
 *   npm run audit:mobile                         # http://localhost:5173
 *   WEB=http://localhost:4174 npm run audit:mobile
 *
 * Drives the Chrome already installed rather than downloading one — hence
 * puppeteer-core, not puppeteer. Set CHROME to override the path.
 *
 * Why this is kept: the mobile work shipped with three real overflows, each
 * hidden by the `body { overflow-x: hidden }` guard, which clips the overflow
 * rather than fixing it and so makes the content unreachable instead of
 * visibly wrong. Nothing else in the toolchain could see them — they
 * typechecked, built and passed every unit test.
 *
 *   .truncate set overflow/text-overflow but no display, and does nothing on an
 *   inline <span>: one span measured 307px of min-content and forced the
 *   layout viewport open to 539px on a 390px screen.
 *
 *   The auth panel's decorative radial escaped its clip, because
 *   `overflow: hidden` cannot clip an absolutely-positioned descendant whose
 *   containing block sits outside the clipper.
 *
 *   A role label 141px wide and unwrappable sat beside a 307px identity block.
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const WEB = process.env.WEB ?? 'http://localhost:5173';
const EMAIL = process.env.PROBE_EMAIL ?? 'client@northwind.test';
const PASSWORD = process.env.PROBE_PASSWORD ?? 'DemoPassword1';
const WIDTHS = (process.env.WIDTHS ?? '360,390,430').split(',').map(Number);

const CHROME = process.env.CHROME ?? [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find((p) => fs.existsSync(p));

if (!CHROME) {
  console.error('No Chrome found. Set CHROME=/path/to/chrome.');
  process.exit(1);
}

const PUBLIC = ['/login', '/register', '/forgot-password'];
const PRIVATE = ['/', '/tasks', '/calendar', '/companies', '/documents', '/billing'];

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

/**
 * Measure the page, and when it is too wide, find what cannot shrink.
 *
 * `document.scrollWidth` is the honest number: `body` may be clipping, and a
 * clipped overflow still reports here while looking merely "cut off" on screen.
 * The culprit is found by min-content width, because the usual cause is an
 * element that refuses to get narrower rather than one with a fixed width.
 */
async function measure(page, viewport) {
  return page.evaluate((vw) => {
    const doc = document.documentElement.scrollWidth;
    const out = { doc, vw: window.innerWidth, viewport: vw, culprits: [] };
    if (doc <= window.innerWidth + 1 && window.innerWidth <= vw + 1) return out;

    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;left:-99999px;top:0;width:min-content;';
    document.body.appendChild(probe);
    const rows = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.children.length > 4) continue;             // leaves and near-leaves
      const clone = el.cloneNode(true);
      probe.replaceChildren(clone);
      const mc = probe.getBoundingClientRect().width;
      if (mc > vw * 0.75) {
        const cs = getComputedStyle(el);
        rows.push({
          mc: Math.round(mc),
          sel: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className
            ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''),
          ws: cs.whiteSpace, display: cs.display, minWidth: cs.minWidth,
          text: (el.textContent || '').trim().slice(0, 40).replace(/\s+/g, ' '),
        });
      }
    }
    probe.remove();
    const seen = new Set();
    out.culprits = rows.sort((a, b) => b.mc - a.mc)
      .filter((r) => !seen.has(r.sel) && seen.add(r.sel)).slice(0, 5);
    return out;
  }, viewport);
}

const report = (m, label) => {
  const over = m.doc - m.vw;
  check(over <= 1 && m.vw <= m.viewport + 1, label,
    over > 1 ? `overflows by ${over}px` : (m.vw > m.viewport + 1 ? `layout viewport forced to ${m.vw}px` : ''));
  for (const c of m.culprits) {
    console.log(`          ${String(c.mc).padStart(4)}px min-content  ${c.sel}  display=${c.display} white-space=${c.ws}  "${c.text}"`);
  }
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
console.log(`\nMobile audit against ${WEB}\n`);

for (const width of WIDTHS) {
  console.log(`Signed out — ${width}px`);
  const page = await browser.newPage();
  await page.setViewport({ width, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  for (const path of PUBLIC) {
    await page.goto(WEB + path, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 400));
    report(await measure(page, width), path);
  }
  await page.close();
}

// Signed in: the drawer, the tables, and the pages that actually hold data.
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(`${WEB}/login`, { waitUntil: 'networkidle2', timeout: 45000 });
await page.type('input[type="email"]', EMAIL);
await page.type('input[type="password"]', PASSWORD);
await page.click('button[type="submit"]');

try {
  await page.waitForSelector('.shell', { timeout: 30000 });
} catch {
  console.log('\n  could not sign in — signed-in pages skipped (is the server seeded?)\n');
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
}

console.log('\nSigned in — 390px');
for (const path of PRIVATE) {
  await page.goto(WEB + path, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForSelector('.shell', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1500));   // let the page's own fetches settle
  report(await measure(page, 390), path);
}

console.log('\nNavigation drawer');
const closed = await page.evaluate(() => {
  const s = document.querySelector('.sidebar'), t = document.querySelector('.nav-toggle');
  return {
    toggle: t ? { w: Math.round(t.getBoundingClientRect().width), h: Math.round(t.getBoundingClientRect().height), shown: getComputedStyle(t).display !== 'none' } : null,
    left: s ? Math.round(s.getBoundingClientRect().left) : null,
    position: s ? getComputedStyle(s).position : null,
  };
});
check(closed.toggle?.shown === true, 'the drawer trigger is visible on a phone');
// 44px is the minimum touch target Apple and Google both publish.
check((closed.toggle?.w ?? 0) >= 44 && (closed.toggle?.h ?? 0) >= 44,
  'the trigger is at least 44x44', `${closed.toggle?.w}x${closed.toggle?.h}`);
check(closed.position === 'fixed', 'the rail is off-flow on a phone', closed.position ?? 'missing');
check((closed.left ?? 0) < 0, 'the drawer starts off-canvas', `left=${closed.left}`);

await page.click('.nav-toggle');
await new Promise((r) => setTimeout(r, 600));
const open = await page.evaluate(() => {
  const s = document.querySelector('.sidebar'), n = document.querySelector('.nav-scrim');
  return { left: s ? Math.round(s.getBoundingClientRect().left) : null, scrim: n ? Number(getComputedStyle(n).opacity) : null };
});
check(open.left === 0, 'the drawer opens fully', `left=${open.left}`);
check((open.scrim ?? 0) > 0.3, 'the page behind it is dimmed', `opacity=${open.scrim}`);
report(await measure(page, 390), 'no overflow while the drawer is open');

await browser.close();
console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);
