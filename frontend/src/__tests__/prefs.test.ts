import { describe, expect, it, beforeEach } from 'vitest';
import {
  DEFAULT_PREFS,
  EDITOR_FONT_SIZE_MAX,
  EDITOR_FONT_SIZE_MIN,
  LEGACY_THEME_KEY,
  PREFS_KEY,
  RECENT_LIMIT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  loadPrefs,
  normalizePrefs,
  pushRecent,
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
        mode: 'editor',
        sidebarCollapsed: true,
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
    expect(prefs.mode).toBe('editor');
    expect(prefs.sidebarCollapsed).toBe(true);
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
    expect(prefs.mode).toBe('split');
    expect(prefs.sidebarWidth).toBe(SIDEBAR_WIDTH_MAX);
  });

  it('clamps the width and the font size', () => {
    expect(normalizePrefs({ sidebarWidth: 10 }).sidebarWidth).toBe(SIDEBAR_WIDTH_MIN);
    expect(normalizePrefs({ sidebarWidth: 5000 }).sidebarWidth).toBe(SIDEBAR_WIDTH_MAX);
    expect(normalizePrefs({ editorFontSize: 2 }).editorFontSize).toBe(EDITOR_FONT_SIZE_MIN);
    expect(normalizePrefs({ editorFontSize: 99 }).editorFontSize).toBe(EDITOR_FONT_SIZE_MAX);
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
    savePrefs({ ...DEFAULT_PREFS, theme: 'light', mode: 'preview' });
    const raw = localStorage.getItem(PREFS_KEY);
    expect(raw).toBeTruthy();
    expect(loadPrefs().theme).toBe('light');
    expect(loadPrefs().mode).toBe('preview');
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
});
