import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import type { PluginContext, PluginPanel } from '../plugins/contract';
import {
  TagsStore,
  TagsView,
  tagsManifest,
  tagsPlugin,
} from '../plugins/builtin/tags/index';

// The panel of the tags is tested through its own view: the plugin reads the
// vault through the contract, and the view only shows what the store holds.
describe('the panel of the tags', () => {
  /** A store with the given tags. */
  function storeWith(tags: { tag: string; count: number }[], selected: string | null = null) {
    const store = new TagsStore();
    store.set({ ready: true, error: null, tags, selected, paths: [] });
    return store;
  }

  it('shows the tags as chips of a row', () => {
    render(
      <TagsView
        store={storeWith([
          { tag: 'journal', count: 3 },
          { tag: 'work', count: 12 },
        ])}
        select={() => undefined}
      />,
    );

    const list = document.querySelector('.noto-tags-list');
    expect(list).not.toBeNull();

    const chips = document.querySelectorAll('.noto-tags-button');
    expect(chips).toHaveLength(2);
    for (const chip of chips) {
      // The chip is a button of the plugin, not a plain block of text.
      expect(chip.tagName).toBe('BUTTON');
      expect(chip.className).not.toContain('active');
    }

    expect(screen.getByText('#journal')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
  });

  it('marks the selected tag', () => {
    render(
      <TagsView
        store={storeWith(
          [
            { tag: 'journal', count: 3 },
            { tag: 'work', count: 12 },
          ],
          'work',
        )}
        select={() => undefined}
      />,
    );

    const chips = document.querySelectorAll('.noto-tags-button');
    expect(chips[1]?.className).toContain('active');
    expect(chips[0]?.className).not.toContain('active');
  });

  it('selects a tag and drops the selection when it is pressed again', () => {
    const select = vi.fn();
    render(
      <TagsView
        store={storeWith([
          { tag: 'journal', count: 3 },
          { tag: 'work', count: 12 },
        ])}
        select={select}
      />,
    );

    fireEvent.click(screen.getByText('#journal'));
    expect(select).toHaveBeenCalledWith('journal');
  });

  it('says that the vault has no tags', () => {
    render(<TagsView store={storeWith([])} select={() => undefined} />);

    expect(screen.getByText('The vault has no tags')).toBeTruthy();
    expect(document.querySelector('.noto-tags-list')).toBeNull();
  });
});

describe('the plugin of the tags', () => {
  /** A fake context that records the listeners of the events. */
  function makeFakeContext(tags: { tag: string; count: number }[]) {
    const listeners = new Map<string, Array<(payload: unknown) => void>>();
    const panels: PluginPanel[] = [];
    const readTags = vi.fn(async () => tags);

    const ctx = {
      id: 'tags',
      version: '1.0.0',
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      permissions: tagsManifest.permissions,
      api: {
        getNote: vi.fn(),
        getTree: vi.fn(async () => ({ folders: [], files: [] })),
        search: vi.fn(async () => []),
        saveNote: vi.fn(),
        query: vi.fn(async () => ({ hits: [], total: 0, partial: false })),
        tags: { call: readTags },
      },
      editor: null,
      settings: {
        get: vi.fn(async () => undefined),
        all: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
        reset: vi.fn(async () => undefined),
      },
      registerCommand: vi.fn(() => () => undefined),
      registerPanel: vi.fn((panel: PluginPanel) => {
        panels.push(panel);
        return () => undefined;
      }),
      registerSidebarItem: vi.fn(() => () => undefined),
      registerContextMenuItem: vi.fn(() => () => undefined),
      registerToolbarItem: vi.fn(() => () => undefined),
      registerSettingsSection: vi.fn(() => () => undefined),
      on: vi.fn((event: string, cb: (payload: unknown) => void) => {
        const list = listeners.get(event) ?? [];
        list.push(cb);
        listeners.set(event, list);
        return () => undefined;
      }),
      onEditor: vi.fn(() => () => undefined),
      onDeactivate: vi.fn(),
    } as unknown as PluginContext;

    return { ctx, panels, readTags, listeners };
  }

  it('reads the tags again when a note was saved', async () => {
    const tags: { tag: string; count: number }[] = [{ tag: 'journal', count: 1 }];
    const fake = makeFakeContext(tags);

    await tagsPlugin.activate(fake.ctx);

    // The list of the tags is read at the activation.
    expect(fake.readTags).toHaveBeenCalledTimes(1);

    // A saved note can carry a new tag: the list must follow it.
    tags.push({ tag: 'work', count: 1 });
    const saved = fake.listeners.get('editor.saved');
    expect(saved).toBeTruthy();
    saved?.forEach((cb) => cb({ path: 'journal.md', revision: 2 }));

    await waitFor(() => expect(fake.readTags).toHaveBeenCalledTimes(2));
  });

  it('shows the tags of the vault in the panel', async () => {
    const fake = makeFakeContext([{ tag: 'journal', count: 3 }]);

    await tagsPlugin.activate(fake.ctx);

    render(fake.panels[0].render());
    await waitFor(() => expect(screen.getByText('#journal')).toBeTruthy());
  });
});
