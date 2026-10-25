// The single path of reading and writing the notes.
//
// Noto has two modes of storage:
//
//   - `open`   — the notes are plain markdown files on the disk; the backend
//                reads and writes them;
//   - `sealed` — the notes are encrypted in the browser before they reach the
//                backend, which stores only the ciphertext.
//
// The store must not know which mode is active: it always talks to a
// `VaultService`. The service of the mode is installed once, when the mode is
// detected, and the two implementations are never used at the same time. That
// is what keeps a single path of reading and writing — there is no "encrypted
// store" beside the "normal store", only one of them at a time.
//
// The interface is deliberately small: it is the set of operations the
// application really needs. A plugin never sees it: the plugins go through
// their own API, which is restricted by the permissions.
import {
  createFile as createFileApi,
  createFolder as createFolderApi,
  deleteNote as deleteNoteApi,
  duplicateNote as duplicateNoteApi,
  deleteAttachment as deleteAttachmentApi,
  getNote as getNoteApi,
  getTree as getTreeApi,
  getTrash as getTrashApi,
  listAttachments as listAttachmentsApi,
  moveNote as moveNoteApi,
  renameNote as renameNoteApi,
  restoreNote as restoreNoteApi,
  saveNote as saveNoteApi,
  search as searchApi,
  uploadAttachment as uploadAttachmentApi,
} from '../../api/client';
import type {
  Attachment,
  Node,
  NoteContent,
  SaveNoteResponse,
  SearchHit,
  TrashResponse,
  TreeResponse,
} from '../../types';
import { baseNameOf, joinPath, parentPathOf } from './paths';
import { getSealedVault, subscribeVaultSession } from './session';
import { sealOutboxPayload } from './sealedOutbox';
import {
  enqueueOfflineWrite,
  isReplaying,
  type OfflineCodecName,
  type OfflineWriteKind,
} from '../sync/offlineQueue';

/**
 * The path of the copy of a note that does not exist yet.
 *
 * The copy of a copy is numbered (`note copy 2.md`), like the copy of the
 * open storage: the user must recognise the file at a glance.
 */
async function freeCopyPath(vault: SealedVaultLike, path: string): Promise<string> {
  const tree = await vault.listTree();
  const taken = new Set<string>([...tree.files, ...tree.folders].map((node) => node.path));
  const parent = parentPathOf(path);
  const name = baseNameOf(path);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';
  for (let index = 1; index < 1000; index += 1) {
    const candidate = joinPath(parent, index === 1 ? `${stem} copy${extension}` : `${stem} copy ${index}${extension}`);
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`The copy of "${path}" cannot be created: too many copies.`);
}

/** The mode of the storage of the notes. */
export type VaultServiceMode = 'open' | 'sealed';

/**
 * The error of a service that is used while the storage is locked.
 *
 * The message says nothing about the key material: the user simply has to
 * unlock the storage.
 */
export class VaultLockedError extends Error {
  constructor() {
    super('The storage is locked: unlock it to continue.');
    this.name = 'VaultLockedError';
  }
}

/**
 * The operations of the storage of the notes.
 *
 * The shapes of the answers are the frozen types of the application, so that
 * the store and the interface of the user do not change between the modes.
 */
export interface VaultService {
  /** The mode of the service. */
  readonly mode: VaultServiceMode;
  /** The tree of the folders and of the notes. */
  listTree(): Promise<TreeResponse>;
  /** The content of a note. */
  readNote(path: string): Promise<NoteContent>;
  /** Writes the content of a note. */
  saveNote(path: string, content: string, revision?: number): Promise<SaveNoteResponse>;
  /** Creates a note. */
  createFile(parentPath: string, name: string): Promise<Node>;
  /** Creates a folder. */
  createFolder(parentPath: string, name: string): Promise<Node>;
  /** Renames a note. */
  renameNote(path: string, newName: string): Promise<Node>;
  /** Moves a note into another folder. */
  moveNote(path: string, newParentPath: string): Promise<Node>;
  /** Deletes a note (it goes to the trash). */
  deleteNote(path: string): Promise<void>;
  /** Copies a note next to the original. */
  duplicateNote(path: string): Promise<Node>;
  /** The deleted notes. */
  listTrash(): Promise<TrashResponse>;
  /** Restores a note from the trash. */
  restoreNote(trashPath: string): Promise<Node>;
  /** Searches in the notes. */
  search(query: string, limit?: number): Promise<SearchHit[]>;
  /** The attachments of the storage. */
  listAttachments(): Promise<Attachment[]>;
  /** Adds an attachment. */
  uploadAttachment(file: File, notePath: string): Promise<Attachment>;
  /** Removes an attachment. */
  deleteAttachment(id: string): Promise<void>;
}

/**
 * The codec of the payloads of the outbox.
 *
 * The payload of a write that waits for the connection is encoded before it
 * reaches the database of the browser: in the clear for an open storage, sealed
 * with the key of the vault for an encrypted one.
 */
interface OutboxCodec {
  /** The name of the codec, as it is written into the queue. */
  name: OfflineCodecName;
  /** Encodes the payload of a write. */
  encode(value: unknown): Promise<string>;
}

/** The codec of an open storage. */
const jsonOutboxCodec: OutboxCodec = {
  name: 'json',
  encode: async (value) => JSON.stringify(value),
};

/** The codec of an encrypted storage. */
function sealedOutboxCodec(vault: SealedVaultLike): OutboxCodec {
  return {
    name: 'sealed',
    encode: (value) => sealOutboxPayload(vault, value),
  };
}

/** True when the failure is the one of a backend that could not be reached. */
function isNetworkFailure(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  return (err as { code?: unknown }).code === 'network_error';
}

/**
 * Puts a write into the outbox.
 *
 * The outbox is a best effort: a storage that refuses the write must not hide
 * the error of the server, so a failure here is swallowed.
 */
async function queueWrite(
  kind: OfflineWriteKind,
  path: string,
  payload: Record<string, unknown>,
  codec: OutboxCodec,
): Promise<void> {
  // A write that fails during a replay is already in the queue: it must not
  // be put into it a second time.
  if (isReplaying()) return;
  try {
    const encoded = await codec.encode(payload);
    await enqueueOfflineWrite({ kind, path, payload: encoded, codec: codec.name });
  } catch {
    // The database of the browser is not available.
  }
}

/**
 * Wraps the writes of a service so that they wait for the connection.
 *
 * A write that fails because the backend could not be reached goes into the
 * outbox: the error is still thrown (the caller must know that the write did
 * not happen), but the write is not lost — it waits for the connection.
 */
function withOutbox(service: VaultService, codec: OutboxCodec): VaultService {
  const guard = async <T>(
    kind: OfflineWriteKind,
    path: string,
    payload: Record<string, unknown>,
    run: () => Promise<T>,
  ): Promise<T> => {
    try {
      return await run();
    } catch (err) {
      if (isNetworkFailure(err)) await queueWrite(kind, path, payload, codec);
      throw err;
    }
  };
  return {
    ...service,
    saveNote: (path, content, revision) =>
      guard('saveNote', path, { path, content, revision: revision ?? 0 }, () =>
        service.saveNote(path, content, revision),
      ),
    createFile: (parentPath, name) =>
      guard('createFile', joinPath(parentPath, name), { parentPath, name }, () =>
        service.createFile(parentPath, name),
      ),
    createFolder: (parentPath, name) =>
      guard('createFolder', joinPath(parentPath, name), { parentPath, name }, () =>
        service.createFolder(parentPath, name),
      ),
    renameNote: (path, newName) =>
      guard('renameNote', path, { path, newName }, () => service.renameNote(path, newName)),
    moveNote: (path, newParentPath) =>
      guard('moveNote', path, { path, newParentPath }, () =>
        service.moveNote(path, newParentPath),
      ),
    deleteNote: (path) => guard('deleteNote', path, { path }, () => service.deleteNote(path)),
    duplicateNote: (path) => guard('duplicateNote', path, { path }, () => service.duplicateNote(path)),
    restoreNote: (path) => guard('restoreNote', path, { path }, () => service.restoreNote(path)),
  };
}

/**
 * The service of an open storage.
 *
 * It is a thin adapter over the API of the notes: the behaviour of the open
 * mode must not change, and this adapter is the only place that knows it.
 */
export function createOpenVaultService(): VaultService {
  return withOutbox(
    {
      mode: 'open',
      listTree: () => getTreeApi(),
      readNote: (path) => getNoteApi(path),
      saveNote: (path, content, revision) => saveNoteApi(path, content, revision ?? 0),
      createFile: (parentPath, name) => createFileApi(parentPath, name),
      createFolder: (parentPath, name) => createFolderApi(parentPath, name),
      renameNote: (path, newName) => renameNoteApi(path, newName),
      moveNote: (path, newParentPath) => moveNoteApi(path, newParentPath),
      deleteNote: async (path) => {
        await deleteNoteApi(path);
      },
      duplicateNote: (path) => duplicateNoteApi(path),
      listTrash: () => getTrashApi(),
      restoreNote: (trashPath) => restoreNoteApi(trashPath),
      search: (query, limit) => searchApi(query, limit ?? 50),
      listAttachments: () => listAttachmentsApi(),
      uploadAttachment: (file, notePath) => uploadAttachmentApi(file, notePath),
      deleteAttachment: async (id) => {
        await deleteAttachmentApi(id);
      },
    },
    jsonOutboxCodec,
  );
}

/**
 * The part of the sealed vault that the service needs.
 *
 * The interface is structural on purpose: the service depends on the
 * operations, not on the class, so that a test can use a double.
 */
export interface SealedVaultLike {
  isUnlocked(): boolean;
  saveNote(path: string, content: string): Promise<SaveNoteResponse>;
  readNote(path: string): Promise<NoteContent>;
  listTree(): Promise<TreeResponse>;
  createFolder(path: string): Promise<Node>;
  createFile(path: string, content?: string): Promise<Node>;
  renameNote(path: string, newName: string): Promise<Node>;
  moveNode(path: string, newParentPath: string): Promise<Node>;
  deleteNote(path: string): Promise<void>;
  listTrash(): Promise<TrashResponse>;
  restoreFromTrash(originalPath: string): Promise<Node>;
  search(query: string, limit?: number): Promise<SearchHit[]>;
  listAttachments(): Promise<Attachment[]>;
  uploadAttachment(
    name: string,
    data: Uint8Array,
    mime?: string,
    notePath?: string,
  ): Promise<Attachment>;
  deleteAttachment(id: string): Promise<void>;
  /** Seals the bytes of a payload; the vault owns the key. */
  sealPayload?(payload: Uint8Array): Promise<Uint8Array>;
  /** Opens the bytes of a payload. */
  openPayload?(container: Uint8Array): Promise<Uint8Array>;
}

/**
 * Converts a path of the encrypted storage into the path of the open storage.
 *
 * The encrypted storage knows the notes by their absolute path
 * ("/notes/todo.md"), the open storage by the path relative to the root of
 * the vault ("notes/todo.md"). The user interface knows only the second
 * convention, so the conversion happens at the border of the service: inside,
 * the vault stays consistent.
 */
function toOpenPath(path: string): string {
  return path.startsWith('/') ? path.slice(1) : path;
}

/** Converts a node of the encrypted storage into a node of the open storage. */
function toOpenNode(node: Node): Node {
  return {
    ...node,
    path: toOpenPath(node.path),
    parentPath: toOpenPath(node.parentPath),
  };
}

/**
 * The service of an encrypted storage.
 *
 * The vault does the work: it seals the content before it writes it and opens
 * it before it hands it over. A locked storage throws instead of working on
 * nothing.
 */
export function createSealedVaultService(vault: SealedVaultLike): VaultService {
  const requireUnlocked = (): void => {
    if (!vault.isUnlocked()) throw new VaultLockedError();
  };
  return withOutbox(
    {
    mode: 'sealed',
    listTree: async () => {
      requireUnlocked();
      const tree = await vault.listTree();
      return {
        ...tree,
        folders: tree.folders.map(toOpenNode),
        files: tree.files.map(toOpenNode),
      };
    },
    readNote: async (path) => {
      requireUnlocked();
      const note = await vault.readNote(path);
      return { ...note, path: toOpenPath(note.path) };
    },
    saveNote: async (path, content) => {
      requireUnlocked();
      const saved = await vault.saveNote(path, content);
      return { ...saved, path: toOpenPath(saved.path) };
    },
    createFile: async (parentPath, name) => {
      requireUnlocked();
      return toOpenNode(await vault.createFile(joinPath(parentPath, name)));
    },
    createFolder: async (parentPath, name) => {
      requireUnlocked();
      return toOpenNode(await vault.createFolder(joinPath(parentPath, name)));
    },
    renameNote: async (path, newName) => {
      requireUnlocked();
      return toOpenNode(await vault.renameNote(path, newName));
    },
    moveNote: async (path, newParentPath) => {
      requireUnlocked();
      return toOpenNode(await vault.moveNode(path, newParentPath));
    },
    deleteNote: async (path) => {
      requireUnlocked();
      await vault.deleteNote(path);
    },
    duplicateNote: async (path) => {
      requireUnlocked();
      // The sealed vault has no copy operation of its own: the copy is a new
      // note with the same content, sealed under a new object.
      const note = await vault.readNote(path);
      const copyPath = await freeCopyPath(vault, path);
      await vault.saveNote(copyPath, note.content);
      return toOpenNode({
        id: copyPath,
        name: baseNameOf(copyPath),
        path: copyPath,
        type: 'file',
        parentPath: parentPathOf(copyPath),
        size: note.content.length,
        modTime: note.updatedAt,
        revision: 1,
        createdAt: note.updatedAt,
        updatedAt: note.updatedAt,
      });
    },
    listTrash: async () => {
      requireUnlocked();
      const trash = await vault.listTrash();
      return { ...trash, entries: trash.entries.map(toOpenNode) };
    },
    restoreNote: async (trashPath) => {
      requireUnlocked();
      return toOpenNode(await vault.restoreFromTrash(trashPath));
    },
    search: async (query, limit) => {
      requireUnlocked();
      const hits = await vault.search(query, limit ?? 50);
      return hits.map((hit) => ({ ...hit, path: toOpenPath(hit.path) }));
    },
    listAttachments: async () => {
      requireUnlocked();
      const attachments = await vault.listAttachments();
      return attachments.map((attachment) => ({
        ...attachment,
        notePath: attachment.notePath ? toOpenPath(attachment.notePath) : attachment.notePath,
      }));
    },
    uploadAttachment: async (file, notePath) => {
      requireUnlocked();
      const bytes = new Uint8Array(await file.arrayBuffer());
      return vault.uploadAttachment(file.name, bytes, file.type || 'application/octet-stream', notePath);
    },
    deleteAttachment: async (id) => {
      requireUnlocked();
      await vault.deleteAttachment(id);
    },
    },
    sealedOutboxCodec(vault),
  );
}

/** The service of the current mode. */
let service: VaultService = createOpenVaultService();

/** The service of the current mode; the open one until the mode is known. */
export function getVaultService(): VaultService {
  return service;
}

/** Installs the service of a mode; the application does it when the mode changes. */
export function setVaultService(next: VaultService | null): void {
  service = next ?? createOpenVaultService();
}

/**
 * Keeps the service of the store in step with the mode of the storage.
 *
 * The function subscribes to the session of the vault: when the storage is
 * sealed, the service of the sealed vault is installed; when it is open, the
 * service of the API of the notes comes back. It returns the unsubscribe
 * function.
 */
export function syncVaultServiceWithSession(): () => void {
  const apply = (): void => {
    const vault = getSealedVault();
    if (vault && vault.isUnlocked()) {
      setVaultService(createSealedVaultService(vault));
      return;
    }
    setVaultService(createOpenVaultService());
  };
  apply();
  return subscribeVaultSession(apply);
}
