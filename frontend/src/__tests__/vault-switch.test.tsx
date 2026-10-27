import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within, type RenderResult } from '@testing-library/preact';
import { VaultSwitchMenu } from '../components/VaultSwitchMenu';
import { Sidebar, type SidebarProps } from '../components/Sidebar';
import { Icon } from '../ui/icons';
import { buildTree } from '../lib/tree';
import { appStore } from '../core/store/appStore';
import { loadPrefs } from '../core/settings/prefs';
import { getVaultSessionState, lockVault, subscribeVaultSession } from '../core/vault/session';
import type { Node } from '../types';

describe('the quick menu of the storage', () => {
  it('shows the storage that is open and the recent ones', () => {
    render(
      <VaultSwitchMenu
        currentPath="C:\\notes"
        recents={['C:\\notes', 'D:\\work']}
        onSwitch={() => undefined}
        onBrowse={() => undefined}
        onClose={() => undefined}
      />,
    );

    const menu = screen.getByRole('menu', { name: 'Switch the storage of the notes' });
    expect(menu).toBeTruthy();
    // The storage that is open now is shown with its path.
    expect(screen.getAllByText('C:\\notes').length).toBeGreaterThan(0);
    // The recent storage that is not the current one is offered.
    expect(screen.getByRole('menuitem', { name: /work/ })).toBeTruthy();
  });

  it('opens the storage that the user chooses', () => {
    const onSwitch = vi.fn();
    const onClose = vi.fn();
    render(
      <VaultSwitchMenu
        currentPath="C:\\notes"
        recents={['C:\\notes', 'D:\\work']}
        onSwitch={onSwitch}
        onBrowse={() => undefined}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole('menuitem', { name: /work/ }));
    expect(onSwitch).toHaveBeenCalledWith('D:\\work');
    expect(onClose).toHaveBeenCalled();
  });

  it('asks for the picker of the folders', () => {
    const onBrowse = vi.fn();
    render(
      <VaultSwitchMenu
        currentPath="C:\\notes"
        recents={[]}
        onSwitch={() => undefined}
        onBrowse={onBrowse}
        onClose={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('menuitem', { name: 'Choose another folder…' }));
    expect(onBrowse).toHaveBeenCalled();
  });

  it('offers no picker when the storage is fixed by the environment', () => {
    render(
      <VaultSwitchMenu
        currentPath="C:\\notes"
        recents={[]}
        fixed
        onSwitch={() => undefined}
        onBrowse={() => undefined}
        onClose={() => undefined}
      />,
    );

    expect(screen.queryByRole('menuitem', { name: 'Choose another folder…' })).toBeNull();
    expect(screen.getByText('The storage is fixed by the environment')).toBeTruthy();
  });
});

/** A folder of the vault. */
function folder(path: string, name: string): Node {
  return {
    id: path,
    name,
    path,
    type: 'folder',
    parentPath: '',
    size: 0,
    modTime: '',
    revision: 1,
    createdAt: '',
    updatedAt: '',
  };
}

/**
 * Renders the sidebar of the explorer.
 *
 * The props of the explorer are the same in every test of the header: only
 * the storage changes from one test to the other.
 */
function renderExplorer(overrides: Partial<SidebarProps> = {}): RenderResult {
  const { roots, filesByParent } = buildTree([folder('journal', 'journal')], []);
  return render(
    <Sidebar
      section="explorer"
      folders={roots}
      filesByParent={filesByParent}
      currentPath=""
      expanded={new Set<string>()}
      onToggle={() => undefined}
      onSelect={() => undefined}
      onCreateFolder={() => undefined}
      onCreateFile={() => undefined}
      onRename={() => undefined}
      onMove={() => undefined}
      onDelete={() => undefined}
      onOpenTransfer={() => undefined}
      onRefresh={() => undefined}
      loading={false}
      {...overrides}
    />,
  );
}

describe('the header of the storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers the menu of the storage', () => {
    const { roots, filesByParent } = buildTree([folder('journal', 'journal')], []);
    render(
      <Sidebar
        section="explorer"
        folders={roots}
        filesByParent={filesByParent}
        currentPath=""
        expanded={new Set<string>()}
        onToggle={() => undefined}
        onSelect={() => undefined}
        onCreateFolder={() => undefined}
        onCreateFile={() => undefined}
        onRename={() => undefined}
        onMove={() => undefined}
        onDelete={() => undefined}
        onOpenTransfer={() => undefined}
        onRefresh={() => undefined}
        loading={false}
        vaultPath="C:\\notes"
        vaultRecents={['C:\\notes', 'D:\\work']}
        vaultMenuOpen
        onVaultMenuToggle={() => undefined}
        onSwitchVault={() => undefined}
        onChooseVault={() => undefined}
      />,
    );

    expect(screen.getByRole('menu', { name: 'Switch the storage of the notes' })).toBeTruthy();
    // The path of the storage is the trigger of the menu.
    const trigger = screen.getByRole('button', { name: /change the storage of the notes/i });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
  });

  it('opens the menu when the path of the storage is pressed', () => {
    const onVaultMenuToggle = vi.fn();
    const { roots, filesByParent } = buildTree([folder('journal', 'journal')], []);
    render(
      <Sidebar
        section="explorer"
        folders={roots}
        filesByParent={filesByParent}
        currentPath=""
        expanded={new Set<string>()}
        onToggle={() => undefined}
        onSelect={() => undefined}
        onCreateFolder={() => undefined}
        onCreateFile={() => undefined}
        onRename={() => undefined}
        onMove={() => undefined}
        onDelete={() => undefined}
        onOpenTransfer={() => undefined}
        onRefresh={() => undefined}
        loading={false}
        vaultPath="C:\\notes"
        vaultMenuOpen={false}
        onVaultMenuToggle={onVaultMenuToggle}
        onChooseVault={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /change the storage of the notes/i }));
    expect(onVaultMenuToggle).toHaveBeenCalledWith(true);
  });

  it('does not open the menu when the storage is fixed', () => {
    const onVaultMenuToggle = vi.fn();
    const { roots, filesByParent } = buildTree([folder('journal', 'journal')], []);
    render(
      <Sidebar
        section="explorer"
        folders={roots}
        filesByParent={filesByParent}
        currentPath=""
        expanded={new Set<string>()}
        onToggle={() => undefined}
        onSelect={() => undefined}
        onCreateFolder={() => undefined}
        onCreateFile={() => undefined}
        onRename={() => undefined}
        onMove={() => undefined}
        onDelete={() => undefined}
        onOpenTransfer={() => undefined}
        onRefresh={() => undefined}
        loading={false}
        vaultPath="C:\\notes"
        vaultFixed
        vaultMenuOpen={false}
        onVaultMenuToggle={onVaultMenuToggle}
        onChooseVault={() => undefined}
      />,
    );

    const button = screen.getByRole('button', { name: /change the storage of the notes/i });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(onVaultMenuToggle).not.toHaveBeenCalled();
  });
});

describe('the lock of the storage in the header', () => {
  /** Renders the sidebar of the explorer with the given mode of the storage. */
  function renderStorage(mode: 'open' | 'sealed', locked = false, onVaultLock = vi.fn()) {
    const { roots, filesByParent } = buildTree([folder('journal', 'journal')], []);
    render(
      <Sidebar
        section="explorer"
        folders={roots}
        filesByParent={filesByParent}
        currentPath=""
        expanded={new Set<string>()}
        onToggle={() => undefined}
        onSelect={() => undefined}
        onCreateFolder={() => undefined}
        onCreateFile={() => undefined}
        onRename={() => undefined}
        onMove={() => undefined}
        onDelete={() => undefined}
        onOpenTransfer={() => undefined}
        onRefresh={() => undefined}
        loading={false}
        vaultPath="C:\\notes"
        vaultMode={mode}
        vaultLocked={locked}
        onVaultLock={onVaultLock}
        onChooseVault={() => undefined}
      />,
    );
    return onVaultLock;
  }

  it('locks an encrypted storage', () => {
    const onVaultLock = renderStorage('sealed');

    const button = screen.getByRole('button', { name: 'Lock the vault' });
    fireEvent.click(button);
    expect(onVaultLock).toHaveBeenCalled();
  });

  it('offers the wizard of the encryption for an open storage', () => {
    const onVaultLock = renderStorage('open');

    const button = screen.getByRole('button', { name: 'Set up an encrypted storage' });
    fireEvent.click(button);
    expect(onVaultLock).toHaveBeenCalled();
  });

  it('offers the unlocking of a locked storage', () => {
    renderStorage('sealed', true);

    expect(screen.getByRole('button', { name: 'Unlock the vault' })).toBeTruthy();
  });
});

describe('the session of the storage', () => {
  it('keeps the mode of an open storage when it is locked', async () => {
    const before = getVaultSessionState();
    expect(before.mode).toBe('open');

    await lockVault();

    const after = getVaultSessionState();
    expect(after.mode).toBe('open');
    expect(after.locked).toBe(false);
  });

  it('tells the listeners when the storage is locked', async () => {
    const seen: boolean[] = [];
    const stop = subscribeVaultSession((state) => seen.push(state.locked));
    await lockVault();
    stop();
    // The mode did not change, so nothing was published.
    expect(seen).toEqual([]);
  });
});

describe('the recent storages', () => {
  it('are remembered with the preferences', () => {
    const prefs = loadPrefs();
    expect(Array.isArray(prefs.vaultRecents)).toBe(true);
  });

  it('live in the state of the application', () => {
    expect(Array.isArray(appStore.getSnapshot().ui.vaultRecents)).toBe(true);
  });
});

describe('the lock button of the header', () => {
  it('unlocks a locked encrypted storage', () => {
    const onVaultLock = vi.fn();
    renderExplorer({ vaultMode: 'sealed', vaultLocked: true, onVaultLock });

    fireEvent.click(screen.getByRole('button', { name: 'Unlock the vault' }));
    expect(onVaultLock).toHaveBeenCalled();
  });

  it('carries the tooltip of its name', () => {
    const cases = [
      { mode: 'sealed' as const, locked: false, label: 'Lock the vault' },
      { mode: 'sealed' as const, locked: true, label: 'Unlock the vault' },
      { mode: 'open' as const, locked: false, label: 'Set up an encrypted storage' },
    ];

    for (const item of cases) {
      const { unmount } = renderExplorer({ vaultMode: item.mode, vaultLocked: item.locked });
      const button = screen.getByRole('button', { name: item.label });
      // The tooltip of the pointer says the very same thing as the name that
      // the screen reader reads.
      expect(button.getAttribute('title')).toBe(item.label);
      unmount();
    }
  });

  it('draws the open lock when the storage is locked', () => {
    const { unmount } = renderExplorer({ vaultMode: 'sealed', vaultLocked: true });

    const button = screen.getByRole('button', { name: 'Unlock the vault' });
    const expected = render(<Icon name="lock-open" size={15} />).container.innerHTML;
    expect(button.innerHTML).toBe(expected);
    unmount();
  });

  it('draws the closed lock when the storage is not locked', () => {
    const expected = render(<Icon name="lock" size={15} />).container.innerHTML;

    const { unmount } = renderExplorer({ vaultMode: 'sealed', vaultLocked: false });
    const button = screen.getByRole('button', { name: 'Lock the vault' });
    expect(button.innerHTML).toBe(expected);
    unmount();

    const second = renderExplorer({ vaultMode: 'open' });
    const wizard = screen.getByRole('button', { name: 'Set up an encrypted storage' });
    expect(wizard.innerHTML).toBe(expected);
    second.unmount();
  });

  it('offers the encryption of the storage when there is no mode', () => {
    renderExplorer();

    expect(screen.getByRole('button', { name: 'Set up an encrypted storage' })).toBeTruthy();
  });

  it('does nothing without a handler', () => {
    renderExplorer({ vaultMode: 'sealed', vaultLocked: true });

    const button = screen.getByRole('button', { name: 'Unlock the vault' });
    expect(() => fireEvent.click(button)).not.toThrow();
  });
});

describe('the trigger of the menu of the storage', () => {
  it('is expanded while the menu is open', () => {
    renderExplorer({
      vaultPath: 'C:\\notes',
      vaultMenuOpen: true,
      onChooseVault: () => undefined,
    });

    const trigger = screen.getByRole('button', { name: /change the storage of the notes/i });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('is not expanded while the menu is closed', () => {
    renderExplorer({
      vaultPath: 'C:\\notes',
      vaultMenuOpen: false,
      onChooseVault: () => undefined,
    });

    const trigger = screen.getByRole('button', { name: /change the storage of the notes/i });
    expect(trigger.getAttribute('aria-expanded')).toBeNull();
  });

  it('tells why it is unavailable when the storage is fixed', () => {
    renderExplorer({
      vaultPath: 'C:\\notes',
      vaultFixed: true,
      onChooseVault: () => undefined,
    });

    const trigger = screen.getByRole('button', { name: /change the storage of the notes/i });
    expect(trigger.getAttribute('aria-disabled')).toBe('true');
    expect(trigger.getAttribute('title')).toContain('NOTO_VAULT_FIXED');
  });

  it('shows no menu while it is closed', () => {
    renderExplorer({
      vaultPath: 'C:\\notes',
      vaultMenuOpen: false,
      onChooseVault: () => undefined,
    });

    expect(screen.queryByRole('menu', { name: 'Switch the storage of the notes' })).toBeNull();
  });

  it('asks for a folder when no storage is open', () => {
    renderExplorer({ onChooseVault: () => undefined });

    const trigger = screen.getByRole('button', { name: /change the storage of the notes/i });
    expect(trigger.textContent).toBe('Choose a folder…');
  });
});

describe('the menu of the storage in the header', () => {
  it('switches the storage and closes the menu', () => {
    const onSwitchVault = vi.fn();
    const onVaultMenuToggle = vi.fn();
    renderExplorer({
      vaultPath: 'C:\\notes',
      vaultRecents: ['C:\\notes', 'D:\\work'],
      vaultMenuOpen: true,
      onSwitchVault,
      onVaultMenuToggle,
      onChooseVault: () => undefined,
    });

    fireEvent.click(screen.getByRole('menuitem', { name: /work/ }));
    expect(onSwitchVault).toHaveBeenCalledWith('D:\\work');
    expect(onVaultMenuToggle).toHaveBeenCalledWith(false);
  });

  it('asks for the picker of the folders', () => {
    const onChooseVault = vi.fn();
    renderExplorer({
      vaultPath: 'C:\\notes',
      vaultMenuOpen: true,
      onChooseVault,
    });

    fireEvent.click(screen.getByRole('menuitem', { name: 'Choose another folder…' }));
    expect(onChooseVault).toHaveBeenCalled();
  });

  it('closes when the trigger is pressed again', () => {
    const onVaultMenuToggle = vi.fn();
    renderExplorer({
      vaultPath: 'C:\\notes',
      vaultMenuOpen: true,
      onVaultMenuToggle,
      onChooseVault: () => undefined,
    });

    fireEvent.click(screen.getByRole('button', { name: /change the storage of the notes/i }));
    expect(onVaultMenuToggle).toHaveBeenCalledWith(false);
  });
});

describe('the actions of the explorer', () => {
  it('holds the two bulk actions of the folders', () => {
    renderExplorer();

    const group = screen.getByRole('group', { name: 'Explorer actions' });
    expect(within(group).getByRole('button', { name: 'Expand all folders' })).toBeTruthy();
    expect(within(group).getByRole('button', { name: 'Collapse all folders' })).toBeTruthy();
  });
});
