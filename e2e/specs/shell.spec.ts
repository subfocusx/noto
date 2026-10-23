import { expect, test } from '@playwright/test';
import { gotoApp, openSidebarIfNeeded } from '../helpers/app';

/**
 * The redesigned shell: the persistent top bar, the collapsible columns and
 * the outline of the note.
 */
test.describe('the shell of the application', () => {
  test('the top bar carries the brand, the search and both column toggles', async ({ page }) => {
    await gotoApp(page);

    await expect(page.locator('.app-brand-name')).toHaveText('Noto');
    await expect(page.getByRole('button', { name: 'Search notes' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Toggle notes panel' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Toggle outline panel' })).toBeVisible();

    // The navigation of the prototype is in the top bar.
    await expect(page.locator('.app-header-nav')).toContainText('Editor');
    await expect(page.locator('.app-header-nav')).toContainText('Graph');
    await expect(page.locator('.app-header-nav')).toContainText('Archive');
  });

  test('the stubs of the prototype are marked as not implemented', async ({ page }) => {
    await gotoApp(page);

    const graph = page.locator('.app-header-nav button', { hasText: 'Graph' });
    const archive = page.locator('.app-header-nav button', { hasText: 'Archive' });

    await expect(graph).toHaveAttribute('aria-disabled', 'true');
    await expect(graph).toHaveAttribute('title', 'Not implemented yet');
    await expect(archive).toHaveAttribute('aria-disabled', 'true');
    await expect(archive).toHaveAttribute('title', 'Not implemented yet');
  });

  test('the right panel is hidden and shown again from the top bar', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the panel is a drawer on mobile');

    await gotoApp(page);

    const panel = page.locator('.panel-wrap');
    const toggle = page.getByRole('button', { name: 'Toggle outline panel' });

    await expect(panel).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    await toggle.click();
    await expect(page.locator('.app.panel-hidden')).toHaveCount(1);
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await toggle.click();
    await expect(page.locator('.app.panel-hidden')).toHaveCount(0);
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  test('the left panel can be restored from the top bar after it was hidden', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the sidebar is a drawer on mobile');

    await gotoApp(page);

    const toggle = page.getByRole('button', { name: 'Toggle notes panel' });
    await expect(toggle).toBeVisible();

    await toggle.click();
    await expect(page.locator('.app.sidebar-collapsed')).toHaveCount(1);

    // The button lives in the permanent top bar, so the column can always
    // be brought back.
    await toggle.click();
    await expect(page.locator('.app.sidebar-collapsed')).toHaveCount(0);
    await expect(page.locator('.sidebar-wrap')).toBeVisible();
  });

  test('the outline of the note lists its headings', async ({ page }) => {
    await gotoApp(page);

    // The empty note has no headings.
    await expect(page.locator('.outline-panel')).toBeVisible();
    await expect(page.locator('.outline-empty')).toBeVisible();
  });

  test('the trash button of the sidebar is an icon only', async ({ page }) => {
    await gotoApp(page);
    await openSidebarIfNeeded(page);

    const trash = page.locator('.sidebar-footer').getByRole('button', { name: 'Trash' });
    await expect(trash).toBeVisible();
    // The button carries no text: only the icon.
    await expect(trash).toHaveText('');
  });
});
