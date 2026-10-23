/** Helpers for the service worker behaviour of the end-to-end tests. */
import type { Page } from '@playwright/test';

/**
 * Waits until a service worker is active and controls the page.
 */
export async function waitForServiceWorker(page: Page): Promise<void> {
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, undefined, {
    timeout: 20_000,
  });
}

/**
 * Every URL that is currently stored in one of the caches of the origin.
 */
export async function cachedUrls(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const names = await caches.keys();
    const urls: string[] = [];
    for (const name of names) {
      const cache = await caches.open(name);
      const requests = await cache.keys();
      for (const request of requests) urls.push(request.url);
    }
    return urls;
  });
}

/** The result of an API call made from inside the page. */
export interface ApiResult {
  status: number;
  body: unknown;
}

/**
 * Calls an API route from inside the page, so that the request is routed
 * through the service worker, and returns the status and the parsed body.
 */
export async function apiRequest(page: Page, path: string): Promise<ApiResult> {
  return page.evaluate(async (target) => {
    const response = await fetch(target);
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  }, path);
}
