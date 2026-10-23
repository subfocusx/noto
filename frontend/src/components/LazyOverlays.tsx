// The overlays that are opened on demand.
//
// The command palette and the search are not needed to read and to write a
// note, so they are loaded when they are opened for the first time.
export { CommandPalette } from './CommandPalette';
export { SearchPanel } from './SearchPanel';
export { VaultPicker, type VaultPickerProps } from './VaultPicker';
