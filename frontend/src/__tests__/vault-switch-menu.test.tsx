// The tests of the quick menu of the storage of the notes.
//
// The menu is presentational: it is rendered with the paths that it shows and
// it tells its host what to do. The tests check the DOM that it produces and
// the way that it closes itself.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { VaultSwitchMenu } from '../components/VaultSwitchMenu';

/** The options of the menu for the tests. */
interface Options {
  currentPath?: string;
  recents?: string[];
  fixed?: boolean;
  onSwitch?: (path: string) => void;
  onBrowse?: () => void;
  onClose?: () => void;
}

/** Renders the menu alone and returns the spies of its callbacks. */
function renderMenu(options: Options = {}) {
  const onSwitch = options.onSwitch ?? vi.fn();
  const onBrowse = options.onBrowse ?? vi.fn();
  const onClose = options.onClose ?? vi.fn();
  const view = render(
    <VaultSwitchMenu
      currentPath={options.currentPath ?? 'C:\\notes'}
      recents={options.recents ?? ['C:\\notes', 'D:\\work']}
      fixed={options.fixed}
      onSwitch={onSwitch}
      onBrowse={onBrowse}
      onClose={onClose}
    />,
  );
  return { view, onSwitch, onBrowse, onClose };
}

/** The entries of the menu, in the order they are shown. */
function itemsOf(container: Element): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('.vault-menu-item'));
}

/** The paths of the recent storages that the menu offers. */
function pathsOf(container: Element): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.vault-menu-item-path')).map(
    (element) => element.textContent ?? '',
  );
}

/**
 * The menu with the button that opens it, as the header of the explorer does.
 *
 * The button is given to the menu as a ref: a press on it must not close the
 * menu, because the button decides whether the menu opens or closes.
 */
function MenuWithTrigger(props: { onClose: () => void }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <div>
      <button ref={triggerRef} type="button">
        Change the storage of the notes
      </button>
      <VaultSwitchMenu
        currentPath={'C:\\notes'}
        recents={['C:\\notes', 'D:\\work']}
        triggerRef={triggerRef}
        onSwitch={() => undefined}
        onBrowse={() => undefined}
        onClose={props.onClose}
      />
    </div>
  );
}

/** The menu and a button that lives outside of it. */
function MenuWithOutsideButton(props: { onClose: () => void }) {
  return (
    <div>
      <button type="button">The notes</button>
      <VaultSwitchMenu
        currentPath={'C:\\notes'}
        recents={['C:\\notes', 'D:\\work']}
        onSwitch={() => undefined}
        onBrowse={() => undefined}
        onClose={props.onClose}
      />
    </div>
  );
}

describe('the quick menu of the storage', () => {
  it('is a menu that names the storage of the notes', () => {
    renderMenu();

    const menu = screen.getByRole('menu', { name: 'Switch the storage of the notes' });
    expect(menu).toBeTruthy();
  });

  it('closes when the user presses Escape', () => {
    const { onClose } = renderMenu();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the user clicks outside of the menu', () => {
    const onClose = vi.fn();
    render(<MenuWithOutsideButton onClose={onClose} />);

    fireEvent.mouseDown(screen.getByRole('button', { name: 'The notes' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays open when the user presses the button that opens it', () => {
    const onClose = vi.fn();
    render(<MenuWithTrigger onClose={onClose} />);

    const trigger = screen.getByRole('button', { name: 'Change the storage of the notes' });
    fireEvent.mouseDown(trigger);

    // The button decides whether the menu opens or closes, so the menu stays.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes when the window loses the focus', () => {
    const { onClose } = renderMenu();

    fireEvent.blur(window);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('gives the focus to the first entry when it opens', () => {
    const { view } = renderMenu();

    const first = itemsOf(view.container)[0];
    expect(first).toBeTruthy();
    expect(document.activeElement).toBe(first);
  });

  it('does not offer the storage that is open now among the recent ones', () => {
    const { view } = renderMenu({ currentPath: 'C:\\notes', recents: ['C:\\notes', 'D:\\work'] });

    // Only the storage that is not the current one is offered.
    expect(pathsOf(view.container)).toEqual(['D:\\work']);
    // No entry of the menu carries the path of the storage that is open now.
    for (const item of itemsOf(view.container)) {
      expect(item.textContent).not.toContain('C:\\notes');
    }
    expect(itemsOf(view.container).length).toBe(2);
  });

  it('names the folder after its last segment, on every system', () => {
    // The path of a storage is a path of the operating system: on Windows the
    // name of the folder is the part behind the last backslash.
    const { view } = renderMenu({ currentPath: 'C:\\notes\\work', recents: [] });

    const name = view.container.querySelector('.vault-menu-current-name');
    expect(name?.textContent).toBe('work');
    // The name is not the whole path again.
    expect(name?.textContent).not.toBe('C:\\notes\\work');
  });

  it('shows the title of the recent storages only when there are some', () => {
    const withRecents = renderMenu({ recents: ['C:\\notes', 'D:\\work'] });
    expect(screen.getByText('Recent')).toBeTruthy();
    // The separator of the recent storages and the one of the picker.
    expect(withRecents.view.container.querySelectorAll('.context-menu-separator').length).toBe(2);
    withRecents.view.unmount();

    const withoutRecents = renderMenu({ recents: ['C:\\notes'] });
    expect(screen.queryByText('Recent')).toBeNull();
    // Only the separator of the picker is left.
    expect(withoutRecents.view.container.querySelectorAll('.context-menu-separator').length).toBe(1);
  });

  it('opens the storage that the user chooses and closes once', () => {
    const { view, onSwitch, onClose } = renderMenu({ recents: ['C:\\notes', 'D:\\work'] });

    const recent = itemsOf(view.container)[0];
    fireEvent.click(recent);

    expect(onSwitch).toHaveBeenCalledWith('D:\\work');
    // The entry closes the menu itself, and the close is not repeated.
    expect(onClose).toHaveBeenCalledTimes(1);
    // A second escape does not close the menu a second time.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('offers the recent storages but no picker when the storage is fixed', () => {
    const { view } = renderMenu({ recents: ['C:\\notes', 'D:\\work'], fixed: true });

    expect(pathsOf(view.container)).toEqual(['D:\\work']);
    // The recent storage is the only entry: the picker is not one.
    expect(itemsOf(view.container).length).toBe(1);
    expect(screen.queryByRole('menuitem', { name: 'Choose another folder…' })).toBeNull();
    expect(screen.getByText('The storage is fixed by the environment')).toBeTruthy();
  });

  it('counts the recent storages and the picker in the entries of the menu', () => {
    const { view } = renderMenu({ recents: ['C:\\notes', 'D:\\work', 'E:\\archive'] });

    // The current storage is not offered again: two recent ones and the picker.
    expect(itemsOf(view.container).length).toBe(3);
  });

  it('leaves no listener on the window when it is unmounted', () => {
    const { view, onClose } = renderMenu();
    view.unmount();

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.mouseDown(document.body);
    fireEvent.blur(window);

    expect(onClose).not.toHaveBeenCalled();
  });
});
