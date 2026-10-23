import { expect, test } from '@playwright/test';
import { gotoApp, treeFile, treeFolder } from '../helpers/app';

/**
 * The tree of the notes: the long names, the drag and drop and the context
 * menu.
 */
test.describe('the tree of the notes', () => {
  test('a long name is cut off with an ellipsis instead of being wrapped', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the tree is a drawer on mobile');

    await gotoApp(page);

    const long =
      'a-very-long-note-name-that-should-never-be-wrapped-into-two-lines-in-the-tree.md';

    // The name is created through the API, so that the test does not depend
    // on the dialogs of the tree.
    await page.evaluate(async (name) => {
      await fetch('/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentPath: '', name }),
      });
      await fetch('/api/notes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: name, content: '# Long', revision: 0 }),
      });
    }, long);
    await page.reload();
    await expect(page.getByTestId('file-tree')).toBeVisible();

    const button = treeFile(page, long);
    await expect(button).toBeVisible();

    // The name stays on one line: the row is exactly one line high.
    const metrics = await button.locator('.tree-name').evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        whiteSpace: style.whiteSpace,
        overflow: style.textOverflow,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        height: element.getBoundingClientRect().height,
        lineHeight: parseFloat(style.lineHeight) || 0,
      };
    });
    expect(metrics.whiteSpace).toBe('nowrap');
    expect(metrics.overflow).toBe('ellipsis');
    // The text is longer than the button, so it is really cut off.
    expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
    // The row is a single line high.
    expect(metrics.height).toBeLessThan(metrics.lineHeight * 1.6);
  });

  test('a note can be dropped on another folder', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the tree is a drawer on mobile');

    await gotoApp(page);

    // Two folders and a note in the first one.
    await page.evaluate(async () => {
      for (const name of ['target', 'source']) {
        await fetch('/api/folders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parentPath: '', name }),
        });
      }
      await fetch('/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentPath: 'source', name: 'movable.md' }),
      });
    });
    await page.reload();
    await expect(page.getByTestId('file-tree')).toBeVisible();

    // The folders are expanded, so that the note is visible.
    for (const name of ['source', 'target']) {
      const toggle = page.getByRole('button', { name: `Expand ${name}`, exact: true });
      if ((await toggle.count()) > 0) await toggle.click();
    }
    const note = treeFile(page, 'movable.md');
    await expect(note).toBeVisible();
    const folder = treeFolder(page, 'target');
    await expect(folder).toBeVisible();

    // The drag of the HTML5 is simulated by hand: the events of the browser
    // are the ones the tree listens to. The steps are separated, because the
    // tree stores the dragged node in the state, and the state is updated
    // between the events.
    await page.evaluate(() => {
      const transfer = new DataTransfer();
      (window as unknown as { __transfer?: DataTransfer }).__transfer = transfer;
      const source = document.querySelector('button.tree-file-button');
      const row = source?.closest('.tree-row') as HTMLElement | null;
      if (!row) throw new Error('the tree does not show the note');

      const event = new DragEvent('dragstart', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: transfer });
      row.dispatchEvent(event);
    });
    await expect.poll(() => page.evaluate(() => !!document.querySelector('.tree-row.dragging'))).toBe(true);

    await page.evaluate(() => {
      const transfer = (window as unknown as { __transfer?: DataTransfer }).__transfer;
      const target = [...document.querySelectorAll('.tree-name')].find(
        (element) => element.textContent === 'target',
      );
      const targetRow = target?.closest('.tree-row') as HTMLElement | null;
      if (!transfer || !targetRow) throw new Error('the tree does not show the folder');

      const over = new DragEvent('dragover', { bubbles: true, cancelable: true });
      Object.defineProperty(over, 'dataTransfer', { value: transfer });
      targetRow.dispatchEvent(over);

      const drop = new DragEvent('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(drop, 'dataTransfer', { value: transfer });
      targetRow.dispatchEvent(drop);
    });

    // The note is now in the target folder: the server knows it.
    await expect
      .poll(
        async () => {
          const res = await page.request.get('/api/tree');
          const tree = (await res.json()) as {
            files?: { path: string }[];
          };
          return (tree.files ?? []).some((file) => file.path === 'target/movable.md');
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  });
});
