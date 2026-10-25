// The tests of the date of the creation in the tree.
//
// The row of a note shows the moment it was written when the pointer rests on
// it. The date comes from the model, which always carries it.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { TreeNoteRow } from '../components/TreeRow';
import type { Node } from '../types';

/** A note of the vault of the tests. */
function file(createdAt: string): Node {
  return {
    id: 'a.md',
    name: 'a.md',
    path: 'a.md',
    type: 'file',
    parentPath: '',
    size: 0,
    modTime: '',
    revision: 1,
    createdAt,
    updatedAt: createdAt,
  };
}

describe('the date of the creation in the tree', () => {
  it('shows the day the note was written', () => {
    render(
      <ul>
        <TreeNoteRow
          file={file('2026-10-24T18:05:00Z')}
          currentPath=""
          depth={0}
          onSelect={() => undefined}
        />
      </ul>,
    );
    const hint = screen.getByTitle(/^Created /);
    expect(hint.textContent).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('shows nothing when the note has no date', () => {
    render(
      <ul>
        <TreeNoteRow
          file={file('')}
          currentPath=""
          depth={0}
          onSelect={() => undefined}
        />
      </ul>,
    );
    expect(screen.queryByTitle(/^Created /)).toBeNull();
  });
});
