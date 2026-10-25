// The migration of an open storage into an encrypted one.
//
// The tests use a fake open pipeline and the fake sealed backend of the vault,
// so the whole migration runs without a server.

import { describe, expect, it } from 'vitest';

import { LIGHT_KDF_PARAMS } from '../core/crypto/kdf';
import { SealedVault } from '../core/vault/sealedVault';
import { FakeBackend } from '../core/vault/__tests__/fakeBackend';
import {
  canResumeMigration,
  migrateToSealed,
  purgePlaintextAfterMigration,
  readMigrationJournal,
  type OpenVaultApi,
} from '../core/vault/migration';
import type { MigrationProgress } from '../core/vault/migration';
import type { Attachment, NoteContent, Node, TreeResponse } from '../types';

const PASSWORD = 'correct horse battery staple';

/** Builds the node of a note of the fake tree. */
function nodeOf(path: string, content: string): Node {
  const at = path.lastIndexOf('/');
  return {
    id: path,
    name: path.slice(at + 1),
    path,
    type: 'file',
    parentPath: at <= 0 ? '/' : path.slice(0, at),
    size: content.length,
    modTime: '2024-01-01T00:00:00.000Z',
    revision: 1,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

/** The fake of the open pipeline. */
class FakeOpenApi implements OpenVaultApi {
  /** The notes of the open storage, by path. */
  readonly notes = new Map<string, string>();

  /** The paths of the notes that cannot be read. */
  readonly unreadable = new Set<string>();

  /** The paths of the notes that were read, in the order of the reads. */
  readonly reads: string[] = [];

  /** The number of the calls of `enableSealed`. */
  enabled = 0;

  /** The number of the calls of `purgePlaintext`. */
  purged = 0;

  /** Adds a note to the open storage. */
  add(path: string, content: string): void {
    this.notes.set(path, content);
  }

  async listTree(): Promise<TreeResponse> {
    const files = Array.from(this.notes.keys())
      .sort()
      .map((path) => nodeOf(path, this.notes.get(path) ?? ''));
    return { folders: [], files, noteTotal: files.length, folderTotal: 0 };
  }

  async readNote(path: string): Promise<NoteContent> {
    this.reads.push(path);
    if (this.unreadable.has(path)) throw new Error(`the note "${path}" cannot be read`);
    const content = this.notes.get(path);
    if (content === undefined) throw new Error(`the note "${path}" does not exist`);
    return {
      path,
      content,
      revision: 1,
      updatedAt: '2024-01-01T00:00:00.000Z',
      conflict: false,
    };
  }

  async listAttachments(): Promise<Attachment[]> {
    return [];
  }

  async enableSealed(): Promise<void> {
    this.enabled += 1;
  }

  async purgePlaintext(): Promise<{ deleted: number; bytes: number }> {
    this.purged += 1;
    return { deleted: 3, bytes: 42 };
  }
}

/** Runs a migration against a fake backend. */
function run(
  api: OpenVaultApi,
  backend: FakeBackend,
  onProgress?: (progress: MigrationProgress) => void,
  vault?: SealedVault,
) {
  return migrateToSealed({
    password: PASSWORD,
    openApi: api,
    vault,
    fetchImpl: backend.fetch,
    kdfParams: LIGHT_KDF_PARAMS,
    onProgress,
  });
}

describe('the migration of an open storage', () => {
  it('copies every note and never writes the plaintext down', async () => {
    const api = new FakeOpenApi();
    api.add('a.md', 'the first note of the vault');
    api.add('b.md', 'the second note of the vault');
    api.add('c.md', 'the third note of the vault');
    const backend = new FakeBackend();

    const result = await run(api, backend);

    expect(result.copied).toBe(3);
    expect(result.broken).toEqual([]);
    expect(result.purged).toBe(false);
    // The server was switched into the sealed mode.
    expect(api.enabled).toBe(1);
    // The plaintext was not removed: that is an explicit and separate step.
    expect(api.purged).toBe(0);

    // The backend only ever saw ciphertext.
    expect(backend.objects.size).toBeGreaterThan(0);
    for (const bytes of backend.allBytes()) {
      expect(FakeBackend.containsText(bytes, 'the first note of the vault')).toBe(false);
      expect(FakeBackend.containsText(bytes, 'a.md')).toBe(false);
    }
  });

  it('reports a corrupted object and does not switch the mode', async () => {
    const api = new FakeOpenApi();
    api.add('a.md', 'the content that will be corrupted');
    api.add('b.md', 'the content that stays intact');
    const backend = new FakeBackend();

    const result = await run(api, backend, (progress) => {
      // The objects exist when the verification starts: one of them is
      // corrupted on the fly.
      if (progress.phase !== 'verifying' || progress.copied !== 0) return;
      const ids = Array.from(backend.objects.keys());
      const corrupted = backend.objects.get(ids[0]);
      if (!corrupted) throw new Error('the object is missing');
      corrupted[corrupted.length - 1] ^= 0xff;
    });

    expect(result.broken).toHaveLength(1);
    expect(result.broken[0]).toMatch(/^[0-9a-f]{32}$/);
    // The report carries the object id, never the title of the note.
    expect(result.broken.join(',')).not.toContain('a.md');
    // The mode was not switched and the plaintext was not removed.
    expect(api.enabled).toBe(0);
    expect(api.purged).toBe(0);
  });

  it('removes the plaintext only on the explicit call', async () => {
    const api = new FakeOpenApi();
    api.add('a.md', 'the only note');
    const backend = new FakeBackend();

    await run(api, backend);
    expect(api.purged).toBe(0);

    const purged = await purgePlaintextAfterMigration({ openApi: api });
    expect(purged.deleted).toBe(3);
    expect(purged.bytes).toBe(42);
    expect(api.purged).toBe(1);

    // A second explicit call is a second call: the engine never repeats it.
    expect(api.purged).toBe(1);
  });

  it('resumes the migration and copies only the missing notes', async () => {
    const api = new FakeOpenApi();
    api.add('a.md', 'the first note');
    api.add('b.md', 'the note that cannot be read');
    api.add('c.md', 'the third note');
    api.unreadable.add('b.md');
    const backend = new FakeBackend();

    let readsAtVerification = 0;
    const vault = new SealedVault({ fetchImpl: backend.fetch });
    const first = await run(
      api,
      backend,
      (progress) => {
        if (progress.phase === 'verifying' && progress.copied === 0) {
          readsAtVerification = api.reads.length;
        }
      },
      vault,
    );

    // The note that could not be read is reported and the mode is not switched.
    expect(first.failedPaths).toEqual(['/b.md']);
    expect(first.copied).toBe(2);
    expect(api.enabled).toBe(0);
    expect(readsAtVerification).toBe(3);

    // The notes that were copied are still in the vault.
    await vault.unlock(PASSWORD);
    expect((await vault.readNote('/a.md')).content).toBe('the first note');
    expect((await vault.readNote('/c.md')).content).toBe('the third note');

    // The journal survives the crash and describes the state of the migration.
    const journal = await readMigrationJournal(vault);
    expect(journal).not.toBeNull();
    expect(journal?.copiedPaths).toEqual(['/a.md', '/c.md']);
    expect(canResumeMigration(journal)).toBe(true);

    // The second run copies the missing note only.
    api.unreadable.delete('b.md');
    api.reads.length = 0;
    readsAtVerification = 0;
    const second = await run(
      api,
      backend,
      (progress) => {
        if (progress.phase === 'verifying' && progress.copied === 0) {
          readsAtVerification = api.reads.length;
        }
      },
      vault,
    );

    expect(readsAtVerification).toBe(1);
    expect(api.reads[0]).toBe('b.md');
    expect(second.copied).toBe(3);
    expect(second.broken).toEqual([]);
    expect(api.enabled).toBe(1);
  });

  it('keeps the notes that were copied when a note fails', async () => {
    const api = new FakeOpenApi();
    api.add('good.md', 'the note that survives');
    api.add('bad.md', 'the note that fails');
    api.unreadable.add('bad.md');
    const backend = new FakeBackend();

    const result = await run(api, backend);

    expect(result.failedPaths).toEqual(['/bad.md']);
    expect(result.copied).toBe(1);

    const vault = new SealedVault({ fetchImpl: backend.fetch });
    await vault.unlock(PASSWORD);
    const tree = await vault.listTree();
    expect(tree.files.map((file) => file.path)).toEqual(['/good.md']);
    expect((await vault.readNote('/good.md')).content).toBe('the note that survives');
  });
});
