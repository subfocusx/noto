import { expect, test } from '@playwright/test';
import {
  createFolder,
  createNote,
  editorText,
  expandFolder,
  gotoApp,
  treeFile,
  typeInEditor,
  waitForSaved,
} from '../helpers/app';

const MARKDOWN = [
  '# E2E Заголовок',
  '',
  'Это тестовая заметка с кириллицей и словом quokka.',
  '',
  'Second paragraph with the token narwhal.',
].join('\n');

test.describe('editor', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop project only');
  });

  test('markdown is autosaved and survives a reload', async ({ page }) => {
    await gotoApp(page);

    const folder = 'E2E Editor Folder';
    const note = 'editor-note.md';

    await createFolder(page, folder);
    await createNote(page, folder, note);

    await typeInEditor(page, MARKDOWN);

    // The preview renders the markdown while it is typed.
    const preview = page.getByTestId('preview');
    await expect(preview.locator('h1')).toHaveText('E2E Заголовок');
    await expect(preview).toContainText('Это тестовая заметка с кириллицей');

    // Autosave (800 ms debounce) reports "Saved".
    await waitForSaved(page);

    // Reload: the app comes back without the note selected.
    await page.reload();
    await expect(page.getByTestId('empty-state')).toBeVisible();

    // Re-open the note: the saved content is restored from the server.
    await expandFolder(page, folder);
    await treeFile(page, note).click();
    await expect(page.locator('.app-title')).toHaveText(note);
    await expect(page.locator('.cm-content')).toContainText('E2E Заголовок');
    expect(await editorText(page)).toContain('Это тестовая заметка с кириллицей');
    expect(await editorText(page)).toContain('narwhal');

    // The restored note is in sync with the server copy.
    await expect(page.getByTestId('save-status')).toHaveText('Saved');
  });

  /**
   * APPLICATION BUG (frontend/src/components/Editor.tsx:112-118):
   * `update.transactions.some((tr) => tr.annotation(EXTERNAL))` is always false.
   * `AnnotationType.of(null)` stores the value `null` and
   * `Transaction.annotation(type)` returns that value, so the truthiness check in
   * `some()` never matches. The EXTERNAL annotation is therefore ignored and every
   * programmatic document replacement (opening or switching a note) is reported to
   * the application as a user edit. Consequences: the status indicator shows
   * "Unsaved changes" for a note that was not edited and the app issues a
   * redundant autosave (PUT /api/notes) for it.
   *
   * The fix is to annotate with a truthy value (`EXTERNAL.of(true)`) or to test
   * `tr.annotation(EXTERNAL) !== undefined`.
   */
  test('opening a note does not trigger a save request', async ({ page }) => {
    await gotoApp(page);

    const folder = 'E2E No Save Folder';
    const note = 'no-save-note.md';

    await createFolder(page, folder);
    await createNote(page, folder, note);
    await typeInEditor(page, 'Some content.\n');
    await waitForSaved(page);

    // Count the write requests from now on.
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'PUT' || request.method() === 'POST') {
        writes.push(`${request.method()} ${request.url()}`);
      }
    });

    // Re-open the already saved note without touching it.
    await page.reload();
    await expect(page.getByTestId('empty-state')).toBeVisible();
    await expandFolder(page, folder);
    await treeFile(page, note).click();
    await expect(page.locator('.app-title')).toHaveText(note);

    // Give the (spurious) autosave time to fire.
    await page.waitForTimeout(2000);

    expect(writes).toEqual([]);
  });

  test('the preview never executes injected script or event handlers', async ({ page }) => {
    await gotoApp(page);

    const folder = 'E2E XSS Folder';
    const note = 'xss-note.md';

    await createFolder(page, folder);
    await createNote(page, folder, note);

    await typeInEditor(page, MARKDOWN);
    await waitForSaved(page);

    // Inject the payloads into the note source.
    await typeInEditor(page, '\n<script>window.__x=1</script>\n');
    await typeInEditor(page, '<img src=x onerror="window.__x=1">\n');
    await waitForSaved(page);

    // The payload really is part of the note source.
    expect(await editorText(page)).toContain('window.__x=1');

    // Switch to preview only mode.
    await page.getByRole('group', { name: 'View mode' }).getByRole('button', { name: 'preview' }).click();

    const preview = page.getByTestId('preview');
    await expect(preview).toBeVisible();

    // No script element survives in the preview DOM.
    await expect(preview.locator('script')).toHaveCount(0);

    // No event handler attribute survives in the preview DOM.
    const handlerAttributes = await preview.evaluate((root) =>
      Array.from(root.querySelectorAll('*')).flatMap((el) =>
        Array.from(el.attributes)
          .filter((attr) => attr.name.toLowerCase().startsWith('on'))
          .map((attr) => `${el.tagName.toLowerCase()}@${attr.name}`),
      ),
    );
    expect(handlerAttributes).toEqual([]);

    // Nothing executed: give the asynchronous <img> error handler a chance to fire.
    await page.waitForTimeout(1500);
    const injected = await page.evaluate(() => (window as unknown as { __x?: number }).__x);
    expect(injected).toBeUndefined();
  });
});
