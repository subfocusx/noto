// Keystore: the file that carries the wrapped data encryption key.
//
// The keystore never contains the DEK itself, only the DEK wrapped with a key
// encryption key (KEK) that is derived from the master password. Changing the
// password therefore re-wraps the same DEK: the encrypted objects stay
// untouched.

import { KeyUnlockError } from './errors';
import { fromBase64, toBase64 } from './format';
import { KdfParams, DEFAULT_KDF_PARAMS, KDF_SALT_BYTES, argon2id, createKdfParams } from './kdf';
import {
  exportAesKey,
  generateDataKey,
  importAesKey,
  randomBytes,
  toArrayBuffer,
} from './sealed';

/** A DEK wrapped with a KEK: base64 encoded nonce and ciphertext. */
export interface WrappedKey {
  /** Base64 encoded 12 byte GCM nonce. */
  nonce: string;
  /** Base64 encoded ciphertext (including the GCM tag). */
  ct: string;
}

/** One password generation of the keystore. */
export interface KeystoreEpoch {
  /** Monotonic id of the epoch; newer epochs have a higher id. */
  id: number;
  /** ISO timestamp of the moment the epoch was created. */
  createdAt: string;
  /** The DEK wrapped with the KEK of this epoch. */
  wrapped: WrappedKey;
  /**
   * KDF parameters used by this epoch.
   *
   * Optional so that keystores written by older clients (which had a single
   * global parameter set) stay readable; it is stored per epoch because a
   * password change may introduce new parameters while the previous epochs
   * must remain unlockable with the old password.
   */
  kdf?: KdfParams;
}

/** The on-disk keystore document. */
export interface KeystoreFile {
  /** Format version of the keystore document. */
  format: number;
  /** KDF parameters of the newest epoch. */
  kdf: KdfParams;
  /** All epochs, oldest first. */
  epochs: KeystoreEpoch[];
  /** The DEK wrapped with the recovery key, when recovery is enabled. */
  recovery?: WrappedKey;
}

const NONCE_BYTES = 12;
const KEY_BYTES = 32;
const RECOVERY_AAD = new TextEncoder().encode('noto-recovery-v1');

/** Additional authenticated data for a wrapped epoch: the epoch id. */
function epochAad(epochId: number): Uint8Array {
  const aad = new Uint8Array(4);
  new DataView(aad.buffer).setUint32(0, epochId, false);
  return aad;
}

/** Wraps raw key material with a KEK. */
async function wrapRaw(kek: CryptoKey, raw: Uint8Array, aad: Uint8Array): Promise<WrappedKey> {
  const nonce = await randomBytes(NONCE_BYTES);
  const ct = await globalThis.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(nonce),
      additionalData: toArrayBuffer(aad),
    },
    kek,
    toArrayBuffer(raw),
  );
  return { nonce: toBase64(nonce), ct: toBase64(new Uint8Array(ct)) };
}

/** Unwraps key material with a KEK; fails when the key or the data is wrong. */
async function unwrapRaw(kek: CryptoKey, wrapped: WrappedKey, aad: Uint8Array): Promise<Uint8Array> {
  const plain = await globalThis.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(fromBase64(wrapped.nonce)),
      additionalData: toArrayBuffer(aad),
    },
    kek,
    toArrayBuffer(fromBase64(wrapped.ct)),
  );
  return new Uint8Array(plain);
}

/**
 * Resolves the KDF parameters of a new vault.
 *
 * The shipped parameter sets carry no salt: a vault must never share its salt
 * with another one, so a fresh random salt is generated whenever the caller
 * did not bring one.
 */
async function resolveKdfParams(params?: KdfParams): Promise<KdfParams> {
  const base = params ?? DEFAULT_KDF_PARAMS;
  if (base.salt) return base;
  const fresh = createKdfParams(await randomBytes(KDF_SALT_BYTES));
  return { ...base, salt: fresh.salt };
}

/**
 * Derives the key encryption key from the master password.
 *
 * The derived key is not extractable: it exists only in memory and dies with
 * the tab.
 */
export async function deriveKek(password: string, params: KdfParams): Promise<CryptoKey> {
  const raw = await argon2id(password, params);
  return globalThis.crypto.subtle.importKey(
    'raw',
    toArrayBuffer(raw),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Creates a new keystore with a fresh DEK.
 *
 * The returned DEK is the only key that ever protects the objects; the
 * keystore only holds the wrapped copy.
 */
export async function createKeystore(
  password: string,
  params?: KdfParams,
): Promise<{ keystore: KeystoreFile; dek: CryptoKey; epoch: number }> {
  const effective = await resolveKdfParams(params);
  const dek = await generateDataKey();
  const kek = await deriveKek(password, effective);
  const epochId = 1;
  const raw = await exportAesKey(dek);
  const wrapped = await wrapRaw(kek, raw, epochAad(epochId));
  const keystore: KeystoreFile = {
    format: 1,
    kdf: effective,
    epochs: [
      {
        id: epochId,
        createdAt: new Date().toISOString(),
        wrapped,
        kdf: effective,
      },
    ],
  };
  return { keystore, dek, epoch: epochId };
}

/**
 * Unlocks a keystore with the master password.
 *
 * Every epoch is tried from the newest to the oldest, so that a keystore
 * which still carries the epochs of older passwords can be opened with the
 * matching one.
 */
export async function unlockKeystore(
  password: string,
  keystore: KeystoreFile,
): Promise<{ dek: CryptoKey; epoch: number }> {
  if (!keystore || !Array.isArray(keystore.epochs) || keystore.epochs.length === 0) {
    throw new KeyUnlockError('Keystore does not contain any epoch');
  }
  const epochs = [...keystore.epochs].sort((a, b) => b.id - a.id);
  for (const epoch of epochs) {
    const params = epoch.kdf ?? keystore.kdf;
    let kek: CryptoKey;
    try {
      kek = await deriveKek(password, params);
    } catch {
      continue;
    }
    try {
      const raw = await unwrapRaw(kek, epoch.wrapped, epochAad(epoch.id));
      const dek = await importAesKey(raw);
      return { dek, epoch: epoch.id };
    } catch {
      continue;
    }
  }
  throw new KeyUnlockError('The master password does not unlock this vault');
}

/**
 * Changes the master password without touching the encrypted objects.
 *
 * The very same DEK is re-wrapped with the new password and stored as a new
 * epoch; the previous epochs remain in the file so that clients (or users)
 * that still know the old password can open the vault.
 */
export async function rewrapKeystore(
  keystore: KeystoreFile,
  dek: CryptoKey,
  oldPassword: string,
  newPassword: string,
  params?: KdfParams,
): Promise<KeystoreFile> {
  const base = params ?? keystore.kdf ?? DEFAULT_KDF_PARAMS;
  // A new epoch gets its own salt, unless the caller brought a full parameter
  // set with a salt.
  const effective: KdfParams = base.salt
    ? base
    : { ...base, salt: createKdfParams(await randomBytes(KDF_SALT_BYTES)).salt };
  // The old password must actually open the keystore, otherwise we would store
  // a new epoch nobody can verify.
  const unlocked = await unlockKeystore(oldPassword, keystore);
  const unlockedRaw = await exportAesKey(unlocked.dek);
  const givenRaw = await exportAesKey(dek);
  if (!constantTimeEqual(unlockedRaw, givenRaw)) {
    throw new KeyUnlockError('The given key does not belong to this keystore');
  }

  const newEpochId = keystore.epochs.reduce((max, epoch) => Math.max(max, epoch.id), 0) + 1;
  const kek = await deriveKek(newPassword, effective);
  const wrapped = await wrapRaw(kek, givenRaw, epochAad(newEpochId));
  return {
    ...keystore,
    kdf: effective,
    epochs: [
      ...keystore.epochs,
      {
        id: newEpochId,
        createdAt: new Date().toISOString(),
        wrapped,
        kdf: effective,
      },
    ],
  };
}

/** Compares two byte arrays without leaking their content through timing. */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/**
 * Creates the recovery key.
 *
 * The key material is handed to the user as base64 and is the only way to
 * open the vault when the master password is lost.
 */
export async function createRecoveryKey(): Promise<{ key: string; bytes: Uint8Array }> {
  const bytes = await randomBytes(KEY_BYTES);
  return { key: toBase64(bytes), bytes };
}

/**
 * Adds a recovery block to the keystore.
 *
 * The DEK is wrapped a second time, this time with the recovery key, which is
 * independent of the master password.
 */
export async function enableRecovery(
  keystore: KeystoreFile,
  dek: CryptoKey,
  recoveryBytes: Uint8Array,
): Promise<KeystoreFile> {
  const recoveryKey = await importAesKey(recoveryBytes);
  const raw = await exportAesKey(dek);
  const wrapped = await wrapRaw(recoveryKey, raw, RECOVERY_AAD);
  return { ...keystore, recovery: wrapped };
}

/**
 * Opens the vault with the recovery key.
 *
 * Fails with a {@link KeyUnlockError} when the keystore has no recovery block
 * or when the key does not match.
 */
export async function unlockWithRecovery(
  keystore: KeystoreFile,
  recoveryBytes: Uint8Array,
): Promise<{ dek: CryptoKey; epoch: number }> {
  if (!keystore.recovery) {
    throw new KeyUnlockError('This keystore has no recovery key');
  }
  try {
    const recoveryKey = await importAesKey(recoveryBytes);
    const raw = await unwrapRaw(recoveryKey, keystore.recovery, RECOVERY_AAD);
    const dek = await importAesKey(raw);
    const epoch = keystore.epochs.reduce((max, item) => Math.max(max, item.id), 0);
    return { dek, epoch };
  } catch (error) {
    if (error instanceof KeyUnlockError) throw error;
    throw new KeyUnlockError('The recovery key does not unlock this vault');
  }
}

/**
 * Checks a master password without throwing.
 *
 * Used by the unlock dialog to tell "wrong password" from a broken vault.
 */
export async function verifyPassword(password: string, keystore: KeystoreFile): Promise<boolean> {
  try {
    await unlockKeystore(password, keystore);
    return true;
  } catch {
    return false;
  }
}

/** Re-exported so that callers can build keystores without a second import. */
export type { KdfParams };
