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

    // The interface shows the editor only: the preview is not a part of it any
    // more (the safe renderer of the Markdown stays in the repository and is
    // covered by the unit tests).
    await expect(page.getByTestId('preview')).toHaveCount(0);

    // Autosave (800 ms debounce) reports "Saved".
    await waitForSaved(page);

    // Reload: the app comes back without the note selected.
    await page.reload();
    await expect(page.getByTestId('empty-state')).toBeVisible();

    // Re-open the note: the saved content is restored from the server.
    await expandFolder(page, folder);
    await treeFile(page, note).click();
    await expect(activeTabName(page)).toHaveText(note);
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

    // Count the write requests from now on. The query of the language is a
    // read (it is a POST, but it changes nothing), so only the endpoints that
    // write are counted here.
    const writes: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url()).pathname;
      if (url.startsWith('/api/query')) return;
      if (request.method() === 'PUT' || request.method() === 'POST') {
        writes.push(`${request.method()} ${url}`);
      }
    });

    // Re-open the already saved note without touching it.
    await page.reload();
    await expect(page.getByTestId('empty-state')).toBeVisible();
    await expandFolder(page, folder);
    await treeFile(page, note).click();
    await expect(activeTabName(page)).toHaveText(note);

    // Give the (spurious) autosave time to fire.
    await page.waitForTimeout(2000);

    expect(writes).toEqual([]);
  });

  test('the injected script of a note never reaches the document', async ({ page }) => {
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

    // The editor shows the source as text: no script element and no event
    // handler ever reach the interface. (The safe renderer of the Markdown is
    // covered by the unit tests of the component.)
    const dangerous = await page.evaluate(() => {
      const app = document.querySelector('.app') ?? document.body;
      return {
        scripts: app.querySelectorAll('script').length,
        handlers: Array.from(app.querySelectorAll('*')).flatMap((element) =>
          Array.from(element.attributes)
            .filter((attr) => attr.name.toLowerCase().startsWith('on'))
            .map((attr) => `${element.tagName.toLowerCase()}@${attr.name}`),
        ),
      };
    });
    expect(dangerous.scripts).toBe(0);
    expect(dangerous.handlers).toEqual([]);

    // Nothing executed: give the asynchronous <img> error handler a chance to fire.
    await page.waitForTimeout(1500);
    const injected = await page.evaluate(() => (window as unknown as { __x?: number }).__x);
    expect(injected).toBeUndefined();
  });
});
