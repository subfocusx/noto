import { expect, test } from '@playwright/test';
import { gotoApp, openExplorerActions, openSidebarIfNeeded } from '../helpers/app';

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

  test('the actions of the tree live in the strip and the rest of the vault in the menu', async ({
    page,
  }) => {
    await gotoApp(page);
    await openSidebarIfNeeded(page);

    // The actions of the tree stand in the strip under the header: they are
    // the actions of the tree itself.
    for (const name of [
      'Expand all folders',
      'Collapse all folders',
      'New folder',
      'Refresh tree',
      'Archive',
      'Open command palette',
    ]) {
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
    }

    // The graph and the plugins are not on the face of the column: they live
    // in the menu of the header.
    await expect(page.getByRole('button', { name: 'Graph', exact: true })).toHaveCount(0);
    await openExplorerActions(page);

    await expect(page.getByRole('button', { name: 'Graph' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Plugins' })).toBeVisible();

    // The status bar keeps the state of the document and the view.
    const bar = page.locator('.app-footer');
    await expect(bar.getByRole('button', { name: 'Search notes' })).toHaveCount(0);
    await expect(bar.getByRole('button', { name: 'Graph' })).toHaveCount(0);
    await expect(bar.getByRole('button', { name: 'Archive' })).toHaveCount(0);
    await expect(bar.getByRole('button', { name: 'Toggle outline panel' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Toggle theme' })).toBeVisible();
  });

  test('the status bar holds no toggle of the left column', async ({ page }) => {
    await gotoApp(page);

    // The left column stands next to the rail of the sections: it is never
    // hidden, so the status bar has no toggle for it.
    const bar = page.locator('.app-footer');
    await expect(bar.getByRole('button', { name: 'Toggle notes panel' })).toHaveCount(0);
  });

  test('the explorer shows no counters, the folders keep theirs', async ({ page }) => {
    await gotoApp(page);
    await openSidebarIfNeeded(page);

    // The counters of the section were noise: the totals are not shown.
    await expect(page.locator('.sidebar-section-counts')).toHaveCount(0);
  });

  test('the graph and the archive are real views', async ({ page }) => {
    await gotoApp(page);
    await openSidebarIfNeeded(page);

    // The archive stands in the strip of the actions of the tree.
    const archive = page.getByRole('button', { name: 'Archive' });
    await expect(archive).not.toHaveAttribute('aria-disabled', 'true');

    // The graph lives in the menu of the header.
    await openExplorerActions(page);
    const graph = page.getByRole('button', { name: 'Graph' });
    await expect(graph).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('the search opens a window over the application', async ({ page }) => {
    await gotoApp(page);

    // The search is a window over the application: the magnifier of the rail
    // opens it, and the column of the explorer keeps the tree.
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Search notes' })).toBeVisible();
    await expect(page.getByLabel('Search query').first()).toBeVisible();
    await expect(page.locator('.column-section[aria-label="Explorer"]')).toBeVisible();
  });

  test('the last tab closes the note with it', async ({ page }) => {
    await gotoApp(page);
    await openSidebarIfNeeded(page);

    // A note is opened from the tree.
    const file = page.locator('button.tree-file-button').first();
    await file.click();
    await expect(page.locator('.tab-strip .tab')).toHaveCount(1);

    // Closing the tab closes the note: the strip is gone and the editor is
    // empty. The name of the note must not hang in the breadcrumbs.
    await page.getByRole('button', { name: /^Close / }).first().click();
    await expect(page.locator('.tab-strip')).toHaveCount(0);
    await expect(page.getByText('Pick a note in the sidebar or create a new one.')).toBeVisible();
    await expect(page.locator('.app-breadcrumbs')).toHaveCount(0);
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

  test('the left column stays where it is', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the column is a drawer on mobile');

    await gotoApp(page);

    // The column of the notes cannot be collapsed: the rail of the sections
    // stands where the column stands.
    await expect(page.getByRole('button', { name: 'Toggle notes panel' })).toHaveCount(0);
    await expect(page.locator('.sidebar-wrap')).toBeVisible();
    await expect(page.locator('.rail')).toBeVisible();
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

    // The footer holds the import and the export only: the trash lives in the
    // list of the notes, it was in the footer as well (a duplicate).
    const footer = page.locator('.sidebar-footer');
    const transfer = footer.getByRole('button', { name: 'Import and export' });
    await expect(transfer).toBeVisible();
    // The button carries no text: only the icon.
    await expect(transfer).toHaveText('');
    await expect(footer.getByRole('button')).toHaveCount(1);
  });

  test('the tabs are pills: the open notes are told apart', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the tree is a drawer on mobile');

    await gotoApp(page);

    const tab = page.locator('.tab-strip .tab').first();
    if ((await tab.count()) === 0) return;

    // The tab is a pill: it has rounded corners at the top, so that two open
    // notes do not run into each other.
    const radius = await tab.evaluate((element) => getComputedStyle(element).borderRadius);
    expect(radius).not.toBe('0px');

    // There is a gap between two tabs.
    const gap = await page
      .locator('.tab-strip')
      .evaluate((element) => getComputedStyle(element).gap);
    expect(Number.parseInt(gap, 10)).toBeGreaterThan(0);
  });
});
