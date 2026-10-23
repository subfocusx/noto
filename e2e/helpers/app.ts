/** Shared helpers for the Noto end-to-end tests. */
import { expect, type Locator, type Page } from '@playwright/test';

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The folder label in the sidebar tree. */
export function treeFolder(page: Page, name: string): Locator {
  return page.locator('.tree-name').filter({ hasText: new RegExp(`^${escapeRegExp(name)}$`) });
}

/** The note button in the sidebar tree. */
export function treeFile(page: Page, name: string): Locator {
  return page
    .locator('button.tree-file-button')
    .filter({ hasText: new RegExp(`^${escapeRegExp(name)}$`) });
}

/** The row of a folder in the sidebar tree. */
export function folderRow(page: Page, name: string): Locator {
  return page.locator('.tree-row').filter({ has: treeFolder(page, name) });
}

/** The row of a note in the sidebar tree. */
export function fileRow(page: Page, name: string): Locator {
  return page.locator('.tree-row').filter({ has: treeFile(page, name) });
}

/**
 * The list item of a folder, including its (expanded) children.
 * `.last()` selects the innermost match when folders are nested.
 */
export function folderItem(page: Page, name: string): Locator {
  return page.locator('li.tree-folder').filter({ has: treeFolder(page, name) }).last();
}

/**
 * The per row action buttons (new note / rename / move / delete) are hidden with
 * `display: none` until the row is hovered (frontend/src/styles.css:323-331), so the
 * row has to be hovered before the button inside it can be clicked.
 */
export async function hoverRow(page: Page, row: Locator): Promise<void> {
  await row.hover();
  await expect(row.locator('.tree-actions')).toBeVisible();
}

/** Opens the application and waits for the tree to be rendered. */
export async function gotoApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.app-title')).toBeVisible();
  await expect(page.getByTestId('file-tree')).toBeVisible();
  await expect(page.getByTestId('empty-state')).toBeVisible();
}

/** The autosave status indicator in the header. */
export function saveStatus(page: Page): Locator {
  return page.getByTestId('save-status');
}

/** Waits until the autosave has settled on "Saved". */
export async function waitForSaved(page: Page): Promise<void> {
  await expect(saveStatus(page)).toHaveText('Saved', { timeout: 15_000 });
}

/** Creates a folder in the sidebar and waits until it shows up in the tree. */
export async function createFolder(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'New folder', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New folder' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(treeFolder(page, name)).toBeVisible();
}

/** Creates a note inside `folder` and waits until it is opened in the editor. */
export async function createNote(page: Page, folder: string, name: string): Promise<void> {
  await hoverRow(page, folderRow(page, folder));
  await page.getByRole('button', { name: `New note in ${folder}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New note' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.locator('.app-title')).toHaveText(name);
}

/** Clicks the "Rename" action of a tree row. */
export async function clickRename(page: Page, row: Locator, name: string): Promise<void> {
  await hoverRow(page, row);
  await page.getByRole('button', { name: `Rename ${name}`, exact: true }).click();
}

/** Clicks the "Move" action of a tree row. */
export async function clickMove(page: Page, row: Locator, name: string): Promise<void> {
  await hoverRow(page, row);
  await page.getByRole('button', { name: `Move ${name}`, exact: true }).click();
}

/** Expands a folder in the sidebar so that its children become visible. */
export async function expandFolder(page: Page, name: string): Promise<void> {
  const toggle = page.getByRole('button', { name: `Expand ${name}`, exact: true });
  if ((await toggle.count()) > 0) {
    await toggle.click();
    await expect(page.getByRole('button', { name: `Collapse ${name}`, exact: true })).toBeVisible();
  }
}

/** The text currently held by the CodeMirror editor. */
export async function editorText(page: Page): Promise<string> {
  return (await page.locator('.cm-content').innerText()).replace(/\u00a0/g, ' ');
}

/** Types text into the CodeMirror editor (always at the end of the document). */
export async function typeInEditor(page: Page, text: string): Promise<void> {
  await page.locator('.cm-content').click();
  // The click lands somewhere in the middle of the text, so move the cursor to the
  // end of the document before inserting.
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText(text);
}

/** The path of the note that is currently open (shown in the footer). */
export function currentPath(page: Page): Locator {
  return page.locator('.app-footer .muted');
}
