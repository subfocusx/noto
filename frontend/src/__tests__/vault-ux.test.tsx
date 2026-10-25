import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';

// The session of the vault is the only seam of the interface: the components
// are tested against it, so the test never touches the crypto core.
const session = vi.hoisted(() => ({
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
    mode: 'sealed' as 'open' | 'sealed',
    locked: false,
    detecting: false,
    formatVersion: 1,
  })),
  subscribeVaultSession: vi.fn(() => () => undefined),
}));

vi.mock('../core/vault/session', () => session);

import { VaultSetupDialog } from '../components/VaultSetupDialog';
import { VaultUnlockScreen } from '../components/VaultUnlockScreen';
import { VaultSecuritySection } from '../components/VaultSecuritySection';
import { AutoLock } from '../core/vault/autoLock';
import { DEFAULT_KDF_PARAMS, LIGHT_KDF_PARAMS } from '../core/crypto/kdf';
import { KeyUnlockError } from '../core/crypto/errors';

/** Opens the wizard and moves to the step of the password. */
function openWizard() {
  render(<VaultSetupDialog open onClose={() => undefined} onDone={() => undefined} />);
  fireEvent.click(screen.getByTestId('vault-setup-create-new'));
}

/** Types a value into a field of the wizard. */
function type(label: string, value: string) {
  fireEvent.input(screen.getByLabelText(label), { target: { value } });
}

describe('the wizard of the encrypted storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.createRecoveryKey.mockResolvedValue('RECOVERY-KEY-0001');
    session.createSealedVault.mockResolvedValue(undefined);
    session.enableRecoveryKey.mockResolvedValue(undefined);
  });

  it('refuses a password that is too short', () => {
    openWizard();

    type('Master password', 'short');
    type('Repeat the master password', 'short');
    fireEvent.click(screen.getByTestId('vault-setup-next'));

    expect(screen.getByTestId('vault-setup-error').textContent).toMatch(/at least 10 characters/i);
    expect(session.createSealedVault).not.toHaveBeenCalled();
  });

  it('refuses two different passwords', () => {
    openWizard();

    type('Master password', 'a long enough master password');
    type('Repeat the master password', 'another long password');
    fireEvent.click(screen.getByTestId('vault-setup-next'));

    expect(screen.getByTestId('vault-setup-error').textContent).toMatch(/do not match/i);
    expect(session.createSealedVault).not.toHaveBeenCalled();
  });

  it('creates the storage with the password and the chosen parameters', async () => {
    const onDone = vi.fn();
    render(<VaultSetupDialog open onClose={() => undefined} onDone={onDone} />);
    fireEvent.click(screen.getByTestId('vault-setup-create-new'));

    type('Master password', 'a long enough master password');
    type('Repeat the master password', 'a long enough master password');
    fireEvent.click(screen.getByTestId('vault-setup-next'));

    // The warning of the wizard must be accepted.
    fireEvent.click(screen.getByLabelText('I understand that the password cannot be recovered.'));
    fireEvent.click(screen.getByTestId('vault-setup-next'));

    // The recovery key is shown and must be confirmed.
    await waitFor(() => expect(screen.getByTestId('vault-setup-recovery-key').textContent).toBe('RECOVERY-KEY-0001'));
    fireEvent.click(screen.getByLabelText('I saved the recovery key in a safe place.'));
    fireEvent.click(screen.getByTestId('vault-setup-create'));

    await waitFor(() => expect(session.createSealedVault).toHaveBeenCalledTimes(1));
    expect(session.createSealedVault).toHaveBeenCalledWith(
      'a long enough master password',
      expect.objectContaining({ m: DEFAULT_KDF_PARAMS.m, t: DEFAULT_KDF_PARAMS.t }),
    );
    await waitFor(() => expect(session.enableRecoveryKey).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onDone).not.toHaveBeenCalled());
  });

  it('creates the storage with the light parameters when they are chosen', async () => {
    render(<VaultSetupDialog open onClose={() => undefined} onDone={() => undefined} />);
    fireEvent.click(screen.getByTestId('vault-setup-create-new'));

    type('Master password', 'a long enough master password');
    type('Repeat the master password', 'a long enough master password');
    fireEvent.click(screen.getByLabelText('Use the light preset of the derivation'));
    fireEvent.click(screen.getByTestId('vault-setup-next'));
    fireEvent.click(screen.getByLabelText('I understand that the password cannot be recovered.'));
    fireEvent.click(screen.getByTestId('vault-setup-next'));

    await waitFor(() => expect(screen.getByTestId('vault-setup-recovery-key')).not.toBeNull());
    fireEvent.click(screen.getByLabelText('I saved the recovery key in a safe place.'));
    fireEvent.click(screen.getByTestId('vault-setup-create'));

    await waitFor(() => expect(session.createSealedVault).toHaveBeenCalledTimes(1));
    expect(session.createSealedVault).toHaveBeenCalledWith(
      'a long enough master password',
      expect.objectContaining({ m: LIGHT_KDF_PARAMS.m, t: LIGHT_KDF_PARAMS.t }),
    );
  });

  it('shows the recovery key once and waits for the confirmation', async () => {
    openWizard();

    type('Master password', 'a long enough master password');
    type('Repeat the master password', 'a long enough master password');
    fireEvent.click(screen.getByTestId('vault-setup-next'));
    fireEvent.click(screen.getByLabelText('I understand that the password cannot be recovered.'));
    fireEvent.click(screen.getByTestId('vault-setup-next'));

    await waitFor(() => expect(screen.getByTestId('vault-setup-recovery-key').textContent).toBe('RECOVERY-KEY-0001'));

    const create = screen.getByTestId('vault-setup-create') as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect(session.createSealedVault).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('I saved the recovery key in a safe place.'));
    expect((screen.getByTestId('vault-setup-create') as HTMLButtonElement).disabled).toBe(false);
  });

  it('opens the migration instead of migrating the storage itself', () => {
    const onMigrate = vi.fn();
    render(<VaultSetupDialog open onClose={() => undefined} onDone={() => undefined} onMigrate={onMigrate} />);

    fireEvent.click(screen.getByTestId('vault-setup-migrate'));

    expect(onMigrate).toHaveBeenCalledTimes(1);
    expect(session.createSealedVault).not.toHaveBeenCalled();
  });
});

describe('the screen of the locked storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.unlockVault.mockResolvedValue(undefined);
    session.getStorageName.mockResolvedValue('Notes');
  });

  it('shows the friendly error of a wrong password and no technical detail', async () => {
    session.unlockVault.mockRejectedValue(new KeyUnlockError('The master password does not unlock this vault'));
    render(<VaultUnlockScreen onUnlocked={() => undefined} />);

    fireEvent.input(screen.getByLabelText('Master password'), { target: { value: 'wrong password' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Unlock' }).closest('form') as HTMLFormElement);

    await waitFor(() => expect(screen.getByTestId('vault-unlock-error')).not.toBeNull());
    expect(screen.getByTestId('vault-unlock-error').textContent).toBe('Wrong password or damaged storage.');
    expect(document.body.textContent).not.toMatch(/does not unlock/i);
    expect(document.body.textContent).not.toMatch(/keystore/i);
  });

  it('submits the form with the keyboard', async () => {
    const onUnlocked = vi.fn();
    render(<VaultUnlockScreen onUnlocked={onUnlocked} />);

    const field = screen.getByLabelText('Master password') as HTMLInputElement;
    fireEvent.input(field, { target: { value: 'the master password' } });
    fireEvent.submit(field.closest('form') as HTMLFormElement);

    await waitFor(() => expect(session.unlockVault).toHaveBeenCalledWith('the master password'));
    await waitFor(() => expect(onUnlocked).toHaveBeenCalledTimes(1));
  });

  it('gives the focus to the password field', () => {
    render(<VaultUnlockScreen onUnlocked={() => undefined} />);
    expect(document.activeElement).toBe(screen.getByLabelText('Master password'));
  });

  it('hides the password by default and can show it', () => {
    render(<VaultUnlockScreen onUnlocked={() => undefined} />);

    const field = screen.getByLabelText('Master password') as HTMLInputElement;
    expect(field.getAttribute('type')).toBe('password');

    fireEvent.click(screen.getByRole('button', { name: 'Show the master password' }));
    expect((screen.getByLabelText('Master password') as HTMLInputElement).getAttribute('type')).toBe('text');
  });
});

describe('the section of the security in the settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.getVaultSessionState.mockReturnValue({
      mode: 'sealed',
      locked: false,
      detecting: false,
      formatVersion: 3,
    });
    session.subscribeVaultSession.mockReturnValue(() => undefined);
    session.hasRecoveryKey.mockResolvedValue(false);
    session.refreshVaultStatus.mockResolvedValue({
      mode: 'sealed',
      format: 3,
      objectCount: 0,
      generations: [],
    });
  });

  it('shows the mode and the version of the format', async () => {
    render(<VaultSecuritySection />);

    expect(screen.getByTestId('vault-security-mode').textContent).toBe('Encrypted');
    expect(screen.getByTestId('vault-security-format').textContent).toBe('3');
    await waitFor(() => expect(session.refreshVaultStatus).toHaveBeenCalled());
  });

  it('locks the storage on demand', () => {
    render(<VaultSecuritySection />);

    fireEvent.click(screen.getByTestId('vault-security-lock'));
    expect(session.lockVault).toHaveBeenCalledTimes(1);
  });

  it('reports the objects of the integrity check by their id', async () => {
    session.integrityCheck.mockResolvedValue({ checked: 12, broken: ['abc123'] });
    render(<VaultSecuritySection />);

    fireEvent.click(screen.getByTestId('vault-security-check'));

    await waitFor(() => expect(screen.getByTestId('vault-security-check-result')).not.toBeNull());
    expect(screen.getByTestId('vault-security-check-result').textContent).toContain('12');
    expect(screen.getByTestId('vault-security-broken').textContent).toContain('abc123');
  });
});

describe('the settings of an open storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.getVaultSessionState.mockReturnValue({
      mode: 'open',
      locked: false,
      detecting: false,
      formatVersion: 0,
    });
    session.subscribeVaultSession.mockReturnValue(() => undefined);
  });

  it('offers no action of an encrypted storage', () => {
    render(<VaultSecuritySection />);

    // An open storage has no key, no password and no sealed objects: the
    // actions of an encrypted storage have no meaning here.
    expect(screen.queryByTestId('vault-security-lock')).toBeNull();
    expect(screen.queryByTestId('vault-security-change-password')).toBeNull();
    expect(screen.queryByTestId('vault-security-auto-lock')).toBeNull();
    expect(screen.queryByTestId('vault-security-check')).toBeNull();
    expect(screen.queryByTestId('vault-security-recovery')).toBeNull();
    expect(screen.queryByTestId('vault-security-format')).toBeNull();
  });

  it('shows the state of the storage and the wizard of the encryption', () => {
    const onSetUpEncrypted = vi.fn();
    render(<VaultSecuritySection onSetUpEncrypted={onSetUpEncrypted} />);

    expect(screen.getByTestId('vault-security-mode').textContent).toBe('Plain (not encrypted)');

    fireEvent.click(screen.getByTestId('vault-security-setup'));
    expect(onSetUpEncrypted).toHaveBeenCalled();
  });

  it('does not even ask the backend about the format', () => {
    render(<VaultSecuritySection />);

    expect(session.refreshVaultStatus).not.toHaveBeenCalled();
    expect(session.hasRecoveryKey).not.toHaveBeenCalled();
  });
});

describe('the automatic lock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('locks the storage after the timeout', () => {
    const onLock = vi.fn();
    const auto = new AutoLock({ timeoutMs: 1000, onLock });

    auto.start();
    vi.advanceTimersByTime(999);
    expect(onLock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it('postpones the lock when the user is active', () => {
    const onLock = vi.fn();
    const auto = new AutoLock({ timeoutMs: 1000, onLock });

    auto.start();
    vi.advanceTimersByTime(900);
    auto.touch();
    vi.advanceTimersByTime(900);
    expect(onLock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it('does not lock the storage after it was stopped', () => {
    const onLock = vi.fn();
    const auto = new AutoLock({ timeoutMs: 1000, onLock });

    auto.start();
    auto.stop();
    vi.advanceTimersByTime(5000);
    expect(onLock).not.toHaveBeenCalled();
  });
});
