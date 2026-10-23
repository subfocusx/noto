// Unit tests for the service worker policy (`frontend/public/sw-policy.js`).
//
// The policy file is a classic script (it is loaded with `importScripts` from
// the service worker), so it cannot use ESM `export` statements. It publishes
// its API on `globalThis.NotoSwPolicy`; the test evaluates the very same
// source file and asserts the resulting API. That way the tested code is
// literally the code the service worker runs — there is no second copy.
import { describe, expect, it } from 'vitest';
import policySource from '../../public/sw-policy.js?raw';

interface SwPolicy {
  isSameOrigin(input: unknown, origin?: string): boolean;
  isPrivateApi(input: unknown, origin?: string): boolean;
  isPublicApi(input: unknown, origin?: string): boolean;
  isStaticAsset(input: unknown, origin?: string): boolean;
  shouldNetworkOnly(input: unknown, origin?: string): boolean;
  shouldCacheFirst(input: unknown, origin?: string): boolean;
  shouldInvalidateApiCache(method: string, input: unknown, origin?: string): boolean;
  cacheNameFor(kind: string, version: string): string;
  extractAssets(html: string): string[];
}

const policy = new Function(
  `${policySource}\nreturn globalThis.NotoSwPolicy;`,
)() as SwPolicy;

const ORIGIN = 'http://noto.local';

describe('sw policy: private API routes', () => {
  const privateRoutes = [
    '/api/notes',
    '/api/notes?path=a.md',
    '/api/tree',
    '/api/search?q=x',
    '/api/trash',
    '/api/attachments/123',
  ];

  for (const route of privateRoutes) {
    it(`${route} is private and network-only`, () => {
      expect(policy.isPrivateApi(route, ORIGIN)).toBe(true);
      expect(policy.shouldNetworkOnly(route, ORIGIN)).toBe(true);
      expect(policy.shouldCacheFirst(route, ORIGIN)).toBe(false);
      expect(policy.isStaticAsset(route, ORIGIN)).toBe(false);
    });
  }

  it('/api/health is public but still network-only', () => {
    expect(policy.isPublicApi('/api/health', ORIGIN)).toBe(true);
    expect(policy.isPrivateApi('/api/health', ORIGIN)).toBe(false);
    // The health probe is public, yet no API response is ever cached.
    expect(policy.shouldNetworkOnly('/api/health', ORIGIN)).toBe(true);
    expect(policy.shouldCacheFirst('/api/health', ORIGIN)).toBe(false);
  });

  it('an unknown /api/ route is treated as private', () => {
    expect(policy.isPrivateApi('/api/whatever', ORIGIN)).toBe(true);
  });
});

describe('sw policy: static assets', () => {
  const staticPaths = [
    '/',
    '/index.html',
    '/assets/index-abc123.js',
    '/icons/icon-192.png',
    '/manifest.webmanifest',
  ];

  for (const path of staticPaths) {
    it(`${path} is a static asset served cache-first`, () => {
      expect(policy.isStaticAsset(path, ORIGIN)).toBe(true);
      expect(policy.shouldCacheFirst(path, ORIGIN)).toBe(true);
      expect(policy.shouldNetworkOnly(path, ORIGIN)).toBe(false);
      expect(policy.isPrivateApi(path, ORIGIN)).toBe(false);
    });
  }
});

describe('sw policy: cross origin requests', () => {
  const external = [
    'https://cdn.example.com/assets/app.js',
    'https://example.com/api/notes',
  ];

  for (const url of external) {
    it(`${url} is not cached and not network-only`, () => {
      expect(policy.isSameOrigin(url, ORIGIN)).toBe(false);
      expect(policy.isStaticAsset(url, ORIGIN)).toBe(false);
      expect(policy.shouldCacheFirst(url, ORIGIN)).toBe(false);
      expect(policy.shouldNetworkOnly(url, ORIGIN)).toBe(false);
      expect(policy.isPrivateApi(url, ORIGIN)).toBe(false);
    });
  }
});

describe('sw policy: mutations', () => {
  it('a POST invalidates the API cache', () => {
    expect(policy.shouldInvalidateApiCache('POST', '/api/notes', ORIGIN)).toBe(true);
    expect(policy.shouldInvalidateApiCache('PUT', '/api/notes', ORIGIN)).toBe(true);
    expect(policy.shouldInvalidateApiCache('DELETE', '/api/notes', ORIGIN)).toBe(true);
  });

  it('a GET does not invalidate anything', () => {
    expect(policy.shouldInvalidateApiCache('GET', '/api/notes', ORIGIN)).toBe(false);
    expect(policy.shouldInvalidateApiCache('HEAD', '/api/notes', ORIGIN)).toBe(false);
  });

  it('a mutation on a static route does not invalidate the API cache', () => {
    expect(policy.shouldInvalidateApiCache('POST', '/assets/app.js', ORIGIN)).toBe(false);
  });
});

describe('sw policy: helpers', () => {
  it('cacheNameFor builds a versioned cache name', () => {
    expect(policy.cacheNameFor('shell', 'noto-123')).toBe('noto-123-shell');
    expect(policy.cacheNameFor('assets', 'noto-123')).toBe('noto-123-assets');
    expect(policy.cacheNameFor('private-api', 'noto-123')).toBe('noto-123-private-api');
  });

  it('extractAssets collects the local assets of the built html', () => {
    const html = [
      '<script type="module" src="/assets/index-abc.js"></script>',
      '<link rel="stylesheet" href="/assets/index-abc.css">',
      '<link rel="manifest" href="/manifest.webmanifest">',
      '<a href="/api/notes">api</a>',
      '<img src="https://cdn.example.com/x.png">',
    ].join('');

    expect(policy.extractAssets(html)).toEqual([
      '/assets/index-abc.js',
      '/assets/index-abc.css',
      '/manifest.webmanifest',
    ]);
  });
});
