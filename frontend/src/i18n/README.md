# The localisation of Noto

This folder holds the strings of the interface and the function that returns
them. The interface speaks English today and Russian as well; the language of
the user is a preference, so it is stored with the other preferences
(`../core/settings/prefs.ts`, the key `noto-prefs-v1`) and it is chosen in the
settings of the application.

## The shape of the folder

| File | What is inside |
|---|---|
| `language.ts` | The languages of the interface (`en`, `ru`), the reading of a tag of the browser and the detection of the language of the user. |
| `types.ts` | The shape of the catalogue (`Area`, `Catalogue`) and of the parameters of a string. |
| `catalog/*.ts` | The strings, one file per area (`common`, `shell`, `tree`, `editor`, `dialogs`, `settings`, `commands`, `panels`, `sidebar`, `sections`, `app`, `vault`). Every area holds the same keys in every language. |
| `catalogue.ts` | The merge of the areas into the whole catalogue. |
| `index.ts` | The core: `t`, `getLanguage`, `setLanguage`, `subscribeLanguage`, `interpolate`, `hasKey`. |
| `useT.ts` | The hook of the interface: `useT()` gives the function that translates, `useLanguage()` the language of the user. |

The core is pure: it never imports a component and it never touches the
network. The components import `useT` (or `t`) and nothing else. The core
(`core/reminders`, `core/quicknotes`) and the helpers of `lib/` that draw a
text of the interface use `t` as well; a built-in plugin may not import the
core of the localisation: a plugin has its own language.

## How to add a string

1. Choose the area of the string and add the key to **every** language of the
   file `catalog/<area>.ts`. A key that exists in English and not in Russian
   fails the test of the catalogue.
2. Call `t('the.key')` in the component. The placeholders are written between
   braces: `t('tabs.close', { name: tab.name })` gives `Close note.md`.
3. Do not build the sentence in the code: a sentence that is built from pieces
   cannot be translated. One key, one sentence.
4. The key must exist in the catalogue: the test
   `src/__tests__/i18n-catalogue.test.ts` walks the sources and fails on a key
   that the catalogue does not know.

The core of the plugin platform keeps the *key* of a title, not its text: the
palette translates the key when it draws the command (`titleKey`,
`descriptionKey` in `../core/commands/commandRegistry.ts`). A parameter that
starts with `$` is the key of another string (`titleParams`).

## How to add a language

1. Add the language to `LANGUAGES` and to `LANGUAGE_NAMES` in `language.ts`,
   and to the `Language` type.
2. Add the translation of **every** key of the catalogue to the new language in
   every file of `catalog/`. The type `Area` refuses a language that is
   missing: the compiler points at the file that is not complete.
3. The language of the browser is the default: `detectLanguage()` reads
   `navigator.language`, so a user whose browser is in the new language sees it
   without touching the settings.

The preferences know the language as well: `Prefs.language` in
`../core/settings/prefs.ts`. A broken value falls back to the language of the
browser instead of breaking the interface.

## The tests

| Test | What it proves |
|---|---|
| `src/__tests__/i18n-core.test.ts` | The fallback to the key, the placeholders, the change of the language and the persistence of the choice. |
| `src/__tests__/i18n-catalogue.test.ts` | Every key is translated in every language and every key of the sources exists. |
| `src/__tests__/i18n-component.test.tsx` | A component shows its text in the language of the user. |
