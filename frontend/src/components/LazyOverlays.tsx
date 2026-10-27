// The overlays that are opened on demand.
//
// The command palette and the window of the search are not needed to read and
// to write a note, so they are loaded when they are opened for the first time.
//
// The screens of the encrypted storage are loaded the same way: they drag the
// crypto core (and the WASM of the key derivation) with them, and an open
// storage must not pay for them.
export { CommandPalette } from './CommandPalette';
// The window of the search has a chunk of its own: it is small, and it must
// not wait for the crypto core of the encrypted storage.
// The panel of the attachments is opened in a dialog: it is loaded with the
// other overlays.
export { AttachmentsPanel } from './AttachmentsPanel';
export { VaultPicker, type VaultPickerProps } from './VaultPicker';
export { VaultSetupDialog } from './VaultSetupDialog';
export { VaultMigrationDialog } from './VaultMigrationDialog';
export { VaultUnlockScreen } from './VaultUnlockScreen';
