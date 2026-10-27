import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';

// The session of the vault is the only seam of the interface: the section of
// the security of the settings asks it about the encryption of the storage.
const session = vi.hoisted(() => ({
  createSealedVault: vi.fn(async () => undefined),
  enableRecoveryKey: vi.fn(async () => undefined),
  createRecoveryKey: vi.fn(async () => 'RECOVERY-KEY-0001'),
  unlockVault: vi.fn(async () => undefined),
  lockVault: vi.fn(async () => undefined),
  changePassword: vi.fn(async () => undefined),
  hasRecoveryKey: vi.fn(async () => false),
  integrityCheck: vi.fn(async () => ({ checked: 0, broken: [] as string[] })),
  refreshVaultStatus: vi.fn(async () => ({
    mode: 'sealed',
    format: 1,
    objectCount: 0,
    generations: [],
  })),
  getStorageName: vi.fn(async () => 'Notes'),
  detectVaultMode: vi.fn(async () => 'open'),
  markVaultOpen: vi.fn(),
  markVaultSealed: vi.fn(),
  adoptSealedVault: vi.fn(async () => undefined),
  getSealedVault: vi.fn(() => null),
  getVaultSessionState: vi.fn(() => ({
    mode: 'open' as 'open' | 'sealed',
    locked: false,
    detecting: false,
    formatVersion: 1,
  })),
  subscribeVaultSession: vi.fn(() => () => undefined),
}));

vi.mock('../core/vault/session', () => session);

import { SettingsDialog } from '../components/SettingsDialog';

/** The props of the dialog, with the callback that the test watches. */
function makeProps(overrides: Partial<Parameters<typeof SettingsDialog>[0]> = {}): {
  props: Parameters<typeof SettingsDialog>[0];
  onShowTreeCounts: ReturnType<typeof vi.fn>;
} {
  const onShowTreeCounts = vi.fn();
  const base = {
    open: true,
    onClose: vi.fn(),
    theme: 'light' as const,
    sidebarWidth: 280,
    treeSort: 'name' as const,
    editorFontSize: 15,
    editorWrap: false,
    online: true,
    version: '0.1.0',
    showTreeCounts: true,
    onShowTreeCounts,
    onOpenPlugins: vi.fn(),
    onOpenShortcuts: vi.fn(),
    onOpenTrash: vi.fn(),
    onOpenTransfer: vi.fn(),
  };
  const props = { ...base, ...overrides } as Parameters<typeof SettingsDialog>[0];
  return { props, onShowTreeCounts };
}

describe('the switch of the counters of the tree', () => {
  it('is shown in the dialog', () => {
    const { props } = makeProps();
    render(<SettingsDialog {...props} />);

    expect(screen.getByRole('switch', { name: 'Show the counters of the notes' })).toBeTruthy();
  });

  it('shows that the counters are visible', () => {
    const { props } = makeProps({ showTreeCounts: true });
    render(<SettingsDialog {...props} />);

    const control = screen.getByRole('switch', { name: 'Show the counters of the notes' });
    expect(control.getAttribute('aria-checked')).toBe('true');
  });

  it('shows that the counters are hidden', () => {
    const { props } = makeProps({ showTreeCounts: false });
    render(<SettingsDialog {...props} />);

    const control = screen.getByRole('switch', { name: 'Show the counters of the notes' });
    expect(control.getAttribute('aria-checked')).toBe('false');
  });

  it('calls the callback with the new value', () => {
    const { props, onShowTreeCounts } = makeProps({ showTreeCounts: true });
    render(<SettingsDialog {...props} />);

    fireEvent.click(screen.getByRole('switch', { name: 'Show the counters of the notes' }));
    expect(onShowTreeCounts).toHaveBeenCalledTimes(1);
    expect(onShowTreeCounts).toHaveBeenCalledWith(false);
  });

  it('calls the callback with the new value when the counters are hidden', () => {
    const { props, onShowTreeCounts } = makeProps({ showTreeCounts: false });
    render(<SettingsDialog {...props} />);

    fireEvent.click(screen.getByRole('switch', { name: 'Show the counters of the notes' }));
    expect(onShowTreeCounts).toHaveBeenCalledWith(true);
  });
});
