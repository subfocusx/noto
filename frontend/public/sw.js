/* Noto service worker.
 * - precached app shell (including the hashed assets of the current build)
 * - network-only for every /api/* route: private payloads are never cached,
 *   an offline request fails with an explicit network error instead of
 *   serving a stale note body
 * - cache-first for static assets
 *
 * `__BUILD_ID__` is replaced with the build timestamp by `scripts/copy-dist.mjs`
 * (run as the `postbuild` step), so a new build invalidates the old caches.
 *
 * The routing rules themselves live in `/sw-policy.js` (a classic script, so
 * that it can be loaded with `importScripts` without turning this worker into
 * a module worker) and are unit tested in `src/__tests__/sw-policy.test.ts`.
 */
importScripts('/sw-policy.js');

const POLICY = globalThis.NotoSwPolicy;

const VERSION = 'noto-__BUILD_ID__';
const SHELL_CACHE = POLICY.cacheNameFor('shell', VERSION);
const ASSET_CACHE = POLICY.cacheNameFor('assets', VERSION);
// Kept only as a safety net: nothing is ever stored in it, but a leftover
// cache from an older build (or from a previous version of this worker) is
// purged on activation and after every successful mutation.
const PRIVATE_API_CACHE = POLICY.cacheNameFor('private-api', VERSION);

const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

/** Caches the app shell and every asset the current build references. */
async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  await Promise.all(SHELL.map((url) => cache.add(url).catch(() => undefined)));
  try {
    const response = await fetch('/index.html', { cache: 'no-cache' });
    if (!response || !response.ok) return;
    const html = await response.text();
    await cache.put(
      '/index.html',
      new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
    );
    const assets = POLICY.extractAssets(html);
    await Promise.all(assets.map((url) => cache.add(url).catch(() => undefined)));
  } catch (err) {
    // Offline during the installation: the static shell stays cached.
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            // Drop caches of older builds and any legacy `-api` cache that a
            // previous version of this worker may have created.
            .filter((key) => !key.startsWith(VERSION) || key.endsWith('-api'))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

/**
 * A response describing the network failure, shaped like the API error
 * envelope so the client can report a meaningful message.
 */
function networkErrorResponse(privateApi) {
  const message = privateApi
    ? 'Noto is offline: the server could not be reached.'
    : 'The Noto server could not be reached.';
  return new Response(
    JSON.stringify({ error: { code: 'network_error', message } }),
    { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
  );
}

/**
 * Network-only for private data. The response is never written to a cache,
 * so an offline request can only fail — it can never serve stale content.
 */
async function networkOnly(request, privateApi) {
  try {
    // `cache: 'no-store'` keeps the HTTP cache of the browser out of the
    // picture: a private API response must never be answered from a stale
    // cache entry, not even from the disk cache of the browser.
    return await fetch(request, { cache: 'no-store' });
  } catch (err) {
    return networkErrorResponse(privateApi);
  }
}

/** Removes any trace of cached private API responses. */
async function clearPrivateApiCache() {
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => key === PRIVATE_API_CACHE || key.endsWith('-api'))
      .map((key) => caches.delete(key)),
  );
}

/**
 * A successful mutation invalidates whatever might still be cached for the
 * private API routes.
 */
async function mutate(request, privateApi) {
  const response = await networkOnly(request, privateApi);
  if (response && response.ok) {
    await clearPrivateApiCache();
  }
  return response;
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok && request.method === 'GET') {
    const cache = await caches.open(ASSET_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

async function navigationResponse() {
  const cache = await caches.open(SHELL_CACHE);
  const cached = (await cache.match('/index.html')) || (await cache.match('/'));
  try {
    const response = await fetch('/index.html');
    if (response && response.ok) {
      cache.put('/index.html', response.clone());
      return response;
    }
    return cached;
  } catch (err) {
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (POLICY.shouldNetworkOnly(url, self.location.origin)) {
    // Private payloads are never cached; /api/health is public but still
    // network-only so that no API response survives in a cache.
    const privateApi = POLICY.isPrivateApi(url, self.location.origin);
    if (request.method === 'GET') {
      event.respondWith(networkOnly(request, privateApi));
      return;
    }
    // Mutations must invalidate any cached private API data.
    event.respondWith(mutate(request, privateApi));
    return;
  }

  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    event.respondWith(navigationResponse());
    return;
  }

  // Only the static files of the app shell and of the current build are
  // allowed to end up in a cache; every other route goes to the network.
  if (!POLICY.shouldCacheFirst(url, self.location.origin)) return;
  event.respondWith(cacheFirst(request));
});
