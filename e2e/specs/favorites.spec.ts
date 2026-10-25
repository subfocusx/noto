/**
 * The favorites of the user.
 *
 * A favorite is a note the user marked for quick access: the tree offers the
 * entry in the menu of a row, the tree shows a star, and the rail has a section
 * that lists them. The list is the data of the user, so it survives a reload.
 */
import { expect, test } from '@playwright/test';
import { gotoApp, openSidebarIfNeeded, treeFile } from '../helpers/app';

test.describe('the favorites', () => {
  test('the rail offers the section of the favorites', async ({ page }) => {
    await gotoApp(page);

    await expect(page.getByRole('button', { name: 'Favorites', exact: true })).toBeVisible();

    await openSidebarIfNeeded(page);
    await page.getByRole('button', { name: 'Favorites', exact: true }).click();
    await expect(page.locator('.column-section[aria-label="Favorites"]')).toBeVisible();
  });

  test('a note can be marked as a favorite and is listed', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the tree is a drawer on mobile');

    await gotoApp(page);

    const note = `favorite-${Date.now().toString(36)}.md`;
    await page.evaluate(async (name) => {
      await fetch('/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentPath: '', name }),
      });
    }, note);
    await page.reload();
    await expect(page.getByTestId('file-tree')).toBeVisible();

    // The menu of the row of the note offers the mark.
    const row = page.locator('.tree-row').filter({ has: treeFile(page, note) });
    await row.hover();
    await row.getByRole('button', { name: /^Menu / }).click();
    const menu = page.locator('.context-menu');
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Add to favorites', exact: true }).click();

    // The section of the favorites lists the note, and the list survives a
    // reload: it lives in the storage of the browser.
    await page.getByRole('button', { name: 'Favorites', exact: true }).click();
    const section = page.locator('.column-section[aria-label="Favorites"]');
    await expect(section).toBeVisible();
    await expect(section.getByText(note)).toBeVisible();

    await page.reload();
    await openSidebarIfNeeded(page);
    await page.getByRole('button', { name: 'Favorites', exact: true }).click();
    await expect(
      page.locator('.column-section[aria-label="Favorites"]').getByText(note),
    ).toBeVisible();
  });
});
