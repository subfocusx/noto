/* Noto service worker policy.
 *
 * Pure, side effect free helpers that describe *what* the service worker is
 * allowed to do with a request. The file is loaded twice:
 *
 *  - inside the service worker with `importScripts('/sw-policy.js')`
 *    (a classic, non module service worker, so that `main.tsx` does not have
 *    to register it with `{ type: 'module' }`);
 *  - inside the unit test, where the source is evaluated and the resulting
 *    API object is asserted.
 *
 * Because a classic script cannot use `export`, the API is published on
 * `globalThis.NotoSwPolicy`. A CommonJS `module.exports` is attached as well
 * so that the file can be `require()`d by a plain Node script.
 */
/* eslint-disable no-unused-vars */

/** The origin used to resolve relative URLs into absolute ones. */
const POLICY_BASE_ORIGIN = 'http://noto.local';

/** Routes that carry private, user specific data. */
const PRIVATE_API_PREFIXES = [
  '/api/notes',
  '/api/tree',
  '/api/search',
  '/api/trash',
  '/api/attachments',
];

/** The one public API route. It is never cached either. */
const PUBLIC_API_ROUTES = ['/api/health'];

/** Prefixes of the static files that are served cache-first. */
const STATIC_ASSET_PREFIXES = ['/assets/', '/icons/'];

/** Exact static files that are served cache-first. */
const STATIC_ASSET_FILES = ['/', '/index.html', '/manifest.webmanifest'];

/** The cache kinds used by the service worker. */
const CACHE_KINDS = ['shell', 'assets', 'private-api'];

/**
 * Resolves the input into a URL. Accepts a pathname, an absolute URL, a `URL`
 * instance or a `Request` like object.
 *
 * @param {string | URL | { url: string }} input
 * @param {string} [origin] the origin relative paths are resolved against
 * @returns {URL | null}
 */
function resolvePolicyUrl(input, origin) {
  if (input == null) return null;
  const base = origin || POLICY_BASE_ORIGIN;
  try {
    if (typeof input === 'string') return new URL(input, base);
    if (input instanceof URL) return new URL(input.href);
    if (typeof input.url === 'string') return new URL(input.url, base);
  } catch (err) {
    return null;
  }
  return null;
}

/**
 * True when the URL points at the application itself. Cross origin requests
 * are never touched by the service worker.
 */
function isSameOrigin(input, origin) {
  const url = resolvePolicyUrl(input, origin);
  if (!url) return false;
  const base = origin || POLICY_BASE_ORIGIN;
  try {
    return url.origin === new URL(base).origin;
  } catch (err) {
    return false;
  }
}

/**
 * True for the private, user specific API routes. Every /api/* route is
 * treated as private except the public health probe.
 */
function isPrivateApi(input, origin) {
  const url = resolvePolicyUrl(input, origin);
  if (!url || !isSameOrigin(url, origin)) return false;
  const pathname = url.pathname;
  if (PRIVATE_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  if (PUBLIC_API_ROUTES.includes(pathname)) return false;
  return pathname.startsWith('/api/');
}

/**
 * True for the public API routes (/api/health).
 */
function isPublicApi(input, origin) {
  const url = resolvePolicyUrl(input, origin);
  if (!url || !isSameOrigin(url, origin)) return false;
  return PUBLIC_API_ROUTES.includes(url.pathname);
}

/**
 * True for the static files of the application shell and of the current
 * build: those are the only responses that may be served from a cache.
 */
function isStaticAsset(input, origin) {
  const url = resolvePolicyUrl(input, origin);
  if (!url || !isSameOrigin(url, origin)) return false;
  const pathname = url.pathname;
  if (pathname.startsWith('/api/')) return false;
  if (STATIC_ASSET_FILES.includes(pathname)) return true;
  return STATIC_ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * True when the request has to go to the network and must never be answered
 * from a cache. That is the case for every API route, private or public.
 */
function shouldNetworkOnly(input, origin) {
  const url = resolvePolicyUrl(input, origin);
  if (!url || !isSameOrigin(url, origin)) return false;
  return url.pathname.startsWith('/api/');
}

/**
 * True when the request may be served cache-first.
 */
function shouldCacheFirst(input, origin) {
  return isStaticAsset(input, origin);
}

/**
 * The name of the cache for the given kind and build version.
 */
function cacheNameFor(kind, version) {
  return `${version}-${kind}`;
}

/**
 * Collects the local assets referenced by the built index.html.
 */
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

/**
 * True when a successful mutation has to invalidate whatever might still be
 * cached for the API routes.
 */
function shouldInvalidateApiCache(method, input, origin) {
  if (!shouldNetworkOnly(input, origin)) return false;
  const verb = String(method || 'GET').toUpperCase();
  if (verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS') return false;
  return true;
}

const NotoSwPolicy = {
  POLICY_BASE_ORIGIN,
  PRIVATE_API_PREFIXES,
  PUBLIC_API_ROUTES,
  STATIC_ASSET_PREFIXES,
  STATIC_ASSET_FILES,
  CACHE_KINDS,
  resolvePolicyUrl,
  isSameOrigin,
  isPrivateApi,
  isPublicApi,
  isStaticAsset,
  shouldNetworkOnly,
  shouldCacheFirst,
  cacheNameFor,
  extractAssets,
  shouldInvalidateApiCache,
};

if (typeof globalThis !== 'undefined') {
  globalThis.NotoSwPolicy = NotoSwPolicy;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = NotoSwPolicy;
}
