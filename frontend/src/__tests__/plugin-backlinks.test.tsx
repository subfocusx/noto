// Tests of the "Backlinks" built-in plugin.
//
// The builtin plugin is imported directly: rule R7 of
// `scripts/check-boundaries.mjs` exempts `src/__tests__/**` from the
// "only `src/plugins/**` may import the builtins" rule.
import { describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { act } from 'preact/test-utils';
import { render, screen, waitFor } from '@testing-library/preact';
import type {
  NodeLike,
  PluginApi,
  PluginCommand,
  PluginContext,
  PluginEditor,
  PluginEventMap,
  PluginPanel,
  PluginSidebarItem,
} from '../plugins/contract';
import { validateManifest } from '../plugins/manifest';
import { PluginRegistry } from '../plugins/registry';
import { PluginHost } from '../plugins/host';
import { EventBus } from '../core/events/eventBus';
import { CommandRegistry } from '../core/commands/commandRegistry';
import { SettingsStore } from '../core/settings/settingsStore';
import { createPluginApi } from '../core/api/pluginApi';
import {
  BACKLINKS_COMMAND_ID,
  BACKLINKS_DEBOUNCE_MS,
  BACKLINKS_PANEL_ID,
  backlinksManifest,
  buildNoteIndex,
  createBacklinksPlugin,
  extractWikiTargets,
  findUnlinkedMentions,
  maskWikiLinks,
  normalizeKey,
  resolveLinkTarget,
  stripMd,
} from '../plugins/builtin/backlinks';
import { createDebouncer } from '../plugins/builtin/backlinks/debounce';

/* ---------------------------------------------------------------- fixtures */

/** A note of the fake library. */
interface FakeNote {
  path: string;
  name: string;
  content: string;
}

/** Builds a tree node of the fake library. */
function toNode(note: FakeNote): NodeLike {
  return {
    id: note.path,
    name: note.name,
    path: note.path,
    type: 'file',
    parentPath: '',
    size: note.content.length,
    modTime: '2024-01-01T00:00:00Z',
    revision: 1,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

/** A fake editor: it records the subscriptions and can emit a change. */
function makeFakeEditor(initial: string, path: string | null = 'notes/b.md') {
  const listeners = new Set<(text: string) => void>();
  const unsubscribeSpy = vi.fn();
  let current = initial;

  const editor: PluginEditor = {
    getText: () => current,
    getSelection: () => '',
    getCursor: () => ({ from: 0, to: 0 }),
    insert: () => undefined,
    insertAt: () => undefined,
    replaceSelection: () => undefined,
    focus: () => undefined,
    openSearch: () => undefined,
    getPath: () => path,
    onChange: (cb) => {
      listeners.add(cb);
      return () => {
        unsubscribeSpy();
        listeners.delete(cb);
      };
    },
    onSelectionChange: () => () => undefined,
  };

  return {
    editor,
    unsubscribeSpy,
    /** Changes the text and notifies the subscribers. */
    emit(text: string) {
      current = text;
      for (const cb of Array.from(listeners)) cb(text);
    },
    listenerCount: () => listeners.size,
  };
}

/** A fake plugin context that records everything the plugin registers. */
function makeFakeContext(editor: PluginEditor | null, notes: FakeNote[] = []) {
  const commands: PluginCommand[] = [];
  const panels: PluginPanel[] = [];
  const sidebarItems: PluginSidebarItem[] = [];
  const deactivateCallbacks: Array<() => void> = [];
  const unregisterPanel = vi.fn();
  const unregisterSidebar = vi.fn();
  const unregisterCommand = vi.fn();
  const editorWatchers = new Set<(e: PluginEditor | null) => void>();
  const onEditorUnsubscribeSpy = vi.fn();
  const eventCleanups: Array<ReturnType<typeof vi.fn>> = [];
  let currentEditor: PluginEditor | null = editor;

  const getNote = vi.fn(async (path: string) => {
    const note = notes.find((n) => n.path === path);
    return {
      path,
      content: note?.content ?? '',
      revision: 1,
      updatedAt: '2024-01-01T00:00:00Z',
      conflict: false,
    };
  });
  const getTree = vi.fn(async () => ({
    folders: [],
    files: notes.map(toNode),
  }));

  const api: PluginApi = {
    getNote,
    getTree,
    search: async () => [],
    saveNote: vi.fn(),
  };

  const ctx: PluginContext = {
    id: 'backlinks',
    version: '1.0.0',
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    permissions: backlinksManifest.permissions,
    api,
    get editor(): PluginEditor | null {
      return currentEditor;
    },
    settings: {
      get: async () => undefined,
      set: async () => undefined,
      reset: async () => undefined,
      all: async () => ({}),
    },
    registerCommand: (cmd) => {
      commands.push(cmd);
      return unregisterCommand;
    },
    registerPanel: (panel) => {
      panels.push(panel);
      return unregisterPanel;
    },
    registerSidebarItem: (item) => {
      sidebarItems.push(item);
      return unregisterSidebar;
    },
    registerContextMenuItem: () => () => undefined,
    registerToolbarItem: () => () => undefined,
    registerSettingsSection: () => () => undefined,
    on: () => {
      const cleanup = vi.fn();
      eventCleanups.push(cleanup);
      return cleanup;
    },
    onEditor: (cb) => {
      editorWatchers.add(cb);
      cb(currentEditor);
      return () => {
        onEditorUnsubscribeSpy();
        editorWatchers.delete(cb);
      };
    },
    onDeactivate: (cb) => {
      deactivateCallbacks.push(cb);
    },
  };

  return {
    ctx,
    plugin: createBacklinksPlugin(),
    commands,
    panels,
    sidebarItems,
    deactivateCallbacks,
    getNote,
    getTree,
    eventCleanups,
    onEditorUnsubscribeSpy,
    unregisterPanel,
    unregisterSidebar,
    unregisterCommand,
    /** Simulates the appearance (or the removal) of an editor. */
    emitEditor(next: PluginEditor | null) {
      currentEditor = next;
      for (const cb of Array.from(editorWatchers)) cb(next);
    },
    editorWatcherCount: () => editorWatchers.size,
  };
}

/** The library used by most of the tests. */
const LIBRARY: FakeNote[] = [
  { path: 'notes/a.md', name: 'A.md', content: 'Смотри [[Заметка B]]' },
  { path: 'notes/b.md', name: 'Заметка B.md', content: 'Обычный текст заметки B' },
  { path: 'notes/c.md', name: 'Заметка C.md', content: 'Ссылка на [[Несуществующая]]' },
];

/** A real host, so that the lifecycle of the plugin is the real one. */
function makeHost(getEditor: () => PluginEditor | null, notes: FakeNote[] = []) {
  const registry = new PluginRegistry();
  const bus = new EventBus<PluginEventMap>();
  const commands = new CommandRegistry();
  const settings = new SettingsStore();
  const host = new PluginHost({
    registry,
    bus,
    commands,
    settings,
    createApi: () =>
      createPluginApi({
        getTree: async () => ({ folders: [], files: notes.map(toNode) }),
        getNote: async (path: string) => ({
          path,
          content: notes.find((n) => n.path === path)?.content ?? '',
          revision: 1,
          updatedAt: '2024-01-01T00:00:00Z',
          conflict: false,
        }),
      }),
    getEditor,
  });
  return { registry, bus, commands, settings, host };
}

/**
 * Flushes the microtask queue.
 *
 * With the fake timers the promises of the plugin are resolved only by the
 * microtasks, so they must be drained explicitly.
 */
async function flushMicrotasks(times = 50): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}
/* ------------------------------------------------------------------ tests */

describe('backlinks manifest', () => {
  it('passes the manifest validation', () => {
    const result = validateManifest(backlinksManifest);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('declares exactly the permissions it uses', () => {
    expect(backlinksManifest.id).toBe('backlinks');
    expect(backlinksManifest.name).toBe('Backlinks');
    expect(backlinksManifest.version).toBe('1.0.0');
    expect(backlinksManifest.manifestVersion).toBe(1);
    expect(backlinksManifest.minApiVersion).toBe('1.0.0');
    expect(backlinksManifest.author).toBe('Noto');
    // `tree.read` — the tree; `notes.read` — the content of a note;
    // `editor.read` — the text of the open note and `onChange`;
    // `ui.contribute` — the panel, the sidebar item and the command.
    expect(backlinksManifest.permissions).toEqual([
      'editor.read',
      'notes.read',
      'tree.read',
      'ui.contribute',
    ]);
    expect(backlinksManifest.permissions).not.toContain('notes.write');
    expect(backlinksManifest.permissions).not.toContain('editor.write');
    expect(backlinksManifest.permissions).not.toContain('search.read');
  });

  it('declares its settings', () => {
    expect(backlinksManifest.settings).toEqual([
      {
        key: 'includeUnlinked',
        label: 'Show the mentions without a link',
        type: 'boolean',
        default: true,
        description: expect.any(String),
      },
      {
        key: 'minNameLength',
        label: 'Minimal length of a name',
        type: 'number',
        default: 4,
        description: expect.any(String),
      },
    ]);
  });
});

describe('backlinks resolution helpers', () => {
  it('extracts the wiki-link targets', () => {
    expect(extractWikiTargets('a [[One]] b [[Two]]')).toEqual(['One', 'Two']);
    expect(extractWikiTargets('a [[Одна заметка]]')).toEqual(['Одна заметка']);
    expect(extractWikiTargets('no links here')).toEqual([]);
    // The link may not span a line break and may not be nested.
    expect(extractWikiTargets('[[broken\nlink]]')).toEqual([]);
    expect(extractWikiTargets('[[a [b] c]]')).toEqual([]);
  });

  it('strips the ".md" suffix and normalizes a name', () => {
    expect(stripMd('Note.md')).toBe('Note');
    expect(stripMd('Note.MD')).toBe('Note');
    expect(stripMd('Note')).toBe('Note');
    expect(normalizeKey('  MiXeD  ')).toBe('mixed');
  });

  it('resolves a name to a single path', () => {
    const index = buildNoteIndex(LIBRARY.map(toNode));
    expect(resolveLinkTarget(index, 'Заметка B').paths).toEqual(['notes/b.md']);
    expect(resolveLinkTarget(index, 'заметка b').ambiguous).toBe(false);
    // The suffix ".md" is allowed too.
    expect(resolveLinkTarget(index, 'Заметка B.md').paths).toEqual(['notes/b.md']);
  });

  it('resolves a path', () => {
    const index = buildNoteIndex(LIBRARY.map(toNode));
    expect(resolveLinkTarget(index, 'notes/b.md').paths).toEqual(['notes/b.md']);
  });

  it('does not resolve an unknown name', () => {
    const index = buildNoteIndex(LIBRARY.map(toNode));
    expect(resolveLinkTarget(index, 'Несуществующая').paths).toEqual([]);
    expect(resolveLinkTarget(index, 'Несуществующая').ambiguous).toBe(false);
  });

  it('marks an ambiguous name', () => {
    const index = buildNoteIndex([
      toNode({ path: 'notes/d1/Отчёт.md', name: 'Отчёт.md', content: '' }),
      toNode({ path: 'notes/d2/Отчёт.md', name: 'Отчёт.md', content: '' }),
    ]);
    const resolution = resolveLinkTarget(index, 'Отчёт');
    expect(resolution.paths).toEqual(['notes/d1/Отчёт.md', 'notes/d2/Отчёт.md']);
    expect(resolution.ambiguous).toBe(true);
  });

  it('masks the wiki links of the text', () => {
    const masked = maskWikiLinks('a [[Одна]] b');
    expect(masked).not.toContain('Одна');
    expect(masked.length).toBe('a [[Одна]] b'.length);
  });

  it('finds the unlinked mentions, case insensitively', () => {
    const index = buildNoteIndex([
      toNode({ path: 'notes/Большой отчёт.md', name: 'Большой отчёт.md', content: '' }),
    ]);
    const mentions = findUnlinkedMentions('Обсудили большой ОТЧЁТ вчера.', index, null, 4);
    expect(mentions).toEqual([
      { name: 'Большой отчёт', path: 'notes/Большой отчёт.md', ambiguous: false },
    ]);
  });

  it('ignores the short names', () => {
    const index = buildNoteIndex([toNode({ path: 'notes/Отч.md', name: 'Отч.md', content: '' })]);
    expect(findUnlinkedMentions('Отч и отчёт', index, null, 4)).toEqual([]);
  });

  it('ignores the names that are linked', () => {
    const index = buildNoteIndex([
      toNode({ path: 'notes/Большой отчёт.md', name: 'Большой отчёт.md', content: '' }),
    ]);
    expect(findUnlinkedMentions('См. [[Большой отчёт]]', index, null, 4)).toEqual([]);
  });
});

describe('backlinks activation', () => {
  it('registers a panel and a command, but no item of the sidebar', async () => {
    const fake = makeFakeContext(null, LIBRARY);
    await fake.plugin.activate(fake.ctx);

    expect(fake.panels.map((p) => p.id)).toEqual([BACKLINKS_PANEL_ID]);
    expect(fake.sidebarItems).toEqual([]);
    expect(fake.commands.map((c) => c.id)).toEqual([BACKLINKS_COMMAND_ID]);
  });

  it('does not fail and shows the placeholder without an editor', async () => {
    const fake = makeFakeContext(null, LIBRARY);
    await expect(fake.plugin.activate(fake.ctx)).resolves.toBeUndefined();

    render(fake.panels[0].render());
    expect(screen.getByText('No open note')).toBeTruthy();
  });

  it('shows the backlinks of the open note', async () => {
    const fakeEditor = makeFakeEditor('Обычный текст заметки B', 'notes/b.md');
    const fake = makeFakeContext(fakeEditor.editor, LIBRARY);
    await fake.plugin.activate(fake.ctx);

    render(fake.panels[0].render());

    await waitFor(() => {
      expect(screen.getByText('A')).toBeTruthy();
    });
    expect(screen.getByText('notes/a.md')).toBeTruthy();
    expect(screen.getByText('Backlinks (1)')).toBeTruthy();
  });

  it('finds the backlinks written in cyrillic', async () => {
    const notes: FakeNote[] = [
      { path: 'notes/источник.md', name: 'источник.md', content: 'Ссылка [[Целевая заметка]]' },
      { path: 'notes/цель.md', name: 'Целевая заметка.md', content: '' },
    ];
    const fakeEditor = makeFakeEditor('Текст цели', 'notes/цель.md');
    const fake = makeFakeContext(fakeEditor.editor, notes);
    await fake.plugin.activate(fake.ctx);

    render(fake.panels[0].render());

    await waitFor(() => {
      expect(screen.getByText('источник')).toBeTruthy();
    });
  });

  it('ignores a link to a note that does not exist', async () => {
    const fakeEditor = makeFakeEditor('Обычный текст заметки B', 'notes/b.md');
    const fake = makeFakeContext(fakeEditor.editor, LIBRARY);
    await fake.plugin.activate(fake.ctx);

    render(fake.panels[0].render());

    await waitFor(() => {
      expect(screen.getByText('Backlinks (1)')).toBeTruthy();
    });
    // "Заметка C" links to "[[Несуществующая]]": it is not a backlink.
    expect(screen.queryByText('Заметка C')).toBeNull();
    expect(screen.queryByText('Несуществующая')).toBeNull();
  });

  it('marks an ambiguous link', async () => {
    const notes: FakeNote[] = [
      { path: 'notes/src.md', name: 'src.md', content: '[[Отчёт]]' },
      { path: 'notes/d1/Отчёт.md', name: 'Отчёт.md', content: '' },
      { path: 'notes/d2/Отчёт.md', name: 'Отчёт.md', content: '' },
    ];
    const fakeEditor = makeFakeEditor('Текст', 'notes/d1/Отчёт.md');
    const fake = makeFakeContext(fakeEditor.editor, notes);
    await fake.plugin.activate(fake.ctx);

    render(fake.panels[0].render());

    await waitFor(() => {
      expect(screen.getByText('src')).toBeTruthy();
    });
    expect(screen.getByText('ambiguous')).toBeTruthy();
  });

  it('shows the unlinked mentions and ignores the short names', async () => {
    const notes: FakeNote[] = [
      { path: 'notes/main.md', name: 'main.md', content: '' },
      { path: 'notes/Большой отчёт.md', name: 'Большой отчёт.md', content: '' },
      { path: 'notes/Отч.md', name: 'Отч.md', content: '' },
    ];
    const fakeEditor = makeFakeEditor('Обсудили Большой отчёт и Отч вчера', 'notes/main.md');
    const fake = makeFakeContext(fakeEditor.editor, notes);
    await fake.plugin.activate(fake.ctx);

    render(fake.panels[0].render());

    await waitFor(() => {
      expect(screen.getByText('Большой отчёт')).toBeTruthy();
    });
    expect(screen.getByText('no link')).toBeTruthy();
    // The name is shorter than 4 characters: it is ignored.
    expect(screen.queryByText('Отч')).toBeNull();
  });

  it('explains that a note cannot be opened from the panel', async () => {
    const fakeEditor = makeFakeEditor('Текст', 'notes/b.md');
    const fake = makeFakeContext(fakeEditor.editor, LIBRARY);
    await fake.plugin.activate(fake.ctx);

    render(fake.panels[0].render());

    await waitFor(() => {
      expect(
        screen.getByText('The plugin cannot open a note — open it manually.'),
      ).toBeTruthy();
    });
  });

  it('reports the missing rights instead of failing', async () => {
    const fake = makeFakeContext(null, LIBRARY);
    fake.ctx.api.getTree = async () => {
      const err = new Error('plugin "backlinks" requires permission "tree.read"');
      err.name = 'PluginPermissionError';
      throw err;
    };
    await fake.plugin.activate(fake.ctx);

    const fakeEditor = makeFakeEditor('Текст', 'notes/b.md');
    act(() => {
      fake.emitEditor(fakeEditor.editor);
    });

    render(fake.panels[0].render());
    await waitFor(() => {
      expect(screen.getByText('Not enough rights to read the notes')).toBeTruthy();
    });
  });

  it('removes the registrations and the subscriptions on deactivation', async () => {
    const fakeEditor = makeFakeEditor('Текст', 'notes/b.md');
    const fake = makeFakeContext(fakeEditor.editor, LIBRARY);
    await fake.plugin.activate(fake.ctx);

    expect(fakeEditor.listenerCount()).toBe(1);
    expect(fake.editorWatcherCount()).toBe(1);

    for (const cb of fake.deactivateCallbacks) cb();

    expect(fakeEditor.unsubscribeSpy).toHaveBeenCalledTimes(1);
    expect(fakeEditor.listenerCount()).toBe(0);
    expect(fake.onEditorUnsubscribeSpy).toHaveBeenCalledTimes(1);
    expect(fake.editorWatcherCount()).toBe(0);
    // The event subscriptions are released too.
    expect(fake.eventCleanups.every((cleanup) => cleanup.mock.calls.length === 1)).toBe(true);
    // The registrations are removed as well.
    expect(fake.unregisterPanel).toHaveBeenCalledTimes(1);
    expect(fake.unregisterCommand).toHaveBeenCalledTimes(1);

    // After the deactivation the panel shows the placeholder again.
    render(fake.panels[0].render());
    expect(screen.getByText('No open note')).toBeTruthy();
  });

  it('drops the subscription of the previous editor', async () => {
    const first = makeFakeEditor('первый', 'notes/a.md');
    const fake = makeFakeContext(null, LIBRARY);
    await fake.plugin.activate(fake.ctx);

    act(() => {
      fake.emitEditor(first.editor);
    });
    expect(first.listenerCount()).toBe(1);

    const second = makeFakeEditor('второй', 'notes/b.md');
    act(() => {
      fake.emitEditor(second.editor);
    });
    expect(first.listenerCount()).toBe(0);
    expect(second.listenerCount()).toBe(1);
  });
});

describe('backlinks debounce', () => {
  it('recomputes once for a burst of changes', async () => {
    vi.useFakeTimers();
    try {
      const fakeEditor = makeFakeEditor('Текст', 'notes/b.md');
      const fake = makeFakeContext(fakeEditor.editor, LIBRARY);
      await fake.plugin.activate(fake.ctx);

      // The initial computation is awaited explicitly: `waitIdle()` resolves
      // when no computation is running and none is scheduled.
      await fake.plugin.waitIdle();

      const initialTreeCalls = fake.getTree.mock.calls.length;
      expect(initialTreeCalls).toBe(1);
      // The content of the library is read once: the open note is skipped.
      expect(fake.getNote.mock.calls.length).toBe(LIBRARY.length - 1);

      act(() => {
        for (let i = 0; i < 5; i += 1) fakeEditor.emit(`Текст ${i}`);
      });

      // Nothing is recomputed before the debounce expires.
      await vi.advanceTimersByTimeAsync(BACKLINKS_DEBOUNCE_MS - 1);
      await flushMicrotasks();
      expect(fake.getTree.mock.calls.length).toBe(initialTreeCalls);

      await vi.advanceTimersByTimeAsync(1);
      await fake.plugin.waitIdle();

      // Exactly ONE recomputation for the whole burst.
      expect(fake.getTree.mock.calls.length).toBe(initialTreeCalls + 1);
      // The content of the library is not read again: it is cached.
      expect(fake.getNote.mock.calls.length).toBe(LIBRARY.length - 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not recompute when the text did not change', async () => {
    vi.useFakeTimers();
    try {
      const fakeEditor = makeFakeEditor('Текст', 'notes/b.md');
      const fake = makeFakeContext(fakeEditor.editor, LIBRARY);
      await fake.plugin.activate(fake.ctx);
      await fake.plugin.waitIdle();

      const initialTreeCalls = fake.getTree.mock.calls.length;
      expect(initialTreeCalls).toBe(1);

      // The same text: the result of the computation is reused.
      act(() => {
        fakeEditor.emit('Текст');
      });
      await vi.advanceTimersByTimeAsync(BACKLINKS_DEBOUNCE_MS);
      await fake.plugin.waitIdle();

      expect(fake.getTree.mock.calls.length).toBe(initialTreeCalls);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops the scheduled recomputation on deactivation', async () => {
    vi.useFakeTimers();
    try {
      const fakeEditor = makeFakeEditor('Текст', 'notes/b.md');
      const fake = makeFakeContext(fakeEditor.editor, LIBRARY);
      await fake.plugin.activate(fake.ctx);
      await fake.plugin.waitIdle();

      const initialTreeCalls = fake.getTree.mock.calls.length;

      act(() => {
        fakeEditor.emit('Другой текст');
      });
      for (const cb of fake.deactivateCallbacks) cb();

      await vi.advanceTimersByTimeAsync(BACKLINKS_DEBOUNCE_MS * 2);
      await flushMicrotasks();

      // The scheduled recomputation was cancelled.
      expect(fake.getTree.mock.calls.length).toBe(initialTreeCalls);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the debounce of the plugin', () => {
  it('runs the function once for a burst of calls', () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      const debouncer = createDebouncer(fn, 100);

      debouncer.schedule();
      debouncer.schedule();
      debouncer.schedule();
      expect(debouncer.pending).toBe(true);
      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(99);
      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(debouncer.pending).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs the function at once on flush and drops it on cancel', () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      const debouncer = createDebouncer(fn, 100);

      debouncer.schedule();
      debouncer.flush();
      expect(fn).toHaveBeenCalledTimes(1);
      expect(debouncer.pending).toBe(false);

      debouncer.schedule();
      debouncer.cancel();
      vi.advanceTimersByTime(1000);
      expect(fn).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('backlinks in the host', () => {
  it('is activated and deactivated by the host', async () => {
    const fakeEditor = makeFakeEditor('Текст', 'notes/b.md');
    const { registry, commands, host } = makeHost(() => fakeEditor.editor, LIBRARY);

    registry.register(createBacklinksPlugin());
    registry.enable('backlinks');
    await host.activate('backlinks');

    expect(registry.get('backlinks')?.state).toBe('active');
    expect(host.panels().map((p) => p.id)).toEqual([BACKLINKS_PANEL_ID]);
    expect(commands.has(BACKLINKS_COMMAND_ID)).toBe(true);

    await host.deactivate('backlinks');

    expect(registry.get('backlinks')?.state).toBe('disabled');
    expect(host.panels()).toHaveLength(0);
    expect(commands.has(BACKLINKS_COMMAND_ID)).toBe(false);
    expect(fakeEditor.unsubscribeSpy).toHaveBeenCalledTimes(1);
    expect(fakeEditor.listenerCount()).toBe(0);
  });

  it('is activated without an editor and does not fail', async () => {
    const { registry, host } = makeHost(() => null, LIBRARY);
    registry.register(createBacklinksPlugin());
    registry.enable('backlinks');

    await expect(host.activate('backlinks')).resolves.toBeUndefined();
    expect(registry.get('backlinks')?.state).toBe('active');
    expect(host.panels()).toHaveLength(1);
  });
});
