/**
 * Regression spec for the CSRF / CORS origin check of the backend.
 *
 * This spec was written because of a bug that the suite found: `originCheck` in
 * `backend/internal/api/middleware.go` rejected every state changing request whose
 * `Origin` header was not contained in `NOTO_ALLOWED_ORIGINS`. The server's *own*
 * origin was not part of that list, so a same origin request coming from the SPA
 * (the browser always sends an `Origin` header for POST/PUT/PATCH/DELETE) was answered
 * with `403 {"error":{"code":"forbidden","message":"the origin is not allowed"}}`.
 * The application was therefore unable to create folders/notes, to autosave, to rename,
 * to move, to import or to delete anything.
 *
 * CONTRACT.md section 5 only asks for *foreign* origins to be rejected, so the server's
 * own origin has to be accepted. The backend now does this (`sameOrigin()` in
 * middleware.go) and this spec guards the fix.
 *
 * The spec starts a second backend instance with the *default* configuration
 * (no NOTO_ALLOWED_ORIGINS) and asserts that a same origin write succeeds.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const REPO_ROOT = path.join(__dirname, '..', '..');
const GO_BIN = path.join(REPO_ROOT, '.tools', 'goroot', 'go', 'bin', 'go.exe');
const PORT = 8098;
const ORIGIN = `http://127.0.0.1:${PORT}`;

async function waitForHealth(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`the server at ${url} did not become healthy`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

test.describe('origin check', () => {
  test('a same origin write is accepted by the default configuration', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop project only');
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noto-e2e-origin-'));
    const env = { ...process.env };
    delete env.NOTO_ALLOWED_ORIGINS;

    const server = spawn(GO_BIN, ['run', './cmd/noto'], {
      cwd: path.join(REPO_ROOT, 'backend'),
      env: {
        ...env,
        NOTO_ADDR: `127.0.0.1:${PORT}`,
        NOTO_DATA_DIR: dataDir,
        NOTO_ALLOW_PUBLIC: 'false',
      },
      stdio: 'ignore',
      windowsHide: true,
    });

    try {
      await waitForHealth(ORIGIN);

      await page.goto(`${ORIGIN}/`);
      const result = await page.evaluate(async (origin) => {
        const res = await fetch(`${origin}/api/folders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parentPath: '', name: 'same-origin' }),
        });
        return { status: res.status, body: await res.text() };
      }, ORIGIN);

      expect(result.status).toBe(200);
      expect(JSON.parse(result.body).name).toBe('same-origin');
    } finally {
      // Kill the whole process tree (go run spawns the real server as a child).
      spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], {
        shell: true,
        windowsHide: true,
      });
    }
  });
});
