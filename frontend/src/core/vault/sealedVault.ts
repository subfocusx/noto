// The SEALED vault: the single read/write path of Noto when the storage is
// encrypted (zero-knowledge mode).
//
// Everything that leaves this module is already ciphertext. The backend
// stores blobs under random object ids and never sees a note title, a note
// body or a path. The key material and the decrypted manifest live in the
// memory of the tab only.
//
// The write order is always "objects first, manifest last": a crash may
// leave an orphan object, but it can never leave a manifest that points at
// a missing object.

import {
  createKeystore,
  unlockKeystore,
  type KeystoreFile,
  type KdfParams,
} from '../crypto/keys';
import {
  chunkCount,
  openBytes,
  openChunk,
  randomBytes,
  sealBytes,
  sealChunk,
} from '../crypto/sealed';
import { toHex } from '../crypto/format';
import type { Attachment, Node, NoteContent, SaveNoteResponse, TreeResponse, TrashResponse, SearchHit } from '../../types';
import { detectConflicts, mergeManifests, resolveManifestBranches } from './conflicts';
import { SealedClient } from './sealedClient';
import {
  buildIndex,
  createIndex,
  removeIndex,
  searchIndex,
  updateIndex,
  type IndexSource,
  type SearchIndex,
} from './sealedIndex';
import type {
  ManifestEntry,
  SealedManifest,
  SealedStatus,
  SealedVaultOptions,
} from './types';

/** The chunk size of a large (chunked) attachment. */
export const ATTACHMENT_CHUNK_BYTES = 4 * 1024 * 1024;

/** How many manifest generations are kept on the backend. */
export const MANIFEST_GENERATIONS_KEPT = 5;

/** The reserved folder that keeps the attachments out of the note tree. */
const ATTACHMENTS_PATH = '/.attachments';

/** The magic that marks a chunked container. */
const CONTAINER_MAGIC = [0x4e, 0x43, 0x54, 0x31] as const; // "NCT1"

/**
 * The loose shape of the result of `unlockKeystore` and `createKeystore`.
 *
 * The crypto core owns the exact names; the vault only needs a key and the
 * epoch it belongs to.
 */
interface UnlockResult {
  dek?: CryptoKey;
  key?: CryptoKey;
  epoch?: number;
  keystore?: KeystoreFile;
}

import {
  baseNameOf,
  joinPath,
  normalizePath,
  parentPathOf,
  ROOT,
} from './paths';

export { baseNameOf, joinPath, normalizePath, parentPathOf };

/** True when the path belongs to the reserved attachments folder. */
function isAttachmentPath(path: string): boolean {
  return path === ATTACHMENTS_PATH || path.startsWith(`${ATTACHMENTS_PATH}/`);
}

/** Encodes a text into UTF-8 bytes. */
function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Decodes UTF-8 bytes into a text. */
function decodeText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** Concatenates byte chunks into a single buffer. */
function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * The SEALED vault.
 *
 * The instance holds the data key, the decrypted manifest and the search
 * index in memory. `lock()` drops all of them.
 */
export class SealedVault {
  private readonly client: SealedClient;

  /** The data key of the vault, `null` while the vault is locked. */
  private dek: CryptoKey | null = null;

  /** The epoch the data key belongs to. */
  private epoch = 0;

  /** The decrypted manifest, `null` while the vault is locked. */
  private manifest: SealedManifest | null = null;

  /** The in-memory full text index, `null` while the vault is locked. */
  private index: SearchIndex | null = null;

  constructor(options: SealedVaultOptions = {}) {
    this.client = new SealedClient({
      apiBase: options.apiBase,
      fetchImpl: options.fetchImpl,
    });
  }

  /** The status of the backend, as reported by the sealed backend. */
  status(): Promise<SealedStatus> {
    return this.client.status();
  }

  /** True when the vault holds the key material and can serve requests. */
  isUnlocked(): boolean {
    return this.dek !== null && this.manifest !== null;
  }

  /**
   * Unlocks the vault with the user password.
   *
   * The password is never stored: it only derives the key encryption key
   * that unwraps the data key of the keystore.
   */
  async unlock(password: string): Promise<void> {
    const keystore = await this.client.getKeystore();
    const result = (await unlockKeystore(password, keystore)) as UnlockResult;
    const key = result.dek ?? result.key;
    if (!key) throw new Error('the keystore did not yield a data key');
    this.dek = key;
    this.epoch = result.epoch ?? 0;

    const generations = await this.client.listGenerations();
    const newest = generations.length > 0 ? Math.max(...generations) : 0;
    if (newest > 0) {
      const bytes = await this.client.getManifest(newest);
      const manifest = await this.decodeManifest(bytes);
      manifest.generation = Math.max(manifest.generation, newest);
      this.manifest = manifest;
    } else {
      this.manifest = this.emptyManifest();
    }
    await this.rebuildIndex();
  }

  /**
   * Locks the vault: the key material, the manifest and the index are
   * dropped from the memory of the tab.
   */
  async lock(): Promise<void> {
    this.dek = null;
    this.epoch = 0;
    this.manifest = null;
    this.index = null;
  }

  /**
   * Creates a new sealed vault: a fresh keystore, an empty manifest of the
   * generation 1 and both uploaded to the backend.
   */
  async create(password: string, params?: KdfParams): Promise<void> {
    const created = (await createKeystore(password, params)) as UnlockResult;
    const keystore = created.keystore;
    if (!keystore) throw new Error('the keystore was not created');
    await this.client.putKeystore(keystore);

    let key = created.dek ?? created.key;
    let epoch = created.epoch ?? 0;
    if (!key) {
      const result = (await unlockKeystore(password, keystore)) as UnlockResult;
      key = result.dek ?? result.key;
      epoch = result.epoch ?? epoch;
    }
    if (!key) throw new Error('the keystore did not yield a data key');
    this.dek = key;
    this.epoch = epoch;
    this.manifest = this.emptyManifest();
    this.index = createIndex();
    await this.commitManifest();
  }

  /**
   * Saves the content of a note.
   *
   * The content is encrypted under a NEW random object id on every save, so
   * the backend cannot tell whether a note was written twice or how many
   * revisions it has.
   */
  async saveNote(path: string, content: string): Promise<SaveNoteResponse> {
    const manifest = this.requireManifest();
    const key = this.requireKey();
    const normalized = normalizePath(path);
    const entry = this.findEntry(normalized);
    const now = new Date().toISOString();

    const contentId = await this.newObjectId();
    const bytes = encodeText(content);
    const sealed = await sealBytes(key, bytes, this.epoch);
    await this.client.putObject(contentId, sealed);

    if (entry) {
      entry.contentId = contentId;
      entry.id = contentId;
      entry.size = bytes.length;
      entry.revision += 1;
      entry.updatedAt = now;
      entry.modTime = now;
    } else {
      manifest.entries.push({
        id: contentId,
        type: 'file',
        name: baseNameOf(normalized),
        path: normalized,
        parentPath: parentPathOf(normalized),
        size: bytes.length,
        modTime: now,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        contentId,
      });
    }
    this.indexContent(normalized, content);
    await this.commitManifest();

    const saved = this.findEntry(normalized);
    return {
      path: normalized,
      revision: saved?.revision ?? 1,
      updatedAt: saved?.updatedAt ?? now,
    };
  }

  /** Reads and decrypts the content of a note. */
  async readNote(path: string): Promise<NoteContent> {
    const normalized = normalizePath(path);
    const entry = this.requireEntry(normalized);
    if (!entry.contentId) throw new Error(`the note "${normalized}" has no content`);
    const key = this.requireKey();
    const bytes = await this.client.getObject(entry.contentId);
    const plain = await this.openObject(key, bytes);
    return {
      path: normalized,
      content: decodeText(plain),
      revision: entry.revision,
      updatedAt: entry.updatedAt,
      conflict: false,
    };
  }

  /** Builds the tree of the folders and the files of the vault. */
  async listTree(): Promise<TreeResponse> {
    const manifest = this.requireManifest();
    const folders: Node[] = [];
    const files: Node[] = [];
    for (const entry of manifest.entries) {
      if (isAttachmentPath(entry.path)) continue;
      const node = this.toNode(entry);
      if (entry.type === 'folder') folders.push(node);
      else files.push(node);
    }
    this.fillCounts(manifest, folders);
    return {
      folders,
      files,
      noteTotal: files.length,
      folderTotal: folders.length,
    };
  }

  /** Creates a folder and seals its metadata object. */
  async createFolder(path: string): Promise<Node> {
    const manifest = this.requireManifest();
    const key = this.requireKey();
    const normalized = normalizePath(path);
    if (this.findEntry(normalized)) throw new Error(`"${normalized}" already exists`);

    const now = new Date().toISOString();
    const id = await this.newObjectId();
    const metadata = encodeText(JSON.stringify({ type: 'folder', name: baseNameOf(normalized), path: normalized }));
    await this.client.putObject(id, await sealBytes(key, metadata, this.epoch));

    const entry: ManifestEntry = {
      id,
      type: 'folder',
      name: baseNameOf(normalized),
      path: normalized,
      parentPath: parentPathOf(normalized),
      size: 0,
      modTime: now,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    manifest.entries.push(entry);
    await this.commitManifest();
    return this.toNode(entry);
  }

  /** Creates a note with an optional initial content. */
  async createFile(path: string, content = ''): Promise<Node> {
    const manifest = this.requireManifest();
    const key = this.requireKey();
    const normalized = normalizePath(path);
    if (this.findEntry(normalized)) throw new Error(`"${normalized}" already exists`);

    const now = new Date().toISOString();
    const contentId = await this.newObjectId();
    const bytes = encodeText(content);
    await this.client.putObject(contentId, await sealBytes(key, bytes, this.epoch));

    const entry: ManifestEntry = {
      id: contentId,
      type: 'file',
      name: baseNameOf(normalized),
      path: normalized,
      parentPath: parentPathOf(normalized),
      size: bytes.length,
      modTime: now,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      contentId,
    };
    manifest.entries.push(entry);
    this.indexContent(normalized, content);
    await this.commitManifest();
    return this.toNode(entry);
  }

  /** Renames a note (or a folder) and moves its descendants with it. */
  async renameNote(path: string, newName: string): Promise<Node> {
    const manifest = this.requireManifest();
    const normalized = normalizePath(path);
    const entry = this.requireEntry(normalized);
    const now = new Date().toISOString();
    const newPath = joinPath(entry.parentPath, newName);
    this.moveEntryPaths(manifest, entry, newPath, entry.parentPath, now);
    await this.commitManifest();
    return this.toNode(entry);
  }

  /** Moves a note (or a folder) under another folder. */
  async moveNode(path: string, newParentPath: string): Promise<Node> {
    const manifest = this.requireManifest();
    const normalized = normalizePath(path);
    const entry = this.requireEntry(normalized);
    const parent = normalizePath(newParentPath);
    const now = new Date().toISOString();
    const newPath = joinPath(parent, entry.name);
    this.moveEntryPaths(manifest, entry, newPath, parent, now);
    await this.commitManifest();
    return this.toNode(entry);
  }

  /**
   * Moves a note (or a folder) into the trash.
   *
   * The sealed objects are kept: the user can still restore the note, and
   * the backend learns nothing about the deletion.
   */
  async deleteNote(path: string): Promise<void> {
    const manifest = this.requireManifest();
    const normalized = normalizePath(path);
    const entry = this.requireEntry(normalized);
    const now = new Date().toISOString();

    const removed = this.removeEntriesUnder(manifest, normalized);
    manifest.trash.push({
      id: entry.id,
      type: entry.type,
      name: entry.name,
      path: normalized,
      originalPath: normalized,
      deletedAt: now,
      contentId: entry.contentId,
    });
    for (const gone of removed) {
      if (gone.type === 'file') removeIndex(this.requireIndex(), gone.path);
    }
    await this.commitManifest();
  }

  /** Lists the notes waiting in the trash. */
  async listTrash(): Promise<TrashResponse> {
    const manifest = this.requireManifest();
    const entries: Node[] = manifest.trash.map((item) => ({
      id: item.id,
      name: item.name,
      path: item.path,
      type: item.type,
      parentPath: '',
      size: 0,
      modTime: item.deletedAt,
      revision: 1,
      createdAt: item.deletedAt,
      updatedAt: item.deletedAt,
    }));
    return { entries };
  }

  /** Restores a note from the trash under its original path. */
  async restoreFromTrash(originalPath: string): Promise<Node> {
    const manifest = this.requireManifest();
    const normalized = normalizePath(originalPath);
    const at = manifest.trash.findIndex((item) => item.originalPath === normalized);
    if (at < 0) throw new Error(`"${normalized}" is not in the trash`);
    const [item] = manifest.trash.splice(at, 1);

    const now = new Date().toISOString();
    const entry: ManifestEntry = {
      id: item.id,
      type: item.type,
      name: item.name,
      path: normalized,
      parentPath: parentPathOf(normalized),
      size: 0,
      modTime: now,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    if (item.contentId) entry.contentId = item.contentId;
    manifest.entries.push(entry);
    await this.commitManifest();

    if (entry.type === 'file' && entry.contentId) {
      const key = this.requireKey();
      const bytes = await this.client.getObject(entry.contentId);
      this.indexContent(normalized, decodeText(await this.openObject(key, bytes)));
    }
    return this.toNode(entry);
  }

  /** Removes a note from the trash for good and destroys its objects. */
  async deleteForever(originalPath: string): Promise<void> {
    const manifest = this.requireManifest();
    const normalized = normalizePath(originalPath);
    const at = manifest.trash.findIndex((item) => item.originalPath === normalized);
    if (at < 0) throw new Error(`"${normalized}" is not in the trash`);
    const [item] = manifest.trash.splice(at, 1);

    const ids = new Set<string>();
    if (item.contentId) ids.add(item.contentId);
    if (item.type === 'folder') {
      for (const entry of manifest.entries) {
        if (entry.path.startsWith(`${normalized}/`)) {
          if (entry.contentId) ids.add(entry.contentId);
          ids.add(entry.id);
        }
      }
    } else {
      ids.add(item.id);
    }
    for (const id of ids) {
      await this.client.deleteObject(id);
    }
    await this.commitManifest();
  }

  /** Searches the decrypted notes of the vault. */
  async search(query: string, limit = 20): Promise<SearchHit[]> {
    const index = this.requireIndex();
    return searchIndex(index, query, limit);
  }

  /** Lists the attachments of the vault. */
  async listAttachments(): Promise<Attachment[]> {
    const manifest = this.requireManifest();
    const key = this.requireKey();
    const attachments: Attachment[] = [];
    for (const entry of manifest.entries) {
      if (!isAttachmentPath(entry.path)) continue;
      if (entry.type !== 'file') continue;
      const bytes = await this.client.getObject(entry.id);
      const plain = decodeText(await this.openObject(key, bytes));
      const meta = JSON.parse(plain) as {
        name?: string;
        mime?: string;
        size?: number;
        notePath?: string;
        createdAt?: string;
      };
      attachments.push({
        id: entry.id,
        name: meta.name ?? entry.name,
        mime: meta.mime ?? 'application/octet-stream',
        size: meta.size ?? entry.size,
        notePath: meta.notePath,
        createdAt: meta.createdAt ?? entry.createdAt,
      });
    }
    return attachments;
  }

  /**
   * Uploads an attachment.
   *
   * A file bigger than 4 MiB is split into chunks; each chunk is sealed on
   * its own and the frames are stored in one object.
   */
  async uploadAttachment(
    name: string,
    data: Uint8Array,
    mime = 'application/octet-stream',
    notePath?: string,
  ): Promise<Attachment> {
    const manifest = this.requireManifest();
    const key = this.requireKey();
    const now = new Date().toISOString();

    const id = await this.newObjectId();
    const meta = {
      name,
      mime,
      size: data.length,
      notePath,
      createdAt: now,
    };
    await this.client.putObject(id, await sealBytes(key, encodeText(JSON.stringify(meta)), this.epoch));

    const contentId = await this.newObjectId();
    await this.client.putObject(contentId, await this.sealContainer(key, data));

    if (!this.findEntry(ATTACHMENTS_PATH)) {
      const folderId = await this.newObjectId();
      const folderMeta = encodeText(
        JSON.stringify({ type: 'folder', name: '.attachments', path: ATTACHMENTS_PATH }),
      );
      await this.client.putObject(folderId, await sealBytes(key, folderMeta, this.epoch));
      manifest.entries.push({
        id: folderId,
        type: 'folder',
        name: '.attachments',
        path: ATTACHMENTS_PATH,
        parentPath: ROOT,
        size: 0,
        modTime: now,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      });
    }
    manifest.entries.push({
      id,
      type: 'file',
      name: id,
      path: `${ATTACHMENTS_PATH}/${id}`,
      parentPath: ATTACHMENTS_PATH,
      size: data.length,
      modTime: now,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      contentId,
    });
    await this.commitManifest();
    return { id, name, mime, size: data.length, notePath, createdAt: now };
  }

  /** Removes an attachment and destroys its sealed objects. */
  async deleteAttachment(id: string): Promise<void> {
    const manifest = this.requireManifest();
    const entry = manifest.entries.find((item) => item.id === id && isAttachmentPath(item.path));
    if (!entry) throw new Error(`the attachment "${id}" does not exist`);
    manifest.entries = manifest.entries.filter((item) => item !== entry);
    await this.client.deleteObject(entry.id);
    if (entry.contentId) await this.client.deleteObject(entry.contentId);
    await this.commitManifest();
  }

  /**
   * Re-reads every object of the manifest and tries to decrypt it.
   *
   * A broken object is reported by its object id only: the note title must
   * never leak into an error message or into a log.
   */
  /**
   * Seals a payload with the key of the storage.
   *
   * The local drafts of an encrypted storage must not be readable in the
   * clear: they are sealed with the very key that seals the notes.
   */
  async sealPayload(payload: Uint8Array): Promise<Uint8Array> {
    return sealBytes(this.requireKey(), payload, this.epoch);
  }

  /** Opens a payload that was sealed with {@link sealPayload}. */
  async openPayload(container: Uint8Array): Promise<Uint8Array> {
    return openBytes(this.requireKey(), container);
  }

  async integrityCheck(): Promise<{ checked: number; broken: string[] }> {
    const manifest = this.requireManifest();
    const key = this.requireKey();
    const ids = new Set<string>();
    for (const entry of manifest.entries) {
      if (entry.contentId) ids.add(entry.contentId);
      ids.add(entry.id);
    }
    const broken: string[] = [];
    let checked = 0;
    for (const id of ids) {
      checked += 1;
      try {
        const bytes = await this.client.getObject(id);
        await this.openObject(key, bytes);
      } catch {
        broken.push(id);
      }
    }
    return { checked, broken };
  }

  /**
   * Returns the manifest generations that exist on the backend but are
   * unknown to the local vault (branches created by a sync service).
   */
  async listRemoteBranches(): Promise<number[]> {
    const manifest = this.requireManifest();
    return detectConflicts(this.client, [manifest.generation]);
  }

  /**
   * Merges the given manifest branches into the local manifest.
   *
   * The newest branch wins; the other ones are merged conservatively and
   * the diverging content ids are reported in `manifest.conflicts`.
   */
  async mergeBranches(branches: SealedManifest[]): Promise<SealedManifest> {
    const manifest = this.requireManifest();
    const { manifest: winner, conflicts } = resolveManifestBranches([manifest, ...branches]);
    let merged = winner;
    for (const conflict of conflicts) merged = mergeManifests(merged, conflict);
    this.manifest = merged;
    await this.commitManifest();
    await this.rebuildIndex();
    return merged;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Returns the manifest or fails when the vault is locked. */
  private requireManifest(): SealedManifest {
    if (!this.manifest) throw new Error('the sealed vault is locked');
    return this.manifest;
  }

  /** Returns the data key or fails when the vault is locked. */
  private requireKey(): CryptoKey {
    if (!this.dek) throw new Error('the sealed vault is locked');
    return this.dek;
  }

  /** Returns the index or fails when the vault is locked. */
  private requireIndex(): SearchIndex {
    if (!this.index) throw new Error('the sealed vault is locked');
    return this.index;
  }

  /** Builds an empty manifest of the current format. */
  private emptyManifest(): SealedManifest {
    return {
      format: 1,
      generation: 0,
      createdAt: new Date().toISOString(),
      epoch: this.epoch,
      entries: [],
      trash: [],
    };
  }

  /** Decrypts the manifest bytes and parses the JSON. */
  private async decodeManifest(bytes: Uint8Array): Promise<SealedManifest> {
    const key = this.requireKey();
    const plain = decodeText(await openBytes(key, bytes));
    const manifest = JSON.parse(plain) as SealedManifest;
    manifest.entries = manifest.entries ?? [];
    manifest.trash = manifest.trash ?? [];
    return manifest;
  }

  /**
   * Writes the manifest as the next generation and drops the old ones.
   *
   * The objects are always written before the manifest, so the manifest
   * never points at a missing object.
   */
  private async commitManifest(): Promise<void> {
    const manifest = this.requireManifest();
    const key = this.requireKey();
    manifest.generation += 1;
    manifest.createdAt = new Date().toISOString();
    manifest.epoch = this.epoch;
    const bytes = encodeText(JSON.stringify(manifest));
    await this.client.putManifest(manifest.generation, await sealBytes(key, bytes, this.epoch));
    await this.pruneGenerations();
  }

  /** Keeps the last {@link MANIFEST_GENERATIONS_KEPT} generations. */
  private async pruneGenerations(): Promise<void> {
    const generations = (await this.client.listGenerations()).slice().sort((a, b) => a - b);
    const keep = generations.slice(-MANIFEST_GENERATIONS_KEPT);
    for (const generation of generations) {
      if (!keep.includes(generation)) await this.client.deleteManifest(generation);
    }
  }

  /** Finds an entry by its path. */
  private findEntry(path: string): ManifestEntry | undefined {
    return this.requireManifest().entries.find((entry) => entry.path === path);
  }

  /** Finds an entry by its path or fails. */
  private requireEntry(path: string): ManifestEntry {
    const entry = this.findEntry(path);
    if (!entry) throw new Error(`"${path}" does not exist`);
    return entry;
  }

  /** Generates a fresh random object id (32 lowercase hex characters). */
  private async newObjectId(): Promise<string> {
    return toHex(await randomBytes(16));
  }

  /** Converts a manifest entry into a node of the tree. */
  private toNode(entry: ManifestEntry): Node {
    return {
      id: entry.id,
      name: entry.name,
      path: entry.path,
      type: entry.type,
      parentPath: entry.parentPath,
      size: entry.size,
      modTime: entry.modTime,
      revision: entry.revision,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  }

  /** Fills the recursive note counters of the folders. */
  private fillCounts(manifest: SealedManifest, folders: Node[]): void {
    const byParent = new Map<string, ManifestEntry[]>();
    for (const entry of manifest.entries) {
      const list = byParent.get(entry.parentPath) ?? [];
      list.push(entry);
      byParent.set(entry.parentPath, list);
    }
    const countNotes = (path: string, seen: Set<string>): number => {
      if (seen.has(path)) return 0;
      seen.add(path);
      let notes = 0;
      let childFolders = 0;
      for (const child of byParent.get(path) ?? []) {
        if (child.type === 'file') notes += 1;
        else {
          childFolders += 1;
          notes += countNotes(child.path, seen);
        }
      }
      const entry = manifest.entries.find((item) => item.path === path);
      if (entry) {
        entry.noteCount = notes;
        entry.folderCount = childFolders;
      }
      return notes;
    };
    for (const folder of folders) {
      const node = manifest.entries.find((item) => item.path === folder.path);
      if (!node) continue;
      const count = countNotes(folder.path, new Set<string>());
      folder.noteCount = count;
      folder.folderCount = node.folderCount ?? 0;
    }
  }

  /** Adds the content of a note to the in-memory index. */
  private indexContent(path: string, content: string): void {
    const index = this.requireIndex();
    const entry = this.findEntry(path);
    updateIndex(index, path, content, entry?.name ?? baseNameOf(path));
  }

  /** Rebuilds the whole index from the decrypted content of the notes. */
  private async rebuildIndex(): Promise<void> {
    const manifest = this.requireManifest();
    const key = this.requireKey();
    const sources: IndexSource[] = [];
    for (const entry of manifest.entries) {
      if (entry.type !== 'file' || !entry.contentId) continue;
      if (isAttachmentPath(entry.path)) continue;
      try {
        const bytes = await this.client.getObject(entry.contentId);
        sources.push({
          path: entry.path,
          name: entry.name,
          content: decodeText(await this.openObject(key, bytes)),
        });
      } catch {
        // A broken object must not stop the vault from being unlocked: the
        // integrity check reports it later.
      }
    }
    this.index = buildIndex(sources);
  }

  /** Moves an entry (and its descendants) to a new path. */
  private moveEntryPaths(
    manifest: SealedManifest,
    entry: ManifestEntry,
    newPath: string,
    newParentPath: string,
    now: string,
  ): void {
    const oldPath = entry.path;
    entry.path = newPath;
    entry.parentPath = newParentPath;
    entry.name = baseNameOf(newPath);
    entry.updatedAt = now;
    entry.modTime = now;
    for (const descendant of manifest.entries) {
      if (!descendant.path.startsWith(`${oldPath}/`)) continue;
      descendant.path = joinPath(newPath, descendant.path.slice(oldPath.length + 1));
      descendant.parentPath = joinPath(newPath, descendant.parentPath.slice(oldPath.length + 1));
      descendant.updatedAt = now;
      descendant.modTime = now;
    }
  }

  /** Removes an entry and every descendant of the entry from the manifest. */
  private removeEntriesUnder(manifest: SealedManifest, path: string): ManifestEntry[] {
    const removed = manifest.entries.filter(
      (entry) => entry.path === path || entry.path.startsWith(`${path}/`),
    );
    manifest.entries = manifest.entries.filter(
      (entry) => entry.path !== path && !entry.path.startsWith(`${path}/`),
    );
    return removed;
  }

  /** Seals a payload that is bigger than the chunk size. */
  private async sealContainer(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
    const frames: number[] = [...CONTAINER_MAGIC];
    const size = data.length;
    const count = size === 0 ? 1 : chunkCount(size, ATTACHMENT_CHUNK_BYTES);
    for (let i = 0; i < count; i += 1) {
      const start = i * ATTACHMENT_CHUNK_BYTES;
      const chunk = data.slice(start, Math.min(size, start + ATTACHMENT_CHUNK_BYTES));
      const sealed = await sealChunk(key, chunk, this.epoch, i);
      frames.push(
        (sealed.length >>> 24) & 0xff,
        (sealed.length >>> 16) & 0xff,
        (sealed.length >>> 8) & 0xff,
        sealed.length & 0xff,
      );
      frames.push(...sealed);
    }
    return new Uint8Array(frames);
  }

  /**
   * Opens a stored object.
   *
   * A chunked container is detected by its magic and opened chunk by chunk;
   * every other object is a plain sealed blob.
   */
  private async openObject(key: CryptoKey, bytes: Uint8Array): Promise<Uint8Array> {
    if (!this.isContainer(bytes)) return openBytes(key, bytes);
    const parts: Uint8Array[] = [];
    let offset = CONTAINER_MAGIC.length;
    let index = 0;
    while (offset + 4 <= bytes.length) {
      const length =
        ((bytes[offset] << 24) |
          (bytes[offset + 1] << 16) |
          (bytes[offset + 2] << 8) |
          bytes[offset + 3]) >>>
        0;
      offset += 4;
      if (length < 0 || offset + length > bytes.length) break;
      const frame = bytes.slice(offset, offset + length);
      offset += length;
      parts.push(await openChunk(key, frame, index));
      index += 1;
    }
    return concatBytes(parts);
  }

  /** True when the bytes are a chunked container. */
  private isContainer(bytes: Uint8Array): boolean {
    if (bytes.length < CONTAINER_MAGIC.length) return false;
    for (let i = 0; i < CONTAINER_MAGIC.length; i += 1) {
      if (bytes[i] !== CONTAINER_MAGIC[i]) return false;
    }
    return true;
  }
}
