import { describe, expect, it } from 'vitest';

import { KeyUnlockError } from '../errors';
import { LIGHT_KDF_PARAMS } from '../kdf';
import { exportAesKey } from '../sealed';
import {
  KeystoreFile,
  createKeystore,
  createRecoveryKey,
  enableRecovery,
  rewrapKeystore,
  unlockKeystore,
  unlockWithRecovery,
  verifyPassword,
} from '../keys';

describe('keystore', () => {
  it('unlocks with the right password and keeps the same DEK', async () => {
    const { keystore, dek, epoch } = await createKeystore('master secret', LIGHT_KDF_PARAMS);
    expect(epoch).toBe(1);
    expect(keystore.format).toBe(1);
    expect(keystore.epochs.length).toBe(1);

    const unlocked = await unlockKeystore('master secret', keystore);
    expect(unlocked.epoch).toBe(1);
    expect(Array.from(await exportAesKey(unlocked.dek))).toEqual(
      Array.from(await exportAesKey(dek)),
    );
  });

  it('rejects a wrong password', async () => {
    const { keystore } = await createKeystore('master secret', LIGHT_KDF_PARAMS);
    await expect(unlockKeystore('wrong password', keystore)).rejects.toBeInstanceOf(
      KeyUnlockError,
    );
    expect(await verifyPassword('master secret', keystore)).toBe(true);
    expect(await verifyPassword('wrong password', keystore)).toBe(false);
  });

  it('rewraps the same DEK and keeps the old password working', async () => {
    const { keystore, dek } = await createKeystore('old password', LIGHT_KDF_PARAMS);
    const dekBefore = Array.from(await exportAesKey(dek));

    const rewrapped = await rewrapKeystore(
      keystore,
      dek,
      'old password',
      'new password',
      LIGHT_KDF_PARAMS,
    );
    expect(rewrapped.epochs.length).toBe(2);
    expect(rewrapped.epochs[1].id).toBe(2);

    const withNew = await unlockKeystore('new password', rewrapped);
    const withOld = await unlockKeystore('old password', rewrapped);
    expect(withNew.epoch).toBe(2);
    expect(withOld.epoch).toBe(1);
    expect(Array.from(await exportAesKey(withNew.dek))).toEqual(dekBefore);
    expect(Array.from(await exportAesKey(withOld.dek))).toEqual(dekBefore);
  });

  it('opens the vault with the recovery key', async () => {
    const { keystore, dek } = await createKeystore('master secret', LIGHT_KDF_PARAMS);
    const dekBefore = Array.from(await exportAesKey(dek));
    const recovery = await createRecoveryKey();

    const withRecovery: KeystoreFile = await enableRecovery(keystore, dek, recovery.bytes);
    expect(withRecovery.recovery).toBeDefined();

    const unlocked = await unlockWithRecovery(withRecovery, recovery.bytes);
    expect(Array.from(await exportAesKey(unlocked.dek))).toEqual(dekBefore);
  });

  it('fails without a recovery block', async () => {
    const { keystore } = await createKeystore('master secret', LIGHT_KDF_PARAMS);
    const recovery = await createRecoveryKey();
    await expect(unlockWithRecovery(keystore, recovery.bytes)).rejects.toBeInstanceOf(
      KeyUnlockError,
    );
  });

  it('fails with a wrong recovery key', async () => {
    const { keystore, dek } = await createKeystore('master secret', LIGHT_KDF_PARAMS);
    const recovery = await createRecoveryKey();
    const other = await createRecoveryKey();
    const withRecovery = await enableRecovery(keystore, dek, recovery.bytes);
    await expect(unlockWithRecovery(withRecovery, other.bytes)).rejects.toBeInstanceOf(
      KeyUnlockError,
    );
  });
});
