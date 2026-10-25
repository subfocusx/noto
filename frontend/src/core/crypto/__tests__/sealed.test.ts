import { describe, expect, it } from 'vitest';

import { AuthenticationError, SealedFormatError } from '../errors';
import { SEALED_HEADER_BYTES } from '../format';
import {
  chunkCount,
  generateDataKey,
  importAesKey,
  openBytes,
  openChunk,
  randomBytes,
  sealBytes,
  sealChunk,
} from '../sealed';

describe('sealed containers', () => {
  it('round trips plaintext', async () => {
    const dek = await generateDataKey();
    const plaintext = new TextEncoder().encode('nota bene, secret notebook');
    const container = await sealBytes(dek, plaintext, 1);
    expect(container.length).toBeGreaterThan(SEALED_HEADER_BYTES + 16);
    const opened = await openBytes(dek, container);
    expect(new TextDecoder().decode(opened)).toBe('nota bene, secret notebook');
  });

  it('fails when a ciphertext byte is flipped', async () => {
    const dek = await generateDataKey();
    const container = await sealBytes(dek, new Uint8Array([1, 2, 3, 4]), 1);
    container[SEALED_HEADER_BYTES + 1] ^= 0x01;
    await expect(openBytes(dek, container)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('fails with a different key', async () => {
    const dek = await generateDataKey();
    const other = await generateDataKey();
    const container = await sealBytes(dek, new Uint8Array([9, 9]), 1);
    await expect(openBytes(other, container)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('uses a unique nonce for every seal', async () => {
    const dek = await generateDataKey();
    const plaintext = new Uint8Array([1, 2, 3]);
    const a = await sealBytes(dek, plaintext, 1);
    const b = await sealBytes(dek, plaintext, 1);
    expect(Array.from(a)).not.toEqual(Array.from(b));
    expect(Array.from(a.slice(16, 28))).not.toEqual(Array.from(b.slice(16, 28)));
  });

  it('rejects a container without a valid header', async () => {
    const dek = await generateDataKey();
    await expect(openBytes(dek, new Uint8Array(10))).rejects.toBeInstanceOf(SealedFormatError);
  });

  it('imports raw key material back into a usable key', async () => {
    const dek = await generateDataKey();
    const raw = new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', dek));
    const imported = await importAesKey(raw);
    const container = await sealBytes(imported, new Uint8Array([7]), 1);
    expect((await openBytes(imported, container)).length).toBe(1);
  });
});

describe('chunks', () => {
  it('round trips a chunk with a non zero index', async () => {
    const dek = await generateDataKey();
    const chunk = new TextEncoder().encode('chunk payload');
    const container = await sealChunk(dek, chunk, 3, 17);
    const opened = await openChunk(dek, container, 17);
    expect(new TextDecoder().decode(opened)).toBe('chunk payload');
  });

  it('fails when the chunk index does not match', async () => {
    const dek = await generateDataKey();
    const container = await sealChunk(dek, new Uint8Array([1, 2, 3]), 3, 17);
    await expect(openChunk(dek, container, 18)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('counts the chunks of a payload', () => {
    expect(chunkCount(0, 100)).toBe(0);
    expect(chunkCount(100, 100)).toBe(1);
    expect(chunkCount(101, 100)).toBe(2);
    expect(chunkCount(1000, 256)).toBe(4);
  });
});

describe('randomness', () => {
  it('returns the requested number of bytes', async () => {
    expect((await randomBytes(16)).length).toBe(16);
    expect((await randomBytes(0)).length).toBe(0);
  });

  it('does not repeat itself', async () => {
    const a = await randomBytes(32);
    const b = await randomBytes(32);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});
