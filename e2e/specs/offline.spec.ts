import { expect, test } from '@playwright/test';
import { createFolder, createNote, gotoApp, waitForSaved } from '../helpers/app';
import { apiRequest, cachedUrls, waitForServiceWorker } from '../helpers/sw';

test.describe('offline behaviour', () => {
  test('the app shell is served from the service worker cache and the offline state is shown', async ({
    page,
    context,
  }) => {
    await gotoApp(page);

    // Wait until the service worker is active and controlling the page.
    await page.waitForFunction(() => navigator.serviceWorker?.controller != null, undefined, {
      timeout: 20_000,
    });

    // Reload once while online so that every asset is routed through the service
    // worker and ends up in the asset cache.
    await page.reload();
    await expect(page.getByTestId('file-tree')).toBeVisible();
    await expect(page.getByTestId('empty-state')).toBeVisible();

    /* -------------------------------------------------------------- offline */
    await context.setOffline(true);

    const banner = page.getByTestId('offline-banner');
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(banner).toContainText('Offline');

    // The app shell is still served from the service worker cache.
    await page.reload();
    await expect(page.getByTestId('file-tree')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('file-tree')).toBeVisible();
    await expect(page.getByTestId('empty-state')).toBeVisible();
    await expect(page.getByTestId('offline-banner')).toBeVisible();

    /* --------------------------------------------------------------- online */
    await context.setOffline(false);
    await expect(page.getByTestId('offline-banner')).toBeHidden({ timeout: 15_000 });
  });
});

test.describe('private API responses are never cached', () => {
  // Creating a note needs the sidebar, which is a drawer below 820px.
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop project only');
  });

  test('an offline API request fails with a network error instead of serving stale data', async ({
    page,
    context,
  }) => {
    await gotoApp(page);
    await waitForServiceWorker(page);
    // Reload so that the very first request of the page is routed through the
    // service worker as well.
    await page.reload();
    await expect(page.getByTestId('file-tree')).toBeVisible();

    /* --------------------------------------------------- an online mutation */
    const folder = 'E2E Offline Folder';
    const note = 'offline-note.md';

    await createFolder(page, folder);
    await createNote(page, folder, note);
    // The autosave sends the note body (a PUT mutation) to the server.
    await waitForSaved(page);

    // Nothing of the private API is stored in a cache.
    const onlineUrls = await cachedUrls(page);
    expect(onlineUrls.filter((url) => url.includes('/api/'))).toEqual([]);

    /* -------------------------------------------------------------- offline */
    await context.setOffline(true);

    const result = await apiRequest(page, `/api/notes?path=${encodeURIComponent(`${folder}/${note}`)}`);
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ error: { code: 'network_error' } });

    // The failed request did not leave a trace in a cache either.
    const offlineUrls = await cachedUrls(page);
    expect(offlineUrls.filter((url) => url.includes('/api/'))).toEqual([]);

    // The tree is not served from a cache either: it fails the same way.
    const tree = await apiRequest(page, '/api/tree');
    expect(tree.status).toBe(503);
    expect(tree.body).toMatchObject({ error: { code: 'network_error' } });

    /* --------------------------------------------------------------- online */
    await context.setOffline(false);
  });
});
