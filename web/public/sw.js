/**
 * Complaudi service worker.
 *
 * Deliberately small and hand-written: no Workbox, no build-step precache
 * manifest. Vite hashes its asset filenames, so a static precache list would
 * have to be generated at build time; runtime caching needs no such coupling
 * and cannot go stale against a list that was not regenerated.
 *
 * The rule that matters most here: THIS NEVER CACHES API RESPONSES.
 *
 * Every API response in this app is scoped to one signed-in user — their
 * companies, their filings, their payments. A cache is per-origin, not per
 * user, so caching those would serve one user's compliance data to the next
 * person who signs in on the same device. Shared phones and shared office
 * machines are ordinary in the market this ships to. Only the shell is cached:
 * HTML, JS, CSS, fonts, icons. Nothing that knows who you are.
 */
const VERSION = 'complaudi-v1';
const SHELL = `${VERSION}-shell`;

self.addEventListener('install', (event) => {
  // The app shell is one document; everything else arrives hashed and is picked
  // up by the runtime cache below.
  event.waitUntil(caches.open(SHELL).then((c) => c.add('/')).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Anything that could carry user data, by origin or by path. */
function isApiRequest(url) {
  if (url.origin !== self.location.origin) return true;      // Supabase functions, any CDN API
  return url.pathname.startsWith('/api/') || url.pathname.startsWith('/functions/');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // A cache only makes sense for GET. Anything that changes state is never
  // touched — replaying a POST from a cache would be its own kind of disaster.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (isApiRequest(url)) return;                              // straight to the network, never stored
  if (request.headers.has('authorization')) return;           // belt as well as braces

  // Navigation: network first, so a deployed update is picked up immediately,
  // falling back to the cached shell when offline. Without the fallback the
  // browser shows its own dinosaur instead of the app.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/').then((r) => r ?? Response.error())),
    );
    return;
  }

  // Hashed static assets: serve from cache, refresh in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => cached ?? Response.error());
      return cached ?? network;
    }),
  );
});

// Lets a new build take over without the user closing every tab.
self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });
