// The graph of the notes.
//
// The panel draws the links of the vault: a note is a dot, a wiki link is a
// line. The drawing is a plain SVG with a circular layout — no layout engine,
// no new dependency.
//
// The graph is computed by `core/graph/graph.ts`, which is pure: the panel
// only reads the notes and draws what it is given. The list under the drawing
// is the fallback: it carries the same notes, with their links, for the
// readers who do not see the drawing.
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Node } from '../../types';
import {
  buildNoteGraph,
  layoutGraph,
  type GraphNote,
  type NoteGraph,
} from '../../core/graph/graph';
import { getVaultService } from '../../core/vault/vaultService';
import { useT } from '../../i18n/useT';
import { Icon } from '../../ui/icons';
import '../../styles/graph.css';

/** The greatest number of the notes the graph reads. */
export const GRAPH_MAX_NOTES = 60;

export interface GraphPanelProps {
  /** The notes of the vault. */
  files: Node[];
  /**
   * The notes of the graph, with their content.
   *
   * The panel reads the notes of the vault by itself when they are not given:
   * the shell knows the content of the open note only.
   */
  notes?: GraphNote[];
  /** Called when the user chooses a note of the graph. */
  onOpenNote(path: string): void;
  /** Called when the user closes the panel. */
  onClose?(): void;
}

/** The radius of a node of the drawing, in pixels. */
const NODE_RADIUS = 6;

/**
 * The graph of the notes of the vault.
 */
export function GraphPanel(props: GraphPanelProps) {
  const t = useT();
  const [graph, setGraph] = useState<NoteGraph | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (props.notes) {
      setGraph(buildNoteGraph(props.notes));
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const vault = getVaultService();
    const files = props.files.slice(0, GRAPH_MAX_NOTES);
    const read = async (file: Node): Promise<GraphNote> => {
      try {
        const note = await vault.readNote(file.path);
        return { path: file.path, name: file.name, content: note.content };
      } catch {
        // A note that cannot be read is still a node of the graph: it simply
        // has no link.
        return { path: file.path, name: file.name };
      }
    };
    void Promise.all(files.map(read)).then((notes) => {
      if (cancelled) return;
      setGraph(buildNoteGraph(notes));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [props.files, props.notes]);

  const layout = useMemo(() => (graph ? layoutGraph(graph) : null), [graph]);

  const open = (path: string): void => {
    props.onOpenNote(path);
  };

  return (
    <div class="graph-panel">
      <div class="graph-header">
        <span class="graph-title">{t('graph.title')}</span>
        {props.onClose ? (
          <button
            type="button"
            class="icon-button"
            title={t('graph.close')}
            aria-label={t('graph.close')}
            onClick={() => props.onClose?.()}
          >
            <Icon name="x" size={15} />
          </button>
        ) : null}
      </div>

      {loading ? <p class="graph-hint">{t('graph.loading')}</p> : null}

      {!loading && graph && graph.nodes.length === 0 ? (
        <p class="graph-hint">{t('graph.empty')}</p>
      ) : null}

      {!loading && graph && layout && graph.nodes.length > 0 ? (
        <>
          <svg
            class="graph-svg"
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            role="group"
            aria-label={t('graph.label')}
          >
            {graph.edges.map((edge) => {
              const from = layout.points.get(edge.from);
              const to = layout.points.get(edge.to);
              if (!from || !to) return null;
              return (
                <line
                  key={`${edge.from}->${edge.to}`}
                  class="graph-edge"
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                />
              );
            })}
            {graph.nodes.map((node) => {
              const point = layout.points.get(node.path);
              if (!point) return null;
              const orphan = graph.orphans.includes(node.path);
              return (
                <g
                  key={node.path}
                  class={`graph-node${orphan ? ' graph-node-orphan' : ''}`}
                  data-path={node.path}
                  role="button"
                  tabIndex={0}
                  aria-label={node.name}
                  onClick={() => open(node.path)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    open(node.path);
                  }}
                >
                  <circle cx={point.x} cy={point.y} r={NODE_RADIUS} />
                  <text x={point.x} y={point.y - NODE_RADIUS - 4} text-anchor="middle">
                    {node.name}
                  </text>
                </g>
              );
            })}
          </svg>

          <ul class="graph-list">
            {graph.nodes.map((node) => (
              <li key={node.path}>
                <button
                  type="button"
                  class="graph-list-item"
                  onClick={() => open(node.path)}
                  title={node.path}
                >
                  <span class="graph-list-name">{node.name}</span>
                  <span class="graph-list-count">
                    {node.out} / {node.in}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
