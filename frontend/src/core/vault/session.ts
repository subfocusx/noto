// The session of the storage of the notes.
//
// The application works in one of two modes:
//
//   - `open`   — the notes are plain markdown files, the API of the notes is
//                used as it always was;
//   - `sealed` — the notes are encrypted in the browser before they reach the
//                server, and the storage is opened with a master password.
//
// The session is the single place that knows which mode is active and that
// owns the sealed vault. The user interface asks the session; the session
// The key material never leaves `src/core/crypto` and `src/core/vault`.
//
// The sealed layer is loaded LAZILY: an open storage must not pay for the
// cryptography it does not use. The modules of the sealed vault (and with them
// the crypto core) land in their own chunk of the bundle, which is fetched
// when the storage is really encrypted.
import { getVault } from '../../api/vault';
import type { SealedVault } from './sealedVault';
import type { KdfParams } from '../crypto/kdf';
import type { SealedStatus } from './types';

/** The mode of the storage of the notes. */
export type VaultMode = 'open' | 'sealed';

/** The state of the session, as the user interface sees it. */
export interface VaultSessionState {
  /** The mode of the storage. */
  mode: VaultMode;
  /** True when the storage is encrypted and locked. */
  locked: boolean;
  /** True while the mode is being detected. */
  detecting: boolean;
  /** The version of the format of the encrypted storage. */
  formatVersion: number;
}

type Listener = (state: VaultSessionState) => void;

const listeners = new Set<Listener>();

let state: VaultSessionState = {
  mode: 'open',
  locked: false,
  detecting: true,
  formatVersion: 0,
};

let vault: SealedVault | null = null;

/**
 * The client of the sealed backend used by the session itself.
 *
 * The vault owns a client of its own; the session needs one as well because it
 * reads and writes the keystore (the file that carries the wrapped data key)
 * without touching the notes.
 */
async function sealedClient(): Promise<import('./sealedClient').SealedClient> {
  const module = await import('./sealedClient');
  return new module.SealedClient();
}

/**
 * Returns the vault of the session, loading the sealed layer when it is not
 * there yet.
 *
 * The load is dynamic on purpose: the crypto core must not be part of the
 * first chunk of an application that works with an open storage.
 */
async function ensureVault(): Promise<SealedVault> {
  if (!vault) {
    const module = await import('./sealedVault');
    vault = new module.SealedVault();
  }
  return vault;
}

/** Publishes a new state to the listeners. */
function publish(next: Partial<VaultSessionState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener(state);
}

/** Subscribes to the state of the session; returns the unsubscribe function. */
export function subscribeVaultSession(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The current state of the session. */
export function getVaultSessionState(): VaultSessionState {
  return state;
}

/** The sealed vault of the session, or null when the storage is open. */
export function getSealedVault(): SealedVault | null {
  return vault;
}

/**
 * Detects the mode of the storage.
 *
 * The server owns the folder, so the server knows whether the folder is
 * sealed. An unreachable server leaves the mode unknown: the application then
 * keeps the open mode and shows that the backend does not answer.
 */
export async function detectVaultMode(): Promise<VaultMode> {
  try {
    const info = await getVault();
    const mode: VaultMode = info.mode === 'sealed' ? 'sealed' : 'open';
    publish({ mode, detecting: false, locked: mode === 'sealed' });
    if (mode === 'sealed') await ensureVault();
    return mode;
  } catch {
    publish({ detecting: false });
    return state.mode;
  }
}

/**
 * Unlocks the encrypted storage.
 *
 * The password is used once to unwrap the data key; it is never stored and it
 * never leaves this function.
 */
export async function unlockVault(password: string): Promise<void> {
  const sealed = await ensureVault();
  await sealed.unlock(password);
  publish({ locked: false, mode: 'sealed' });
  await publishFormatVersion();
}

/**
 * Locks the encrypted storage.
 *
 * The key material is dropped, the manifest and the index are cleared. The
 * unsaved work in the local drafts is removed as well: it is encrypted with
 * the key that is about to disappear.
 */
export async function lockVault(): Promise<void> {
  if (vault) await vault.lock();
  publish({ locked: state.mode === 'sealed', mode: 'sealed' });
}

/**
 * Creates a new encrypted storage in the current folder.
 *
 * The folder must be empty of notes: the caller (the wizard) asks the user
 * about that first.
 */
export async function createSealedVault(password: string, params?: KdfParams): Promise<void> {
  const sealed = await ensureVault();
  await sealed.create(password, params);
  publish({ mode: 'sealed', locked: false });
  await publishFormatVersion();
}

/** Marks the session as open; used after a migration that switched the mode. */
export function markVaultOpen(): void {
  publish({ mode: 'open', locked: false, formatVersion: 0 });
}

/** Marks the session as sealed; used after a migration that switched the mode. */
export function markVaultSealed(): void {
  publish({ mode: 'sealed', locked: false });
}

/**
 * Adopts the encrypted storage after a migration.
 *
 * The migration writes the manifest of the encrypted storage itself, so the
 * vault of the session is unlocked again to pick the new manifest up. The
 * password is used once and is never stored.
 */
export async function adoptSealedVault(password: string): Promise<void> {
  const sealed = await ensureVault();
  await sealed.unlock(password);
  publish({ mode: 'sealed', locked: false });
}

/* --------------------------------------------------------------- keystore */

/**
 * Publishes the version of the format of the encrypted storage.
 *
 * The backend owns the format of the sealed storage, so the version is read
 * from it. A backend that does not answer leaves the previous value alone: the
 * version is a hint of the interface, not a condition of the work.
 */
async function publishFormatVersion(): Promise<void> {
  try {
    const status = await (await ensureVault()).status();
    publish({ formatVersion: status.format });
  } catch {
    /* the backend does not answer: the known version stays */
  }
}

/**
 * Reads the status of the sealed backend and publishes the format version.
 *
 * The user interface calls it when the settings of the vault are opened.
 */
export async function refreshVaultStatus(): Promise<SealedStatus> {
  const status = await (await ensureVault()).status();
  publish({ formatVersion: status.format });
  return status;
}

/**
 * Creates a recovery key for the encrypted storage.
 *
 * The key is returned as text: the user interface shows it once and hands it
 * to the user. The key material itself never leaves the core.
 */
export async function createRecoveryKey(): Promise<string> {
  const keys = await import('../crypto/keys');
  const created = await keys.createRecoveryKey();
  return created.key;
}

/**
 * True when the keystore of the encrypted storage carries a recovery block.
 *
 * A backend that does not answer counts as "no recovery key": the interface
 * then offers to create one.
 */
export async function hasRecoveryKey(): Promise<boolean> {
  try {
    const keystore = await (await sealedClient()).getKeystore();
    return Boolean(keystore.recovery);
  } catch {
    return false;
  }
}

/**
 * Enables a recovery key on the encrypted storage.
 *
 * The master password is needed to unwrap the data key of the keystore; it is
 * used once and never stored. The new recovery key replaces the previous one,
 * so the old key stops working at once.
 */
export async function enableRecoveryKey(key: string, password: string): Promise<void> {
  const keys = await import('../crypto/keys');
  const format = await import('../crypto/format');
  const keystore = await (await sealedClient()).getKeystore();
  const unlocked = await keys.unlockKeystore(password, keystore);
  const next = await keys.enableRecovery(keystore, unlocked.dek, format.fromBase64(key));
  await (await sealedClient()).putKeystore(next);
}

/**
 * Changes the master password of the encrypted storage.
 *
 * The data key stays the same: the encrypted notes are not touched, only the
 * keystore gets a new epoch.
 */
export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  const keys = await import('../crypto/keys');
  const keystore = await (await sealedClient()).getKeystore();
  const unlocked = await keys.unlockKeystore(oldPassword, keystore);
  const next = await keys.rewrapKeystore(keystore, unlocked.dek, oldPassword, newPassword);
  await (await sealedClient()).putKeystore(next);
}

/**
 * Checks that every sealed object of the storage can still be opened.
 *
 * The answer carries the number of the checked objects and the ids of the
 * broken ones. The ids are random: they never carry a title or a path.
 */
export async function integrityCheck(): Promise<{ checked: number; broken: string[] }> {
  return (await ensureVault()).integrityCheck();
}

/**
 * The name of the storage of the notes, as the backend knows it.
 *
 * The name is a hint for the unlock screen; a backend that does not answer
 * leaves the generic name.
 */
export async function getStorageName(): Promise<string> {
  try {
    const info = await getVault();
    return info.notesDir || info.path || 'Noto';
  } catch {
    return 'Noto';
  }
}
