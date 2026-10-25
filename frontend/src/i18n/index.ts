// The core of the localisation.
//
// The module holds the language of the user, the catalogue of the strings and
// the function `t` that returns the text of a key in the current language.
//
// The module is pure: it never imports the interface and it never touches the
// network. The language is a preference of the user, so it is stored with the
// other preferences (`../core/settings/prefs.ts`) and it survives a reload.
//
// The catalogue is loaded eagerly: it is small (a few hundred short strings)
// and it keeps the lookup of a string free of any asynchronous step.
import { loadPrefs, savePrefs } from '../core/settings/prefs';
import { catalogueOf, loadCatalogue } from './catalogue';
import { FALLBACK_LANGUAGE, detectLanguage, normalizeLanguage, type Language } from './language';
import type { TranslationParams } from './types';

export type { Language };
export { LANGUAGES, LANGUAGE_NAMES, detectLanguage, normalizeLanguage } from './language';
export type { TranslationParams } from './types';
export { loadCatalogue };

/** The signature of the function that translates a key. */
export type Translator = (key: string, params?: TranslationParams) => string;

/** The listeners that are told when the language changes. */
const listeners = new Set<() => void>();

/** The language of the user; `null` until it is read from the preferences. */
let current: Language | null = null;

/**
 * The language of the user.
 *
 * The preference wins; without one the language of the browser decides.
 */
export function getLanguage(): Language {
  if (current === null) {
    current = normalizeLanguage(loadPrefs().language) ?? detectLanguage();
  }
  return current;
}

/** True when the catalogue holds the key. */
export function hasKey(key: string): boolean {
  return (
    Object.prototype.hasOwnProperty.call(catalogueOf(FALLBACK_LANGUAGE) ?? {}, key) ||
    Object.prototype.hasOwnProperty.call(catalogueOf(getLanguage()) ?? {}, key)
  );
}

/**
 * Replaces the placeholders of a string.
 *
 * A placeholder is written `{name}`; the value comes from the parameters. A
 * placeholder without a value stays as it is: a broken call must not erase the
 * text of the interface.
 */
export function interpolate(text: string, params?: TranslationParams): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    if (value === undefined || value === null) return whole;
    return String(value);
  });
}

/**
 * The text of a key in the current language.
 *
 * An unknown key gives the key itself: the interface stays readable and the
 * test of the catalogue points at the missing key.
 */
export function t(key: string, params?: TranslationParams): string {
  const language = getLanguage();
  const text =
    catalogueOf(language)?.[key] ?? catalogueOf(FALLBACK_LANGUAGE)?.[key] ?? key;
  return interpolate(text, params);
}

/**
 * Changes the language of the user.
 *
 * The choice is stored with the preferences, so it survives a reload. The
 * catalogue of the new language is loaded (it travels in its own chunk) and
 * the listeners are told afterwards, so the interface redraws itself in the
 * new language.
 */
export function setLanguage(language: Language): void {
  if (getLanguage() === language) return;
  current = language;
  savePrefs({ language });
  void loadCatalogue(language).then(() => {
    for (const listener of listeners) listener();
  });
}

/**
 * Watches the language of the user.
 *
 * @returns the function that stops the watch.
 */
export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
