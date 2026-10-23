// The client of the storage of the notes (the "vault").
//
// The notes of Noto live in a folder that the user chooses at the first
// start. The server owns the folder: it reads it, it writes the notes into
// it and it can list the directories of the disk, so that the picker of the
// folder works without any browser trick.
import { jsonInit, request } from './http';

/** The state of the storage of the notes. */
export interface VaultInfo {
  /** True when the user has already chosen a folder. */
  configured: boolean;
  /** The absolute path of the folder with the notes. */
  path: string;
  /** The directory with the notes inside the folder of the storage. */
  notesDir: string;
}

/** One directory of the disk. */
export interface VaultDir {
  /** The name of the directory. */
  name: string;
  /** The absolute path of the directory. */
  path: string;
}

/** The content of one directory of the disk. */
export interface VaultBrowse {
  /** The absolute path of the listed directory. */
  path: string;
  /** The path of the parent directory (empty for the root). */
  parent: string;
  /** The subdirectories of the directory. */
  dirs: VaultDir[];
}

/** Reads the state of the storage. */
export function getVault(): Promise<VaultInfo> {
  return request<VaultInfo>('/vault');
}

/** The answer of the server when the storage is changed. */
export interface VaultChange {
  ok: boolean;
  /** The path of the new storage. */
  path?: string;
}

/** Chooses the folder with the notes; the server switches to it. */
export function setVault(path: string): Promise<VaultChange> {
  return request<VaultChange>('/vault', jsonInit('POST', { path }));
}

/** Lists the directories of a folder of the disk. */
export function browseVault(path?: string): Promise<VaultBrowse> {
  const query = path ? `?path=${encodeURIComponent(path)}` : '';
  return request<VaultBrowse>(`/vault/browse${query}`);
}
