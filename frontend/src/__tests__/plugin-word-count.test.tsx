// Tests of the "Word Count" built-in plugin.
//
import { describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { act } from 'preact/test-utils';
import { render, screen } from '@testing-library/preact';
import type {
  PluginApi,
  PluginCommand,
  PluginContext,
  PluginEditor,
  PluginEventMap,
  PluginPanel,
} from '../plugins/contract';
import { PluginPermissionError } from '../plugins/contract';
import { validateManifest } from '../plugins/manifest';
import { PluginRegistry } from '../plugins/registry';
import { PluginHost } from '../plugins/host';
import { EventBus } from '../core/events/eventBus';
import { CommandRegistry } from '../core/commands/commandRegistry';
import { SettingsStore } from '../core/settings/settingsStore';
import { createPluginApi } from '../core/api/pluginApi';
import {
  computeStats,
  countCharacters,
  countWords,
  wordCountManifest,
  wordCountPlugin,
} from '../plugins/builtin/word-count';

/* The builtin plugin is imported directly: rule R7 of
 * `scripts/check-boundaries.mjs` exempts `src/__tests__/**` from the
 * "only `src/plugins/**` may import the builtins" rule. */

/** The public surface of the plugin under test. */
const wordCount = {
  wordCountManifest,
  wordCountPlugin,
  countWords,
  countCharacters,
  computeStats,
};

/* ---------------------------------------------------------------- fixtures */

/** A fake editor: it records the subscriptions and can emit a change. */
function makeFakeEditor(initial: string) {
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
    getPath: () => 'notes/a.md',
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
function makeFakeContext(editor: PluginEditor | null, countChars: boolean | undefined = true) {
  const commands: PluginCommand[] = [];
  const panels: PluginPanel[] = [];
  const deactivateCallbacks: Array<() => void> = [];
  const saveNote = vi.fn();
  const editorWatchers = new Set<(e: PluginEditor | null) => void>();
  const onEditorUnsubscribeSpy = vi.fn();
  let currentEditor: PluginEditor | null = editor;

  const api: PluginApi = {
    getNote: async () => ({
      path: 'notes/a.md',
      content: '',
      revision: 1,
      updatedAt: 'now',
      conflict: false,
    }),
    getTree: async () => ({ folders: [], files: [] }),
    search: async () => [],
    saveNote,
  };

  const ctx: PluginContext = {
    id: 'word-count',
    version: '1.0.0',
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    permissions: wordCount.wordCountManifest.permissions,
    api,
    // The editor is live: it is asked for on every access.
    get editor(): PluginEditor | null {
      return currentEditor;
    },
    settings: {
      get: async <T,>(key: string): Promise<T | undefined> =>
        key === 'countChars' ? (countChars as T | undefined) : undefined,
      set: async () => undefined,
      reset: async () => undefined,
      all: async () => ({ countChars }),
    },
    registerCommand: (cmd) => {
      commands.push(cmd);
      return () => undefined;
    },
    registerPanel: (panel) => {
      panels.push(panel);
      return () => undefined;
    },
    registerSidebarItem: () => () => undefined,
    registerContextMenuItem: () => () => undefined,
    registerToolbarItem: () => () => undefined,
    registerSettingsSection: () => () => undefined,
    on: () => () => undefined,
    onEditor: (cb) => {
      editorWatchers.add(cb);
      // Like the host: the callback is called with the current editor at once.
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
    commands,
    panels,
    deactivateCallbacks,
    saveNote,
    onEditorUnsubscribeSpy,
    /** Simulates the appearance (or the removal) of an editor. */
    emitEditor(next: PluginEditor | null) {
      currentEditor = next;
      for (const cb of Array.from(editorWatchers)) cb(next);
    },
    editorWatcherCount: () => editorWatchers.size,
  };
}

/** A real host, so that the lifecycle of the plugin is the real one. */
function makeHost(getEditor: () => PluginEditor | null) {
  const registry = new PluginRegistry();
  const bus = new EventBus<PluginEventMap>();
  const commands = new CommandRegistry();
  const settings = new SettingsStore();
  const host = new PluginHost({
    registry,
    bus,
    commands,
    settings,
    createApi: () => createPluginApi(),
    getEditor,
  });
  return { registry, bus, commands, settings, host };
}

/* ------------------------------------------------------------------ tests */

describe('word-count manifest', () => {
  it('passes the manifest validation', () => {
    const result = validateManifest(wordCount.wordCountManifest);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('asks for the read access to the editor and for the UI contributions', () => {
    expect(wordCount.wordCountManifest.id).toBe('word-count');
    expect(wordCount.wordCountManifest.name).toBe('Word Count');
    expect(wordCount.wordCountManifest.version).toBe('1.0.0');
    expect(wordCount.wordCountManifest.manifestVersion).toBe(1);
    expect(wordCount.wordCountManifest.minApiVersion).toBe('1.0.0');
    expect(wordCount.wordCountManifest.author).toBe('Noto');
    // The panel and the command need `ui.contribute`, the text needs
    // `editor.read`. The plugin never asks for a write permission.
    expect(wordCount.wordCountManifest.permissions).toEqual(['editor.read', 'ui.contribute']);
    expect(wordCount.wordCountManifest.permissions).not.toContain('editor.write');
    expect(wordCount.wordCountManifest.permissions).not.toContain('notes.write');
  });

  it('declares the "countChars" setting', () => {
    expect(wordCount.wordCountManifest.settings).toEqual([
      {
        key: 'countChars',
        label: 'Count the characters',
        type: 'boolean',
        default: true,
        description: expect.any(String),
      },
    ]);
  });
});

describe('word-count counting', () => {
  it('counts the words of an english text', () => {
    expect(wordCount.countWords('hello brave new world')).toBe(4);
  });

  it('counts the words of a cyrillic text', () => {
    expect(wordCount.countWords('Привет, мир!')).toBe(2);
    expect(wordCount.countWords('одно два три четыре')).toBe(4);
  });

  it('counts nothing in an empty text', () => {
    expect(wordCount.countWords('')).toBe(0);
    expect(wordCount.countCharacters('')).toBe(0);
  });

  it('counts nothing in a text of spaces and line breaks', () => {
    expect(wordCount.countWords('   ')).toBe(0);
    expect(wordCount.countWords('\n\n  \t')).toBe(0);
  });

  it('separates the words by spaces and line breaks', () => {
    expect(wordCount.countWords('one two\nthree')).toBe(3);
    expect(wordCount.countWords('one,two;three')).toBe(3);
  });

  it('counts the characters of the text', () => {
    expect(wordCount.countCharacters('Привет, мир!')).toBe(12);
    expect(wordCount.countCharacters('a\nb')).toBe(3);
  });

  it('computes both counters at once', () => {
    expect(wordCount.computeStats('Привет, мир!')).toEqual({ words: 2, characters: 12 });
  });
});

describe('word-count activation', () => {
  it('registers a panel and a command on a clean context', async () => {
    const fake = makeFakeContext(null);
    await wordCount.wordCountPlugin.activate(fake.ctx);

    expect(fake.panels.map((p) => p.id)).toEqual(['word-count.panel']);
    expect(fake.commands.map((c) => c.id)).toEqual(['word-count.count']);
    expect(fake.ctx.permissions).toEqual(wordCount.wordCountManifest.permissions);
    // A read-only plugin never writes the note.
    expect(fake.saveNote).not.toHaveBeenCalled();
  });

  it('shows the counters of the active note in the panel', async () => {
    const { editor } = makeFakeEditor('Привет, мир!');
    const fake = makeFakeContext(editor);
    await wordCount.wordCountPlugin.activate(fake.ctx);

    render(fake.panels[0].render());

    expect(screen.getByText('Words: 2')).toBeTruthy();
    expect(screen.getByText('Characters: 12')).toBeTruthy();
  });

  it('hides the characters when the setting is off', async () => {
    const { editor } = makeFakeEditor('Привет, мир!');
    const fake = makeFakeContext(editor, false);
    await wordCount.wordCountPlugin.activate(fake.ctx);

    render(fake.panels[0].render());

    expect(screen.getByText('Words: 2')).toBeTruthy();
    expect(screen.queryByText('Characters: 12')).toBeNull();
  });

  it('recalculates the counters when the text changes', async () => {
    const fakeEditor = makeFakeEditor('hello world');
    const fake = makeFakeContext(fakeEditor.editor);
    await wordCount.wordCountPlugin.activate(fake.ctx);

    render(fake.panels[0].render());
    expect(screen.getByText('Words: 2')).toBeTruthy();

    act(() => {
      fakeEditor.emit('hello brave new world');
    });

    expect(screen.getByText('Words: 4')).toBeTruthy();
    expect(screen.getByText('Characters: 21')).toBeTruthy();
  });

  it('does not fail when there is no editor', async () => {
    const fake = makeFakeContext(null);
    await expect(wordCount.wordCountPlugin.activate(fake.ctx)).resolves.toBeUndefined();

    render(fake.panels[0].render());

    expect(screen.getByText('No open note')).toBeTruthy();
    expect(screen.queryByText(/^Слов:/)).toBeNull();
  });

  it('starts working when the editor appears after the activation', async () => {
    const fake = makeFakeContext(null);
    await wordCount.wordCountPlugin.activate(fake.ctx);

    render(fake.panels[0].render());
    expect(screen.getByText('No open note')).toBeTruthy();

    // The note is opened after the activation: the plugin is notified.
    const { editor } = makeFakeEditor('Привет мир');
    act(() => {
      fake.emitEditor(editor);
    });

    expect(screen.getByText('Words: 2')).toBeTruthy();
    expect(screen.getByText('Characters: 10')).toBeTruthy();
  });

  it('drops the subscription of the previous editor when another one appears', async () => {
    const first = makeFakeEditor('one');
    const second = makeFakeEditor('two words');
    const fake = makeFakeContext(null);
    await wordCount.wordCountPlugin.activate(fake.ctx);

    render(fake.panels[0].render());

    act(() => {
      fake.emitEditor(first.editor);
    });
    expect(first.listenerCount()).toBe(1);

    act(() => {
      fake.emitEditor(second.editor);
    });

    expect(first.listenerCount()).toBe(0);
    expect(first.unsubscribeSpy).toHaveBeenCalledTimes(1);
    expect(second.listenerCount()).toBe(1);

    // The changes of the old editor are ignored.
    act(() => {
      first.emit('a lot of words in the old editor');
    });
    expect(screen.getByText('Words: 2')).toBeTruthy();
  });

  it('shows the placeholder when the note is closed again', async () => {
    const fakeEditor = makeFakeEditor('hello world');
    const fake = makeFakeContext(fakeEditor.editor);
    await wordCount.wordCountPlugin.activate(fake.ctx);

    render(fake.panels[0].render());
    expect(screen.getByText('Words: 2')).toBeTruthy();

    act(() => {
      fake.emitEditor(null);
    });

    expect(screen.getByText('No open note')).toBeTruthy();
    expect(fakeEditor.listenerCount()).toBe(0);
  });

  it('removes the editor subscription on deactivation', async () => {
    const fakeEditor = makeFakeEditor('hello world');
    const fake = makeFakeContext(fakeEditor.editor);
    await wordCount.wordCountPlugin.activate(fake.ctx);
    expect(fakeEditor.listenerCount()).toBe(1);
    expect(fake.editorWatcherCount()).toBe(1);

    for (const cb of fake.deactivateCallbacks) cb();

    expect(fakeEditor.unsubscribeSpy).toHaveBeenCalledTimes(1);
    expect(fakeEditor.listenerCount()).toBe(0);
    // The subscription of the editor itself is cancelled too.
    expect(fake.onEditorUnsubscribeSpy).toHaveBeenCalledTimes(1);
    expect(fake.editorWatcherCount()).toBe(0);

    // After the deactivation the plugin ignores the changes.
    act(() => {
      fakeEditor.emit('a completely different text');
    });
    render(fake.panels[0].render());
    expect(screen.getByText('No open note')).toBeTruthy();

    // A new editor does not revive the deactivated plugin.
    const revived = makeFakeEditor('hello again');
    act(() => {
      fake.emitEditor(revived.editor);
    });
    expect(revived.listenerCount()).toBe(0);
  });

  it('cannot write the note: the API refuses it without "notes.write"', async () => {
    const api = createPluginApi(
      {},
      { pluginId: 'word-count', permissions: wordCount.wordCountManifest.permissions },
    );

    await expect(api.saveNote('notes/a.md', 'hacked', 1)).rejects.toBeInstanceOf(
      PluginPermissionError,
    );

    // The plugin itself never writes anything.
    const fake = makeFakeContext(null);
    await wordCount.wordCountPlugin.activate(fake.ctx);
    expect(fake.saveNote).not.toHaveBeenCalled();
  });
});

describe('word-count in the host', () => {
  it('is activated and deactivated by the host', async () => {
    const fakeEditor = makeFakeEditor('hello world');
    const { registry, commands, host } = makeHost(() => fakeEditor.editor);

    registry.register(wordCount.wordCountPlugin);
    registry.enable('word-count');
    await host.activate('word-count');

    expect(registry.get('word-count')?.state).toBe('active');
    expect(host.panels().map((p) => p.id)).toEqual(['word-count.panel']);
    expect(commands.has('word-count.count')).toBe(true);

    await host.deactivate('word-count');

    expect(registry.get('word-count')?.state).toBe('disabled');
    expect(host.panels()).toHaveLength(0);
    expect(commands.has('word-count.count')).toBe(false);
    expect(fakeEditor.unsubscribeSpy).toHaveBeenCalledTimes(1);
    expect(fakeEditor.listenerCount()).toBe(0);
  });

  it('is activated without an editor and does not fail', async () => {
    const { registry, host } = makeHost(() => null);
    registry.register(wordCount.wordCountPlugin);
    registry.enable('word-count');

    await expect(host.activate('word-count')).resolves.toBeUndefined();
    expect(registry.get('word-count')?.state).toBe('active');
    expect(host.panels()).toHaveLength(1);
  });

  it('starts working when a note is opened after the activation', async () => {
    let current: PluginEditor | null = null;
    const { registry, host } = makeHost(() => current);
    registry.register(wordCount.wordCountPlugin);
    registry.enable('word-count');
    await host.activate('word-count');

    render(host.panels()[0].render());
    expect(screen.getByText('No open note')).toBeTruthy();

    // The note is opened: the host notices the new editor.
    const fakeEditor = makeFakeEditor('Привет мир');
    current = fakeEditor.editor;
    act(() => {
      host.emit('editor.available', { path: 'notes/a.md' });
    });

    expect(screen.getByText('Words: 2')).toBeTruthy();
    expect(screen.getByText('Characters: 10')).toBeTruthy();
  });
});
