import { expect, test } from '@playwright/test';
import { gotoApp, treeFile } from '../helpers/app';

/**
 * The tags of the open note and the pencil of the mode.
 *
 * The button that adds a tag opens a window: the window offers the tags of
 * the vault and a field for a new one. The pencil stands in the far corner
 * of the strip of the tags: it belongs to the whole note, not to one tab.
 */

/** Creates a note of the test in the storage of the vault. */
async function createNote(
  page: import('@playwright/test').Page,
  name: string,
  content: string,
): Promise<void> {
  await page.evaluate(
    async ({ note, body }) => {
      await fetch('/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentPath: '', name: note }),
      });
      await fetch('/api/notes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: note, content: body, revision: 0 }),
      });
    },
    { note: name, body: content },
  );
}

test.describe('the tags of the open note', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the tree is a drawer on mobile');
  });

  test('the window of the tags adds a tag written by the user', async ({ page }) => {
    await gotoApp(page);
    await createNote(page, 'tags-window.md', '# tags-window');
    await page.reload();

    await treeFile(page, 'tags-window.md').click();

    // The button opens the window: the field of the window takes the focus,
    // so the name of the tag is written right away.
    await page.getByRole('button', { name: 'Add a tag to the note' }).click();
    const dialog = page.getByRole('dialog', { name: 'Tags of the vault' });
    await expect(dialog).toBeVisible();

    const field = dialog.getByLabel('Name of the new tag');
    await field.fill('e2e-tag');
    await field.press('Enter');

    // The window is closed and the tag stands in the strip of the note.
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.note-tags-strip').getByText('#e2e-tag')).toBeVisible();
  });

  test('the window of the tags offers the tags of the vault', async ({ page }) => {
    await gotoApp(page);
    // The tag belongs to another note: the window of the note does not offer
    // the tags that the note already carries.
    await createNote(page, 'tags-source.md', '# tags-source\n\n#e2e-vault-tag\n');
    await createNote(page, 'tags-offer.md', '# tags-offer');
    await page.reload();

    await treeFile(page, 'tags-offer.md').click();
    await page.getByRole('button', { name: 'Add a tag to the note' }).click();

    const dialog = page.getByRole('dialog', { name: 'Tags of the vault' });
    await expect(dialog).toBeVisible();
    // The list of the vault is in the window; the field filters it.
    await expect(dialog.locator('.tag-picker-input')).toBeVisible();
    await expect(dialog.getByTestId('tag-picker-list')).toBeVisible();
    // The tag of the vault is offered: the same name is not written twice.
    await expect(dialog.getByRole('button', { name: 'Add the tag e2e-vault-tag' })).toBeVisible();
  });

  test('the pencil stands in the far corner of the strip of the tags', async ({ page }) => {
    await gotoApp(page);
    await createNote(page, 'tags-pencil.md', '# tags-pencil');
    await page.reload();

    await treeFile(page, 'tags-pencil.md').click();

    const strip = page.locator('.note-tags-strip');
    await expect(strip).toBeVisible();

    const pencil = page.getByTestId('tab-mode');
    await expect(pencil).toBeVisible();

    // The pencil is the last thing of the row: it is on the right.
    const stripBox = (await strip.boundingBox())!;
    const pencilBox = (await pencil.boundingBox())!;
    expect(pencilBox.x + pencilBox.width).toBeGreaterThan(stripBox.x + stripBox.width - 40);
  });
});
