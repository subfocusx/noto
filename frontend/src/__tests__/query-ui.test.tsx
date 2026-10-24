import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/preact';
import { appStore } from '../core/store/appStore';
import {
  createQueryService,
  QueryServiceError,
  setQueryService,
  type QueryOutcome,
  type QueryService,
} from '../core/query/service';
import { QueryBar } from '../components/QueryBar';
import { SavedViews } from '../components/SavedViews';
import { TagTree } from '../components/TagTree';
import type { TagCount } from '../types';

/** A service that answers what the test wants it to answer. */
function fakeService(options: {
  outcome?: Partial<QueryOutcome>;
  tags?: TagCount[];
}): QueryService {
  return {
    runQuery: vi.fn(async () => ({
      hits: [],
      total: 0,
      partial: false,
      error: null,
      ...options.outcome,
    })),
    loadTags: vi.fn(async () => options.tags ?? []),
  };
}

afterEach(() => {
  setQueryService(null);
  appStore.reset();
  localStorage.clear();
});

describe('the actions of the query', () => {
  it('sets the query without running it', () => {
    const service = fakeService({});
    setQueryService(service);

    appStore.actions.setQuery('tag == "work"');

    expect(appStore.getSnapshot().ui.query).toBe('tag == "work"');
    expect(service.runQuery).not.toHaveBeenCalled();
  });

  it('fills the answer of a query that works', async () => {
    const hits = [{ path: 'a.md', name: 'a.md', kind: 'query', snippet: 'A note' }];
    setQueryService(
      fakeService({ outcome: { hits, total: 1, partial: false, error: null } }),
    );

    await appStore.actions.runQuery('tag == "work"');

    const ui = appStore.getSnapshot().ui;
    expect(ui.query).toBe('tag == "work"');
    expect(ui.queryHits).toHaveLength(1);
    expect(ui.queryTotal).toBe(1);
    expect(ui.queryPartial).toBe(false);
    expect(ui.queryError).toBeNull();
  });

  it('shows the message of a broken query', async () => {
    setQueryService(
      fakeService({
        outcome: {
          error: new QueryServiceError('parse_error', 'unknown field: nope'),
        },
      }),
    );

    await appStore.actions.runQuery('nope == 1');

    expect(appStore.getSnapshot().ui.queryError).toBe('unknown field: nope');
    expect(appStore.getSnapshot().ui.queryHits).toHaveLength(0);
  });

  it('empties the query and the hits', async () => {
    setQueryService(fakeService({ outcome: { total: 3 } }));
    await appStore.actions.runQuery('has_task_list');
    expect(appStore.getSnapshot().ui.queryTotal).toBe(3);

    appStore.actions.clearQuery();

    const ui = appStore.getSnapshot().ui;
    expect(ui.query).toBe('');
    expect(ui.queryHits).toHaveLength(0);
    expect(ui.queryTotal).toBe(0);
    expect(ui.queryError).toBeNull();
  });

  it('loads the tags of the vault', async () => {
    setQueryService(fakeService({ tags: [{ tag: 'work', count: 2 }] }));

    await appStore.actions.loadTags();

    expect(appStore.getSnapshot().ui.tags).toEqual([{ tag: 'work', count: 2 }]);
  });
});

describe('the service of the query', () => {
  it('answers a query in the sealed mode, in the browser', async () => {
    const vault = {
      mode: 'sealed' as const,
      listTree: async () => ({
        folders: [],
        files: [
          {
            id: 'a.md',
            name: 'a.md',
            path: 'a.md',
            type: 'file' as const,
            parentPath: '',
            size: 0,
            modTime: '',
            revision: 1,
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-02T00:00:00.000Z',
          },
        ],
      }),
      readNote: async (path: string) => ({
        path,
        content: '# Work\n\n- [ ] a task #work\n',
        revision: 1,
        updatedAt: '',
        conflict: false,
      }),
    };
    const service = createQueryService({ vault: () => vault });

    const outcome = await service.runQuery('tag == "work"');

    expect(outcome.error).toBeNull();
    expect(outcome.total).toBe(1);
    expect(outcome.hits[0]?.path).toBe('a.md');
    expect(outcome.hits[0]?.snippet).toBe('Work');
  });

  it('answers a broken query with a typed error', async () => {
    const service = createQueryService({
      vault: () => ({
        mode: 'sealed',
        listTree: async () => ({ folders: [], files: [] }),
        readNote: async () => ({
          path: '',
          content: '',
          revision: 1,
          updatedAt: '',
          conflict: false,
        }),
      }),
    });

    const outcome = await service.runQuery('nope == 1');

    expect(outcome.error?.code).toBe('parse_error');
    expect(outcome.error?.message).toBe('unknown field: nope');
    expect(outcome.hits).toHaveLength(0);
  });

  it('counts the tags of the notes in the sealed mode', async () => {
    const service = createQueryService({
      vault: () => ({
        mode: 'sealed',
        listTree: async () => ({
          folders: [],
          files: [
            {
              id: 'a.md',
              name: 'a.md',
              path: 'a.md',
              type: 'file' as const,
              parentPath: '',
              size: 0,
              modTime: '',
              revision: 1,
              createdAt: '',
              updatedAt: '',
            },
          ],
        }),
        readNote: async () => ({
          path: 'a.md',
          content: '#work #home\n',
          revision: 1,
          updatedAt: '',
          conflict: false,
        }),
      }),
    });

    expect(await service.loadTags()).toEqual([
      { tag: 'home', count: 1 },
      { tag: 'work', count: 1 },
    ]);
  });
});

describe('the bar of the query', () => {
  it('shows the query of the store and the number of the matches', () => {
    setQueryService(fakeService({}));
    appStore.actions.setQuery('tag == "work"');

    const view = render(<QueryBar />);

    const input = view.getByLabelText('Query') as HTMLInputElement;
    expect(input.value).toBe('tag == "work"');
  });

  it('runs the query after the debounce delay', async () => {
    const service = fakeService({ outcome: { total: 2 } });
    setQueryService(service);

    const view = render(<QueryBar />);
    fireEvent.input(view.getByLabelText('Query'), { target: { value: 'has_task_list' } });

    expect(appStore.getSnapshot().ui.query).toBe('has_task_list');
    await waitFor(() => expect(service.runQuery).toHaveBeenCalled(), { timeout: 2000 });
    expect(service.runQuery).toHaveBeenCalledWith('has_task_list', 50);
  });

  it('clears the query', async () => {
    setQueryService(fakeService({}));
    appStore.actions.setQuery('has_task_list');

    const view = render(<QueryBar />);
    fireEvent.click(view.getByLabelText('Clear the query'));

    expect(appStore.getSnapshot().ui.query).toBe('');
    expect(appStore.getSnapshot().ui.queryHits).toHaveLength(0);
  });

  it('shows the error of the last query', async () => {
    setQueryService(
      fakeService({ outcome: { error: new QueryServiceError('parse_error', 'expected a value') } }),
    );
    appStore.actions.setQuery('tag ==');

    const view = render(<QueryBar />);
    await appStore.actions.runQuery('tag ==');

    await waitFor(() => expect(view.getByRole('alert').textContent).toBe('expected a value'));
  });
});

describe('the saved views', () => {
  it('saves the current query and applies it again', async () => {
    const service = fakeService({});
    setQueryService(service);
    appStore.actions.setQuery('tag == "work"');

    const view = render(<SavedViews />);
    fireEvent.input(view.getByLabelText('Name of the view'), { target: { value: 'Work' } });
    fireEvent.click(view.getByTitle('Save the current query as a view'));

    expect(view.getByText('Work')).toBeTruthy();

    appStore.actions.clearQuery();
    fireEvent.click(view.getByText('Work'));

    await waitFor(() => expect(service.runQuery).toHaveBeenCalledWith('tag == "work"', 50));
    expect(appStore.getSnapshot().ui.query).toBe('tag == "work"');
  });

  it('deletes a view', () => {
    setQueryService(fakeService({}));
    appStore.actions.setQuery('tag == "work"');

    const view = render(<SavedViews />);
    fireEvent.input(view.getByLabelText('Name of the view'), { target: { value: 'Work' } });
    fireEvent.click(view.getByTitle('Save the current query as a view'));
    fireEvent.click(view.getByLabelText('Delete the view Work'));

    expect(view.queryByText('Work')).toBeNull();
  });
});

describe('the tree of the tags', () => {
  it('shows the tags with their number and runs a query when one is clicked', async () => {
    const service = fakeService({ tags: [{ tag: 'work', count: 3 }] });
    setQueryService(service);

    const view = render(<TagTree />);
    await waitFor(() => expect(view.getByText('#work')).toBeTruthy());
    expect(view.getByText('3')).toBeTruthy();

    fireEvent.click(view.getByText('#work'));
    await waitFor(() => expect(service.runQuery).toHaveBeenCalledWith('tag == "work"', 50));
    expect(appStore.getSnapshot().ui.query).toBe('tag == "work"');
  });
});
