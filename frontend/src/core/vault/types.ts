// The data model of the SEALED vault.
//
// The sealed vault is a zero-knowledge storage: every byte that leaves the
// browser is already encrypted, so the backend stores ciphertext only and
// never learns a note title, a note body or an object identity.
//
// The plain (open mode) types live in `src/types.ts` and are reused as-is:
// the UI must not be able to tell the two storage modes apart.

/**
 * One node of the manifest tree.
 *
 * A folder entry carries the object id of its sealed metadata object, a file
 * entry carries the object id of its sealed content in `contentId`.
 */
export interface ManifestEntry {
  /** Object id (32 lowercase hex characters). */
  id: string;
  type: 'file' | 'folder';
  name: string;
  path: string;
  parentPath: string;
  size: number;
  modTime: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  /** For a file: the object id of the sealed content. */
  contentId?: string;
  /** The number of the notes under a folder (counted recursively). */
  noteCount?: number;
  /** The number of the direct child folders of a folder. */
  folderCount?: number;
}

/** A deleted node waiting in the trash. The objects are kept until "delete forever". */
export interface ManifestTrashEntry {
  id: string;
  type: 'file' | 'folder';
  name: string;
  path: string;
  originalPath: string;
  deletedAt: string;
  /** For a file: the object id of the sealed content (still stored). */
  contentId?: string;
}

/**
 * The encrypted description of the whole vault at one point in time.
 *
 * The manifest is sealed like any other object and is stored under its own
 * generation number, so that a sync client (OneDrive, Google Drive) can keep
 * several branches of the history and the client can resolve them.
 */
export interface SealedManifest {
  /** The format version of the manifest (currently 1). */
  format: number;
  /** The monotonic generation of the manifest. */
  generation: number;
  createdAt: string;
  /** The key epoch that was used to seal the objects of this manifest. */
  epoch: number;
  /** The tree of files and folders. */
  entries: ManifestEntry[];
  /** The deleted nodes waiting in the trash. */
  trash: ManifestTrashEntry[];
  /**
   * The object ids whose content diverged during a merge.
   * The caller surfaces them to the user; they are never merged silently.
   */
  conflicts?: string[];
  /**
   * The journal of a migration from the open storage to the encrypted one.
   *
   * The journal lives inside the sealed manifest: it is the state of the
   * migration, so a crash never loses it and the migration can be resumed
   * after the user unlocked the storage again.
   */
  migration?: MigrationJournal;
}

/** The phase of a migration from the open storage to the encrypted one. */
export type MigrationPhase =
  | 'reading'
  | 'encrypting'
  | 'verifying'
  | 'switching'
  | 'purging'
  | 'done';

/**
 * The journal of a migration.
 *
 * The journal is stored inside the encrypted manifest, so the paths of the
 * notes it lists are never visible to the backend.
 */
export interface MigrationJournal {
  /** The phase the migration is in. */
  phase: MigrationPhase;
  /** The paths of the notes that are already copied. */
  copiedPaths: string[];
  /** The total number of the notes to copy. */
  total: number;
  /** The ISO timestamp of the last update of the journal. */
  updatedAt: string;
  /** The paths of the notes that could not be read. */
  failedPaths?: string[];
  /** The ids of the attachments that are already copied. */
  copiedAttachmentIds?: string[];
  /** The ids of the attachments that could not be copied. */
  failedAttachmentIds?: string[];
}

/** Options of the sealed vault client. */
export interface SealedVaultOptions {
  /** The prefix of the API, `/api` by default. */
  apiBase?: string;
  /** The fetch implementation, injected by the tests. */
  fetchImpl?: typeof fetch;
}

/** The status of the backend, as reported by `GET /api/vault/sealed/status`. */
export interface SealedStatus {
  mode: 'sealed' | 'open';
  format: number;
  objectCount: number;
  generations: number[];
}
