/**
 * Helpers for the plugin platform end-to-end tests.
 *
 * The plugin state (which plugin is enabled) lives in the IndexedDB database
 * `noto-plugins` (`frontend/src/core/settings/settingsStore.ts`) and therefore
 * survives a reload. The helpers below reset that state explicitly before every
 * test so that the tests do not depend on each other.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { escapeRegExp, fileRow, folderRow, hoverRow, treeFile } from './app';

/* ------------------------------------------------------------------- panel */

/** The "Plugins" button in the sidebar (below the tree). */
export function pluginsButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Plugins', exact: true });
}

/** The modal dialog with the plugin manager. */
export function pluginsDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Plugins' });
}

/** One entry of the plugin list inside the manager panel. */
export function pluginRow(page: Page, name: string): Locator {
  return page
    .locator('li.noto-plugin-list-item')
    .filter({ has: page.locator('.noto-plugin-name', { hasText: new RegExp(`^${escapeRegExp(name)}$`) }) });
}

/** The status badge of a plugin ("Active", "Disabled", ...). */
export function pluginStatus(page: Page, name: string): Locator {
  return pluginRow(page, name).locator('.noto-plugin-status');
}

/** The version of a plugin. */
export function pluginVersion(page: Page, name: string): Locator {
  return pluginRow(page, name).locator('.noto-plugin-version');
}

/** Opens the plugin manager and waits until the list is rendered. */
export async function openPluginManager(page: Page): Promise<void> {
  await pluginsButton(page).click();
  await expect(pluginsDialog(page)).toBeVisible();
  await expect(pluginsDialog(page).locator('li.noto-plugin-list-item').first()).toBeVisible();
}

/** Closes the plugin manager dialog. */
export async function closePluginManager(page: Page): Promise<void> {
  await pluginsDialog(page).getByRole('button', { name: 'Close dialog' }).click();
  await expect(pluginsDialog(page)).toHaveCount(0);
}

/** Enables a plugin through the manager panel and waits for the "Active" state. */
export async function enablePlugin(page: Page, name: string): Promise<void> {
  await pluginsDialog(page)
    .getByRole('button', { name: `Enable the plugin ${name}` })
    .click();
  await expect(pluginStatus(page, name)).toHaveAttribute('data-plugin-status', 'active');
}

/** Disables a plugin through the manager panel and waits for the "Disabled" state. */
export async function disablePlugin(page: Page, name: string): Promise<void> {
  await pluginsDialog(page)
    .getByRole('button', { name: `Disable the plugin ${name}` })
    .click();
  await expect(pluginStatus(page, name)).toHaveAttribute('data-plugin-status', 'disabled');
}

/** A command contributed by a plugin (rendered inside the manager dialog). */
export function pluginCommand(page: Page, title: string): Locator {
  return pluginsDialog(page).getByRole('button', { name: title, exact: true });
}

/* ------------------------------------------------------------------ panels */

/** The counter panel of the "Word Count" plugin. */
export function wordCountPanel(page: Page): Locator {
  return page.locator('[data-plugin="word-count"]');
}

/**
 * Activates a tab of the plugin panel area.
 *
 * The panels of the plugins are rendered as tabs ("Plugin panels"), so only the
 * selected panel is in the DOM. The helper switches to the requested tab and
 * waits until it is rendered.
 */
export async function selectPluginPanel(page: Page, title: string): Promise<void> {
  const tablist = page.getByRole('region', { name: 'Plugin panels' });
  await tablist.getByRole('tab', { name: title, exact: true }).click();
  await expect(tablist.getByRole('tab', { name: title, exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
}

/** The word counter inside the panel. */
export function wordCountWords(page: Page): Locator {
  return page.locator('.noto-word-count-words');
}

/** The character counter inside the panel. */
export function wordCountChars(page: Page): Locator {
  return page.locator('.noto-word-count-chars');
}

/* ------------------------------------------------------------------ reset */

/**
 * Writes the enabled/disabled state of the plugins into the IndexedDB database
 * `noto-plugins` and reloads the page, so that the application starts from a
 * known state.
 *
 * The state is stored in the `meta` object store under the key
 * `enabled-states` (`SettingsStore.setEnabledStates`). Writing the record
 * directly is used instead of `indexedDB.deleteDatabase()`: the application
 * keeps the database open (the connection is opened during the start-up), so
 * the delete request would stay blocked forever and would delete the freshly
 * written state as soon as the old connection is closed.
 */
export async function resetPluginStates(
  page: Page,
  states: Record<string, boolean>,
): Promise<void> {
  await page.evaluate(async (desired: Record<string, boolean>) => {
    const DB_NAME = 'noto-plugins';
    const open = (): Promise<IDBDatabase> =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('settings')) {
            db.createObjectStore('settings', { keyPath: 'key' });
          }
          if (!db.objectStoreNames.contains('meta')) {
            db.createObjectStore('meta', { keyPath: 'key' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put({ key: 'enabled-states', value: desired });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  }, states);

  await page.reload();
}

/* ---------------------------------------------------------------- cleanup */

/** Deletes a note from the tree (the note ends up in the trash). */
export async function deleteNote(page: Page, note: string): Promise<void> {
  const row = fileRow(page, note);
  if ((await row.count()) === 0) return;
  await hoverRow(page, row);
  await page.getByRole('button', { name: `Delete ${note}` }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(treeFile(page, note)).toHaveCount(0);
}

/** Deletes a folder from the tree (the folder ends up in the trash). */
export async function deleteFolder(page: Page, folder: string): Promise<void> {
  const row = folderRow(page, folder);
  if ((await row.count()) === 0) return;
  await hoverRow(page, row);
  await page.getByRole('button', { name: `Delete ${folder}` }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('.tree-name').filter({ hasText: new RegExp(`^${escapeRegExp(folder)}$`) })).toHaveCount(0);
}
