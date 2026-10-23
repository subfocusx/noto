// Implementation of the plugin data API.
//
// Boundary note: `core/**` must not import from `src/plugins/**` (rule R1),
// so the API surface is declared structurally here. It is compatible with
// `PluginApi` of the plugin contract, and the host passes it through.
//
// All HTTP goes through the existing API modules (`src/api/notes.ts`,
// `src/api/tree.ts`, `src/api/search.ts`); this file never calls `fetch`.
//
// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------
//
// The API runs in two modes:
//
//   * UNRESTRICTED — `createPluginApi(deps)`. Every call goes straight to the
//     underlying implementation. This mode is meant for the application
//     itself and for the tests.
//
//   * RESTRICTED — `createPluginApi(deps, { pluginId, permissions })` or
//     `restrictPluginApi(api, pluginId, permissions)`. Every call checks the
//     permissions declared in the manifest of the plugin first and throws a
//     {@link PluginPermissionError} when the plugin did not ask for the
//     required permission.
//
// The mapping "operation -> permission" lives here, so that the host and the
// API never disagree about what a plugin is allowed to do.
import type { NoteContent, SaveNoteResponse, SearchHit, TreeResponse } from '../../types';
import { getNote as apiGetNote, saveNote as apiSaveNote } from '../../api/notes';
import { getTree as apiGetTree } from '../../api/tree';
import { search as apiSearch } from '../../api/search';

/** Structural shape of the plugin API (compatible with `PluginApi`). */
export interface PluginApiLike {
  getNote(path: string): Promise<NoteContent>;
  getTree(): Promise<TreeResponse>;
  search(query: string, limit?: number): Promise<SearchHit[]>;
  saveNote(path: string, content: string, revision: number): Promise<SaveNoteResponse>;
}

/**
 * Names of the permissions of the plugin platform.
 *
 * This is the mirror of `PluginPermission` of the plugin contract: the
 * contract cannot be imported here (rule R1), so the two lists have to be
 * kept in sync. Both are plain string unions, so they are assignable to
 * each other.
 */
export type PluginPermissionName =
  | 'notes.read'
  | 'notes.write'
  | 'tree.read'
  | 'search.read'
  | 'editor.read'
  | 'editor.write'
  | 'ui.contribute'
  | 'settings.write';

/**
 * The error a plugin gets when it tries to do something it is not allowed
 * to do.
 *
 * The message never contains the content of a note: it only names the plugin
 * and the missing permission, so the error can be logged safely.
 */
export class PluginPermissionError extends Error {
  /** Id of the plugin that tried to do the forbidden thing. */
  readonly pluginId: string;
  /** The permission the plugin did not declare. */
  readonly permission: PluginPermissionName;

  constructor(pluginId: string, permission: PluginPermissionName) {
    super(`plugin "${pluginId}" requires permission "${permission}"`);
    this.name = 'PluginPermissionError';
    this.pluginId = pluginId;
    this.permission = permission;
    // Keeps `instanceof` reliable even when the code is transpiled.
    Object.setPrototypeOf(this, PluginPermissionError.prototype);
  }
}

/** True when the plugin declared the permission. */
export function hasPermission(
  permissions: readonly string[],
  permission: PluginPermissionName,
): boolean {
  return permissions.includes(permission);
}

/**
 * Checks a permission.
 *
 * @throws {PluginPermissionError} when the permission is missing.
 */
export function requirePermission(
  pluginId: string,
  permissions: readonly string[],
  permission: PluginPermissionName,
): void {
  if (hasPermission(permissions, permission)) return;
  throw new PluginPermissionError(pluginId, permission);
}

/** The permission every operation of the data API requires. */
export const PLUGIN_API_PERMISSIONS = {
  getNote: 'notes.read',
  saveNote: 'notes.write',
  getTree: 'tree.read',
  search: 'search.read',
} as const satisfies Record<keyof PluginApiLike, PluginPermissionName>;

/** The restrictions applied to an API instance. */
export interface PluginApiRestrictions {
  /** Id of the owner of the API (used in the error message). */
  pluginId: string;
  /** The permissions declared in the manifest of the owner. */
  permissions: readonly string[];
}

/**
 * Wraps an API instance with permission checks.
 *
 * The result is a NEW object: the plugin never gets a reference to the
 * unrestricted implementation.
 *
 * The methods are asynchronous, so a missing permission is reported as a
 * rejected promise (like every other error of the data API) and not as a
 * synchronous exception.
 */
export function restrictPluginApi(
  api: PluginApiLike,
  pluginId: string,
  permissions: readonly string[],
): PluginApiLike {
  return {
    async getNote(path: string): Promise<NoteContent> {
      requirePermission(pluginId, permissions, PLUGIN_API_PERMISSIONS.getNote);
      return api.getNote(path);
    },
    async getTree(): Promise<TreeResponse> {
      requirePermission(pluginId, permissions, PLUGIN_API_PERMISSIONS.getTree);
      return api.getTree();
    },
    async search(query: string, limit?: number): Promise<SearchHit[]> {
      requirePermission(pluginId, permissions, PLUGIN_API_PERMISSIONS.search);
      return api.search(query, limit);
    },
    async saveNote(
      path: string,
      content: string,
      revision: number,
    ): Promise<SaveNoteResponse> {
      requirePermission(pluginId, permissions, PLUGIN_API_PERMISSIONS.saveNote);
      return api.saveNote(path, content, revision);
    },
  };
}

/**
 * Creates the plugin data API.
 *
 * @param deps optional overrides, used by tests and by hosts that want to
 * intercept the calls.
 * @param options when `pluginId` and `permissions` are given, the returned
 * API is restricted to those permissions; otherwise it is unrestricted.
 */
export function createPluginApi(
  deps: {
    getNote?: (path: string) => Promise<NoteContent>;
    saveNote?: (path: string, content: string, revision: number) => Promise<SaveNoteResponse>;
    getTree?: () => Promise<TreeResponse>;
    search?: (query: string, limit?: number) => Promise<SearchHit[]>;
  } = {},
  options: Partial<PluginApiRestrictions> = {},
): PluginApiLike {
  const getNote = deps.getNote ?? apiGetNote;
  const saveNote = deps.saveNote ?? apiSaveNote;
  const getTree = deps.getTree ?? apiGetTree;
  const search = deps.search ?? ((query: string, limit?: number) => apiSearch(query, limit ?? 50));

  const api: PluginApiLike = {
    getNote(path: string): Promise<NoteContent> {
      return getNote(path);
    },
    getTree(): Promise<TreeResponse> {
      return getTree();
    },
    search(query: string, limit?: number): Promise<SearchHit[]> {
      return search(query, limit);
    },
    /**
     * Saves a note with optimistic locking. The server rejects a stale
     * revision with an `ApiError` whose code is `revision_conflict`; that
     * error is propagated unchanged so the plugin can handle it.
     */
    saveNote(path: string, content: string, revision: number): Promise<SaveNoteResponse> {
      return saveNote(path, content, revision);
    },
  };

  if (options.permissions === undefined) return api;
  if (options.pluginId === undefined) {
    throw new TypeError('a restricted plugin API needs a plugin id');
  }
  return restrictPluginApi(api, options.pluginId, options.permissions);
}
