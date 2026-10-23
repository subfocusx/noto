/* Noto service worker.
 * - precached app shell (including the hashed assets of the current build)
 * - network-first strategy for GET /api/* with a cache fallback
 * - cache-first for static assets
 *
 * `__BUILD_ID__` is replaced with the build timestamp by the Vite plugin in
 * vite.config.ts, so a new build invalidates the old caches.
 */
const VERSION = 'noto-__BUILD_ID__';
const SHELL_CACHE = `${VERSION}-shell`;
const API_CACHE = `${VERSION}-api`;
const ASSET_CACHE = `${VERSION}-assets`;

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
            .filter((key) => !key.startsWith(VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

async function networkFirst(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
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
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(navigationResponse());
    return;
  }
  event.respondWith(cacheFirst(request));
});
