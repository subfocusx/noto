// The core of the localisation: the fallback, the placeholders, the change of
// the language and the persistence of the choice.
//
// The catalogue of a language travels in its own chunk: the tests load it
// before they read a string.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadPrefs, PREFS_KEY } from '../core/settings/prefs';
import {
  getLanguage,
  hasKey,
  interpolate,
  loadCatalogue,
  setLanguage,
  subscribeLanguage,
  t,
} from '../i18n';

describe('the core of the localisation', () => {
  beforeEach(async () => {
    localStorage.clear();
    await loadCatalogue('en');
    await loadCatalogue('ru');
    setLanguage('en');
  });

  afterEach(() => {
    localStorage.clear();
    setLanguage('en');
  });

  it('gives the key itself when the string is unknown', () => {
    expect(t('there.is.no.such.key')).toBe('there.is.no.such.key');
    expect(hasKey('there.is.no.such.key')).toBe(false);
  });

  it('knows the keys of the catalogue', () => {
    expect(hasKey('common.cancel')).toBe(true);
    expect(t('common.cancel')).toBe('Cancel');
  });

  it('replaces the placeholders', () => {
    expect(t('tabs.close', { name: 'note.md' })).toBe('Close note.md');
    expect(t('transfer.summary', { imported: 1, skipped: 2, errors: 3 })).toBe(
      'Imported: 1, skipped: 2, errors: 3',
    );
  });

  it('keeps a placeholder without a value as it is', () => {
    expect(interpolate('Hello {name}', {})).toBe('Hello {name}');
    expect(interpolate('Hello {name}')).toBe('Hello {name}');
  });

  it('changes the language of the interface', async () => {
    expect(getLanguage()).toBe('en');
    setLanguage('ru');
    await loadCatalogue('ru');
    expect(getLanguage()).toBe('ru');
    expect(t('common.cancel')).toBe('Отмена');
    expect(t('tabs.close', { name: 'note.md' })).toBe('Закрыть note.md');
  });

  it('tells the listeners that the language changed', async () => {
    let calls = 0;
    const off = subscribeLanguage(() => {
      calls += 1;
    });
    setLanguage('ru');
    await loadCatalogue('ru');
    setLanguage('ru');
    off();
    setLanguage('en');
    await loadCatalogue('en');
    expect(calls).toBe(1);
  });

  it('stores the choice of the user in the preferences', () => {
    setLanguage('ru');
    const raw = localStorage.getItem(PREFS_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string).language).toBe('ru');
    expect(loadPrefs().language).toBe('ru');
  });
});
