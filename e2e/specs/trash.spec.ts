/**
 * End-to-end tests for the trash of the notes.
 *
 * The trash lives in a section of the left column. Every entry carries an icon
 * button that puts the note back where it was.
 */
import { expect, test } from '@playwright/test';
import {
  activeTabName,
  chooseInRowMenu,
  editorText,
  fileRow,
  gotoApp,
  treeFile,
  waitForSaved,
} from '../helpers/app';

/** A unique suffix so that every test works on its own note. */
function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

test.describe('the trash', () => {
  // The trash is a section of the left column, which is a drawer below 820px.
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop project only');
  });

  test('the icon of an entry puts the note back', async ({ page }) => {
    const note = unique('trash-note');
    const file = `${note}.md`;

    await gotoApp(page);

    // A note with a text in it.
    await page.getByRole('button', { name: 'New note', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New note' });
    await dialog.getByLabel('Name', { exact: true }).fill(note);
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(activeTabName(page)).toHaveText(file);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('the text of the note\n');
    await waitForSaved(page);

    // The note is deleted and lands in the trash.
    await chooseInRowMenu(page, fileRow(page, file), 'Delete');
    const confirm = page.getByRole('dialog', { name: 'Delete' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(treeFile(page, file)).toHaveCount(0);

    // The section of the trash shows the entry with an icon button.
    await page.getByRole('button', { name: 'Trash', exact: true }).click();
    const list = page.getByTestId('trash-list');
    await expect(list).toBeVisible();
    const restore = list.getByRole('button', { name: `Restore ${file}` });
    await expect(restore).toBeVisible();

    // The button is an icon: it carries no text of its own.
    await expect(restore).toHaveText('');

    // One click puts the note back, with its text.
    await restore.click();
    await expect(list.getByRole('button', { name: `Restore ${file}` })).toHaveCount(0);

    await page.getByRole('button', { name: 'Explorer', exact: true }).click();
    await expect(treeFile(page, file)).toBeVisible();
    await treeFile(page, file).click();
    expect(await editorText(page)).toContain('the text of the note');
  });
});
