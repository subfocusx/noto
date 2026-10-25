// The screen that replaces the application while the storage is locked.
//
// The screen shows nothing but the name of the storage and the master
// password: no note, no title, no path of a note ever reaches the screen while
// the storage is closed. The password lives in the state of the component for
// the time of the attempt and is dropped right after it.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { getStorageName, unlockVault } from '../core/vault/session';
import { t } from '../i18n';
import { useT } from '../i18n/useT';

export interface VaultUnlockScreenProps {
  /** Called when the storage is unlocked. */
  onUnlocked(): void;
  /**
   * The name of the storage.
   *
   * When it is not given, the session asks the backend for it.
   */
  storageName?: string;
}

/**
 * The message of a failed attempt.
 *
 * The reason of the failure (a wrong password, a damaged keystore, a backend
 * that does not answer) never reaches the user: the message is the same in
 * every case, so the screen leaks nothing about the storage.
 */
export const UNLOCK_ERROR_MESSAGE = t('vault.unlock.error');

/** The message of an empty password. */
export const UNLOCK_EMPTY_MESSAGE = t('vault.unlock.empty');

/**
 * The screen of the locked storage.
 *
 * The password field is hidden by default, has a label and takes the focus as
 * soon as the screen appears. The form is submitted with the keyboard.
 */
export function VaultUnlockScreen(props: VaultUnlockScreenProps) {
  const t = useT();
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(props.storageName ?? '');
  const fieldRef = useRef<HTMLInputElement | null>(null);

  // The focus goes to the password field when the screen appears.
  useEffect(() => {
    fieldRef.current?.focus();
  }, []);

  // The name of the storage comes from the session when the caller does not
  // know it.
  useEffect(() => {
    if (props.storageName) {
      setName(props.storageName);
      return;
    }
    let cancelled = false;
    void getStorageName().then((value) => {
      if (!cancelled) setName(value);
    });
    return () => {
      cancelled = true;
    };
  }, [props.storageName]);

  const submit = async (event: JSX.TargetedSubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (!password) {
      setError(t('vault.unlock.empty'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await unlockVault(password);
      setPassword('');
      props.onUnlocked();
    } catch {
      // The password is dropped even when the attempt fails: it must not stay
      // in the memory of the tab longer than the attempt itself.
      setPassword('');
      setError(t('vault.unlock.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main class="vault-unlock" data-testid="vault-unlock">
      <form class="vault-unlock-card" onSubmit={submit} aria-label={t('vault.unlock.label')}>
        <div class="vault-unlock-brand">
          <span class="vault-unlock-logo">Noto</span>
          <span class="vault-unlock-name" data-testid="vault-unlock-name">
            {name || 'Noto'}
          </span>
        </div>

        <h1 class="vault-unlock-title">{t('vault.unlock.title')}</h1>
        <p class="vault-unlock-hint">{t('vault.unlock.hint')}</p>

        <label class="field vault-field">
          <span class="field-label">{t('vault.unlock.password')}</span>
          <span class="vault-field-row">
            <input
              ref={fieldRef}
              class="input"
              type={visible ? 'text' : 'password'}
              value={password}
              autocomplete="current-password"
              aria-label={t('vault.unlock.password')}
              aria-invalid={error ? 'true' : undefined}
              disabled={busy}
              onInput={(event) => {
                setPassword((event.target as HTMLInputElement).value);
                setError(null);
              }}
            />
            <button
              type="button"
              class="button"
              aria-label={visible ? t('vault.setup.hideLabel') : t('vault.setup.showLabel')}
              aria-pressed={visible}
              onClick={() => setVisible(!visible)}
            >
              {visible ? t('vault.setup.hide') : t('vault.setup.show')}
            </button>
          </span>
        </label>

        {error ? (
          <p class="error-text" role="alert" data-testid="vault-unlock-error">
            {error}
          </p>
        ) : null}

        <button type="submit" class="primary-button" disabled={busy} aria-busy={busy ? 'true' : undefined}>
          {busy ? t('vault.unlock.unlocking') : t('vault.unlock.unlock')}
        </button>
      </form>
    </main>
  );
}
