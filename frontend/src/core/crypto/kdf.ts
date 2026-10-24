// Password based key derivation.
//
// Argon2id is the only KDF the vault accepts. It is implemented by hash-wasm
// (WASM), which is loaded lazily: the module is only needed while a vault is
// created or unlocked, and must not bloat the entry chunk of the application.

import { CryptoError } from './errors';
import { toBase64, fromBase64 } from './format';

/** Parameters of the Argon2id key derivation. */
export interface KdfParams {
  /** Algorithm identifier; only Argon2id is supported. */
  alg: 'argon2id';
  /** Base64 encoded salt (16 random bytes). */
  salt: string;
  /** Memory cost in KiB. */
  m: number;
  /** Number of iterations. */
  t: number;
  /** Degree of parallelism. */
  p: number;
}

/** Parameters for normal devices: 64 MiB of memory, three iterations. */
export const DEFAULT_KDF_PARAMS: KdfParams = {
  alg: 'argon2id',
  salt: '',
  m: 65536,
  t: 3,
  p: 1,
};

/** Parameters for weak devices: 8 MiB of memory, two iterations. */
export const LIGHT_KDF_PARAMS: KdfParams = {
  alg: 'argon2id',
  salt: '',
  m: 8192,
  t: 2,
  p: 1,
};

/** Length of the derived key in bytes (AES-256). */
const DERIVED_KEY_BYTES = 32;

/** Length of the random salt in bytes. */
export const KDF_SALT_BYTES = 16;

/**
 * Derives 32 raw bytes from a password with Argon2id.
 *
 * The hash-wasm module is imported dynamically on purpose: it is a large WASM
 * payload and only has to be present when a vault is locked or unlocked.
 */
export async function argon2id(password: string, params: KdfParams): Promise<Uint8Array> {
  const { argon2id: hash } = await import('hash-wasm');
  const salt = fromBase64(params.salt);
  if (salt.length < 8) {
    throw new CryptoError('The KDF parameters carry no usable salt');
  }
  return hash({
    password,
    salt,
    parallelism: params.p,
    iterations: params.t,
    memorySize: params.m,
    hashLength: DERIVED_KEY_BYTES,
    outputType: 'binary' as const,
  });
}

/**
 * Builds KDF parameters with the given random salt.
 *
 * The salt must be unique per vault: reusing it between two vaults would make
 * a rainbow table for one password valid for the other as well.
 */
export function createKdfParams(random: Uint8Array): KdfParams {
  if (random.length < KDF_SALT_BYTES) {
    throw new CryptoError(`KDF salt must be at least ${KDF_SALT_BYTES} bytes`);
  }
  return {
    alg: 'argon2id',
    salt: toBase64(random.slice(0, KDF_SALT_BYTES)),
    m: DEFAULT_KDF_PARAMS.m,
    t: DEFAULT_KDF_PARAMS.t,
    p: DEFAULT_KDF_PARAMS.p,
  };
}

/**
 * Rough estimate of the derivation cost in milliseconds.
 *
 * The value only feeds the progress hint in the UI; it is a heuristic and no
 * cryptography happens here.
 */
export function estimateKdfMilliseconds(params: KdfParams): number {
  const memoryMiB = params.m / 1024;
  const passes = Math.max(1, params.t);
  const lanes = Math.max(1, params.p);
  // Empirically a 64 MiB / 3 iteration derivation takes roughly 1.5-2.5 s on a
  // modern laptop core; scaling by memory and passes is good enough for a hint.
  const perMiB = 0.7;
  return Math.round(memoryMiB * passes * perMiB / lanes + 20);
}
