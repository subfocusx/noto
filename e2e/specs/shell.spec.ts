import { expect, test } from '@playwright/test';
import { gotoApp, openSidebarIfNeeded } from '../helpers/app';

/**
 * The shell of the application: the header bar was dismantled for good. The
 * global actions live in the header of the EXPLORER section of the left
 * column, the state of the document lives in the status bar at the bottom of
 * the window.
 */
test.describe('the shell of the application', () => {
  test('the header of the column is gone', async ({ page }) => {
    await gotoApp(page);

    // Neither the old bar nor the compact brand row exists any more.
    await expect(page.locator('.app-header')).toHaveCount(0);
    await expect(page.locator('.app-brand-name')).toHaveCount(0);
    await expect(page.locator('.app-title')).toHaveCount(0);
  });

  test('the global actions live in the header of the explorer', async ({ page }) => {
    await gotoApp(page);
    await openSidebarIfNeeded(page);

    const header = page.locator('.sidebar-section-title').filter({ hasText: 'Explorer' });
    await expect(header).toBeVisible();

    // The actions are inside the header of the section, not in the status bar.
    await expect(header.getByRole('button', { name: 'Search notes' })).toBeVisible();
    await expect(header.getByRole('button', { name: 'Graph' })).toBeVisible();
    await expect(header.getByRole('button', { name: 'Archive' })).toBeVisible();
    await expect(header.getByRole('button', { name: 'Open command palette' })).toBeVisible();
    await expect(header.getByRole('button', { name: 'Plugins' })).toBeVisible();

    // The status bar keeps the state of the document and the view.
    const bar = page.locator('.app-footer');
    await expect(bar.getByRole('button', { name: 'Search notes' })).toHaveCount(0);
    await expect(bar.getByRole('button', { name: 'Graph' })).toHaveCount(0);
    await expect(bar.getByRole('button', { name: 'Archive' })).toHaveCount(0);
    await expect(bar.getByRole('button', { name: 'Toggle notes panel' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Toggle outline panel' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Toggle theme' })).toBeVisible();
  });

  test('the explorer shows no counters, the folders keep theirs', async ({ page }) => {
    await gotoApp(page);
    await openSidebarIfNeeded(page);

    // The counters of the section were noise: the totals are not shown.
    await expect(page.locator('.sidebar-section-counts')).toHaveCount(0);
  });

  test('the stubs of the prototype are disabled icons', async ({ page }) => {
    await gotoApp(page);
    await openSidebarIfNeeded(page);

    const graph = page.getByRole('button', { name: 'Graph' });
    const archive = page.getByRole('button', { name: 'Archive' });

    await expect(graph).toHaveAttribute('aria-disabled', 'true');
    await expect(graph).toHaveAttribute('title', 'Not implemented yet');
    await expect(archive).toHaveAttribute('aria-disabled', 'true');
    await expect(archive).toHaveAttribute('title', 'Not implemented yet');
  });

  test('the search is a button and not a field', async ({ page }) => {
    await gotoApp(page);
    await openSidebarIfNeeded(page);

    // The button opens the search palette.
    await page.getByRole('button', { name: 'Search notes' }).click();
    await expect(page.getByRole('dialog', { name: 'Search notes' })).toBeVisible();
  });

  test('the command palette opens from its own icon', async ({ page }) => {
    await gotoApp(page);
    await openSidebarIfNeeded(page);

    // The three dots are gone: they read as "more options", not as a palette.
    await expect(page.locator('[data-testid="plugin-area"]')).toHaveCount(0);

    await page.getByRole('button', { name: 'Open command palette' }).click();
    await expect(page.getByRole('dialog', { name: /command/i })).toBeVisible();
  });

  test('the right panel is hidden and shown again from the status bar', async ({
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

  test('the left panel can be restored from the status bar after it was hidden', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the sidebar is a drawer on mobile');

    await gotoApp(page);

    const toggle = page.getByRole('button', { name: 'Toggle notes panel' });
    await expect(toggle).toBeVisible();

    await toggle.click();
    await expect(page.locator('.app.sidebar-collapsed')).toHaveCount(1);

    // The button lives in the permanent status bar, so the column can always
    // be brought back.
    await toggle.click();
    await expect(page.locator('.app.sidebar-collapsed')).toHaveCount(0);
    await expect(page.locator('.sidebar-wrap')).toBeVisible();
  });

  test('both columns can be resized', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the columns are drawers on mobile');

    await gotoApp(page);

    const sidebar = page.locator('.sidebar-wrap');
    const panel = page.locator('.panel-wrap');

    const sidebarWidth = async () => (await sidebar.boundingBox())!.width;
    const panelWidth = async () => (await panel.boundingBox())!.width;

    const before = { sidebar: await sidebarWidth(), panel: await panelWidth() };

    // The handle of the left column.
    await page.locator('.sidebar-resizer').hover();
    await page.mouse.down();
    await page.mouse.move(before.sidebar + 60, 400, { steps: 6 });
    await page.mouse.up();
    await expect.poll(sidebarWidth).toBeGreaterThan(before.sidebar);

    // The handle of the right column: the width of the outline.
    const grown = await panelWidth();
    await page.locator('.panel-resizer').hover();
    await page.mouse.down();
    await page.mouse.move(1440 - grown - 60, 400, { steps: 6 });
    await page.mouse.up();
    await expect.poll(panelWidth).toBeGreaterThan(grown);
  });

  test('the outline of the note lists its headings', async ({ page }) => {
    await gotoApp(page);

    // The empty note has no headings.
    await expect(page.locator('.outline-panel')).toBeVisible();
    await expect(page.locator('.outline-empty')).toBeVisible();
  });

  test('the buttons of the footer of the column are icons only', async ({ page }) => {
    await gotoApp(page);
    await openSidebarIfNeeded(page);

    const trash = page.locator('.sidebar-footer').getByRole('button', { name: 'Trash' });
    await expect(trash).toBeVisible();
    // The button carries no text: only the icon.
    await expect(trash).toHaveText('');
  });

  test('the tabs are flat: the active one is marked with an underline', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the tree is a drawer on mobile');

    await gotoApp(page);

    const tab = page.locator('.tab-strip .tab').first();
    if ((await tab.count()) === 0) return;

    const radius = await tab.evaluate((element) => getComputedStyle(element).borderRadius);
    expect(radius).toBe('0px');
  });
});
