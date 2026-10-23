// The modal dialog of the application.
//
// The dialog is the accessible base of every modal of Noto: it owns the
// backdrop, the header, the body and the footer, and it takes care of the
// focus (the focus enters the dialog when it opens and returns to the trigger
// when it closes) and of the keyboard (Escape closes, Tab cycles inside).
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { Icon } from '../ui/icons';

export interface DialogProps {
  /** The title of the dialog; it is also its accessible name. */
  title: string;
  /** True when the dialog is shown. */
  open: boolean;
  /** Called when the dialog must be closed. */
  onClose(): void;
  /** The content of the dialog. */
  children?: ComponentChildren;
  /** The content of the footer; without it no footer is rendered. */
  footer?: ComponentChildren;
  /** An optional sentence shown at the top of the body. */
  description?: string;
}

/** The elements the focus can move to. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),' +
  ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The focusable elements of the dialog, in the order of the document. */
function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true',
  );
}

/**
 * Accessible modal dialog.
 *
 * The focus moves inside the dialog when it opens and returns to the previous
 * element when it closes. Escape closes the dialog and Tab cycles inside it.
 */
export function Dialog(props: DialogProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const previous = useRef<HTMLElement | null>(null);
  // The callback is kept in a ref: the effect must not run again when the
  // host creates a new closure on every render.
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;

  useEffect(() => {
    if (!props.open) return;

    const node = ref.current;
    previous.current = document.activeElement as HTMLElement | null;

    // The focus goes to the first control of the dialog, or to the dialog
    // itself when it has none.
    const items = node ? focusableWithin(node) : [];
    const target = items[0] ?? node;
    target?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose.current();
        return;
      }
      if (event.key !== 'Tab' || !node) return;

      const focusable = focusableWithin(node);
      if (focusable.length === 0) {
        event.preventDefault();
        node.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement as HTMLElement | null;

      if (!active || !node.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      // The focus returns to the element that had it before the dialog opened,
      // but only when that element is still in the document.
      const restore = previous.current;
      if (restore?.isConnected) restore.focus();
    };
  }, [props.open]);

  if (!props.open) return null;

  return (
    <div class="dialog-backdrop" onClick={(event) => event.target === event.currentTarget && props.onClose()}>
      <div
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        tabIndex={-1}
        ref={ref}
      >
        <header class="dialog-header">
          <h2>{props.title}</h2>
          <button type="button" class="icon-button" aria-label="Close dialog" onClick={props.onClose}>
            <Icon name="x" size={16} />
          </button>
        </header>
        <div class="dialog-body">
          {props.description ? <p class="dialog-hint">{props.description}</p> : null}
          {props.children}
        </div>
        {props.footer ? <footer class="dialog-footer">{props.footer}</footer> : null}
      </div>
    </div>
  );
}
