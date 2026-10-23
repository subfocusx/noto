// CodeMirror 6 markdown editor. Exactly one EditorView instance is created;
// switching notes reconfigures the existing instance.
import { useEffect, useRef } from 'preact/hooks';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { Annotation, Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, placeholder } from '@codemirror/view';

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
}

interface EditorProps {
  value: string;
  path: string;
  /** The path the `value` belongs to; values of other notes are ignored. */
  contentPath?: string | null;
  placeholderText?: string;
  onChange(value: string): void;
  onSave(): void;
  /** Receives the imperative handle once the editor is created. */
  onHandle?(handle: EditorHandle): void;
}

const EXTERNAL = Annotation.define<boolean>();

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '14px',
    backgroundColor: 'var(--editor-bg)',
    color: 'var(--editor-fg)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--mono-font)',
    lineHeight: '1.6',
    padding: '12px 0',
  },
  '.cm-content': { caretColor: 'var(--editor-fg)' },
  '.cm-gutters': {
    backgroundColor: 'var(--editor-bg)',
    color: 'var(--editor-gutter)',
    border: 'none',
  },
  '.cm-activeLine': { backgroundColor: 'var(--editor-active-line)' },
});

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

export function MarkdownEditor(props: EditorProps) {
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
  const pluginExtensions = useRef<Extension[]>([]);
  /** Subscribers of the plugin facing events. */
  const changeSubscribers = useRef(new Set<(text: string) => void>());
  const selectionSubscribers = useRef(new Set<(sel: EditorRange) => void>());
  /** Set while the editor state is replaced, so no change is reported. */
  const suppress = useRef(false);
  if (!languagesCompartment.current) languagesCompartment.current = new Compartment();
  if (!pluginCompartment.current) pluginCompartment.current = new Compartment();

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
    keymap.of([
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
    placeholder(props.placeholderText ?? 'Write something…'),
    editorTheme,
    EditorView.lineWrapping,
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

  // Reconfigure on note switch: a fresh state releases the history and the
  // document of the previous note, the view itself is kept.
  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    if (pathRef.current === props.path) return;
    pathRef.current = props.path;
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

  return <div class="editor-host" ref={host} data-testid="markdown-editor" />;
}
