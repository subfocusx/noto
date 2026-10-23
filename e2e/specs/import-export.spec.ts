import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { IMPORT_ZIP_PATH } from '../fixtures/make-fixture';
import { expandFolder, gotoApp, treeFile, treeFolder } from '../helpers/app';
import { readZip } from '../helpers/zip';

test.describe('import and export', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop project only');
  });

  test('a zip archive can be imported through the UI', async ({ page }) => {
    await gotoApp(page);

    await page.getByRole('button', { name: 'Import and export', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Import & Export' });
    await expect(dialog).toBeVisible();

    await dialog.locator('input[type="file"][accept*="zip"]').setInputFiles(IMPORT_ZIP_PATH);

    const summary = page.getByTestId('import-summary');
    await expect(summary).toBeVisible({ timeout: 15_000 });
    await expect(summary).toContainText('Imported: 1');
    await expect(summary).toContainText('Imported/note.md');

    await page.getByRole('button', { name: 'Close dialog' }).click();

    // The imported folder and file show up in the tree.
    await expect(treeFolder(page, 'Imported')).toBeVisible();
    await expandFolder(page, 'Imported');
    await expect(treeFile(page, 'note.md')).toBeVisible();
  });

  test('the export action downloads a zip that contains the imported note', async ({ page }) => {
    await gotoApp(page);

    // Make sure the import from the previous test (or a previous run) is present.
    await page.getByRole('button', { name: 'Import and export', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Import & Export' });
    await expect(dialog).toBeVisible();
    await dialog.locator('input[type="file"][accept*="zip"]').setInputFiles(IMPORT_ZIP_PATH);
    await expect(page.getByTestId('import-summary')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Close dialog' }).click();

    // Open the imported note so that "Export current folder" targets "Imported".
    await expandFolder(page, 'Imported');
    await treeFile(page, 'note.md').click();
    await expect(page.locator('.app-title')).toHaveText('note.md');

    await page.getByRole('button', { name: 'Import and export', exact: true }).click();
    const exportDialog = page.getByRole('dialog', { name: 'Import & Export' });
    await expect(exportDialog).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await exportDialog.getByRole('link', { name: 'Export current folder' }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/\.zip$/);

    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const buffer = fs.readFileSync(downloadPath as string);

    // The file really is a zip archive.
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');

    const entries = readZip(buffer);
    const names = entries.map((entry) => entry.name);
    expect(names).toContain('Imported/note.md');

    const note = entries.find((entry) => entry.name === 'Imported/note.md');
    expect(note?.data.toString('utf8')).toContain('# Imported note');
  });
});
