/**
 * End-to-end tests for the plugin platform.
 *
 * The tests drive the real application: the plugin manager is opened from the
 * sidebar, the built-in plugins are enabled/disabled through it and the
 * contributions of the plugins are observed in the editor.
 */
import { expect, test } from '@playwright/test';
import {
  activeTabName,
  createFolder,
  createNote,
  editorText,
  expandFolder,
  gotoApp,
  treeFile,
  typeInEditor,
  waitForSaved,
} from '../helpers/app';
import {
  closePluginManager,
  deleteFolder,
  deleteNote,
  disablePlugin,
  enablePlugin,
  openPluginManager,
  pluginCommand,
  pluginStatus,
  pluginVersion,
  resetPluginStates,
  selectPluginPanel,
  wordCountChars,
  wordCountPanel,
  wordCountWords,
} from '../helpers/plugins';

const WORD_COUNT = 'Word Count';
const INSERT_TEMPLATE = 'Insert Template';

/** A unique suffix so that every test works on its own note/folder. */
function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

test.describe('plugin platform', () => {
  // The plugin manager lives in the sidebar, which is a drawer below 820px.
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop project only');
  });

  /**
   * Every test starts from a known plugin state: the built-in plugins are
   * enabled. The state is reset explicitly (it is stored in IndexedDB and
   * would otherwise survive the reloads inside the tests).
   */
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await resetPluginStates(page, { 'word-count': true, 'insert-template': true, backlinks: true });
    await gotoApp(page);
  });

  test('the plugin manager lists the built-in plugins with their versions', async ({ page }) => {
    await openPluginManager(page);

    // All built-in plugins are listed...
    await expect(page.locator('li.noto-plugin-list-item')).toHaveCount(7);

    // ...with their version and their state.
    await expect(pluginVersion(page, WORD_COUNT)).toHaveText('1.0.0');
    await expect(pluginStatus(page, WORD_COUNT)).toHaveText('Active');
    await expect(pluginVersion(page, INSERT_TEMPLATE)).toHaveText('1.0.0');
    await expect(pluginStatus(page, INSERT_TEMPLATE)).toHaveText('Active');
    await expect(pluginVersion(page, 'Backlinks')).toHaveText('1.0.0');

    // The plugins of the query language (API 1.2.0) are listed as well.
    await expect(pluginVersion(page, 'Graph')).toHaveText('1.2.0');
    await expect(pluginVersion(page, 'Tags')).toHaveText('1.2.0');
    await expect(pluginVersion(page, 'Activity')).toHaveText('1.2.0');
    await expect(pluginVersion(page, 'Link Cards')).toHaveText('1.2.0');

    // The commands of the active plugins are listed in the same dialog.
    await expect(pluginCommand(page, 'Вставить шаблон')).toBeVisible();
    await expect(pluginCommand(page, 'Word Count: показать счётчик')).toBeVisible();
  });

  test('word count shows the number of words of the open note', async ({ page }) => {
    const folder = unique('e2e-plugin-folder');
    const note = `${unique('e2e-plugin')}.md`;

    await createFolder(page, folder);
    await createNote(page, folder, note);

    await typeInEditor(page, 'Привет мир');
    await waitForSaved(page);

    // The panel of the plugin is a tab of the panel area: switch to it first.
    await selectPluginPanel(page, WORD_COUNT);

    // The counter of the plugin reacts to the content of the note.
    await expect(wordCountWords(page)).toContainText('Слов: 2', { timeout: 15_000 });
    await expect(wordCountChars(page)).toContainText('Символов: 10');

    // The panel belongs to the plugin and is rendered only once.
    await expect(wordCountPanel(page)).toHaveCount(1);

    await deleteNote(page, note);
    await deleteFolder(page, folder);
  });

  test('disabling word count removes the counter, re-enabling shows it once again', async ({
    page,
  }) => {
    const folder = unique('e2e-plugin-folder');
    const note = `${unique('e2e-plugin')}.md`;

    await createFolder(page, folder);
    await createNote(page, folder, note);
    await typeInEditor(page, 'Привет мир');
    await waitForSaved(page);
    await selectPluginPanel(page, WORD_COUNT);
    await expect(wordCountWords(page)).toContainText('Слов: 2', { timeout: 15_000 });

    /* ------------------------------------------------------------- disable */
    await openPluginManager(page);
    await disablePlugin(page, WORD_COUNT);
    await closePluginManager(page);

    // The contribution of the plugin is gone.
    await expect(wordCountPanel(page)).toHaveCount(0);

    /* ------------------------------------------------------------- re-enable */
    await openPluginManager(page);
    await enablePlugin(page, WORD_COUNT);
    await closePluginManager(page);

    // The counter is back — and there is no second copy of it.
    await selectPluginPanel(page, WORD_COUNT);
    await expect(wordCountPanel(page)).toHaveCount(1);
    await expect(wordCountWords(page)).toHaveCount(1);
    await expect(wordCountWords(page)).toContainText('Слов: 2', { timeout: 15_000 });

    await deleteNote(page, note);
    await deleteFolder(page, folder);
  });

  test('insert template writes the template into the note and the autosave keeps it', async ({
    page,
  }) => {
    const folder = unique('e2e-plugin-folder');
    const note = `${unique('e2e-plugin')}.md`;

    await createFolder(page, folder);
    await createNote(page, folder, note);

    await typeInEditor(page, 'Первый абзац.\n');
    await waitForSaved(page);
    const before = await editorText(page);

    // The command of the plugin is executed through the plugin manager.
    await openPluginManager(page);
    await pluginCommand(page, 'Вставить шаблон').click();
    await closePluginManager(page);

    // The note really changed.
    await expect.poll(() => editorText(page), { timeout: 15_000 }).not.toBe(before);
    await expect(page.locator('.cm-content')).toContainText('# Новая заметка');
    await expect(page.locator('.cm-content')).toContainText('## Задачи');

    // The change was autosaved.
    await waitForSaved(page);

    // And it is still there after a reload.
    await page.reload();
    await expect(page.getByTestId('empty-state')).toBeVisible();
    await expandFolder(page, folder);
    await treeFile(page, note).click();
    await expect(activeTabName(page)).toHaveText(note);
    await expect(page.locator('.cm-content')).toContainText('# Новая заметка');
    await expect(page.getByTestId('save-status')).toHaveText('Saved');

    await deleteNote(page, note);
    await deleteFolder(page, folder);
  });

  test('the enabled state of a plugin survives a reload', async ({ page }) => {
    /* ------------------------------------------------------- disable + reload */
    await openPluginManager(page);
    await disablePlugin(page, INSERT_TEMPLATE);
    await closePluginManager(page);

    await page.reload();
    await openPluginManager(page);
    await expect(pluginStatus(page, INSERT_TEMPLATE)).toHaveText('Disabled');
    await expect(pluginStatus(page, WORD_COUNT)).toHaveText('Active');
    // The command of the disabled plugin is not offered any more.
    await expect(pluginCommand(page, 'Вставить шаблон')).toHaveCount(0);

    /* ------------------------------------------------------ enable + reload */
    await enablePlugin(page, INSERT_TEMPLATE);
    await closePluginManager(page);

    await page.reload();
    await openPluginManager(page);
    await expect(pluginStatus(page, INSERT_TEMPLATE)).toHaveText('Active');
    await expect(pluginCommand(page, 'Вставить шаблон')).toBeVisible();
  });

  test('the core scenarios keep working with the plugins enabled and disabled', async ({ page }) => {
    const folder = unique('e2e-plugin-folder');
    const note = `${unique('e2e-plugin')}.md`;
    const marker = unique('marker');

    await createFolder(page, folder);
    await createNote(page, folder, note);
    await typeInEditor(page, `Плагины не мешают: ${marker}.\n`);
    await waitForSaved(page);

    // The tree shows the note.
    await expect(treeFile(page, note)).toBeVisible();

    // The search finds it (Ctrl+Shift+F opens the search overlay).
    await page.keyboard.press('Control+Shift+F');
    const searchInput = page.getByLabel('Search query');
    await expect(searchInput).toBeVisible();
    await searchInput.fill(marker);
    const hit = page.getByTestId('search-results').locator('button.search-result').filter({ hasText: note });
    await expect(hit).toBeVisible({ timeout: 15_000 });
    await hit.click();
    await expect(activeTabName(page)).toHaveText(note);
    await expect(page.locator('.cm-content')).toContainText(marker);

    // A reload does not lose the content.
    await page.reload();
    await expect(page.getByTestId('empty-state')).toBeVisible();
    await expandFolder(page, folder);
    await treeFile(page, note).click();
    await expect(page.locator('.cm-content')).toContainText(marker);

    // The same again with all plugins disabled.
    await openPluginManager(page);
    await disablePlugin(page, WORD_COUNT);
    await disablePlugin(page, INSERT_TEMPLATE);
    await closePluginManager(page);

    const secondNote = `${unique('e2e-plugin')}.md`;
    await createNote(page, folder, secondNote);
    await typeInEditor(page, `Без плагинов: ${marker}.\n`);
    await waitForSaved(page);
    await expect(page.locator('.cm-content')).toContainText(marker);

    await page.reload();
    await expandFolder(page, folder);
    await treeFile(page, secondNote).click();
    await expect(page.locator('.cm-content')).toContainText(marker);

    await deleteNote(page, secondNote);
    await deleteNote(page, note);
    await deleteFolder(page, folder);
  });
});

test.describe('plugin platform on mobile', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'mobile project only');
  });

  test('the plugin manager opens on the narrow viewport', async ({ page }) => {
    await page.goto('/');
    await resetPluginStates(page, { 'word-count': true, 'insert-template': true });
    await gotoApp(page);

    // The sidebar is a drawer: it has to be opened first.
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
    await expect(page.locator('.app.drawer-open')).toHaveCount(1);

    await openPluginManager(page);
    await expect(pluginStatus(page, WORD_COUNT)).toHaveText('Active');
    await expect(pluginStatus(page, INSERT_TEMPLATE)).toHaveText('Active');
  });
});
