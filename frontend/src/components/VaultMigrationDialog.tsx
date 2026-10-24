// The wizard of the migration of an open storage into an encrypted one.
//
// The wizard is deliberately honest about what happens to the folder of the
// notes:
//
//   - the plaintext is copied into the encrypted storage first;
//   - the copy is verified before the server is switched;
//   - the plaintext is only removed after the explicit confirmation of the
//     user;
//   - the copies that live in the history of a cloud provider, in the snapshots
//     and in the backups are NOT erased by the application.
import { useEffect, useState } from 'preact/hooks';
import {
  migrateToSealed,
  migrationPhaseLabel,
  purgePlaintextAfterMigration,
  type MigrationProgress,
  type MigrationResult,
  type PurgeResult,
} from '../core/vault/migration';
import { adoptSealedVault, getSealedVault } from '../core/vault/session';
import { Icon } from '../ui/icons';

/** The props of the wizard. */
export interface VaultMigrationDialogProps {
  /** True when the wizard is shown. */
  open: boolean;
  /** Called when the wizard is closed. */
  onClose(): void;
  /**
   * Called when the migration is over and the user closes the wizard.
   *
   * The storage is encrypted from the moment the wizard shows the result, so
   * the application can already work with the sealed vault.
   */
  onDone(): void;
}

/** The step of the wizard. */
type Step = 'warning' | 'running' | 'result' | 'confirm' | 'done' | 'failed';

/** The strength of a password. */
type Strength = 'weak' | 'fair' | 'good';

/**
 * A rough estimate of the strength of a password.
 *
 * It is a hint for the user, not a cryptographic measure: the real protection
 * comes from Argon2id and from the key that never leaves the browser.
 */
export function passwordStrength(password: string): Strength {
  if (password.length >= 12) return 'good';
  if (password.length >= 8) return 'fair';
  return 'weak';
}

/** The label of the strength of a password. */
function strengthLabel(strength: Strength): string {
  switch (strength) {
    case 'good':
      return 'Strong password';
    case 'fair':
      return 'Weak password — use at least 12 characters';
    default:
      return 'Very weak password — use at least 12 characters';
  }
}

/**
 * The wizard of the migration of an open storage into an encrypted one.
 */
export function VaultMigrationDialog(props: VaultMigrationDialogProps) {
  const [step, setStep] = useState<Step>('warning');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  const [result, setResult] = useState<MigrationResult | null>(null);
  const [purged, setPurged] = useState<PurgeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The wizard starts from the beginning every time it is opened.
  useEffect(() => {
    if (!props.open) return;
    setStep('warning');
    setPassword('');
    setConfirmation('');
    setProgress(null);
    setResult(null);
    setPurged(null);
    setError(null);
  }, [props.open]);

  if (!props.open) return null;

  const strength = passwordStrength(password);
  const passwordReady = password.length > 0 && password === confirmation && strength !== 'weak';

  const start = async () => {
    if (!passwordReady) return;
    setError(null);
    setResult(null);
    setPurged(null);
    setProgress({ phase: 'reading', copied: 0, total: 0 });
    setStep('running');
    try {
      const outcome = await migrateToSealed({
        password,
        vault: getSealedVault() ?? undefined,
        onProgress: (next) => setProgress(next),
      });
      setResult(outcome);
      if (outcome.broken.length > 0 || (outcome.failedPaths?.length ?? 0) > 0) {
        // The storage was not switched: the plaintext is still on the disk.
        setError(
          'The copy could not be verified. The storage was not switched and the notes are still ' +
            'on the disk as plain text. Fix the problem and run the migration again.',
        );
        setStep('failed');
        return;
      }
      // The storage is encrypted from now on: the session adopts it.
      await adoptSealedVault(password);
      setStep('result');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The migration failed');
      setStep('failed');
    }
  };

  const purge = async () => {
    setError(null);
    try {
      const outcome = await purgePlaintextAfterMigration();
      setPurged(outcome);
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The plaintext could not be removed');
      setStep('failed');
    }
  };

  const close = () => {
    if (step === 'done') props.onDone();
    else props.onClose();
  };

  return (
    <div
      class="dialog-backdrop"
      onClick={(event) => event.target === event.currentTarget && props.onClose()}
    >
      <div
        class="dialog noto-migration"
        role="dialog"
        aria-modal="true"
        aria-label="Encrypt the storage of the notes"
        data-testid="vault-migration-dialog"
      >
        <header class="dialog-header">
          <h2>Encrypt the storage of the notes</h2>
          <button
            type="button"
            class="icon-button"
            aria-label="Close dialog"
            onClick={props.onClose}
          >
            <Icon name="x" size={16} />
          </button>
        </header>

        <div class="dialog-body">
          {step === 'warning' ? (
            <>
              <p class="dialog-hint">
                The notes of the folder are plain Markdown files today. The migration copies them into
                an encrypted storage: every note is encrypted in your browser before it is written,
                and the server never sees a title, a body or a path.
              </p>
              <ul class="noto-migration-list">
                <li>The plaintext files are removed from the disk only after the copy has been verified and after you have confirmed it.</li>
                <li>The application cannot erase the copies that live in the version history of a cloud provider, in the snapshots or in the backups.</li>
                <li>If the migration is interrupted, it continues where it stopped after you unlock the storage again.</li>
              </ul>

              <label class="field">
                <span class="field-label">Master password of the encrypted storage</span>
                <input
                  type="password"
                  class="input"
                  value={password}
                  autoComplete="new-password"
                  aria-label="Master password of the encrypted storage"
                  onInput={(event) => setPassword((event.target as HTMLInputElement).value)}
                />
              </label>
              <label class="field">
                <span class="field-label">Repeat the password</span>
                <input
                  type="password"
                  class="input"
                  value={confirmation}
                  autoComplete="new-password"
                  aria-label="Repeat the master password"
                  onInput={(event) => setConfirmation((event.target as HTMLInputElement).value)}
                />
              </label>
              <p
                class={`noto-migration-strength noto-migration-strength-${strength}`}
                data-testid="vault-migration-strength"
              >
                {strengthLabel(strength)}
              </p>
              {password.length > 0 && password !== confirmation ? (
                <p class="field-error">The two passwords do not match.</p>
              ) : null}
            </>
          ) : null}

          {step === 'running' ? (
            <div class="noto-migration-progress" data-testid="vault-migration-progress">
              <p class="noto-migration-phase">{migrationPhaseLabel(progress?.phase ?? 'reading')}</p>
              <p class="muted">
                {progress?.copied ?? 0} of {progress?.total ?? 0} notes
              </p>
              {progress?.currentPath ? (
                <p class="noto-migration-path muted" title={progress.currentPath}>
                  {progress.currentPath}
                </p>
              ) : null}
            </div>
          ) : null}

          {step === 'result' && result ? (
            <>
              <p class="dialog-hint">
                The copy is done and verified: {result.copied} notes are encrypted in the storage and
                the server works with the encrypted storage now.
              </p>
              <p class="noto-migration-note">
                The plain text files are still on the disk. They are only removed when you ask for it
                below.
              </p>
            </>
          ) : null}

          {step === 'confirm' ? (
            <>
              <p class="dialog-hint">
                The last step removes the plain text files of the folder from the disk. This cannot be
                undone.
              </p>
              <ul class="noto-migration-list">
                <li>The application cannot erase the copies that live in the version history of a cloud provider, in the snapshots or in the backups.</li>
                <li>If you keep the files, the folder holds both the plain text notes and the encrypted storage.</li>
              </ul>
            </>
          ) : null}

          {step === 'done' && purged ? (
            <>
              <p class="dialog-hint">
                The migration is finished: {result?.copied ?? 0} notes are encrypted and{' '}
                {purged.deleted} plain text files ({purged.bytes} bytes) were removed from the disk.
              </p>
              <p class="noto-migration-note">
                The copies that live in the version history of a cloud provider, in the snapshots and in
                the backups are still there: the application cannot erase them. Remove them yourself if
                they must not exist any more.
              </p>
            </>
          ) : null}

          {step === 'failed' ? (
            <>
              <p class="error-text" role="alert" data-testid="vault-migration-error">
                {error ?? 'The migration failed'}
              </p>
              {result && result.broken.length > 0 ? (
                <div class="noto-migration-broken">
                  <p class="muted">The objects that could not be read back:</p>
                  <ul>
                    {result.broken.map((id) => (
                      <li key={id}>
                        <code>{id}</code>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {result && (result.failedPaths?.length ?? 0) > 0 ? (
                <div class="noto-migration-broken">
                  <p class="muted">The notes that could not be read:</p>
                  <ul>
                    {(result.failedPaths ?? []).map((path) => (
                      <li key={path}>
                        <code>{path}</code>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p class="muted">
                The notes that were copied are safe in the encrypted storage. The migration can be run
                again: it continues with the notes that are missing.
              </p>
            </>
          ) : null}
        </div>

        <footer class="dialog-footer">
          {step === 'warning' ? (
            <>
              <button type="button" class="text-button" onClick={props.onClose}>
                Cancel
              </button>
              <button
                type="button"
                class="primary-button"
                disabled={!passwordReady}
                data-testid="vault-migration-start"
                onClick={() => {
                  void start();
                }}
              >
                Encrypt the storage
              </button>
            </>
          ) : null}

          {step === 'running' ? (
            <span class="muted">The migration is running…</span>
          ) : null}

          {step === 'result' ? (
            <>
              <button type="button" class="text-button" onClick={props.onClose}>
                Keep the plain text files
              </button>
              <button
                type="button"
                class="primary-button"
                data-testid="vault-migration-purge"
                onClick={() => setStep('confirm')}
              >
                Remove the plaintext files from the disk
              </button>
            </>
          ) : null}

          {step === 'confirm' ? (
            <>
              <button type="button" class="text-button" onClick={() => setStep('result')}>
                Cancel
              </button>
              <button
                type="button"
                class="primary-button"
                data-testid="vault-migration-purge-confirm"
                onClick={() => {
                  void purge();
                }}
              >
                Remove the plaintext files from the disk
              </button>
            </>
          ) : null}

          {step === 'done' ? (
            <button
              type="button"
              class="primary-button"
              data-testid="vault-migration-close"
              onClick={close}
            >
              Close
            </button>
          ) : null}

          {step === 'failed' ? (
            <button
              type="button"
              class="text-button"
              data-testid="vault-migration-close"
              onClick={props.onClose}
            >
              Close
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
