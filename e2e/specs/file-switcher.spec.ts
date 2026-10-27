import { expect, test } from '@playwright/test';
import { gotoApp } from '../helpers/app';

/**
 * The quick switcher of the files (Ctrl+P).
 *
 * The switcher opens over the editor, filters the notes of the vault by
 * their name and opens the note that the user chooses.
 */
test.describe('the quick switcher of the files', () => {
  test('Ctrl+P opens the switcher and Enter opens the note', async ({ page }) => {
    await gotoApp(page);

    await page.evaluate(async () => {
      await fetch('/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentPath: '', name: 'switcher-target.md' }),
      });
      await fetch('/api/notes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'switcher-target.md', content: '# Switcher', revision: 0 }),
      });
    });
    await page.reload();
    await expect(page.getByTestId('file-tree')).toBeVisible();

    await page.keyboard.press('Control+p');

    const dialog = page.getByRole('dialog', { name: 'Quick file switcher' });
    await expect(dialog).toBeVisible();

    const field = dialog.getByLabel('Search the notes');
    await field.fill('switcher-target');

    const option = dialog.getByRole('option').filter({ hasText: 'switcher-target' });
    await expect(option).toBeVisible();
    await option.click();

    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('markdown-editor')).toBeVisible();
  });

  test('Escape closes the switcher without opening a note', async ({ page }) => {
    await gotoApp(page);

    await page.keyboard.press('Control+p');
    const dialog = page.getByRole('dialog', { name: 'Quick file switcher' });
    await expect(dialog).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});
