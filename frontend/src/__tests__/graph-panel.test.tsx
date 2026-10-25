// The tests of the panel of the graph.
//
// The panel draws the links of the vault and opens the note the user chooses.
// The notes are given to the panel by the tests, so that the test never reads
// the storage.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { GraphPanel } from '../components/sections/GraphPanel';

const notes = [
  { path: 'a.md', name: 'a.md', content: 'See [[b]].' },
  { path: 'b.md', name: 'b.md', content: 'The end.' },
];

/** The panel of the graph, with the notes of the tests. */
function renderPanel() {
  const onOpenNote = vi.fn();
  const view = render(<GraphPanel files={[]} notes={notes} onOpenNote={onOpenNote} />);
  return { onOpenNote, container: view.container };
}

describe('the panel of the graph', () => {
  it('draws a node of every note', () => {
    const { container } = render(
      <GraphPanel files={[]} notes={notes} onOpenNote={() => undefined} />,
    );
    expect(container.querySelectorAll('.graph-node')).toHaveLength(2);
  });

  it('draws a line of every link', () => {
    const { container } = render(
      <GraphPanel files={[]} notes={notes} onOpenNote={() => undefined} />,
    );
    expect(container.querySelectorAll('.graph-edge')).toHaveLength(1);
  });

  it('opens the note of a node that is clicked', () => {
    const { onOpenNote } = renderPanel();
    const node = document.querySelector('.graph-node[data-path="b.md"]');
    expect(node).toBeTruthy();
    fireEvent.click(node as Element);
    expect(onOpenNote).toHaveBeenCalledWith('b.md');
  });

  it('lists the notes under the drawing', () => {
    const { container } = renderPanel();
    expect(container.querySelectorAll('.graph-list-item')).toHaveLength(2);
  });

  it('opens the note of the list that is clicked', () => {
    const { container, onOpenNote } = renderPanel();
    const item = container.querySelector('.graph-list-item');
    expect(item).toBeTruthy();
    fireEvent.click(item as Element);
    expect(onOpenNote).toHaveBeenCalledWith('a.md');
  });

  it('says that the vault holds no note', () => {
    render(<GraphPanel files={[]} notes={[]} onOpenNote={() => undefined} />);
    expect(screen.getByText('The vault holds no note yet.')).toBeTruthy();
  });
});
