// Copies the built frontend into backend/internal/web/dist so the Go server
// can serve the SPA from its embedded filesystem.
import { cpSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const from = resolve(here, '..', 'dist');
const to = resolve(here, '..', '..', 'backend', 'internal', 'web', 'dist');

if (!existsSync(from)) {
  console.error(`copy-dist: build output not found at ${from}`);
  process.exit(1);
}

// Stamp the build id into the service worker so that a new build replaces the
// cached app shell instead of keeping the previous one.
const swFile = resolve(from, 'sw.js');
if (existsSync(swFile)) {
  const source = readFileSync(swFile, 'utf8');
  if (source.includes('__BUILD_ID__')) {
    const buildId = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    writeFileSync(swFile, source.replaceAll('__BUILD_ID__', buildId), 'utf8');
    console.log(`copy-dist: stamped service worker build id ${buildId}`);
  }
}

mkdirSync(to, { recursive: true });
// Remove stale assets so the Go embed does not keep outdated files around.
// A file may be locked by a running server on Windows; that must not break
// the build, the copy below overwrites what it can.
for (const entry of ['assets', 'index.html', 'manifest.webmanifest', 'sw.js', 'icons']) {
  const target = resolve(to, entry);
  try {
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  } catch (err) {
    console.warn(`copy-dist: could not remove ${target}: ${err.code ?? err}`);
  }
}
cpSync(from, to, { recursive: true, force: true });
console.log(`copy-dist: ${from} -> ${to}`);
