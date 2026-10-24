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
 * The service of an open storage.
 *
 * It is a thin adapter over the API of the notes: the behaviour of the open
 * mode must not change, and this adapter is the only place that knows it.
 */
export function createOpenVaultService(): VaultService {
  return {
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
  };
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
  return {
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
  };
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
