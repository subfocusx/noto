/* Noto service worker.
 * - precached app shell (including the hashed assets of the current build)
 * - network-only for every /api/* route: private payloads are never cached,
 *   an offline request fails with an explicit network error instead of
 *   serving a stale note body
 * - cache-first for static assets
 *
 * `__BUILD_ID__` is replaced with the build timestamp by `scripts/copy-dist.mjs`
 * (run as the `postbuild` step), so a new build invalidates the old caches.
 */
const VERSION = 'noto-__BUILD_ID__';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
// Kept only as a safety net: nothing is ever stored in it, but a leftover
// cache from an older build (or from a previous version of this worker) is
// purged on activation and after every successful mutation.
const PRIVATE_API_CACHE = `${VERSION}-private-api`;

/** Every route that carries private, user specific data. */
const PRIVATE_API_PREFIXES = [
  '/api/notes',
  '/api/tree',
  '/api/search',
  '/api/trash',
  '/api/attachments',
];

const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

/** Collects the local assets referenced by the built index.html. */
function extractAssets(html) {
  const urls = new Set();
  const pattern = /(?:src|href)\s*=\s*"([^"]+)"/g;
  let match = pattern.exec(html);
  while (match) {
    const url = match[1];
    if (
      url.startsWith('/') &&
      !url.startsWith('//') &&
      url !== '/' &&
      !url.startsWith('/api/')
    ) {
      urls.add(url);
    }
    match = pattern.exec(html);
  }
  return Array.from(urls);
}

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
    const assets = extractAssets(html);
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
    return await fetch(request);
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

/**
 * True for the private, user specific API routes. Every /api/* route is
 * treated as private except the public health probe.
 */
function isPrivateApi(pathname) {
  if (PRIVATE_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  return pathname.startsWith('/api/') && pathname !== '/api/health';
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    // Private payloads are never cached; /api/health is public but still
    // network-only so that no API response survives in a cache.
    const privateApi = isPrivateApi(url.pathname);
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
  event.respondWith(cacheFirst(request));
});
