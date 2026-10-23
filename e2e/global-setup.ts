/** Playwright global setup: (re)creates the ZIP import fixture. */
import { writeImportFixture } from './fixtures/make-fixture';

export default async function globalSetup(): Promise<void> {
  const target = writeImportFixture();
  // eslint-disable-next-line no-console
  console.log(`e2e: import fixture written to ${target}`);
}
