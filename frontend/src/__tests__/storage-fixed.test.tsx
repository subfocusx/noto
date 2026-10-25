import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { Sidebar } from '../components/Sidebar';
import { VaultSwitchMenu } from '../components/VaultSwitchMenu';
import { appStore } from '../core/store/appStore';
import { STORAGE_FIXED_MESSAGE, STORAGE_FIXED_REASON, STORAGE_FIXED_TITLE } from '../core/storages/fixedStorage';

// The session of the vault is the only seam of the interface: the components
// are tested against it, so the test never touches the crypto core.
vi.mock('../core/vault/session', () => ({
  createSealedVault: vi.fn(async () => undefined),
  enableRecoveryKey: vi.fn(async () => undefined),
  createRecoveryKey: vi.fn(async () => 'RECOVERY-KEY-0001'),
  unlockVault: vi.fn(async () => undefined),
  lockVault: vi.fn(async () => undefined),
  changePassword: vi.fn(async () => undefined),
  hasRecoveryKey: vi.fn(async () => false),
  integrityCheck: vi.fn(async () => ({ checked: 0, broken: [] as string[] })),
  refreshVaultStatus: vi.fn(async () => ({ mode: 'sealed', format: 1, objectCount: 0, generations: [] })),
  getStorageName: vi.fn(async () => 'Notes'),
  getVaultSessionState: vi.fn(() => ({
    mode: 'open' as 'open' | 'sealed',
    locked: false,
    detecting: false,
    formatVersion: 1,
  })),
  subscribeVaultSession: vi.fn(() => () => undefined),
}));

/** Renders the column of the sections with a storage that cannot be changed. */
function renderSidebar(vaultFixed = true) {
  return render(
    <Sidebar
      section="explorer"
      folders={[]}
      filesByParent={new Map()}
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
      vaultName="Notes"
      vaultPath="C:\\notes"
      vaultFixed={vaultFixed}
    />,
  );
}

describe('the storage that is fixed by the environment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    appStore.reset();
  });

  afterEach(() => {
    appStore.reset();
    localStorage.clear();
  });

  it('says in the column that the storage cannot be changed', () => {
    renderSidebar();

    const note = screen.getByTestId('storage-fixed-note');
    expect(note.textContent).toContain('NOTO_VAULT_FIXED');
    expect(note.getAttribute('role')).toBe('note');
  });

  it('explains itself when the user asks why', () => {
    renderSidebar();

    fireEvent.click(screen.getByText('Why can it not be changed?'));

    const banner = appStore.getSnapshot().banner ?? '';
    expect(banner).toContain(STORAGE_FIXED_MESSAGE);
    expect(banner).toContain(STORAGE_FIXED_REASON);
  });

  it('says nothing about the fixed storage when the storage can be changed', () => {
    renderSidebar(false);

    expect(screen.queryByTestId('storage-fixed-note')).toBeNull();
  });

  it('explains itself in the menu of the storage', () => {
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

    const fixed = screen.getByTestId('vault-menu-fixed');
    expect(fixed.textContent).toContain(STORAGE_FIXED_TITLE);
    expect(fixed.textContent).toContain(STORAGE_FIXED_REASON);
    // The menu does not offer to change a storage that cannot be changed.
    expect(screen.queryByText('Choose another folder…')).toBeNull();
  });
});
