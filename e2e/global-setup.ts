/**
 * Playwright global setup.
 *
 * 1. Recreates the ZIP import fixture.
 * 2. Builds the frontend bundle, because the Go server serves the SPA from
 *    `backend/internal/web/dist`. Without a fresh build the end-to-end suite
 *    would test a stale artifact (for example a bundle without the plugin
 *    platform) and report misleading failures.
 */
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { writeImportFixture } from './fixtures/make-fixture';

// Playwright runs the global setup with the repository root as the working
// directory, so the paths are derived from `process.cwd()` instead of
// `import.meta.url` (the setup file is loaded as CommonJS).
const repoRoot = process.cwd();
const frontendDir = resolve(repoRoot, 'frontend');

export default async function globalSetup(): Promise<void> {
  const target = writeImportFixture();
  // eslint-disable-next-line no-console
  console.log(`e2e: import fixture written to ${target}`);

  // eslint-disable-next-line no-console
  console.log('e2e: building the frontend bundle (npm run build)');
  execSync('npm run build', {
    cwd: frontendDir,
    stdio: 'inherit',
    shell: true,
  });
}
