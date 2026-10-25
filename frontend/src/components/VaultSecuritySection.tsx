// The section of the settings that belongs to the encrypted storage.
//
// The section is a view over the session of the vault: it shows the state of
// the encryption and it offers the actions that belong to it (lock now, change
// the password, the auto-lock, the integrity check and the recovery key).
//
// The section never touches the key material and never shows a note: the
// integrity check reports the broken objects by their id, never by a title.
import { useEffect, useState } from 'preact/hooks';
import {
  changePassword,
  createRecoveryKey,
  enableRecoveryKey,
  getVaultSessionState,
  hasRecoveryKey,
  integrityCheck,
  lockVault,
  refreshVaultStatus,
  subscribeVaultSession,
  type VaultSessionState,
} from '../core/vault/session';
import { AUTO_LOCK_MINUTES_DEFAULT, loadPrefs, savePrefs } from '../core/settings/prefs';
import { Icon } from '../ui/icons';

/** The number of minutes the user can choose for the auto-lock. */
const AUTO_LOCK_CHOICES = [1, 5, 15, 30, 60, 120];

/** The message of a failed change of the password. */
export const SECURITY_CHANGE_FAILED = 'The password was not changed. Check the old password.';

/** The message of a failed integrity check. */
export const SECURITY_CHECK_FAILED = 'The integrity check could not be run.';

/** The message of a failed recovery key. */
export const SECURITY_RECOVERY_FAILED = 'The recovery key was not enabled. Check the password.';

/**
 * The props of the section.
 *
 * The section itself is a view over the session of the vault; the only thing it
 * asks from the shell is the wizard of the encrypted storage, which lives
 * outside of the dialog of the settings.
 */
export interface VaultSecuritySectionProps {
  /** Called when the user asks to encrypt the storage. */
  onSetUpEncrypted?(): void;
}

/** The modes of the storage, as the interface names them. */
const MODE_LABELS: Record<VaultSessionState['mode'], string> = {
  open: 'Plain (not encrypted)',
  sealed: 'Encrypted',
};

/**
 * The section of the settings of the encrypted storage.
 *
 * The section follows the mode of the storage: an open storage has no key, no
 * password and no sealed objects, so the actions that belong to an encrypted
 * storage are not offered at all. An open storage offers the wizard instead.
 */
export function VaultSecuritySection(props: VaultSecuritySectionProps) {
  const [session, setSession] = useState<VaultSessionState>(() => getVaultSessionState());
  const [lockMinutes, setLockMinutes] = useState<number>(
    () => loadPrefs().autoLockMinutes ?? AUTO_LOCK_MINUTES_DEFAULT,
  );

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPassword2, setNewPassword2] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordDone, setPasswordDone] = useState(false);

  const [checkBusy, setCheckBusy] = useState(false);
  const [checkResult, setCheckResult] = useState<{ checked: number; broken: string[] } | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  const [recoveryEnabled, setRecoveryEnabled] = useState<boolean | null>(null);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  // The section follows the state of the session.
  useEffect(() => subscribeVaultSession(setSession), []);

  // Only an encrypted storage has a format, a keystore and sealed objects: an
  // open storage must not even load the crypto core.
  const sealed = session.mode === 'sealed';

  // The version of the format of the storage comes from the backend.
  useEffect(() => {
    if (!sealed) return;
    void refreshVaultStatus().catch(() => undefined);
  }, [sealed]);

  // The recovery key of the keystore is asked once.
  useEffect(() => {
    if (!sealed) return;
    let cancelled = false;
    void hasRecoveryKey().then((enabled) => {
      if (!cancelled) setRecoveryEnabled(enabled);
    });
    return () => {
      cancelled = true;
    };
  }, [sealed]);

  const lockNow = () => {
    void lockVault();
  };

  const changeThePassword = async () => {
    if (!newPassword || newPassword !== newPassword2) {
      setPasswordError('The new passwords do not match.');
      return;
    }
    setPasswordError(null);
    try {
      await changePassword(oldPassword, newPassword);
      setOldPassword('');
      setNewPassword('');
      setNewPassword2('');
      setPasswordDone(true);
      setShowPasswordForm(false);
    } catch {
      setPasswordError(SECURITY_CHANGE_FAILED);
    }
  };

  const runCheck = async () => {
    setCheckBusy(true);
    setCheckError(null);
    try {
      const result = await integrityCheck();
      setCheckResult(result);
    } catch {
      setCheckError(SECURITY_CHECK_FAILED);
    } finally {
      setCheckBusy(false);
    }
  };

  const generateRecoveryKey = async () => {
    setRecoveryError(null);
    try {
      const key = await createRecoveryKey();
      setRecoveryKey(key);
    } catch {
      setRecoveryError(SECURITY_RECOVERY_FAILED);
    }
  };

  const enableRecovery = async () => {
    if (!recoveryKey) return;
    setRecoveryError(null);
    try {
      await enableRecoveryKey(recoveryKey, recoveryPassword);
      setRecoveryEnabled(true);
      setRecoveryKey('');
      setRecoveryPassword('');
    } catch {
      setRecoveryError(SECURITY_RECOVERY_FAILED);
    }
  };

  const onAutoLockChange = (minutes: number) => {
    setLockMinutes(minutes);
    savePrefs({ ...loadPrefs(), autoLockMinutes: minutes });
  };

  return (
    <section class="settings-group" aria-label="Security">
      <h3>Security</h3>

      <div class="settings-row">
        <div class="settings-row-label">
          <span>Encryption</span>
          <span>The state of the storage of the notes</span>
        </div>
        <span data-testid="vault-security-mode">{MODE_LABELS[session.mode]}</span>
      </div>

      {sealed ? (
        <div class="settings-row">
          <div class="settings-row-label">
            <span>Format version</span>
            <span>The version of the format of the encrypted storage</span>
          </div>
          <span data-testid="vault-security-format">
            {session.formatVersion > 0 ? session.formatVersion : 'unknown'}
          </span>
        </div>
      ) : null}

      {sealed ? (
        <div class="settings-row">
          <div class="settings-row-label">
            <span>Lock now</span>
            <span>Forgets the key of the storage in this tab</span>
          </div>
          <button type="button" class="text-button" onClick={lockNow} data-testid="vault-security-lock">
            Lock now
          </button>
        </div>
      ) : null}

      {sealed ? (
        <div class="settings-row">
          <div class="settings-row-label">
            <span>Change the password</span>
            <span>The notes stay encrypted with the same key</span>
          </div>
          <button
            type="button"
            class="text-button"
            onClick={() => {
              setShowPasswordForm(!showPasswordForm);
              setPasswordError(null);
              setPasswordDone(false);
            }}
            data-testid="vault-security-change-password"
          >
            {showPasswordForm ? 'Cancel' : 'Change the password'}
          </button>
        </div>
      ) : null}

      {sealed && showPasswordForm ? (
        <form
          class="vault-inline-form"
          aria-label="Change the master password"
          onSubmit={(event) => {
            event.preventDefault();
            void changeThePassword();
          }}
        >
          <label class="field vault-field">
            <span class="field-label">The current password</span>
            <input
              class="input"
              type="password"
              value={oldPassword}
              autocomplete="current-password"
              aria-label="The current password"
              onInput={(event) => setOldPassword((event.target as HTMLInputElement).value)}
            />
          </label>

          <label class="field vault-field">
            <span class="field-label">The new password</span>
            <input
              class="input"
              type="password"
              value={newPassword}
              autocomplete="new-password"
              aria-label="The new password"
              onInput={(event) => setNewPassword((event.target as HTMLInputElement).value)}
            />
          </label>

          <label class="field vault-field">
            <span class="field-label">Repeat the new password</span>
            <input
              class="input"
              type="password"
              value={newPassword2}
              autocomplete="new-password"
              aria-label="Repeat the new password"
              onInput={(event) => setNewPassword2((event.target as HTMLInputElement).value)}
            />
          </label>

          {passwordError ? (
            <p class="error-text" role="alert" data-testid="vault-security-password-error">
              {passwordError}
            </p>
          ) : null}

          <div class="button-row">
            <button type="submit" class="primary-button">
              Change the password
            </button>
          </div>
        </form>
      ) : null}

      {sealed && passwordDone ? (
        <p class="vault-ok-text" role="status">
          The master password was changed.
        </p>
      ) : null}

      {sealed ? (
        <div class="settings-row">
          <div class="settings-row-label">
            <span>Auto-lock</span>
            <span>Locks the storage after this many minutes without activity</span>
          </div>
          <select
            aria-label="Auto-lock after N minutes"
            value={String(lockMinutes)}
            onChange={(event) => onAutoLockChange(Number((event.target as HTMLSelectElement).value))}
            data-testid="vault-security-auto-lock"
          >
            {AUTO_LOCK_CHOICES.map((minutes) => (
              <option key={minutes} value={String(minutes)}>
                {minutes} {minutes === 1 ? 'minute' : 'minutes'}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {sealed ? (
        <div class="settings-row">
          <div class="settings-row-label">
            <span>Check the integrity</span>
            <span>Opens every sealed object and reports the broken ones</span>
          </div>
          <button
            type="button"
            class="text-button"
            onClick={() => void runCheck()}
            disabled={checkBusy}
            data-testid="vault-security-check"
          >
            {checkBusy ? 'Checking…' : 'Check the integrity'}
          </button>
        </div>
      ) : null}

      {sealed && checkResult ? (
        <p class="vault-ok-text" role="status" data-testid="vault-security-check-result">
          {checkResult.checked} objects checked, {checkResult.broken.length} broken.
        </p>
      ) : null}

      {sealed && checkResult && checkResult.broken.length > 0 ? (
        <ul class="vault-broken-list" aria-label="The broken objects" data-testid="vault-security-broken">
          {checkResult.broken.map((id) => (
            <li key={id}>
              <code>{id}</code>
            </li>
          ))}
        </ul>
      ) : null}

      {sealed && checkError ? (
        <p class="error-text" role="alert" data-testid="vault-security-check-error">
          {checkError}
        </p>
      ) : null}

      {sealed ? (
        <div class="settings-row">
          <div class="settings-row-label">
            <span>Recovery key</span>
            <span>The key that opens the storage when the password is lost</span>
          </div>
          <span data-testid="vault-security-recovery">
            {recoveryEnabled === null ? 'unknown' : recoveryEnabled ? 'enabled' : 'not enabled'}
          </span>
        </div>
      ) : null}

      {sealed ? (
        <div class="settings-row">
          <div class="settings-row-label">
            <span>New recovery key</span>
            <span>The old key stops working at once</span>
          </div>
          <button
            type="button"
            class="text-button"
            onClick={() => void generateRecoveryKey()}
            data-testid="vault-security-new-recovery"
          >
            Generate a new recovery key
          </button>
        </div>
      ) : null}

      {sealed && recoveryKey ? (
        <div class="vault-recovery">
          <code class="vault-recovery-key" data-testid="vault-security-recovery-key">
            {recoveryKey}
          </code>
          <p class="field-hint">Copy this key now: it is shown once.</p>

          <label class="field vault-field">
            <span class="field-label">The master password</span>
            <input
              class="input"
              type="password"
              value={recoveryPassword}
              autocomplete="current-password"
              aria-label="The master password"
              onInput={(event) => setRecoveryPassword((event.target as HTMLInputElement).value)}
            />
          </label>

          <div class="button-row">
            <button type="button" class="primary-button" onClick={() => void enableRecovery()}>
              Enable the recovery key
            </button>
          </div>
        </div>
      ) : null}

      {sealed && recoveryError ? (
        <p class="error-text" role="alert" data-testid="vault-security-recovery-error">
          {recoveryError}
        </p>
      ) : null}

      {!sealed ? (
        <div class="settings-row">
          <div class="settings-row-label">
            <span>Encrypted storage</span>
            <span>The notes are kept as plain files, and the password has no meaning yet</span>
          </div>
          <button
            type="button"
            class="text-button"
            onClick={() => props.onSetUpEncrypted?.()}
            data-testid="vault-security-setup"
          >
            Set up an encrypted storage
          </button>
        </div>
      ) : null}

      <p class="vault-security-note">
        <Icon name="archive" size={13} />
        <span>The password is never written to the disk and never leaves this browser.</span>
      </p>
    </section>
  );
}
