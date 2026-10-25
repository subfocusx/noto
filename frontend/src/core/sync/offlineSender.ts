// The sender of the writes that wait for the connection.
//
// The queue knows nothing about the notes: it holds the writes in the order
// they were made. This module sends one of them to the backend, through the
// service of the current mode (the same service the store uses).
//
// The write is sent inside a replay: a failure must not put the write into the
// queue a second time — it is already there, and it stays until it succeeds.
import { getSealedVault } from '../vault/session';
import { openOutboxPayload } from '../vault/sealedOutbox';
import { getVaultService } from '../vault/vaultService';
import { withReplay, type OfflineWrite } from './offlineQueue';

/** Reads the payload of a write back into the plain data. */
async function decodePayload(write: OfflineWrite): Promise<Record<string, unknown>> {
  if (write.codec === 'sealed') {
    const vault = getSealedVault();
    if (!vault) {
      throw new Error('The storage is locked: unlock it to send the queued writes.');
    }
    const value = await openOutboxPayload(vault, write.payload);
    return (value ?? {}) as Record<string, unknown>;
  }
  return JSON.parse(write.payload) as Record<string, unknown>;
}

/** Reads a string of the payload. */
function text(payload: Record<string, unknown>, key: string): string {
  return String(payload[key] ?? '');
}

/** Reads a number of the payload. */
function number(payload: Record<string, unknown>, key: string): number {
  const value = Number(payload[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

/** Sends one queued write to the backend. */
export async function sendOfflineWrite(write: OfflineWrite): Promise<void> {
  await withReplay(async () => {
    const payload = await decodePayload(write);
    const service = getVaultService();
    switch (write.kind) {
      case 'saveNote':
        await service.saveNote(text(payload, 'path'), text(payload, 'content'), number(payload, 'revision'));
        return;
      case 'createFile':
        await service.createFile(text(payload, 'parentPath'), text(payload, 'name'));
        return;
      case 'createFolder':
        await service.createFolder(text(payload, 'parentPath'), text(payload, 'name'));
        return;
      case 'renameNote':
        await service.renameNote(text(payload, 'path'), text(payload, 'newName'));
        return;
      case 'moveNote':
        await service.moveNote(text(payload, 'path'), text(payload, 'newParentPath'));
        return;
      case 'deleteNote':
        await service.deleteNote(text(payload, 'path'));
        return;
      case 'duplicateNote':
        await service.duplicateNote(text(payload, 'path'));
        return;
      case 'restoreNote':
        await service.restoreNote(text(payload, 'path'));
        return;
      default:
        throw new Error(`Unknown kind of write: ${String(write.kind)}`);
    }
  });
}
