// The settings of the application.
//
// The dialog is a plain view over the preferences: every control calls the
// matching callback of the shell, which stores the value. The dialog never
// shows a path or a note: it only shows the settings of the interface and of
// the editor.
//
// The language is the only setting that the dialog owns itself: it is a
// preference of the user and the shell does not have to know about it. When the
// shell passes the language and the callback, they are used; otherwise the
// dialog changes the language of the core of the localisation itself.
import { Dialog } from './Dialog';
import { VaultSecuritySection } from './VaultSecuritySection';
import {
  LANGUAGES,
  LANGUAGE_NAMES,
  getLanguage,
  setLanguage,
  type Language,
} from '../i18n';
import { useT } from '../i18n/useT';

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
  /** True when the tree shows the counters of the notes. */
  showTreeCounts?: boolean;
  /** True when the application can reach the server. */
  online: boolean;
  /** The version of the application. */
  version?: string;
  /** The language of the interface; the dialog reads it when it is missing. */
  language?: Language;
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
  /** Called when the counters of the notes of the tree are shown or hidden. */
  onShowTreeCounts?(show: boolean): void;
  /** Called when the language of the interface changes. */
  onLanguage?(language: Language): void;
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
  const t = useT();
  const language = props.language ?? (getLanguage() as Language);
  // The counters of the tree are shown by default.
  const showTreeCounts = props.showTreeCounts ?? true;

  /** Changes the language of the interface. */
  const changeLanguage = (value: string): void => {
    const next = LANGUAGES.find((item) => item === value);
    if (!next) return;
    if (props.onLanguage) props.onLanguage(next);
    else setLanguage(next);
  };

  return (
    <Dialog
      title={t('settings.title')}
      open={props.open}
      onClose={props.onClose}
      footer={
        <div class="button-row">
          <button type="button" class="primary-button" onClick={props.onClose}>
            {t('settings.close')}
          </button>
        </div>
      }
    >
      <section class="settings-group">
        <h3>{t('settings.appearance')}</h3>

        <div class="settings-row">
          <div class="settings-row-label">
            <span>{t('settings.theme')}</span>
            <span>{t('settings.themeHint')}</span>
          </div>
          <select
            aria-label={t('settings.theme')}
            value={props.theme}
            onChange={(event) => {
              const value = (event.target as HTMLSelectElement).value;
              if (isTheme(value)) props.onTheme(value);
            }}
          >
            <option value="light">{t('settings.theme.light')}</option>
            <option value="dark">{t('settings.theme.dark')}</option>
            <option value="system">{t('settings.theme.system')}</option>
          </select>
        </div>

        <div class="settings-row">
          <div class="settings-row-label">
            <span>{t('settings.language')}</span>
            <span>{t('settings.languageHint')}</span>
          </div>
          <select
            aria-label={t('settings.language')}
            value={language}
            data-testid="settings-language"
            onChange={(event) => {
              changeLanguage((event.target as HTMLSelectElement).value);
            }}
          >
            {LANGUAGES.map((item) => (
              <option key={item} value={item}>
                {LANGUAGE_NAMES[item]}
              </option>
            ))}
          </select>
        </div>

        <div class="settings-row">
          <div class="settings-row-label">
            <span>{t('settings.sidebarWidth')}</span>
            <span>{t('settings.sidebarWidthHint')}</span>
          </div>
          <input
            type="range"
            aria-label={t('settings.sidebarWidth')}
            min={200}
            max={480}
            step={10}
            value={props.sidebarWidth}
            onInput={(event) => props.onSidebarWidth(Number((event.target as HTMLInputElement).value))}
          />
        </div>
      </section>

      <section class="settings-group">
        <h3>{t('settings.editor')}</h3>

        <div class="settings-row">
          <div class="settings-row-label">
            <span>{t('settings.fontSize')}</span>
            <span>{t('settings.fontSizeHint')}</span>
          </div>
          <input
            type="range"
            aria-label={t('settings.fontSize')}
            min={13}
            max={18}
            step={1}
            value={props.editorFontSize}
            onInput={(event) => props.onEditorFontSize(Number((event.target as HTMLInputElement).value))}
          />
        </div>

        <div class="settings-row">
          <div class="settings-row-label">
            <span>{t('settings.wrap')}</span>
            <span>{t('settings.wrapHint')}</span>
          </div>
          <button
            type="button"
            class="switch"
            role="switch"
            aria-checked={props.editorWrap}
            aria-label={t('settings.wrap')}
            onClick={() => props.onEditorWrap(!props.editorWrap)}
          />
        </div>
      </section>

      <section class="settings-group">
        <h3>{t('settings.navigation')}</h3>

        <div class="settings-row">
          <div class="settings-row-label">
            <span>{t('settings.order')}</span>
            <span>{t('settings.orderHint')}</span>
          </div>
          <select
            aria-label={t('settings.order')}
            value={props.treeSort}
            onChange={(event) => {
              const value = (event.target as HTMLSelectElement).value;
              if (isSort(value)) props.onTreeSort(value);
            }}
          >
            <option value="name">{t('settings.order.name')}</option>
            <option value="modified">{t('settings.order.modified')}</option>
          </select>
        </div>

        <div class="settings-row">
          <div class="settings-row-label">
            <span>{t('settings.treeShowCounts')}</span>
            <span>{t('settings.treeShowCountsHint')}</span>
          </div>
          <button
            type="button"
            class="switch"
            role="switch"
            aria-checked={showTreeCounts}
            aria-label={t('settings.treeShowCounts')}
            onClick={() => props.onShowTreeCounts?.(!showTreeCounts)}
          />
        </div>
      </section>

      <section class="settings-group">
        <h3>{t('settings.shortcuts')}</h3>

        <div class="settings-row">
          <div class="settings-row-label">
            <span>{t('settings.shortcuts')}</span>
            <span>{t('settings.shortcutsHint')}</span>
          </div>
          <button type="button" class="text-button" onClick={props.onOpenShortcuts}>
            {t('settings.showShortcuts')}
          </button>
        </div>
      </section>

      <section class="settings-group">
        <h3>{t('settings.plugins')}</h3>

        <div class="settings-row">
          <div class="settings-row-label">
            <span>{t('settings.plugins')}</span>
            <span>{t('settings.pluginsHint')}</span>
          </div>
          <button type="button" class="text-button" onClick={props.onOpenPlugins}>
            {t('settings.managePlugins')}
          </button>
        </div>
      </section>

      <section class="settings-group">
        <h3>{t('settings.data')}</h3>

        <div class="settings-row">
          <div class="settings-row-label">
            <span>{t('settings.trash')}</span>
            <span>{t('settings.trashHint')}</span>
          </div>
          <button type="button" class="text-button" onClick={props.onOpenTrash}>
            {t('settings.openTrash')}
          </button>
        </div>

        <div class="settings-row">
          <div class="settings-row-label">
            <span>{t('settings.transfer')}</span>
            <span>{t('settings.transferHint')}</span>
          </div>
          <button type="button" class="text-button" onClick={props.onOpenTransfer}>
            {t('settings.transfer')}
          </button>
        </div>
      </section>

      <VaultSecuritySection onSetUpEncrypted={props.onSetUpEncrypted} />

      <section class="settings-group">
        <h3>{t('settings.about')}</h3>

        <div class="settings-row">
          <div class="settings-row-label">
            <span>{t('settings.version')}</span>
            <span>{props.version ?? t('common.unknown')}</span>
          </div>
          <span class="muted">{props.online ? t('settings.online') : t('settings.offline')}</span>
        </div>
      </section>
    </Dialog>
  );
}
