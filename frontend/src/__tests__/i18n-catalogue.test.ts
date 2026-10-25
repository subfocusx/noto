// The catalogue of the strings: every key is translated in every language and
// every key of the sources exists in the catalogue.
import { describe, expect, it } from 'vitest';
import { CATALOGUE, CATALOGUE_KEYS } from '../i18n/catalogue.static';
import { LANGUAGES } from '../i18n/language';

/**
 * The source of every file of the application, the tests excepted.
 *
 * The sources are read as they are (no import), so the test sees the keys as
 * they are written in the code.
 */
const SOURCES = import.meta.glob('../{components,core,i18n,lib,plugins,ui,api}/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('the catalogue of the strings', () => {
  it('has the same keys in every language', () => {
    const english = Object.keys(CATALOGUE.en).sort();
    for (const language of LANGUAGES) {
      expect(Object.keys(CATALOGUE[language]).sort()).toEqual(english);
    }
  });

  it('translates every key in Russian', () => {
    const missing: string[] = [];
    const empty: string[] = [];
    for (const key of CATALOGUE_KEYS) {
      const text = CATALOGUE.ru[key];
      if (text === undefined) missing.push(key);
      else if (text.trim().length === 0) empty.push(key);
    }
    expect(missing).toEqual([]);
    expect(empty).toEqual([]);
  });

  it('never shows the key itself in English', () => {
    const wrong: string[] = [];
    for (const key of CATALOGUE_KEYS) {
      if (CATALOGUE.en[key] === key) wrong.push(key);
    }
    expect(wrong).toEqual([]);
  });

  it('holds every key that the sources ask for', () => {
    const used = new Set<string>();
    const pattern = /\bt\(\s*'([a-zA-Z0-9_.-]+)'/g;
    for (const source of Object.values(SOURCES)) {
      for (const match of source.matchAll(pattern)) used.add(match[1] as string);
    }
    const unknown = [...used].filter((key) => !CATALOGUE.en[key]).sort();
    expect(unknown).toEqual([]);
  });
});
