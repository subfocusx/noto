// The preferences of the user.
//
// The preferences are the settings of the application itself: the theme, the
// view mode, the width of the sidebar, the sort order of the tree and the list
// of the recently opened notes.
//
// They live in `localStorage` under a single key, so the whole set is written
// at once and never becomes inconsistent. The plugin settings have their own
// store (`./settingsStore.ts`, IndexedDB) and are not affected by this module.
//
// The values are validated on read: a broken or outdated value falls back to
// the default instead of breaking the interface.
import type { RailSection, ViewMode } from '../store/types';
import type { Language } from '../../i18n/language';

/** The key of the preferences in `localStorage`. */
export const PREFS_KEY = 'noto-prefs-v1';

/** The key of the old theme setting; it is read as a fallback. */
export const LEGACY_THEME_KEY = 'noto-theme';

/** The theme of the user: an explicit choice or the system theme. */
export type ThemePreference = 'light' | 'dark' | 'system';

/** The sort order of the tree. */
export type TreeSort = 'name' | 'modified';

/** The preferences of the user. */
export interface Prefs {
  theme: ThemePreference;
  mode: ViewMode;
  /**
   * The section of the left column that is open.
   *
   * The rail is an accordion, so exactly one section is shown at a time. The
   * choice is remembered: the column opens on the section that was used last.
   */
  railSection: RailSection;
  sidebarWidth: number;
  treeSort: TreeSort;
  /** The font size of the editor in pixels. */
  editorFontSize: number;
  /** True when the editor wraps the long lines. */
  editorWrap: boolean;
  /** The paths of the folders that are open. */
  expandedFolders: string[];
  /** The paths of the recently opened notes, the newest first. */
  recentPaths: string[];
  /**
   * The paths of the storages that were opened before, the newest first.
   *
   * The server holds one storage at a time, so the list of the recent ones
   * lives with the preferences of the user: it is the quick way back to a
   * storage without walking the disk again.
   */
  vaultRecents: string[];
  /** True when the right panel (outline) is visible. */
  rightPanelVisible: boolean;
  /** True when the right panel is pinned open even on narrow screens. */
  rightPanelPinned: boolean;
  /** The width of the right column in pixels. */
  rightPanelWidth: number;
  /** True when the list of the recent notes is collapsed. */
  recentCollapsed: boolean;
  /** True when the tree shows the number of the notes of a folder. */
  treeShowCounts: boolean;
  /**
   * The number of minutes of inactivity after which the encrypted storage
   * locks itself.
   *
   * The field is optional on purpose: the store of the application writes the
   * whole set of the preferences, but it does not know about the vault, so the
   * value must survive a write that does not carry it.
   */
  autoLockMinutes?: number;
  /**
   * The language of the interface.
   *
   * The field is optional on purpose: without a choice of the user the
   * language of the browser decides (see `../../i18n/language.ts`), so the
   * preference is only written when the user picks a language.
   */
  language?: Language;
}

/** The smallest font size of the editor. */
export const EDITOR_FONT_SIZE_MIN = 13;

/** The biggest font size of the editor. */
export const EDITOR_FONT_SIZE_MAX = 18;

/** The default font size of the editor. */
export const EDITOR_FONT_SIZE_DEFAULT = 14;

/** The smallest width of the sidebar. */
export const SIDEBAR_WIDTH_MIN = 200;

/** The biggest width of the sidebar. */
export const SIDEBAR_WIDTH_MAX = 480;

/** The default width of the sidebar. */
export const SIDEBAR_WIDTH_DEFAULT = 280;

/** The smallest width of the right column. */
export const RIGHT_PANEL_WIDTH_MIN = 200;

/** The biggest width of the right column. */
export const RIGHT_PANEL_WIDTH_MAX = 480;

/** The default width of the right column. */
export const RIGHT_PANEL_WIDTH_DEFAULT = 280;

/** The number of the notes in the list of the recent notes. */
export const RECENT_LIMIT = 20;

/**
 * The number of the folders that are remembered as open.
 *
 * The list is written into the storage of the browser, so it must stay small
 * enough to be written at once. A vault with more folders than that keeps the
 * tree of the last reload; the rest is opened by the user.
 */
export const EXPANDED_FOLDERS_LIMIT = 5000;

/** The number of the storages that are remembered as used. */
export const VAULT_RECENTS_LIMIT = 8;

/** The default number of minutes of inactivity before the vault locks itself. */
export const AUTO_LOCK_MINUTES_DEFAULT = 15;

/** The smallest number of minutes of inactivity before the vault locks itself. */
export const AUTO_LOCK_MINUTES_MIN = 1;

/** The biggest number of minutes of inactivity before the vault locks itself. */
export const AUTO_LOCK_MINUTES_MAX = 120;

/** The defaults of the preferences. */
export const DEFAULT_PREFS: Prefs = {
  theme: 'dark',
  mode: 'split',
  railSection: 'explorer',
  sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
  treeSort: 'name',
  editorFontSize: EDITOR_FONT_SIZE_DEFAULT,
  editorWrap: true,
  expandedFolders: [],
  recentPaths: [],
  vaultRecents: [],
  rightPanelVisible: true,
  rightPanelPinned: false,
  rightPanelWidth: RIGHT_PANEL_WIDTH_DEFAULT,
  recentCollapsed: false,
  treeShowCounts: true,
  autoLockMinutes: AUTO_LOCK_MINUTES_DEFAULT,
};

function clampWidth(value: number): number {
  if (!Number.isFinite(value)) return SIDEBAR_WIDTH_DEFAULT;
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(value)));
}

/** Clamps the width of the right column to its limits. */
export function clampRightPanelWidth(value: number): number {
  if (!Number.isFinite(value)) return RIGHT_PANEL_WIDTH_DEFAULT;
  return Math.min(RIGHT_PANEL_WIDTH_MAX, Math.max(RIGHT_PANEL_WIDTH_MIN, Math.round(value)));
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

/**
 * Normalises the section of the left column.
 *
 * A value that is not one of the sections of the rail falls back to the
 * explorer: the column must always show something.
 *
 * The search and the filters are not sections of the column any more: they
 * live in a window over the application, so a saved choice of one of them
 * falls back to the explorer as well.
 */
export function normalizeRailSection(value: unknown): RailSection {
  if (
    value === 'explorer' ||
    value === 'favorites' ||
    value === 'calendar' ||
    value === 'history' ||
    value === 'notifications' ||
    value === 'trash'
  ) {
    return value;
  }
  return DEFAULT_PREFS.railSection;
}

/** Clamps the number of minutes of inactivity into its limits. */
export function clampAutoLockMinutes(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return AUTO_LOCK_MINUTES_DEFAULT;
  return Math.min(AUTO_LOCK_MINUTES_MAX, Math.max(AUTO_LOCK_MINUTES_MIN, Math.round(value)));
}

/** Reads the theme of the old storage format. */
function legacyTheme(): ThemePreference {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_PREFS.theme;
    const value = localStorage.getItem(LEGACY_THEME_KEY);
    if (value === 'light') return 'light';
    if (value === 'dark') return 'dark';
    return DEFAULT_PREFS.theme;
  } catch {
    return DEFAULT_PREFS.theme;
  }
}

/**
 * Normalises an unknown value into a valid set of preferences.
 *
 * Every field is checked on its own, so one broken field never discards the
 * whole set.
 */
export function normalizePrefs(raw: unknown, fallbackTheme?: ThemePreference): Prefs {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<Prefs>;
  const theme: ThemePreference =
    source.theme === 'light' || source.theme === 'dark' || source.theme === 'system'
      ? source.theme
      : (fallbackTheme ?? DEFAULT_PREFS.theme);
  const mode: ViewMode =
    source.mode === 'editor' || source.mode === 'split' || source.mode === 'preview'
      ? source.mode
      : DEFAULT_PREFS.mode;
  const treeSort: TreeSort =
    source.treeSort === 'modified' || source.treeSort === 'name'
      ? source.treeSort
      : DEFAULT_PREFS.treeSort;
  const editorFontSize =
    typeof source.editorFontSize === 'number' && Number.isFinite(source.editorFontSize)
      ? Math.min(EDITOR_FONT_SIZE_MAX, Math.max(EDITOR_FONT_SIZE_MIN, Math.round(source.editorFontSize)))
      : EDITOR_FONT_SIZE_DEFAULT;
  // The language is only kept when it is a real one: a broken value falls back
  // to the language of the browser (the choice of the user is not lost).
  const language = source.language === 'en' || source.language === 'ru' ? source.language : undefined;
  return {
    theme,
    mode,
    railSection: normalizeRailSection(source.railSection),
    sidebarWidth:
      typeof source.sidebarWidth === 'number' ? clampWidth(source.sidebarWidth) : SIDEBAR_WIDTH_DEFAULT,
    treeSort,
    editorFontSize,
    editorWrap: source.editorWrap !== false,
    expandedFolders: stringList(source.expandedFolders).slice(0, EXPANDED_FOLDERS_LIMIT),
    recentPaths: stringList(source.recentPaths).slice(0, RECENT_LIMIT),
    vaultRecents: stringList(source.vaultRecents).slice(0, VAULT_RECENTS_LIMIT),
    rightPanelVisible: source.rightPanelVisible !== false,
    rightPanelPinned: source.rightPanelPinned === true,
    rightPanelWidth:
      typeof source.rightPanelWidth === 'number'
        ? clampRightPanelWidth(source.rightPanelWidth)
        : RIGHT_PANEL_WIDTH_DEFAULT,
    recentCollapsed: source.recentCollapsed === true,
    treeShowCounts: source.treeShowCounts !== false,
    autoLockMinutes: clampAutoLockMinutes(source.autoLockMinutes),
    language,
  };
}

/** Reads the preferences from the storage. */
export function loadPrefs(): Prefs {
  let raw: string | null = null;
  try {
    raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(PREFS_KEY);
  } catch {
    return normalizePrefs(null, legacyTheme());
  }
  if (raw === null) return normalizePrefs(null, legacyTheme());
  try {
    return normalizePrefs(JSON.parse(raw), legacyTheme());
  } catch {
    // A broken value must not break the application.
    return normalizePrefs(null, legacyTheme());
  }
}

/**
 * Writes the preferences into the storage.
 *
 * The set that is written is merged with the set that is already stored: a
 * caller that does not know a field (the store of the application does not know
 * the preferences of the vault) must not erase it.
 */
export function savePrefs(prefs: Partial<Prefs>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const merged = { ...loadPrefs(), ...prefs };
    localStorage.setItem(PREFS_KEY, JSON.stringify(normalizePrefs(merged)));
  } catch {
    /* the storage is not available or full */
  }
}

/**
 * Adds a path to the list of the recent notes.
 *
 * The newest note comes first, a path appears only once and the list never
 * grows beyond {@link RECENT_LIMIT}.
 */
export function pushRecent(paths: string[], path: string): string[] {
  if (!path) return paths;
  const rest = paths.filter((item) => item !== path);
  return [path, ...rest].slice(0, RECENT_LIMIT);
}

/** Removes a path from the list of the recent notes. */
export function removeRecent(paths: string[], path: string): string[] {
  return paths.filter((item) => item !== path);
}

/**
 * Adds a path to the list of the recent storages.
 *
 * The newest storage comes first, a path appears only once and the list never
 * grows beyond {@link VAULT_RECENTS_LIMIT}.
 */
export function pushVaultRecent(paths: string[], path: string): string[] {
  if (!path) return paths;
  const rest = paths.filter((item) => item !== path);
  return [path, ...rest].slice(0, VAULT_RECENTS_LIMIT);
}
