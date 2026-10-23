// The panels that are opened rarely.
//
// The trash, the import/export and the manager of the plugins are not needed
// for the work in the editor, so they live in their own chunk: the entry
// bundle of the application stays small.
export { PluginManagerPanel, type PluginManagerEntry, type PluginManagerStatus } from './PluginManagerPanel';
export { TrashPanel } from './TrashPanel';
export { TransferPanel } from './TransferPanel';
