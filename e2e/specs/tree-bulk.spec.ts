/**
 * End-to-end tests for the bulk actions of the tree.
 *
 * A vault with many folders is tiring to walk through one by one: the explorer
 * offers two buttons that open and close every folder of the storage at once.
 */
import { expect, test } from '@playwright/test';
import { createFolder, createNote, gotoApp, treeFile } from '../helpers/app';

/** A unique suffix so that every test works on its own note and folder. */
function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

test.describe('the tree at once', () => {
  // The tree is a drawer below 820px, and the buttons of the explorer are
  // inside it.
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop project only');
  });

  test('every folder of the storage can be opened and closed at once', async ({ page }) => {
    const folder = unique('bulk-folder');
    const note = unique('bulk-note');

    await gotoApp(page);
    await createFolder(page, folder);
    await createNote(page, folder, `${note}.md`);

    // The note is inside the folder: the folder is open, so the note is in the
    // tree.
    await expect(treeFile(page, `${note}.md`)).toBeVisible();

    const actions = page.locator('.sidebar-section-actions');

    // One click closes every folder of the storage: the note inside the folder
    // is not in the tree any more.
    await actions.getByRole('button', { name: 'Collapse all folders' }).click();
    await expect(page.getByRole('button', { name: `Expand ${folder}`, exact: true })).toBeVisible();
    await expect(treeFile(page, `${note}.md`)).toHaveCount(0);

    // And one click opens them all again.
    await actions.getByRole('button', { name: 'Expand all folders' }).click();
    await expect(treeFile(page, `${note}.md`)).toBeVisible();
    await expect(page.getByRole('button', { name: `Collapse ${folder}`, exact: true })).toBeVisible();
  });
});
