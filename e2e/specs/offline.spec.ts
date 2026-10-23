import { expect, test } from '@playwright/test';
import { gotoApp } from '../helpers/app';

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
    await expect(page.locator('.app-title')).toBeVisible();
    await expect(page.getByTestId('empty-state')).toBeVisible();

    /* -------------------------------------------------------------- offline */
    await context.setOffline(true);

    const banner = page.getByTestId('offline-banner');
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(banner).toContainText('Offline');

    // The app shell is still served from the service worker cache.
    await page.reload();
    await expect(page.locator('.app-title')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('file-tree')).toBeVisible();
    await expect(page.getByTestId('empty-state')).toBeVisible();
    await expect(page.getByTestId('offline-banner')).toBeVisible();

    /* --------------------------------------------------------------- online */
    await context.setOffline(false);
    await expect(page.getByTestId('offline-banner')).toBeHidden({ timeout: 15_000 });
  });
});
