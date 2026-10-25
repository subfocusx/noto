// AES-GCM sealing of vault payloads.
//
// Everything the backend ever sees is produced here: the browser encrypts the
// plaintext and uploads the sealed container, so the server never holds a key
// and never sees clear text.

import { AuthenticationError, CryptoError, SealedFormatError } from './errors';
import {
  SEALED_FORMAT_VERSION,
  SEALED_HEADER_BYTES,
  SEALED_TAG_BYTES,
  decodeSealedHeader,
  encodeSealedHeader,
} from './format';

const NONCE_BYTES = 12;

/** Returns the SubtleCrypto implementation of the current runtime. */
function subtle(): SubtleCrypto {
  const impl = globalThis.crypto;
  if (!impl || !impl.subtle) {
    throw new CryptoError('WebCrypto (crypto.subtle) is not available in this environment');
  }
  return impl.subtle;
}

/**
 * Copies bytes into a fresh ArrayBuffer.
 *
 * WebCrypto only accepts ArrayBuffer backed views, while the public API of the
 * crypto core uses the generic `Uint8Array` type.
 */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

/**
 * Generates cryptographically secure random bytes.
 *
 * Async on purpose: it is the single place where randomness enters the
 * system, so that the call sites read uniformly.
 */
export async function randomBytes(length: number): Promise<Uint8Array> {
  if (!Number.isInteger(length) || length < 0) {
    throw new CryptoError(`Invalid random byte length: ${length}`);
  }
  const impl = globalThis.crypto;
  if (!impl || typeof impl.getRandomValues !== 'function') {
    throw new CryptoError('crypto.getRandomValues is not available in this environment');
  }
  const bytes = new Uint8Array(length);
  // getRandomValues refuses more than 64 KiB per call.
  const maxPerCall = 65536;
  for (let offset = 0; offset < length; offset += maxPerCall) {
    impl.getRandomValues(bytes.subarray(offset, Math.min(offset + maxPerCall, length)));
  }
  return bytes;
}

/**
 * Creates the data encryption key (DEK) that protects the vault content.
 *
 * The DEK is extractable on purpose: it has to be wrapped with the key
 * encryption key and, when the user changes the password, re-wrapped.
 */
export async function generateDataKey(): Promise<CryptoKey> {
  return subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/** Imports raw key material as an AES-256-GCM key. */
export async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return subtle().importKey('raw', toArrayBuffer(raw), { name: 'AES-GCM' }, true, [
    'encrypt',
    'decrypt',
  ]);
}

/**
 * Exports the raw bytes of an AES key.
 *
 * Used to compare keys across operations (for example to prove that a password
 * change did not re-encrypt anything) and to wrap a DEK.
 */
export async function exportAesKey(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await subtle().exportKey('raw', key));
}

/** Builds the additional authenticated data of a chunked payload. */
function chunkAad(headerBytes: Uint8Array, chunkIndex: number): Uint8Array {
  const aad = new Uint8Array(headerBytes.length + 4);
  aad.set(headerBytes, 0);
  new DataView(aad.buffer).setUint32(headerBytes.length, chunkIndex, false);
  return aad;
}

/**
 * Encrypts plaintext into a self describing container.
 *
 * Layout: header(28) || ciphertext || tag(16). The header is authenticated as
 * the GCM additional data, so the epoch and the nonce cannot be swapped
 * without breaking the tag.
 */
export async function sealBytes(
  dek: CryptoKey,
  plaintext: Uint8Array,
  epoch: number,
): Promise<Uint8Array> {
  const nonce = await randomBytes(NONCE_BYTES);
  const headerBytes = encodeSealedHeader({
    version: SEALED_FORMAT_VERSION,
    flags: 0,
    epoch,
    nonce,
  });
  const sealed = new Uint8Array(await subtle().encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(nonce), additionalData: toArrayBuffer(headerBytes) },
    dek,
    toArrayBuffer(plaintext),
  ));
  const container = new Uint8Array(headerBytes.length + sealed.length);
  container.set(headerBytes, 0);
  container.set(sealed, headerBytes.length);
  return container;
}

/**
 * Decrypts a container produced by {@link sealBytes}.
 *
 * A wrong key or a tampered ciphertext fails the GCM tag check and is reported
 * as an authentication error; a broken container is a format error.
 */
export async function openBytes(dek: CryptoKey, container: Uint8Array): Promise<Uint8Array> {
  const header = decodeSealedHeader(container);
  if (container.length < SEALED_HEADER_BYTES + SEALED_TAG_BYTES) {
    throw new SealedFormatError('Sealed container is truncated');
  }
  const headerBytes = container.subarray(0, SEALED_HEADER_BYTES);
  try {
    const plain = await subtle().decrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBuffer(header.nonce),
        additionalData: toArrayBuffer(headerBytes),
      },
      dek,
      toArrayBuffer(container.subarray(SEALED_HEADER_BYTES)),
    );
    return new Uint8Array(plain);
  } catch {
    throw new AuthenticationError('Sealed payload failed authentication');
  }
}

/**
 * Encrypts one chunk of a streamed attachment.
 *
 * The chunk index is part of the authenticated data, so chunks cannot be
 * reordered or replaced by another chunk of the same file.
 */
export async function sealChunk(
  dek: CryptoKey,
  chunk: Uint8Array,
  epoch: number,
  chunkIndex: number,
): Promise<Uint8Array> {
  const nonce = await randomBytes(NONCE_BYTES);
  const headerBytes = encodeSealedHeader({
    version: SEALED_FORMAT_VERSION,
    flags: 0,
    epoch,
    nonce,
  });
  const sealed = new Uint8Array(await subtle().encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(nonce),
      additionalData: toArrayBuffer(chunkAad(headerBytes, chunkIndex)),
    },
    dek,
    toArrayBuffer(chunk),
  ));
  const container = new Uint8Array(headerBytes.length + sealed.length);
  container.set(headerBytes, 0);
  container.set(sealed, headerBytes.length);
  return container;
}

/** Decrypts one chunk of a streamed attachment. */
export async function openChunk(
  dek: CryptoKey,
  container: Uint8Array,
  chunkIndex: number,
): Promise<Uint8Array> {
  const header = decodeSealedHeader(container);
  if (container.length < SEALED_HEADER_BYTES + SEALED_TAG_BYTES) {
    throw new SealedFormatError('Sealed chunk is truncated');
  }
  const headerBytes = container.subarray(0, SEALED_HEADER_BYTES);
  try {
    const plain = await subtle().decrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBuffer(header.nonce),
        additionalData: toArrayBuffer(chunkAad(headerBytes, chunkIndex)),
      },
      dek,
      toArrayBuffer(container.subarray(SEALED_HEADER_BYTES)),
    );
    return new Uint8Array(plain);
  } catch {
    throw new AuthenticationError('Sealed chunk failed authentication');
  }
}

/** Number of chunks a payload of the given length is split into. */
export function chunkCount(byteLength: number, chunkSize: number): number {
  if (!Number.isFinite(byteLength) || byteLength < 0) {
    throw new CryptoError(`Invalid byte length: ${byteLength}`);
  }
  if (!Number.isFinite(chunkSize) || chunkSize <= 0) {
    throw new CryptoError(`Invalid chunk size: ${chunkSize}`);
  }
  return Math.ceil(byteLength / chunkSize);
}
