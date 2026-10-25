import { describe, expect, it } from 'vitest';

import { KeyUnlockError } from '../../crypto/errors';
import { LIGHT_KDF_PARAMS } from '../../crypto/kdf';
import { SealedVault } from '../sealedVault';
import { FakeBackend } from './fakeBackend';

const PASSWORD = 'correct horse battery staple';

/** Creates a vault on a fresh fake backend. */
async function newVault(backend: FakeBackend): Promise<SealedVault> {
  const vault = new SealedVault({ fetchImpl: backend.fetch });
  await vault.create(PASSWORD, LIGHT_KDF_PARAMS);
  return vault;
}

describe('sealed vault', () => {
  it('round trips a note without ever writing the plaintext down', async () => {
    const backend = new FakeBackend();
    const vault = await newVault(backend);

    const secret = 'the lantern hides the river';
    await vault.saveNote('/notes/secret.md', secret);
    const read = await vault.readNote('/notes/secret.md');
    expect(read.content).toBe(secret);
    expect(read.path).toBe('/notes/secret.md');
    expect(read.revision).toBeGreaterThanOrEqual(1);

    // The backend only ever saw ciphertext.
    for (const bytes of backend.allBytes()) {
      expect(FakeBackend.containsText(bytes, secret)).toBe(false);
      expect(FakeBackend.containsText(bytes, 'secret.md')).toBe(false);
    }
  });

  it('keeps the note title out of the manifest bytes', async () => {
    const backend = new FakeBackend();
    const vault = await newVault(backend);
    await vault.saveNote('/journal/private-title.md', 'body text');

    const manifests = Array.from(backend.manifests.values());
    expect(manifests.length).toBeGreaterThan(0);
    for (const bytes of manifests) {
      expect(FakeBackend.containsText(bytes, 'private-title')).toBe(false);
      expect(FakeBackend.containsText(bytes, 'journal')).toBe(false);
    }
  });

  it('restores the tree after lock and unlock and rejects a wrong password', async () => {
    const backend = new FakeBackend();
    const vault = await newVault(backend);
    await vault.saveNote('/notes/one.md', 'first note');
    await vault.createFolder('/notes/sub');

    await vault.lock();
    expect(vault.isUnlocked()).toBe(false);

    const other = new SealedVault({ fetchImpl: backend.fetch });
    await expect(other.unlock('wrong password')).rejects.toBeInstanceOf(KeyUnlockError);

    await vault.unlock(PASSWORD);
    expect(vault.isUnlocked()).toBe(true);
    const tree = await vault.listTree();
    expect(tree.files.map((file) => file.path)).toContain('/notes/one.md');
    expect(tree.folders.map((folder) => folder.path)).toContain('/notes/sub');
    expect((await vault.readNote('/notes/one.md')).content).toBe('first note');
  });

  it('increases the generation on every save and keeps the last five', async () => {
    const backend = new FakeBackend();
    const vault = await newVault(backend);
    expect(backend.generations()).toEqual([1]);

    for (let i = 0; i < 8; i += 1) {
      await vault.saveNote('/notes/log.md', `revision ${i}`);
    }
    const generations = backend.generations();
    expect(generations).toEqual([5, 6, 7, 8, 9]);
    expect(generations.length).toBe(5);
    expect(generations[generations.length - 1]).toBe(9);
  });

  it('moves a note to the trash and restores it', async () => {
    const backend = new FakeBackend();
    const vault = await newVault(backend);
    await vault.saveNote('/notes/gone.md', 'still here');

    await vault.deleteNote('/notes/gone.md');
    const trash = await vault.listTrash();
    expect(trash.entries).toHaveLength(1);
    expect(trash.entries[0].path).toBe('/notes/gone.md');

    // The sealed object is kept: the deletion is only a manifest change.
    expect(backend.objects.size).toBeGreaterThan(0);

    await vault.restoreFromTrash('/notes/gone.md');
    expect((await vault.listTrash()).entries).toHaveLength(0);
    expect((await vault.readNote('/notes/gone.md')).content).toBe('still here');
  });

  it('finds a note by a word of its content', async () => {
    const backend = new FakeBackend();
    const vault = await newVault(backend);
    await vault.saveNote('/notes/searchable.md', 'a very memorable phrase lives here');

    const hits = await vault.search('memorable');
    expect(hits.length).toBe(1);
    expect(hits[0].path).toBe('/notes/searchable.md');
    expect(hits[0].kind).toBe('content');
    expect(hits[0].snippet.length).toBeGreaterThan(0);
  });

  it('reports a corrupted object by its id without throwing', async () => {
    const backend = new FakeBackend();
    const vault = await newVault(backend);
    await vault.saveNote('/notes/broken.md', 'content');

    const ids = Array.from(backend.objects.keys());
    expect(ids).toHaveLength(1);
    const corrupted = backend.objects.get(ids[0]);
    if (!corrupted) throw new Error('the object is missing');
    corrupted[corrupted.length - 1] ^= 0xff;

    const result = await vault.integrityCheck();
    expect(result.broken).toEqual([ids[0]]);
    expect(result.checked).toBeGreaterThan(0);
    // The report carries the object id, never the title of the note.
    expect(result.broken.join(',')).not.toContain('broken.md');
  });

  it('uploads and lists an attachment', async () => {
    const backend = new FakeBackend();
    const vault = await newVault(backend);
    const data = new TextEncoder().encode('attachment payload');
    const attachment = await vault.uploadAttachment('file.txt', data, 'text/plain', '/notes/a.md');

    const attachments = await vault.listAttachments();
    expect(attachments).toHaveLength(1);
    expect(attachments[0].id).toBe(attachment.id);
    expect(attachments[0].name).toBe('file.txt');
    expect(attachments[0].size).toBe(data.length);

    await vault.deleteAttachment(attachment.id);
    expect(await vault.listAttachments()).toHaveLength(0);
  });
});
