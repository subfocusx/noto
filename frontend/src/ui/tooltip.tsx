// The accessible controls of the icon-only buttons.
//
// An icon-only button has no visible text: the name of the action lives only
// in the `aria-label` (for the assistive technology) and in the `title` (for
// the tooltip of the pointer). Every such button of the application uses the
// helpers of this module, so the two names can never drift apart.
import { Icon } from './icons';

/**
 * The attributes of an icon-only control.
 *
 * The same text is used for the accessible name and for the tooltip: the user
 * sees the name of the action when the pointer rests on the button, and the
 * screen reader reads the very same word.
 */
export function tooltipAttrs(label: string): { 'aria-label': string; title: string } {
  return { 'aria-label': label, title: label };
}

export interface IconButtonProps {
  /** The name of the action; it is the accessible name and the tooltip. */
  label: string;
  /** The name of the icon of the registry. */
  icon: string;
  /** The size of the icon in pixels. */
  size?: number;
  /** Extra classes of the button. */
  class?: string;
  /** Called when the button is pressed. */
  onClick?: () => void;
  /** The state of a toggle button; omitted when the button is not a toggle. */
  pressed?: boolean;
  /** Disables the button completely. */
  disabled?: boolean;
  /** Marks the button as unavailable, but keeps it focusable. */
  ariaDisabled?: boolean;
  /** The tooltip of the button; the label by default. */
  title?: string;
  /** The test id of the button. */
  testId?: string;
}

/**
 * A button that shows only an icon.
 *
 * The button always carries both an `aria-label` and a `title`: an icon-only
 * control without a name is invisible to the assistive technology.
 */
export function IconButton(props: IconButtonProps) {
  return (
    <button
      type="button"
      class={props.class ? `icon-button ${props.class}` : 'icon-button'}
      aria-label={props.label}
      title={props.title ?? props.label}
      aria-pressed={props.pressed}
      aria-disabled={props.ariaDisabled}
      disabled={props.disabled}
      onClick={props.onClick}
      data-testid={props.testId}
    >
      <Icon name={props.icon} size={props.size ?? 16} />
    </button>
  );
}
