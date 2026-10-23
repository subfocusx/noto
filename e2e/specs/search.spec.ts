import { expect, test } from '@playwright/test';
import { createFolder, createNote, gotoApp, treeFile, typeInEditor, waitForSaved } from '../helpers/app';

test.describe('search', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop project only');
  });

  test('ctrl+k opens the search overlay and a hit opens the note', async ({ page }) => {
    await gotoApp(page);

    const folder = 'E2E Search Folder';
    const note = 'searchable-note.md';

    await createFolder(page, folder);
    await createNote(page, folder, note);
    await typeInEditor(page, 'A distinctive marker: quokka appears exactly here.\n');
    await waitForSaved(page);

    // Ctrl+K opens the search overlay.
    await page.keyboard.press('Control+k');
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
    await expect(page.locator('.app-title')).toHaveText(note);
    await expect(page.getByTestId('search-results')).toHaveCount(0);
    await expect(page.locator('.cm-content')).toContainText('quokka');

    // The note is still reachable in the tree.
    await expect(treeFile(page, note)).toBeVisible();
  });
});
