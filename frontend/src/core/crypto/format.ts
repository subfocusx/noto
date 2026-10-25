// Binary container format of the encrypted vault payloads.
//
// The layout is fixed and byte oriented so that the Go backend can validate a
// container without understanding cryptography: it only has to recognise the
// magic bytes and forward the blob to the browser again.

import { SealedFormatError } from './errors';

/** Magic bytes that mark a Noto sealed container ("NOTOSEAL"). */
export const SEALED_MAGIC = 'NOTOSEAL';

/** Current version of the container format. */
export const SEALED_FORMAT_VERSION = 1;

/** Size of the container header in bytes: magic(8) + version(2) + flags(2) + epoch(4) + nonce(12). */
export const SEALED_HEADER_BYTES = 28;

/** Size of the GCM authentication tag appended to every ciphertext. */
export const SEALED_TAG_BYTES = 16;

/** Decoded header of a sealed container. */
export interface SealedHeader {
  /** Format version the container was written with. */
  version: number;
  /** Feature flags; reserved, currently always 0. */
  flags: number;
  /** Key epoch the payload was encrypted with, so that re-wraps stay readable. */
  epoch: number;
  /** Per container nonce (12 bytes) used as the GCM IV. */
  nonce: Uint8Array;
}

const MAGIC_BYTES = 8;
const NONCE_BYTES = 12;

/**
 * Serialises a header into its 28 byte on-disk representation.
 *
 * The header is used as the GCM additional authenticated data, so it must be
 * encoded deterministically: every field uses big endian byte order.
 */
export function encodeSealedHeader(header: SealedHeader): Uint8Array {
  if (header.nonce.length !== NONCE_BYTES) {
    throw new SealedFormatError(`Sealed nonce must be ${NONCE_BYTES} bytes`);
  }
  if (!Number.isInteger(header.version) || header.version < 0 || header.version > 0xffff) {
    throw new SealedFormatError('Sealed version does not fit into uint16');
  }
  if (!Number.isInteger(header.flags) || header.flags < 0 || header.flags > 0xffff) {
    throw new SealedFormatError('Sealed flags do not fit into uint16');
  }
  if (!Number.isInteger(header.epoch) || header.epoch < 0 || header.epoch > 0xffffffff) {
    throw new SealedFormatError('Sealed epoch does not fit into uint32');
  }

  const bytes = new Uint8Array(SEALED_HEADER_BYTES);
  for (let i = 0; i < MAGIC_BYTES; i += 1) {
    bytes[i] = SEALED_MAGIC.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  view.setUint16(MAGIC_BYTES, header.version, false);
  view.setUint16(MAGIC_BYTES + 2, header.flags, false);
  view.setUint32(MAGIC_BYTES + 4, header.epoch, false);
  bytes.set(header.nonce, MAGIC_BYTES + 8);
  return bytes;
}

/**
 * Parses the 28 byte header of a container.
 *
 * Anything that is not a container we can read is a format error: the caller
 * must not try to decrypt it.
 */
export function decodeSealedHeader(bytes: Uint8Array): SealedHeader {
  if (bytes.length < SEALED_HEADER_BYTES) {
    throw new SealedFormatError(
      `Sealed header is truncated: expected ${SEALED_HEADER_BYTES} bytes, got ${bytes.length}`,
    );
  }
  for (let i = 0; i < MAGIC_BYTES; i += 1) {
    if (bytes[i] !== SEALED_MAGIC.charCodeAt(i)) {
      throw new SealedFormatError('Sealed magic does not match');
    }
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(MAGIC_BYTES, false);
  if (version !== SEALED_FORMAT_VERSION) {
    throw new SealedFormatError(`Unsupported sealed format version: ${version}`);
  }
  return {
    version,
    flags: view.getUint16(MAGIC_BYTES + 2, false),
    epoch: view.getUint32(MAGIC_BYTES + 4, false),
    nonce: bytes.slice(MAGIC_BYTES + 8, SEALED_HEADER_BYTES),
  };
}

/**
 * Encodes bytes as standard base64.
 *
 * Base64 is used wherever the crypto core has to persist binary values inside
 * a JSON document (the keystore file, wrapped keys).
 */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  // Chunked to stay below the argument limit of String.fromCharCode.
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

/**
 * Decodes standard base64 back into bytes.
 *
 * Invalid input is a format error instead of a silent empty result: a broken
 * keystore must not be mistaken for an empty one.
 */
export function fromBase64(text: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    throw new SealedFormatError('Value is not valid base64');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Encodes bytes as lowercase hex, used for digests and short identifiers. */
export function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/** Decodes lowercase or uppercase hex back into bytes. */
export function fromHex(text: string): Uint8Array {
  if (text.length % 2 !== 0 || /[^0-9a-fA-F]/.test(text)) {
    throw new SealedFormatError('Value is not valid hex');
  }
  const bytes = new Uint8Array(text.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
