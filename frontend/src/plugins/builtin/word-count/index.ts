// The "Word Count" built-in plugin.
//
// The plugin is a read-only observer of the editor: it subscribes to
// `ctx.editor.onChange()` and shows the number of words and characters of the
// active note in a panel.
//
// The editor is NOT captured once at activation: the plugin subscribes to
// `ctx.onEditor()`, so it starts working as soon as a note is opened, even if
// it was activated before the first note existed. Every new editor replaces
// the previous one, and the subscription of the previous editor is dropped.
//
// Counting rules (documented here because they are part of the behaviour):
//
//   * a word is a maximal run of letters or digits, matched with
//     `/[\p{L}\p{N}]+/gu`; cyrillic text is counted the same way as latin
//     text, and punctuation does not create words;
//   * a character is one Unicode code point of the text, so an emoji counts as
//     a single character (`Array.from(text).length`); the line breaks are
//     counted as well.
//
// The plugin never writes into the note and never logs the text of the note:
// the logger only receives the counters.
//
// Permissions: `editor.read` (the text of the note) and `ui.contribute` (the
// panel and the command). The plugin does NOT ask for `editor.write` or
// `notes.write`, so the host refuses every write operation of this plugin.
//
// The whole plugin lives in one file on purpose: the boundary checker allows
// `src/plugins/builtin/**` to import `src/plugins/contract.ts` only, so a
// builtin plugin cannot import its own sibling modules either.
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Plugin, PluginContext, PluginEditor, PluginManifest } from '../../contract';

/* ---------------------------------------------------------------- manifest */

/** Static description of the plugin. */
export const wordCountManifest: PluginManifest = {
  id: 'word-count',
  name: 'Word Count',
  version: '1.0.0',
  manifestVersion: 1,
  minApiVersion: '1.0.0',
  description: 'Counts the words and the characters of the active note.',
  author: 'Noto',
  // `editor.read` — the text of the note; `ui.contribute` — the panel and the
  // command. The plugin never asks for a write permission.
  permissions: ['editor.read', 'ui.contribute'],
  settings: [
    {
      key: 'countChars',
      label: 'Count the characters',
      type: 'boolean',
      default: true,
      description: 'Show the number of the characters together with the number of the words.',
    },
  ],
};

/* ---------------------------------------------------------------- counting */

/** The counters of a note. */
export interface WordCountStats {
  /** Number of words (runs of letters/digits). */
  words: number;
  /** Number of Unicode code points of the text. */
  characters: number;
}

/**
 * Counts the words of a text.
 *
 * A word is a maximal run of letters or digits; every other character
 * (spaces, line breaks, punctuation) is a separator.
 */
export function countWords(text: string): number {
  // The regular expression is created per call: a global regular expression
  // keeps a `lastIndex` between the calls, which would break the counting.
  const matches = text.match(/[\p{L}\p{N}]+/gu);
  return matches ? matches.length : 0;
}

/** Counts the characters (Unicode code points) of a text. */
export function countCharacters(text: string): number {
  return Array.from(text).length;
}

/** Counts both the words and the characters of a text. */
export function computeStats(text: string): WordCountStats {
  return { words: countWords(text), characters: countCharacters(text) };
}

/* ------------------------------------------------------------------- store */

/** The state shown by the panel. */
export interface WordCountState {
  /** True when a note is open (an editor is available). */
  available: boolean;
  /** The counters of the active note; null when there is no note. */
  stats: WordCountStats | null;
}

/**
 * The shared state of the plugin.
 *
 * The editor subscription lives in the plugin (and not in the view), so that
 * it can be removed on deactivation. The view subscribes to the store and
 * re-renders when the counters change.
 */
export class WordCountStore {
  private state: WordCountState = { available: false, stats: null };
  private readonly listeners = new Set<() => void>();

  /** The current state. */
  get(): WordCountState {
    return this.state;
  }

  /** Replaces the state and notifies the subscribers. */
  set(next: WordCountState): void {
    this.state = next;
    for (const listener of Array.from(this.listeners)) listener();
  }

  /**
   * Subscribes to the state changes.
   *
   * @returns an idempotent unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/* -------------------------------------------------------------------- view */

interface WordCountViewProps {
  /** The shared state of the plugin. */
  store: WordCountStore;
  /** True when the characters must be shown. */
  showChars: () => boolean;
}

/** The content of the panel. */
function WordCountView(props: WordCountViewProps) {
  const [, bump] = useState(0);
  useEffect(() => props.store.subscribe(() => bump((n) => n + 1)), [props.store]);

  const state = props.store.get();
  if (!state.available || !state.stats) {
    return h(
      'div',
      { class: 'noto-word-count', 'data-plugin': 'word-count' },
      h('span', { class: 'noto-word-count-empty' }, 'No open note'),
    );
  }

  return h(
    'div',
    { class: 'noto-word-count', 'data-plugin': 'word-count' },
    h('span', { class: 'noto-word-count-words' }, `Words: ${state.stats.words}`),
    props.showChars()
      ? h('span', { class: 'noto-word-count-chars' }, `Characters: ${state.stats.characters}`)
      : null,
  );
}

/**
 * Reads the `countChars` setting.
 *
 * The value is missing when the settings are not available yet: the counter
 * of the characters is shown by default (the default of the manifest).
 */
async function readShowChars(ctx: PluginContext): Promise<boolean> {
  try {
    const value = await ctx.settings.get<boolean>('countChars');
    if (value === undefined) return true;
    return value !== false;
  } catch {
    return true;
  }
}

/* ------------------------------------------------------------------ plugin */

/** The "Word Count" plugin. */
export const wordCountPlugin: Plugin = {
  manifest: wordCountManifest,

  async activate(ctx: PluginContext): Promise<void> {
    const store = new WordCountStore();
    /** Cancels the subscription of the text changes of the current editor. */
    let unsubscribeChange: (() => void) | null = null;
    /** Cancels the subscription of the editor itself. */
    let unsubscribeEditor: (() => void) | null = null;

    const showChars = await readShowChars(ctx);

    const apply = (text: string): void => {
      const stats = computeStats(text);
      store.set({ available: true, stats });
      // Only the counters are logged, never the text of the note.
      ctx.logger.debug('word count updated', {
        words: stats.words,
        characters: stats.characters,
      });
    };

    /** Drops the subscription of the previous editor. */
    const detach = (): void => {
      if (unsubscribeChange) {
        unsubscribeChange();
        unsubscribeChange = null;
      }
    };

    /**
     * Attaches the plugin to an editor.
     *
     * The callback is called with `null` when no note is open; the panel then
     * shows the placeholder instead of failing.
     */
    const attach = (editor: PluginEditor | null): void => {
      // A new editor replaces the previous one: its subscription is dropped.
      detach();
      if (!editor) {
        store.set({ available: false, stats: null });
        return;
      }
      apply(editor.getText());
      unsubscribeChange = editor.onChange(apply);
    };

    if (typeof ctx.onEditor === 'function') {
      // The live editor: the callback is called with the current editor and
      // then on every change of it.
      unsubscribeEditor = ctx.onEditor(attach);
    } else {
      // Fallback for hosts without `onEditor`: the editor is read once.
      attach(ctx.editor);
    }

    ctx.onDeactivate(() => {
      detach();
      if (unsubscribeEditor) {
        unsubscribeEditor();
        unsubscribeEditor = null;
      }
      store.set({ available: false, stats: null });
    });

    ctx.registerPanel({
      id: 'word-count.panel',
      title: 'Word Count',
      render: () => h(WordCountView, { store, showChars: () => showChars }),
    });

    ctx.registerCommand({
      id: 'word-count.count',
      title: 'Word Count: show the counter',
      description: 'Shows the number of the words and the characters of the active note.',
      run: () => {
        const state = store.get();
        ctx.logger.info('word count', {
          available: state.available,
          words: state.stats?.words ?? 0,
          characters: state.stats?.characters ?? 0,
        });
      },
    });
  },
};
