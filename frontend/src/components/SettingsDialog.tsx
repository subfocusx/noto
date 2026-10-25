// The settings of the application.
//
// The dialog is a plain view over the preferences: every control calls the
// matching callback of the shell, which stores the value. The dialog never
// shows a path or a note: it only shows the settings of the interface and of
// the editor.
import { Dialog } from './Dialog';
import { VaultSecuritySection } from './VaultSecuritySection';

export interface SettingsDialogProps {
  /** True when the dialog is shown. */
  open: boolean;
  /** Called when the dialog must be closed. */
  onClose(): void;
  /** The theme of the application. */
  theme: 'light' | 'dark' | 'system';
  /** The width of the sidebar, in pixels. */
  sidebarWidth: number;
  /** The order of the notes in the tree. */
  treeSort: 'name' | 'modified';
  /** The font size of the editor, in pixels. */
  editorFontSize: number;
  /** True when the editor wraps the long lines. */
  editorWrap: boolean;
  /** True when the application can reach the server. */
  online: boolean;
  /** The version of the application. */
  version?: string;
  /** Called when the theme changes. */
  onTheme(theme: 'light' | 'dark' | 'system'): void;
  /** Called when the width of the sidebar changes. */
  onSidebarWidth(width: number): void;
  /** Called when the order of the tree changes. */
  onTreeSort(sort: 'name' | 'modified'): void;
  /** Called when the font size of the editor changes. */
  onEditorFontSize(size: number): void;
  /** Called when the line wrapping of the editor changes. */
  onEditorWrap(wrap: boolean): void;
  /** Called to open the manager of the plugins. */
  onOpenPlugins(): void;
  /** Called to open the list of the keyboard shortcuts. */
  onOpenShortcuts(): void;
  /** Called to open the trash. */
  onOpenTrash(): void;
  /** Called to open the import and export panel. */
  onOpenTransfer(): void;
  /** Called when the user asks to encrypt the storage of the notes. */
  onSetUpEncrypted?(): void;
}

/** The themes of the application. */
const THEMES = ['light', 'dark', 'system'] as const;
/** The orders of the tree. */
const SORTS = ['name', 'modified'] as const;

type Theme = (typeof THEMES)[number];
type Sort = (typeof SORTS)[number];

/** True when the value is one of the themes. */
function isTheme(value: string): value is Theme {
  return (THEMES as readonly string[]).includes(value);
}

/** True when the value is one of the orders of the tree. */
function isSort(value: string): value is Sort {
  return (SORTS as readonly string[]).includes(value);
}

/**
 * The props of the earlier releases.
 *
 * The view mode is gone from the interface: the editor is the only view. The
 * old props are still accepted (and ignored), so that a caller of the
 * previous contract keeps working.
 */
type LegacySettingsDialogProps = {
  mode?: unknown;
  onMode?: unknown;
};

/** The settings of the application. */
export function SettingsDialog(props: SettingsDialogProps & LegacySettingsDialogProps) {
  return (
    <Dialog
      title="Settings"
      open={props.open}
      onClose={props.onClose}
      footer={
        <div class="button-row">
          <button type="button" class="primary-button" onClick={props.onClose}>
            Close
          </button>
        </div>
      }
    >
      <section class="settings-group">
        <h3>Appearance</h3>

        <div class="settings-row">
          <div class="settings-row-label">
            <span>Theme</span>
            <span>Light, dark or the theme of the system</span>
          </div>
          <select
            aria-label="Theme"
            value={props.theme}
            onChange={(event) => {
              const value = (event.target as HTMLSelectElement).value;
              if (isTheme(value)) props.onTheme(value);
            }}
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System</option>
          </select>
        </div>

        <div class="settings-row">
          <div class="settings-row-label">
            <span>Sidebar width</span>
            <span>The width of the tree of the notes</span>
          </div>
          <input
            type="range"
            aria-label="Sidebar width"
            min={200}
            max={480}
            step={10}
            value={props.sidebarWidth}
            onInput={(event) => props.onSidebarWidth(Number((event.target as HTMLInputElement).value))}
          />
        </div>
      </section>

      <section class="settings-group">
        <h3>Editor</h3>

        <div class="settings-row">
          <div class="settings-row-label">
            <span>Font size</span>
            <span>The size of the text of the note</span>
          </div>
          <input
            type="range"
            aria-label="Font size"
            min={13}
            max={18}
            step={1}
            value={props.editorFontSize}
            onInput={(event) => props.onEditorFontSize(Number((event.target as HTMLInputElement).value))}
          />
        </div>

        <div class="settings-row">
          <div class="settings-row-label">
            <span>Wrap the lines</span>
            <span>Long lines are broken at the width of the editor</span>
          </div>
          <button
            type="button"
            class="switch"
            role="switch"
            aria-checked={props.editorWrap}
            aria-label="Wrap the lines"
            onClick={() => props.onEditorWrap(!props.editorWrap)}
          />
        </div>
      </section>

      <section class="settings-group">
        <h3>Navigation</h3>

        <div class="settings-row">
          <div class="settings-row-label">
            <span>Order of the notes</span>
            <span>How the tree of the notes is sorted</span>
          </div>
          <select
            aria-label="Order of the notes"
            value={props.treeSort}
            onChange={(event) => {
              const value = (event.target as HTMLSelectElement).value;
              if (isSort(value)) props.onTreeSort(value);
            }}
          >
            <option value="name">By name</option>
            <option value="modified">By last change</option>
          </select>
        </div>
      </section>

      <section class="settings-group">
        <h3>Keyboard shortcuts</h3>

        <div class="settings-row">
          <div class="settings-row-label">
            <span>Keyboard shortcuts</span>
            <span>The list of every shortcut of the application</span>
          </div>
          <button type="button" class="text-button" onClick={props.onOpenShortcuts}>
            Show the shortcuts
          </button>
        </div>
      </section>

      <section class="settings-group">
        <h3>Plugins</h3>

        <div class="settings-row">
          <div class="settings-row-label">
            <span>Plugins</span>
            <span>Enables, disables and configures the plugins</span>
          </div>
          <button type="button" class="text-button" onClick={props.onOpenPlugins}>
            Manage the plugins
          </button>
        </div>
      </section>

      <section class="settings-group">
        <h3>Data</h3>

        <div class="settings-row">
          <div class="settings-row-label">
            <span>Trash</span>
            <span>The notes that have been deleted</span>
          </div>
          <button type="button" class="text-button" onClick={props.onOpenTrash}>
            Open the trash
          </button>
        </div>

        <div class="settings-row">
          <div class="settings-row-label">
            <span>Import and export</span>
            <span>Brings the notes in and out of the application</span>
          </div>
          <button type="button" class="text-button" onClick={props.onOpenTransfer}>
            Import and export
          </button>
        </div>
      </section>

      <VaultSecuritySection onSetUpEncrypted={props.onSetUpEncrypted} />

      <section class="settings-group">
        <h3>About</h3>

        <div class="settings-row">
          <div class="settings-row-label">
            <span>Version</span>
            <span>{props.version ?? 'unknown'}</span>
          </div>
          <span class="muted">{props.online ? 'Online' : 'Offline'}</span>
        </div>
      </section>
    </Dialog>
  );
}
