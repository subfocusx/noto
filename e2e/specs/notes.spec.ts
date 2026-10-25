import { expect, test } from '@playwright/test';
import {
  activeTabName,
  clickMove,
  clickRename,
  createFolder,
  createNote,
  currentPath,
  expandFolder,
  fileRow,
  folderItem,
  gotoApp,
  treeFile,
  treeFolder,
} from '../helpers/app';

test.describe('tree operations', () => {
  // The sidebar is a drawer below 820px, so the tree interactions run on desktop only.
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop project only');
  });

  test('a folder and a note inside it can be created and show up in the tree', async ({ page }) => {
    await gotoApp(page);

    const folderName = 'E2E Created Folder';
    const note = 'created-note.md';

    await createFolder(page, folderName);
    await expect(treeFolder(page, folderName)).toBeVisible();

    await createNote(page, folderName, note);
    await expect(treeFile(page, note)).toBeVisible();

    // The note is nested under the new folder.
    const folder = folderItem(page, folderName);
    await expect(folder.locator('button.tree-file-button', { hasText: note })).toHaveCount(1);

    // And it is the note that is open in the editor.
    await expect(activeTabName(page)).toHaveText(note);
  });

  test('a note can be renamed and moved to another folder', async ({ page }) => {
    await gotoApp(page);

    const source = 'E2E Move Source';
    const target = 'E2E Move Target';
    const note = 'movable.md';
    const renamed = 'renamed-note.md';

    await createFolder(page, source);
    await createFolder(page, target);
    await createNote(page, source, note);
    await expect(treeFile(page, note)).toBeVisible();

    /* ------------------------------------------------------------- rename */
    await clickRename(page, fileRow(page, note), note);
    const renameDialog = page.getByRole('dialog', { name: 'Rename' });
    await expect(renameDialog).toBeVisible();
    await renameDialog.getByLabel('Name', { exact: true }).fill(renamed);
    await renameDialog.getByRole('button', { name: 'OK', exact: true }).click();

    await expect(treeFile(page, renamed)).toBeVisible();
    await expect(treeFile(page, note)).toHaveCount(0);

    /* --------------------------------------------------------------- move */
    await clickMove(page, fileRow(page, renamed), renamed);
    const moveDialog = page.getByRole('dialog', { name: 'Move' });
    await expect(moveDialog).toBeVisible();
    await moveDialog.getByLabel('Target folder').selectOption({ label: target });
    await moveDialog.getByRole('button', { name: 'OK', exact: true }).click();

    // The open note follows the move.
    await expect(currentPath(page)).toHaveText(`${target}/${renamed}`);

    // The tree shows the note inside the target folder and no longer in the source folder.
    await expandFolder(page, target);
    const targetItem = folderItem(page, target);
    await expect(targetItem.locator('button.tree-file-button', { hasText: renamed })).toHaveCount(1);

    await expandFolder(page, source);
    const sourceItem = folderItem(page, source);
    await expect(sourceItem.locator('button.tree-file-button', { hasText: renamed })).toHaveCount(0);
  });
});
