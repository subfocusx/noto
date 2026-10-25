// The payloads of the outbox of an encrypted storage.
//
// A write that waits for the connection in an encrypted storage must not lie
// in the clear in the database of the browser: the payload is sealed with the
// key of the vault, exactly like a draft is.
//
// The module only moves bytes: the vault owns the key and the cryptography.
import type { SealedVaultLike } from './vaultService';

/** The codec of the payloads of an encrypted storage. */
export const SEALED_CODEC = 'sealed';

/** Turns the bytes into a string that a database can hold. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Turns the string of the database back into the bytes. */
function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * Seals the payload of a write that waits for the connection.
 *
 * The vault must be able to seal: a vault that cannot (a double of a test)
 * has no key and no right to keep the text of a note.
 */
export async function sealOutboxPayload(
  vault: SealedVaultLike,
  value: unknown,
): Promise<string> {
  if (!vault.sealPayload) throw new Error('The vault cannot seal a payload.');
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return toBase64(await vault.sealPayload(bytes));
}

/** Opens the payload of a write that waits for the connection. */
export async function openOutboxPayload(
  vault: SealedVaultLike,
  encoded: string,
): Promise<unknown> {
  if (!vault.openPayload) throw new Error('The vault cannot open a payload.');
  const bytes = await vault.openPayload(fromBase64(encoded));
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}
