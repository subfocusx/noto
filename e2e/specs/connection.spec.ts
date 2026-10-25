import { expect, test } from '@playwright/test';
import { gotoApp } from '../helpers/app';

/**
 * The state of the connection with the backend.
 *
 * The application used to show a red banner ("Noto is offline: the server
 * could not be reached.") as soon as a request failed. A lost connection is a
 * state, not an error: the indicator of the status bar shows it, and the banner
 * stays for the real errors.
 *
 * The service worker is blocked in these tests: it answers the requests of the
 * page on its own, and a request that the test aborts would still reach the
 * (running) backend through the worker.
 */
test.describe('the connection with the backend', () => {
  test.use({ serviceWorkers: 'block' });

  test('the indicator is green while the backend answers', async ({ page }) => {
    await gotoApp(page);

    const indicator = page.getByRole('status', { name: 'Backend connected' });
    await expect(indicator).toBeVisible();
    await expect(indicator).toHaveClass(/connected/);
  });

  test('the indicator turns red when the backend stops answering', async ({ page }) => {
    await gotoApp(page);

    const connected = page.getByRole('status', { name: 'Backend connected' });
    await expect(connected).toBeVisible();

    // The backend does not answer any more.
    await page.route('**/api/health', (route) => route.abort());
    await page.route('**/api/tree', (route) => route.abort());

    // The indicator asks the backend right away instead of waiting for the
    // next scheduled probe.
    await connected.click();

    const unreachable = page.getByRole('status', { name: 'The backend is unreachable' });
    await expect(unreachable).toBeVisible({ timeout: 30_000 });
    await expect(unreachable).toHaveClass(/unreachable/);

    // A lost connection is not an error: the screen is not covered by a
    // banner that blames the user.
    await expect(page.locator('.error-banner')).toHaveCount(0);
  });

  test('the indicator can be retried with a click', async ({ page }) => {
    await gotoApp(page);

    let blocked = true;
    await page.route('**/api/health', async (route) => {
      if (blocked) {
        await route.abort();
        return;
      }
      await route.continue();
    });

    const indicator = page.getByRole('status', { name: 'Backend connected' });
    await expect(indicator).toBeVisible();
    await indicator.click();

    const unreachable = page.getByRole('status', { name: 'The backend is unreachable' });
    await expect(unreachable).toBeVisible({ timeout: 30_000 });

    // The backend comes back; the user asks the indicator to try again.
    blocked = false;
    await unreachable.click();

    await expect(page.getByRole('status', { name: 'Backend connected' })).toBeVisible({
      timeout: 30_000,
    });
  });
});
