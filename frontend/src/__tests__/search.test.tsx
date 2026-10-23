import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/preact';
import { SearchPanel } from '../components/SearchPanel';

const hits = [
  {
    path: 'journal/2026/october.md',
    name: 'october.md',
    kind: 'content',
    snippet: '…the <b>results</b> of the search…',
  },
];

const searchMock = vi.fn(async () => hits);

vi.mock('../api/client', () => ({
  search: (...args: unknown[]) => searchMock(...(args as [])),
}));

beforeEach(() => {
  vi.useFakeTimers();
  searchMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('search results', () => {
  it('debounces the query and renders the results', async () => {
    const onOpenNote = vi.fn();
    const view = render(<SearchPanel open onClose={() => undefined} onOpenNote={onOpenNote} />);

    fireEvent.input(view.getByLabelText('Search query'), { target: { value: 'results' } });
    expect(searchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(250);
    expect(searchMock).toHaveBeenCalledTimes(1);

    const results = view.getByTestId('search-results');
    expect(results.textContent).toContain('october.md');
    expect(results.textContent).toContain('journal/2026/october.md');
    expect(results.textContent).toContain('results');
  });

  it('opens the note when a result is clicked', async () => {
    const onOpenNote = vi.fn();
    const view = render(<SearchPanel open onClose={() => undefined} onOpenNote={onOpenNote} />);

    fireEvent.input(view.getByLabelText('Search query'), { target: { value: 'results' } });
    await vi.advanceTimersByTimeAsync(250);

    fireEvent.click(view.getByText('october.md'));
    expect(onOpenNote).toHaveBeenCalledWith('journal/2026/october.md');
  });

  it('shows an empty state when nothing matches', async () => {
    searchMock.mockResolvedValueOnce([]);
    const view = render(<SearchPanel open onClose={() => undefined} onOpenNote={() => undefined} />);
    fireEvent.input(view.getByLabelText('Search query'), { target: { value: 'nothing' } });
    await vi.advanceTimersByTimeAsync(250);
    expect(view.getByTestId('search-results').textContent).toContain('No results');
  });
});
