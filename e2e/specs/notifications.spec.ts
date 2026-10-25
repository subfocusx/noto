/**
 * The section of the notifications.
 *
 * The model of the notifications lives in the store: the application tells the
 * user when a save fails or when a version conflicts with the one of the
 * server. The section shows the list and the rail carries the number of the
 * entries the user has not read yet.
 */
import { expect, test } from '@playwright/test';
import { gotoApp, openSidebarIfNeeded } from '../helpers/app';

test.describe('the notifications', () => {
  test('the section opens and shows the empty state', async ({ page }) => {
    await gotoApp(page);
    await openSidebarIfNeeded(page);

    await page.getByRole('button', { name: 'Notifications', exact: true }).click();
    const section = page.locator('.column-section[aria-label="Notifications"]');
    await expect(section).toBeVisible();
    await expect(section.getByText('No notification yet.')).toBeVisible();

    // The section of the calendar is not open at the same time: the rail is
    // an accordion.
    await expect(page.locator('.column-section')).toHaveCount(1);
  });

  test('the rail carries no badge when nothing waits for the user', async ({ page }) => {
    await gotoApp(page);

    // The badge only appears when there is something to read.
    await expect(page.locator('.rail-badge')).toHaveCount(0);
  });
});
