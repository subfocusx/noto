// The "Backlinks" built-in plugin.
//
// The plugin answers two questions about the note that is open right now:
//
//   1. BACKLINKS — which notes link to this one (`[[Wiki Link]]`);
//   2. UNLINKED MENTIONS — which notes are named in the text, but NOT linked.
//
// Everything happens through the public contract only:
//
//   * `ctx.api.getTree()`  — the list of the notes (the dictionary of names);
//   * `ctx.api.getNote()`  — the content of a note (there is no bulk read);
//   * `ctx.editor`         — the text and the path of the open note;
//   * `ctx.registerPanel` / `ctx.registerSidebarItem` / `ctx.registerCommand`;
//   * `ctx.on(...)`        — invalidation of the cache.
//
// The plugin does NOT import anything from the application: `src/lib/wiki.ts`
// is not reachable from a built-in plugin (rule R3), so the format of the
// wiki links is parsed here. The regex is intentionally identical to
// `WIKI_LINK_RE` of `src/lib/wiki.ts`:
//
//     /\[\[([^\[\]\n]+)\]\]/g
//
// The name of a note is the file name without the `.md` suffix; the lookup is
// case insensitive (like `normalizeName()` of `src/lib/wiki.ts`).
//
// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------
//
// `PluginApi` has no bulk read: the content of a note can only be fetched one
// note at a time. Building the backlink graph therefore needs N calls of
// `getNote()` — one per note of the library. The plugin limits the work:
//
//   * the extracted wiki-link targets of every note are CACHED by path, so the
//     content of a note is read once and never again while it does not change;
//   * the computed RESULT is cached by the state of the note (path + text +
//     settings), so an identical request is answered without reading the
//     library at all;
//   * the cache is invalidated per path by the events `note.updated`,
//     `note.created`, `note.deleted` and `note.renamed`;
//   * typing in the open note does NOT re-read the library: the debounced
//     recomputation reuses the cached link targets and only re-scans the text
//     of the open note for the unlinked mentions;
//   * the text changes are debounced (300 ms, see `./debounce.ts`), so a burst
//     of keystrokes causes ONE recomputation.
//
// ---------------------------------------------------------------------------
// Ambiguity
// ---------------------------------------------------------------------------
//
// Two notes with the same file name (in different folders) cannot be told
// apart by a wiki link: `[[Отчёт]]` matches both of them. The plugin does
// NOT hide such links and does NOT pick a winner: the note is reported for
// every candidate and the entry is marked with the badge «неоднозначно».
// A link to a name that matches NO note is ignored completely: it never
// creates a phantom entry.
//
// ---------------------------------------------------------------------------
// Opening a note
// ---------------------------------------------------------------------------
//
// The public contract has no "open this note" operation: `ctx.api` is
// read-only and the panels are rendered by the shell, which gives the plugin
// no navigation callback. The panel therefore shows the PATH of every note
// and tells the user to open it manually. The public contract is NOT
// extended by this plugin.
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type {
  NodeLike,
  Plugin,
  PluginContext,
  PluginEditor,
  PluginManifest,
} from '../../contract';
import { createDebouncer, type Debouncer } from './debounce';

/* ---------------------------------------------------------------- manifest */

/** Id of the panel contributed by the plugin. */
export const BACKLINKS_PANEL_ID = 'backlinks.panel';
/** Id of the sidebar item contributed by the plugin. */
export const BACKLINKS_SIDEBAR_ID = 'backlinks.sidebar';
/** Id of the command contributed by the plugin. */
export const BACKLINKS_COMMAND_ID = 'backlinks.show';

/** Debounce of the recomputation, in milliseconds. */
export const BACKLINKS_DEBOUNCE_MS = 300;

/** Minimal length of a note name that is used as a mention. */
export const BACKLINKS_MIN_NAME_LENGTH = 4;

/** Static description of the plugin. */
export const backlinksManifest: PluginManifest = {
  id: 'backlinks',
  name: 'Backlinks',
  version: '1.0.0',
  manifestVersion: 1,
  minApiVersion: '1.0.0',
  description: 'Показывает обратные ссылки на открытую заметку и упоминания без ссылки.',
  author: 'Noto',
  // `tree.read` — the list of the notes (`getTree`);
  // `notes.read` — the content of a note (`getNote`);
  // `editor.read` — the text and the path of the open note (`getText`,
  // `getPath`, `onChange`); the host binds `onChange` to `editor.read`;
  // `ui.contribute` — the panel, the sidebar item and the command.
  // The plugin never asks for a write permission.
  permissions: ['editor.read', 'notes.read', 'tree.read', 'ui.contribute'],
  settings: [
    {
      key: 'includeUnlinked',
      label: 'Показывать упоминания без ссылки',
      type: 'boolean',
      default: true,
      description: 'Добавляет в панель заметки, названные в тексте, но без wiki-ссылки.',
    },
    {
      key: 'minNameLength',
      label: 'Минимальная длина имени',
      type: 'number',
      default: BACKLINKS_MIN_NAME_LENGTH,
      description: 'Имена короче этого значения не ищутся в тексте (защита от ложных срабатываний).',
    },
  ],
};

/* ------------------------------------------------------------------- links */

/**
 * The wiki-link syntax of the application.
 *
 * Identical to `WIKI_LINK_RE` of `src/lib/wiki.ts`; the plugin cannot import
 * that module (rule R3), so the pattern is repeated here.
 */
export const WIKI_LINK_RE = /\[\[([^\[\]\n]+)\]\]/g;

/** Extracts the targets of the wiki links of a Markdown source. */
export function extractWikiTargets(source: string): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(WIKI_LINK_RE)) {
    const value = match[1];
    if (value) out.push(value.trim());
  }
  return out;
}

/** Removes the `.md` suffix of a file name. */
export function stripMd(name: string): string {
  return name.toLowerCase().endsWith('.md') ? name.slice(0, -3) : name;
}

/** Normalizes a name or a path for the lookup: trimmed and lowercased. */
export function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

/** Escapes the special characters of a regular expression. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ------------------------------------------------------------------- index */

/** A note name with the paths of the notes that carry it. */
export interface NoteNameEntry {
  /** The name of the note (the file name without `.md`). */
  name: string;
  /** The paths of the notes with that name (more than one — ambiguity). */
  paths: string[];
}

/** The index of the notes of the library. */
export interface NoteIndex {
  /** All the notes of the library. */
  files: NodeLike[];
  /** The notes by their name (case insensitive). */
  byName: Map<string, NoteNameEntry>;
  /** The notes by their path (case insensitive). */
  byPath: Map<string, string>;
}

/** Builds the index of the notes from the files of the tree. */
export function buildNoteIndex(files: NodeLike[]): NoteIndex {
  const byName = new Map<string, NoteNameEntry>();
  const byPath = new Map<string, string>();

  for (const file of files) {
    byPath.set(normalizeKey(file.path), file.path);
    byPath.set(normalizeKey(stripMd(file.path)), file.path);

    const name = stripMd(file.name);
    const key = normalizeKey(name);
    const existing = byName.get(key);
    if (existing) {
      if (!existing.paths.includes(file.path)) existing.paths.push(file.path);
    } else {
      byName.set(key, { name, paths: [file.path] });
    }
  }

  return { files, byName, byPath };
}

/** The result of the resolution of a wiki-link target. */
export interface LinkResolution {
  /** The paths of the notes the target points to (empty when unknown). */
  paths: string[];
  /** True when the target matches more than one note. */
  ambiguous: boolean;
}

/**
 * Resolves a wiki-link target against the index.
 *
 * The rules mirror `createWikiResolver()` of `src/lib/wiki.ts`:
 *
 *   * a target with a `/` is a path (with or without the `.md` suffix);
 *   * a target without a `/` is a name (with or without the `.md` suffix);
 *   * the lookup is case insensitive.
 *
 * Unlike the resolver of the application, the plugin does NOT pick a winner
 * between the notes with the same name: all of them are returned and the
 * result is marked as ambiguous.
 */
export function resolveLinkTarget(index: NoteIndex, target: string): LinkResolution {
  const key = normalizeKey(target);
  if (!key) return { paths: [], ambiguous: false };

  if (key.includes('/')) {
    const direct = index.byPath.get(key) ?? index.byPath.get(normalizeKey(stripMd(target)));
    return direct ? { paths: [direct], ambiguous: false } : { paths: [], ambiguous: false };
  }

  const entry = index.byName.get(key) ?? index.byName.get(normalizeKey(stripMd(target)));
  if (!entry) return { paths: [], ambiguous: false };
  return { paths: [...entry.paths], ambiguous: entry.paths.length > 1 };
}

/* ---------------------------------------------------------------- mentions */

/** A note mentioned in the text of the open note. */
export interface MentionEntry {
  /** The name of the note. */
  name: string;
  /** The path of the note. */
  path: string;
  /** True when several notes carry that name. */
  ambiguous: boolean;
}

/**
 * Hides the wiki links of the text.
 *
 * The links are replaced with spaces, so the offsets of the text do not
 * change and a name that is only mentioned inside a link is not found
 * twice (a linked name is not an "unlinked" mention).
 */
export function maskWikiLinks(text: string): string {
  return text.replace(WIKI_LINK_RE, (match) => ' '.repeat(match.length));
}

/** True when the name contains at least one letter. */
export function hasLetter(name: string): boolean {
  return /\p{L}/u.test(name);
}

/**
 * Finds the notes that are named in the text, but not linked.
 *
 * The dictionary is the list of the names of the library. A name matches
 * when it occurs in the text as a whole word, case insensitively; the word
 * boundaries are Unicode aware (`\p{L}` / `\p{N}`), so the cyrillic names
 * work exactly like the latin ones.
 *
 * Protection against the false positives:
 *
 *   * the wiki links are masked out, so a linked name is not an unlinked
 *     mention;
 *   * the names shorter than `minLength` are ignored (a short name is a
 *     common word far more often than a note);
 *   * the names without a letter are ignored (numbers and symbols);
 *   * the whole group of the notes with that name is skipped when one of
 *     them is the open note itself: the mention is then most probably the
 *     title of the open note.
 */
export function findUnlinkedMentions(
  text: string,
  index: NoteIndex,
  openPath: string | null,
  minLength: number,
): MentionEntry[] {
  const masked = maskWikiLinks(text);
  const out: MentionEntry[] = [];

  for (const entry of index.byName.values()) {
    const length = Array.from(entry.name).length;
    if (length < minLength) continue;
    if (!hasLetter(entry.name)) continue;
    if (openPath !== null && entry.paths.includes(openPath)) continue;

    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}])${escapeRegExp(entry.name)}(?![\\p{L}\\p{N}])`,
      'iu',
    );
    if (!pattern.test(masked)) continue;

    for (const path of entry.paths) {
      out.push({ name: entry.name, path, ambiguous: entry.paths.length > 1 });
    }
  }

  return out;
}

/* ------------------------------------------------------------------- state */

/** A note that links to the open note. */
export interface BacklinkEntry {
  /** The name of the source note. */
  name: string;
  /** The path of the source note. */
  path: string;
  /** True when the link matched more than one note. */
  ambiguous: boolean;
}

/** The state shown by the panel. */
export interface BacklinksState {
  /** True when a note is open. */
  available: boolean;
  /** True when the graph was computed. */
  ready: boolean;
  /** The reason of the failure, null when everything is fine. */
  error: string | null;
  /** The path of the open note. */
  notePath: string | null;
  /** The notes that link to the open note. */
  backlinks: BacklinkEntry[];
  /** The notes that are named in the open note, but not linked. */
  unlinked: MentionEntry[];
}

/** The empty state: no note is open. */
export function emptyState(): BacklinksState {
  return {
    available: false,
    ready: false,
    error: null,
    notePath: null,
    backlinks: [],
    unlinked: [],
  };
}

/**
 * The shared state of the plugin.
 *
 * The subscriptions live in the plugin (and not in the view), so that they
 * can be removed on the deactivation.
 */
export class BacklinksStore {
  private state: BacklinksState = emptyState();
  private readonly listeners = new Set<() => void>();

  /** The current state. */
  get(): BacklinksState {
    return this.state;
  }

  /** Replaces the state and notifies the subscribers. */
  set(next: BacklinksState): void {
    this.state = next;
    for (const listener of Array.from(this.listeners)) listener();
  }

  /** Subscribes to the state changes. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/* -------------------------------------------------------------------- view */

interface BacklinksViewProps {
  /** The shared state of the plugin. */
  store: BacklinksStore;
}

/** The content of the panel. */
export function BacklinksView(props: BacklinksViewProps) {
  const [, bump] = useState(0);
  useEffect(() => props.store.subscribe(() => bump((n) => n + 1)), [props.store]);

  const state = props.store.get();

  if (state.error) {
    return h(
      'div',
      { class: 'noto-backlinks', 'data-plugin': 'backlinks' },
      h('span', { class: 'noto-backlinks-error' }, state.error),
    );
  }

  if (!state.available) {
    return h(
      'div',
      { class: 'noto-backlinks', 'data-plugin': 'backlinks' },
      h('span', { class: 'noto-backlinks-empty' }, 'Нет открытой заметки'),
    );
  }

  const backlinkItems = state.backlinks.map((item) =>
    h(
      'li',
      { key: `b:${item.path}`, class: 'noto-backlinks-item' },
      h('span', { class: 'noto-backlinks-name' }, item.name),
      h('span', { class: 'noto-backlinks-path' }, item.path),
      item.ambiguous ? h('span', { class: 'noto-backlinks-badge' }, 'неоднозначно') : null,
    ),
  );

  const unlinkedItems = state.unlinked.map((item) =>
    h(
      'li',
      { key: `u:${item.path}`, class: 'noto-backlinks-item' },
      h('span', { class: 'noto-backlinks-name' }, item.name),
      h('span', { class: 'noto-backlinks-path' }, item.path),
      h('span', { class: 'noto-backlinks-badge' }, 'без ссылки'),
      item.ambiguous ? h('span', { class: 'noto-backlinks-badge' }, 'неоднозначно') : null,
    ),
  );

  return h(
    'div',
    { class: 'noto-backlinks', 'data-plugin': 'backlinks' },
    h('div', { class: 'noto-backlinks-section' }, `Обратные ссылки (${state.backlinks.length})`),
    state.backlinks.length === 0
      ? h('div', { class: 'noto-backlinks-empty' }, 'Нет обратных ссылок')
      : h('ul', { class: 'noto-backlinks-list' }, backlinkItems),
    h('div', { class: 'noto-backlinks-section' }, `Упоминания без ссылки (${state.unlinked.length})`),
    state.unlinked.length === 0
      ? h('div', { class: 'noto-backlinks-empty' }, 'Нет упоминаний без ссылки')
      : h('ul', { class: 'noto-backlinks-list' }, unlinkedItems),
    h(
      'div',
      { class: 'noto-backlinks-hint' },
      'Открыть заметку из плагина нельзя — откройте её вручную.',
    ),
  );
}

/* ------------------------------------------------------------------ plugin */

/** True when the error is a permission error of the plugin platform. */
function isPermissionError(err: unknown): boolean {
  return err instanceof Error && err.name === 'PluginPermissionError';
}

/**
 * The plugin of the panel, with the extra helpers of the tests.
 *
 * The public contract of the platform is not extended: `waitIdle()` is a
 * convenience of the package, not an operation of the host.
 */
export interface BacklinksPlugin extends Plugin {
  /**
   * Resolves when the plugin is idle: no computation is running, none is
   * scheduled and no recomputation is pending.
   */
  waitIdle(): Promise<void>;
}

/** A computed result of the plugin, cached by the state of the note. */
interface CachedResult {
  /** The notes that link to the open note. */
  backlinks: BacklinkEntry[];
  /** The notes that are named in the open note, but not linked. */
  unlinked: MentionEntry[];
}

/**
 * Creates a new instance of the plugin.
 *
 * Every instance owns its own cache and its own registrations, so an instance
 * can be activated and deactivated independently.
 */
export function createBacklinksPlugin(): BacklinksPlugin {
  const store = new BacklinksStore();

  /** The wiki-link targets of every note, by path (the cache of the scan). */
  const linkCache = new Map<string, string[]>();
  /** The computed result, by the state of the open note. */
  const resultCache = new Map<string, CachedResult>();
  /** Cancels the subscription of the text changes of the current editor. */
  let unsubscribeChange: (() => void) | null = null;
  /** Cancels the subscription of the editor itself. */
  let unsubscribeEditor: (() => void) | null = null;
  /** The context of the activation (the callback of the debouncer needs it). */
  let activeCtx: PluginContext | null = null;
  /** The cleanups of the event subscriptions. */
  const eventCleanups: Array<() => void> = [];
  /** The current editor. */
  let editor: PluginEditor | null = null;
  /** The text of the open note. */
  let text = '';
  /** Cancels the registration of the panel. */
  let unregisterPanel: (() => void) | null = null;
  /** Cancels the registration of the sidebar item. */
  let unregisterSidebar: (() => void) | null = null;
  /** Cancels the registration of the command. */
  let unregisterCommand: (() => void) | null = null;
  /** True while a computation is running. */
  let running = false;
  /** True when a computation is requested while another one is running. */
  let pending = false;
  /** The resolvers of the callers of `waitIdle()`. */
  const idleResolvers: Array<() => void> = [];

  /**
   * The debounce of the recomputation.
   *
   * The implementation lives in the package of the plugin (`./debounce.ts`):
   * the shared helper of the application is out of the plugin boundary.
   */
  const debouncer: Debouncer = createDebouncer(() => {
    if (activeCtx) void compute(activeCtx);
  }, BACKLINKS_DEBOUNCE_MS);

  /** Resolves the callers of `waitIdle()` when the plugin is idle. */
  function checkIdle(): void {
    if (running || pending || debouncer.pending) return;
    const resolvers = idleResolvers.splice(0, idleResolvers.length);
    for (const resolve of resolvers) resolve();
  }

  /** Reads the settings of the plugin (with the defaults of the manifest). */
  async function readSettings(ctx: PluginContext): Promise<{ includeUnlinked: boolean; minLength: number }> {
    let includeUnlinked = true;
    let minLength = BACKLINKS_MIN_NAME_LENGTH;
    try {
      const stored = await ctx.settings.get<boolean>('includeUnlinked');
      if (typeof stored === 'boolean') includeUnlinked = stored;
    } catch {
      // The default of the manifest is used.
    }
    try {
      const stored = await ctx.settings.get<number>('minNameLength');
      if (typeof stored === 'number' && Number.isFinite(stored) && stored >= 0) {
        minLength = Math.floor(stored);
      }
    } catch {
      // The default of the manifest is used.
    }
    return { includeUnlinked, minLength };
  }

  /** Drops the cached content of a note (or of every note). */
  function invalidate(path?: string): void {
    if (path === undefined) linkCache.clear();
    else linkCache.delete(path);
    // The computed result depends on the whole library: it is dropped too.
    resultCache.clear();
  }

  /**
   * Reads the content of every note that is not cached yet.
   *
   * There is no bulk read in the contract, so this is one `getNote()` call
   * per note of the library — but only once per note: the result is cached
   * and invalidated by the events of the host.
   */
  async function scan(ctx: PluginContext, files: NodeLike[], skipPath: string | null): Promise<void> {
    for (const file of files) {
      if (file.path === skipPath) continue;
      if (linkCache.has(file.path)) continue;
      try {
        const note = await ctx.api.getNote(file.path);
        linkCache.set(file.path, extractWikiTargets(note.content ?? ''));
      } catch (err) {
        linkCache.delete(file.path);
        if (isPermissionError(err)) throw err;
        ctx.logger.warn('не удалось прочитать заметку', file.path, err);
      }
    }
  }

  /** Computes the graph of the open note and updates the state. */
  async function compute(ctx: PluginContext): Promise<void> {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    try {
      const current = editor;
      const path = current?.getPath() ?? null;

      if (!current || path === null) {
        store.set(emptyState());
        return;
      }

      const settings = await readSettings(ctx);

      // The cache of the result: the state of the note (path, text and the
      // settings) fully determines the answer, so an identical request is
      // answered without touching the library at all.
      const cacheKey = `${path} ${text} ${
        settings.includeUnlinked ? '1' : '0'
      } ${settings.minLength}`;
      const cached = resultCache.get(cacheKey);
      if (cached) {
        store.set({
          available: true,
          ready: true,
          error: null,
          notePath: path,
          backlinks: cached.backlinks,
          unlinked: cached.unlinked,
        });
        return;
      }

      let tree;
      try {
        tree = await ctx.api.getTree();
      } catch (err) {
        if (isPermissionError(err)) {
          store.set({
            ...emptyState(),
            available: true,
            error: 'Недостаточно прав для чтения заметок',
          });
          return;
        }
        ctx.logger.warn('не удалось прочитать дерево заметок', err);
        store.set({
          ...emptyState(),
          available: true,
          error: 'Не удалось прочитать дерево заметок',
        });
        return;
      }

      const files = (tree.files ?? []) as NodeLike[];
      const index = buildNoteIndex(files);

      try {
        await scan(ctx, files, path);
      } catch (err) {
        if (isPermissionError(err)) {
          store.set({
            ...emptyState(),
            available: true,
            error: 'Недостаточно прав для чтения заметок',
          });
          return;
        }
        ctx.logger.warn('не удалось построить граф ссылок', err);
      }

      // The backlinks: the notes whose links point to the open note.
      const backlinks: BacklinkEntry[] = [];
      for (const file of files) {
        if (file.path === path) continue;
        const targets = linkCache.get(file.path);
        if (!targets) continue;
        for (const target of targets) {
          const resolution = resolveLinkTarget(index, target);
          if (!resolution.paths.includes(path)) continue;
          backlinks.push({
            name: stripMd(file.name),
            path: file.path,
            ambiguous: resolution.ambiguous,
          });
          break;
        }
      }

      // The unlinked mentions: the names of the notes that occur in the text.
      const unlinked = settings.includeUnlinked
        ? findUnlinkedMentions(text, index, path, settings.minLength)
        : [];

      store.set({
        available: true,
        ready: true,
        error: null,
        notePath: path,
        backlinks,
        unlinked,
      });
      resultCache.set(cacheKey, { backlinks, unlinked });

      ctx.logger.debug('обратные ссылки пересчитаны', {
        backlinks: backlinks.length,
        unlinked: unlinked.length,
      });
    } finally {
      running = false;
      if (pending) {
        pending = false;
        void compute(ctx);
      } else {
        checkIdle();
      }
    }
  }

  /** Schedules a recomputation (the changes of the text are debounced). */
  function schedule(): void {
    debouncer.schedule();
  }

  return {
    manifest: backlinksManifest,

    async activate(ctx: PluginContext): Promise<void> {
      activeCtx = ctx;

      /** Attaches the plugin to an editor. */
      const attach = (next: PluginEditor | null): void => {
        if (unsubscribeChange) {
          unsubscribeChange();
          unsubscribeChange = null;
        }
        editor = next;
        if (!next) {
          text = '';
          store.set(emptyState());
          return;
        }
        text = next.getText();
        unsubscribeChange = next.onChange((value: string) => {
          text = value;
          schedule();
        });
        void compute(ctx);
      };

      if (typeof ctx.onEditor === 'function') {
        unsubscribeEditor = ctx.onEditor(attach);
      } else {
        attach(ctx.editor);
      }

      // The cache of the library is invalidated by the events of the host;
      // the panel is refreshed (the refresh is debounced like the typing).
      const refresh = (path?: string): void => {
        invalidate(path);
        schedule();
      };
      eventCleanups.push(
        ctx.on('note.updated', (payload) => refresh(payload.path)),
        ctx.on('note.created', (payload) => refresh(payload.path)),
        ctx.on('note.deleted', (payload) => refresh(payload.path)),
        ctx.on('note.renamed', (payload) => refresh(payload.previousPath)),
      );

      ctx.onDeactivate(() => {
        if (unsubscribeChange) {
          unsubscribeChange();
          unsubscribeChange = null;
        }
        if (unsubscribeEditor) {
          unsubscribeEditor();
          unsubscribeEditor = null;
        }
        debouncer.cancel();
        for (const cleanup of eventCleanups) cleanup();
        eventCleanups.length = 0;
        unregisterPanel?.();
        unregisterPanel = null;
        unregisterSidebar?.();
        unregisterSidebar = null;
        unregisterCommand?.();
        unregisterCommand = null;
        editor = null;
        text = '';
        activeCtx = null;
        linkCache.clear();
        resultCache.clear();
        store.set(emptyState());
        checkIdle();
      });

      unregisterPanel = ctx.registerPanel({
        id: BACKLINKS_PANEL_ID,
        title: 'Обратные ссылки',
        render: () => h(BacklinksView, { store }),
      });

      unregisterSidebar = ctx.registerSidebarItem({
        id: BACKLINKS_SIDEBAR_ID,
        title: 'Обратные ссылки',
        icon: 'link',
        onSelect: () => {
          void compute(ctx);
        },
      });

      unregisterCommand = ctx.registerCommand({
        id: BACKLINKS_COMMAND_ID,
        title: 'Показать обратные ссылки',
        description: 'Пересчитывает обратные ссылки и упоминания без ссылки для активной заметки.',
        run: async () => {
          await compute(ctx);
          const state = store.get();
          ctx.logger.info('обратные ссылки', {
            available: state.available,
            backlinks: state.backlinks.length,
            unlinked: state.unlinked.length,
          });
        },
      });
    },

    deactivate(): void {
      if (unsubscribeChange) {
        unsubscribeChange();
        unsubscribeChange = null;
      }
      if (unsubscribeEditor) {
        unsubscribeEditor();
        unsubscribeEditor = null;
      }
      debouncer.cancel();
      for (const cleanup of eventCleanups) cleanup();
      eventCleanups.length = 0;
      unregisterPanel?.();
      unregisterPanel = null;
      unregisterSidebar?.();
      unregisterSidebar = null;
      unregisterCommand?.();
      unregisterCommand = null;
      activeCtx = null;
      linkCache.clear();
      resultCache.clear();
      checkIdle();
    },

    /**
     * Resolves when the plugin is idle.
     *
     * The helper is used by the tests to observe the state of the plugin
     * without guessing how many microtask ticks an asynchronous computation
     * needs. It is a convenience of the package, not a part of the public
     * contract of the platform.
     */
    waitIdle(): Promise<void> {
      if (!running && !pending && !debouncer.pending) return Promise.resolve();
      return new Promise<void>((resolve) => {
        idleResolvers.push(resolve);
      });
    },
  };
}

/** The built-in instance of the plugin. */
export const backlinksPlugin: BacklinksPlugin = createBacklinksPlugin();
