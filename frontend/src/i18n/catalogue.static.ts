// The whole catalogue, both languages (the tools and the tests).
//
// This module is **not** a part of the application: the production path loads
// the catalogue of the current language lazily (see `./catalogue.ts`), so the
// entry chunk of the bundle holds no string of the interface. This module
// exists for the test of the catalogue and for the tools that read the
// catalogue as a whole.
import { catalogue as en } from './catalog/en/index';
import { catalogue as ru } from './catalog/ru/index';
import { FALLBACK_LANGUAGE, LANGUAGES } from './language';
import type { Catalogue } from './types';

/** The whole catalogue: the text of every key, in every language. */
export const CATALOGUE: Catalogue = {
  en,
  ru,
} as Catalogue;

/** Every key of the catalogue, without duplicates. */
export const CATALOGUE_KEYS: readonly string[] = Object.keys(CATALOGUE[FALLBACK_LANGUAGE]);

/** The languages of the catalogue. */
export const CATALOGUE_LANGUAGES = LANGUAGES;
