// CodeMirror 6 markdown editor. Exactly one EditorView instance is created;
// switching notes reconfigures the existing instance.
import { useEffect, useRef } from 'preact/hooks';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { Annotation, Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, placeholder } from '@codemirror/view';

export interface EditorHandle {
  getText(): string;
  setText(text: string): void;
  insert(text: string): void;
  focus(): void;
  openSearch(): void;
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
  /** Set while the editor state is replaced, so no change is reported. */
  const suppress = useRef(false);
  if (!languagesCompartment.current) languagesCompartment.current = new Compartment();

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

  useEffect(() => {
    if (!host.current) return;
    const extensions: Extension[] = [
      lineNumbers(),
      history(),
      languagesCompartment.current!.of(markdown({ base: markdownLanguage })),
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
        if (!update.docChanged) return;
        const text = update.state.doc.toString();
        valueRef.current = text;
        ensureCodeLanguages(text);
        if (suppress.current) return;
        const external = update.transactions.some((tr) => tr.annotation(EXTERNAL) === true);
        if (external) return;
        onChange.current(text);
      }),
    ];
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
    };
    handleCallback.current?.(handle);

    return () => {
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
