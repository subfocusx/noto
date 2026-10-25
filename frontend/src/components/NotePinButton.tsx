// The pin of a note.
//
// The button pins a note to the top of the tree. The pins live in the core
// (`core/pin/pins.ts`), so the button and the tree always agree on what is
// pinned.
import { useSyncExternalStore } from 'preact/compat';
import { getPins, isPinned, subscribePins, togglePin } from '../core/pin/pins';
import { useT } from '../i18n/useT';
import { Icon } from '../ui/icons';

export interface NotePinButtonProps {
  /** The path of the note. */
  path: string;
  /** The name of the note, used by the accessible label. */
  label?: string;
}

/**
 * The button that pins a note (or unpins it).
 */
export function NotePinButton(props: NotePinButtonProps) {
  const t = useT();
  const pins = useSyncExternalStore(subscribePins, getPins);
  const pinned = isPinned(pins, props.path);
  const name = props.label ?? props.path;

  return (
    <button
      type="button"
      class={`note-pin-button${pinned ? ' pinned' : ''}`}
      aria-pressed={pinned}
      aria-label={pinned ? t('pin.unpinNamed', { name }) : t('pin.pinNamed', { name })}
      title={pinned ? t('pin.unpinLabel') : t('pin.label')}
      onClick={(event) => {
        // The click belongs to the button, not to the row of the tree.
        event.stopPropagation();
        togglePin(props.path);
      }}
    >
      <Icon name="bookmark" size={13} />
    </button>
  );
}
