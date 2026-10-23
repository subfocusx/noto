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
import type { Node, NoteContent, SaveNoteResponse, SearchHit } from '../types';

/**
 * The error thrown when a plugin tries to do something it did not ask for in
 * its manifest.
 *
 * The class lives in `core/api/pluginApi.ts` (the core layer must not import
 * from `src/plugins/**`, rule R1) and is re-exported here, so that plugins
 * can catch it by type.
 */
export { PluginPermissionError } from '../core/api/pluginApi';

/** Version of the plugin API implemented by this build. */
export const PLUGIN_API_VERSION = '1.0.0';

/** Capabilities a plugin may request in its manifest. */
export type PluginPermission =
  | 'notes.read'
  | 'notes.write'
  | 'tree.read'
  | 'search.read'
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

/** Data access available to a plugin. */
export interface PluginApi {
  getNote(path: string): Promise<NoteContentLike>;
  getTree(): Promise<{ folders: NodeLike[]; files: NodeLike[] }>;
  search(query: string, limit?: number): Promise<SearchHitLike[]>;
  saveNote(path: string, content: string, revision: number): Promise<SaveNoteResponse>;
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
 * | `editor.getText/getSelection/getCursor`    | `editor.read`  |
 * | `editor.onChange/onSelectionChange`        | `editor.read`  |
 * | `editor.insert/insertAt/replaceSelection`  | `editor.write` |
 * | `registerCommand` and the other UI hooks   | `ui.contribute`|
 * | `settings.set` / `settings.reset`          | `settings.write`|
 *
 * Reading the own settings of the plugin (`settings.get` / `settings.all`)
 * needs no permission: the namespace belongs to the plugin itself.
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
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
