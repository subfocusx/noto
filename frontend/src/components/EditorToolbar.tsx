// The toolbar of the editor.
//
// The toolbar is the panel of the work with the text: the headings, the
// inline formats, the links, the lists and the size of the font. Every
// button puts the Markdown syntax around the selection of the editor, so the
// note on the disk stays plain Markdown and the panel of the plugins can
// read it.
//
// The toolbar is a part of the interface: it reads the editor through the
// handle and the preferences through the store.
import { useAppActions, useAppSelector } from '../core/store/hooks';
import {
  BOLD,
  CODE,
  ITALIC,
  STRIKETHROUGH,
  UNDERLINE,
  makeLink,
  prefixLines,
  toggleWrap,
  type Marker,
  type TextEdit,
} from '../core/editor/formatting';
import { EDITOR_FONT_SIZE_MAX, EDITOR_FONT_SIZE_MIN } from '../core/settings/prefs';
import { useT } from '../i18n/useT';
import type { EditorHandle } from './Editor';

interface EditorToolbarProps {
  /** The editor the toolbar works on; null when no note is open. */
  handle: EditorHandle | null;
}

/** One button of the toolbar. */
interface ToolbarButton {
  /** The key of the string of the button. */
  label: string;
  /** The text of the button. */
  text: string;
  /** The title of the button (the tooltip). */
  titleKey: string;
  /** The action of the button. */
  action: () => void;
}

/** The toolbar of the editor of a note. */
export function EditorToolbar({ handle }: EditorToolbarProps) {
  const t = useT();
  const fontSize = useAppSelector((state) => state.ui.editorFontSize);
  const actions = useAppActions();

  /** Applies an edit to the text of the editor. */
  const apply = (edit: TextEdit): void => {
    handle?.applyEdit(edit);
    handle?.focus();
  };

  /** Wraps the selection with the marker of an inline format. */
  const wrap = (marker: Marker) => (): void => {
    if (!handle) return;
    const text = handle.getText();
    const { from, to } = handle.getCursor();
    apply(toggleWrap(text, from, to, marker));
  };

  /** Puts the prefix at the beginning of the lines of the selection. */
  const prefix = (value: string, replaceHeadings = false) => (): void => {
    if (!handle) return;
    const text = handle.getText();
    const { from, to } = handle.getCursor();
    apply(prefixLines(text, from, to, value, replaceHeadings));
  };

  /** Turns the selection into a link. */
  const link = (): void => {
    if (!handle) return;
    const text = handle.getText();
    const { from, to } = handle.getCursor();
    apply(makeLink(text, from, to));
  };

  /** Changes the size of the font of the editor. */
  const changeFontSize = (delta: number) => (): void => {
    const next = Math.min(EDITOR_FONT_SIZE_MAX, Math.max(EDITOR_FONT_SIZE_MIN, fontSize + delta));
    if (next !== fontSize) actions.setEditorFontSize(next);
  };

  const buttons: ToolbarButton[] = [
    { label: 'H1', text: 'H1', titleKey: 'editor.toolbar.heading1', action: prefix('# ', true) },
    { label: 'H2', text: 'H2', titleKey: 'editor.toolbar.heading2', action: prefix('## ', true) },
    { label: 'H3', text: 'H3', titleKey: 'editor.toolbar.heading3', action: prefix('### ', true) },
    { label: 'B', text: 'B', titleKey: 'editor.toolbar.bold', action: wrap(BOLD) },
    { label: 'I', text: 'I', titleKey: 'editor.toolbar.italic', action: wrap(ITALIC) },
    { label: 'U', text: 'U', titleKey: 'editor.toolbar.underline', action: wrap(UNDERLINE) },
    { label: 'S', text: 'S', titleKey: 'editor.toolbar.strikethrough', action: wrap(STRIKETHROUGH) },
    { label: '`', text: '`', titleKey: 'editor.toolbar.code', action: wrap(CODE) },
    { label: '🔗', text: '🔗', titleKey: 'editor.toolbar.link', action: link },
    { label: '•', text: '•', titleKey: 'editor.toolbar.bulletList', action: prefix('- ') },
    { label: '1.', text: '1.', titleKey: 'editor.toolbar.numberedList', action: prefix('1. ') },
    { label: '❝', text: '❝', titleKey: 'editor.toolbar.quote', action: prefix('> ') },
  ];

  const disabled = !handle;

  return (
    <div class="editor-toolbar" role="toolbar" aria-label={t('editor.toolbar.label')} data-testid="editor-toolbar">
      {buttons.map((button) => (
        <button
          key={button.label}
          type="button"
          class="editor-toolbar-button"
          title={t(button.titleKey)}
          aria-label={t(button.titleKey)}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={button.action}
        >
          {button.text}
        </button>
      ))}
      <span class="editor-toolbar-separator" />
      <button
        type="button"
        class="editor-toolbar-button"
        title={t('editor.toolbar.fontSmaller')}
        aria-label={t('editor.toolbar.fontSmaller')}
        onMouseDown={(event) => event.preventDefault()}
        onClick={changeFontSize(-1)}
      >
        A−
      </button>
      <span class="editor-toolbar-size" data-testid="editor-toolbar-size">
        {fontSize}
      </span>
      <button
        type="button"
        class="editor-toolbar-button"
        title={t('editor.toolbar.fontBigger')}
        aria-label={t('editor.toolbar.fontBigger')}
        onMouseDown={(event) => event.preventDefault()}
        onClick={changeFontSize(1)}
      >
        A+
      </button>
    </div>
  );
}
