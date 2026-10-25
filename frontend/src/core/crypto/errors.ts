// Error hierarchy of the client side cryptography core.
//
// Every failure the vault code can produce is one of these, so that the UI can
// tell "the password is wrong" apart from "the container is broken" without
// inspecting messages of foreign errors.

/** Base class of every error raised by the crypto core. */
export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoError';
  }
}

/**
 * The container or its header is malformed (bad magic, truncated buffer,
 * unsupported version). It means the stored bytes are unusable, not that the
 * key is wrong.
 */
export class SealedFormatError extends CryptoError {
  constructor(message: string) {
    super(message);
    this.name = 'SealedFormatError';
  }
}

/**
 * The GCM authentication tag did not match: the data was tampered with, or the
 * key is the wrong one.
 */
export class AuthenticationError extends CryptoError {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

/**
 * The vault could not be unlocked: the master password is wrong, the keystore
 * is unusable, or the recovery material does not fit.
 */
export class KeyUnlockError extends CryptoError {
  constructor(message: string) {
    super(message);
    this.name = 'KeyUnlockError';
  }
}
