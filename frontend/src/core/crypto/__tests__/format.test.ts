import { describe, expect, it } from 'vitest';

import { SealedFormatError } from '../errors';
import {
  SEALED_FORMAT_VERSION,
  SEALED_HEADER_BYTES,
  SEALED_MAGIC,
  decodeSealedHeader,
  encodeSealedHeader,
  fromBase64,
  fromHex,
  toBase64,
  toHex,
} from '../format';

const NONCE = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

describe('sealed header', () => {
  it('round trips through encode and decode', () => {
    const header = { version: SEALED_FORMAT_VERSION, flags: 0, epoch: 42, nonce: NONCE };
    const bytes = encodeSealedHeader(header);

    expect(bytes.length).toBe(SEALED_HEADER_BYTES);
    expect(String.fromCharCode(...bytes.slice(0, 8))).toBe(SEALED_MAGIC);

    const decoded = decodeSealedHeader(bytes);
    expect(decoded.version).toBe(SEALED_FORMAT_VERSION);
    expect(decoded.flags).toBe(0);
    expect(decoded.epoch).toBe(42);
    expect(Array.from(decoded.nonce)).toEqual(Array.from(NONCE));
  });

  it('rejects a wrong magic', () => {
    const bytes = encodeSealedHeader({
      version: SEALED_FORMAT_VERSION,
      flags: 0,
      epoch: 1,
      nonce: NONCE,
    });
    bytes[0] = bytes[0] ^ 0xff;
    expect(() => decodeSealedHeader(bytes)).toThrow(SealedFormatError);
  });

  it('rejects a short buffer', () => {
    expect(() => decodeSealedHeader(new Uint8Array(SEALED_HEADER_BYTES - 1))).toThrow(
      SealedFormatError,
    );
  });

  it('rejects an unsupported version', () => {
    const bytes = encodeSealedHeader({
      version: SEALED_FORMAT_VERSION,
      flags: 0,
      epoch: 1,
      nonce: NONCE,
    });
    bytes[8] = 9;
    expect(() => decodeSealedHeader(bytes)).toThrow(SealedFormatError);
  });
});

describe('encodings', () => {
  it('round trips base64', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(Array.from(fromBase64(toBase64(bytes)))).toEqual(Array.from(bytes));
  });

  it('rejects invalid base64', () => {
    expect(() => fromBase64('!!!not base64!!!')).toThrow(SealedFormatError);
  });

  it('round trips hex', () => {
    const bytes = new Uint8Array([0, 15, 16, 255]);
    expect(toHex(bytes)).toBe('000f10ff');
    expect(Array.from(fromHex('000F10FF'))).toEqual(Array.from(bytes));
  });

  it('rejects invalid hex', () => {
    expect(() => fromHex('abc')).toThrow(SealedFormatError);
    expect(() => fromHex('zz')).toThrow(SealedFormatError);
  });
});
