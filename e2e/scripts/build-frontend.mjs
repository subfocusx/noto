/**
 * Builds the frontend bundle before the end-to-end servers start.
 *
 * The Go server serves the single page application from the assets that are
 * embedded at compile time (`backend/internal/web/dist`, filled by
 * `frontend/scripts/copy-dist.mjs`). A server that starts before the bundle
 * is built serves the *previous* bundle, and the suite then reports failures
 * that have nothing to do with the change under test.
 *
 * Playwright starts the `webServer` entries **before** the global setup, so
 * the build cannot live in the global setup any more: it has to happen here,
 * right before the server is compiled.
 *
 * The two servers of the configuration may start at the same time, so the
 * build is guarded by a lock in the temporary directory: the first process
 * builds, the second one waits for the lock and reuses the fresh bundle.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(process.cwd(), '..');
const frontendDir = path.join(repoRoot, 'frontend');
const lockDir = path.join(os.tmpdir(), 'noto-e2e-frontend-build.lock');

/**
 * The age after which a lock is considered stale.
 *
 * A crashed run leaves the lock behind, and every later run would wait for a
 * process that does not exist any more. The build of the bundle takes far
 * less than a minute, so a lock that is older than that belongs to a dead
 * process.
 */
const LOCK_STALE_MS = 60_000;

/** Waits for the given number of milliseconds. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Takes the lock of the build, or waits for the process that holds it.
 *
 * @returns {boolean} true when this process owns the lock and must build.
 */
async function takeLock() {
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      return true;
    } catch {
      // Somebody else is building: wait for the lock to be released.
      const deadline = Date.now() + 300_000;
      while (fs.existsSync(lockDir) && Date.now() < deadline) {
        const age = Date.now() - fs.statSync(lockDir).mtimeMs;
        if (age > LOCK_STALE_MS) {
          // The lock is stale (a crashed run): take it over.
          fs.rmSync(lockDir, { recursive: true, force: true });
          break;
        }
        await sleep(200);
      }
      if (!fs.existsSync(lockDir)) {
        // The other process built the bundle: nothing left to do.
        return false;
      }
    }
  }
}

/**
 * Keeps the lock of the build alive.
 *
 * The age of the lock is the sign of a dead process, so the process that
 * owns the lock refreshes it while it builds.
 */
function keepLockAlive() {
  return setInterval(() => {
    try {
      const now = new Date();
      fs.utimesSync(lockDir, now, now);
    } catch {
      // The lock is gone: the build is over or the lock was taken over.
    }
  }, 5_000);
}

async function main() {
  if (!fs.existsSync(frontendDir)) {
    throw new Error(`the frontend directory is missing: ${frontendDir}`);
  }

  const owner = await takeLock();
  if (!owner) {
    console.log('e2e: the frontend bundle was built by another process');
    return;
  }

  try {
    console.log('e2e: building the frontend bundle (npm run build)');
    const heartbeat = keepLockAlive();
    try {
      execSync('npm run build', { cwd: frontendDir, stdio: 'inherit', shell: true });
    } finally {
      clearInterval(heartbeat);
    }
  } finally {
    fs.rmSync(lockDir, { recursive: true, force: true });
  }
}

await main();
