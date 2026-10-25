// The rules of the master password of the encrypted storage.
//
// The rules live here and not in the wizard: the settings of the storage change
// the master password too, and both places must refuse the same passwords.

/** The shortest master password the application accepts. */
export const VAULT_MIN_PASSWORD_LENGTH = 10;

/** The message of a password that is too short. */
export const VAULT_PASSWORD_TOO_SHORT = `The master password must have at least ${VAULT_MIN_PASSWORD_LENGTH} characters.`;

/** The message of two different passwords. */
export const VAULT_PASSWORD_MISMATCH = 'The passwords do not match.';
