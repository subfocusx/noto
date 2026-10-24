// Implementation of the plugin data API.
//
// Boundary note: `core/**` must not import from `src/plugins/**` (rule R1),
// so the API surface is declared structurally here. It is compatible with
// `PluginApi` of the plugin contract, and the host passes it through.
//
// All HTTP goes through the existing API modules (`src/api/notes.ts`,
// `src/api/tree.ts`, `src/api/search.ts`); this file never calls `fetch`.
//
// The query capability (API 1.2.0) lives in `core/api/pluginQuery.ts`: it
// asks the server in the open mode and evaluates the query locally over the
// decrypted notes in the sealed mode. It never exposes the key material.
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
import type { NoteContent, SaveNoteResponse, SearchHit, TagCount, TreeResponse } from '../../types';
import { getNote as apiGetNote, saveNote as apiSaveNote } from '../../api/notes';
import { getTree as apiGetTree } from '../../api/tree';
import { search as apiSearch } from '../../api/search';
import {
  type PluginQueryApi,
  type PluginQueryResult,
} from './pluginQuery';

/**
 * The state of the encrypted storage, as a plugin may see it.
 *
 * This is the structural mirror of `PluginVaultState` of the plugin contract:
 * the contract cannot be imported here (rule R1), so the two shapes have to
 * be kept in sync. They are plain objects with the same fields, so they are
 * assignable to each other.
 *
 * The state is STATUS ONLY. It never carries key material (the master
 * password, the wrapping key, the data key): the plugin platform publishes
 * this copy precisely so that a plugin can report the state of the storage
 * without being able to reach a key.
 */
export interface PluginVaultStateLike {
  /** 'open' — the notes are stored as plain markdown; 'sealed' — the storage is encrypted. */
  readonly mode: 'open' | 'sealed';
  /** True when the storage is encrypted. */
  readonly encrypted: boolean;
  /** True when the storage is locked and the plugin cannot read anything. */
  readonly locked: boolean;
  /** The version of the format of the encrypted storage; 0 when the storage is not encrypted. */
  readonly formatVersion: number;
}

/**
 * Makes an immutable copy of a published vault state.
 *
 * The copy is frozen, so a plugin cannot change what the application
 * published, and it does not keep a reference to the object of the
 * application: the plugin can never mutate the state of the storage.
 */
export function freezeVaultState(state: PluginVaultStateLike): PluginVaultStateLike {
  return Object.freeze({
    mode: state.mode,
    encrypted: state.encrypted,
    locked: state.locked,
    formatVersion: state.formatVersion,
  });
}

/** Structural shape of the plugin API (compatible with `PluginApi`). */
export interface PluginApiLike {
  getNote(path: string): Promise<NoteContent>;
  getTree(): Promise<TreeResponse>;
  search(query: string, limit?: number): Promise<SearchHit[]>;
  saveNote(path: string, content: string, revision: number): Promise<SaveNoteResponse>;
  /**
   * Runs a query of the query language.
   *
   * The implementation lives in `core/api/pluginQuery.ts`: it asks the server
   * in the open mode and evaluates the query locally over the decrypted notes
   * in the sealed mode.
   *
   * The member is optional in the type, so that an implementation of the API
   * written for API 1.0.0 or 1.1.0 keeps compiling. The host of API 1.2.0
   * always provides it.
   */
  query?(query: string, limit?: number): Promise<PluginQueryResult>;
  /**
   * Returns the tags of the vault with the number of the notes that carry them.
   *
   * The member is optional in the type, like {@link PluginApiLike.query}.
   */
  tags?(): Promise<TagCount[]>;
  /**
   * The state of the encrypted storage, when the application published it.
   *
   * Absent while nothing was published: a plugin can then not know anything
   * about the storage. The value is a frozen copy (see
   * {@link freezeVaultState}) and never contains key material.
   */
  readonly vault?: PluginVaultStateLike;
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
  | 'query.read'
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

/**
 * The permission every operation of the data API requires.
 *
 * `vault` is not an operation: it is a published state that needs no
 * permission (a plugin may always learn whether the storage is encrypted).
 */
export const PLUGIN_API_PERMISSIONS = {
  getNote: 'notes.read',
  saveNote: 'notes.write',
  getTree: 'tree.read',
  search: 'search.read',
  query: 'query.read',
  tags: 'query.read',
} as const satisfies Record<Exclude<keyof PluginApiLike, 'vault'>, PluginPermissionName>;

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
  const restricted: PluginApiLike = {
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
    async query(query: string, limit?: number): Promise<PluginQueryResult> {
      requirePermission(pluginId, permissions, PLUGIN_API_PERMISSIONS.query);
      if (!api.query) {
        throw new Error('the query capability is not available in this build');
      }
      return api.query(query, limit);
    },
    async tags(): Promise<TagCount[]> {
      requirePermission(pluginId, permissions, PLUGIN_API_PERMISSIONS.tags);
      if (!api.tags) {
        throw new Error('the query capability is not available in this build');
      }
      return api.tags();
    },
  };
  // The state of the storage travels with the API: it is published by the
  // application, and the plugin only ever gets a frozen copy of it.
  //
  // The member is NOT enumerable: the shape of the API object stays exactly
  // as it was in API 1.0.0, so an existing plugin that inspects the keys of
  // `ctx.api` keeps working unchanged.
  Object.defineProperty(restricted, 'vault', {
    enumerable: false,
    get: (): PluginVaultStateLike | undefined =>
      api.vault ? freezeVaultState(api.vault) : undefined,
  });
  // The query capability (API 1.2.0) is not enumerable either: the set of the
  // keys of `ctx.api` stays the same as in API 1.0.0, so a plugin that walks
  // over the API keeps working unchanged.
  hideQueryMembers(restricted);
  return restricted;
}

/**
 * Makes the members of the query capability non-enumerable.
 *
 * The set of the keys of the API object is a part of the contract of the
 * platform: a plugin may walk over it. The new members of API 1.2.0 are
 * therefore hidden, exactly like the state of the storage.
 */
function hideQueryMembers(api: PluginApiLike): void {
  for (const member of ['query', 'tags'] as const) {
    Object.defineProperty(api, member, { enumerable: false });
  }
}

/**
 * The options of {@link createPluginApi}.
 *
 * `pluginId` and `permissions` turn the API into a restricted one; the
 * `vaultState` is the state of the encrypted storage that the application
 * publishes. It is optional: while nothing is published, the API carries no
 * state at all and a plugin knows nothing about the storage.
 */
export interface PluginApiOptions extends Partial<PluginApiRestrictions> {
  /** The state of the encrypted storage to publish to the plugins. */
  vaultState?: PluginVaultStateLike;
}

/**
 * The promise of the query capability of the plugins.
 *
 * The capability is loaded once and kept: a plugin that asks many questions
 * pays for the module only once.
 */
let queryApiPromise: Promise<PluginQueryApi> | null = null;

/**
 * Loads the query capability of the plugins.
 *
 * The module behind it carries the parser of the query language, which is a
 * heavy module: it must stay out of the entry chunk of the application.
 */
function loadQueryApi(): Promise<PluginQueryApi> {
  if (!queryApiPromise) {
    queryApiPromise = import('./pluginQuery').then((module) => module.createPluginQueryApi());
  }
  return queryApiPromise;
}

/**
 * Creates the plugin data API.
 *
 * @param deps optional overrides, used by tests and by hosts that want to
 * intercept the calls.
 * @param options when `pluginId` and `permissions` are given, the returned
 * API is restricted to those permissions; otherwise it is unrestricted. The
 * optional `vaultState` publishes the state of the encrypted storage.
 */
export function createPluginApi(
  deps: {
    getNote?: (path: string) => Promise<NoteContent>;
    saveNote?: (path: string, content: string, revision: number) => Promise<SaveNoteResponse>;
    getTree?: () => Promise<TreeResponse>;
    search?: (query: string, limit?: number) => Promise<SearchHit[]>;
    query?: (query: string, limit?: number) => Promise<PluginQueryResult>;
    tags?: () => Promise<TagCount[]>;
  } = {},
  options: PluginApiOptions = {},
): PluginApiLike {
  const getNote = deps.getNote ?? apiGetNote;
  const saveNote = deps.saveNote ?? apiSaveNote;
  const getTree = deps.getTree ?? apiGetTree;
  const search = deps.search ?? ((query: string, limit?: number) => apiSearch(query, limit ?? 50));
  // The query capability knows both storage modes: it asks the server in the
  // open mode and evaluates the query locally over the decrypted notes in the
  // sealed mode. It is loaded on demand: the capability carries the parser of
  // the query language, and a plugin that never asks a question never loads it.
  const runQuery =
    deps.query ??
    ((query: string, limit?: number) => loadQueryApi().then((api) => api.query(query, limit)));
  const fetchTags = deps.tags ?? (() => loadQueryApi().then((api) => api.tags()));

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
     * Runs a query of the query language.
     *
     * The query never exposes the key material: in the sealed mode it is
     * evaluated locally over the decrypted notes.
     */
    query(query: string, limit?: number): Promise<PluginQueryResult> {
      return runQuery(query, limit);
    },
    /** Returns the tags of the vault with the number of the notes that carry them. */
    tags(): Promise<TagCount[]> {
      return fetchTags();
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
  // The published state of the storage, as a frozen copy. The plugin can read
  // it, never change it.
  //
  // The member is NOT enumerable: the shape of the API object stays exactly
  // as it was in API 1.0.0.
  Object.defineProperty(api, 'vault', {
    enumerable: false,
    get: (): PluginVaultStateLike | undefined =>
      options.vaultState ? freezeVaultState(options.vaultState) : undefined,
  });
  // The members of the query capability (API 1.2.0) are not enumerable either:
  // the set of the keys of the API object stays the same as in API 1.0.0.
  hideQueryMembers(api);

  if (options.permissions === undefined) return api;
  if (options.pluginId === undefined) {
    throw new TypeError('a restricted plugin API needs a plugin id');
  }
  return restrictPluginApi(api, options.pluginId, options.permissions);
}
