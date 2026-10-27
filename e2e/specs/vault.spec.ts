import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gotoApp, openSidebarIfNeeded } from '../helpers/app';

/**
 * The second server of the test run: it does not fix the storage, so the
 * change of the storage can be tested against it.
 */
const SWITCH_URL = 'http://127.0.0.1:8098';

/**
 * The storage of the notes: the status endpoint, the picker and the limits of
 * the runs whose storage is fixed by the environment.
 */
test.describe('the storage of the notes', () => {
  test('the status of the storage is reported', async ({ request }) => {
    const res = await request.get('/api/vault');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      configured?: boolean;
      path?: string;
      notesDir?: string;
      fixed?: boolean;
    };
    expect(typeof body.configured).toBe('boolean');
    expect(typeof body.path).toBe('string');
    expect(typeof body.notesDir).toBe('string');
    expect(typeof body.fixed).toBe('boolean');
  });

  test('the listing of the directories only returns the visible ones', async ({ request }) => {
    const res = await request.get('/api/vault/browse');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { path?: string; dirs?: { name: string }[] };
    expect(typeof body.path).toBe('string');
    for (const dir of body.dirs ?? []) {
      expect(dir.name.startsWith('.')).toBe(false);
    }
  });

  test('a directory that does not exist is refused', async ({ request }) => {
    const res = await request.get(
      `/api/vault/browse?path=${encodeURIComponent('Z:\\no-such-directory-42')}`,
    );
    expect(res.status()).toBe(400);
  });

  test('the storage of the test run is fixed by the environment', async ({ request }) => {
    // The end-to-end suite runs with NOTO_VAULT_FIXED, so the storage cannot
    // be changed at runtime: the server has to refuse it clearly.
    const res = await request.post('/api/vault', { data: { path: 'C:\\Windows' } });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe('vault_fixed');
    expect(body.error?.message ?? '').toContain('fixed by the environment');
  });

  test('a fixed storage is a normal state and not a banner', async ({ page }) => {
    await gotoApp(page);
    await openSidebarIfNeeded(page);

    // The button of the storage stays, but it cannot change anything.
    const change = page.getByRole('button', { name: /change the storage of the notes/i });
    await expect(change).toBeVisible();
    await expect(change).toHaveAttribute('aria-disabled', 'true');

    // There is no banner with the message of the error.
    await expect(page.locator('.error-banner')).toHaveCount(0);
  });
});

/**
 * The real change of the storage.
 *
 * The test runs against the second server of the test run, which does not fix
 * the storage. The whole cycle of the notes is checked there: read, write,
 * rename, move, duplicate, delete and restore.
 */
test.describe('the change of the storage', () => {
  test('the picker of the folder can be opened', async ({ page, request }) => {
    // A storage is chosen first, so the application does not ask for a folder
    // at the start and the button of the column can be tested on its own.
    const vault = path.join(os.tmpdir(), `noto-e2e-picker-${Date.now().toString(36)}`);
    fs.mkdirSync(vault, { recursive: true });
    const set = await request.post(`${SWITCH_URL}/api/vault`, { data: { path: vault } });
    expect(set.status()).toBe(200);

    await page.goto(SWITCH_URL);
    await expect(page.getByTestId('file-tree')).toBeVisible();

    await openSidebarIfNeeded(page);
    const change = page.getByRole('button', { name: /change the storage of the notes/i });
    await expect(change).toBeVisible();
    await change.click();

    // The quick menu of the storage opens first: the picker of the folders is
    // one of its entries.
    const menu = page.getByRole('menu', { name: 'Switch the storage of the notes' });
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Choose another folder…' }).click();

    const picker = page.getByRole('dialog', { name: 'Choose the storage of the notes' });
    await expect(picker).toBeVisible();
    await expect(picker.getByLabel('Path of the folder')).toBeVisible();
    await expect(picker.getByRole('button', { name: 'Use this folder' })).toBeVisible();
  });

  test('the notes of the chosen folder can be read, written, renamed, moved, duplicated and restored', async ({
    request,
  }) => {
    const folder = `noto-e2e-vault-${Date.now().toString(36)}`;
    const vault = path.join(os.tmpdir(), folder);
    fs.mkdirSync(vault, { recursive: true });

    // The storage is chosen.
    const set = await request.post(`${SWITCH_URL}/api/vault`, { data: { path: vault } });
    expect(set.status()).toBe(200);

    const status = await request.get(`${SWITCH_URL}/api/vault`);
    const body = (await status.json()) as { path?: string; fixed?: boolean };
    expect(body.fixed).toBe(false);
    expect((body.path ?? '').toLowerCase()).toContain(folder.toLowerCase());

    // A note is written into the chosen folder.
    const created = await request.post(`${SWITCH_URL}/api/files`, {
      data: { parentPath: '', name: 'cycle.md' },
    });
    expect(created.status()).toBe(200);

    const written = await request.put(`${SWITCH_URL}/api/notes`, {
      data: { path: 'cycle.md', content: '# Cycle\n\nbody', revision: 0 },
    });
    expect(written.status()).toBe(200);

    // The note is read back.
    const read = await request.get(`${SWITCH_URL}/api/notes?path=${encodeURIComponent('cycle.md')}`);
    expect(read.status()).toBe(200);
    const note = (await read.json()) as { content?: string };
    expect(note.content).toContain('# Cycle');

    // The tree of the new storage shows the note and the counters.
    const tree = await request.get(`${SWITCH_URL}/api/tree`);
    const listing = (await tree.json()) as {
      files?: { path: string }[];
      noteTotal?: number;
      folderTotal?: number;
    };
    expect((listing.files ?? []).some((file) => file.path === 'cycle.md')).toBe(true);
    expect(listing.noteTotal).toBeGreaterThanOrEqual(1);
    expect(typeof listing.folderTotal).toBe('number');

    // The note is renamed.
    const renamed = await request.post(`${SWITCH_URL}/api/notes/rename`, {
      data: { path: 'cycle.md', newName: 'renamed.md' },
    });
    expect(renamed.status()).toBe(200);

    // The note is moved into a folder.
    const folderCreated = await request.post(`${SWITCH_URL}/api/folders`, {
      data: { parentPath: '', name: 'box' },
    });
    expect(folderCreated.status()).toBe(200);

    const moved = await request.post(`${SWITCH_URL}/api/notes/move`, {
      data: { path: 'renamed.md', newParentPath: 'box' },
    });
    expect(moved.status()).toBe(200);

    // The note is duplicated next to the original.
    const duplicated = await request.post(`${SWITCH_URL}/api/notes/duplicate`, {
      data: { path: 'box/renamed.md' },
    });
    expect(duplicated.status()).toBe(200);
    const copy = (await duplicated.json()) as { path?: string };
    expect(copy.path).toBe('box/renamed copy.md');

    const copyRead = await request.get(
      `${SWITCH_URL}/api/notes?path=${encodeURIComponent('box/renamed copy.md')}`,
    );
    const copyNote = (await copyRead.json()) as { content?: string };
    expect(copyNote.content).toContain('# Cycle');

    // The copy of a copy gets a number.
    const duplicatedAgain = await request.post(`${SWITCH_URL}/api/notes/duplicate`, {
      data: { path: 'box/renamed copy.md' },
    });
    expect(duplicatedAgain.status()).toBe(200);
    const second = (await duplicatedAgain.json()) as { path?: string };
    expect(second.path).toBe('box/renamed copy 2.md');

    // The note is deleted and lands in the trash.
    const deleted = await request.delete(
      `${SWITCH_URL}/api/notes?path=${encodeURIComponent('box/renamed.md')}`,
    );
    expect(deleted.status()).toBe(200);

    const trash = await request.get(`${SWITCH_URL}/api/trash`);
    const entries = (await trash.json()) as { entries?: { path?: string }[] };
    const trashed = entries.entries ?? [];
    expect(trashed.length).toBeGreaterThan(0);

    // The note is restored from the trash.
    const restored = await request.post(`${SWITCH_URL}/api/notes/restore`, {
      data: { trashPath: trashed[0]!.path },
    });
    expect(restored.status()).toBe(200);

    // The storage returns to the default layout, so the next run starts clean.
    const reset = await request.delete(`${SWITCH_URL}/api/vault`);
    expect(reset.status()).toBe(200);
  });
});
