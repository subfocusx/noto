import { expect, test } from '@playwright/test';
import { gotoApp, openSidebarIfNeeded } from '../helpers/app';

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
    };
    expect(typeof body.configured).toBe('boolean');
    expect(typeof body.path).toBe('string');
    expect(typeof body.notesDir).toBe('string');
  });

  test('the picker of the folder can be opened from the left column', async ({ page }) => {
    await gotoApp(page);
    await openSidebarIfNeeded(page);

    await page.getByRole('button', { name: 'Change the storage of the notes' }).click();

    const picker = page.getByRole('dialog', { name: 'Choose the storage of the notes' });
    await expect(picker).toBeVisible();
    await expect(picker.getByLabel('Path of the folder')).toBeVisible();
    await expect(picker.getByRole('button', { name: 'Use this folder' })).toBeVisible();
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
    // The end-to-end suite runs with NOTO_DATA_DIR, so the storage cannot be
    // changed at runtime: the server has to refuse it clearly.
    const res = await request.post('/api/vault', { data: { path: 'C:\\Windows' } });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error?: { message?: string } };
    expect(body.error?.message ?? '').toContain('fixed by the environment');
  });
});
