// The wizard of the encrypted storage.
//
// The wizard walks the user through the creation of the encrypted storage:
// the choice between a new storage and a migration, the master password, the
// warning about the loss of the password and the recovery key.
//
// The wizard never touches the key material: it asks the session, and the
// session asks the core. The master password lives in the state of the
// component for the time of the attempt and is dropped right after it.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import {
  createRecoveryKey,
  createSealedVault,
  enableRecoveryKey,
} from '../core/vault/session';
import { DEFAULT_KDF_PARAMS, LIGHT_KDF_PARAMS, estimateKdfMilliseconds, type KdfParams } from '../core/crypto/kdf';
import {
  VAULT_MIN_PASSWORD_LENGTH,
  VAULT_PASSWORD_MISMATCH,
  VAULT_PASSWORD_TOO_SHORT,
} from '../core/vault/password';
import { Icon } from '../ui/icons';
import { IconButton } from '../ui/tooltip';

export interface VaultSetupDialogProps {
  /** True when the dialog is shown. */
  open: boolean;
  /** Called when the dialog must be closed. */
  onClose(): void;
  /** Called when the encrypted storage is ready. */
  onDone(): void;
  /**
   * Called when the user chooses to migrate the existing storage.
   *
   * The wizard does not migrate anything: the migration has its own dialog.
   */
  onMigrate?(): void;
}

/** The steps of the wizard. */
type SetupStep = 'choice' | 'password' | 'warning' | 'recovery' | 'done';

/** The message of a failed creation. */
export const VAULT_CREATE_FAILED = 'The encrypted storage could not be created. Try again.';

/** The message of a failed recovery key. */
export const VAULT_RECOVERY_FAILED = 'The recovery key could not be enabled. Try again.';

/** The message of a missing migration. */
export const VAULT_MIGRATION_MISSING = 'The migration of the storage is not available here.';

/** The strength of a master password. */
export type PasswordStrength = 'weak' | 'fair' | 'good' | 'strong';

/** The names of the strengths, in the order of the meter. */
const STRENGTH_LABELS: Record<PasswordStrength, string> = {
  weak: 'Weak',
  fair: 'Fair',
  good: 'Good',
  strong: 'Strong',
};

/**
 * Estimates the strength of a master password.
 *
 * The heuristic is a simple one: the length of the password and the number of
 * the classes of characters it uses. No library is involved.
 */
export function passwordStrength(password: string): PasswordStrength {
  if (!password) return 'weak';
  let classes = 0;
  if (/[a-z]/.test(password)) classes += 1;
  if (/[A-Z]/.test(password)) classes += 1;
  if (/[0-9]/.test(password)) classes += 1;
  if (/[^A-Za-z0-9]/.test(password)) classes += 1;

  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (password.length >= 16) score += 1;
  score += Math.max(0, classes - 1);

  if (score <= 1) return 'weak';
  if (score <= 2) return 'fair';
  if (score <= 3) return 'good';
  return 'strong';
}

/** The KDF presets the wizard offers. */
export type KdfPreset = 'default' | 'light';

/** The parameters of the chosen preset. */
export function kdfParamsOf(preset: KdfPreset): KdfParams {
  return preset === 'light' ? LIGHT_KDF_PARAMS : DEFAULT_KDF_PARAMS;
}

/** The steps of the wizard, in the order they are shown. */
const STEPS: { id: SetupStep; label: string }[] = [
  { id: 'choice', label: 'Storage' },
  { id: 'password', label: 'Password' },
  { id: 'warning', label: 'Warning' },
  { id: 'recovery', label: 'Recovery' },
  { id: 'done', label: 'Ready' },
];

/**
 * The wizard of the encrypted storage.
 *
 * Every step is a state of the same dialog: the step indicator tells where
 * the user is, and the buttons of the footer move forward and backward.
 */
export function VaultSetupDialog(props: VaultSetupDialogProps) {
  const [step, setStep] = useState<SetupStep>('choice');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [visible, setVisible] = useState(false);
  const [preset, setPreset] = useState<KdfPreset>('default');
  const [understood, setUnderstood] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [recoverySaved, setRecoverySaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [created, setCreated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);

  // The wizard starts over every time it is opened.
  useEffect(() => {
    if (!props.open) return;
    setStep('choice');
    setPassword('');
    setConfirm('');
    setVisible(false);
    setPreset('default');
    setUnderstood(false);
    setRecoveryKey('');
    setRecoverySaved(false);
    setCopied(false);
    setCreated(false);
    setBusy(false);
    setError(null);
  }, [props.open]);

  // Escape closes the wizard.
  useEffect(() => {
    if (!props.open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [props.open, props.onClose]);

  // The focus goes to the password field when the step of the password opens.
  useEffect(() => {
    if (step === 'password') passwordRef.current?.focus();
  }, [step]);

  // The recovery key is generated when the step of the recovery key opens.
  useEffect(() => {
    if (step !== 'recovery' || recoveryKey) return;
    let cancelled = false;
    void createRecoveryKey()
      .then((key) => {
        if (!cancelled) setRecoveryKey(key);
      })
      .catch(() => {
        if (!cancelled) setError('The recovery key could not be created. Try again.');
      });
    return () => {
      cancelled = true;
    };
  }, [step, recoveryKey]);

  if (!props.open) return null;

  const params = kdfParamsOf(preset);
  const estimate = estimateKdfMilliseconds(params);
  const strength = passwordStrength(password);

  const goToPassword = () => {
    setError(null);
    setStep('password');
  };

  const checkPassword = () => {
    if (password.length < VAULT_MIN_PASSWORD_LENGTH) {
      setError(VAULT_PASSWORD_TOO_SHORT);
      return;
    }
    if (password !== confirm) {
      setError(VAULT_PASSWORD_MISMATCH);
      return;
    }
    setError(null);
    setStep('warning');
  };

  const copyRecoveryKey = async () => {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setCopied(true);
    } catch {
      // The clipboard is not available: the user selects the text by hand.
      setCopied(false);
      setError('The clipboard is not available. Select the key and copy it by hand.');
    }
  };

  const create = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!created) {
        await createSealedVault(password, params);
        setCreated(true);
      }
      await enableRecoveryKey(recoveryKey, password);
      setPassword('');
      setConfirm('');
      setStep('done');
    } catch {
      setError(created ? VAULT_RECOVERY_FAILED : VAULT_CREATE_FAILED);
    } finally {
      setBusy(false);
    }
  };

  const startMigration = () => {
    if (!props.onMigrate) {
      setError(VAULT_MIGRATION_MISSING);
      return;
    }
    props.onMigrate();
    props.onClose();
  };

  const footer = () => {
    if (step === 'choice') {
      return (
        <div class="button-row">
          <button type="button" class="button" onClick={props.onClose}>
            Cancel
          </button>
        </div>
      );
    }
    if (step === 'done') {
      return (
        <div class="button-row">
          <button type="button" class="primary-button" onClick={props.onDone}>
            Open the notes
          </button>
        </div>
      );
    }
    return (
      <div class="button-row">
        {step === 'password' ? (
          <button type="button" class="button" onClick={() => setStep('choice')}>
            Back
          </button>
        ) : null}
        {step === 'password' ? (
          <button type="button" class="primary-button" onClick={checkPassword} data-testid="vault-setup-next">
            Continue
          </button>
        ) : null}
        {step === 'warning' ? (
          <button
            type="button"
            class="primary-button"
            disabled={!understood}
            onClick={() => setStep('recovery')}
            data-testid="vault-setup-next"
          >
            Continue
          </button>
        ) : null}
        {step === 'recovery' ? (
          <button
            type="button"
            class="primary-button"
            disabled={!recoverySaved || busy || !recoveryKey}
            onClick={() => void create()}
            data-testid="vault-setup-create"
          >
            {busy ? 'Creating…' : 'Create the encrypted storage'}
          </button>
        ) : null}
      </div>
    );
  };

  return (
    <div class="dialog-backdrop" onClick={(event) => event.target === event.currentTarget && props.onClose()}>
      <div class="dialog vault-setup" role="dialog" aria-modal="true" aria-label="Encrypted storage" data-testid="vault-setup">
        <header class="dialog-header">
          <h2>Encrypted storage</h2>
          <IconButton label="Close dialog" icon="x" onClick={props.onClose} />
        </header>

        <ol class="vault-steps" aria-label="Steps of the wizard">
          {STEPS.map((item, index) => (
            <li
              key={item.id}
              class={item.id === step ? 'vault-step active' : 'vault-step'}
              aria-current={item.id === step ? 'step' : undefined}
            >
              <span class="vault-step-index">{index + 1}</span>
              <span class="vault-step-label">{item.label}</span>
            </li>
          ))}
        </ol>

        <div class="dialog-body">
          {step === 'choice' ? (
            <div class="vault-choice">
              <p class="dialog-hint">
                The notes of Noto can be encrypted in the browser before they reach the server. The
                server then stores ciphertext only and never learns a title, a body or a path.
              </p>

              <button type="button" class="vault-choice-item" onClick={goToPassword} data-testid="vault-setup-create-new">
                <span class="vault-choice-title">Create a new encrypted storage</span>
                <span class="vault-choice-hint">
                  The current folder becomes an encrypted storage. It must hold no notes yet.
                </span>
              </button>

              <button type="button" class="vault-choice-item" onClick={startMigration} data-testid="vault-setup-migrate">
                <span class="vault-choice-title">Migrate the existing storage</span>
                <span class="vault-choice-hint">
                  The notes of the folder are encrypted once and the storage becomes sealed.
                </span>
              </button>
            </div>
          ) : null}

          {step === 'password' ? (
            <form
              class="vault-form"
              aria-label="The master password"
              onSubmit={(event: JSX.TargetedSubmitEvent<HTMLFormElement>) => {
                event.preventDefault();
                checkPassword();
              }}
            >
              <label class="field vault-field">
                <span class="field-label">Master password</span>
                <span class="vault-field-row">
                  <input
                    ref={passwordRef}
                    class="input"
                    type={visible ? 'text' : 'password'}
                    value={password}
                    autocomplete="new-password"
                    aria-label="Master password"
                    onInput={(event) => setPassword((event.target as HTMLInputElement).value)}
                  />
                  <button
                    type="button"
                    class="button"
                    aria-label={visible ? 'Hide the master password' : 'Show the master password'}
                    aria-pressed={visible}
                    onClick={() => setVisible(!visible)}
                  >
                    {visible ? 'Hide' : 'Show'}
                  </button>
                </span>
              </label>

              <label class="field vault-field">
                <span class="field-label">Repeat the master password</span>
                <input
                  class="input"
                  type={visible ? 'text' : 'password'}
                  value={confirm}
                  autocomplete="new-password"
                  aria-label="Repeat the master password"
                  onInput={(event) => setConfirm((event.target as HTMLInputElement).value)}
                />
              </label>

              <div class="vault-strength" data-testid="vault-setup-strength">
                <span class="vault-strength-label">Strength</span>
                <span class={`vault-strength-value ${strength}`}>{STRENGTH_LABELS[strength]}</span>
                <span class="vault-strength-bar" aria-hidden="true">
                  <span class={`vault-strength-fill ${strength}`} />
                </span>
              </div>

              <div class="vault-kdf">
                <label class="vault-switch-row">
                  <input
                    type="checkbox"
                    checked={preset === 'light'}
                    onChange={(event) =>
                      setPreset((event.target as HTMLInputElement).checked ? 'light' : 'default')
                    }
                  />
                  <span>Use the light preset of the derivation</span>
                </label>
                <p class="field-hint">
                  The derivation of the key takes about {estimate} ms on this device.
                </p>
                {preset === 'light' ? (
                  <p class="vault-warning-text" role="note">
                    The light preset weakens the derivation: it is much faster to try the passwords
                    of the vault. Use it only on a slow device.
                  </p>
                ) : null}
              </div>
            </form>
          ) : null}

          {step === 'warning' ? (
            <div class="vault-warning">
              <p class="vault-warning-text" role="note">
                Without the master password and without the recovery key nobody can open these notes:
                not the author of the program, not the server, not anyone else. A lost password means
                lost notes.
              </p>
              <label class="vault-switch-row">
                <input
                  type="checkbox"
                  checked={understood}
                  onChange={(event) => setUnderstood((event.target as HTMLInputElement).checked)}
                />
                <span>I understand that the password cannot be recovered.</span>
              </label>
            </div>
          ) : null}

          {step === 'recovery' ? (
            <div class="vault-recovery">
              <p class="dialog-hint">
                The recovery key opens this storage when the master password is lost. It is shown once
                and never again: copy it now.
              </p>

              <code class="vault-recovery-key" data-testid="vault-setup-recovery-key">
                {recoveryKey || '…'}
              </code>

              <div class="button-row">
                <button
                  type="button"
                  class="button"
                  aria-label="Copy the recovery key"
                  title="Copy the recovery key"
                  disabled={!recoveryKey}
                  onClick={() => void copyRecoveryKey()}
                >
                  <Icon name="copy" size={14} />
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <p class="field-hint">
                If the clipboard is not available, select the text above and copy it by hand.
              </p>

              <label class="vault-switch-row">
                <input
                  type="checkbox"
                  checked={recoverySaved}
                  onChange={(event) => setRecoverySaved((event.target as HTMLInputElement).checked)}
                />
                <span>I saved the recovery key in a safe place.</span>
              </label>
            </div>
          ) : null}

          {step === 'done' ? (
            <div class="vault-done">
              <p class="vault-done-title">The encrypted storage is ready.</p>
              <p class="dialog-hint">
                The notes are encrypted in this browser from now on. Keep the master password and the
                recovery key in a safe place.
              </p>
            </div>
          ) : null}

          {error ? (
            <p class="error-text" role="alert" data-testid="vault-setup-error">
              {error}
            </p>
          ) : null}
        </div>

        <footer class="dialog-footer">{footer()}</footer>
      </div>
    </div>
  );
}
