// The strings of the storage of the notes (English).
//
// The file holds the en text of the area "vault". Every key of the
// area exists in every language: the test of the catalogue proves it.
export const vault: Record<string, string> = {
  'vault.fixed.message':
    'The storage is fixed by the environment (NOTO_VAULT_FIXED).',
  'vault.fixed.title': 'The storage is fixed by the environment',
  'vault.fixed.reason':
    'The backend was started with a fixed folder of notes, so the storage cannot be changed while the application runs.',

  'vault.picker.title': 'Choose the storage of the notes',
  'vault.picker.hint':
    'The notes are stored as Markdown files in the folder you choose. The internal data of Noto lives in a hidden .noto subfolder next to them.',
  'vault.picker.folder': 'Folder',
  'vault.picker.pathLabel': 'Path of the folder',
  'vault.picker.parent': 'Parent directory',
  'vault.picker.noDirs': 'No subdirectories',
  'vault.picker.use': 'Use this folder',
  'vault.picker.working': 'Working…',
  'vault.picker.encrypt': 'Set up an encrypted storage',
  'vault.picker.readFailed': 'Could not read the directory',

  'vault.switch.label': 'Switch the storage of the notes',
  'vault.switch.title': 'Storage of the notes',
  'vault.switch.open': 'Open',
  'vault.switch.recent': 'Recent',
  'vault.switch.close': 'Close the storage {name}',
  'vault.switch.choose': 'Choose another folder…',

  'vault.setup.title': 'Encrypted storage',
  'vault.setup.steps': 'Steps of the wizard',
  'vault.setup.step.storage': 'Storage',
  'vault.setup.step.password': 'Password',
  'vault.setup.step.warning': 'Warning',
  'vault.setup.step.recovery': 'Recovery',
  'vault.setup.step.ready': 'Ready',
  'vault.setup.hint':
    'The notes of Noto can be encrypted in the browser before they reach the server. The server then stores ciphertext only and never learns a title, a body or a path.',
  'vault.setup.createNew': 'Create a new encrypted storage',
  'vault.setup.createNewHint':
    'The current folder becomes an encrypted storage. It must hold no notes yet.',
  'vault.setup.migrate': 'Migrate the existing storage',
  'vault.setup.migrateHint':
    'The notes of the folder are encrypted once and the storage becomes sealed.',
  'vault.setup.masterPassword': 'Master password',
  'vault.setup.formLabel': 'The master password',
  'vault.setup.repeatPassword': 'Repeat the master password',
  'vault.setup.show': 'Show',
  'vault.setup.hide': 'Hide',
  'vault.setup.showLabel': 'Show the master password',
  'vault.setup.hideLabel': 'Hide the master password',
  'vault.setup.strength': 'Strength',
  'vault.setup.strength.weak': 'Weak',
  'vault.setup.strength.fair': 'Fair',
  'vault.setup.strength.good': 'Good',
  'vault.setup.strength.strong': 'Strong',
  'vault.setup.lightPreset': 'Use the light preset of the derivation',
  'vault.setup.estimate': 'The derivation of the key takes about {ms} ms on this device.',
  'vault.setup.lightWarning':
    'The light preset weakens the derivation: it is much faster to try the passwords of the vault. Use it only on a slow device.',
  'vault.setup.warningText':
    'Without the master password and without the recovery key nobody can open these notes: not the author of the program, not the server, not anyone else. A lost password means lost notes.',
  'vault.setup.understand': 'I understand that the password cannot be recovered.',
  'vault.setup.recoveryHint':
    'The recovery key opens this storage when the master password is lost. It is shown once and never again: copy it now.',
  'vault.setup.copy': 'Copy',
  'vault.setup.copied': 'Copied',
  'vault.setup.copyLabel': 'Copy the recovery key',
  'vault.setup.clipboardHint':
    'If the clipboard is not available, select the text above and copy it by hand.',
  'vault.setup.saved': 'I saved the recovery key in a safe place.',
  'vault.setup.doneTitle': 'The encrypted storage is ready.',
  'vault.setup.doneHint':
    'The notes are encrypted in this browser from now on. Keep the master password and the recovery key in a safe place.',
  'vault.setup.creating': 'Creating…',
  'vault.setup.create': 'Create the encrypted storage',
  'vault.setup.openNotes': 'Open the notes',
  'vault.setup.continue': 'Continue',
  'vault.setup.createFailed': 'The encrypted storage could not be created. Try again.',
  'vault.setup.recoveryFailed': 'The recovery key could not be enabled. Try again.',
  'vault.setup.recoveryCreateFailed': 'The recovery key could not be created. Try again.',
  'vault.setup.migrationMissing': 'The migration of the storage is not available here.',
  'vault.setup.clipboardUnavailable':
    'The clipboard is not available. Select the key and copy it by hand.',

  'vault.password.tooShort': 'The master password must have at least {min} characters.',
  'vault.password.mismatch': 'The passwords do not match.',

  'vault.unlock.label': 'Unlock the encrypted storage',
  'vault.unlock.title': 'The storage is locked',
  'vault.unlock.hint':
    'Enter the master password of this storage. The notes are decrypted in this browser and stay there.',
  'vault.unlock.password': 'Master password',
  'vault.unlock.unlocking': 'Unlocking…',
  'vault.unlock.unlock': 'Unlock',
  'vault.unlock.error': 'Wrong password or damaged storage.',
  'vault.unlock.empty': 'Enter the master password.',

  'vault.security.title': 'Security',
  'vault.security.encryption': 'Encryption',
  'vault.security.encryptionHint': 'The state of the storage of the notes',
  'vault.security.mode.plain': 'Plain (not encrypted)',
  'vault.security.mode.sealed': 'Encrypted',
  'vault.security.format': 'Format version',
  'vault.security.formatHint': 'The version of the format of the encrypted storage',
  'vault.security.lockNow': 'Lock now',
  'vault.security.lockNowHint': 'Forgets the key of the storage in this tab',
  'vault.security.changePassword': 'Change the password',
  'vault.security.changePasswordHint': 'The notes stay encrypted with the same key',
  'vault.security.currentPassword': 'The current password',
  'vault.security.masterPassword': 'The master password',
  'vault.security.changePasswordForm': 'Change the master password',
  'vault.security.newPassword': 'The new password',
  'vault.security.repeatNewPassword': 'Repeat the new password',
  'vault.security.passwordChanged': 'The master password was changed.',
  'vault.security.passwordMismatch': 'The new passwords do not match.',
  'vault.security.autoLock': 'Auto-lock',
  'vault.security.autoLockHint':
    'Locks the storage after this many minutes without activity',
  'vault.security.autoLockLabel': 'Auto-lock after N minutes',
  'vault.security.minute': '{count} minute',
  'vault.security.minutes': '{count} minutes',
  'vault.security.check': 'Check the integrity',
  'vault.security.checkHint': 'Opens every sealed object and reports the broken ones',
  'vault.security.checking': 'Checking…',
  'vault.security.checkResult': '{checked} objects checked, {broken} broken.',
  'vault.security.brokenList': 'The broken objects',
  'vault.security.recovery': 'Recovery key',
  'vault.security.recoveryHint':
    'The key that opens the storage when the password is lost',
  'vault.security.recoveryEnabled': 'enabled',
  'vault.security.recoveryDisabled': 'not enabled',
  'vault.security.newRecovery': 'New recovery key',
  'vault.security.newRecoveryHint': 'The old key stops working at once',
  'vault.security.generateRecovery': 'Generate a new recovery key',
  'vault.security.copyNow': 'Copy this key now: it is shown once.',
  'vault.security.enableRecovery': 'Enable the recovery key',
  'vault.security.encryptedStorage': 'Encrypted storage',
  'vault.security.encryptedStorageHint':
    'The notes are kept as plain files, and the password has no meaning yet',
  'vault.security.setup': 'Set up an encrypted storage',
  'vault.security.note':
    'The password is never written to the disk and never leaves this browser.',
  'vault.security.changeFailed': 'The password was not changed. Check the old password.',
  'vault.security.checkFailed': 'The integrity check could not be run.',
  'vault.security.recoveryFailed': 'The recovery key was not enabled. Check the password.',

  'vault.migration.title': 'Encrypt the storage of the notes',
  'vault.migration.warning':
    'The notes of the folder are plain Markdown files today. The migration copies them into an encrypted storage: every note is encrypted in your browser before it is written, and the server never sees a title, a body or a path.',
  'vault.migration.list1':
    'The plaintext files are removed from the disk only after the copy has been verified and after you have confirmed it.',
  'vault.migration.list2':
    'The application cannot erase the copies that live in the version history of a cloud provider, in the snapshots or in the backups.',
  'vault.migration.list3':
    'If the migration is interrupted, it continues where it stopped after you unlock the storage again.',
  'vault.migration.passwordLabel': 'Master password of the encrypted storage',
  'vault.migration.repeatLabel': 'Repeat the password',
  'vault.migration.repeatPassword': 'Repeat the master password',
  'vault.migration.strength.good': 'Strong password',
  'vault.migration.strength.fair': 'Weak password — use at least 12 characters',
  'vault.migration.strength.weak': 'Very weak password — use at least 12 characters',
  'vault.migration.mismatch': 'The two passwords do not match.',
  'vault.migration.progress': '{copied} of {total} notes',
  'vault.migration.result':
    'The copy is done and verified: {count} notes are encrypted in the storage and the server works with the encrypted storage now.',
  'vault.migration.plaintextNote':
    'The plain text files are still on the disk. They are only removed when you ask for it below.',
  'vault.migration.confirmHint':
    'The last step removes the plain text files of the folder from the disk. This cannot be undone.',
  'vault.migration.confirmList2':
    'If you keep the files, the folder holds both the plain text notes and the encrypted storage.',
  'vault.migration.done':
    'The migration is finished: {count} notes are encrypted and {deleted} plain text files ({bytes} bytes) were removed from the disk.',
  'vault.migration.doneNote':
    'The copies that live in the version history of a cloud provider, in the snapshots and in the backups are still there: the application cannot erase them. Remove them yourself if they must not exist any more.',
  'vault.migration.failed': 'The migration failed',
  'vault.migration.verifyFailed':
    'The copy could not be verified. The storage was not switched and the notes are still on the disk as plain text. Fix the problem and run the migration again.',
  'vault.migration.purgeFailed': 'The plaintext could not be removed',
  'vault.migration.brokenTitle': 'The objects that could not be read back:',
  'vault.migration.failedPathsTitle': 'The notes that could not be read:',
  'vault.migration.safeNote':
    'The notes that were copied are safe in the encrypted storage. The migration can be run again: it continues with the notes that are missing.',
  'vault.migration.encrypt': 'Encrypt the storage',
  'vault.migration.running': 'The migration is running…',
  'vault.migration.keepPlain': 'Keep the plain text files',
  'vault.migration.removePlain': 'Remove the plaintext files from the disk',
  'vault.migration.phase.reading': 'Reading the notes',
  'vault.migration.phase.encrypting': 'Encrypting the notes',
  'vault.migration.phase.verifying': 'Verifying the copy',
  'vault.migration.phase.switching': 'Switching the storage',
  'vault.migration.phase.purging': 'Removing the plaintext',
  'vault.migration.phase.done': 'Done',
  'vault.migration.phase.working': 'Working'
};
