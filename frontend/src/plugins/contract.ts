// Public plugin contract (phase 2 of the Noto plugin platform).
//
// This module is the ONLY entry point available to built-in plugins
// (see `scripts/check-boundaries.mjs`, rule R3). It contains every type a
// plugin needs, so a plugin never has to reach into the application code.
//
// Stability: everything exported here is public API. Renaming or changing the
// shape of an export is a breaking change for plugins and must bump
// `PLUGIN_API_VERSION`.

import type { ComponentChildren } from 'preact';
import type { Node, NoteContent, SaveNoteResponse, SearchHit, TagCount } from '../types';

/**
 * The error thrown when a plugin tries to do something it did not ask for in
 * its manifest.
 *
 * The class lives in `core/api/pluginApi.ts` (the core layer must not import
 * from `src/plugins/**`, rule R1) and is re-exported here, so that plugins
 * can catch it by type.
 */
export { PluginPermissionError } from '../core/api/pluginApi';

/**
 * Version of the plugin API implemented by this build.
 *
 * `1.1.0` added the optional `ctx.vault` state (see {@link PluginVaultState}).
 * `1.2.0` added the query capability: `ctx.api.query()` and `ctx.api.tags()`
 * (see {@link PluginQueryResult}), behind the new permission `query.read`.
 * `1.3.0` added the operation that opens a note (`ctx.openNote()`, see
 * {@link PluginContext.openNote}), the sandbox of the plugins
 * (`manifest.sandbox` and {@link Plugin.sandboxSource}) and the audit log of
 * the actions of the plugins (see {@link PluginAuditEntry}).
 *
 * Every bump so far is additive: a plugin that requires `1.0.0` keeps working
 * unchanged, because the new members are optional.
 */
export const PLUGIN_API_VERSION = '1.3.0';

/** Capabilities a plugin may request in its manifest. */
export type PluginPermission =
  | 'notes.read'
  | 'notes.write'
  | 'tree.read'
  | 'search.read'
  | 'query.read'
  | 'editor.read'
  | 'editor.write'
  | 'ui.contribute'
  | 'settings.write';

/** Description of a single user visible setting of a plugin. */
export interface PluginSettingSchema {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean';
  default: string | number | boolean;
  description?: string;
}

/** Static description of a plugin. */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  manifestVersion: 1;
  minApiVersion: string;
  permissions: PluginPermission[];
  settings?: PluginSettingSchema[];
  /**
   * True when the plugin asks for the sandbox (API 1.3.0).
   *
   * A sandboxed plugin does NOT run in the context of the application: its
   * code runs inside an iframe with a strict Content-Security-Policy and
   * talks to the host through a narrow, validated bridge (`postMessage`).
   *
   * The flag is only a declaration: the host decides how the plugin is run.
   * A plugin that declares the sandbox but ships no {@link Plugin.sandboxSource}
   * is refused by the host (it stays in the `failed` state).
   */
  sandbox?: boolean;
  /**
   * Version of the plugin's own settings schema. When it grows, the host
   * runs the migrations declared in `settingsMigrations` over the stored
   * values before handing them to the plugin.
   */
  settingsVersion?: number;
  /**
   * Migrations keyed by the source version number (as a string). The
   * function receives one stored value of version `N` and must return the
   * value of version `N + 1`.
   */
  settingsMigrations?: Record<string, (value: unknown) => unknown>;
}

/** Lifecycle state of a plugin inside the registry. */
export type PluginState =
  | 'discovered'
  | 'validated'
  | 'enabled'
  | 'loading'
  | 'active'
  | 'failed'
  | 'disabled'
  | 'incompatible';

/** Logger handed to a plugin; every line is prefixed with the plugin scope. */
export interface PluginLogger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

/**
 * Editor handle exposed to a plugin.
 *
 * There is deliberately NO `setText()` here: replacing the whole document
 * behind the editor's back does not trigger autosave, so an edit could be
 * lost silently. Plugins must use `insert`/`insertAt`/`replaceSelection`.
 */
export interface PluginEditor {
  getText(): string;
  getSelection(): string;
  getCursor(): { from: number; to: number };
  insert(text: string): void;
  insertAt(text: string, from: number, to: number): void;
  replaceSelection(text: string): void;
  focus(): void;
  openSearch(): void;
  getPath(): string | null;
  onChange(cb: (text: string) => void): () => void;
  onSelectionChange(cb: (sel: { from: number; to: number }) => void): () => void;
}

/** Metadata of the note currently open in the editor. */
export interface PluginNoteContext {
  path: string;
  revision: number;
  dirty: boolean;
}

/** Shape of a note document returned by {@link PluginApi.getNote}. */
export type NoteContentLike = NoteContent;
/** Shape of a tree node returned by {@link PluginApi.getTree}. */
export type NodeLike = Node;
/** Shape of a search hit returned by {@link PluginApi.search}. */
export type SearchHitLike = SearchHit;
/** Shape of a tag with its counter returned by {@link PluginApi.tags}. */
export type TagCountLike = TagCount;

/**
 * A note that matches a query, as a plugin sees it.
 *
 * The hit is a {@link SearchHitLike} with two optional timestamps. The host
 * fills them in when it knows them (the sealed mode evaluates the query over
 * the decrypted notes and knows their dates); the open mode may leave them
 * empty, because the server answers with the hits of the index.
 */
export interface PluginQueryHit extends SearchHitLike {
  /** The moment of the creation of the note (ISO 8601), when the host knows it. */
  createdAt?: string;
  /** The moment of the last change of the note (ISO 8601), when the host knows it. */
  updatedAt?: string;
}

/**
 * The answer of a query.
 *
 * `total` is the number of the matching notes before the limit; `partial` is
 * true when the properties of some notes could not be recalculated, so the
 * answer may be incomplete.
 */
export interface PluginQueryResult {
  hits: PluginQueryHit[];
  total: number;
  partial: boolean;
}

/** Data access available to a plugin. */
export interface PluginApi {
  getNote(path: string): Promise<NoteContentLike>;
  getTree(): Promise<{ folders: NodeLike[]; files: NodeLike[] }>;
  search(query: string, limit?: number): Promise<SearchHitLike[]>;
  saveNote(path: string, content: string, revision: number): Promise<SaveNoteResponse>;
  /**
   * Runs a query of the query language (API 1.2.0).
   *
   * Requires the permission `query.read`. The answer carries the paths, the
   * names and the snippets of the matching notes — never the key material of
   * the encrypted storage: in the sealed mode the query is evaluated locally
   * over the decrypted notes.
   *
   * The member is optional in the type, so that an implementation of
   * `PluginApi` written for API 1.0.0 or 1.1.0 keeps compiling. The host of
   * API 1.2.0 always provides it.
   */
  query?(query: string, limit?: number): Promise<PluginQueryResult>;
  /**
   * Returns the tags of the vault with the number of the notes that carry them
   * (API 1.2.0).
   *
   * Requires the permission `query.read`. Like {@link PluginApi.query}, it
   * never exposes the key material.
   *
   * The member is optional in the type, so that an implementation of
   * `PluginApi` written for API 1.0.0 or 1.1.0 keeps compiling. The host of
   * API 1.2.0 always provides it.
   */
  tags?(): Promise<TagCountLike[]>;
}

/** A command contributed by a plugin (palette / shortcut). */
export interface PluginCommand {
  id: string;
  title: string;
  description?: string;
  shortcut?: string;
  run(): void | Promise<void>;
}

/** A panel contributed by a plugin (rendered by the shell). */
export interface PluginPanel {
  id: string;
  title: string;
  render(): ComponentChildren;
}

/** A sidebar entry contributed by a plugin. */
export interface PluginSidebarItem {
  id: string;
  title: string;
  icon?: string;
  onSelect(): void;
}

/** A context menu entry contributed by a plugin. */
export interface PluginContextMenuItem {
  id: string;
  title: string;
  appliesTo(path: string): boolean;
  run(path: string): void | Promise<void>;
}

/** A toolbar button contributed by a plugin. */
export interface PluginToolbarItem {
  id: string;
  title: string;
  icon?: string;
  run(): void | Promise<void>;
}

/** A settings section contributed by a plugin. */
export interface PluginSettingsSection {
  id: string;
  title: string;
  render(): ComponentChildren;
}

/**
 * Events a plugin can subscribe to.
 *
 * Payloads never carry note content — only paths and metadata — so that
 * event dispatch can never leak document text into a plugin.
 */
export interface PluginEventMap {
  'note.created': { path: string };
  'note.updated': { path: string; revision: number };
  'note.deleted': { path: string };
  'note.renamed': { path: string; previousPath: string };
  'note.moved': { path: string; previousPath: string };
  'folder.created': { path: string };
  'folder.moved': { path: string; previousPath: string };
  'editor.saved': { path: string; revision: number };
  /**
   * The editor of the application became available (or was replaced by
   * another one). The path is `null` when no note is open.
   */
  'editor.available': { path: string | null };
  'workspace.opened': { path: string | null };
}

/** Name of a subscribable event. */
export type PluginEventName = keyof PluginEventMap;

/** Per plugin settings storage. */
export interface PluginSettings {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  reset(key?: string): Promise<void>;
  all(): Promise<Record<string, unknown>>;
}

/**
 * The state of the storage of the notes, as a plugin may see it.
 *
 * The state carries STATUS ONLY: the mode of the storage, whether it is
 * encrypted, whether it is locked and the version of the encrypted format.
 * It never carries key material — not the master password, not the wrapping
 * key, not the data key — so a plugin can tell the user that the notes are
 * encrypted without ever being able to reach a key.
 *
 * The application decides when the state is published; a plugin that receives
 * no state simply sees `ctx.vault === undefined` (the state is unknown).
 */
export interface PluginVaultState {
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
 * Everything a plugin is allowed to touch.
 *
 * The context is the security boundary of the platform: it carries no
 * references to application internals, only the capabilities listed here.
 *
 * The permissions of the manifest are ENFORCED, not only declared:
 *
 * | operation                                  | permission     |
 * | ------------------------------------------ | -------------- |
 * | `api.getNote`                              | `notes.read`   |
 * | `api.saveNote`                             | `notes.write`  |
 * | `api.getTree`                              | `tree.read`    |
 * | `api.search`                               | `search.read`  |
 * | `api.query`                                | `query.read`   |
 * | `api.tags`                                 | `query.read`   |
 * | `editor.getText/getSelection/getCursor`    | `editor.read`  |
 * | `editor.onChange/onSelectionChange`        | `editor.read`  |
 * | `editor.insert/insertAt/replaceSelection`  | `editor.write` |
 * | `openNote`                                  | `notes.read`  |
 * | `registerCommand` and the other UI hooks   | `ui.contribute`|
 * | `settings.set` / `settings.reset`          | `settings.write`|
 *
 * Reading the own settings of the plugin (`settings.get` / `settings.all`)
 * needs no permission: the namespace belongs to the plugin itself.
 *
 * A query (`api.query`, `api.tags`) never exposes the key material of the
 * encrypted storage: in the sealed mode the query is evaluated locally over
 * the decrypted notes, and the plugin sees only the answer — the paths, the
 * names, the snippets and the counters.
 *
 * A forbidden operation throws a {@link PluginPermissionError} into the code
 * of the plugin — it is never a silent no-op.
 */
export interface PluginContext {
  readonly id: string;
  readonly version: string;
  readonly logger: PluginLogger;
  readonly permissions: readonly PluginPermission[];
  readonly api: PluginApi;
  /**
   * The editor of the application, or `null` when no note is open.
   *
   * The value is computed on every access, so a plugin that is activated
   * before the first note is opened still gets the editor later. Plugins that
   * need to be notified should use {@link PluginContext.onEditor}.
   */
  readonly editor: PluginEditor | null;
  readonly settings: PluginSettings;
  /**
   * The state of the encrypted storage, when the application published it.
   *
   * The member is absent while the application publishes nothing, so a
   * plugin can always write `ctx.vault?.encrypted`. The value is a frozen
   * copy: a plugin can read the state but never change it.
   *
   * The state is status information only — it never exposes the master
   * password, the wrapping key or the data key (see {@link PluginVaultState}).
   *
   * The member is optional so that contexts built by hand (in the tests of
   * the components) stay valid.
   */
  readonly vault?: PluginVaultState;
  /**
   * Opens a note in the editor of the application (API 1.3.0).
   *
   * The operation navigates to the note: the path becomes the note of the
   * editor, the tree follows it and the events of the platform are emitted.
   * The plugin does NOT get the content of the note — it has to read it with
   * `ctx.api.getNote()` (the permission `notes.read`).
   *
   * The operation requires the permission `notes.read`: a plugin may only
   * navigate to a note it is allowed to read. A plugin without the permission
   * gets a {@link PluginPermissionError}.
   *
   * The member is optional, so that a context built by hand (in the tests of
   * the components) stays valid. A host of API 1.3.0 always provides it.
   */
  openNote?(path: string): void;
  registerCommand(cmd: PluginCommand): () => void;
  registerPanel(p: PluginPanel): () => void;
  registerSidebarItem(i: PluginSidebarItem): () => void;
  registerContextMenuItem(i: PluginContextMenuItem): () => void;
  registerToolbarItem(i: PluginToolbarItem): () => void;
  registerSettingsSection(s: PluginSettingsSection): () => void;
  on<K extends PluginEventName>(event: K, cb: (payload: PluginEventMap[K]) => void): () => void;
  /**
   * Subscribes to the editor of the application.
   *
   * The callback is called immediately with the current editor (or `null`)
   * and then on every change. The returned function cancels the subscription
   * and is idempotent.
   *
   * The field is optional so that contexts built by hand (in the tests of
   * the components) stay valid.
   */
  onEditor?(cb: (editor: PluginEditor | null) => void): () => void;
  onDeactivate(cb: () => void): void;
}

/** A plugin implementation. */
export interface Plugin {
  readonly manifest: PluginManifest;
  /**
   * The source of a sandboxed plugin (API 1.3.0).
   *
   * The source is the JavaScript that runs inside the iframe of the sandbox.
   * It is a string, not a module: the plugin of the sandbox imports nothing —
   * it only uses the bridge that the host publishes in the frame
   * (`window.notoPlugin`).
   *
   * The member is present only when `manifest.sandbox` is true.
   */
  readonly sandboxSource?: string;
  /**
   * Activates the plugin.
   *
   * A sandboxed plugin does not need it: the host never calls the activation
   * of a plugin that runs inside the sandbox.
   */
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

/**
 * The kind of an action of a plugin that the audit log records.
 *
 * * `open` — the plugin asked the application to open a note;
 * * `read` — the plugin read the data of the vault (a note, the tree, a
 *   search, a query);
 * * `write` — the plugin wrote a note;
 * * `command` — the plugin ran a command.
 */
export type PluginAuditAction = 'open' | 'read' | 'write' | 'command';

/**
 * One record of the audit log of the plugins (API 1.3.0).
 *
 * The record carries the id of the plugin, the action, the moment and the
 * target of the action (the path of a note, the id of a command). It never
 * carries the content of a note.
 */
export interface PluginAuditEntry {
  /** The id of the plugin that did the action. */
  pluginId: string;
  /** The kind of the action. */
  action: PluginAuditAction;
  /** The moment of the action, as an ISO 8601 string. */
  at: string;
  /** The target of the action (a path, a command id, a kind of query). */
  target: string;
}
