// CodeMirror 6 markdown editor. Exactly one EditorView instance is created;
// switching notes reconfigures the existing instance.
import { useEffect, useRef, useState } from 'preact/hooks';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { openSearchPanel, search, searchKeymap } from '@codemirror/search';
import {
  Annotation,
  Compartment,
  EditorState,
  StateEffect,
  StateField,
  type Extension,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  keymap,
  lineNumbers,
  placeholder,
  type DecorationSet,
} from '@codemirror/view';
import { attachmentRawUrl, uploadAttachment } from '../api/attachments';
import { matchRanges } from '../core/query/highlight';
import { parseQuery } from '../core/query/grammar';
import { AudioRecorder, RecorderError } from '../core/recorder/recorder';
import {
  formatDuration,
  insertRecordingReference,
  recordingReference,
  uploadRecording,
} from '../core/recorder/recording';
import { useAppSelector } from '../core/store/hooks';
import { useT } from '../i18n/useT';
import { attachmentReference, insertAttachmentReference } from '../lib/drafts';
import { computeMatchRanges, pickCurrentMatch, type TextRange } from '../lib/editor/matchRanges';
import {
  applyTagSuggestion,
  filterTagSuggestions,
  parseTagToken,
  type TagToken,
} from '../lib/editor/tags';
import '../styles/editor.css';

/** A range of the document (CodeMirror positions). */
export interface EditorRange {
  from: number;
  to: number;
}

/**
 * The imperative handle of the editor.
 *
 * The first five methods are the original API; they are kept unchanged so
 * that the existing application code keeps working. The rest is the
 * extension point for plugins.
 */
export interface EditorHandle {
  getText(): string;
  setText(text: string): void;
  insert(text: string): void;
  focus(): void;
  openSearch(): void;
  /** The text inside the main selection. */
  getSelection(): string;
  /** The main selection range. */
  getCursor(): EditorRange;
  /** Replaces the range `[from, to)` with `text` and reports the change. */
  insertAt(text: string, from: number, to: number): void;
  /** Replaces the current selection with `text` and reports the change. */
  replaceSelection(text: string): void;
  /** Subscribes to document changes; returns the unsubscribe function. */
  onChange(cb: (text: string) => void): () => void;
  /** Subscribes to selection changes; returns the unsubscribe function. */
  onSelectionChange(cb: (sel: EditorRange) => void): () => void;
  /** Replaces the CodeMirror extensions contributed by plugins. */
  setExtensions(extensions: Extension[]): void;
  /** Scrolls the given line (1-based) into the view and puts the cursor there. */
  scrollToLine(line: number): void;
}

interface EditorProps {
  value: string;
  path: string;
  /** The path the `value` belongs to; values of other notes are ignored. */
  contentPath?: string | null;
  placeholderText?: string;
  /** The size of the font of the editor, in pixels. */
  fontSize?: number;
  /** Whether long lines are wrapped. */
  wrap?: boolean;
  onChange(value: string): void;
  onSave(): void;
  /**
   * The query whose matches are highlighted in the text.
   *
   * The query of the filter of the store is used when it is not given.
   */
  highlightQuery?: string;
  /**
   * The tags of the vault, offered while the user types a `#`.
   *
   * The tags of the store are used when they are not given.
   */
  tags?: string[];
  /** Reports a failure of the editor to the application. */
  onError?(error: unknown): void;
  /** Receives the imperative handle once the editor is created. */
  onHandle?(handle: EditorHandle): void;
}

const EXTERNAL = Annotation.define<boolean>();

/** The default size of the font of the editor, in pixels. */
const DEFAULT_FONT_SIZE = 14;

/**
 * Builds the theme of the editor from the CSS variables of the application.
 *
 * The colours are not hard-coded: the theme follows the light and the dark
 * theme of the interface without a rebuild of the editor.
 */
function buildTheme(fontSize: number): Extension {
  return EditorView.theme({
    '&': {
      height: '100%',
      fontSize: `${fontSize}px`,
      backgroundColor: 'var(--bg-app)',
      color: 'var(--fg)',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: 'var(--mono-font)',
      lineHeight: '1.6',
      padding: '12px 0',
      overflow: 'auto',
    },
    '.cm-content': {
      fontSize: `${fontSize}px`,
      caretColor: 'var(--accent)',
    },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'var(--selection-bg)',
      color: 'var(--selection-fg)',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--bg-app)',
      color: 'var(--fg-muted)',
      border: 'none',
      fontSize: `${fontSize}px`,
    },
    '.cm-activeLine': { backgroundColor: 'var(--bg-hover)' },
    '.cm-activeLineGutter': { backgroundColor: 'var(--bg-hover)', color: 'var(--fg)' },
  });
}


function toggleWrap(mark: string) {
  return (view: EditorView): boolean => {
    const { state } = view;
    const changes = state.changeByRange((range) => {
      const selected = state.sliceDoc(range.from, range.to);
      const already =
        selected.startsWith(mark) && selected.endsWith(mark) && selected.length >= mark.length * 2;
      const inner = already ? selected.slice(mark.length, -mark.length) : selected;
      return {
        range,
        changes: {
          from: range.from,
          to: range.to,
          insert: already ? inner : `${mark}${inner}${mark}`,
        },
      };
    });
    view.dispatch(state.update(changes, { scrollIntoView: true }));
    view.focus();
    return true;
  };
}

/** A fenced code block needs the extra language modes. */
const HAS_CODE_FENCE = /^\s*(?:```|~~~)/m;

/* ------------------------------------------------------ the highlighted matches */

/** Carries the query of the filter into the state of the editor. */
const setHighlightQuery = StateEffect.define<string>();

/** The query of the filter that the editor highlights. */
const highlightQueryField = StateField.define<string>({
  create: () => '',
  update: (value, transaction) => {
    for (const effect of transaction.effects) {
      if (effect.is(setHighlightQuery)) return effect.value;
    }
    return value;
  },
});

/**
 * The ranges of the text that match the query of the filter.
 *
 * A query of the query language is understood as such: only the conditions
 * about the content of the note give a range. A query that is not a query of
 * the query language is a plain text, and every occurrence of it is a match.
 */
export function highlightRanges(text: string, query: string): TextRange[] {
  if (query.trim() === '') return [];
  try {
    const ast = parseQuery(query);
    if (ast) return matchRanges(text, ast);
  } catch {
    /* the query is not a query of the query language: it is a plain text */
  }
  return computeMatchRanges(text, query);
}

/** Paints the ranges of the matches of the query. */
function buildHighlight(state: EditorState): DecorationSet {
  const query = state.field(highlightQueryField);
  const ranges = highlightRanges(state.doc.toString(), query);
  if (ranges.length === 0) return Decoration.none;
  const current = pickCurrentMatch(ranges, state.selection.main.head);
  const decorations = ranges.map((range, index) =>
    Decoration.mark({
      class: index === current ? 'noto-match noto-match-current' : 'noto-match',
    }).range(range.from, range.to),
  );
  return Decoration.set(decorations, true);
}

/** The decorations of the matches of the query. */
const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (value, transaction) => {
    const hasEffect = transaction.effects.some((effect) => effect.is(setHighlightQuery));
    if (!transaction.docChanged && !transaction.selection && !hasEffect) return value;
    return buildHighlight(transaction.state);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/* ---------------------------------------------------------- the completion */

/** The completion of the tags that is shown under the editor. */
interface TagCompletion {
  /** The `#tag` that is being typed. */
  token: TagToken;
  /** The tags of the vault that fit it. */
  suggestions: string[];
}

export function MarkdownEditor(props: EditorProps) {
  const t = useT();
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  const onChange = useRef(props.onChange);
  const onSave = useRef(props.onSave);
  const valueRef = useRef(props.value);
  const handleCallback = useRef(props.onHandle);
  const extensionsRef = useRef<Extension[]>([]);
  const pathRef = useRef(props.path);
  const languagesCompartment = useRef<Compartment | null>(null);
  const languagesRequested = useRef(false);
  /** Holds the CodeMirror extensions contributed by plugins. */
  const pluginCompartment = useRef<Compartment | null>(null);
  /** Holds the theme of the editor, so it can be rebuilt without a reset. */
  const themeCompartment = useRef<Compartment | null>(null);
  /** Holds the line wrapping of the editor. */
  const wrapCompartment = useRef<Compartment | null>(null);
  const pluginExtensions = useRef<Extension[]>([]);
  /** The values of the theme that are already applied to the view. */
  const appliedTheme = useRef<{ fontSize: number; wrap: boolean }>({
    fontSize: props.fontSize ?? DEFAULT_FONT_SIZE,
    wrap: props.wrap ?? true,
  });
  /** Subscribers of the plugin facing events. */
  const changeSubscribers = useRef(new Set<(text: string) => void>());
  const selectionSubscribers = useRef(new Set<(sel: EditorRange) => void>());
  /** Set while the editor state is replaced, so no change is reported. */
  const suppress = useRef(false);
  /**
   * The query of the filter: the matches of the query are highlighted in the
   * text of the note. The query of the store is the default.
   */
  const storeQuery = useAppSelector((state) => state.ui.query);
  const query = props.highlightQuery ?? storeQuery;
  /**
   * The names of the tags of the vault. The selector answers a string, so
   * the list of the tags does not break the comparison of the subscription.
   */
  const storeTagList = useAppSelector((state) => state.ui.tags.map((tag) => tag.tag).join('\n'));
  const tagNames = props.tags ?? (storeTagList === '' ? [] : storeTagList.split('\n'));
  const tagsRef = useRef<string[]>(tagNames);
  tagsRef.current = tagNames;
  /** The completion of the tags that is shown under the editor. */
  const [completion, setCompletion] = useState<TagCompletion | null>(null);
  /** The index of the chosen suggestion of the completion. */
  const [selected, setSelected] = useState(0);
  const completionRef = useRef<TagCompletion | null>(null);
  completionRef.current = completion;
  const selectedRef = useRef(0);
  selectedRef.current = selected;
  if (!languagesCompartment.current) languagesCompartment.current = new Compartment();
  if (!pluginCompartment.current) pluginCompartment.current = new Compartment();
  if (!themeCompartment.current) themeCompartment.current = new Compartment();
  if (!wrapCompartment.current) wrapCompartment.current = new Compartment();

  onChange.current = props.onChange;
  onSave.current = props.onSave;
  handleCallback.current = props.onHandle;

  /**
   * The bundled language modes are large, so they are only fetched when the
   * note actually contains a fenced code block.
   */
  const ensureCodeLanguages = (doc: string) => {
    if (languagesRequested.current) return;
    if (!HAS_CODE_FENCE.test(doc)) return;
    languagesRequested.current = true;
    void import('@codemirror/language-data').then((mod) => {
      const instance = view.current;
      if (!instance) return;
      instance.dispatch({
        effects: languagesCompartment.current!.reconfigure(
          markdown({ base: markdownLanguage, codeLanguages: mod.languages }),
        ),
      });
    });
  };

  /**
   * Reads the `#tag` that is being typed and offers the tags of the vault.
   *
   * The list is closed as soon as the caret leaves the tag, so the editor
   * never covers the text with a list that does not belong to it.
   */
  const refreshCompletion = (text: string, head: number): void => {
    const token = parseTagToken(text, head);
    if (!token) {
      setCompletion(null);
      setSelected(0);
      return;
    }
    const suggestions = filterTagSuggestions(tagsRef.current, token.text);
    if (suggestions.length === 0) {
      setCompletion(null);
      setSelected(0);
      return;
    }
    setCompletion({ token, suggestions });
    setSelected(0);
  };

  /** Inserts the chosen tag into the text of the note. */
  const insertTag = (tag: string): boolean => {
    const instance = view.current;
    const current = completionRef.current;
    if (!instance || !current) return false;
    const text = instance.state.doc.toString();
    const result = applyTagSuggestion(text, current.token, tag);
    const inserted = result.text.slice(current.token.from, result.caret);
    instance.dispatch({
      changes: { from: current.token.from, to: current.token.to, insert: inserted },
      selection: { anchor: result.caret },
    });
    setCompletion(null);
    setSelected(0);
    instance.focus();
    return true;
  };

  /** Moves the choice inside the list of the suggestions. */
  const moveSelection = (delta: number): boolean => {
    const current = completionRef.current;
    if (!current || current.suggestions.length === 0) return false;
    const length = current.suggestions.length;
    setSelected((index) => (index + delta + length) % length);
    return true;
  };

  /**
   * Builds the extension set of the editor.
   *
   * The array is not frozen in the closure of the mount effect any more: it
   * is rebuilt whenever the extensions of a plugin change, so the same
   * builder can be used for the initial state and for the state that is
   * created when the note is switched.
   */
  const buildExtensions = (): Extension[] => [
    lineNumbers(),
    history(),
    languagesCompartment.current!.of(markdown({ base: markdownLanguage })),
    /** The extensions of the plugins; empty by default. */
    pluginCompartment.current!.of(pluginExtensions.current),
    search({ top: true }),
    highlightQueryField,
    highlightField,
    keymap.of([
      {
        key: 'Enter',
        preventDefault: true,
        run: () => {
          const current = completionRef.current;
          if (!current) return false;
          const tag = current.suggestions[selectedRef.current] ?? current.suggestions[0];
          return tag ? insertTag(tag) : false;
        },
      },
      {
        key: 'Tab',
        preventDefault: true,
        run: () => {
          const current = completionRef.current;
          if (!current) return false;
          const tag = current.suggestions[selectedRef.current] ?? current.suggestions[0];
          return tag ? insertTag(tag) : false;
        },
      },
      { key: 'ArrowDown', preventDefault: true, run: () => moveSelection(1) },
      { key: 'ArrowUp', preventDefault: true, run: () => moveSelection(-1) },
      {
        key: 'Mod-s',
        preventDefault: true,
        run: () => {
          onSave.current();
          return true;
        },
      },
      { key: 'Mod-b', preventDefault: true, run: toggleWrap('**') },
      { key: 'Mod-i', preventDefault: true, run: toggleWrap('*') },
      ...searchKeymap,
      ...defaultKeymap,
      ...historyKeymap,
    ]),
    placeholder(props.placeholderText ?? t('editor.placeholder')),
    themeCompartment.current!.of(buildTheme(appliedTheme.current.fontSize)),
    wrapCompartment.current!.of(appliedTheme.current.wrap ? EditorView.lineWrapping : []),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const text = update.state.doc.toString();
        valueRef.current = text;
        ensureCodeLanguages(text);
        const external = update.transactions.some((tr) => tr.annotation(EXTERNAL) === true);
        // The application only hears about changes that came from the user,
        // the plugins hear about every change of the document.
        if (!external && !suppress.current) onChange.current(text);
        for (const cb of [...changeSubscribers.current]) {
          try {
            cb(text);
          } catch {
            /* a broken subscriber must not break the editor */
          }
        }
      }
      if (update.selectionSet) {
        const main = update.state.selection.main;
        const range: EditorRange = { from: main.from, to: main.to };
        for (const cb of [...selectionSubscribers.current]) {
          try {
            cb(range);
          } catch {
            /* a broken subscriber must not break the editor */
          }
        }
      }
      // The list of the tags follows the caret.
      refreshCompletion(update.state.doc.toString(), update.state.selection.main.head);
    }),
  ];

  useEffect(() => {
    if (!host.current) return;
    const extensions = buildExtensions();
    extensionsRef.current = extensions;

    // Only the content of the current note may be shown.
    const initialDoc =
      props.contentPath === undefined || props.contentPath === props.path ? valueRef.current : '';
    const instance = new EditorView({
      state: EditorState.create({ doc: initialDoc, extensions }),
      parent: host.current,
    });
    view.current = instance;
    valueRef.current = initialDoc;
    ensureCodeLanguages(initialDoc);

    const handle: EditorHandle = {
      getText: () => instance.state.doc.toString(),
      setText: (text: string) => {
        const len = instance.state.doc.length;
        instance.dispatch({
          changes: { from: 0, to: len, insert: text },
          annotations: EXTERNAL.of(true),
        });
        valueRef.current = text;
      },
      insert: (text: string) => {
        const { from, to } = instance.state.selection.main;
        instance.dispatch({ changes: { from, to, insert: text } });
        instance.focus();
      },
      focus: () => instance.focus(),
      openSearch: () => {
        openSearchPanel(instance);
        instance.focus();
      },
      getSelection: () => {
        const { from, to } = instance.state.selection.main;
        return instance.state.sliceDoc(from, to);
      },
      getCursor: () => {
        const { from, to } = instance.state.selection.main;
        return { from, to };
      },
      insertAt: (text: string, from: number, to: number) => {
        const max = instance.state.doc.length;
        const start = Math.max(0, Math.min(from, max));
        const end = Math.max(start, Math.min(to, max));
        const cursor = start + text.length;
        // No `EXTERNAL` annotation: the application must see the change so
        // that the autosave and the draft work as usual.
        instance.dispatch({
          changes: { from: start, to: end, insert: text },
          selection: { anchor: cursor },
        });
      },
      replaceSelection: (text: string) => {
        const { from, to } = instance.state.selection.main;
        const cursor = from + text.length;
        instance.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: cursor },
        });
      },
      onChange: (cb: (text: string) => void) => {
        changeSubscribers.current.add(cb);
        return () => {
          changeSubscribers.current.delete(cb);
        };
      },
      onSelectionChange: (cb: (sel: EditorRange) => void) => {
        selectionSubscribers.current.add(cb);
        return () => {
          selectionSubscribers.current.delete(cb);
        };
      },
      scrollToLine: (line: number) => {
        const doc = instance.state.doc;
        const number = Math.min(Math.max(line, 1), doc.lines);
        const pos = doc.line(number).from;
        instance.dispatch({
          selection: { anchor: pos },
          scrollIntoView: true,
        });
        instance.focus();
      },
      setExtensions: (next: Extension[]) => {
        pluginExtensions.current = next;
        // The extensions of the view are reconfigured, the document and the
        // history of the note are kept.
        instance.dispatch({
          effects: pluginCompartment.current!.reconfigure(next),
        });
        // A state that is created later (note switch) uses the same set.
        extensionsRef.current = buildExtensions();
      },
    };
    handleCallback.current?.(handle);

    return () => {
      // The listeners of the destroyed view must not survive it.
      changeSubscribers.current.clear();
      selectionSubscribers.current.clear();
      instance.destroy();
      view.current = null;
    };
    // The editor is created once; note switches reconfigure the instance.
  }, []);

  // The query of the filter changes the matches that are highlighted in the
  // text of the note.
  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    instance.dispatch({ effects: setHighlightQuery.of(query) });
  }, [query]);

  // A new font size or a new wrapping only reconfigures the theme of the
  // view: the document, the history and the cursor stay untouched.
  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    const fontSize = props.fontSize ?? DEFAULT_FONT_SIZE;
    const wrap = props.wrap ?? true;
    if (appliedTheme.current.fontSize === fontSize && appliedTheme.current.wrap === wrap) return;
    appliedTheme.current = { fontSize, wrap };
    instance.dispatch({
      effects: [
        themeCompartment.current!.reconfigure(buildTheme(fontSize)),
        wrapCompartment.current!.reconfigure(wrap ? EditorView.lineWrapping : []),
      ],
    });
  }, [props.fontSize, props.wrap]);

  // Reconfigure on note switch: a fresh state releases the history and the
  // document of the previous note, the view itself is kept.
  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    if (pathRef.current === props.path) return;
    pathRef.current = props.path;
    // The list of the tags belongs to the text of the previous note.
    setCompletion(null);
    setSelected(0);
    // A new state releases the history and the document of the previous note.
    suppress.current = true;
    instance.setState(EditorState.create({ doc: '', extensions: extensionsRef.current }));
    suppress.current = false;
    valueRef.current = '';
    if (props.path) instance.focus();
  }, [props.path]);

  // Apply the content of the current note; values of other notes are ignored.
  const contentBelongsToPath = props.contentPath === undefined || props.contentPath === props.path;
  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    if (!contentBelongsToPath) return;
    const current = instance.state.doc.toString();
    if (current === props.value) return;
    instance.dispatch({
      changes: { from: 0, to: current.length, insert: props.value },
      annotations: EXTERNAL.of(true),
    });
    valueRef.current = props.value;
    ensureCodeLanguages(props.value);
  }, [props.value, contentBelongsToPath]);

  /**
   * Puts the file that was dropped into the text of the note.
   *
   * The file is uploaded first, so the reference of the text points at the
   * copy of the file on the server and not at the file of the computer of
   * the user.
   */
  const onDrop = async (event: DragEvent): Promise<void> => {
    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return;
    event.preventDefault();
    const instance = view.current;
    if (!instance) return;
    for (const file of Array.from(files)) {
      try {
        const attachment = await uploadAttachment(file, props.path);
        const reference = attachmentReference(attachment.name, attachmentRawUrl(attachment.id));
        const { from, to } = instance.state.selection.main;
        const current = instance.state.doc.toString();
        const result = insertAttachmentReference(current, from, reference);
        const inserted = result.text.slice(from, result.caret);
        instance.dispatch({
          changes: { from, to, insert: inserted },
          selection: { anchor: result.caret },
        });
      } catch (error) {
        props.onError?.(error);
      }
    }
  };

  /* ------------------------------------------------------- the recording */

  /** The recorder of the sound; it exists only while a recording runs. */
  const recorderRef = useRef<AudioRecorder | null>(null);
  /** True while the recording runs. */
  const [recording, setRecording] = useState(false);
  /** The length of the recording that runs, in milliseconds. */
  const [elapsed, setElapsed] = useState(0);
  /** The level of the microphone, from 0 to 1. */
  const [level, setLevel] = useState(0);
  /** The failure of the recording, if any. */
  const [recorderError, setRecorderError] = useState<string | null>(null);
  /** The timer that follows the recording. */
  const timerRef = useRef<number | null>(null);

  const stopTimer = (): void => {
    if (timerRef.current === null) return;
    window.clearInterval(timerRef.current);
    timerRef.current = null;
  };

  /**
   * Starts a recording.
   *
   * The microphone is asked here and not before: the permission of the
   * browser belongs to the moment the user asks for a recording. A refused
   * permission shows a message and leaves the editor untouched.
   */
  const startRecording = async (): Promise<void> => {
    setRecorderError(null);
    const recorder = new AudioRecorder();
    recorderRef.current = recorder;
    try {
      await recorder.start();
    } catch (error) {
      recorderRef.current = null;
      const denied = error instanceof RecorderError && error.code === 'permission-denied';
      setRecorderError(
        denied ? t('editor.recorder.permissionDenied') : t('editor.recorder.cannotStart'),
      );
      return;
    }
    setRecording(true);
    setElapsed(0);
    timerRef.current = window.setInterval(() => {
      setElapsed(recorder.elapsedMs);
      setLevel(recorder.level);
    }, 100);
  };

  /**
   * Stops the recording and puts it into the note.
   *
   * The bytes are uploaded as an attachment of the note, and the reference of
   * the recording goes to the caret of the editor.
   */
  const stopRecording = async (): Promise<void> => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    stopTimer();
    setRecording(false);
    setLevel(0);
    try {
      const result = await recorder.stop();
      const attachment = await uploadRecording(result, props.path);
      const reference = recordingReference(result, attachmentRawUrl(attachment.id));
      const instance = view.current;
      if (instance) {
        const { from, to } = instance.state.selection.main;
        const current = instance.state.doc.toString();
        const inserted = insertRecordingReference(current, from, reference);
        instance.dispatch({
          changes: { from, to, insert: inserted.text.slice(from, inserted.caret) },
          selection: { anchor: inserted.caret },
        });
      }
    } catch (error) {
      setRecorderError(t('editor.recorder.cannotSave'));
      props.onError?.(error);
    } finally {
      recorderRef.current = null;
    }
  };

  // A note that is closed must not leave a recording behind.
  useEffect(
    () => () => {
      stopTimer();
      recorderRef.current?.cancel();
      recorderRef.current = null;
    },
    [],
  );

  return (
    <div
      class="editor-shell"
      onDrop={(event) => {
        void onDrop(event as DragEvent);
      }}
      onDragOver={(event) => {
        if (event.dataTransfer?.types?.includes('Files')) event.preventDefault();
      }}
    >
      <div
        class="editor-recorder"
        style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', padding: '4px 0' }}
      >
        <button
          type="button"
          class="text-button"
          onClick={() => {
            void (recording ? stopRecording() : startRecording());
          }}
          aria-pressed={recording}
          data-testid="recorder-toggle"
        >
          {recording ? t('editor.recorder.stop') : t('editor.recorder.start')}
        </button>
        {recording ? (
          <>
            <span class="editor-recorder-timer" data-testid="recorder-timer">
              {formatDuration(elapsed)}
            </span>
            <span
              class="editor-recorder-meter"
              role="meter"
              aria-label={t('editor.recorder.level')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(level * 100)}
              data-testid="recorder-level"
              style={{
                display: 'inline-block',
                width: '80px',
                height: '6px',
                background: 'var(--bg-hover)',
                borderRadius: '3px',
                overflow: 'hidden',
              }}
            >
              <span
                class="editor-recorder-meter-fill"
                style={{
                  display: 'block',
                  width: `${Math.round(level * 100)}%`,
                  height: '100%',
                  background: 'var(--accent)',
                }}
              />
            </span>
          </>
        ) : null}
        {recorderError ? (
          <span class="error-text" role="alert" data-testid="recorder-error">
            {recorderError}
          </span>
        ) : null}
      </div>
      <div class="editor-host" ref={host} data-testid="markdown-editor" />
      {completion ? (
        <ul class="editor-completion" role="listbox" aria-label={t('editor.tagsLabel')}>
          {completion.suggestions.map((tag, index) => (
            <li key={tag} role="option" aria-selected={index === selected}>
              <button
                type="button"
                class={index === selected ? 'editor-completion-item active' : 'editor-completion-item'}
                onMouseEnter={() => setSelected(index)}
                onMouseDown={(event) => {
                  // The editor must not lose the focus before the tag is in.
                  event.preventDefault();
                  insertTag(tag);
                }}
              >
                #{tag}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
