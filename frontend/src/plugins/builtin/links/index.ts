// The "Link Cards" built-in plugin.
//
// The plugin shows the notes around the note that is open right now: the
// notes it links to and the notes that link to it. Every neighbour is shown
// as a card with the title and the path of the note.
//
// The idea comes from the link cards of the `usememos/memos` project (MIT);
// only the idea and the UX are taken — not a line of its code.
//
// The plugin reads the vault through the public contract only:
//
//   * `ctx.api.query()`   — the notes of the vault (the query `path != ""`);
//   * `ctx.api.getNote()` — the text of a note (there is no bulk read);
//   * `ctx.editor`        — the text and the path of the open note;
//   * `ctx.registerPanel()` — the panel with the cards.
//
// The plugin does NOT import anything from the application: `src/lib/wiki.ts`
// is not reachable from a built-in plugin (rules R3 and R13), so the format of
// the wiki links is parsed here. The regular expression is intentionally
// identical to `WIKI_LINK_RE` of `src/lib/wiki.ts`.
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Plugin, PluginContext, PluginEditor, PluginManifest } from '../../contract';

/* ---------------------------------------------------------------- manifest */

/** Id of the panel contributed by the plugin. */
export const LINKS_PANEL_ID = 'links.panel';

/** The maximal number of the neighbours of the open note. */
export const LINKS_LIMIT = 100;

/** The query that selects every note of the vault. */
export const LINKS_QUERY = 'path != ""';

/**
 * Static description of the plugin.
 *
 * `editor.read` — the text and the path of the open note;
 * `notes.read` — the text of a note (`api.getNote`);
 * `query.read` — the notes of the vault (`api.query`);
 * `ui.contribute` — the panel and the command.
 */
export const linksManifest: PluginManifest = {
  id: 'links',
  name: 'Link Cards',
  version: '1.2.0',
  manifestVersion: 1,
  minApiVersion: '1.2.0',
  description: 'Shows the notes that link to the open note and the notes it links to.',
  author: 'Noto',
  permissions: ['editor.read', 'notes.read', 'query.read', 'ui.contribute'],
};

/* ------------------------------------------------------------------ helpers */

/**
 * The wiki-link syntax of the application.
 *
 * Identical to `WIKI_LINK_RE` of `src/lib/wiki.ts`; the plugin cannot import
 * that module (rules R3 and R13), so the pattern is repeated here.
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

/** The title of a note: the text of its first heading. */
export function titleOf(content: string): string {
  for (const line of content.split(/\r?\n/)) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) return (heading[2] as string).replace(/\s+#+\s*$/, '').trim();
  }
  return '';
}

/** A card of a neighbour of the open note. */
export interface LinkCard {
  /** The path of the note. */
  path: string;
  /** The file name of the note. */
  name: string;
  /** The title of the note (the text of the first heading). */
  title: string;
}

/**
 * Builds the dictionary of the names of the notes.
 *
 * A wiki link points at a note by its name (without the `.md` suffix) or by
 * its path; the lookup is case insensitive.
 */
export function buildDictionary(
  cards: readonly LinkCard[],
): { byName: Map<string, string>; byPath: Map<string, string> } {
  const byName = new Map<string, string>();
  const byPath = new Map<string, string>();
  for (const card of cards) {
    const name = normalizeKey(stripMd(card.name));
    if (!byName.has(name)) byName.set(name, card.path);
    const path = normalizeKey(card.path);
    if (!byPath.has(path)) byPath.set(path, card.path);
  }
  return { byName, byPath };
}

/**
 * Resolves a wiki target into the path of a note.
 *
 * A target with a `/` is a path, a target without a `/` is a name. A target
 * that matches no note is ignored: it never creates a phantom card.
 */
export function resolveTarget(
  target: string,
  dictionary: { byName: Map<string, string>; byPath: Map<string, string> },
): string | null {
  const key = normalizeKey(target);
  if (!key) return null;
  if (key.includes('/')) {
    return dictionary.byPath.get(key) ?? dictionary.byPath.get(normalizeKey(stripMd(target))) ?? null;
  }
  return (
    dictionary.byName.get(key) ?? dictionary.byName.get(normalizeKey(stripMd(target))) ?? null
  );
}

/* ------------------------------------------------------------------- store */

/** The state shown by the panel. */
export interface LinksState {
  /** True when a note is open. */
  available: boolean;
  /** True when the cards were computed. */
  ready: boolean;
  /** The reason of the failure, null when everything is fine. */
  error: string | null;
  /** The path of the open note. */
  notePath: string | null;
  /** The notes the open note links to. */
  outgoing: LinkCard[];
  /** The notes that link to the open note. */
  incoming: LinkCard[];
}

/** The empty state of the panel. */
export function emptyState(): LinksState {
  return {
    available: false,
    ready: false,
    error: null,
    notePath: null,
    outgoing: [],
    incoming: [],
  };
}

/**
 * The shared state of the plugin.
 *
 * The subscriptions live in the plugin (and not in the view), so that they
 * are removed on the deactivation.
 */
export class LinksStore {
  private state: LinksState = emptyState();
  private readonly listeners = new Set<() => void>();

  /** The current state. */
  get(): LinksState {
    return this.state;
  }

  /** Replaces the state and notifies the subscribers. */
  set(next: LinksState): void {
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

interface LinksViewProps {
  /** The shared state of the plugin. */
  store: LinksStore;
}

/** The content of the panel. */
export function LinksView(props: LinksViewProps) {
  const [, bump] = useState(0);
  useEffect(() => props.store.subscribe(() => bump((n) => n + 1)), [props.store]);

  const state = props.store.get();

  if (state.error) {
    return h(
      'div',
      { class: 'noto-links', 'data-plugin': 'links' },
      h('span', { class: 'noto-links-error' }, state.error),
    );
  }

  if (!state.available) {
    return h(
      'div',
      { class: 'noto-links', 'data-plugin': 'links' },
      h('span', { class: 'noto-links-empty' }, 'No note is open'),
    );
  }

  const cards = (items: readonly LinkCard[]) =>
    items.length === 0
      ? h('div', { class: 'noto-links-empty' }, '—')
      : h(
          'ul',
          { class: 'noto-links-cards' },
          items.map((card) =>
            h(
              'li',
              { key: card.path, class: 'noto-links-card-item' },
              h(
                'button',
                {
                  type: 'button',
                  class: 'noto-links-card',
                  'data-path': card.path,
                },
                h('span', { class: 'noto-links-card-title' }, card.title || card.name),
                h('span', { class: 'noto-links-card-path' }, card.path),
              ),
            ),
          ),
        );

  return h(
    'div',
    { class: 'noto-links', 'data-plugin': 'links' },
    h('div', { class: 'noto-links-section' }, `Links from this note (${state.outgoing.length})`),
    cards(state.outgoing),
    h('div', { class: 'noto-links-section' }, `Links to this note (${state.incoming.length})`),
    cards(state.incoming),
  );
}

/* ------------------------------------------------------------------ plugin */

/**
 * The plugin of the panel.
 *
 * The cards are computed when a note is opened and when the text of the open
 * note changes; the library is read note by note, because the public contract
 * has no bulk read.
 */
export const linksPlugin: Plugin = {
  manifest: linksManifest,

  async activate(ctx: PluginContext): Promise<void> {
    const store = new LinksStore();

    const compute = async (editor: PluginEditor | null): Promise<void> => {
      const path = editor?.getPath() ?? null;
      if (path === null) {
        store.set({ ...emptyState(), available: false });
        return;
      }
      const query = ctx.api.query;
      if (!query) {
        store.set({
          ...emptyState(),
          available: true,
          error: 'The query capability needs the plugin API 1.2.0.',
        });
        return;
      }
      try {
        const answer = await query.call(ctx.api, LINKS_QUERY, LINKS_LIMIT);
        const cards: LinkCard[] = [];
        const contents = new Map<string, string>();
        for (const hit of answer.hits) {
          const note = await ctx.api.getNote(hit.path);
          contents.set(hit.path, note.content);
          cards.push({ path: hit.path, name: hit.name, title: titleOf(note.content) });
        }
        const dictionary = buildDictionary(cards);
        const byPath = new Map(cards.map((card) => [card.path, card]));

        // The notes the open note links to.
        const outgoing: LinkCard[] = [];
        const text = editor?.getText() ?? '';
        for (const target of extractWikiTargets(text)) {
          const hit = resolveTarget(target, dictionary);
          if (!hit || hit === path) continue;
          const card = byPath.get(hit);
          if (card && !outgoing.some((item) => item.path === card.path)) outgoing.push(card);
        }

        // The notes that link to the open note.
        const incoming: LinkCard[] = [];
        for (const [notePath, content] of contents) {
          if (notePath === path) continue;
          const targets = extractWikiTargets(content);
          const pointsHere = targets.some((target) => {
            const hit = resolveTarget(target, dictionary);
            return hit === path;
          });
          if (!pointsHere) continue;
          const card = byPath.get(notePath);
          if (card) incoming.push(card);
        }

        store.set({
          available: true,
          ready: true,
          error: null,
          notePath: path,
          outgoing,
          incoming,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.logger.error('the link cards could not be built', { message });
        store.set({ ...emptyState(), available: true, error: message });
      }
    };

    /** Cancels the subscription of the text changes of the current editor. */
    let unsubscribeChange: (() => void) | null = null;

    const attach = (editor: PluginEditor | null): void => {
      if (unsubscribeChange) {
        unsubscribeChange();
        unsubscribeChange = null;
      }
      void compute(editor);
      if (editor) {
        unsubscribeChange = editor.onChange(() => {
          void compute(editor);
        });
      }
    };

    let unsubscribeEditor: (() => void) | null = null;
    if (typeof ctx.onEditor === 'function') {
      unsubscribeEditor = ctx.onEditor(attach);
    } else {
      attach(ctx.editor);
    }

    ctx.onDeactivate(() => {
      if (unsubscribeChange) {
        unsubscribeChange();
        unsubscribeChange = null;
      }
      if (unsubscribeEditor) {
        unsubscribeEditor();
        unsubscribeEditor = null;
      }
    });

    ctx.registerPanel({
      id: LINKS_PANEL_ID,
      title: 'Link Cards',
      render: () => h(LinksView, { store }),
    });

    ctx.registerCommand({
      id: 'links.rebuild',
      title: 'Link Cards: rebuild the cards',
      description: 'Rebuilds the cards of the neighbours of the open note.',
      run: () => {
        void compute(ctx.editor);
      },
    });
  },
};
