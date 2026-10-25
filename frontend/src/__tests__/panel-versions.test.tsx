// The tests of the section of the versions.
//
// The section lists the versions of the note that is open, shows what changed
// between a version and the one before it, and restores an old version.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { HistorySection } from '../components/sections/HistorySection';
import type { NoteVersion } from '../api/versions';

/** A version of a note of the tests. */
function version(revision: number, content: string): NoteVersion {
  return {
    path: 'a.md',
    revision,
    title: 'A',
    content,
    createdAt: `2026-10-2${revision}T18:05:00Z`,
  };
}

const versions = [version(1, 'one\ntwo'), version(2, 'one\nthree')];

/** The loader of the versions of the tests. */
const loadVersions = (): Promise<NoteVersion[]> => Promise.resolve(versions);

describe('the section of the versions', () => {
  it('says that no note is open', () => {
    render(
      <HistorySection recentPaths={[]} knownPaths={[]} onOpen={() => undefined} onRemove={() => undefined} />,
    );
    expect(screen.getByText('Open a note to see the versions of its content.')).toBeTruthy();
  });

  it('lists the versions of the note that is open', async () => {
    render(
      <HistorySection
        recentPaths={[]}
        knownPaths={[]}
        onOpen={() => undefined}
        onRemove={() => undefined}
        openPath="a.md"
        loadVersions={loadVersions}
      />,
    );
    await waitFor(() => expect(screen.getByText('Revision 2')).toBeTruthy());
    expect(screen.getByText('Revision 1')).toBeTruthy();
  });

  it('shows the moment of every version', async () => {
    const { container } = render(
      <HistorySection
        recentPaths={[]}
        knownPaths={[]}
        onOpen={() => undefined}
        onRemove={() => undefined}
        openPath="a.md"
        loadVersions={loadVersions}
      />,
    );
    await waitFor(() => expect(screen.getByText('Revision 2')).toBeTruthy());
    const times = [...container.querySelectorAll('.version-time')].map((node) => node.textContent);
    expect(times).toHaveLength(2);
    for (const time of times) expect(time).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('shows what changed between a version and the one before it', async () => {
    render(
      <HistorySection
        recentPaths={[]}
        knownPaths={[]}
        onOpen={() => undefined}
        onRemove={() => undefined}
        openPath="a.md"
        loadVersions={loadVersions}
      />,
    );
    await waitFor(() => expect(screen.getByText('Revision 2')).toBeTruthy());
    expect(screen.getByText('two')).toBeTruthy();
    expect(screen.getByText('three')).toBeTruthy();
    expect(screen.getByText('1 added, 1 removed')).toBeTruthy();
  });

  it('shows the difference of the version the user chooses', async () => {
    render(
      <HistorySection
        recentPaths={[]}
        knownPaths={[]}
        onOpen={() => undefined}
        onRemove={() => undefined}
        openPath="a.md"
        loadVersions={loadVersions}
      />,
    );
    await waitFor(() => expect(screen.getByText('Revision 2')).toBeTruthy());
    fireEvent.click(screen.getByText('Revision 1'));
    // The first version has nothing before it: there is no difference to show.
    expect(screen.queryByText('1 added, 1 removed')).toBeNull();
  });

  it('restores the version the user chooses', async () => {
    const onRestore = vi.fn();
    render(
      <HistorySection
        recentPaths={[]}
        knownPaths={[]}
        onOpen={() => undefined}
        onRemove={() => undefined}
        openPath="a.md"
        loadVersions={loadVersions}
        onRestore={onRestore}
      />,
    );
    await waitFor(() => expect(screen.getByText('Revision 2')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Restore the revision 2' }));
    expect(onRestore).toHaveBeenCalledWith('a.md', 2);
  });

  it('says that the note has no version yet', async () => {
    render(
      <HistorySection
        recentPaths={[]}
        knownPaths={[]}
        onOpen={() => undefined}
        onRemove={() => undefined}
        openPath="a.md"
        loadVersions={() => Promise.resolve([])}
      />,
    );
    await waitFor(() => expect(screen.getByText('This note has no version yet.')).toBeTruthy());
  });

  it('tells that the versions could not be read', async () => {
    render(
      <HistorySection
        recentPaths={[]}
        knownPaths={[]}
        onOpen={() => undefined}
        onRemove={() => undefined}
        openPath="a.md"
        loadVersions={() => Promise.reject(new Error('the storage is locked'))}
      />,
    );
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('the storage is locked'));
  });
});
