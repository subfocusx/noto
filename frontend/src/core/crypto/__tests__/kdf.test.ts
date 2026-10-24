import { describe, expect, it } from 'vitest';

import { fromBase64, toBase64 } from '../format';
import {
  DEFAULT_KDF_PARAMS,
  LIGHT_KDF_PARAMS,
  argon2id,
  createKdfParams,
  estimateKdfMilliseconds,
} from '../kdf';

describe('argon2id', () => {
  const saltA = toBase64(new Uint8Array(16).fill(1));
  const saltB = toBase64(new Uint8Array(16).fill(2));

  it('is deterministic for the same password and salt', async () => {
    const params = { ...LIGHT_KDF_PARAMS, salt: saltA };
    const a = await argon2id('correct horse', params);
    const b = await argon2id('correct horse', params);
    expect(a.length).toBe(32);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('differs for a different salt', async () => {
    const saltA2 = { ...LIGHT_KDF_PARAMS, salt: saltA };
    const saltB2 = { ...LIGHT_KDF_PARAMS, salt: saltB };
    const a = await argon2id('correct horse', saltA2);
    const b = await argon2id('correct horse', saltB2);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('differs for a different password', async () => {
    const params = { ...LIGHT_KDF_PARAMS, salt: saltA };
    const a = await argon2id('password one', params);
    const b = await argon2id('password two', params);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});

describe('kdf parameters', () => {
  it('creates parameters with a 16 byte base64 salt', () => {
    const params = createKdfParams(new Uint8Array(32).fill(7));
    expect(params.alg).toBe('argon2id');
    expect(fromBase64(params.salt).length).toBe(16);
    expect(params.m).toBe(DEFAULT_KDF_PARAMS.m);
    expect(params.t).toBe(DEFAULT_KDF_PARAMS.t);
    expect(params.p).toBe(DEFAULT_KDF_PARAMS.p);
  });

  it('exposes the documented defaults', () => {
    expect(DEFAULT_KDF_PARAMS.m).toBe(65536);
    expect(DEFAULT_KDF_PARAMS.t).toBe(3);
    expect(DEFAULT_KDF_PARAMS.p).toBe(1);
    expect(LIGHT_KDF_PARAMS.m).toBe(8192);
    expect(LIGHT_KDF_PARAMS.t).toBe(2);
    expect(LIGHT_KDF_PARAMS.p).toBe(1);
  });

  it('estimates a cost for the ui', () => {
    expect(estimateKdfMilliseconds(DEFAULT_KDF_PARAMS)).toBeGreaterThan(
      estimateKdfMilliseconds(LIGHT_KDF_PARAMS),
    );
  });
});
