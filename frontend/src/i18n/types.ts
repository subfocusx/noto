// The shape of the catalogue of the strings.
//
// The catalogue is split by area and by language: one file per area and per
// language (`catalog/<language>/<area>.ts`), and one file per language
// (`catalog/<language>/index.ts`) that merges the areas. Every area holds the
// same keys in every language: a key that exists in English exists in Russian
// too, otherwise the test of the catalogue fails.
import type { Language } from './language';

/** The strings of one area, in one language. */
export type Area = Record<string, string>;

/** The whole catalogue: the text of every key, in every language. */
export type Catalogue = Record<Language, Record<string, string>>;

/** The values of the placeholders of a string. */
export type TranslationParams = Record<string, string | number>;
