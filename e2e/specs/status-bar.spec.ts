/**
 * End-to-end tests for the status bar of the application.
 *
 * The bar is permanent: it carries the state of the save, the toggles of the
 * columns and, when a filter is active, the filter itself — with the number of
 * the matches and a cross that drops it and brings the whole tree back.
 */
import { expect, test } from '@playwright/test';
import { activeTabName, gotoApp, treeFile, waitForSaved } from '../helpers/app';

/** A unique suffix so that every test works on its own note. */
function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

test.describe('the status bar', () => {
  // The bar is the same on a narrow screen, but the tree is a drawer there and
  // the notes of the test would need the drawer to be opened.
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop project only');
  });

  test('the bar shows the active filter and can drop it', async ({ page }) => {
    const tagged = unique('bar-tagged');
    const plain = unique('bar-plain');

    await gotoApp(page);

    // Two notes: only the first one carries the tag.
    for (const [index, name] of [tagged, plain].entries()) {
      await page.getByRole('button', { name: 'New note', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'New note' });
      await dialog.getByLabel('Name', { exact: true }).fill(name);
      await dialog.getByRole('button', { name: 'OK', exact: true }).click();
      await expect(activeTabName(page)).toHaveText(`${name}.md`);
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+End');
      await page.keyboard.insertText(index === 0 ? `#${tagged}\n` : 'no tag here\n');
      await waitForSaved(page);
    }

    // Without a filter the bar says nothing about one.
    await expect(page.getByTestId('filter-chip')).toHaveCount(0);

    // The filter narrows the tree. The window of the filters is closed after
    // it: the filter stays, and the bar carries it from now on.
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    await page.getByLabel('Filter of the notes').fill(`tag == '${tagged}'`);
    await expect(page.getByText('1 note matches')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await expect(treeFile(page, `${plain}.md`)).toHaveCount(0);

    // The permanent bar carries the filter: the query, the number of the
    // matches and the cross that drops it.
    const chip = page.locator('.app-footer').getByTestId('filter-chip');
    await expect(chip).toBeVisible();
    await expect(chip.locator('.filter-chip-name')).toHaveText(`Filter: tag == '${tagged}'`);
    await expect(chip.locator('.filter-chip-count')).toHaveText('1 note');

    // The words of the other parts of the interface do not leak into the chip:
    // "filtered" belongs to the badge of the explorer, "matches" to the window
    // of the filters.
    await expect(chip).not.toContainText('filtered');
    await expect(chip).not.toContainText('match');

    // The cross of the chip drops the filter and brings the whole tree back.
    await chip.getByRole('button', { name: 'Clear the active filter' }).click();
    await expect(page.getByTestId('filter-chip')).toHaveCount(0);
    await expect(treeFile(page, `${tagged}.md`)).toBeVisible();
    await expect(treeFile(page, `${plain}.md`)).toBeVisible();
  });
});
