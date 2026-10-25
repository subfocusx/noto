// The quick menu of the storage of the notes.
//
// The notes live in one folder, and the server follows the choice of the user.
// The menu is the quick way to change it: it shows the storage that is open
// now, the storages that were opened before, and the picker of the folders.
//
// The menu is rendered by the header of the explorer, next to the path of the
// storage, and it closes as soon as the user leaves it.
import { useEffect, useRef } from 'preact/hooks';
import { Icon } from '../ui/icons';

export interface VaultSwitchMenuProps {
  /** The path of the storage that is open now. */
  currentPath: string;
  /** The storages that were opened before, the newest first. */
  recents: string[];
  /** True when the storage is fixed by the environment. */
  fixed?: boolean;
  /**
   * The buttons that open the menu.
   *
   * A click on them must not close the menu: the button itself decides whether
   * the menu opens or closes.
   */
  triggerRef?: { current: HTMLElement | null };
  /** Called when the user chooses a storage. */
  onSwitch(path: string): void;
  /** Called when the user asks to look for a folder. */
  onBrowse(): void;
  /** Called when the menu must be closed. */
  onClose(): void;
}

/**
 * The name of the folder: the last segment of the path.
 *
 * The path of a storage is a path of the operating system: on Windows it is
 * cut at the backslash, otherwise the whole path would be the name of the
 * folder.
 */
function nameOf(path: string): string {
  const segments = path.split(/[/\\]/);
  return segments[segments.length - 1] || path;
}

export function VaultSwitchMenu(props: VaultSwitchMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const closedRef = useRef(false);

  // The first item takes the focus, so the menu can be driven with the
  // keyboard right away.
  useEffect(() => {
    const first = menuRef.current?.querySelector<HTMLButtonElement>('.vault-menu-item');
    first?.focus();
  }, []);

  useEffect(() => {
    const close = (): void => {
      if (closedRef.current) return;
      closedRef.current = true;
      props.onClose();
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close();
    };

    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as globalThis.Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      if (props.triggerRef?.current?.contains(target)) return;
      close();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('blur', close);
    };
  }, [props.onClose]);

  const run = (action: () => void): void => {
    if (closedRef.current) return;
    closedRef.current = true;
    action();
    props.onClose();
  };

  // The storage that is open now is not offered again.
  const others = props.recents.filter((path) => path !== props.currentPath);

  return (
    <div
      ref={menuRef}
      class="vault-menu"
      role="menu"
      aria-label="Switch the storage of the notes"
    >
      <div class="vault-menu-title" role="presentation">
        Storage of the notes
      </div>
      <div class="vault-menu-current" role="presentation" title={props.currentPath}>
        <Icon name="folder" size={14} />
        <span class="vault-menu-current-name">{nameOf(props.currentPath)}</span>
        <span class="vault-menu-current-path">{props.currentPath}</span>
      </div>
      {others.length > 0 ? (
        <>
          <div class="context-menu-separator" role="presentation" />
          <div class="vault-menu-title" role="presentation">
            Recent
          </div>
          {others.map((path) => (
            <button
              key={path}
              type="button"
              class="vault-menu-item"
              role="menuitem"
              title={path}
              onClick={() => run(() => props.onSwitch(path))}
            >
              <Icon name="folder" size={14} />
              <span class="vault-menu-item-name">{nameOf(path)}</span>
              <span class="vault-menu-item-path">{path}</span>
            </button>
          ))}
        </>
      ) : null}
      <div class="context-menu-separator" role="presentation" />
      {props.fixed ? (
        <div class="vault-menu-fixed" role="presentation">
          The storage is fixed by the environment
        </div>
      ) : (
        <button
          type="button"
          class="vault-menu-item"
          role="menuitem"
          onClick={() => run(props.onBrowse)}
        >
          <Icon name="folder-plus" size={14} />
          <span class="vault-menu-item-name">Choose another folder…</span>
        </button>
      )}
    </div>
  );
}
