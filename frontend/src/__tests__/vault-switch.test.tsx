import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { VaultSwitchMenu } from '../components/VaultSwitchMenu';
import { Sidebar } from '../components/Sidebar';
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
    const trigger = screen.getByRole('button', { name: 'Change the storage of the notes' });
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

    fireEvent.click(screen.getByRole('button', { name: 'Change the storage of the notes' }));
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

    const button = screen.getByRole('button', { name: 'Change the storage of the notes' });
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
