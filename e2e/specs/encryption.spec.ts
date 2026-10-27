/**
 * The acceptance test of the encrypted storage of the notes.
 *
 * THE PROMISE
 * -----------
 * When the storage of the notes is sealed, the files of the vault on the disk
 * (and therefore the files that a cloud provider such as OneDrive or Google
 * Drive receives) hold nothing but ciphertext.
 *
 * The test proves it on the REAL files of a REAL vault: two notes with unique
 * markers are written in a temporary vault, the storage is sealed through the
 * user interface, and then every byte of every file of the vault (the notes,
 * the SQLite database, the sealed objects, the manifests, the keystore) is
 * searched for the markers of the plaintext. The expected result is ZERO
 * matches.
 *
 * The vault lives in the temporary directory of the system and is removed at
 * the end of the run: the repository is never touched.
 *
 * A dedicated server is started for this test (the port 8097): the migration
 * switches the server into the sealed mode for good, and the shared servers of
 * the test run must not be sealed by this test.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describeMatches, listFiles, scanDirectoryForMarkers } from '../helpers/vault-scan';
import { treeFile } from '../helpers/app';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BACKEND_DIR = path.join(REPO_ROOT, 'backend');
const GO_BIN = path.join(REPO_ROOT, '.tools', 'goroot', 'go', 'bin', 'go.exe');

/** The port of the dedicated server of this test. */
const PORT = 8097;
const BASE = `http://127.0.0.1:${PORT}`;

/** The master password of the encrypted storage of the test. */
const PASSWORD = 'the master password of the test vault 42';

/** The state that the tests of the file share. */
let server: ChildProcess | undefined;
let page: Page;
let vaultDir = '';
let markers: string[] = [];
let runDir = '';

/** A unique marker of the plaintext. */
function uniqueMarker(): string {
  return `NOTO-PLAINTEXT-MARKER-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}

/** Waits until the server of the test answers. */
async function waitForServer(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      /* the server is not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`the server of the encryption test did not answer on ${BASE}`);
}

/** Sends a JSON request to the server of the test. */
async function api(
  method: string,
  pathname: string,
  body?: unknown,
): Promise<{ status: number; text: string }> {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

/** Removes a directory and everything in it. */
function removeTree(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* the temporary directory of the system is cleaned by the system itself */
  }
}

/**
 * Waits for the end of the migration.
 *
 * The wizard either reports the verified copy (the button that removes the
 * plaintext appears) or reports a failure. The state of the dialog is put in
 * the message of the failure, so that a broken migration can be read.
 */
async function waitForMigrationResult(migration: Locator): Promise<void> {
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    if (await migration.getByTestId('vault-migration-purge').isVisible().catch(() => false)) return;
    const error = migration.getByTestId('vault-migration-error');
    if (await error.isVisible().catch(() => false)) {
      throw new Error(
        `the migration failed: ${(await error.innerText()).trim()}\n${(await migration.innerText()).trim()}`,
      );
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`the migration did not finish: ${(await migration.innerText()).trim()}`);
}

test.describe('the encrypted storage of the notes', () => {
  // The acceptance of the encrypted storage is driven through the layout of the
  // desktop: the narrow layout hides the storage behind a drawer.
  test.beforeAll(async ({ browser }, testInfo) => {
    // The narrow layout hides the storage behind a drawer: the acceptance of
    // the encrypted storage is driven on the desktop layout.
    test.skip(testInfo.project.name === 'mobile', 'the encrypted storage is accepted on the desktop layout');
    // The build of the server and the migration of the vault need more time
    // than a test.
    test.setTimeout(300_000);

    runDir = path.join(os.tmpdir(), 'noto-e2e-encryption');
    removeTree(runDir);
    fs.mkdirSync(runDir, { recursive: true });

    // The dedicated server of the test. The binary is built into the temporary
    // directory of the system, so that the repository stays clean.
    const exe = path.join(runDir, 'noto-encryption-test.exe');
    execFileSync(GO_BIN, ['build', '-o', exe, './cmd/noto'], {
      cwd: BACKEND_DIR,
      stdio: 'pipe',
    });

    const env = { ...process.env };
    delete env.NOTO_VAULT_FIXED;
    env.NOTO_ADDR = `127.0.0.1:${PORT}`;
    env.NOTO_DATA_DIR = path.join(runDir, 'data');
    env.NOTO_ALLOW_PUBLIC = 'false';

    server = spawn(exe, [], {
      cwd: BACKEND_DIR,
      env,
      stdio: 'pipe',
    });
    await waitForServer(180_000);

    // The vault of the test lives in the temporary directory of the system.
    vaultDir = path.join(runDir, 'vault');
    fs.mkdirSync(vaultDir, { recursive: true });

    // The application is pointed at the vault.
    const set = await api('POST', '/api/vault', { path: vaultDir });
    expect(set.status, `the vault could not be chosen: ${set.text}`).toBe(200);

    // The two notes of the test. The marker is in the title (the name of the
    // file) and in the body.
    markers = [uniqueMarker(), uniqueMarker()];
    for (const marker of markers) {
      const created = await api('POST', '/api/files', { parentPath: '', name: `${marker}.md` });
      expect(created.status, `the note ${marker} could not be created: ${created.text}`).toBe(200);
      const written = await api('PUT', '/api/notes', {
        path: `${marker}.md`,
        content: `# ${marker}\n\nThe body of the note holds the marker ${marker}.\n`,
        revision: 0,
      });
      expect(written.status, `the note ${marker} could not be written: ${written.text}`).toBe(200);
    }

    // The plaintext is really on the disk before the migration: the scanner is
    // checked against it, so that a silent scanner cannot make the test pass.
    const before = scanDirectoryForMarkers(vaultDir, markers);
    expect(
      before.matches.length,
      'the markers of the plaintext are not on the disk before the migration: ' +
        `the scanner found ${before.matches.length} matches in ${before.files} files`,
    ).toBeGreaterThan(0);

    page = await browser.newPage();

    /* ------------------------------------------- the migration, through the UI */
    await page.goto(BASE);
    await expect(page.getByTestId('file-tree')).toBeVisible();
    // The two notes of the test are in the tree of the open storage.
    for (const marker of markers) {
      await expect(treeFile(page, `${marker}.md`)).toBeVisible();
    }

    // The storage picker: the quick menu of the storage comes first.
    await page.getByRole('button', { name: /change the storage of the notes/i }).click();
    const menu = page.getByRole('menu', { name: 'Switch the storage of the notes' });
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Choose another folder…' }).click();

    const picker = page.getByRole('dialog', { name: 'Choose the storage of the notes' });
    await expect(picker).toBeVisible();
    await picker.getByRole('button', { name: 'Set up an encrypted storage' }).click();

    // The wizard of the encrypted storage: the branch that migrates the
    // existing storage.
    const setup = page.getByTestId('vault-setup');
    await expect(setup).toBeVisible();
    await setup.getByTestId('vault-setup-migrate').click();

    // The wizard of the migration: the master password and the start.
    const migration = page.getByTestId('vault-migration-dialog');
    await expect(migration).toBeVisible();
    await migration.getByLabel('Master password of the encrypted storage').fill(PASSWORD);
    await migration.getByLabel(/repeat/i).fill(PASSWORD);
    await migration.getByTestId('vault-migration-start').click();

    // The copy is verified, then the plaintext is removed after the explicit
    // confirmation of the user.
    await waitForMigrationResult(migration);
    await migration.getByTestId('vault-migration-purge').click();
    await expect(migration.getByTestId('vault-migration-purge-confirm')).toBeVisible();
    await migration.getByTestId('vault-migration-purge-confirm').click();
    await expect(migration.getByTestId('vault-migration-error')).toHaveCount(0, { timeout: 60_000 });
    await expect(migration.getByTestId('vault-migration-close')).toBeVisible({
      timeout: 60_000,
    });
    await migration.getByTestId('vault-migration-close').click();
  }, { timeout: 300_000 });

  test.afterAll(async () => {
    if (server) {
      server.kill();
      server = undefined;
    }
    removeTree(runDir);
  });

  test('the files of the sealed vault hold nothing but ciphertext', async () => {
    const scan = scanDirectoryForMarkers(vaultDir, markers);
    expect(
      scan.matches,
      `the storage of the notes leaks the plaintext (${scan.files} files were scanned):\n` +
        describeMatches(scan.matches),
    ).toEqual([]);
    // The scan must really have looked at something.
    expect(scan.files).toBeGreaterThan(0);
  });

  test('the sealed objects are on the disk and the plaintext notes are gone', async () => {
    const files = listFiles(vaultDir);

    // The sealed objects, the manifests and the keystore are really there.
    const objects = files.filter((file) => file.startsWith(path.join('.noto', 'objects')));
    expect(objects.length, `the sealed objects are missing: ${files.join(', ')}`).toBeGreaterThan(0);
    const manifests = files.filter((file) => file.startsWith(path.join('.noto', 'manifests')));
    expect(manifests.length, `the manifests are missing: ${files.join(', ')}`).toBeGreaterThan(0);
    expect(files).toContain(path.join('.noto', 'keystore.json'));

    // The plaintext notes are gone.
    const markdown = files.filter((file) => file.toLowerCase().endsWith('.md'));
    expect(
      markdown,
      `the plaintext notes are still on the disk: ${markdown.join(', ')}`,
    ).toEqual([]);
  });

  test('the storage is locked after a reload of the page', async () => {
    await page.reload();
    await expect(page.getByTestId('vault-unlock')).toBeVisible({ timeout: 30_000 });

    // The notes are not visible while the storage is locked.
    await expect(page.getByTestId('file-tree')).toHaveCount(0);
    for (const marker of markers) {
      await expect(page.locator(`text=${marker}`)).toHaveCount(0);
    }

    // The wrong password is refused with a friendly message.
    await page.getByRole('textbox', { name: 'Master password', exact: true }).fill('the wrong password of the test');
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByTestId('vault-unlock-error')).toHaveText('Wrong password or damaged storage.');
    await expect(page.getByTestId('vault-unlock')).toBeVisible();
  });

  test('the right password opens the notes again', async () => {
    await page.getByRole('textbox', { name: 'Master password', exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Unlock' }).click();

    await expect(page.getByTestId('file-tree')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('vault-unlock')).toHaveCount(0);

    // The note is there, with its content.
    const marker = markers[0]!;
    const note = treeFile(page, `${marker}.md`);
    await expect(note).toBeVisible({ timeout: 30_000 });
    await note.click();
    await expect(page.locator('.cm-content')).toContainText(marker, { timeout: 30_000 });
  });

  test('the lock of the header locks the encrypted storage', async () => {
    // The lock of the header is the way to lock the storage without opening
    // the menu of the settings.
    const lock = page.locator('.vault-header').getByRole('button', { name: 'Lock the vault' });
    await expect(lock).toBeVisible({ timeout: 30_000 });
    await lock.click();

    // The screen of the password opens, and the notes are not visible.
    await expect(page.getByTestId('vault-unlock')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('file-tree')).toHaveCount(0);

    // The password opens the storage again.
    await page.getByRole('textbox', { name: 'Master password', exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByTestId('file-tree')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('vault-unlock')).toHaveCount(0);
  });

  /**
   * The environment of the encrypted storage.
   *
   * The key derivation is a WebAssembly module: the browser only compiles it
   * when the Content Security Policy of the document allows it. The policy of
   * the server must therefore carry `wasm-unsafe-eval` in `script-src`.
   *
   * This test does not touch the storage: it only reads the policy that the
   * server sends.
   */
  test('the server allows the WebAssembly of the key derivation', async () => {
    const res = await fetch(`${BASE}/api/health`);
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(
      csp,
      'the Content Security Policy of the server does not allow the WebAssembly of the key ' +
        "derivation: 'wasm-unsafe-eval' is missing in the directive 'script-src'. The encrypted " +
        'storage cannot be used in the browser until the policy allows it.',
    ).toContain('wasm-unsafe-eval');
  });
});
