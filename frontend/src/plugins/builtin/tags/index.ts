// The "Tags" built-in plugin.
//
// The plugin lists the tags of the vault with the number of the notes that
// carry them, and lets the user filter the notes by a tag.
//
// The idea comes from the tag panel of the `usememos/memos` project (MIT);
// only the idea and the UX are taken — not a line of its code.
//
// The plugin reads the vault through the public contract only:
//
//   * `ctx.api.tags()`  — the tags with their counters (the permission
//     `query.read`);
//   * `ctx.api.query()` — the notes of the selected tag;
//   * `ctx.registerPanel()` — the panel with the list of the tags.
//
// The plugin does NOT import anything from the application (rules R3 and
// R13): the query of a tag is built here, from the value of the tag.
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Plugin, PluginContext, PluginManifest, TagCountLike } from '../../contract';

/* ---------------------------------------------------------------- manifest */

/** Id of the panel contributed by the plugin. */
export const TAGS_PANEL_ID = 'tags.panel';

/** The maximal number of the notes shown for one tag. */
export const TAGS_HIT_LIMIT = 50;

/**
 * Static description of the plugin.
 *
 * `query.read` — the tags of the vault (`api.tags`) and the notes of a tag
 * (`api.query`);
 * `ui.contribute` — the panel and the command.
 */
export const tagsManifest: PluginManifest = {
  id: 'tags',
  name: 'Tags',
  version: '1.2.0',
  manifestVersion: 1,
  minApiVersion: '1.2.0',
  description: 'Lists the tags of the vault and filters the notes by a tag.',
  author: 'Noto',
  permissions: ['query.read', 'ui.contribute'],
};

/* ------------------------------------------------------------------ helpers */

/**
 * Quotes the value of a tag for a query.
 *
 * The value of a tag comes from the vault, so it is escaped: a quote or a
 * backslash inside the value must not break the query.
 */
export function quoteTag(tag: string): string {
  return `"${tag.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Builds the query that selects the notes of a tag. */
export function tagQuery(tag: string): string {
  return `tag == ${quoteTag(tag)}`;
}

/* ------------------------------------------------------------------- store */

/** The state shown by the panel. */
export interface TagsState {
  /** True when the tags were read. */
  ready: boolean;
  /** The reason of the failure, null when everything is fine. */
  error: string | null;
  /** The tags of the vault with their counters. */
  tags: TagCountLike[];
  /** The selected tag, null when nothing is selected. */
  selected: string | null;
  /** The paths of the notes of the selected tag. */
  paths: string[];
}

/** The empty state of the panel. */
export function emptyState(): TagsState {
  return { ready: false, error: null, tags: [], selected: null, paths: [] };
}

/**
 * The shared state of the plugin.
 *
 * The subscriptions live in the plugin (and not in the view), so that they
 * are removed on the deactivation.
 */
export class TagsStore {
  private state: TagsState = emptyState();
  private readonly listeners = new Set<() => void>();

  /** The current state. */
  get(): TagsState {
    return this.state;
  }

  /** Replaces the state and notifies the subscribers. */
  set(next: TagsState): void {
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

interface TagsViewProps {
  /** The shared state of the plugin. */
  store: TagsStore;
  /** Selects a tag (or clears the selection when the tag is null). */
  select: (tag: string | null) => void;
}

/** The content of the panel. */
export function TagsView(props: TagsViewProps) {
  const [, bump] = useState(0);
  useEffect(() => props.store.subscribe(() => bump((n) => n + 1)), [props.store]);

  const state = props.store.get();

  if (state.error) {
    return h(
      'div',
      { class: 'noto-tags', 'data-plugin': 'tags' },
      h('span', { class: 'noto-tags-error' }, state.error),
    );
  }

  if (!state.ready) {
    return h(
      'div',
      { class: 'noto-tags', 'data-plugin': 'tags' },
      h('span', { class: 'noto-tags-empty' }, 'The tags are being read…'),
    );
  }

  const items = state.tags.map((tag) =>
    h(
      'li',
      { key: tag.tag, class: 'noto-tags-item' },
      h(
        'button',
        {
          type: 'button',
          class: state.selected === tag.tag ? 'noto-tags-button active' : 'noto-tags-button',
          'data-tag': tag.tag,
          onClick: () => props.select(state.selected === tag.tag ? null : tag.tag),
        },
        h('span', { class: 'noto-tags-name' }, `#${tag.tag}`),
        h('span', { class: 'noto-tags-count' }, String(tag.count)),
      ),
    ),
  );

  return h(
    'div',
    { class: 'noto-tags', 'data-plugin': 'tags' },
    state.tags.length === 0
      ? h('div', { class: 'noto-tags-empty' }, 'The vault has no tags')
      : h('ul', { class: 'noto-tags-list' }, items),
    state.selected === null
      ? null
      : h(
          'div',
          { class: 'noto-tags-selection' },
          h('div', { class: 'noto-tags-selection-title' }, `#${state.selected}`),
          state.paths.length === 0
            ? h('div', { class: 'noto-tags-empty' }, 'No note carries this tag')
            : h(
                'ul',
                { class: 'noto-tags-notes' },
                state.paths.map((path) =>
                  h('li', { key: path, class: 'noto-tags-note' }, path),
                ),
              ),
        ),
  );
}

/* ------------------------------------------------------------------ plugin */

/**
 * The plugin of the panel.
 *
 * The list of the tags is read once at the activation and refreshed when a
 * note changes: a new tag can appear only after a note was written.
 */
export const tagsPlugin: Plugin = {
  manifest: tagsManifest,

  async activate(ctx: PluginContext): Promise<void> {
    const store = new TagsStore();

    const loadTags = async (): Promise<TagCountLike[]> => {
      const tags = ctx.api.tags;
      if (!tags) {
        throw new Error('The tag capability needs the plugin API 1.2.0.');
      }
      return tags.call(ctx.api);
    };

    const loadNotes = async (tag: string): Promise<string[]> => {
      const query = ctx.api.query;
      if (!query) {
        throw new Error('The query capability needs the plugin API 1.2.0.');
      }
      const answer = await query.call(ctx.api, tagQuery(tag), TAGS_HIT_LIMIT);
      return answer.hits.map((hit) => hit.path);
    };

    const refresh = async (): Promise<void> => {
      try {
        const tags = await loadTags();
        const selected = store.get().selected;
        const paths = selected === null ? [] : await loadNotes(selected);
        store.set({ ready: true, error: null, tags, selected, paths });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.logger.error('the tags could not be read', { message });
        store.set({ ...emptyState(), error: message });
      }
    };

    const select = (tag: string | null): void => {
      if (tag === null) {
        const state = store.get();
        store.set({ ...state, selected: null, paths: [] });
        return;
      }
      store.set({ ...store.get(), selected: tag, paths: [] });
      void (async () => {
        try {
          const paths = await loadNotes(tag);
          store.set({ ...store.get(), selected: tag, paths });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          ctx.logger.error('the notes of the tag could not be read', { message });
          store.set({ ...store.get(), error: message });
        }
      })();
    };

    const cleanups = [
      ctx.on('note.created', () => void refresh()),
      ctx.on('note.updated', () => void refresh()),
      ctx.on('note.deleted', () => void refresh()),
      ctx.on('note.renamed', () => void refresh()),
      // A saved note can carry a new tag. Without this the panel would keep
      // the list it read when the note was opened: the tag of a note that was
      // just written would never show up.
      ctx.on('editor.saved', () => void refresh()),
    ];

    ctx.onDeactivate(() => {
      for (const cleanup of cleanups) cleanup();
    });

    ctx.registerPanel({
      id: TAGS_PANEL_ID,
      title: 'Tags',
      render: () => h(TagsView, { store, select }),
    });

    ctx.registerCommand({
      id: 'tags.refresh',
      title: 'Tags: refresh the list',
      description: 'Reads the tags of the vault again.',
      run: () => {
        void refresh();
      },
    });

    await refresh();
  },
};
