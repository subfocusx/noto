// The languages of the interface.
//
// The language of the user is a preference: it is stored with the other
// preferences (`../core/settings/prefs.ts`) and it is chosen in the settings.
// When the user has never chosen one, the language of the browser decides.
//
// The module is pure: it knows the list of the languages and how to read one
// out of a string. It never touches the storage and it never imports the
// interface.

/** The languages of the interface. */
export type Language = 'en' | 'ru';

/** The languages of the interface, in the order of the selector. */
export const LANGUAGES: readonly Language[] = ['en', 'ru'];

/** The name of a language, in the language itself. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  ru: 'Русский',
};

/** The language the interface falls back to. */
export const FALLBACK_LANGUAGE: Language = 'en';

/**
 * Reads a language out of a string.
 *
 * The value may be a full tag of the browser (`ru-RU`, `en-GB`): only the part
 * before the dash counts. An unknown value gives `null`, so the caller can
 * decide what to do with it.
 */
export function normalizeLanguage(value: unknown): Language | null {
  if (typeof value !== 'string') return null;
  const tag = value.trim().toLowerCase();
  if (tag.length === 0) return null;
  const primary = tag.split('-')[0];
  for (const language of LANGUAGES) {
    if (language === primary) return language;
  }
  return null;
}

/**
 * The language of the browser.
 *
 * The browser is the only source of the language before the user chooses one.
 * A missing browser (the tests, a server) gives the fallback.
 */
export function detectLanguage(): Language {
  if (typeof navigator === 'undefined') return FALLBACK_LANGUAGE;
  return normalizeLanguage(navigator.language) ?? FALLBACK_LANGUAGE;
}
