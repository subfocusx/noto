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
  purgePlaintextAfterMigration,
  type MigrationProgress,
  type MigrationResult,
  type PurgeResult,
} from '../core/vault/migration';
import { adoptSealedVault, getSealedVault } from '../core/vault/session';
import { useT } from '../i18n/useT';
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

/** The label of the strength of a password. */function strengthLabel(strength: Strength): string {
  switch (strength) {
    case 'good':
      return 'vault.migration.strength.good';
    case 'fair':
      return 'vault.migration.strength.fair';
    default:
      return 'vault.migration.strength.weak';
  }
}

/** The label of the phase of the migration. */
function phaseLabel(phase: MigrationProgress['phase']): string {
  return `vault.migration.phase.${phase}`;
}

/**
 * The wizard of the migration of an open storage into an encrypted one.
 */
export function VaultMigrationDialog(props: VaultMigrationDialogProps) {
  const t = useT();
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
        setError(t('vault.migration.verifyFailed'));
        setStep('failed');
        return;
      }
      // The storage is encrypted from now on: the session adopts it.
      await adoptSealedVault(password);
      setStep('result');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('vault.migration.failed'));
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
      setError(err instanceof Error ? err.message : t('vault.migration.purgeFailed'));
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
        aria-label={t('vault.migration.title')}
        data-testid="vault-migration-dialog"
      >
        <header class="dialog-header">
          <h2>{t('vault.migration.title')}</h2>
          <button
            type="button"
            class="icon-button"
            aria-label={t('common.closeDialog')}
            onClick={props.onClose}
          >
            <Icon name="x" size={16} />
          </button>
        </header>

        <div class="dialog-body">
          {step === 'warning' ? (
            <>
              <p class="dialog-hint">{t('vault.migration.warning')}</p>
              <ul class="noto-migration-list">
                <li>{t('vault.migration.list1')}</li>
                <li>{t('vault.migration.list2')}</li>
                <li>{t('vault.migration.list3')}</li>
              </ul>

              <label class="field">
                <span class="field-label">{t('vault.migration.passwordLabel')}</span>
                <input
                  type="password"
                  class="input"
                  value={password}
                  autoComplete="new-password"
                  aria-label={t('vault.migration.passwordLabel')}
                  onInput={(event) => setPassword((event.target as HTMLInputElement).value)}
                />
              </label>
              <label class="field">
                <span class="field-label">{t('vault.migration.repeatLabel')}</span>
                <input
                  type="password"
                  class="input"
                  value={confirmation}
                  autoComplete="new-password"
                  aria-label={t('vault.migration.repeatPassword')}
                  onInput={(event) => setConfirmation((event.target as HTMLInputElement).value)}
                />
              </label>
              <p
                class={`noto-migration-strength noto-migration-strength-${strength}`}
                data-testid="vault-migration-strength"
              >
                {t(strengthLabel(strength))}
              </p>
              {password.length > 0 && password !== confirmation ? (
                <p class="field-error">{t('vault.migration.mismatch')}</p>
              ) : null}
            </>
          ) : null}

          {step === 'running' ? (
            <div class="noto-migration-progress" data-testid="vault-migration-progress">
              <p class="noto-migration-phase">{t(phaseLabel(progress?.phase ?? 'reading'))}</p>
              <p class="muted">
                {t('vault.migration.progress', {
                  copied: progress?.copied ?? 0,
                  total: progress?.total ?? 0,
                })}
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
              <p class="dialog-hint">{t('vault.migration.result', { count: result.copied })}</p>
              <p class="noto-migration-note">{t('vault.migration.plaintextNote')}</p>
            </>
          ) : null}

          {step === 'confirm' ? (
            <>
              <p class="dialog-hint">{t('vault.migration.confirmHint')}</p>
              <ul class="noto-migration-list">
                <li>{t('vault.migration.list2')}</li>
                <li>{t('vault.migration.confirmList2')}</li>
              </ul>
            </>
          ) : null}

          {step === 'done' && purged ? (
            <>
              <p class="dialog-hint">
                {t('vault.migration.done', {
                  count: result?.copied ?? 0,
                  deleted: purged.deleted,
                  bytes: purged.bytes,
                })}
              </p>
              <p class="noto-migration-note">{t('vault.migration.doneNote')}</p>
            </>
          ) : null}

          {step === 'failed' ? (
            <>
              <p class="error-text" role="alert" data-testid="vault-migration-error">
                {error ?? t('vault.migration.failed')}
              </p>
              {result && result.broken.length > 0 ? (
                <div class="noto-migration-broken">
                  <p class="muted">{t('vault.migration.brokenTitle')}</p>
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
                  <p class="muted">{t('vault.migration.failedPathsTitle')}</p>
                  <ul>
                    {(result.failedPaths ?? []).map((path) => (
                      <li key={path}>
                        <code>{path}</code>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p class="muted">{t('vault.migration.safeNote')}</p>
            </>
          ) : null}
        </div>

        <footer class="dialog-footer">
          {step === 'warning' ? (
            <>
              <button type="button" class="text-button" onClick={props.onClose}>
                {t('common.cancel')}
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
                {t('vault.migration.encrypt')}
              </button>
            </>
          ) : null}

          {step === 'running' ? (
            <span class="muted">{t('vault.migration.running')}</span>
          ) : null}

          {step === 'result' ? (
            <>
              <button type="button" class="text-button" onClick={props.onClose}>
                {t('vault.migration.keepPlain')}
              </button>
              <button
                type="button"
                class="primary-button"
                data-testid="vault-migration-purge"
                onClick={() => setStep('confirm')}
              >
                {t('vault.migration.removePlain')}
              </button>
            </>
          ) : null}

          {step === 'confirm' ? (
            <>
              <button type="button" class="text-button" onClick={() => setStep('result')}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                class="primary-button"
                data-testid="vault-migration-purge-confirm"
                onClick={() => {
                  void purge();
                }}
              >
                {t('vault.migration.removePlain')}
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
              {t('common.close')}
            </button>
          ) : null}

          {step === 'failed' ? (
            <button
              type="button"
              class="text-button"
              data-testid="vault-migration-close"
              onClick={props.onClose}
            >
              {t('common.close')}
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
