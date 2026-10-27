// The button of the mode of the note.
//
// One button, two modes: the note is either edited or read, never both at
// once.
//
// The button stands in the strip of the tags: the strip is the last row of the
// header of the column of the editor, and the far corner of that row is the
// place of the actions that belong to the whole note. Beside the tabs it was
// lost among the other icons of the row.
import { Icon } from '../ui/icons';

export interface EditorModeButtonProps {
  /** The accessible name of the button: the mode the button switches to. */
  label: string;
  /** The tooltip of the button. */
  title: string;
  /** True when the note is edited (the button offers the reading mode). */
  pressed: boolean;
  /** Called when the user clicks the button. */
  onClick(): void;
}

/** The pencil: it switches the note between the editing and the reading. */
export function EditorModeButton(props: EditorModeButtonProps) {
  return (
    <button
      type="button"
      class="icon-button note-mode-toggle"
      aria-label={props.label}
      title={props.title}
      aria-pressed={props.pressed ? 'true' : 'false'}
      data-testid="tab-mode"
      onClick={props.onClick}
    >
      <Icon name="pencil" size={14} />
    </button>
  );
}
