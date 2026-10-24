/**
 * Playwright configuration for the Noto end-to-end tests.
 *
 * Server topology (documented choice)
 * ------------------------------------
 * `frontend/src/api/client.ts` uses a *relative* API base (`const API_BASE = '/api'`),
 * so the SPA and the API must be served from the same origin.
 * `frontend/vite.config.ts` defines no `/api` dev proxy and may not be edited by this
 * agent, therefore the Vite dev/preview server cannot be used for the API calls.
 * The Go backend already serves the built SPA (`backend/internal/web/dist`, filled by
 * `frontend/scripts/copy-dist.mjs`) with an SPA fallback, so the whole application is
 * driven through a single origin: http://127.0.0.1:8099
 *
 * The Chromium build shipped by Playwright's CDN is not reachable from this network
 * (403 "Access denied" from cdn.playwright.dev), but a matching Chromium 1248 build is
 * already present in the local Playwright cache. `channel: 'chromium'` selects that
 * full build instead of the (missing) headless-shell download.
 */
import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 8099;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * A second server, started without `NOTO_VAULT_FIXED`.
 *
 * The main server fixes the storage of the notes (the flag `NOTO_VAULT_FIXED`
 * is set), so the storage cannot be changed there. The test of the real
 * change of the storage needs a server that allows it, and it gets its own
 * port and its own data directory.
 */
const SWITCH_PORT = 8098;
const SWITCH_URL = `http://127.0.0.1:${SWITCH_PORT}`;

/**
 * Every run gets its own data directory so that repeated runs do not collide with
 * notes left over from a previous run (the backend rejects duplicate sibling names).
 */
const RUN_ID =
  process.env.NOTO_E2E_RUN_ID ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
process.env.NOTO_E2E_RUN_ID = RUN_ID;

const DATA_DIR = path.join(os.tmpdir(), 'noto-e2e', RUN_ID);
fs.mkdirSync(DATA_DIR, { recursive: true });

const GO_BIN = resolveGoBin();

/**
 * Returns the Go binary that starts the backend of the tests.
 *
 * On this machine the toolchain is vendored in `.tools/goroot`; on CI the
 * Go of the runner is used (`NOTO_GO_BIN` or the `go` of the PATH).
 */
function resolveGoBin(): string {
  const fromEnv = process.env.NOTO_GO_BIN;
  if (fromEnv) return fromEnv;
  const vendored = path.join(__dirname, '.tools', 'goroot', 'go', 'bin', 'go.exe');
  if (fs.existsSync(vendored)) return vendored;
  return process.platform === 'win32' ? 'go.exe' : 'go';
}

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['**/.artifacts/**', '**/playwright-report/**'],
  outputDir: './e2e/.artifacts',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: './e2e/playwright-report', open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    channel: 'chromium',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], channel: 'chromium', viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 5'], channel: 'chromium' },
    },
  ],
  webServer: [
    {
      // NOTE: this Playwright version only honours `command` for webServer and runs
      // it through a shell, so the arguments have to be part of the command string.
      command: `"${GO_BIN}" run ./cmd/noto`,
      cwd: path.join(__dirname, 'backend'),
      env: {
        NOTO_ADDR: `127.0.0.1:${PORT}`,
        NOTO_DATA_DIR: DATA_DIR,
        NOTO_ALLOW_PUBLIC: 'false',
        // The storage of the test run is fixed by the environment: the
        // application shows it as a normal state and refuses to change it.
        NOTO_VAULT_FIXED: '1',
      },
      url: `${BASE_URL}/api/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // The second server does not fix the storage, so the test of the real
      // change of the storage can run against it.
      command: `"${GO_BIN}" run ./cmd/noto`,
      cwd: path.join(__dirname, 'backend'),
      env: {
        NOTO_ADDR: `127.0.0.1:${SWITCH_PORT}`,
        NOTO_DATA_DIR: path.join(os.tmpdir(), 'noto-e2e-switch', RUN_ID),
        NOTO_ALLOW_PUBLIC: 'false',
      },
      url: `${SWITCH_URL}/api/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
