// The graph of the notes.
//
// A note of the vault is a node of the graph, a wiki link (`[[Target]]`) is
// an edge. The module is pure: it reads the notes it is given and returns the
// graph. It never touches the storage, the network or the interface, so the
// graph of a vault can be computed (and tested) without a running backend.
//
// The layout is deliberately simple — a circle, with the connected notes
// placed next to each other — so that the graph is drawn with a plain SVG and
// without a layout engine.
import { extractWikiTargets, stripMd } from '../../lib/wiki';

/** A note of the vault, as the graph needs it. */
export interface GraphNote {
  /** The path of the note ("notes/todo.md"). */
  path: string;
  /** The name of the note ("todo.md"). */
  name: string;
  /** The content of the note; the wiki links are read from it. */
  content?: string;
}

/** A node of the graph. */
export interface GraphNode {
  path: string;
  name: string;
  /** The number of the notes this note links to. */
  out: number;
  /** The number of the notes that link to this note. */
  in: number;
}

/** An edge of the graph: a link from one note to another. */
export interface GraphEdge {
  from: string;
  to: string;
}

/** The graph of a set of notes. */
export interface NoteGraph {
  /** The nodes, sorted by path. */
  nodes: GraphNode[];
  /** The edges, sorted by the path of their ends. */
  edges: GraphEdge[];
  /** The paths of the notes that link to nothing and that nothing links to. */
  orphans: string[];
}

/** A point of the drawing of the graph. */
export interface GraphPoint {
  x: number;
  y: number;
}

/** The drawing of the graph. */
export interface GraphLayout {
  width: number;
  height: number;
  /** The position of every node, by path. */
  points: Map<string, GraphPoint>;
}

/** The default size of the drawing. */
export const GRAPH_WIDTH = 640;
/** The default size of the drawing. */
export const GRAPH_HEIGHT = 420;
/** The space kept between a node and the border of the drawing. */
export const GRAPH_PADDING = 32;

/** The key of a name or of a path: the comparison ignores the case and the spaces. */
function keyOf(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Removes the alias and the anchor of a wiki link target.
 *
 * `[[Note|The note]]` links to `Note`, and `[[Note#Section]]` links to the
 * note `Note` as well.
 */
export function wikiTargetOf(raw: string): string {
  const withoutAlias = raw.split('|')[0];
  const withoutAnchor = withoutAlias.split('#')[0];
  return withoutAnchor.trim();
}

/**
 * The index of the notes of a graph.
 *
 * A wiki link may address a note by its name ("[[Todo]]", "[[Todo.md]]") or
 * by its path ("[[notes/todo.md]]"). The comparison ignores the case.
 */
function indexNotes(notes: readonly GraphNote[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const note of notes) {
    const name = keyOf(note.name);
    if (name && !index.has(name)) index.set(name, note.path);
    const bare = keyOf(stripMd(note.name));
    if (bare && !index.has(bare)) index.set(bare, note.path);
    const path = keyOf(note.path);
    if (path && !index.has(path)) index.set(path, note.path);
    // A link may address a note by its path without the suffix.
    const barePath = keyOf(stripMd(note.path));
    if (barePath && !index.has(barePath)) index.set(barePath, note.path);
  }
  return index;
}

/**
 * The path of the note a link points to, or null when the link points outside
 * of the set of the notes.
 */
function resolveTarget(target: string, index: Map<string, string>): string | null {
  const key = keyOf(target);
  if (!key) return null;
  return (
    index.get(key) ??
    index.get(`${key}.md`) ??
    index.get(keyOf(stripMd(target))) ??
    null
  );
}

/**
 * Builds the graph of a set of notes.
 *
 * The links that point at a note outside of the set are ignored: the graph
 * shows the vault the user is looking at, not the vault she imagined.
 */
export function buildNoteGraph(notes: readonly GraphNote[]): NoteGraph {
  const sorted = [...notes].sort((a, b) => a.path.localeCompare(b.path));
  const index = indexNotes(sorted);

  const out = new Map<string, number>();
  const incoming = new Map<string, number>();
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];

  for (const note of sorted) {
    for (const raw of extractWikiTargets(note.content ?? '')) {
      const target = wikiTargetOf(raw);
      if (!target) continue;
      const resolved = resolveTarget(target, index);
      if (!resolved || resolved === note.path) continue;
      const edgeKey = `${note.path}\u0000${resolved}`;
      if (seen.has(edgeKey)) continue;
      seen.add(edgeKey);
      edges.push({ from: note.path, to: resolved });
      out.set(note.path, (out.get(note.path) ?? 0) + 1);
      incoming.set(resolved, (incoming.get(resolved) ?? 0) + 1);
    }
  }

  edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  const nodes: GraphNode[] = sorted.map((note) => ({
    path: note.path,
    name: note.name,
    out: out.get(note.path) ?? 0,
    in: incoming.get(note.path) ?? 0,
  }));

  const orphans = nodes.filter((node) => node.out === 0 && node.in === 0).map((node) => node.path);

  return { nodes, edges, orphans };
}

/**
 * The connected components of the graph.
 *
 * The notes of a component are drawn next to each other, so that a link is
 * never drawn across the whole drawing.
 */
export function graphComponents(graph: NoteGraph): string[][] {
  const parent = new Map<string, string>();
  const find = (path: string): string => {
    let current = path;
    while (parent.get(current) !== current) current = parent.get(current) ?? current;
    // The path is compressed, so that the tree stays flat.
    let walker = path;
    while (parent.get(walker) !== current) {
      const next = parent.get(walker) ?? current;
      parent.set(walker, current);
      walker = next;
    }
    return current;
  };

  for (const node of graph.nodes) parent.set(node.path, node.path);
  for (const edge of graph.edges) {
    const left = find(edge.from);
    const right = find(edge.to);
    if (left !== right) parent.set(left, right);
  }

  const groups = new Map<string, string[]>();
  for (const node of graph.nodes) {
    const root = find(node.path);
    const group = groups.get(root);
    if (group) group.push(node.path);
    else groups.set(root, [node.path]);
  }

  return [...groups.values()].sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}

/**
 * Draws the graph on a circle.
 *
 * The notes of a connected component follow each other on the circle, so that
 * the links of a component are short. The drawing is deterministic: the same
 * graph always gives the same picture.
 */
export function layoutGraph(
  graph: NoteGraph,
  options: { width?: number; height?: number; padding?: number } = {},
): GraphLayout {
  const width = options.width ?? GRAPH_WIDTH;
  const height = options.height ?? GRAPH_HEIGHT;
  const padding = options.padding ?? GRAPH_PADDING;
  const points = new Map<string, GraphPoint>();

  const order = graphComponents(graph).flat();
  const count = order.length;
  if (count === 0) return { width, height, points };
  if (count === 1) {
    points.set(order[0], { x: width / 2, y: height / 2 });
    return { width, height, points };
  }

  const radius = Math.max(0, Math.min(width, height) / 2 - padding);
  const centerX = width / 2;
  const centerY = height / 2;

  order.forEach((path, index) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / count;
    points.set(path, {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    });
  });

  return { width, height, points };
}
