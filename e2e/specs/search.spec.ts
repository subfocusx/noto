import { expect, test } from '@playwright/test';
import {
  activeTabName,
  createFolder,
  createNote,
  gotoApp,
  treeFile,
  typeInEditor,
  waitForSaved,
} from '../helpers/app';

test.describe('search', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop project only');
  });

  test('ctrl+shift+f opens the search overlay and a hit opens the note', async ({ page }) => {
    await gotoApp(page);

    const folder = 'E2E Search Folder';
    const note = 'searchable-note.md';

    await createFolder(page, folder);
    await createNote(page, folder, note);
    await typeInEditor(page, 'A distinctive marker: quokka appears exactly here.\n');
    await waitForSaved(page);

    // Ctrl+Shift+F opens the search overlay (Ctrl+K opens the command palette).
    await page.keyboard.press('Control+Shift+F');
    const searchInput = page.getByLabel('Search query');
    await expect(searchInput).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Search notes' })).toBeVisible();

    await searchInput.fill('quokka');

    const results = page.getByTestId('search-results');
    const hit = results.locator('button.search-result').filter({ hasText: note });
    await expect(hit).toBeVisible({ timeout: 15_000 });
    await expect(hit).toContainText('quokka');

    // Clicking the hit opens the note.
    await hit.click();
    await expect(activeTabName(page)).toHaveText(note);
    await expect(page.getByTestId('search-results')).toHaveCount(0);
    await expect(page.locator('.cm-content')).toContainText('quokka');

    // The note is still reachable in the tree.
    await expect(treeFile(page, note)).toBeVisible();
  });
});

  test('the window of the search does not jump when it opens', async ({ page }) => {
    await gotoApp(page);

    // The window is placed by the CSS, not by the measurement of itself:
    // it must stand in the same place from the first frame.
    await page.keyboard.press('Control+Shift+F');
    const window = page.getByRole('dialog', { name: 'Search notes' });

    const boxes: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const box = await window.boundingBox();
      if (box) boxes.push(`${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.width)}`);
      await page.waitForTimeout(60);
    }

    expect(new Set(boxes).size).toBe(1);
    await expect(window).toBeVisible();
  });
