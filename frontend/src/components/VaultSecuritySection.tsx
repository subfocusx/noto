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
import { VAULT_MIN_PASSWORD_LENGTH } from '../core/vault/password';
import { t } from '../i18n';
import { useT } from '../i18n/useT';
import { Icon } from '../ui/icons';

/** The number of minutes the user can choose for the auto-lock. */
const AUTO_LOCK_CHOICES = [1, 5, 15, 30, 60, 120];

/**
 * The message of a failed change of the password.
 *
 * The catalogue of the strings is loaded before the first render, but the
 * module can be imported earlier: the text is therefore read at the moment it
 * is used, not when the module is loaded.
 */
export const securityChangeFailed = (): string => t('vault.security.changeFailed');

/** The message of a failed integrity check. */
export const securityCheckFailed = (): string => t('vault.security.checkFailed');

/** The message of a failed recovery key. */
export const securityRecoveryFailed = (): string => t('vault.security.recoveryFailed');

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
  open: 'vault.security.mode.plain',
  sealed: 'vault.security.mode.sealed',
};

/**
 * The section of the settings of the encrypted storage.
 *
 * The section follows the mode of the storage: an open storage has no key, no
 * password and no sealed objects, so the actions that belong to an encrypted
 * storage are not offered at all. An open storage offers the wizard instead.
 */
export function VaultSecuritySection(props: VaultSecuritySectionProps) {
  const t = useT();
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
    // The same rules as the wizard of the encrypted storage: a master password
    // that is too short is refused here too.
    if (newPassword.length < VAULT_MIN_PASSWORD_LENGTH) {
      setPasswordError(t('vault.password.tooShort', { min: VAULT_MIN_PASSWORD_LENGTH }));
      return;
    }
    if (!newPassword || newPassword !== newPassword2) {
      setPasswordError(t('vault.security.passwordMismatch'));
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
      setPasswordError(t('vault.security.changeFailed'));
    }
  };

  const runCheck = async () => {
    setCheckBusy(true);
    setCheckError(null);
    try {
      const result = await integrityCheck();
      setCheckResult(result);
    } catch {
      setCheckError(t('vault.security.checkFailed'));
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
      setRecoveryError(t('vault.security.recoveryFailed'));
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
      setRecoveryError(t('vault.security.recoveryFailed'));
    }
  };

  const onAutoLockChange = (minutes: number) => {
    setLockMinutes(minutes);
    savePrefs({ ...loadPrefs(), autoLockMinutes: minutes });
  };

  return (
    <section class="settings-group" aria-label={t('vault.security.title')}>
      <h3>{t('vault.security.title')}</h3>

      <div class="settings-row">
        <div class="settings-row-label">
          <span>{t('vault.security.encryption')}</span>
          <span>{t('vault.security.encryptionHint')}</span>
        </div>
        <span data-testid="vault-security-mode">{t(MODE_LABELS[session.mode])}</span>
      </div>

      {sealed ? (
        <div class="settings-row">
          <div class="settings-row-label">
            <span>{t('vault.security.format')}</span>
            <span>{t('vault.security.formatHint')}</span>
          </div>
          <span data-testid="vault-security-format">
            {session.formatVersion > 0 ? session.formatVersion : t('common.unknown')}
          </span>
        </div>
      ) : null}

      {sealed ? (
        <div class="settings-row">
          <div class="settings-row-label">
            <span>{t('vault.security.lockNow')}</span>
            <span>{t('vault.security.lockNowHint')}</span>
          </div>
          <button type="button" class="text-button" onClick={lockNow} data-testid="vault-security-lock">
            {t('vault.security.lockNow')}
          </button>
        </div>
      ) : null}

      {sealed ? (
        <div class="settings-row">
          <div class="settings-row-label">
            <span>{t('vault.security.changePassword')}</span>
            <span>{t('vault.security.changePasswordHint')}</span>
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
            {showPasswordForm ? t('common.cancel') : t('vault.security.changePassword')}
          </button>
        </div>
      ) : null}

      {sealed && showPasswordForm ? (
        <form
          class="vault-inline-form"
          aria-label={t('vault.security.changePasswordForm')}
          onSubmit={(event) => {
            event.preventDefault();
            void changeThePassword();
          }}
        >
          <label class="field vault-field">
            <span class="field-label">{t('vault.security.currentPassword')}</span>
            <input
              class="input"
              type="password"
              value={oldPassword}
              autocomplete="current-password"
              aria-label={t('vault.security.currentPassword')}
              onInput={(event) => setOldPassword((event.target as HTMLInputElement).value)}
            />
          </label>

          <label class="field vault-field">
            <span class="field-label">{t('vault.security.newPassword')}</span>
            <input
              class="input"
              type="password"
              value={newPassword}
              autocomplete="new-password"
              aria-label={t('vault.security.newPassword')}
              onInput={(event) => setNewPassword((event.target as HTMLInputElement).value)}
            />
          </label>

          <label class="field vault-field">
            <span class="field-label">{t('vault.security.repeatNewPassword')}</span>
            <input
              class="input"
              type="password"
              value={newPassword2}
              autocomplete="new-password"
              aria-label={t('vault.security.repeatNewPassword')}
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
              {t('vault.security.changePassword')}
            </button>
          </div>
        </form>
      ) : null}

      {sealed && passwordDone ? (
        <p class="vault-ok-text" role="status">
          {t('vault.security.passwordChanged')}
        </p>
      ) : null}

      {sealed ? (
        <div class="settings-row">
          <div class="settings-row-label">
            <span>{t('vault.security.autoLock')}</span>
            <span>{t('vault.security.autoLockHint')}</span>
          </div>
          <select
            aria-label={t('vault.security.autoLockLabel')}
            value={String(lockMinutes)}
            onChange={(event) => onAutoLockChange(Number((event.target as HTMLSelectElement).value))}
            data-testid="vault-security-auto-lock"
          >
            {AUTO_LOCK_CHOICES.map((minutes) => (
              <option key={minutes} value={String(minutes)}>
                {minutes === 1
                  ? t('vault.security.minute', { count: minutes })
                  : t('vault.security.minutes', { count: minutes })}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {sealed ? (
        <div class="settings-row">
          <div class="settings-row-label">
            <span>{t('vault.security.check')}</span>
            <span>{t('vault.security.checkHint')}</span>
          </div>
          <button
            type="button"
            class="text-button"
            onClick={() => void runCheck()}
            disabled={checkBusy}
            data-testid="vault-security-check"
          >
            {checkBusy ? t('vault.security.checking') : t('vault.security.check')}
          </button>
        </div>
      ) : null}

      {sealed && checkResult ? (
        <p class="vault-ok-text" role="status" data-testid="vault-security-check-result">
          {t('vault.security.checkResult', {
            checked: checkResult.checked,
            broken: checkResult.broken.length,
          })}
        </p>
      ) : null}

      {sealed && checkResult && checkResult.broken.length > 0 ? (
        <ul
          class="vault-broken-list"
          aria-label={t('vault.security.brokenList')}
          data-testid="vault-security-broken"
        >
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
            <span>{t('vault.security.recovery')}</span>
            <span>{t('vault.security.recoveryHint')}</span>
          </div>
          <span data-testid="vault-security-recovery">
            {recoveryEnabled === null
              ? t('common.unknown')
              : recoveryEnabled
                ? t('vault.security.recoveryEnabled')
                : t('vault.security.recoveryDisabled')}
          </span>
        </div>
      ) : null}

      {sealed ? (
        <div class="settings-row">
          <div class="settings-row-label">
            <span>{t('vault.security.newRecovery')}</span>
            <span>{t('vault.security.newRecoveryHint')}</span>
          </div>
          <button
            type="button"
            class="text-button"
            onClick={() => void generateRecoveryKey()}
            data-testid="vault-security-new-recovery"
          >
            {t('vault.security.generateRecovery')}
          </button>
        </div>
      ) : null}

      {sealed && recoveryKey ? (
        <div class="vault-recovery">
          <code class="vault-recovery-key" data-testid="vault-security-recovery-key">
            {recoveryKey}
          </code>
          <p class="field-hint">{t('vault.security.copyNow')}</p>

          <label class="field vault-field">
            <span class="field-label">{t('vault.security.masterPassword')}</span>
            <input
              class="input"
              type="password"
              value={recoveryPassword}
              autocomplete="current-password"
              aria-label={t('vault.security.masterPassword')}
              onInput={(event) => setRecoveryPassword((event.target as HTMLInputElement).value)}
            />
          </label>

          <div class="button-row">
            <button type="button" class="primary-button" onClick={() => void enableRecovery()}>
              {t('vault.security.enableRecovery')}
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
            <span>{t('vault.security.encryptedStorage')}</span>
            <span>{t('vault.security.encryptedStorageHint')}</span>
          </div>
          <button
            type="button"
            class="text-button"
            onClick={() => props.onSetUpEncrypted?.()}
            data-testid="vault-security-setup"
          >
            {t('vault.security.setup')}
          </button>
        </div>
      ) : null}

      <p class="vault-security-note">
        <Icon name="archive" size={13} />
        <span>{t('vault.security.note')}</span>
      </p>
    </section>
  );
}
