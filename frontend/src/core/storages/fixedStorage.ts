// The storage that is fixed by the environment.
//
// The backend can be started with a folder that must not be changed at
// runtime (`NOTO_VAULT_FIXED`). The interface then shows the button of the
// storage, but the button cannot open anything: it explains itself instead of
// pretending that the storage can be changed.
//
// The message lives here, in the core, so that the button, the menu and the
// dialog of the choice of the folder all say the same thing.
import type { UiState } from '../store/types';

/** The message that explains that the storage cannot be changed. */
export const STORAGE_FIXED_MESSAGE = 'The storage is fixed by the environment (NOTO_VAULT_FIXED).';

/**
 * The short form of the message.
 *
 * The menu of the storage shows the sentence alone, and the reason under it.
 */
export const STORAGE_FIXED_TITLE = 'The storage is fixed by the environment';

/** The reason of the refusal, in one sentence. */
export const STORAGE_FIXED_REASON =
  'The backend was started with a fixed folder of notes, so the storage cannot be changed while the application runs.';

/**
 * True when the storage of the notes is fixed by the environment.
 *
 * The state of the store is the only source of the answer: the flag is filled
 * by the answer of the server.
 */
export function isStorageFixed(ui: Pick<UiState, 'vaultFixed'>): boolean {
  return ui.vaultFixed === true;
}

/**
 * The explanation of the fixed storage: the message and the reason.
 *
 * The interface shows both: the message says what the situation is, the
 * reason says why it cannot be changed.
 */
export function storageFixedExplanation(): { message: string; reason: string } {
  return { message: STORAGE_FIXED_MESSAGE, reason: STORAGE_FIXED_REASON };
}
