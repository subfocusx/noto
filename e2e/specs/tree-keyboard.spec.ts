import { expect, test } from '@playwright/test';
import { gotoApp, treeFile } from '../helpers/app';

/**
 * The keyboard of the tree of the notes.
 *
 * The tree is a list, and a list is walked with the arrow keys: the focus
 * moves from row to row, `Enter` opens the note that has the focus, and the
 * letters jump to a note by the first letters of its name.
 */

/** Creates the notes of the test in the storage of the vault. */
async function createNotes(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(async () => {
    for (const name of ['alpha-keyboard.md', 'beta-keyboard.md', 'xkey-target.md']) {
      await fetch('/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentPath: '', name }),
      });
      await fetch('/api/notes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: name, content: `# ${name}`, revision: 0 }),
      });
    }
  });
}

/** The path of the row that has the focus. */
async function focusedPath(page: import('@playwright/test').Page): Promise<string | null> {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    return active?.closest('[data-tree-path]')?.getAttribute('data-tree-path') ?? null;
  });
}

test.describe('the keyboard of the tree', () => {
  test('the arrow keys walk the rows and Enter opens the note', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the tree is a drawer on mobile');

    await gotoApp(page);
    await createNotes(page);
    await page.reload();
    await expect(page.getByTestId('file-tree')).toBeVisible();

    const first = treeFile(page, 'alpha-keyboard.md');
    await expect(first).toBeVisible();
    await first.focus();

    // The focus is on the note: the next row is the one that follows it.
    await page.keyboard.press('ArrowDown');
    const focused = await focusedPath(page);
    expect(focused).not.toBe('alpha-keyboard.md');

    // The focus walks back to the note, and `Enter` opens it.
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('markdown-editor')).toBeVisible();
  });

  test('the letters jump to a note by the first letters of its name', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the tree is a drawer on mobile');

    await gotoApp(page);
    await createNotes(page);
    await page.reload();
    await expect(page.getByTestId('file-tree')).toBeVisible();

    const first = treeFile(page, 'alpha-keyboard.md');
    await first.focus();
    // The letter jumps to the note whose name begins with it. The prefix is
    // rare on purpose: the storage of the run holds the notes of the other
    // tests too.
    await page.keyboard.press('x');

    expect(await focusedPath(page)).toContain('xkey-target.md');
  });
});
