// The tests of the empty state of the writing plane.
//
// The plane is the biggest block of the application, and an empty plane is
// not a void: the state offers the two actions that start a note and the
// notes that were opened last. A note that was deleted in the meantime must
// not be offered: the list is a way back into the vault.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { EmptyNoteState } from '../components/EmptyNoteState';

describe('the empty state of the plane', () => {
  it('offers the two actions that start a note', () => {
    const onCreate = vi.fn();
    const onDaily = vi.fn();
    render(
      <EmptyNoteState
        recentPaths={[]}
        knownPaths={[]}
        onOpen={() => undefined}
        onCreate={onCreate}
        onDaily={onDaily}
      />,
    );

    expect(screen.getByTestId('empty-state')).toBeTruthy();
    fireEvent.click(screen.getByText('Create a note'));
    expect(onCreate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Note of the day'));
    expect(onDaily).toHaveBeenCalledTimes(1);
  });

  it('lists the notes that were opened last', () => {
    const onOpen = vi.fn();
    render(
      <EmptyNoteState
        recentPaths={['journal/alpha.md', 'beta.md']}
        knownPaths={['journal/alpha.md', 'beta.md']}
        onOpen={onOpen}
        onCreate={() => undefined}
        onDaily={() => undefined}
      />,
    );

    fireEvent.click(screen.getByText('alpha.md'));
    expect(onOpen).toHaveBeenCalledWith('journal/alpha.md');
  });

  it('does not offer a note that was deleted in the meantime', () => {
    render(
      <EmptyNoteState
        recentPaths={['gone.md', 'beta.md']}
        knownPaths={['beta.md']}
        onOpen={() => undefined}
        onCreate={() => undefined}
        onDaily={() => undefined}
      />,
    );

    expect(screen.queryByText('gone.md')).toBeNull();
    expect(screen.getByText('beta.md')).toBeTruthy();
  });

  it('shows at most the number of notes that was asked for', () => {
    const recent = ['a.md', 'b.md', 'c.md', 'd.md'];
    render(
      <EmptyNoteState
        recentPaths={recent}
        knownPaths={recent}
        onOpen={() => undefined}
        onCreate={() => undefined}
        onDaily={() => undefined}
        limit={2}
      />,
    );

    expect(screen.getByText('a.md')).toBeTruthy();
    expect(screen.getByText('b.md')).toBeTruthy();
    expect(screen.queryByText('c.md')).toBeNull();
  });

  it('hides the list when there is nothing to open', () => {
    render(
      <EmptyNoteState
        recentPaths={[]}
        knownPaths={[]}
        onOpen={() => undefined}
        onCreate={() => undefined}
        onDaily={() => undefined}
      />,
    );

    expect(screen.queryByText('Opened last')).toBeNull();
  });
});
