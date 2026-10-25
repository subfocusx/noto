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
import {
  VaultSecuritySection,
  securityChangeFailed,
  securityCheckFailed,
  securityRecoveryFailed,
} from '../components/VaultSecuritySection';
import { AUTO_LOCK_MINUTES_DEFAULT, loadPrefs } from '../core/settings/prefs';
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

describe('the section of the security of an encrypted storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    session.getVaultSessionState.mockReturnValue({
      mode: 'sealed',
      locked: false,
      detecting: false,
      formatVersion: 3,
    });
    session.subscribeVaultSession.mockReturnValue(() => undefined);
    session.refreshVaultStatus.mockResolvedValue({
      mode: 'sealed',
      format: 3,
      objectCount: 0,
      generations: [],
    });
    session.hasRecoveryKey.mockResolvedValue(false);
    session.changePassword.mockResolvedValue(undefined);
    session.integrityCheck.mockResolvedValue({ checked: 0, broken: [] as string[] });
    session.createRecoveryKey.mockResolvedValue('RECOVERY-KEY-0001');
    session.enableRecoveryKey.mockResolvedValue(undefined);
  });

  /** Opens the form of the change of the password. */
  function openPasswordForm() {
    fireEvent.click(screen.getByTestId('vault-security-change-password'));
  }

  /** Fills the three fields of the form of the change of the password. */
  function fillPasswordForm(oldPassword: string, newPassword: string, repeat: string) {
    fireEvent.input(screen.getByLabelText('The current password'), { target: { value: oldPassword } });
    fireEvent.input(screen.getByLabelText('The new password'), { target: { value: newPassword } });
    fireEvent.input(screen.getByLabelText('Repeat the new password'), { target: { value: repeat } });
  }

  /** Submits the form of the change of the password. */
  function submitPasswordForm() {
    const form = screen.getByLabelText('The current password').closest('form') as HTMLFormElement;
    fireEvent.submit(form);
  }

  it('opens the form of the change of the password and closes it again', () => {
    render(<VaultSecuritySection />);

    expect(screen.queryByLabelText('The current password')).toBeNull();

    openPasswordForm();
    expect(screen.getByLabelText('The current password')).not.toBeNull();
    expect(screen.getByTestId('vault-security-change-password').textContent).toBe('Cancel');

    // The button closes the form again, and nothing is sent to the backend.
    fireEvent.click(screen.getByTestId('vault-security-change-password'));
    expect(screen.queryByLabelText('The current password')).toBeNull();
    expect(screen.getByTestId('vault-security-change-password').textContent).toBe('Change the password');
    expect(session.changePassword).not.toHaveBeenCalled();
  });

  it('refuses two different new passwords', () => {
    render(<VaultSecuritySection />);
    openPasswordForm();

    fillPasswordForm('the old master password', 'the new master password', 'another new password');
    submitPasswordForm();

    expect(screen.getByTestId('vault-security-password-error').textContent).toBe(
      'The new passwords do not match.',
    );
    expect(session.changePassword).not.toHaveBeenCalled();
  });

  it('refuses a new password that is too short', () => {
    render(<VaultSecuritySection />);
    openPasswordForm();

    // The wizard of the encrypted storage refuses a master password that is
    // shorter than ten characters: the form of the change refuses it too.
    fillPasswordForm('the old master password', 'short', 'short');
    submitPasswordForm();

    expect(screen.getByTestId('vault-security-password-error').textContent).toBe(
      'The master password must have at least 10 characters.',
    );
    expect(session.changePassword).not.toHaveBeenCalled();
  });

  it('changes the master password with the old one and the new one', async () => {
    render(<VaultSecuritySection />);
    openPasswordForm();

    fillPasswordForm('the old master password', 'the new master password', 'the new master password');
    submitPasswordForm();

    await waitFor(() => expect(session.changePassword).toHaveBeenCalledTimes(1));
    expect(session.changePassword).toHaveBeenCalledWith(
      'the old master password',
      'the new master password',
    );

    // The form is closed, the fields are empty again and the success is told.
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('The master password was changed.'));
    openPasswordForm();
    expect((screen.getByLabelText('The current password') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('The new password') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Repeat the new password') as HTMLInputElement).value).toBe('');
  });

  it('shows the error of a refused change of the password', async () => {
    session.changePassword.mockRejectedValue(new Error('wrong password'));
    render(<VaultSecuritySection />);
    openPasswordForm();

    fillPasswordForm('the old master password', 'the new master password', 'the new master password');
    submitPasswordForm();

    await waitFor(() => expect(screen.getByTestId('vault-security-password-error')).not.toBeNull());
    expect(screen.getByTestId('vault-security-password-error').textContent).toBe(securityChangeFailed());
  });

  it('offers the limits of the auto-lock and writes the chosen one into the preferences', () => {
    render(<VaultSecuritySection />);

    const select = screen.getByTestId('vault-security-auto-lock') as HTMLSelectElement;
    const choices = Array.from(select.options).map((option) => option.value);
    expect(choices).toEqual(['1', '5', '15', '30', '60', '120']);
    expect(select.value).toBe(String(AUTO_LOCK_MINUTES_DEFAULT));

    fireEvent.change(select, { target: { value: '30' } });

    expect(loadPrefs().autoLockMinutes).toBe(30);
    expect((screen.getByTestId('vault-security-auto-lock') as HTMLSelectElement).value).toBe('30');
  });

  it('shows the error of a refused integrity check', async () => {
    session.integrityCheck.mockRejectedValue(new Error('the backend is down'));
    render(<VaultSecuritySection />);

    fireEvent.click(screen.getByTestId('vault-security-check'));

    await waitFor(() => expect(screen.getByTestId('vault-security-check-error')).not.toBeNull());
    expect(screen.getByTestId('vault-security-check-error').textContent).toBe(securityCheckFailed());
    expect(screen.queryByTestId('vault-security-check-result')).toBeNull();
  });

  it('shows the progress of the integrity check while the request is pending', () => {
    // The request never answers: the button must stay in the state of the work.
    session.integrityCheck.mockReturnValue(
      new Promise<{ checked: number; broken: string[] }>(() => undefined),
    );
    render(<VaultSecuritySection />);

    fireEvent.click(screen.getByTestId('vault-security-check'));

    const button = screen.getByTestId('vault-security-check') as HTMLButtonElement;
    expect(button.textContent).toBe('Checking…');
    expect(button.disabled).toBe(true);
  });

  it('shows the state of the recovery key', async () => {
    session.hasRecoveryKey.mockResolvedValue(true);
    render(<VaultSecuritySection />);

    await waitFor(() => expect(screen.getByTestId('vault-security-recovery').textContent).toBe('enabled'));
  });

  it('says that the recovery key is not enabled', async () => {
    session.hasRecoveryKey.mockResolvedValue(false);
    render(<VaultSecuritySection />);

    await waitFor(() => expect(screen.getByTestId('vault-security-recovery').textContent).toBe('not enabled'));
  });

  it('does not know the state of the recovery key while the backend does not answer', () => {
    session.hasRecoveryKey.mockReturnValue(new Promise<boolean>(() => undefined));
    render(<VaultSecuritySection />);

    expect(screen.getByTestId('vault-security-recovery').textContent).toBe('unknown');
  });

  it('creates a recovery key and enables it with the master password', async () => {
    render(<VaultSecuritySection />);

    fireEvent.click(screen.getByTestId('vault-security-new-recovery'));

    await waitFor(() => expect(screen.getByTestId('vault-security-recovery-key').textContent).toBe('RECOVERY-KEY-0001'));
    expect(session.createRecoveryKey).toHaveBeenCalledTimes(1);

    fireEvent.input(screen.getByLabelText('The master password'), { target: { value: 'the master password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enable the recovery key' }));

    await waitFor(() => expect(session.enableRecoveryKey).toHaveBeenCalledTimes(1));
    expect(session.enableRecoveryKey).toHaveBeenCalledWith('RECOVERY-KEY-0001', 'the master password');
    await waitFor(() => expect(screen.getByTestId('vault-security-recovery').textContent).toBe('enabled'));
    expect(screen.queryByTestId('vault-security-recovery-key')).toBeNull();
  });

  it('shows the error of a refused recovery key', async () => {
    session.enableRecoveryKey.mockRejectedValue(new Error('wrong password'));
    render(<VaultSecuritySection />);

    fireEvent.click(screen.getByTestId('vault-security-new-recovery'));
    await waitFor(() => expect(screen.getByTestId('vault-security-recovery-key')).not.toBeNull());

    fireEvent.input(screen.getByLabelText('The master password'), { target: { value: 'wrong password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enable the recovery key' }));

    await waitFor(() => expect(screen.getByTestId('vault-security-recovery-error')).not.toBeNull());
    expect(screen.getByTestId('vault-security-recovery-error').textContent).toBe(securityRecoveryFailed());
  });

  it('does not enable a recovery key that was never created', () => {
    render(<VaultSecuritySection />);

    // Without a key there is no form at all: the button cannot be pressed.
    expect(screen.queryByRole('button', { name: 'Enable the recovery key' })).toBeNull();
    expect(session.enableRecoveryKey).not.toHaveBeenCalled();
  });

  it('says that the version of the format is unknown', () => {
    session.getVaultSessionState.mockReturnValue({
      mode: 'sealed',
      locked: false,
      detecting: false,
      formatVersion: 0,
    });
    render(<VaultSecuritySection />);

    expect(screen.getByTestId('vault-security-format').textContent).toBe('unknown');
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

  it('does not throw when the shell offers no wizard of the encryption', () => {
    // The handler is optional: the section must survive a shell that does not
    // offer the wizard yet.
    render(<VaultSecuritySection />);

    expect(() => fireEvent.click(screen.getByTestId('vault-security-setup'))).not.toThrow();
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
