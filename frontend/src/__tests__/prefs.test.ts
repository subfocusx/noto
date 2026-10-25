import { describe, expect, it, beforeEach } from 'vitest';
import {
  DEFAULT_PREFS,
  EDITOR_FONT_SIZE_MAX,
  EDITOR_FONT_SIZE_MIN,
  EXPANDED_FOLDERS_LIMIT,
  LEGACY_THEME_KEY,
  PREFS_KEY,
  RECENT_LIMIT,
  RIGHT_PANEL_WIDTH_DEFAULT,
  RIGHT_PANEL_WIDTH_MAX,
  RIGHT_PANEL_WIDTH_MIN,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  VAULT_RECENTS_LIMIT,
  loadPrefs,
  normalizePrefs,
  pushRecent,
  pushVaultRecent,
  removeRecent,
  savePrefs,
} from '../core/settings/prefs';

describe('preferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('falls back to the defaults when nothing is stored', () => {
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it('reads the stored preferences', () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        theme: 'light',
        mode: 'view',
        railSection: 'calendar',
        sidebarWidth: 320,
        treeSort: 'modified',
        editorFontSize: 16,
        editorWrap: false,
        expandedFolders: ['journal'],
        recentPaths: ['a.md'],
      }),
    );
    const prefs = loadPrefs();
    expect(prefs.theme).toBe('light');
    expect(prefs.mode).toBe('view');
    expect(prefs.railSection).toBe('calendar');
    expect(prefs.sidebarWidth).toBe(320);
    expect(prefs.treeSort).toBe('modified');
    expect(prefs.editorFontSize).toBe(16);
    expect(prefs.editorWrap).toBe(false);
    expect(prefs.expandedFolders).toEqual(['journal']);
    expect(prefs.recentPaths).toEqual(['a.md']);
  });

  it('survives a broken value in the storage', () => {
    localStorage.setItem(PREFS_KEY, '{not json');
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it('repairs a single broken field without losing the others', () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ theme: 'neon', mode: 'split', sidebarWidth: 9999 }));
    const prefs = loadPrefs();
    expect(prefs.theme).toBe(DEFAULT_PREFS.theme);
    // The old modes are gone: a broken value falls back to the editing.
    expect(prefs.mode).toBe(DEFAULT_PREFS.mode);
    expect(prefs.sidebarWidth).toBe(SIDEBAR_WIDTH_MAX);
  });

  it('clamps the width and the font size', () => {
    expect(normalizePrefs({ sidebarWidth: 10 }).sidebarWidth).toBe(SIDEBAR_WIDTH_MIN);
    expect(normalizePrefs({ sidebarWidth: 5000 }).sidebarWidth).toBe(SIDEBAR_WIDTH_MAX);
    expect(normalizePrefs({ editorFontSize: 2 }).editorFontSize).toBe(EDITOR_FONT_SIZE_MIN);
    expect(normalizePrefs({ editorFontSize: 99 }).editorFontSize).toBe(EDITOR_FONT_SIZE_MAX);
  });

  it('uses the defaults of the new preferences', () => {
    const prefs = loadPrefs();
    expect(prefs.rightPanelWidth).toBe(RIGHT_PANEL_WIDTH_DEFAULT);
    expect(prefs.recentCollapsed).toBe(false);
    expect(prefs.treeShowCounts).toBe(true);
    expect(prefs.railSection).toBe('explorer');
  });

  it('repairs a broken section of the rail', () => {
    expect(normalizePrefs({ railSection: 'nonsense' }).railSection).toBe('explorer');
    expect(normalizePrefs({ railSection: 'trash' }).railSection).toBe('trash');
  });

  it('falls back to the explorer for the search and the filters', () => {
    // The search and the filters are not sections of the column any more:
    // they live in one window over the application.
    expect(normalizePrefs({ railSection: 'search' }).railSection).toBe('explorer');
    expect(normalizePrefs({ railSection: 'filters' }).railSection).toBe('explorer');
  });

  it('clamps the width of the right column', () => {
    expect(normalizePrefs({ rightPanelWidth: 10 }).rightPanelWidth).toBe(RIGHT_PANEL_WIDTH_MIN);
    expect(normalizePrefs({ rightPanelWidth: 5000 }).rightPanelWidth).toBe(RIGHT_PANEL_WIDTH_MAX);
    expect(normalizePrefs({ rightPanelWidth: 320 }).rightPanelWidth).toBe(320);
    expect(normalizePrefs({ rightPanelWidth: 'wide' }).rightPanelWidth).toBe(RIGHT_PANEL_WIDTH_DEFAULT);
  });

  it('reads the new preferences from the storage', () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ rightPanelWidth: 240, recentCollapsed: true, treeShowCounts: false }),
    );
    const prefs = loadPrefs();
    expect(prefs.rightPanelWidth).toBe(240);
    expect(prefs.recentCollapsed).toBe(true);
    expect(prefs.treeShowCounts).toBe(false);
  });

  it('keeps the old preferences working', () => {
    // The preferences of the earlier releases have no new field: the defaults
    // fill the gaps and nothing is lost.
    localStorage.setItem(PREFS_KEY, JSON.stringify({ theme: 'light', mode: 'split' }));
    const prefs = loadPrefs();
    expect(prefs.theme).toBe('light');
    // The mode of the earlier releases is gone: the editing is the default.
    expect(prefs.mode).toBe(DEFAULT_PREFS.mode);
    expect(prefs.rightPanelWidth).toBe(RIGHT_PANEL_WIDTH_DEFAULT);
    expect(prefs.recentCollapsed).toBe(false);
    expect(prefs.treeShowCounts).toBe(true);
  });

  it('reads the theme of the old storage format', () => {
    localStorage.setItem(LEGACY_THEME_KEY, 'light');
    expect(loadPrefs().theme).toBe('light');
  });

  it('keeps the explicit choice over the old format', () => {
    localStorage.setItem(LEGACY_THEME_KEY, 'light');
    localStorage.setItem(PREFS_KEY, JSON.stringify({ theme: 'dark' }));
    expect(loadPrefs().theme).toBe('dark');
  });

  it('writes the preferences back', () => {
    savePrefs({ ...DEFAULT_PREFS, theme: 'light', mode: 'view' });
    const raw = localStorage.getItem(PREFS_KEY);
    expect(raw).toBeTruthy();
    expect(loadPrefs().theme).toBe('light');
    expect(loadPrefs().mode).toBe('view');
  });

  it('writes the new preferences back', () => {
    savePrefs({ ...DEFAULT_PREFS, rightPanelWidth: 240, recentCollapsed: true, treeShowCounts: false });
    const prefs = loadPrefs();
    expect(prefs.rightPanelWidth).toBe(240);
    expect(prefs.recentCollapsed).toBe(true);
    expect(prefs.treeShowCounts).toBe(false);
  });

  it('keeps the most recent notes first and without duplicates', () => {
    let paths: string[] = [];
    paths = pushRecent(paths, 'a.md');
    paths = pushRecent(paths, 'b.md');
    paths = pushRecent(paths, 'a.md');
    expect(paths).toEqual(['a.md', 'b.md']);
  });

  it('limits the list of the recent notes', () => {
    let paths: string[] = [];
    for (let i = 0; i < RECENT_LIMIT + 10; i += 1) paths = pushRecent(paths, `${i}.md`);
    expect(paths).toHaveLength(RECENT_LIMIT);
    expect(paths[0]).toBe(`${RECENT_LIMIT + 9}.md`);
  });

  it('removes a note from the list of the recent notes', () => {
    expect(removeRecent(['a.md', 'b.md'], 'a.md')).toEqual(['b.md']);
  });

  it('keeps the most recent storages first and without duplicates', () => {
    let paths: string[] = [];
    paths = pushVaultRecent(paths, 'C:\\notes');
    paths = pushVaultRecent(paths, 'D:\\work');
    paths = pushVaultRecent(paths, 'C:\\notes');
    expect(paths).toEqual(['C:\\notes', 'D:\\work']);
  });

  it('ignores an empty storage', () => {
    expect(pushVaultRecent(['C:\\notes'], '')).toEqual(['C:\\notes']);
  });

  it('limits the list of the recent storages', () => {
    let paths: string[] = [];
    for (let i = 0; i < VAULT_RECENTS_LIMIT + 10; i += 1) {
      paths = pushVaultRecent(paths, `C:\\vault-${i}`);
    }
    expect(paths).toHaveLength(VAULT_RECENTS_LIMIT);
    expect(paths[0]).toBe(`C:\\vault-${VAULT_RECENTS_LIMIT + 9}`);
  });

  it('cuts the list of the open folders', () => {
    // The list is written into the storage of the browser: a vault with more
    // folders than that keeps the tree of the last reload.
    const folders = Array.from({ length: EXPANDED_FOLDERS_LIMIT + 10 }, (_, i) => `folder-${i}`);
    expect(normalizePrefs({ expandedFolders: folders }).expandedFolders).toHaveLength(
      EXPANDED_FOLDERS_LIMIT,
    );
  });

  it('cuts the list of the recent storages that comes from the storage', () => {
    const recents = Array.from({ length: VAULT_RECENTS_LIMIT + 3 }, (_, i) => `C:\\vault-${i}`);
    expect(normalizePrefs({ vaultRecents: recents }).vaultRecents).toHaveLength(VAULT_RECENTS_LIMIT);
  });

  it('drops the values of the lists that are not paths', () => {
    const prefs = normalizePrefs({
      vaultRecents: ['C:\\notes', 42, null],
      expandedFolders: [1, 'journal'],
    });
    expect(prefs.vaultRecents).toEqual(['C:\\notes']);
    expect(prefs.expandedFolders).toEqual(['journal']);
  });

  it('knows no recent storage by default', () => {
    expect(loadPrefs().vaultRecents).toEqual([]);
  });
});
