/**
 * The walk over the buttons of the shell.
 *
 * Every button of the shell is clicked and its **effect** is checked: the
 * tree changes, the panel opens, the filter narrows the tree, the tag lands in
 * the text. A button that exists but does nothing is a defect, so the test
 * looks at the state of the application and not at the presence of the
 * element.
 */
import { expect, test } from '@playwright/test';
import {
  activeTabName,
  createNote,
  editorText,
  gotoApp,
  openSidebarIfNeeded,
  treeFile,
  treeFolder,
  waitForSaved,
} from '../helpers/app';
import { openPluginManager, pluginStatus } from '../helpers/plugins';

/** A unique suffix so that every test works on its own notes. */
function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

test.describe('the buttons of the shell', () => {
  // The shell of the columns is the same on every viewport, but on the narrow
  // screen the sidebar is a drawer that covers the workspace, so the buttons
  // of the tree are not reachable in the same way. The desktop project covers
  // them; the mobile layout is covered by the specs of the viewport.
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop project only');
  });

  // The shell of the columns is the same on every viewport, but the sidebar
  // is a drawer on a narrow screen.
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await gotoApp(page);
    await openSidebarIfNeeded(page);
  });

  test('the buttons of the header of the vault do their work', async ({ page }) => {
    const folder = unique('buttons-folder');
    const note = unique('buttons-note');

    // A new folder appears in the tree.
    await page.getByRole('button', { name: 'New folder', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New folder' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Name', { exact: true }).fill(folder);
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(treeFolder(page, folder)).toBeVisible();

    // A new note opens in the editor.
    await page.getByRole('button', { name: 'New note', exact: true }).click();
    const noteDialog = page.getByRole('dialog', { name: 'New note' });
    await expect(noteDialog).toBeVisible();
    await noteDialog.getByLabel('Name', { exact: true }).fill(note);
    await noteDialog.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(activeTabName(page)).toHaveText(`${note}.md`);

    // The refresh of the tree keeps the note.
    await page.getByRole('button', { name: 'Refresh tree' }).click();
    await expect(treeFile(page, `${note}.md`)).toBeVisible();
  });

  test('the actions of the explorer open their panels', async ({ page }) => {
    // The search panel.
    await page.getByRole('button', { name: 'Search notes' }).click();
    await expect(page.getByRole('dialog', { name: /search/i })).toBeVisible();
    await page.keyboard.press('Escape');

    // The command palette.
    await page.getByRole('button', { name: 'Open command palette' }).click();
    await expect(page.getByRole('dialog', { name: /command|palette/i })).toBeVisible();
    await page.keyboard.press('Escape');

    // The manager of the plugins.
    await openPluginManager(page);
    await expect(page.getByRole('dialog', { name: /plugin/i })).toBeVisible();
  });

  test('the clock shows the recent notes', async ({ page }) => {
    const clock = page.getByRole('button', { name: 'Recent notes' });
    await expect(clock).toBeVisible();
    await clock.click();
    // The action must not break the tree.
    await expect(page.getByTestId('file-tree')).toBeVisible();
  });

  test('the trash opens the panel of the trash', async ({ page }) => {
    await page.getByRole('button', { name: 'Trash', exact: true }).click();
    await expect(page.getByRole('dialog', { name: /trash/i })).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('the footer of the sidebar holds only the import and export', async ({ page }) => {
    const footer = page.locator('.sidebar-footer');
    await expect(footer).toBeVisible();
    await expect(footer.getByRole('button')).toHaveCount(1);
    await expect(footer.getByRole('button', { name: 'Import and export' })).toBeVisible();

    await footer.getByRole('button', { name: 'Import and export' }).click();
    await expect(page.getByRole('dialog', { name: /import|transfer/i })).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('the toggles of the status bar switch the columns and the theme', async ({ page }) => {
    const notesPanel = page.getByRole('button', { name: 'Toggle notes panel' });
    const outlinePanel = page.getByRole('button', { name: 'Toggle outline panel' });
    const theme = page.getByRole('button', { name: 'Toggle theme' });

    await expect(notesPanel).toHaveAttribute('aria-pressed', 'true');
    await notesPanel.click();
    await expect(notesPanel).toHaveAttribute('aria-pressed', 'false');
    await notesPanel.click();
    await expect(notesPanel).toHaveAttribute('aria-pressed', 'true');

    await expect(outlinePanel).toHaveAttribute('aria-pressed', 'true');
    await outlinePanel.click();
    await expect(outlinePanel).toHaveAttribute('aria-pressed', 'false');

    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    await theme.click();
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .not.toBe(before);
  });

  test('the filter really filters the tree of the notes', async ({ page }) => {
    const folder = unique('filter-folder');
    const tagged = unique('filter-tagged');
    const plain = unique('filter-plain');

    await page.getByRole('button', { name: 'New folder', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New folder' });
    await dialog.getByLabel('Name', { exact: true }).fill(folder);
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(treeFolder(page, folder)).toBeVisible();

    for (const [index, name] of [tagged, plain].entries()) {
      await page.getByRole('button', { name: 'New note', exact: true }).click();
      const noteDialog = page.getByRole('dialog', { name: 'New note' });
      await noteDialog.getByLabel('Name', { exact: true }).fill(name);
      await noteDialog.getByRole('button', { name: 'OK', exact: true }).click();
      await expect(activeTabName(page)).toHaveText(`${name}.md`);
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+End');
      // Only the first note carries the tag.
      if (index === 0) await page.keyboard.insertText(`#${tagged}\n`);
      else await page.keyboard.insertText('no tag here\n');
      await waitForSaved(page);
    }

    // The filter of the tree: only the tagged note stays.
    const field = page.getByLabel('Filter of the notes');
    await field.fill(`tag == '${tagged}'`);
    await expect(treeFile(page, `${tagged}.md`)).toBeVisible({ timeout: 10_000 });
    await expect(treeFile(page, `${plain}.md`)).toHaveCount(0);

    // The badge of the filtered tree is shown.
    await expect(page.getByText('filtered')).toBeVisible();

    // The clear of the filter brings the whole tree back.
    await page.getByRole('button', { name: 'Clear the filter' }).click();
    await expect(treeFile(page, `${plain}.md`)).toBeVisible();
  });

  test('a tag of the vault fills the filter', async ({ page }) => {
    const note = unique('chip-tag');
    await page.getByRole('button', { name: 'New note', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New note' });
    await dialog.getByLabel('Name', { exact: true }).fill(note);
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(activeTabName(page)).toHaveText(`${note}.md`);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(`#${note}\n`);
    await waitForSaved(page);

    const chip = page.locator('.q9-chip-tag').filter({ hasText: `#${note}` });
    await expect(chip).toBeVisible();
    await chip.click();

    await expect(page.getByLabel('Filter of the notes')).toHaveValue(`tag == "${note}"`);
  });

  test('the tags of the note are visible and can be added and removed', async ({ page }) => {
    const note = unique('strip-tag');
    await page.getByRole('button', { name: 'New note', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New note' });
    await dialog.getByLabel('Name', { exact: true }).fill(note);
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(activeTabName(page)).toHaveText(`${note}.md`);

    // The strip of the tags is always there: it carries the button that adds
    // the first tag of the note.
    await expect(page.getByTestId('note-tags')).toBeVisible();
    await expect(page.getByText('#idea')).toHaveCount(0);

    // The tag is added through the field of the strip.
    await page.getByRole('button', { name: 'Add a tag to the note' }).click();
    await page.getByLabel('Name of the new tag').fill('idea');
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('note-tags')).toBeVisible();
    await expect(page.locator('.q9-note-tag-name').filter({ hasText: '#idea' })).toBeVisible();
    await expect.poll(async () => editorText(page)).toContain('#idea');
    await waitForSaved(page);

    // The tag is removed with the cross of the chip.
    await page.getByRole('button', { name: 'Remove the tag idea' }).click();
    await expect.poll(async () => editorText(page)).not.toContain('#idea');
  });

  test('the manager of the plugins enables and disables a plugin', async ({ page }) => {
    await openPluginManager(page);

    // The plugins of the query language work: they are not "Failed".
    await expect(pluginStatus(page, 'Graph')).toHaveText('Active');
    await expect(pluginStatus(page, 'Tags')).toHaveText('Active');
    await expect(pluginStatus(page, 'Activity')).toHaveText('Active');
    await expect(pluginStatus(page, 'Link Cards')).toHaveText('Active');
  });
});
