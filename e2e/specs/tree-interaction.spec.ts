import { expect, test } from '@playwright/test';
import {
  expandFolder,
  folderRow,
  gotoApp,
  treeFile,
  treeFolder,
} from '../helpers/app';

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

  test('the folders show the number of their notes and the nesting is visible', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the tree is a drawer on mobile');

    await gotoApp(page);

    // A folder with a note and a subfolder with another note.
    await page.evaluate(async () => {
      await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentPath: '', name: 'counters' }),
      });
      await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentPath: 'counters', name: 'inner' }),
      });
      await fetch('/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentPath: 'counters', name: 'one.md' }),
      });
      await fetch('/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentPath: 'counters/inner', name: 'two.md' }),
      });
    });
    await page.reload();
    await expect(page.getByTestId('file-tree')).toBeVisible();

    const folder = treeFolder(page, 'counters');
    await expect(folder).toBeVisible();

    // The counter of the folder counts the notes of the subfolders as well.
    const counter = folderRow(page, 'counters').locator('.tree-count');
    await expect(counter).toHaveText('2');

    // The nesting is shown with a guide line, not only with an indent.
    await expandFolder(page, 'counters');
    await expect(treeFolder(page, 'inner')).toBeVisible();
    await expect(folderRow(page, 'inner').locator('.tree-indent-guides')).toHaveCount(1);
  });

  test('the recent notes can be folded', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the tree is a drawer on mobile');

    await gotoApp(page);

    // A note is opened, so that it lands in the recent notes.
    await page.evaluate(async () => {
      await fetch('/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentPath: '', name: 'recent-note.md' }),
      });
    });
    await page.reload();
    await expect(page.getByTestId('file-tree')).toBeVisible();

    await treeFile(page, 'recent-note.md').click();

    // The recent notes live in the section of the history.
    await page.getByRole('button', { name: 'History', exact: true }).click();

    const toggle = page.getByRole('button', { name: 'Collapse recent notes' });
    await expect(toggle).toBeVisible();
    await toggle.click();

    await expect(page.getByRole('button', { name: 'Expand recent notes' })).toBeVisible();
    await expect(page.locator('.recent-list')).toHaveCount(0);
  });

  test('the right click of a folder opens the menu of the folder', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the tree is a drawer on mobile');

    await gotoApp(page);

    const folder = `right-click-${Date.now().toString(36)}`;
    await page.evaluate(async (name) => {
      await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentPath: '', name }),
      });
    }, folder);
    await page.reload();
    await expect(page.getByTestId('file-tree')).toBeVisible();

    const row = folderRow(page, folder);
    await expect(row).toBeVisible();

    // The right click opens the menu of the row, and the menu of the browser
    // never appears. The panel does not paint the name of the node — it is a
    // narrow column of icons — but its accessible name says which node it
    // acts on.
    await row.click({ button: 'right' });
    const menu = page.locator('.context-menu');
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('aria-label', `Actions of ${folder}`);

    // The folder can be created inside the folder of the menu.
    const inner = `${folder}-inner`;
    await menu.getByRole('menuitem', { name: 'New folder', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New folder' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Name', { exact: true }).fill(inner);
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();

    // The new folder lives inside the folder of the menu.
    await page.getByRole('button', { name: `Expand ${folder}`, exact: true }).click();
    await expect(treeFolder(page, inner)).toBeVisible();
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

  test('a note is dragged with the mouse into a folder, and the tree does not move', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the tree is a drawer on mobile');

    await gotoApp(page);

    const suffix = Date.now().toString(36);
    const source = `mouse-src-${suffix}`;
    const target = `mouse-dst-${suffix}`;
    await page.evaluate(async ([a, b]) => {
      for (const name of [a, b]) {
        await fetch('/api/folders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parentPath: '', name }),
        });
      }
      await fetch('/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentPath: a, name: 'dragged.md' }),
      });
    }, [source, target]);
    await page.reload();
    await expect(page.getByTestId('file-tree')).toBeVisible();

    const expand = page.getByRole('button', { name: `Expand ${source}`, exact: true });
    if (await expand.count()) await expand.click();
    await expect(treeFile(page, 'dragged.md')).toBeVisible();

    const note = treeFile(page, 'dragged.md');
    const folder = folderRow(page, target);
    // The drag starts on the name of the note: the browser starts a native
    // drag of a row reliably from the text of the row.
    const noteBox = await note.locator('.tree-name').boundingBox();
    const folderBox = await folder.boundingBox();
    expect(noteBox).not.toBeNull();
    expect(folderBox).not.toBeNull();

    // The drag of the mouse: the events of the browser are the real ones.
    await page.mouse.move(noteBox!.x + noteBox!.width / 2, noteBox!.y + noteBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(noteBox!.x + noteBox!.width / 2 + 3, noteBox!.y + noteBox!.height / 2 + 3, {
      steps: 2,
    });
    await page.mouse.move(noteBox!.x + noteBox!.width / 2 + 16, noteBox!.y + noteBox!.height / 2 + 16, {
      steps: 8,
    });

    // The tree must not move under the pointer: the target of the drop is the
    // row the user aimed at, not the row that slid under the pointer.
    const duringBox = await folder.boundingBox();
    expect(Math.round(duringBox!.y)).toBe(Math.round(folderBox!.y));

    await page.mouse.move(folderBox!.x + 40, folderBox!.y + folderBox!.height / 2, { steps: 12 });
    // The target of the row answers: the user sees where the node will land.
    await expect(page.locator('.tree-drop-badge')).toHaveText('Drop here');
    await page.mouse.up();

    // The note is now in the target folder: the server knows it.
    await expect
      .poll(
        async () => {
          const res = await page.request.get('/api/tree');
          const tree = (await res.json()) as { files?: { path: string }[] };
          return (tree.files ?? []).some((file) => file.path === `${target}/dragged.md`);
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  });

  test('a folder can be dropped into another folder', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the tree is a drawer on mobile');

    await gotoApp(page);

    // Two folders at the root of the vault.
    const suffix = Date.now().toString(36);
    const inner = `dd-inner-${suffix}`;
    const outer = `dd-outer-${suffix}`;
    await page.evaluate(async ([a, b]) => {
      for (const name of [a, b]) {
        await fetch('/api/folders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parentPath: '', name }),
        });
      }
    }, [inner, outer]);
    await page.reload();
    await expect(page.getByTestId('file-tree')).toBeVisible();

    // The inner folder is dragged onto the outer one.
    await page.evaluate((name) => {
      const transfer = new DataTransfer();
      (window as unknown as { __transfer?: DataTransfer }).__transfer = transfer;
      const label = [...document.querySelectorAll('.tree-name')].find(
        (element) => element.textContent === name,
      );
      const row = label?.closest('.tree-row') as HTMLElement | null;
      if (!row) throw new Error('the tree does not show the folder');

      const event = new DragEvent('dragstart', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: transfer });
      row.dispatchEvent(event);
    }, inner);
    await expect.poll(() => page.evaluate(() => !!document.querySelector('.tree-row.dragging'))).toBe(true);

    await page.evaluate((name) => {
      const transfer = (window as unknown as { __transfer?: DataTransfer }).__transfer;
      const label = [...document.querySelectorAll('.tree-name')].find(
        (element) => element.textContent === name,
      );
      const targetRow = label?.closest('.tree-row') as HTMLElement | null;
      if (!transfer || !targetRow) throw new Error('the tree does not show the folder');

      const over = new DragEvent('dragover', { bubbles: true, cancelable: true });
      Object.defineProperty(over, 'dataTransfer', { value: transfer });
      targetRow.dispatchEvent(over);

      const drop = new DragEvent('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(drop, 'dataTransfer', { value: transfer });
      targetRow.dispatchEvent(drop);
    }, outer);

    // The inner folder now lives inside the outer one.
    await expect
      .poll(
        async () => {
          const res = await page.request.get('/api/tree');
          const tree = (await res.json()) as { folders?: { path: string }[] };
          return (tree.folders ?? []).some((folder) => folder.path === `${outer}/${inner}`);
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  });
});
