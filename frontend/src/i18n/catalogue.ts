// The catalogue of the strings.
//
// The catalogue is split by area (one file per area) and by language (one
// directory per language): `catalog/en/**` holds the English text,
// `catalog/ru/**` the Russian one. Every key of an area exists in every
// language: the test of the catalogue proves it.
//
// The catalogue is **not** part of the entry chunk of the application: the
// loader below imports the catalogue of the current language with a dynamic
// import (a literal path, never a variable), so the strings of the interface
// travel in their own chunk. The application waits for the catalogue before
// the first render — the texts must never flash the raw key.
import { FALLBACK_LANGUAGE, type Language } from './language';

/** The loaders of the catalogue, one per language. */
const LOADERS: Record<Language, () => Promise<Record<string, string>>> = {
  en: () => import('./catalog/en/index').then((module) => module.catalogue),
  ru: () => import('./catalog/ru/index').then((module) => module.catalogue),
};

/** The catalogues that are already loaded, by language. */
const loaded: Partial<Record<Language, Record<string, string>>> = {};

/**
 * Loads the catalogue of a language.
 *
 * The load happens once: a second call of the same language returns at once.
 *
 * @returns the catalogue of the language.
 */
export async function loadCatalogue(language: Language): Promise<Record<string, string>> {
  const already = loaded[language];
  if (already) return already;
  const catalogue = await LOADERS[language]();
  loaded[language] = catalogue;
  return catalogue;
}

/**
 * The catalogue of a language, if it is loaded.
 *
 * The lookup of a string is a single read of a map: the catalogue is a plain
 * object and the string of the key is read without any asynchronous step.
 */
export function catalogueOf(language: Language): Record<string, string> | undefined {
  return loaded[language];
}

/** True when the loaded catalogue holds the key. */
export function hasKey(key: string): boolean {
  for (const language of Object.keys(loaded) as Language[]) {
    if (Object.prototype.hasOwnProperty.call(loaded[language], key)) return true;
  }
  return false;
}

/**
 * The keys of the catalogue of the fallback language, when it is loaded.
 *
 * The catalogue is the union of the areas: a key that appears in two areas is
 * a mistake, the later area wins, so the merge never throws and the interface
 * never breaks.
 */
export function catalogueKeys(): readonly string[] {
  return Object.keys(loaded[FALLBACK_LANGUAGE] ?? {});
}
