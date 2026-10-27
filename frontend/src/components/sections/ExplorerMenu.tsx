// The menu of the explorer.
//
// The header of the column used to hold a row of six icon buttons: the
// actions of the explorer were visible, but they were also six chances to
// miss a small target. The strip of the actions of the tree carries the
// actions of the tree itself; the menu keeps the rest of the vault — the
// graph and the plugins — out of the way.
//
// The items of the menu are plain buttons, not the items of a menu: the
// menu is a group of actions, not a list of choices of one question. The
// actions of the tree (the expansion of the folders, the new folder, the
// fresh tree, the archive) stay in the tree, where they belong.
//
// The menu closes as soon as the user leaves it, like the menu of the
// storage next to it.
import { useEffect, useRef } from 'preact/hooks';
import { useT } from '../../i18n/useT';
import { Icon } from '../../ui/icons';

export interface ExplorerMenuProps {
  /** Called when the user opens the graph of the vault. */
  onOpenGraph?(): void;
  /** Called when the user opens the manager of the plugins. */
  onOpenPlugins?(): void;
  /**
   * The button that opened the menu.
   *
   * A click on it must not close the menu: the button itself decides whether
   * the menu opens or closes.
   */
  triggerRef?: { current: HTMLElement | null };
  /** Called when the menu must be closed. */
  onClose(): void;
}

/** One item of the menu. */
interface MenuItem {
  /** The name of the action. */
  label: string;
  /** The icon of the action. */
  icon: string;
  /** The action of the item. */
  run(): void;
}

/**
 * The menu of the explorer.
 */
export function ExplorerMenu(props: ExplorerMenuProps) {
  const t = useT();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const closedRef = useRef(false);

  // The first item takes the focus, so the menu can be driven with the
  // keyboard right away.
  useEffect(() => {
    const first = menuRef.current?.querySelector<HTMLButtonElement>('.explorer-menu-item');
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

  /** Runs an action and closes the menu. */
  const run = (action: () => void): void => {
    if (closedRef.current) return;
    closedRef.current = true;
    action();
    props.onClose();
  };

  const items: MenuItem[] = [
    { label: t('explorer.graph'), icon: 'network', run: () => props.onOpenGraph?.() },
    { label: t('explorer.plugins'), icon: 'puzzle', run: () => props.onOpenPlugins?.() },
  ];

  return (
    <div ref={menuRef} class="vault-menu explorer-menu" role="group" aria-label={t('explorer.menu')}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          class="vault-menu-item explorer-menu-item"
          onClick={() => run(item.run)}
        >
          <Icon name={item.icon} size={14} />
          <span class="vault-menu-item-name">{item.label}</span>
        </button>
      ))}
    </div>
  );
}
