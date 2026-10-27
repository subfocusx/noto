/**
 * Playwright global setup.
 *
 * 1. Recreates the ZIP import fixture.
 *
 * The build of the frontend bundle is **not** here: Playwright starts the
 * servers before the global setup, and the Go server embeds the bundle at
 * compile time. The build therefore happens in `e2e/scripts/build-frontend.mjs`,
 * right before the server is compiled.
 */
import { execSync } from 'node:child_process';
import { writeImportFixture } from './fixtures/make-fixture';

export default async function globalSetup(): Promise<void> {
  const target = writeImportFixture();
  // eslint-disable-next-line no-console
  console.log(`e2e: import fixture written to ${target}`);
}
