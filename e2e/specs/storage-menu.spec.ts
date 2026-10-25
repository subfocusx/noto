/**
 * End-to-end tests for the quick menu of the storage and for the lock of the
 * header.
 *
 * The menu hangs from the path of the storage in the header of the explorer: it
 * shows the storage that is open, the storages that were opened before and the
 * entry that opens the picker of the folders. The lock of the header depends on
 * the mode of the storage: an open storage has no key to forget, so the same
 * button opens the wizard of the encryption.
 */
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gotoApp, openSidebarIfNeeded } from '../helpers/app';

/**
 * The second server of the test run: it does not fix the storage, so the menu
 * of the storage can be opened against it.
 */
const SWITCH_URL = 'http://127.0.0.1:8098';

test.describe('the menu of the storage', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop project only');
  });

  test('the menu shows the storage that is open and the ones before it', async ({
    page,
    request,
  }) => {
    const stamp = Date.now().toString(36);
    const first = path.join(os.tmpdir(), `noto-e2e-recent-a-${stamp}`);
    const second = path.join(os.tmpdir(), `noto-e2e-recent-b-${stamp}`);
    fs.mkdirSync(first, { recursive: true });
    fs.mkdirSync(second, { recursive: true });

    // The second storage is the one that is open.
    const set = await request.post(`${SWITCH_URL}/api/vault`, { data: { path: second } });
    expect(set.status()).toBe(200);

    // The first one was used before: the preferences of the browser remember it.
    await page.addInitScript(
      ([a, b]: string[]) => {
        localStorage.setItem('noto-prefs-v1', JSON.stringify({ vaultRecents: [a, b] }));
      },
      [first, second],
    );

    await page.goto(SWITCH_URL);
    await expect(page.getByTestId('file-tree')).toBeVisible();
    await openSidebarIfNeeded(page);

    // The path of the storage is the trigger of the menu.
    await page.getByRole('button', { name: 'Change the storage of the notes' }).click();
    const menu = page.getByRole('menu', { name: 'Switch the storage of the notes' });
    await expect(menu).toBeVisible();

    // The storage that is open is shown at the top of the menu.
    await expect(menu.locator('.vault-menu-current-path')).toContainText(path.basename(second));

    // The storage that was used before is offered as an entry of the menu.
    await expect(menu.locator('.vault-menu-item-path').filter({ hasText: first })).toHaveCount(1);

    // And the picker of the folders is the last entry.
    await expect(menu.getByRole('menuitem', { name: 'Choose another folder…' })).toBeVisible();
  });

  test('the lock of the header of an open storage opens the wizard', async ({ page }) => {
    await gotoApp(page);
    await openSidebarIfNeeded(page);

    // The storage of the test run is open: the button of the lock offers the
    // encryption instead of pretending that it can lock what is not encrypted.
    const header = page.locator('.vault-header');
    const lock = header.getByRole('button', { name: 'Set up an encrypted storage' });
    await expect(lock).toBeVisible();
    await expect(header.getByRole('button', { name: 'Lock the vault' })).toHaveCount(0);

    await lock.click();

    // The wizard of the encrypted storage opens.
    const wizard = page.getByTestId('vault-setup');
    await expect(wizard).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Encrypted storage' })).toBeVisible();

    // And it can be closed again: the notes are still there.
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await expect(wizard).toHaveCount(0);
    await expect(page.getByTestId('file-tree')).toBeVisible();
  });
});
