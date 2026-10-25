// The tests of the graph of the notes.
//
// The graph is computed by a pure module: the tests give it the notes and read
// the nodes, the edges and the orphans back.
import { describe, expect, it } from 'vitest';
import {
  buildNoteGraph,
  graphComponents,
  layoutGraph,
  wikiTargetOf,
  type GraphNote,
} from '../core/graph/graph';

/** A note of the vault of the tests. */
function note(path: string, name: string, content = ''): GraphNote {
  return { path, name, content };
}

describe('the graph of the notes', () => {
  it('makes a node of every note', () => {
    const graph = buildNoteGraph([note('a.md', 'a.md'), note('b.md', 'b.md')]);
    expect(graph.nodes.map((node) => node.path)).toEqual(['a.md', 'b.md']);
  });

  it('makes an edge of every wiki link', () => {
    const graph = buildNoteGraph([
      note('a.md', 'a.md', 'See [[b]] for the details.'),
      note('b.md', 'b.md'),
    ]);
    expect(graph.edges).toEqual([{ from: 'a.md', to: 'b.md' }]);
  });

  it('counts the links of a note and the links that come to it', () => {
    const graph = buildNoteGraph([
      note('a.md', 'a.md', '[[b]] and [[c]]'),
      note('b.md', 'b.md', '[[c]]'),
      note('c.md', 'c.md'),
    ]);
    const byPath = new Map(graph.nodes.map((node) => [node.path, node]));
    expect(byPath.get('a.md')?.out).toBe(2);
    expect(byPath.get('c.md')?.in).toBe(2);
  });

  it('resolves a link by the name of the note, with or without the suffix', () => {
    const graph = buildNoteGraph([
      note('journal/a.md', 'a.md', '[[b]] and [[c.md]]'),
      note('journal/b.md', 'b.md'),
      note('journal/c.md', 'c.md'),
    ]);
    expect(graph.edges.map((edge) => edge.to)).toEqual(['journal/b.md', 'journal/c.md']);
  });

  it('resolves a link by the path of the note', () => {
    const graph = buildNoteGraph([
      note('a.md', 'a.md', '[[journal/b]]'),
      note('journal/b.md', 'b.md'),
    ]);
    expect(graph.edges).toEqual([{ from: 'a.md', to: 'journal/b.md' }]);
  });

  it('ignores the links that point outside of the vault', () => {
    const graph = buildNoteGraph([note('a.md', 'a.md', '[[nowhere]]')]);
    expect(graph.edges).toEqual([]);
  });

  it('ignores the link of a note to itself', () => {
    const graph = buildNoteGraph([note('a.md', 'a.md', '[[a]]')]);
    expect(graph.edges).toEqual([]);
  });

  it('keeps one edge when two notes link to the same note', () => {
    const graph = buildNoteGraph([
      note('a.md', 'a.md', '[[b]] [[b]]'),
      note('b.md', 'b.md'),
    ]);
    expect(graph.edges).toHaveLength(1);
  });

  it('names the notes that are linked to nothing', () => {
    const graph = buildNoteGraph([
      note('a.md', 'a.md', '[[b]]'),
      note('b.md', 'b.md'),
      note('lonely.md', 'lonely.md'),
    ]);
    expect(graph.orphans).toEqual(['lonely.md']);
  });

  it('reads the alias and the anchor of a link', () => {
    expect(wikiTargetOf('Note|The note')).toBe('Note');
    expect(wikiTargetOf('Note#Section')).toBe('Note');
    expect(wikiTargetOf('Note#Section|The note')).toBe('Note');
  });
});

describe('the drawing of the graph', () => {
  it('puts every node of the graph on the drawing', () => {
    const graph = buildNoteGraph([note('a.md', 'a.md'), note('b.md', 'b.md'), note('c.md', 'c.md')]);
    const layout = layoutGraph(graph, { width: 200, height: 200 });
    expect(layout.points.size).toBe(3);
    for (const point of layout.points.values()) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('draws the same graph the same way twice', () => {
    const graph = buildNoteGraph([note('a.md', 'a.md', '[[b]]'), note('b.md', 'b.md')]);
    const first = layoutGraph(graph);
    const second = layoutGraph(graph);
    expect([...first.points.entries()]).toEqual([...second.points.entries()]);
  });

  it('puts a lonely note in the middle of the drawing', () => {
    const graph = buildNoteGraph([note('a.md', 'a.md')]);
    const layout = layoutGraph(graph, { width: 200, height: 100 });
    expect(layout.points.get('a.md')).toEqual({ x: 100, y: 50 });
  });

  it('keeps the notes of a group next to each other', () => {
    const graph = buildNoteGraph([
      note('a.md', 'a.md', '[[b]]'),
      note('b.md', 'b.md'),
      note('c.md', 'c.md'),
    ]);
    const groups = graphComponents(graph);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual(['a.md', 'b.md']);
    expect(groups[1]).toEqual(['c.md']);
  });
});
