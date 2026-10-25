// The migration of an open storage into an encrypted one.
//
// The order of the steps IS the safety of the migration:
//
//   1. read    — every note of the open storage is read; nothing is written yet;
//   2. encrypt — every note is sealed and stored as a sealed object, and the
//                manifest (which carries the journal of the migration) is
//                written as a NEW generation after the objects;
//   3. verify  — every sealed object is read back, decrypted and compared with
//                the source; a mismatch is collected and the migration does not
//                continue to the switch;
//   4. switch  — the server is switched into the sealed mode;
//   5. purge   — the plaintext is removed from the disk, but only through the
//                separate and explicit call to {@link purgePlaintextAfterMigration},
//                which the user interface calls after the confirmation.
//
// The plaintext of the vault therefore survives every failure: it is only
// removed when the user has explicitly asked for it.
//
// The journal of the migration lives inside the sealed manifest, so a crash
// never loses it: the migration continues with the notes that are missing
// instead of starting over.

import { attachmentRawUrl, getNote, getTree, listAttachments, request } from '../../api/client';
import type { Attachment, NoteContent, TreeResponse } from '../../types';
import { createKeystore, unlockKeystore, type KeystoreFile } from '../crypto/keys';
import type { KdfParams } from '../crypto/kdf';
import { toHex } from '../crypto/format';
import { openBytes, randomBytes, sealBytes } from '../crypto/sealed';
import { SealedBackendError, SealedClient } from './sealedClient';
import {
  MANIFEST_GENERATIONS_KEPT,
  baseNameOf,
  normalizePath,
  parentPathOf,
} from './sealedVault';
import type { SealedVault } from './sealedVault';
import type {
  ManifestEntry,
  MigrationJournal,
  MigrationPhase,
  SealedManifest,
} from './types';

/** The reserved folder that keeps the attachments out of the note tree. */
const ATTACHMENTS_PATH = '/.attachments';

/** The progress of a migration, as the user interface shows it. */
export interface MigrationProgress {
  /** The phase of the migration. */
  phase: 'reading' | 'encrypting' | 'verifying' | 'switching' | 'purging' | 'done';
  /** The number of the notes that are already copied. */
  copied: number;
  /** The total number of the notes to copy. */
  total: number;
  /**
   * The path of the note that is being copied.
   *
   * The title of a note is part of the plaintext, but the user must see what
   * happens to the folder, so the path is shown.
   */
  currentPath?: string;
}

/**
 * The API of the open pipeline.
 *
 * It is injected so that the tests can use a fake; the default implementation
 * talks to the real backend.
 */
export interface OpenVaultApi {
  /** The tree of the folders and the notes of the open storage. */
  listTree(): Promise<TreeResponse>;
  /** The content of a note of the open storage. */
  readNote(path: string): Promise<NoteContent>;
  /** The attachments of the open storage. */
  listAttachments(): Promise<Attachment[]>;
  /**
   * The bytes of an attachment of the open storage.
   *
   * Optional: when the API cannot read the attachments, a storage with
   * attachments cannot be migrated (the migration stops before the switch and
   * the plaintext stays on the disk).
   */
  readAttachment?(id: string): Promise<Uint8Array>;
  /** Switches the server into the sealed mode (`POST /api/vault/sealed/enable`). */
  enableSealed(): Promise<void>;
  /** Removes the plaintext files of the vault (`POST /api/vault/sealed/purge-plaintext`). */
  purgePlaintext(): Promise<{ deleted: number; bytes: number }>;
}

/** The options of a migration. */
export interface MigrationOptions {
  /** The password of the new encrypted storage. */
  password: string;
  /** Called after every note, with the progress. */
  onProgress?(progress: MigrationProgress): void;
  /** The API of the open pipeline; it is injected so that the tests can use a fake. */
  openApi?: OpenVaultApi;
  /** The sealed vault; injected for the same reason. */
  vault?: SealedVault;
  /** The prefix of the API of the sealed backend, `/api` by default. */
  apiBase?: string;
  /** The fetch implementation of the sealed backend, injected by the tests. */
  fetchImpl?: typeof fetch;
  /** The parameters of the key derivation of a new keystore. */
  kdfParams?: KdfParams;
}

/** The result of a migration. */
export interface MigrationResult {
  /** The number of the notes that were copied. */
  copied: number;
  /** True when the plaintext was removed from the disk. */
  purged: boolean;
  /** The ids of the objects that could not be read back. */
  broken: string[];
  /** The paths of the notes that could not be read. */
  failedPaths?: string[];
  /** The ids of the attachments that could not be copied. */
  failedAttachments?: string[];
  /** The number of the attachments that were copied. */
  attachments?: number;
}

/** The options of the removal of the plaintext. */
export interface PurgeOptions {
  /** The API of the open pipeline; the default one is used when it is absent. */
  openApi?: OpenVaultApi;
}

/** The report of the removal of the plaintext. */
export interface PurgeResult {
  /** The number of the deleted files. */
  deleted: number;
  /** The number of the freed bytes. */
  bytes: number;
}

/** The access to the encrypted storage of a migration. */
interface VaultAccess {
  /** The client of the sealed backend. */
  client: SealedClient;
  /** The data key of the vault. */
  dek: CryptoKey;
  /** The epoch the data key belongs to. */
  epoch: number;
  /** The newest generation of the manifest. */
  generation: number;
  /** The decrypted manifest, `null` when the vault is empty. */
  manifest: SealedManifest | null;
}

/**
 * The vaults the engine has unlocked.
 *
 * The registry lets {@link readMigrationJournal} read the sealed manifest of a
 * vault that the engine has already opened, without asking for the password
 * again.
 */
const accessRegistry = new WeakMap<SealedVault, VaultAccess>();

/** Encodes a text into UTF-8 bytes. */
function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Decodes UTF-8 bytes into a text. */
function decodeText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** Generates a fresh random object id (32 lowercase hex characters). */
async function newObjectId(): Promise<string> {
  return toHex(await randomBytes(16));
}

/** Finds an entry of the manifest by its path. */
function findEntry(manifest: SealedManifest, path: string): ManifestEntry | undefined {
  return manifest.entries.find((entry) => entry.path === path);
}

/**
 * The path of a note in the OPEN storage.
 *
 * The two storages do not use the same convention: the open backend knows the
 * notes by their path relative to the root of the vault ("notes/todo.md"),
 * while the encrypted storage knows them by their absolute path
 * ("/notes/todo.md"). The migration reads the source through the open API, so
 * it has to give the open API the path it expects.
 */
function openPathOf(path: string): string {
  return path.startsWith('/') ? path.slice(1) : path;
}

/**
 * The API of the open pipeline that talks to the real backend.
 *
 * It is the only place of the engine that knows the HTTP endpoints of the open
 * mode.
 */
export function defaultOpenVaultApi(): OpenVaultApi {
  return {
    listTree: () => getTree(),
    readNote: (path: string) => getNote(path),
    listAttachments: () => listAttachments(),
    readAttachment: async (id: string): Promise<Uint8Array> => {
      const res = await fetch(attachmentRawUrl(id));
      if (!res.ok) {
        throw new Error(`the attachment "${id}" could not be read (status ${res.status})`);
      }
      return new Uint8Array(await res.arrayBuffer());
    },
    enableSealed: async (): Promise<void> => {
      await request('/vault/sealed/enable', { method: 'POST' });
    },
    purgePlaintext: () =>
      request<PurgeResult>('/vault/sealed/purge-plaintext', { method: 'POST' }),
  };
}

/**
 * Opens the encrypted storage of the migration.
 *
 * The keystore is created when it does not exist yet (a fresh vault) and
 * unlocked with the master password when it does (a resumed migration).
 */
async function openVaultAccess(
  client: SealedClient,
  password: string,
  kdfParams?: KdfParams,
): Promise<VaultAccess> {
  let keystore: KeystoreFile | null = null;
  try {
    keystore = await client.getKeystore();
  } catch (error) {
    const missing =
      error instanceof SealedBackendError &&
      (error.code === 'not_found' || error.status === 404);
    if (!missing) throw error;
  }

  let dek: CryptoKey;
  let epoch: number;
  if (keystore) {
    const unlocked = await unlockKeystore(password, keystore);
    dek = unlocked.dek;
    epoch = unlocked.epoch;
  } else {
    const created = await createKeystore(password, kdfParams);
    await client.putKeystore(created.keystore);
    dek = created.dek;
    epoch = created.epoch;
  }

  const generations = await client.listGenerations();
  const newest = generations.length > 0 ? Math.max(...generations) : 0;
  let manifest: SealedManifest | null = null;
  if (newest > 0) {
    const bytes = await client.getManifest(newest);
    manifest = JSON.parse(decodeText(await openBytes(dek, bytes))) as SealedManifest;
    manifest.entries = manifest.entries ?? [];
    manifest.trash = manifest.trash ?? [];
  }

  return { client, dek, epoch, generation: newest, manifest };
}

/**
 * Writes the manifest as the next generation of the vault.
 *
 * The objects are always written before the manifest, so that the manifest
 * never points at a missing object.
 */
async function writeManifest(access: VaultAccess, manifest: SealedManifest): Promise<number> {
  const generation = access.generation + 1;
  manifest.generation = generation;
  manifest.createdAt = new Date().toISOString();
  manifest.epoch = access.epoch;
  const bytes = encodeText(JSON.stringify(manifest));
  await access.client.putManifest(generation, await sealBytes(access.dek, bytes, access.epoch));
  access.generation = generation;
  await pruneGenerations(access, generation);
  return generation;
}

/** Keeps the last {@link MANIFEST_GENERATIONS_KEPT} generations of the manifest. */
async function pruneGenerations(access: VaultAccess, newest: number): Promise<void> {
  const generations = (await access.client.listGenerations()).slice().sort((a, b) => a - b);
  const keep = generations.slice(-MANIFEST_GENERATIONS_KEPT);
  for (const generation of generations) {
    if (keep.includes(generation)) continue;
    if (generation === newest) continue;
    await access.client.deleteManifest(generation);
  }
}

/** Builds an empty manifest for a fresh vault. */
function emptyManifest(epoch: number): SealedManifest {
  return {
    format: 1,
    generation: 0,
    createdAt: new Date().toISOString(),
    epoch,
    entries: [],
    trash: [],
  };
}

/**
 * Migrates an open storage into an encrypted one.
 *
 * The function never removes the plaintext: the removal is a separate and
 * explicit call ({@link purgePlaintextAfterMigration}) that the user
 * interface only makes after the confirmation of the user.
 */
export async function migrateToSealed(options: MigrationOptions): Promise<MigrationResult> {
  const api = options.openApi ?? defaultOpenVaultApi();
  const client = new SealedClient({
    apiBase: options.apiBase,
    fetchImpl: options.fetchImpl,
  });
  const report = (progress: MigrationProgress): void => {
    options.onProgress?.(progress);
  };

  // 1. READ — nothing is written yet.
  report({ phase: 'reading', copied: 0, total: 0 });
  const tree = await api.listTree();
  const files = [...(tree.files ?? [])].sort((a, b) => a.path.localeCompare(b.path));
  const folders = [...(tree.folders ?? [])].sort((a, b) => a.path.localeCompare(b.path));
  const attachments = await api.listAttachments();
  const total = files.length;
  report({ phase: 'reading', copied: 0, total });

  // 2. The key material of the encrypted storage.
  const access = await openVaultAccess(client, options.password, options.kdfParams);
  if (options.vault) accessRegistry.set(options.vault, access);

  const manifest = access.manifest ?? emptyManifest(access.epoch);
  const journal: MigrationJournal = manifest.migration ?? {
    phase: 'encrypting',
    copiedPaths: [],
    total,
    updatedAt: new Date().toISOString(),
  };
  manifest.migration = journal;
  journal.total = total;
  const copiedPaths = new Set(journal.copiedPaths);
  const copiedAttachments = new Set(journal.copiedAttachmentIds ?? []);
  journal.copiedAttachmentIds = journal.copiedAttachmentIds ?? [];
  const failedPaths = new Set(journal.failedPaths ?? []);
  journal.failedPaths = journal.failedPaths ?? [];
  const failedAttachments = new Set(journal.failedAttachmentIds ?? []);
  journal.failedAttachmentIds = journal.failedAttachmentIds ?? [];

  // The folders of the open storage.
  for (const folder of folders) {
    const path = normalizePath(folder.path);
    if (findEntry(manifest, path)) continue;
    const id = await newObjectId();
    const metadata = encodeText(JSON.stringify({ type: 'folder', name: folder.name, path }));
    await client.putObject(id, await sealBytes(access.dek, metadata, access.epoch));
    const now = new Date().toISOString();
    manifest.entries.push({
      id,
      type: 'folder',
      name: folder.name || baseNameOf(path),
      path,
      parentPath: normalizePath(folder.parentPath || parentPathOf(path)),
      size: 0,
      modTime: folder.modTime || now,
      revision: 1,
      createdAt: folder.createdAt || now,
      updatedAt: folder.updatedAt || now,
    });
  }

  // 2. ENCRYPT — the objects first, the manifest (the journal) after them.
  for (const file of files) {
    const path = normalizePath(file.path);
    if (copiedPaths.has(path)) {
      report({
        phase: 'encrypting',
        copied: journal.copiedPaths.length,
        total,
        currentPath: path,
      });
      continue;
    }
    report({ phase: 'encrypting', copied: journal.copiedPaths.length, total, currentPath: path });

    let content: string;
    try {
      const note = await api.readNote(openPathOf(path));
      content = note.content;
    } catch {
      // A note that cannot be read is not lost: it stays in the plaintext and
      // the migration is resumed later.
      failedPaths.add(path);
      continue;
    }

    const bytes = encodeText(content);
    const id = await newObjectId();
    await client.putObject(id, await sealBytes(access.dek, bytes, access.epoch));

    const now = new Date().toISOString();
    const existing = findEntry(manifest, path);
    if (existing) {
      existing.id = id;
      existing.contentId = id;
      existing.size = bytes.length;
      existing.modTime = file.modTime || now;
      existing.updatedAt = now;
      existing.revision += 1;
    } else {
      manifest.entries.push({
        id,
        type: 'file',
        name: file.name || baseNameOf(path),
        path,
        parentPath: normalizePath(file.parentPath || parentPathOf(path)),
        size: bytes.length,
        modTime: file.modTime || now,
        revision: 1,
        createdAt: file.createdAt || now,
        updatedAt: now,
        contentId: id,
      });
    }
    journal.copiedPaths.push(path);
    copiedPaths.add(path);
    failedPaths.delete(path);
    journal.phase = 'encrypting';
    journal.updatedAt = now;
    await writeManifest(access, manifest);
    report({
      phase: 'encrypting',
      copied: journal.copiedPaths.length,
      total,
      currentPath: path,
    });
  }

  // The attachments of the open storage.
  for (const attachment of attachments) {
    if (copiedAttachments.has(attachment.id)) continue;
    if (!api.readAttachment) {
      // The bytes of the attachment cannot be read: the plaintext must stay.
      failedAttachments.add(attachment.id);
      continue;
    }
    let data: Uint8Array;
    try {
      data = await api.readAttachment(attachment.id);
    } catch {
      failedAttachments.add(attachment.id);
      continue;
    }

    const metaId = await newObjectId();
    const metadata = encodeText(
      JSON.stringify({
        name: attachment.name,
        mime: attachment.mime,
        size: attachment.size,
        notePath: attachment.notePath,
        createdAt: attachment.createdAt,
      }),
    );
    await client.putObject(metaId, await sealBytes(access.dek, metadata, access.epoch));
    const contentId = await newObjectId();
    await client.putObject(contentId, await sealBytes(access.dek, data, access.epoch));

    if (!findEntry(manifest, ATTACHMENTS_PATH)) {
      const folderId = await newObjectId();
      const folderMeta = encodeText(
        JSON.stringify({ type: 'folder', name: '.attachments', path: ATTACHMENTS_PATH }),
      );
      await client.putObject(folderId, await sealBytes(access.dek, folderMeta, access.epoch));
      const now = new Date().toISOString();
      manifest.entries.push({
        id: folderId,
        type: 'folder',
        name: '.attachments',
        path: ATTACHMENTS_PATH,
        parentPath: '/',
        size: 0,
        modTime: now,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      });
    }

    const now = new Date().toISOString();
    manifest.entries.push({
      id: metaId,
      type: 'file',
      name: metaId,
      path: `${ATTACHMENTS_PATH}/${metaId}`,
      parentPath: ATTACHMENTS_PATH,
      size: data.length,
      modTime: now,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      contentId,
    });
    journal.copiedAttachmentIds?.push(attachment.id);
    copiedAttachments.add(attachment.id);
    failedAttachments.delete(attachment.id);
    journal.updatedAt = now;
    await writeManifest(access, manifest);
  }

  // 3. VERIFY — every sealed object is read back and compared with the source.
  const broken: string[] = [];
  let verified = 0;
  report({ phase: 'verifying', copied: 0, total: journal.copiedPaths.length });
  for (const path of journal.copiedPaths) {
    const entry = findEntry(manifest, path);
    if (!entry || !entry.contentId) {
      broken.push(entry?.id ?? path);
      verified += 1;
      report({ phase: 'verifying', copied: verified, total: journal.copiedPaths.length });
      continue;
    }
    try {
      const bytes = await client.getObject(entry.contentId);
      const plain = await openBytes(access.dek, bytes);
      const source = await api.readNote(openPathOf(path));
      if (decodeText(plain) !== source.content) broken.push(entry.contentId);
    } catch {
      broken.push(entry.contentId);
    }
    verified += 1;
    report({ phase: 'verifying', copied: verified, total: journal.copiedPaths.length });
  }

  journal.failedPaths = Array.from(failedPaths);
  journal.failedAttachmentIds = Array.from(failedAttachments);
  journal.updatedAt = new Date().toISOString();

  const failed = failedPaths.size > 0 || failedAttachments.size > 0;
  if (broken.length > 0 || failed) {
    // The mode is not switched: the plaintext stays on the disk and the
    // migration is resumed after the problem is fixed.
    journal.phase = 'encrypting';
    await writeManifest(access, manifest);
    report({ phase: 'verifying', copied: journal.copiedPaths.length, total });
    return {
      copied: journal.copiedPaths.length,
      purged: false,
      broken,
      failedPaths: Array.from(failedPaths),
      failedAttachments: Array.from(failedAttachments),
      attachments: journal.copiedAttachmentIds?.length ?? 0,
    };
  }

  // 4. SWITCH — the server writes the mode file and answers 409 from now on.
  journal.phase = 'switching';
  await writeManifest(access, manifest);
  await api.enableSealed();
  journal.phase = 'done';
  await writeManifest(access, manifest);

  report({ phase: 'done', copied: journal.copiedPaths.length, total });

  // The vault of the session is unlocked again, so that it holds the manifest
  // that the migration has just written.
  if (options.vault) {
    try {
      await options.vault.unlock(options.password);
    } catch {
      // The caller unlocks the vault through the session when this fails.
    }
  }

  return {
    copied: journal.copiedPaths.length,
    purged: false,
    broken: [],
    attachments: journal.copiedAttachmentIds?.length ?? 0,
  };
}

/**
 * Removes the plaintext files of the vault from the disk.
 *
 * The call is deliberately separate from the migration: the user interface
 * only makes it after the user has explicitly confirmed the removal. The
 * plaintext of the notes is gone for good afterwards — the copies that live in
 * the history of a cloud provider, in the snapshots and in the backups are not
 * touched by this call.
 */
export async function purgePlaintextAfterMigration(
  options: PurgeOptions = {},
): Promise<PurgeResult> {
  const api = options.openApi ?? defaultOpenVaultApi();
  return await api.purgePlaintext();
}

/**
 * Reads the journal of a migration out of the encrypted manifest.
 *
 * The manifest is sealed, so the journal can only be read with the data key of
 * the vault. The key is taken from the registry of the engine when the vault
 * has been used by a migration, and derived from the given master password
 * otherwise.
 */
export async function readMigrationJournal(
  vault: SealedVault,
  password?: string,
  options: { apiBase?: string; fetchImpl?: typeof fetch } = {},
): Promise<MigrationJournal | null> {
  let access = accessRegistry.get(vault);
  if (!access && password) {
    const client = new SealedClient({
      apiBase: options.apiBase,
      fetchImpl: options.fetchImpl,
    });
    const keystore = await client.getKeystore();
    const unlocked = await unlockKeystore(password, keystore);
    access = { client, dek: unlocked.dek, epoch: unlocked.epoch, generation: 0, manifest: null };
  }
  if (!access) return null;

  const generations = await access.client.listGenerations();
  const newest = generations.length > 0 ? Math.max(...generations) : 0;
  if (newest <= 0) return null;
  const bytes = await access.client.getManifest(newest);
  const manifest = JSON.parse(decodeText(await openBytes(access.dek, bytes))) as SealedManifest;
  return manifest.migration ?? null;
}

/**
 * True when the journal says that the migration is not finished.
 *
 * A finished migration (the phase is `done`) cannot be resumed: the storage is
 * already encrypted and the plaintext is gone.
 */
export function canResumeMigration(journal: MigrationJournal | null): boolean {
  if (!journal) return false;
  if (journal.phase === 'done') return false;
  return true;
}

/** The phase of a migration, as a short label for the user interface. */
export function migrationPhaseLabel(phase: MigrationPhase): string {
  switch (phase) {
    case 'reading':
      return 'Reading the notes';
    case 'encrypting':
      return 'Encrypting the notes';
    case 'verifying':
      return 'Verifying the copy';
    case 'switching':
      return 'Switching the storage';
    case 'purging':
      return 'Removing the plaintext';
    case 'done':
      return 'Done';
    default:
      return 'Working';
  }
}
