// The "Graph" built-in plugin.
//
// The plugin shows the notes of the vault as a small graph of the links
// between them: every note is a node, every wiki link (`[[Note]]`) is an edge.
//
// The idea comes from the graph view of the `usememos/memos` project (MIT);
// only the idea and the UX are taken — not a line of its code.
//
// The plugin reads the vault through the public contract only:
//
//   * `ctx.api.query()`   — the list of the notes (the query `path != ""`);
//   * `ctx.api.getNote()` — the text of a note (there is no bulk read);
//   * `ctx.registerPanel()` — the panel with the graph.
//
// The plugin does NOT import anything from the application: `src/lib/wiki.ts`
// is not reachable from a built-in plugin (rules R3 and R13), so the format of
// the wiki links is parsed here. The regular expression is intentionally
// identical to `WIKI_LINK_RE` of `src/lib/wiki.ts`:
//
//     /\[\[([^\[\]\n]+)\]\]/g
//
// The layout is deterministic: the nodes are sorted by their path and put on
// a ring, so the same vault always gives the same picture. There is no
// physics and no randomness: a plugin must not depend on a random seed.
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Plugin, PluginContext, PluginManifest } from '../../contract';

/* ---------------------------------------------------------------- manifest */

/** Id of the panel contributed by the plugin. */
export const GRAPH_PANEL_ID = 'graph.panel';

/** The maximal number of the notes of the graph. */
export const GRAPH_NOTE_LIMIT = 200;

/** The size of the square of the graph, in pixels. */
export const GRAPH_SIZE = 320;

/**
 * Static description of the plugin.
 *
 * `query.read` — the list of the notes (`api.query`);
 * `notes.read` — the text of a note (`api.getNote`);
 * `ui.contribute` — the panel and the command.
 */
export const graphManifest: PluginManifest = {
  id: 'graph',
  name: 'Graph',
  version: '1.2.0',
  manifestVersion: 1,
  minApiVersion: '1.2.0',
  description: 'Shows the notes of the vault as a graph of the links between them.',
  author: 'Noto',
  permissions: ['notes.read', 'query.read', 'ui.contribute'],
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

/* -------------------------------------------------------------------- graph */

/** A note of the graph. */
export interface GraphNote {
  /** The path of the note. */
  path: string;
  /** The file name of the note. */
  name: string;
  /** The title of the note (the text of the first heading). */
  title: string;
}

/** A node of the graph, with its place on the picture. */
export interface GraphNode extends GraphNote {
  /** The horizontal coordinate, in pixels. */
  x: number;
  /** The vertical coordinate, in pixels. */
  y: number;
}

/** A link between two notes of the graph. */
export interface GraphEdge {
  /** The path of the source note. */
  from: string;
  /** The path of the target note. */
  to: string;
}

/** The whole graph. */
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * The query that selects every note of the vault.
 *
 * The path of a note is never empty, so `path != ""` matches every note.
 */
export const GRAPH_QUERY = 'path != ""';

/**
 * Puts the notes on a ring.
 *
 * The notes are sorted by their path, so the layout depends only on the set
 * of the notes and never on the order of the answers.
 */
export function layoutNodes(notes: readonly GraphNote[], size = GRAPH_SIZE): GraphNode[] {
  const sorted = [...notes].sort((a, b) => a.path.localeCompare(b.path));
  const center = size / 2;
  const radius = size * 0.38;
  return sorted.map((note, index) => {
    const angle = (2 * Math.PI * index) / Math.max(sorted.length, 1) - Math.PI / 2;
    return {
      ...note,
      x: Math.round((center + radius * Math.cos(angle)) * 100) / 100,
      y: Math.round((center + radius * Math.sin(angle)) * 100) / 100,
    };
  });
}

/**
 * Resolves the wiki targets of the notes into the paths of the notes.
 *
 * A target with a `/` is a path, a target without a `/` is a name; the lookup
 * is case insensitive and the `.md` suffix is optional. A target that matches
 * no note is ignored: it never creates a phantom node.
 */
export function resolveTargets(
  notes: readonly GraphNote[],
  targets: ReadonlyMap<string, string[]>,
): Map<string, string[]> {
  const byName = new Map<string, string>();
  const byPath = new Map<string, string>();
  for (const note of notes) {
    const name = normalizeKey(stripMd(note.name));
    if (!byName.has(name)) byName.set(name, note.path);
    const path = normalizeKey(note.path);
    if (!byPath.has(path)) byPath.set(path, note.path);
  }

  const resolved = new Map<string, string[]>();
  for (const note of notes) {
    const out: string[] = [];
    for (const target of targets.get(note.path) ?? []) {
      const key = normalizeKey(target);
      if (!key) continue;
      const hit = key.includes('/')
        ? byPath.get(key) ?? byPath.get(normalizeKey(stripMd(target)))
        : byName.get(key) ?? byName.get(normalizeKey(stripMd(target)));
      if (!hit || hit === note.path) continue;
      if (!out.includes(hit)) out.push(hit);
    }
    resolved.set(note.path, out);
  }
  return resolved;
}

/**
 * Builds the graph: the nodes on the ring and the edges between them.
 *
 * A link to a note that is not in the graph (it was cut by the limit) is not
 * drawn: the picture never shows a node that does not exist.
 */
export function buildGraph(
  notes: readonly GraphNote[],
  targets: ReadonlyMap<string, string[]>,
  size = GRAPH_SIZE,
): GraphData {
  const resolved = resolveTargets(notes, targets);
  const known = new Set(notes.map((note) => note.path));
  const edges: GraphEdge[] = [];
  for (const [from, targetsOfNote] of resolved) {
    for (const to of targetsOfNote) {
      if (!known.has(to)) continue;
      edges.push({ from, to });
    }
  }
  return { nodes: layoutNodes(notes, size), edges };
}

/* ------------------------------------------------------------------- store */

/** The state shown by the panel. */
export interface GraphState {
  /** True when the graph was computed. */
  ready: boolean;
  /** The reason of the failure, null when everything is fine. */
  error: string | null;
  /** The graph itself. */
  data: GraphData;
}

/** The empty state of the panel. */
export function emptyState(): GraphState {
  return { ready: false, error: null, data: { nodes: [], edges: [] } };
}

/**
 * The shared state of the plugin.
 *
 * The subscriptions live in the plugin (and not in the view), so that they
 * are removed on the deactivation.
 */
export class GraphStore {
  private state: GraphState = emptyState();
  private readonly listeners = new Set<() => void>();

  /** The current state. */
  get(): GraphState {
    return this.state;
  }

  /** Replaces the state and notifies the subscribers. */
  set(next: GraphState): void {
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

interface GraphViewProps {
  /** The shared state of the plugin. */
  store: GraphStore;
}

/** The content of the panel. */
export function GraphView(props: GraphViewProps) {
  const [, bump] = useState(0);
  useEffect(() => props.store.subscribe(() => bump((n) => n + 1)), [props.store]);

  const state = props.store.get();

  if (state.error) {
    return h(
      'div',
      { class: 'noto-graph', 'data-plugin': 'graph' },
      h('span', { class: 'noto-graph-error' }, state.error),
    );
  }

  if (!state.ready) {
    return h(
      'div',
      { class: 'noto-graph', 'data-plugin': 'graph' },
      h('span', { class: 'noto-graph-empty' }, 'The graph is being built…'),
    );
  }

  const byPath = new Map(state.data.nodes.map((node) => [node.path, node]));
  const edges = state.data.edges
    .map((edge) => {
      const from = byPath.get(edge.from);
      const to = byPath.get(edge.to);
      if (!from || !to) return null;
      return h('line', {
        key: `${edge.from}->${edge.to}`,
        class: 'noto-graph-edge',
        x1: from.x,
        y1: from.y,
        x2: to.x,
        y2: to.y,
      });
    })
    .filter((node) => node !== null);

  const nodes = state.data.nodes.map((node) =>
    h(
      'circle',
      {
        key: node.path,
        class: 'noto-graph-node',
        'data-path': node.path,
        cx: node.x,
        cy: node.y,
        r: 6,
      },
      h('title', {}, node.title || node.name),
    ),
  );

  return h(
    'div',
    { class: 'noto-graph', 'data-plugin': 'graph' },
    h(
      'svg',
      {
        class: 'noto-graph-svg',
        viewBox: `0 0 ${GRAPH_SIZE} ${GRAPH_SIZE}`,
        width: '100%',
        role: 'img',
        'aria-label': 'The graph of the links between the notes',
      },
      edges,
      nodes,
    ),
    h(
      'div',
      { class: 'noto-graph-legend' },
      `Notes: ${state.data.nodes.length}, links: ${state.data.edges.length}`,
    ),
  );
}

/* ------------------------------------------------------------------ plugin */

/**
 * The plugin of the panel.
 *
 * The graph is computed once at the activation and refreshed when a note
 * changes: the events of the platform carry the paths only, never the text.
 */
export const graphPlugin: Plugin = {
  manifest: graphManifest,

  async activate(ctx: PluginContext): Promise<void> {
    const store = new GraphStore();

    const compute = async (): Promise<void> => {
      const query = ctx.api.query;
      if (!query) {
        store.set({
          ready: false,
          error: 'The query capability needs the plugin API 1.2.0.',
          data: emptyState().data,
        });
        return;
      }
      try {
        const answer = await query.call(ctx.api, GRAPH_QUERY, GRAPH_NOTE_LIMIT);
        const notes: GraphNote[] = [];
        const targets = new Map<string, string[]>();
        for (const hit of answer.hits) {
          const note = await ctx.api.getNote(hit.path);
          notes.push({ path: hit.path, name: hit.name, title: titleOf(note.content) });
          targets.set(hit.path, extractWikiTargets(note.content));
        }
        store.set({ ready: true, error: null, data: buildGraph(notes, targets) });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.logger.error('the graph could not be built', { message });
        store.set({ ready: false, error: message, data: emptyState().data });
      }
    };

    const refresh = (): void => {
      void compute();
    };

    const cleanups = [
      ctx.on('note.created', refresh),
      ctx.on('note.updated', refresh),
      ctx.on('note.deleted', refresh),
      ctx.on('note.renamed', refresh),
    ];

    ctx.onDeactivate(() => {
      for (const cleanup of cleanups) cleanup();
    });

    ctx.registerPanel({
      id: GRAPH_PANEL_ID,
      title: 'Graph',
      render: () => h(GraphView, { store }),
    });

    ctx.registerCommand({
      id: 'graph.rebuild',
      title: 'Graph: rebuild the graph',
      description: 'Rebuilds the graph of the links between the notes.',
      run: () => {
        void compute();
      },
    });

    await compute();
  },
};
