import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';

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

// The shell of the application talks to the backend through the single client.
vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error {},
  getTree: async () => ({
    folders: [],
    files: [],
  }),
  getNote: async (path: string) => ({
    path,
    content: '# hello',
    revision: 1,
    updatedAt: new Date(0).toISOString(),
    conflict: false,
  }),
  saveNote: async (path: string) => ({ path, revision: 2, updatedAt: '' }),
  createFolder: async () => ({}),
  createFile: async () => ({}),
  renameNote: async () => ({}),
  moveNote: async () => ({}),
  deleteNote: async () => ({ ok: true }),
  search: async () => [],
  listAttachments: async () => [],
  getTrash: async () => ({ entries: [] }),
  restoreNote: async () => ({}),
  importFiles: async () => ({ imported: [], skipped: [], errors: [] }),
  importZip: async () => ({ imported: [], skipped: [], errors: [] }),
  uploadAttachment: async () => ({}),
  deleteAttachment: async () => ({ ok: true }),
  exportNoteUrl: (path: string) => `/api/export/note?path=${path}`,
  exportFolderUrl: (path: string) => `/api/export/folder?path=${path}`,
  exportAllUrl: () => '/api/export/all',
  attachmentRawUrl: (id: string) => `/api/attachments/${id}/raw`,
  getVault: vi.fn(async () => ({ configured: true, path: 'C:\\notes', notesDir: 'C:\\notes' })),
  setVault: vi.fn(async () => ({ ok: true, path: 'C:\\notes' })),
  browseVault: vi.fn(async () => ({ path: 'C:\\', parent: '', dirs: [] })),
}));

import { SettingsDialog } from '../components/SettingsDialog';
import { App } from '../App';

/** The props of the dialog, with the callbacks that the tests watch. */
interface Handlers {
  onClose: ReturnType<typeof vi.fn>;
  onTheme: ReturnType<typeof vi.fn>;
  onSidebarWidth: ReturnType<typeof vi.fn>;
  onTreeSort: ReturnType<typeof vi.fn>;
  onEditorFontSize: ReturnType<typeof vi.fn>;
  onEditorWrap: ReturnType<typeof vi.fn>;
  onOpenPlugins: ReturnType<typeof vi.fn>;
  onOpenShortcuts: ReturnType<typeof vi.fn>;
  onOpenTrash: ReturnType<typeof vi.fn>;
  onOpenTransfer: ReturnType<typeof vi.fn>;
  onSetUpEncrypted: ReturnType<typeof vi.fn>;
}

/** The props of a dialog of the settings, with the callbacks that are watched. */
function makeProps(overrides: Partial<Parameters<typeof SettingsDialog>[0]> = {}): {
  props: Parameters<typeof SettingsDialog>[0];
  handlers: Handlers;
} {
  const handlers: Handlers = {
    onClose: vi.fn(),
    onTheme: vi.fn(),
    onSidebarWidth: vi.fn(),
    onTreeSort: vi.fn(),
    onEditorFontSize: vi.fn(),
    onEditorWrap: vi.fn(),
    onOpenPlugins: vi.fn(),
    onOpenShortcuts: vi.fn(),
    onOpenTrash: vi.fn(),
    onOpenTransfer: vi.fn(),
    onSetUpEncrypted: vi.fn(),
  };
  const props = {
    open: true,
    theme: 'light' as const,
    sidebarWidth: 280,
    treeSort: 'name' as const,
    editorFontSize: 15,
    editorWrap: false,
    online: true,
    version: '0.1.0',
    ...handlers,
    ...overrides,
  };
  return { props, handlers };
}

describe('the dialog of the settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.getVaultSessionState.mockReturnValue({
      mode: 'open',
      locked: false,
      detecting: false,
      formatVersion: 1,
    });
    session.subscribeVaultSession.mockReturnValue(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is not rendered when it is closed', () => {
    const { props } = makeProps({ open: false });
    render(<SettingsDialog {...props} />);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is a dialog when it is open', () => {
    const { props } = makeProps();
    render(<SettingsDialog {...props} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-label')).toBe('Settings');
  });

  it('closes on the button of the header', () => {
    const { props, handlers } = makeProps();
    render(<SettingsDialog {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on the button of the footer', () => {
    const { props, handlers } = makeProps();
    render(<SettingsDialog {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('changes the theme of the application', () => {
    const { props, handlers } = makeProps();
    render(<SettingsDialog {...props} />);

    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'dark' } });
    expect(handlers.onTheme).toHaveBeenCalledWith('dark');
  });

  it('changes the width of the sidebar', () => {
    const { props, handlers } = makeProps();
    render(<SettingsDialog {...props} />);

    fireEvent.input(screen.getByLabelText('Sidebar width'), { target: { value: '320' } });
    expect(handlers.onSidebarWidth).toHaveBeenCalledWith(320);
  });

  it('changes the size of the text of the editor', () => {
    const { props, handlers } = makeProps();
    render(<SettingsDialog {...props} />);

    fireEvent.input(screen.getByLabelText('Font size'), { target: { value: '17' } });
    expect(handlers.onEditorFontSize).toHaveBeenCalledWith(17);
  });

  it('switches the wrapping of the lines of the editor', () => {
    const { props, handlers } = makeProps();
    render(<SettingsDialog {...props} />);

    const wrap = screen.getByRole('switch', { name: 'Wrap the lines' });
    expect(wrap.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(wrap);
    expect(handlers.onEditorWrap).toHaveBeenCalledWith(true);
  });

  it('changes the order of the notes of the tree', () => {
    const { props, handlers } = makeProps();
    render(<SettingsDialog {...props} />);

    fireEvent.change(screen.getByLabelText('Order of the notes'), { target: { value: 'modified' } });
    expect(handlers.onTreeSort).toHaveBeenCalledWith('modified');
  });

  it('opens the manager of the plugins', () => {
    const { props, handlers } = makeProps();
    render(<SettingsDialog {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Manage the plugins' }));
    expect(handlers.onOpenPlugins).toHaveBeenCalledTimes(1);
  });

  it('opens the list of the keyboard shortcuts', () => {
    const { props, handlers } = makeProps();
    render(<SettingsDialog {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Show the shortcuts' }));
    expect(handlers.onOpenShortcuts).toHaveBeenCalledTimes(1);
  });

  it('opens the trash', () => {
    const { props, handlers } = makeProps();
    render(<SettingsDialog {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open the trash' }));
    expect(handlers.onOpenTrash).toHaveBeenCalledTimes(1);
  });

  it('opens the panel of the import and the export', () => {
    const { props, handlers } = makeProps();
    render(<SettingsDialog {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Import and export' }));
    expect(handlers.onOpenTransfer).toHaveBeenCalledTimes(1);
  });

  it('shows the version and the state of the connection', () => {
    const { props } = makeProps({ version: '1.2.3', online: false });
    render(<SettingsDialog {...props} />);

    expect(screen.getByText('1.2.3')).toBeTruthy();
    expect(screen.getByText('Offline')).toBeTruthy();
  });
});

describe('the section of the security in the dialog of the settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.subscribeVaultSession.mockReturnValue(() => undefined);
  });

  it('offers the wizard of the encryption when the storage is open', () => {
    session.getVaultSessionState.mockReturnValue({
      mode: 'open',
      locked: false,
      detecting: false,
      formatVersion: 0,
    });
    const { props, handlers } = makeProps();
    render(<SettingsDialog {...props} />);

    expect(screen.getByTestId('vault-security-mode').textContent).toBe('Plain (not encrypted)');
    expect(screen.queryByTestId('vault-security-lock')).toBeNull();

    fireEvent.click(screen.getByTestId('vault-security-setup'));
    expect(handlers.onSetUpEncrypted).toHaveBeenCalledTimes(1);
  });

  it('offers the lock and no wizard when the storage is encrypted', () => {
    session.getVaultSessionState.mockReturnValue({
      mode: 'sealed',
      locked: false,
      detecting: false,
      formatVersion: 3,
    });
    const { props } = makeProps();
    render(<SettingsDialog {...props} />);

    expect(screen.getByTestId('vault-security-mode').textContent).toBe('Encrypted');
    expect(screen.getByTestId('vault-security-lock')).toBeTruthy();
    expect(screen.queryByTestId('vault-security-setup')).toBeNull();
  });
});

describe('the shell of the application', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.getVaultSessionState.mockReturnValue({
      mode: 'open',
      locked: false,
      detecting: false,
      formatVersion: 0,
    });
    session.subscribeVaultSession.mockReturnValue(() => undefined);
    session.detectVaultMode.mockResolvedValue('open');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('closes the settings and opens the wizard of the encryption', async () => {
    // The dialog itself is a view: the shell closes it and shows the wizard.
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('file-tree')).toBeTruthy());

    fireEvent.click(screen.getByTestId('rail-settings'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy());

    fireEvent.click(screen.getByTestId('vault-security-setup'));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull());
    // The wizard is loaded lazily: the chunk arrives a moment later, and the
    // whole suite may be slow.
    await waitFor(() => expect(screen.getByTestId('vault-setup')).toBeTruthy(), { timeout: 5000 });
  });
});
